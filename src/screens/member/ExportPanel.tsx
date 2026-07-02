import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useAuditRepository, useBaseRepository, useExportRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { EncounterScopeOption, ExportLogItem } from '../../data/exports';
import { getTemplateFields } from '../../data/templates';
import {
  buildDictionary, buildEncounterExport, buildPatientExport, toCsv, assertNoIdentity,
  type AggregationRule, type ExportField, type ExportTable,
} from '../../domain/export';

function download(content: Blob, filename: string) {
  try {
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    /* environnement sans createObjectURL (tests) */
  }
}

function downloadUrl(url: string, filename: string) {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.click();
  } catch {
    /* environnement de test sans navigation */
  }
}

// xlsx est charge a la DEMANDE (import dynamique) : ~400 Ko hors du bundle initial.
async function xlsxBlob(main: ExportTable, dict: ExportTable): Promise<Blob> {
  assertNoIdentity(main.columns);
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(main.rows, { header: main.columns }), 'Export');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dict.rows, { header: dict.columns }), 'Dictionnaire');
  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Export d'une cohorte FIGEE (cahier §9.2/§9.3). Choix EXPLICITES : mode, regle
// d'agregation, portee des rencontres, format. Genere le fichier + le dictionnaire,
// et conserve le fichier immuable (file_hash + export_log).
export function ExportPanel() {
  const { id: baseId, cohortId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const exportsRepo = useExportRepository();
  const audit = useAuditRepository();

  const [fields, setFields] = useState<ExportField[]>([]);
  const [tvId, setTvId] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportLogItem[]>([]);
  const [mode, setMode] = useState<'encounter' | 'patient'>('encounter');
  const [rule, setRule] = useState<AggregationRule>('last');
  const [scope, setScope] = useState<EncounterScopeOption>('matching');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [busy, setBusy] = useState(false);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const load = useCallback(async () => {
    if (!baseId || !cohortId) return;
    try {
      const base = await bases.getBase(baseId);
      setTvId(base?.base.currentTemplateVersionId ?? null);
      if (base?.base.currentTemplateVersionId) {
        setFields(
          (await getTemplateFields(templates, base.base.currentTemplateVersionId))
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((f) => ({ fieldKey: f.fieldKey, label: f.label, scope: f.scope, section: f.section, type: f.type, unit: f.unit, allowedValues: f.allowedValues })),
        );
      }
      setHistory(await exportsRepo.listExports(cohortId));
    } catch (e) {
      setError(msg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, cohortId, bases, templates, exportsRepo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    if (!baseId || !cohortId) return;
    setBusy(true);
    setDone(false);
    try {
      const data = await exportsRepo.getSnapshotData(cohortId, scope);
      const main = mode === 'patient'
        ? buildPatientExport(data.patients, data.encounters, fields, rule)
        : buildEncounterExport(data.encounters, fields);
      const dict = buildDictionary(fields);
      assertNoIdentity(main.columns); // verification automatique : aucune identite

      const ext = format;
      const content = format === 'csv' ? new Blob([toCsv(main)], { type: 'text/csv;charset=utf-8' }) : await xlsxBlob(main, dict);

      await exportsRepo.recordExport({
        cohortId, baseId, templateVersions: tvId ? [tvId] : [], format, ext,
        options: { mode, rule, scope },
        content,
        patientCount: data.patients.length,
        encounterCount: data.encounters.length,
      });
      download(content, `cohorte.${ext}`);
      if (format === 'csv') download(new Blob([toCsv(dict)], { type: 'text/csv;charset=utf-8' }), 'dictionnaire.csv');
      setDone(true);
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadStoredExport(item: ExportLogItem) {
    if (!item.storedFilePath) return;
    setDownloadId(item.id);
    try {
      const url = await exportsRepo.getExportDownloadUrl(item.id, item.storedFilePath);
      if (!url) throw new Error(t('export.download_unavailable'));
      downloadUrl(url, item.storedFilePath.split('/').pop() ?? `export.${item.format}`);
      // §7.9 : en prod l'Edge a deja journalise AVANT de signer ; en local/demo (pas d'Edge),
      // trace best-effort via la RPC log_export_read (no-op cote client quand l'Edge est actif).
      void audit.logExportRead(item.id);
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setDownloadId(null);
    }
  }

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}/cohorts`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('export.title')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {done && (
        <div className="space-y-3">
          <p className="rounded-xl border border-teal-100 bg-teal-50 p-2.5 text-sm text-teal-800">{t('export.done')}</p>
          {/* Proposition FACULTATIVE et explicite vers DocAssist (aucun transfert automatique
              de donnees : le medecin depose volontairement son fichier — synthese produit §12). */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm">
            <p className="font-medium text-indigo-900">✨ {t('docassist.cta_title')}</p>
            <p className="mt-1 text-indigo-800/90">{t('docassist.cta_body')}</p>
            <p className="mt-2 text-xs text-indigo-700/70">{t('docassist.cta_note')}</p>
          </div>
        </div>
      )}

      <div className="card grid grid-cols-2 gap-4 p-4 text-sm">
        <label className="flex flex-col">
          <span className="text-slate-700">{t('export.mode')}</span>
          <select className="input mt-1" value={mode} onChange={(e) => setMode(e.target.value as 'encounter' | 'patient')}>
            <option value="encounter">{t('export.mode_encounter')}</option>
            <option value="patient">{t('export.mode_patient')}</option>
          </select>
        </label>
        {mode === 'patient' && (
          <label className="flex flex-col">
            <span className="text-slate-700">{t('export.rule')}</span>
            <select className="input mt-1" value={rule} onChange={(e) => setRule(e.target.value as AggregationRule)}>
              <option value="first">{t('export.rule_first')}</option>
              <option value="last">{t('export.rule_last')}</option>
            </select>
          </label>
        )}
        <label className="flex flex-col">
          <span className="text-slate-700">{t('export.scope')}</span>
          <select className="input mt-1" value={scope} onChange={(e) => setScope(e.target.value as EncounterScopeOption)}>
            <option value="matching">{t('export.scope_matching')}</option>
            <option value="all">{t('export.scope_all')}</option>
            <option value="both">{t('export.scope_both')}</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-slate-700">{t('export.format')}</span>
          <select className="input mt-1" value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx')}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </select>
        </label>
      </div>

      <button onClick={() => void run()} disabled={busy} className="btn-primary">
        {t('export.run')}
      </button>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('export.history')}</h2>
        {history.length === 0 ? (
          <p className="text-slate-500 text-sm">{t('export.no_exports')}</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {history.map((h) => (
              <li key={h.id} className="card flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {h.exportedAt} · {h.format.toUpperCase()} · {h.patientCount}p / {h.encounterCount}r ·{' '}
                  <span className="font-mono text-slate-400">{h.fileHash?.slice(0, 12)}…</span>
                </span>
                {h.storedFilePath && (
                  <button
                    type="button"
                    onClick={() => void downloadStoredExport(h)}
                    disabled={downloadId === h.id}
                    className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline disabled:opacity-50"
                  >
                    {t('export.download')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
