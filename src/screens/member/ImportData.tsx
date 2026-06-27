import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField } from '../../data/types';
import {
  autoMapColumns, buildImportRows, type ColumnMapping, type ImportReport, type ImportTarget,
} from '../../domain/import';

const STATUSES = ['draft', 'complete', 'curated'] as const;

// Importation par lots (CSV / XLSX) : 1 ligne = 1 rencontre, colonnes patient repetees.
// Correspondance colonnes -> champs, APERCU (dry-run, aucune ecriture), puis import.
export function ImportData() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [status, setStatus] = useState<string>('draft');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  const load = useCallback(async () => {
    if (!baseId) return;
    try {
      const base = await bases.getBase(baseId);
      if (base?.base.currentTemplateVersionId) {
        const v = await templates.getVersion(base.base.currentTemplateVersionId);
        setFields(v.fields);
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
    setError(null); setReport(null); setCommitted(false);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
      const head = (aoa[0] ?? []).map((h) => String(h).trim()).filter((h) => h !== '');
      const rows = aoa.slice(1)
        .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
        .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
      setFileName(file.name);
      setHeaders(head);
      setRawRows(rows);
      setMapping(autoMapColumns(head, fields));
    } catch (err) {
      setError(msg(err));
    }
  }

  const rows = useMemo(() => buildImportRows(rawRows, mapping), [rawRows, mapping]);
  const hasPatientCode = Object.values(mapping).includes('patient_code');

  async function run(dryRun: boolean) {
    if (!baseId) return;
    setBusy(true); setError(null);
    try {
      const rep = await patients.importRecords(baseId, rows, dryRun, status);
      setReport(rep);
      if (!dryRun) setCommitted(true);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  const setCol = (col: string, target: ImportTarget) => setMapping((m) => ({ ...m, [col]: target }));

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
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3 text-sm">
                  <span className="w-1/3 truncate font-mono text-xs text-slate-600" title={h}>{h}</span>
                  <select className="input flex-1" value={mapping[h] ?? 'ignore'} onChange={(e) => setCol(h, e.target.value as ImportTarget)}>
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
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm">
              <span className="text-slate-700">{t('import.status')}</span>
              <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`encstatus.${s}`)}</option>)}
              </select>
            </label>
            <button onClick={() => void run(true)} disabled={busy || !hasPatientCode} className="btn-secondary">{t('import.preview')}</button>
            <button onClick={() => void run(false)} disabled={busy || !hasPatientCode || !report || committed} className="btn-primary">{t('import.commit')}</button>
          </div>
        </>
      )}

      {report && (
        <div className="card space-y-2 p-4 text-sm">
          <p className="font-medium text-slate-700">
            {committed ? t('import.done') : t('import.preview_result')}
          </p>
          <ul className="text-slate-600">
            <li>{t('import.patients_new')} : <strong>{report.patients_new}</strong></li>
            <li>{t('import.patients_updated')} : <strong>{report.patients_updated}</strong></li>
            <li>{t('import.encounters')} : <strong>{report.encounters}</strong></li>
            <li className={report.error_count > 0 ? 'text-red-600' : ''}>{t('import.errors')} : <strong>{report.error_count}</strong></li>
          </ul>
          {report.errors.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-red-100 bg-red-50 p-2 text-xs text-red-700">
              {report.errors.map((er, i) => (
                <div key={i}>{t('import.line')} {er.row}{er.patient_code ? ` (${er.patient_code})` : ''} : {er.message}</div>
              ))}
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
