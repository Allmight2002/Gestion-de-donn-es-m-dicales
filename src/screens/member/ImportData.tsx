import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CheckCircle2, Columns3, FileSpreadsheet, Settings2, ShieldAlert, Upload } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import { getTemplateFields } from '../../data/templates';
import type { FieldScope, FieldSection, FieldType, TemplateField } from '../../data/types';
import {
  autoMapColumns, buildImportRows, duplicateTargets, findInFileEncounterDuplicates,
  type ColumnMapping, type ImportReport, type ImportTarget,
} from '../../domain/import';
import { parseSpreadsheetOffThread } from '../../domain/spreadsheet';
import { normalizeKey, proposeFieldsFromSheet } from '../../domain/templateFromSheet';
import type { ImportDuplicateWarning } from '../../data/patients';
import { useToast } from '../../components/Toast';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { WorkflowSteps } from '../../components/WorkflowSteps';

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
  const runInFlight = useRef(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
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
  const inFileDuplicates = useMemo(() => findInFileEncounterDuplicates(rows), [rows]);
  const hasPatientCode = Object.values(mapping).includes('patient_code');
  const dups = useMemo(() => duplicateTargets(mapping), [mapping]);
  const canRun = hasPatientCode && dups.length === 0;

  async function run(dryRun: boolean) {
    if (!baseId || runInFlight.current) return;
    runInFlight.current = true;
    setBusy(true); setError(null);
    try {
      const includeGlobalDuplicateErrors = (source: ImportReport): ImportReport => {
        if (!dryRun || inFileDuplicates.length === 0) return source;
        const alreadyReported = new Set(
          source.errors
            .filter((item) => /double dans le fichier/i.test(item.message))
            .map((item) => item.row),
        );
        const missing = inFileDuplicates.filter((item) => !alreadyReported.has(item.row));
        if (missing.length === 0) return source;
        return {
          ...source,
          error_count: source.error_count + missing.length,
          rejected: source.rejected === undefined ? undefined : source.rejected + missing.length,
          errors: [
            ...source.errors,
            ...missing.map((item) => ({
              row: item.row,
              patient_code: item.patientCode,
              message: `Rencontre en double dans le fichier (meme patient, date, type et donnees ; premiere ligne ${item.firstRow})`,
            })),
          ],
        };
      };
      // §7.6 : a l'apercu, signaler les rencontres ressemblant a des existantes (sans bloquer).
      // Resilient : si la RPC n'est pas encore deployee, on n'empeche pas l'apercu.
      if (dryRun) {
        try { setWarnings(await patients.detectImportDuplicates(baseId, rows)); } catch { setWarnings([]); }
      }
      if (rows.length <= CHUNK) {
        // Petit volume : un seul appel.
        const preview = await patients.importRecords(baseId, rows, { dryRun, status, conflict, fileHash, templateVersionId: versionId });
        setReport(includeGlobalDuplicateErrors(preview));
      } else {
        // §6.5 import par LOTS : ouverture du lot (idempotence + verrous) puis chunks + progression.
        const batchId = dryRun ? null : await patients.beginImportBatch(baseId, { status, conflict, fileHash, templateVersionId: versionId, expectedRows: rows.length });
        if (batchId) setActiveBatchId(batchId);
        let succeeded = new Set<number>();
        let serverRowCount = 0;
        let serverErrorCount = 0;
        if (batchId) {
          // Le navigateur peut perdre la reponse apres le commit: la reprise
          // repart de cet etat serveur, jamais d'un offset local suppose.
          const state = await patients.getImportBatchState(batchId);
          succeeded = new Set(state.succeeded_source_rows);
          serverRowCount = state.row_count;
          serverErrorCount = state.error_count;
          setProgress({ done: state.row_count, total: rows.length });
          if (state.resume_state === 'historical_unsafe') {
            setError(t('import.historical_cancel_required'));
            return;
          }
        }
        const agg: ImportReport = {
          dry_run: dryRun, status, conflict, patients_new: 0, patients_updated: 0,
          encounters: 0, error_count: serverErrorCount, already_imported: 0,
          newly_imported: 0, already_processed: succeeded.size, rejected: 0,
          server_row_count: serverRowCount, server_error_count: serverErrorCount, errors: [],
        };
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK).filter((row) => !succeeded.has(row.source_row_number ?? -1));
          if (chunk.length === 0) continue;
          const rep = await patients.importRecords(baseId, chunk, {
            dryRun, status, conflict, fileHash: null, templateVersionId: versionId, batchId,
          });
          agg.patients_new += rep.patients_new; agg.patients_updated += rep.patients_updated;
          agg.encounters += rep.encounters;
          agg.already_imported = (agg.already_imported ?? 0) + (rep.already_imported ?? 0); // §7.8
          agg.newly_imported = (agg.newly_imported ?? 0) + (rep.newly_imported ?? 0);
          agg.already_processed = (agg.already_processed ?? 0) + (rep.already_processed ?? 0);
          agg.rejected = (agg.rejected ?? 0) + (rep.rejected ?? rep.error_count);
          agg.errors.push(...rep.errors.map((er) => ({ ...er, row: er.row + i }))); // n° de ligne global
          if (batchId) {
            const state = await patients.getImportBatchState(batchId);
            succeeded = new Set(state.succeeded_source_rows);
            agg.error_count = state.error_count;
            agg.server_row_count = state.row_count;
            agg.server_error_count = state.error_count;
            setProgress({ done: state.row_count, total: rows.length });
          } else {
            agg.error_count += rep.error_count;
          }
        }
        // §6.2 : cloture du lot -> active l'idempotence du fichier. En cas d'erreur, le lot
        // reste 'processing' et peut etre REPRIS (re-lancer l'import reprend le meme lot).
        if (batchId) {
          await patients.completeImportBatch(batchId);
          const state = await patients.getImportBatchState(batchId);
          agg.error_count = state.error_count;
          agg.server_row_count = state.row_count;
          agg.server_error_count = state.error_count;
          setProgress({ done: state.row_count, total: rows.length });
          setActiveBatchId(null);
        }
        setReport(includeGlobalDuplicateErrors(agg));
      }
      if (!dryRun) setCommitted(true);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
      runInFlight.current = false;
    }
  }

  async function cancelActiveBatch() {
    if (!activeBatchId || busy) return;
    setBusy(true); setError(null);
    try {
      await patients.cancelImportBatch(activeBatchId);
      const state = await patients.getImportBatchState(activeBatchId);
      setProgress({ done: state.row_count, total: state.expected_rows ?? rows.length });
      setActiveBatchId(null);
      setReport(null);
      setCommitted(false);
      toast(t('import.cancelled'), 'success');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
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
    <section className="max-w-4xl space-y-6">
      <PageHeader title={t('import.title')} description={t('import.hint')} />

      <WorkflowSteps
        current={headers.length === 0 ? 1 : report ? 3 : 2}
        steps={[
          { label: t('import.step_file'), description: t('import.step_file_hint') },
          { label: t('import.step_mapping'), description: t('import.step_mapping_hint') },
          { label: t('import.step_review'), description: t('import.step_review_hint') },
        ]}
      />

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span>{t('import.fictional')}</span>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <SectionCard title={t('import.file_title')} description={t('import.file_hint')} icon={FileSpreadsheet}>
        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-6 text-center transition hover:border-teal-400 hover:bg-teal-50/40">
          <Upload className="mx-auto mb-2 text-slate-400" size={24} aria-hidden />
          <span className="block text-sm font-semibold text-slate-800">{t('import.file')}</span>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} className="mx-auto mt-3 block max-w-full text-sm text-slate-500" />
          {fileName && <span className="mt-3 block text-sm font-medium text-teal-700">{fileName} — {rawRows.length} {t('import.rows')}</span>}
        </label>
      </SectionCard>

      {headers.length > 0 && (
        <>
          <SectionCard title={`2. ${t('import.mapping')}`} description={t('import.mapping_hint')} icon={Columns3}>
            <div className="space-y-3">
              {headers.map((header, index) => (
                <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                  <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.4fr)_auto]">
                    <div className="min-w-0">
                      <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">{t('import.file')}</span>
                      <span className="block truncate font-mono text-sm text-slate-700" title={header || `(colonne ${index + 1})`}>
                        {header || <span className="italic text-slate-400">(colonne {index + 1})</span>}
                      </span>
                    </div>
                    <select className="input" value={mapping[index] ?? 'ignore'} onChange={(event) => setCol(index, event.target.value as ImportTarget)}>
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
                        {fields.filter((field) => field.scope === 'patient').map((field) => (
                          <option key={field.id} value={`patient:${field.fieldKey}`}>{field.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label={t('import.grp_encounter')}>
                        {fields.filter((field) => field.scope === 'encounter').map((field) => (
                          <option key={field.id} value={`encounter:${field.fieldKey}`}>{field.label}</option>
                        ))}
                      </optgroup>
                    </select>
                    {isOwner && (mapping[index] ?? 'ignore') === 'ignore' && header.trim() !== '' && draft?.col !== index ? (
                      <button type="button" onClick={() => startCreate(index)} className="btn-secondary whitespace-nowrap">
                        {t('import.create_var')}
                      </button>
                    ) : <span />}
                  </div>
                  {draft?.col === index && (
                    <div className="mt-3 space-y-3 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{t('import.create_var_title').replace('{col}', header.trim())}</p>
                        <p className="helper-text mt-1">{t('import.create_var_hint')}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="form-label">{t('admin.label')}<input className="input" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
                        <label className="form-label">{t('admin.type')}<select className="input" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as FieldType })}>{TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                        <label className="form-label">{t('admin.scope')}<select className="input" value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as FieldScope })}><option value="patient">{t('scope.patient')}</option><option value="encounter">{t('scope.encounter')}</option></select></label>
                        <label className="form-label">{t('admin.section')}<select className="input" value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value as FieldSection })}>{SECTIONS.map((section) => <option key={section} value={section}>{t(`section.${section}`)}</option>)}</select></label>
                      </div>
                      {(draft.type === 'select' || draft.type === 'multiselect') && draft.allowedValues && draft.allowedValues.length > 0 && (
                        <p className="helper-text">{t('admin.allowed_values')} : {draft.allowedValues.join(', ')}</p>
                      )}
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => setDraft(null)} disabled={draftBusy} className="btn-secondary">{t('common.cancel')}</button>
                        <button type="button" onClick={() => void createVariable()} disabled={draftBusy || draft.label.trim() === ''} className="btn-primary">{t('import.create_var')}</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!hasPatientCode && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t('import.need_code')}</p>}
            {dups.length > 0 && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t('import.dup_target')}</p>}
          </SectionCard>

          <SectionCard title={t('import.options_title')} description={t('import.options_hint')} icon={Settings2}>
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="form-label">{t('import.status')}<select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>{STATUSES.map((item) => <option key={item} value={item}>{t(`encstatus.${item}`)}</option>)}</select></label>
                <label className="form-label">{t('import.conflict')}<select className="input" value={conflict} onChange={(event) => setConflict(event.target.value as typeof conflict)}>{CONFLICTS.map((item) => <option key={item} value={item}>{t(`import.conflict_${item}`)}</option>)}</select></label>
              </div>
              {progress && <p className="helper-text">{t('import.progress').replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}</p>}
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
                {activeBatchId && !committed && (
                  <button type="button" onClick={() => void cancelActiveBatch()} disabled={busy} className="btn-secondary mr-auto text-red-700">{t('import.cancel_batch')}</button>
                )}
                <button onClick={() => void run(true)} disabled={busy || !canRun} className="btn-secondary">{t('import.preview')}</button>
                <button onClick={() => void run(false)} disabled={busy || !canRun || !report || committed} className="btn-primary">{t('import.commit')}</button>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {report && (
        <SectionCard title={committed ? t('import.done') : t('import.preview_result')} icon={CheckCircle2}>
          <div className="space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="surface-muted p-3"><dt className="text-xs text-slate-500">{t('import.patients_new')}</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{report.patients_new}</dd></div>
              <div className="surface-muted p-3"><dt className="text-xs text-slate-500">{t('import.patients_updated')}</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{report.patients_updated}</dd></div>
              <div className="surface-muted p-3"><dt className="text-xs text-slate-500">{t('import.encounters')}</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{report.encounters}</dd></div>
              <div className={`rounded-xl border p-3 ${report.error_count > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50/70'}`}><dt className="text-xs text-slate-500">{t('import.errors')}</dt><dd className={`mt-1 text-xl font-semibold ${report.error_count > 0 ? 'text-red-700' : 'text-slate-900'}`}>{report.error_count}</dd></div>
            </dl>
            <ul className="space-y-1 text-slate-600">
              {(report.already_imported ?? 0) > 0 && <li>{t('import.already_imported')} : <strong>{report.already_imported}</strong></li>}
              {report.newly_imported !== undefined && <li>{t('import.newly_imported')} : <strong>{report.newly_imported}</strong></li>}
              {report.already_processed !== undefined && <li>{t('import.already_processed')} : <strong>{report.already_processed}</strong></li>}
              {report.rejected !== undefined && <li className={report.rejected > 0 ? 'text-red-600' : ''}>{t('import.rejected_current')} : <strong>{report.rejected}</strong></li>}
              {report.server_row_count !== undefined && <li>{t('import.server_state').replace('{processed}', String(report.server_row_count)).replace('{rejected}', String(report.server_error_count ?? report.error_count))}</li>}
            </ul>
            {report.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">
                {report.errors.map((item, index) => <div key={index}>{t('import.line')} {item.row}{item.patient_code ? ` (${item.patient_code})` : ''} : {item.message}</div>)}
              </div>
            )}
            {!committed && warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-medium">{t('import.duplicates_warning').replace('{n}', String(warnings.length))}</p>
                <p className="mt-1">{t('import.duplicates_hint')}</p>
                <div className="mt-2 max-h-32 overflow-auto">{warnings.map((warning, index) => <div key={index}>{t('import.line')} {warning.row} ({warning.patientCode}) : {warning.encounterType} · {warning.encounterDate}</div>)}</div>
              </div>
            )}
            {!committed && report.error_count === 0 && <p className="text-sm text-teal-700">{t('import.ready')}</p>}
            {committed && <button onClick={() => navigate(`/bases/${baseId}`)} className="btn-secondary">{t('base.back_to_dashboard')}</button>}
          </div>
        </SectionCard>
      )}
    </section>
  );
}
