import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import { getTemplateFields } from '../../data/templates';
import type { FieldScope, FieldSection, FieldType, TemplateField } from '../../data/types';
import {
  autoMapColumns, buildImportRows, duplicateTargets, type ColumnMapping, type ImportReport, type ImportTarget,
} from '../../domain/import';
import { parseSpreadsheetOffThread } from '../../domain/spreadsheet';
import { normalizeKey, proposeFieldsFromSheet } from '../../domain/templateFromSheet';
import type { ImportDuplicateWarning } from '../../data/patients';
import { useToast } from '../../components/Toast';

const STATUSES = ['draft', 'complete', 'curated'] as const;
const CONFLICTS = ['fill', 'overwrite', 'skip'] as const;
const TYPES: FieldType[] = ['text', 'integer', 'number', 'date', 'datetime', 'boolean', 'select', 'multiselect'];
const SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];
const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 15 * 1024 * 1024; // §5.3 : borne de TAILLE avant lecture (anti fichier hostile)
const CHUNK = 300; // taille des lots (au-dela, import par lots avec progression)

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// V2 (import fluide) : brouillon d'une variable a creer pour une colonne non reconnue.
interface NewVarDraft {
  col: number;
  label: string;
  type: FieldType;
  scope: FieldScope;
  section: FieldSection;
  allowedValues: string[] | null;
}

