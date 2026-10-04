import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAuditRepository, useBaseRepository, useCohortRepository, useExportRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { EncounterScopeOption, ExportLogItem, ExportProfile } from '../../data/exports';
import type { ObservationModel } from '../../data/bases';
import type { TemplateSection } from '../../data/types';
import { formatDateTime } from '../../lib/formatDate';
import { sectionLabel } from '../../domain/templateSections';
import type { AggregationRule, SectionProjectionMode } from '../../domain/export';
import { HelpTip } from '../../components/HelpTip';
import { exportDiagnosisCategories, type ExportDiagnosisCategory } from '../../domain/exportCategories';

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

/**
 * Audit UI mobile, lot 4 (5.8-A) : l'aide d'un reglage passe derriere un ⓘ sur telephone ;
 * sur ordinateur, elle reste lisible sous le champ (`FieldHint`), qui la decrit aussi.
 */
function FieldHelp({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useI18n();
  return <HelpTip label={t('help.field').replace('{label}', label)} className="-my-2.5 sm:hidden">{children}</HelpTip>;
}

function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return <span id={id} className="mt-0.5 hidden text-xs text-slate-500 sm:block">{children}</span>;
}

/** Recherche sans accents ni casse, sur le libelle ou la cle. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function matches(query: string, ...candidates: string[]): boolean {
  const q = normalize(query.trim());
  return q === '' || candidates.some((c) => normalize(c).includes(q));
}

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
  const templates = useTemplateRepository();
  const uid = useId();

  const [tvId, setTvId] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportLogItem[]>([]);
  const [observationModel, setObservationModel] = useState<ObservationModel>('longitudinal');
  // Choix offert au seul suivi longitudinal ; ailleurs la forme des lignes est deduite.
  const [chosenShape, setChosenShape] = useState<'encounter' | 'patient'>('encounter');
  const [rule, setRule] = useState<AggregationRule>('last');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [profile, setProfile] = useState<ExportProfile>('analysis');
  // L53 : projection de COLONNES par bloc. Les blocs proposes sont les sections RACINES de la
  // version courante ; les sous-sections ne se choisissent pas, elles suivent leur bloc.
  const [blocks, setBlocks] = useState<TemplateSection[]>([]);
  const [projectionMode, setProjectionMode] = useState<SectionProjectionMode>('all');
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  // Avec des dizaines de blocs, la liste brute ne se parcourt plus : une categorie
  // diagnostique coche d'un coup les blocs qui lui sont associes et restreint la liste a eux.
  const [categories, setCategories] = useState<ExportDiagnosisCategory[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [blockQuery, setBlockQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // UX-15 : une generation reussie dont le telechargement echoue n'est pas un export rate.
  // Les deux echecs sont donc distincts, et celui d'une ligne reste sur sa ligne.
  const [generationFailed, setGenerationFailed] = useState(false);
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));
  const imposedShape = rowShapeOf(observationModel);
  const mode = imposedShape ?? chosenShape;
  // Blocs des categories cochees ; `null` = aucun filtre par categorie.
  const categoryBlocks = useMemo(() => {
    if (selectedCategories.length === 0) return null;
    return new Set(categories.filter((c) => selectedCategories.includes(c.code)).flatMap((c) => c.blockKeys));
  }, [categories, selectedCategories]);
  // Un bloc coche puis sorti du filtre n'est plus affiche : il ne part donc pas non plus.
  const exportedBlocks = categoryBlocks ? selectedBlocks.filter((key) => categoryBlocks.has(key)) : selectedBlocks;
  const projectionIncomplete = projectionMode === 'selected' && exportedBlocks.length === 0;
  const visibleCategories = categories.filter((c) => matches(categoryQuery, c.label, c.code));
  const visibleBlocks = blocks.filter((block) =>
    (!categoryBlocks || categoryBlocks.has(block.sectionKey))
    && matches(blockQuery, sectionLabel(t, block), block.sectionKey));

  const load = useCallback(async () => {
    if (!baseId) return;
    try {
      const base = await bases.getBase(baseId);
      const versionId = base?.base.currentTemplateVersionId ?? null;
      setTvId(versionId);
      setObservationModel(base?.base.observationModel ?? 'longitudinal');
      setHistory(cohortId ? await exportsRepo.listExports(cohortId) : await exportsRepo.listBaseExports(baseId));
      // Le choix des blocs est un CONFORT : si les sections ne se lisent pas, l'ecran garde
      // son export complet plutot que de se bloquer sur une option facultative.
      try {
        const sections = versionId && templates.getSections ? await templates.getSections(versionId) : [];
        setBlocks(sections.filter((s) => !s.parentSectionKey));
      } catch {
        setBlocks([]);
      }
      // Meme regle : sans associations lisibles, le choix bloc par bloc reste disponible.
      try {
        const detail = versionId ? await templates.getVersion(versionId) : null;
        setCategories(detail
          ? exportDiagnosisCategories(detail.version, detail.fields, detail.rules, detail.sections ?? [])
          : []);
      } catch {
        setCategories([]);
      }
    } catch (e) {
      setError(msg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, cohortId, bases, exportsRepo, templates]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleBlock(key: string) {
    setSelectedBlocks((current) => current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  }

  // Cocher une categorie coche ses blocs ; la decocher retire ceux qu'aucune autre
  // categorie encore cochee ne reclame. Les blocs restent ensuite decochables un par un.
  function toggleCategory(code: string) {
    const category = categories.find((c) => c.code === code);
    if (!category) return;
    if (selectedCategories.includes(code)) {
      const remaining = selectedCategories.filter((c) => c !== code);
      const kept = new Set(categories.filter((c) => remaining.includes(c.code)).flatMap((c) => c.blockKeys));
      setSelectedCategories(remaining);
      setSelectedBlocks((current) => current.filter((key) => kept.has(key) || !category.blockKeys.includes(key)));
    } else {
      setSelectedCategories([...selectedCategories, code]);
      setSelectedBlocks((current) => [...new Set([...current, ...category.blockKeys])]);
    }
  }

  function setVisibleBlocks(checked: boolean) {
    const keys = visibleBlocks.map((block) => block.sectionKey);
    setSelectedBlocks((current) => checked
      ? [...new Set([...current, ...keys])]
      : current.filter((key) => !keys.includes(key)));
  }

  async function run() {
    if (!baseId) return;
    // Le serveur refuse deja une projection vide ; l'ecran evite le detour.
    if (projectionIncomplete) {
      setError(t('export.projection_empty'));
      return;
    }
    setBusy(true);
    setDone(false);
    setGenerationFailed(false);
    setDownloadError(null);
    setError(null);
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
        profile,
        options: {
          mode,
          rule,
          scope: ENCOUNTER_SCOPE,
          // L53 : `all` est le defaut et reproduit exactement le comportement anterieur.
          sectionProjection: projectionMode === 'selected'
            ? { mode: 'selected', blockKeys: exportedBlocks }
            : { mode: 'all' },
        },
      });
      // Le fichier est deja conserve cote serveur : un echec de signature ou de navigation
      // n'annule pas l'export, il empeche seulement ce telechargement immediat.
      if (item.storedFilePath) {
        try {
          const url = await exportsRepo.getExportDownloadUrl(item.id, item.storedFilePath);
          if (!url) throw new Error(t('export.download_unavailable'));
          downloadUrl(url, item.fileName ?? item.storedFilePath.split('/').pop() ?? `cohorte.${format}`);
        } catch (downloadFailure) {
          setDownloadError({ id: item.id, message: msg(downloadFailure) });
        }
      }
      setDone(true);
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
      setGenerationFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // Un export ancien peut citer un bloc absent de la version courante : sa cle est alors
  // affichee telle quelle, sans pretendre connaitre un libelle qui n'existe plus.
  function projectionSummary(item: ExportLogItem): string {
    if (!item.projection) return t('export.history_projection_unknown');
    if (item.projection.mode === 'all') return t('export.history_projection_all');
    const labels = item.projection.blockKeys.map((key) => {
      const block = blocks.find((candidate) => candidate.sectionKey === key);
      return block ? sectionLabel(t, block) : key;
    });
    return t('export.history_projection_selected').replace('{blocks}', labels.join(', ') || '—');
  }

  async function downloadStoredExport(item: ExportLogItem) {
    if (!item.storedFilePath || downloadId) return;
    setDownloadId(item.id);
    setDownloadError(null);
    try {
      const url = await exportsRepo.getExportDownloadUrl(item.id, item.storedFilePath);
      if (!url) throw new Error(t('export.download_unavailable'));
      downloadUrl(url, item.fileName ?? item.storedFilePath.split('/').pop() ?? `export.${item.format}`);
      // §7.9 : en prod l'Edge a deja journalise AVANT de signer ; en local/demo (pas d'Edge),
      // trace best-effort via la RPC log_export_read (no-op cote client quand l'Edge est actif).
      void audit.logExportRead(item.id);
      setError(null);
    } catch (e) {
      // L'echec reste sur la ligne concernee : l'historique et les autres fichiers restent lisibles.
      setDownloadError({ id: item.id, message: msg(e) });
    } finally {
      setDownloadId(null);
    }
  }

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        {/* L'export de la base est un onglet : la barre d'onglets suffit a en sortir. Seul
            l'export d'une cohorte, en pleine page, garde son retour vers les cohortes. */}
        {cohortId && (
          <button
            onClick={() => navigate(`/bases/${baseId}/cohorts`)}
            className="mb-2 text-sm font-medium text-slate-500 hover:text-teal-700"
          >
            ← {t('admin.back')}
          </button>
        )}
        <h1 className="page-title">{cohortId ? t('export.title_cohort') : t('export.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {cohortId ? t('export.subtitle_cohort') : t('export.subtitle')}
        </p>
      </div>

      {done && (
        <div className="space-y-3">
          <p className="rounded-xl border border-teal-100 bg-teal-50 p-2.5 text-sm text-teal-800">
            {t('export.done')} {t('export.done_kept')}
          </p>
          {/* Proposition FACULTATIVE et explicite vers DocAssist (aucun transfert automatique
              de donnees : le medecin depose volontairement son fichier — synthese produit §12). */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm">
            <p className="font-medium text-indigo-900">✨ {t('docassist.cta_title')}</p>
            <p className="mt-1 text-indigo-800/90">{t('docassist.cta_body')}</p>
            <p className="mt-2 text-xs text-indigo-700/70">{t('docassist.cta_note')}</p>
          </div>
        </div>
      )}

      {/* Audit UI mobile, lot 0 — une colonne sur telephone : a deux colonnes sur 360 px, le
          profil etait tronque (« Analyse — pr »). Deux colonnes des `sm`, comme avant. */}
      <div className="card grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2">
        {imposedShape ? (
          // Le modele d'observation est verrouille des la premiere saisie : la forme des
          // lignes en decoule. On l'ANNONCE au lieu de la redemander -- l'utilisateur doit
          // savoir ce qu'il va recevoir, sans avoir a le choisir. Audit UI mobile, lot 4
          // (5.8-A) : une phrase, pas un champ, puisque ce n'est pas un choix.
          <div className="sm:col-span-2">
            <p className="flex items-center gap-1 text-slate-700">
              <span>
                {t('export.shape')} :{' '}
                <span className="font-medium text-slate-900">
                  {imposedShape === 'patient' ? t('export.shape_cross_sectional') : t('export.shape_event_registry')}
                </span>
              </span>
              <FieldHelp label={t('export.shape')}>{t('export.shape_hint')}</FieldHelp>
            </p>
            <FieldHint id={`${uid}-shape-hint`}>{t('export.shape_hint')}</FieldHint>
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
        {/* Le ⓘ est un bouton : il se place a cote du libelle, jamais dans le <label>. */}
        <div className="flex flex-col">
          <span className="flex items-center gap-1">
            <label htmlFor={`${uid}-profile`} className="text-slate-700">{t('export.profile')}</label>
            <FieldHelp label={t('export.profile')}>{t('export.profile_hint')}</FieldHelp>
          </span>
          <select id={`${uid}-profile`} aria-describedby={`${uid}-profile-hint`} className="input mt-1" value={profile}
            onChange={(e) => setProfile(e.target.value as ExportProfile)}>
            <option value="analysis">{t('export.profile_analysis')}</option>
            <option value="complete">{t('export.profile_complete')}</option>
          </select>
          <FieldHint id={`${uid}-profile-hint`}>{t('export.profile_hint')}</FieldHint>
        </div>
      </div>

      {/* L53 : projection de COLONNES. Elle ne touche jamais la population, et les variables
          du tronc commun restent presentes dans toutes les projections. */}
      {blocks.length > 0 && (
        <div className="card space-y-3 p-4 text-sm">
          <div className="flex flex-col">
            <span className="flex items-center gap-1">
              <label htmlFor={`${uid}-projection`} className="text-slate-700">{t('export.projection')}</label>
              <FieldHelp label={t('export.projection')}>{t('export.projection_hint')}</FieldHelp>
            </span>
            <select
              id={`${uid}-projection`}
              aria-describedby={`${uid}-projection-hint`}
              className="input mt-1"
              value={projectionMode}
              onChange={(e) => setProjectionMode(e.target.value as SectionProjectionMode)}
            >
              <option value="all">{t('export.projection_all')}</option>
              <option value="selected">{t('export.projection_selected')}</option>
            </select>
            <FieldHint id={`${uid}-projection-hint`}>{t('export.projection_hint')}</FieldHint>
          </div>
          {projectionMode === 'selected' && categories.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-slate-700">{t('export.categories')}</legend>
              <p className="text-xs text-slate-500">{t('export.categories_hint')}</p>
              {categories.length > 8 && (
                <input
                  type="search"
                  className="input"
                  aria-label={t('export.categories_search')}
                  placeholder={t('export.categories_search')}
                  value={categoryQuery}
                  onChange={(e) => setCategoryQuery(e.target.value)}
                />
              )}
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {visibleCategories.map((category) => (
                  <li key={category.code}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(category.code)}
                        onChange={() => toggleCategory(category.code)}
                      />
                      <span>{category.label}</span>
                      <span className="text-xs text-slate-400">
                        {t('export.categories_blocks').replace('{n}', String(category.blockKeys.length))}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {projectionMode === 'selected' && (
            <fieldset className="space-y-2">
              <legend className="sr-only">{t('export.projection')}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-600">
                  {t('export.blocks_selected').replace('{n}', String(exportedBlocks.length))}
                  {categoryBlocks && ` · ${t('export.blocks_filtered')}`}
                </p>
                <span className="flex gap-3 text-xs">
                  <button type="button" className="font-medium text-teal-700 hover:underline" onClick={() => setVisibleBlocks(true)}>
                    {t('export.blocks_check_all')}
                  </button>
                  <button type="button" className="font-medium text-teal-700 hover:underline" onClick={() => setVisibleBlocks(false)}>
                    {t('export.blocks_uncheck_all')}
                  </button>
                </span>
              </div>
              {blocks.length > 8 && (
                <input
                  type="search"
                  className="input"
                  aria-label={t('export.blocks_search')}
                  placeholder={t('export.blocks_search')}
                  value={blockQuery}
                  onChange={(e) => setBlockQuery(e.target.value)}
                />
              )}
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {visibleBlocks.map((block) => (
                  <li key={block.sectionKey}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedBlocks.includes(block.sectionKey)}
                        onChange={() => toggleBlock(block.sectionKey)}
                      />
                      <span>{sectionLabel(t, block)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">{t('export.projection_subsections')}</p>
              <p className="text-xs text-slate-500">{t('export.projection_always')}</p>
              {projectionIncomplete && <p className="text-xs text-amber-700">{t('export.projection_empty')}</p>}
            </fieldset>
          )}
        </div>
      )}

      {/* L'etat d'execution, le refus et la reprise vivent A COTE de l'action : une attente
          longue ne doit pas obliger a remonter en haut de page pour savoir ou elle en est.
          Aucun pourcentage n'est affiche : le serveur n'en fournit aucun. */}
      <div className="space-y-2">
        <button onClick={() => void run()} disabled={busy || projectionIncomplete} aria-busy={busy || undefined} className={`btn-primary${busy ? ' btn-pending' : ''}`}>
          {busy ? t('export.generating') : t('export.run')}
        </button>
        {busy && <p role="status" className="text-sm text-slate-600">{t('export.generating_hint')}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{generationFailed ? `${t('export.failed')} ${error}` : error}</p>}
        {generationFailed && !busy && (
          <button type="button" onClick={() => void run()} className="btn-secondary">{t('export.retry')}</button>
        )}
      </div>

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
              <li key={h.id} className="card space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    {formatDateTime(h.exportedAt, lang)} · {h.format.toUpperCase()}
                  </span>
                  {h.storedFilePath && (
                    <button
                      type="button"
                      onClick={() => void downloadStoredExport(h)}
                      disabled={downloadId === h.id}
                      className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline disabled:opacity-50"
                    >
                      {downloadId === h.id ? t('export.download_preparing') : t('export.download')}
                    </button>
                  )}
                </div>
                <p className="text-slate-600">
                  {t('export.history_population')
                    .replace('{patients}', String(h.patientCount ?? 0))
                    .replace('{encounters}', String(h.encounterCount ?? 0))}
                  {h.rowShape && ` · ${t(h.rowShape === 'patient' ? 'export.history_shape_patient' : 'export.history_shape_encounter')}`}
                  {' · '}
                  {h.profile === 'analysis'
                    ? t('export.profile_analysis')
                    : h.profile === 'complete'
                      ? t('export.profile_complete')
                      : t('export.profile_legacy')}
                </p>
                <p className="text-slate-500">{projectionSummary(h)}</p>
                {h.excluded && (
                  <p className="text-amber-700">
                    {t('export.history_excluded')
                      .replace('{patients}', String(h.excluded.patients))
                      .replace('{encounters}', String(h.excluded.encounters))}
                  </p>
                )}
                {downloadError?.id === h.id && (
                  <p role="alert" className="text-red-600">
                    {t('export.download_failed').replace('{reason}', downloadError.message)}
                  </p>
                )}
                {/* Details techniques : accessibles, mais jamais au premier plan. Audit UI mobile,
                    lot 4 : l'empreinte (64 caracteres sans espace) revient a la ligne au lieu
                    d'elargir la page. */}
                <details className="min-w-0 text-slate-400">
                  <summary className="cursor-pointer">{t('export.history_details')}</summary>
                  <p className="mt-1">{t('export.history_hash')} : <span className="break-all font-mono">{h.fileHash ?? '—'}</span></p>
                  <p>{t('export.history_id')} : <span className="break-all font-mono">{h.id}</span></p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
