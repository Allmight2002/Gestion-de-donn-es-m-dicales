import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import { getTemplateFields } from '../../data/templates';
import type { TemplateField } from '../../data/types';
import {
  autoMapColumns, buildImportRows, duplicateTargets, type ColumnMapping, type ImportReport, type ImportTarget,
} from '../../domain/import';
import { parseSpreadsheetOffThread } from '../../domain/spreadsheet';
import type { ImportDuplicateWarning } from '../../data/patients';

const STATUSES = ['draft', 'complete', 'curated'] as const;
const CONFLICTS = ['fill', 'overwrite', 'skip'] as const;
const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 15 * 1024 * 1024; // §5.3 : borne de TAILLE avant lecture (anti fichier hostile)
const CHUNK = 300; // taille des lots (au-dela, import par lots avec progression)

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
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

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
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
      setHeaders(head);
      setRawRows(rows);
      // La correspondance est (re)calculee par un effet sur [headers, fields] -> robuste si les
      // champs du gabarit arrivent APRES le depot du fichier.
    } catch (err) {
      setError(msg(err));
    }
  }

  // Correspondance auto-recalculee quand un fichier est chargé ou que les champs arrivent.
  useEffect(() => {
    setMapping(headers.length > 0 ? autoMapColumns(headers, fields) : {});
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
                <div key={i} className="flex items-center gap-3 text-sm">
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