// Importation par lots (CSV / XLSX) : 1 ligne = 1 rencontre, colonnes patient repetees.
// Correspondance par INDEX de colonne, APERCU (dry-run), puis import (idempotent + mode de conflit).
export function ImportData() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const { toast } = useToast();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [draft, setDraft] = useState<NewVarDraft | null>(null); // V2 : variable en cours de creation
  const [draftBusy, setDraftBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [status, setStatus] = useState<string>('draft');
  const [conflict, setConflict] = useState<'fill' | 'overwrite' | 'skip'>('fill');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [warnings, setWarnings] = useState<ImportDuplicateWarning[]>([]); // §7.6 doublons probables
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const load = useCallback(async () => {
    if (!baseId) return;
    try {
      const base = await bases.getBase(baseId);
      setIsOwner(base?.role === 'owner'); // seul le proprietaire peut modifier le jeu de variables
      if (base?.base.currentTemplateVersionId) {
        setVersionId(base.base.currentTemplateVersionId);
        setFields(await getTemplateFields(templates, base.base.currentTemplateVersionId));
      }
    } catch (e) {
      setError(msg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, templates]);

  useEffect(() => { void load(); }, [load]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setReport(null); setWarnings([]); setCommitted(false);
    // §5.3 : on BORNE la taille AVANT de lire le fichier en memoire (arrayBuffer).
    if (file.size > MAX_FILE_BYTES) {
      setError(t('import.file_too_big').replace('{max}', String(Math.round(MAX_FILE_BYTES / 1024 / 1024))));
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      // Empreinte best-effort : si crypto.subtle est indisponible (contexte non securise,
      // vieux navigateur), on continue sans -> on perd seulement l'idempotence (anti-doublon).
      let hash: string | null = null;
      try { hash = await sha256Hex(buf); } catch { hash = null; }
      // §6.1 — parsing d'un fichier NON FIABLE hors du thread principal (SheetJS 0.20.3 corrige).
      const { headers: head, rows } = await parseSpreadsheetOffThread(buf);
      if (rows.length > MAX_ROWS) {
        setError(t('import.too_many').replace('{max}', String(MAX_ROWS)).replace('{n}', String(rows.length)));
        return;
      }
      setFileName(file.name);
      setFileHash(hash);
      // Nouveau fichier -> on repart d'une correspondance VIERGE (l'effet ci-dessous fusionne les
      // choix manuels : sans ce reset, ceux de l'ancien fichier survivraient par index).
      setDraft(null);
      setMapping({});
      setHeaders(head);
      setRawRows(rows);
      // La correspondance est (re)calculee par un effet sur [headers, fields] -> robuste si les
      // champs du gabarit arrivent APRES le depot du fichier.
    } catch (err) {
      setError(msg(err));
    }
  }

  // Correspondance auto-recalculee quand un fichier est chargé ou que les champs arrivent.
  // V2 : on FUSIONNE avec les choix manuels (non-ignore) — la creation d'une variable recharge
  // les champs et re-declenche cet effet ; sans fusion, elle ecraserait les re-mappages a la main.
  useEffect(() => {
    if (headers.length === 0) {
      setMapping({});
      return;
    }
    const auto = autoMapColumns(headers, fields);
    setMapping((prev) => {
      const merged: ColumnMapping = { ...auto };
      for (const [col, target] of Object.entries(prev)) {
        if (target !== 'ignore') merged[Number(col)] = target;
      }
      return merged;
    });
  }, [headers, fields]);

  // §5.1 : tout changement de parametre d'import INVALIDE l'apercu precedent (sinon l'import
  // reel ne correspondrait plus a l'apercu affiche). On force a relancer un apercu.
  useEffect(() => {
    setReport(null); setWarnings([]); setCommitted(false);
  }, [mapping, status, conflict, rawRows, versionId]);

  const rows = useMemo(() => buildImportRows(rawRows, mapping, fields), [rawRows, mapping, fields]);
  const hasPatientCode = Object.values(mapping).includes('patient_code');
  const dups = useMemo(() => duplicateTargets(mapping), [mapping]);
  const canRun = hasPatientCode && dups.length === 0;

  async function run(dryRun: boolean) {
    if (!baseId) return;
    setBusy(true); setError(null); setProgress(null);
    try {
      // §7.6 : a l'apercu, signaler les rencontres ressemblant a des existantes (sans bloquer).
      // Resilient : si la RPC n'est pas encore deployee, on n'empeche pas l'apercu.
      if (dryRun) {
        try { setWarnings(await patients.detectImportDuplicates(baseId, rows)); } catch { setWarnings([]); }
      }
      if (rows.length <= CHUNK) {
        // Petit volume : un seul appel.
        setReport(await patients.importRecords(baseId, rows, { dryRun, status, conflict, fileHash, templateVersionId: versionId }));
      } else {
        // §6.5 import par LOTS : ouverture du lot (idempotence + verrous) puis chunks + progression.
        const batchId = dryRun ? null : await patients.beginImportBatch(baseId, { status, conflict, fileHash, templateVersionId: versionId, expectedRows: rows.length });
        const agg: ImportReport = { dry_run: dryRun, status, conflict, patients_new: 0, patients_updated: 0, encounters: 0, error_count: 0, already_imported: 0, errors: [] };
        for (let i = 0; i < rows.length; i += CHUNK) {
          const rep = await patients.importRecords(baseId, rows.slice(i, i + CHUNK), {
            dryRun, status, conflict, fileHash: null, templateVersionId: versionId, batchId,
          });
          agg.patients_new += rep.patients_new; agg.patients_updated += rep.patients_updated;
          agg.encounters += rep.encounters; agg.error_count += rep.error_count;
          agg.already_imported = (agg.already_imported ?? 0) + (rep.already_imported ?? 0); // §7.8
          agg.errors.push(...rep.errors.map((er) => ({ ...er, row: er.row + i }))); // n° de ligne global
          setProgress({ done: Math.min(i + CHUNK, rows.length), total: rows.length });
        }
        // §6.2 : cloture du lot -> active l'idempotence du fichier. En cas d'erreur, le lot
        // reste 'processing' et peut etre REPRIS (re-lancer l'import reprend le meme lot).
        if (batchId) await patients.completeImportBatch(batchId);
        setReport(agg);
      }
      if (!dryRun) setCommitted(true);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  const setCol = (i: number, target: ImportTarget) => setMapping((m) => ({ ...m, [i]: target }));

  // V2 : ouvre le mini-formulaire « creer la variable », pre-rempli par INFERENCE sur les
  // valeurs de la colonne (meme moteur que « jeu de variables depuis un fichier », F1).
  function startCreate(col: number) {
    const header = (headers[col] ?? '').trim();
    if (!header) return;
    const [proposal] = proposeFieldsFromSheet([header], rawRows.map((r) => [r[col]]));
    setDraft({
      col,
      label: header,
      type: proposal?.type ?? 'text',
      scope: proposal?.scope ?? 'patient',
      section: proposal?.section ?? 'clinique',
      allowedValues: proposal?.allowedValues ?? null,
    });
  }

  // V2 : cree la variable dans le jeu de variables de la base, puis mappe la colonne dessus.
  async function createVariable() {
    if (!draft || !versionId) return;
    const label = draft.label.trim();
    if (!label) return;
    const fieldKey = normalizeKey(label);
    if (fields.some((f) => f.fieldKey === fieldKey)) {
      setError(t('import.var_exists'));
      return;
    }
    setDraftBusy(true);
    setError(null);
    try {
      const keepValues = draft.type === 'select' || draft.type === 'multiselect';
      await templates.addField(versionId, {
        fieldKey, label, scope: draft.scope, section: draft.section, type: draft.type,
        required: false, allowedValues: keepValues ? draft.allowedValues : null,
      });
      setFields(await getTemplateFields(templates, versionId));
      // Mappage EXPLICITE : le libelle a pu etre edite et ne plus correspondre a l'en-tete.
      setCol(draft.col, `${draft.scope}:${fieldKey}`);
      setDraft(null);
      toast(t('import.var_created'), 'success');
    } catch (e) {
      setError(msg(e));
    } finally {
      setDraftBusy(false);
    }
  }

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('admin.back')}</button>
        <h1 className="page-title mt-2">{t('import.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('import.hint')}</p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('import.fictional')}</div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="card p-4">
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('import.file')}</span>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} className="mt-1 text-sm" />
        </label>
        {fileName && <p className="mt-2 text-xs text-slate-500">{fileName} — {rawRows.length} {t('import.rows')}</p>}
      </div>

      {headers.length > 0 && (
        <>
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('import.mapping')}</h2>
            <div className="space-y-2">
              {headers.map((h, i) => (
                <div key={i}>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-1/3 truncate font-mono text-xs text-slate-600" title={h || `(colonne ${i + 1})`}>
                      {h || <span className="italic text-slate-400">(colonne {i + 1})</span>}
                    </span>
                    <select className="input flex-1" value={mapping[i] ?? 'ignore'} onChange={(e) => setCol(i, e.target.value as ImportTarget)}>
                      <option value="ignore">— {t('import.ignore')} —</option>
                      <optgroup label={t('import.grp_meta')}>
                        <option value="patient_code">{t('import.patient_code')}</option>
                        <option value="encounter_type">{t('encounter.type')}</option>
                        <option value="encounter_date">{t('encounter.date')}</option>
                      </optgroup>
                      <optgroup label={t('import.grp_identity')}>
                        <option value="identity.full_name">{t('import.full_name')}</option>
                        <option value="identity.date_of_birth">{t('import.dob')}</option>
                      </optgroup>
                      <optgroup label={t('import.grp_patient')}>
                        {fields.filter((f) => f.scope === 'patient').map((f) => (
                          <option key={f.id} value={`patient:${f.fieldKey}`}>{f.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label={t('import.grp_encounter')}>
                        {fields.filter((f) => f.scope === 'encounter').map((f) => (
                          <option key={f.id} value={`encounter:${f.fieldKey}`}>{f.label}</option>
                        ))}
                      </optgroup>
                    </select>
                    {/* V2 : colonne non reconnue -> le proprietaire peut creer la variable sur place. */}
                    {isOwner && (mapping[i] ?? 'ignore') === 'ignore' && h.trim() !== '' && draft?.col !== i && (
                      <button type="button" onClick={() => startCreate(i)} className="shrink-0 text-xs font-medium text-teal-700 hover:underline">
                        {t('import.create_var')}
                      </button>
                    )}
                  </div>
                  {draft?.col === i && (
                    <div className="mt-2 space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
                      <p className="text-xs font-semibold text-slate-700">{t('import.create_var_title').replace('{col}', h.trim())}</p>
                      <p className="text-xs text-slate-500">{t('import.create_var_hint')}</p>
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
                          {t('admin.label')}
                          <input className="input" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                          {t('admin.type')}
                          <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as FieldType })}>
                            {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                          {t('admin.scope')}
                          <select className="input" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as FieldScope })}>
                            <option value="patient">{t('scope.patient')}</option>
                            <option value="encounter">{t('scope.encounter')}</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                          {t('admin.section')}
                          <select className="input" value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value as FieldSection })}>
                            {SECTIONS.map((s) => <option key={s} value={s}>{t(`section.${s}`)}</option>)}
                          </select>
                        </label>
                        <button type="button" onClick={() => void createVariable()} disabled={draftBusy || draft.label.trim() === ''} className="btn-primary">
                          {t('import.create_var')}
                        </button>
                        <button type="button" onClick={() => setDraft(null)} disabled={draftBusy} className="btn-secondary">
                          {t('common.cancel')}
                        </button>
                      </div>
                      {(draft.type === 'select' || draft.type === 'multiselect') && draft.allowedValues && draft.allowedValues.length > 0 && (
                        <p className="text-xs text-slate-500">{t('admin.allowed_values')} : {draft.allowedValues.join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!hasPatientCode && <p className="mt-3 text-xs text-red-600">{t('import.need_code')}</p>}
            {dups.length > 0 && <p className="mt-2 text-xs text-red-600">{t('import.dup_target')}</p>}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm">
              <span className="text-slate-700">{t('import.status')}</span>
              <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`encstatus.${s}`)}</option>)}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-slate-700">{t('import.conflict')}</span>
              <select className="input mt-1" value={conflict} onChange={(e) => setConflict(e.target.value as typeof conflict)}>
                {CONFLICTS.map((c) => <option key={c} value={c}>{t(`import.conflict_${c}`)}</option>)}
              </select>
            </label>
            <button onClick={() => void run(true)} disabled={busy || !canRun} className="btn-secondary">{t('import.preview')}</button>
            <button onClick={() => void run(false)} disabled={busy || !canRun || !report || committed} className="btn-primary">{t('import.commit')}</button>
          </div>
          {progress && (
            <p className="text-xs text-slate-500">{t('import.progress').replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}</p>
          )}
        </>
      )}

      {report && (
        <div className="card space-y-2 p-4 text-sm">
          <p className="font-medium text-slate-700">{committed ? t('import.done') : t('import.preview_result')}</p>
          <ul className="text-slate-600">
            <li>{t('import.patients_new')} : <strong>{report.patients_new}</strong></li>
            <li>{t('import.patients_updated')} : <strong>{report.patients_updated}</strong></li>
            <li>{t('import.encounters')} : <strong>{report.encounters}</strong></li>
            {(report.already_imported ?? 0) > 0 && (
              <li className="text-slate-500">{t('import.already_imported')} : <strong>{report.already_imported}</strong></li>
            )}
            <li className={report.error_count > 0 ? 'text-red-600' : ''}>{t('import.errors')} : <strong>{report.error_count}</strong></li>
          </ul>
          {report.errors.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-red-100 bg-red-50 p-2 text-xs text-red-700">
              {report.errors.map((er, i) => (
                <div key={i}>{t('import.line')} {er.row}{er.patient_code ? ` (${er.patient_code})` : ''} : {er.message}</div>
              ))}
            </div>
          )}
          {!committed && warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <p className="font-medium">{t('import.duplicates_warning').replace('{n}', String(warnings.length))}</p>
              <p className="mt-0.5">{t('import.duplicates_hint')}</p>
              <div className="mt-1 max-h-32 overflow-auto">
                {warnings.map((w, i) => (
                  <div key={i}>{t('import.line')} {w.row} ({w.patientCode}) : {w.encounterType} · {w.encounterDate}</div>
                ))}
              </div>
            </div>
          )}
          {!committed && report.error_count === 0 && <p className="text-xs text-slate-500">{t('import.ready')}</p>}
          {committed && (
            <button onClick={() => navigate(`/bases/${baseId}`)} className="btn-secondary mt-1">{t('base.back_to_dashboard')}</button>
          )}
        </div>
      )}
    </section>
  );
}
