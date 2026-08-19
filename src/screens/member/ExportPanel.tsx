import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAuditRepository, useBaseRepository, useCohortRepository, useExportRepository } from '../../data/RepositoryProvider';
import type { EncounterScopeOption, ExportLogItem } from '../../data/exports';
import type { ObservationModel } from '../../data/bases';
import { formatDateTime } from '../../lib/formatDate';
import type { AggregationRule } from '../../domain/export';

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

// Export d'une cohorte FIGEE (cahier §9.2/§9.3). L'ecran ne pose que les questions dont la
// reponse n'est PAS deja connue : la forme des lignes decoule du modele d'observation de la
// base, verrouille des la premiere saisie, et seul le suivi longitudinal laisse un choix
// (une ligne par patient ou par rencontre). La generation, le hash et la conservation du
// fichier sont executes cote serveur par l'Edge Function `generate-export`.

// La cohorte dit deja QUELLES rencontres en font partie (`cohort_encounter_member`, rempli au
// figeage) : l'export les prend telles quelles au lieu de redemander une portee.
const ENCOUNTER_SCOPE: EncounterScopeOption = 'matching';

/** Forme des lignes imposee par le modele d'observation ; `null` = la question reste posee. */
function rowShapeOf(model: ObservationModel): 'patient' | 'encounter' | null {
  if (model === 'cross_sectional') return 'patient';
  if (model === 'event_registry') return 'encounter';
  return null;
}

export function ExportPanel() {
  const { id: baseId, cohortId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();
  const exportsRepo = useExportRepository();
  const cohorts = useCohortRepository();
  const audit = useAuditRepository();

  const [tvId, setTvId] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportLogItem[]>([]);
  const [observationModel, setObservationModel] = useState<ObservationModel>('longitudinal');
  // Choix offert au seul suivi longitudinal ; ailleurs la forme des lignes est deduite.
  const [chosenShape, setChosenShape] = useState<'encounter' | 'patient'>('encounter');
  const [rule, setRule] = useState<AggregationRule>('last');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [busy, setBusy] = useState(false);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));
  const imposedShape = rowShapeOf(observationModel);
  const mode = imposedShape ?? chosenShape;

  const load = useCallback(async () => {
    if (!baseId) return;
    try {
      const base = await bases.getBase(baseId);
      setTvId(base?.base.currentTemplateVersionId ?? null);
      setObservationModel(base?.base.observationModel ?? 'longitudinal');
      setHistory(cohortId ? await exportsRepo.listExports(cohortId) : await exportsRepo.listBaseExports(baseId));
    } catch (e) {
      setError(msg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, cohortId, bases, exportsRepo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    if (!baseId) return;
    setBusy(true);
    setDone(false);
    try {
      // Parcours principal (sans cohorte) : la population est figee A CET INSTANT, puis
      // exportee. Le figeage ne disparait pas -- il cesse d'etre une demarche. Le fichier
      // conserve reste rattache a une population datee, donc reproductible ; l'ecran des
      // cohortes (option avancee) montre ces instantanes sous leur date.
      const exportedCohortId = cohortId ?? (await cohorts.createSnapshot(
        baseId,
        t('export.auto_cohort_name').replace('{date}', formatDateTime(new Date().toISOString(), lang)),
        { conditions: [] },
        false,
      )).id;
      const item = await exportsRepo.recordExport({
        cohortId: exportedCohortId, baseId, templateVersions: tvId ? [tvId] : [], format,
        options: { mode, rule, scope: ENCOUNTER_SCOPE },
      });
      if (item.storedFilePath) {
        const url = await exportsRepo.getExportDownloadUrl(item.id, item.storedFilePath);
        if (url) downloadUrl(url, item.fileName ?? item.storedFilePath.split('/').pop() ?? `cohorte.${format}`);
      }
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
      downloadUrl(url, item.fileName ?? item.storedFilePath.split('/').pop() ?? `export.${item.format}`);
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
        <button
          onClick={() => navigate(cohortId ? `/bases/${baseId}/cohorts` : `/bases/${baseId}`)}
          className="text-sm font-medium text-slate-500 hover:text-teal-700"
        >
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{cohortId ? t('export.title_cohort') : t('export.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {cohortId ? t('export.subtitle_cohort') : t('export.subtitle')}
        </p>
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
        {imposedShape ? (
          // Le modele d'observation est verrouille des la premiere saisie : la forme des
          // lignes en decoule. On l'ANNONCE au lieu de la redemander -- l'utilisateur doit
          // savoir ce qu'il va recevoir, sans avoir a le choisir.
          <div className="flex flex-col">
            <span className="text-slate-700">{t('export.shape')}</span>
            <p className="mt-1 font-medium text-slate-800">
              {imposedShape === 'patient' ? t('export.shape_cross_sectional') : t('export.shape_event_registry')}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{t('export.shape_hint')}</p>
          </div>
        ) : (
          <label className="flex flex-col">
            <span className="text-slate-700">{t('export.mode')}</span>
            <select
              className="input mt-1"
              value={chosenShape}
              onChange={(e) => setChosenShape(e.target.value as 'encounter' | 'patient')}
            >
              <option value="encounter">{t('export.mode_encounter')}</option>
              <option value="patient">{t('export.mode_patient')}</option>
            </select>
          </label>
        )}
        {!imposedShape && mode === 'patient' && (
          <label className="flex flex-col">
            <span className="text-slate-700">{t('export.rule')}</span>
            <select className="input mt-1" value={rule} onChange={(e) => setRule(e.target.value as AggregationRule)}>
              <option value="first">{t('export.rule_first')}</option>
              <option value="last">{t('export.rule_last')}</option>
            </select>
          </label>
        )}
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

      {/* La selection de population et le figeage restent disponibles -- une porte, plus une
          etape obligatoire. Ceux qui en ont besoin savent qu'ils en ont besoin. */}
      {!cohortId && (
        <p className="text-sm text-slate-500">
          {t('export.advanced_intro')}{' '}
          <button
            type="button"
            onClick={() => navigate(`/bases/${baseId}/cohorts`)}
            className="font-medium text-teal-700 underline decoration-teal-200 underline-offset-4 hover:text-teal-800"
          >
            {t('export.advanced_link')}
          </button>
        </p>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('export.history')}</h2>
        {history.length === 0 ? (
          <p className="text-slate-500 text-sm">{t('export.no_exports')}</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {history.map((h) => (
              <li key={h.id} className="card flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {formatDateTime(h.exportedAt, lang)} · {h.format.toUpperCase()} · {h.patientCount}p / {h.encounterCount}r ·{' '}
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
