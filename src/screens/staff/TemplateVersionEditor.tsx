import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, Search, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { MessageKey } from '../../i18n/messages';
import type { NewField, TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
import type { ObservationModel } from '../../data/bases';
import { FieldForm } from './FieldForm';
import { fieldOptions } from '../../domain/fieldOptions';
import { sectionLabel } from '../../domain/templateSections';
import { fieldTypeLabel } from '../../domain/templateLabels';
import { FormPreview } from './FormPreview';
import { RuleForm, RuleSummary, ruleHasSeverity } from './RuleForm';
import { RuleBatchPanel, isBatchSource } from './RuleBatchPanel';
import { DiagnosisConfigurationEditor } from './DiagnosisConfigurationEditor';
import { SectionsEditor } from './SectionsEditor';
import { SectionImportDialog } from './SectionImportDialog';
import { CommonLayoutEditor } from './CommonLayoutEditor';
import { SkeletonList } from '../../components/Skeleton';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface Loaded {
  version: TemplateVersion;
  fields: TemplateField[];
  rules: ValidationRule[];
  sections: TemplateSection[];
}

const FIELD_TYPES: TemplateField['type'][] = ['text', 'integer', 'number', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'terminology'];
const FIELD_SCOPES: TemplateField['scope'][] = ['patient', 'encounter'];

/** Comparaison de consultation : accents et casse ignores, nombres compares comme des nombres. */
const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

type EditorSpace = 'variables' | 'sections' | 'rules';
const EDITOR_SPACES: EditorSpace[] = ['variables', 'sections', 'rules'];
type DisplaySort = 'form' | 'label' | 'key' | 'section' | 'type' | 'scope';
const DISPLAY_SORTS: DisplaySort[] = ['form', 'label', 'key', 'section', 'type', 'scope'];
const SORT_LABEL_KEYS: Record<DisplaySort, MessageKey> = {
  form: 'admin.sort_form', label: 'admin.sort_label', key: 'admin.sort_key',
  section: 'admin.sort_section', type: 'admin.sort_type', scope: 'admin.sort_scope',
};
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';
const SAVE_STATE_KEYS: Record<SaveState, MessageKey> = {
  idle: 'admin.state_idle', dirty: 'admin.state_dirty', saving: 'admin.state_saving',
  saved: 'admin.state_saved', failed: 'admin.state_failed',
};
/** Valeur du filtre de section designant les variables sans section (tronc commun). */
const COMMON_SECTION_FILTER = '__common__';
/** Au-dela de ce nombre de variables, les blocs s'ouvrent a la demande (UX-14(a)). */
const LARGE_MODEL_FIELDS = 60;

/** Cles de variables et de blocs citees par une regle, quelle que soit sa forme. */
function ruleParticipants(rule: unknown): { fields: string[]; sections: string[]; kind: string } {
  const value = rule as {
    left_field?: unknown; right_field?: unknown;
    if?: { field?: unknown }; then?: { field?: unknown; section?: unknown; operator?: unknown };
  };
  const fields: string[] = [];
  const sections: string[] = [];
  if (typeof value?.left_field === 'string') fields.push(value.left_field);
  if (typeof value?.right_field === 'string') fields.push(value.right_field);
  if (typeof value?.if?.field === 'string') fields.push(value.if.field);
  if (typeof value?.then?.field === 'string') fields.push(value.then.field);
  if (typeof value?.then?.section === 'string') sections.push(value.then.section);
  const kind = 'operator' in (value ?? {}) && typeof value?.left_field === 'string'
    ? 'comparison'
    : value?.then?.operator === 'visible' ? 'visibility' : 'conditional';
  return { fields, sections, kind };
}

export function TemplateVersionEditor({
  versionId,
  onBack,
  showVersionActions = true,
  onNewVersion,
  observationModel,
  templateName,
}: {
  versionId: string;
  onBack: () => void;
  showVersionActions?: boolean;
  // §8.2 : permet au medecin de creer la version SUIVANTE de son gabarit (copie editable).
  onNewVersion?: (newVersionId: string) => void | Promise<void>;
  observationModel?: ObservationModel;
  /** Contexte lisible transmis par la carte ou la base qui a ouvert l’éditeur. */
  templateName?: string;
}) {
  const repo = useTemplateRepository();
  const { t } = useI18n();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateField | null>(null);
  const [fieldFormOpen, setFieldFormOpen] = useState<'add' | 'edit' | null>(null);
  const [editingRule, setEditingRule] = useState<ValidationRule | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false); // L29 : apercu du formulaire
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const sectionsInitialized = useRef<string | null>(null);
  // L59 : import d'un bloc reutilisable. `activationSection` porte le bloc qui vient
  // d'arriver jusqu'au constructeur de regles — c'est le point d'entree de L60, et rien
  // de plus : aucune regle n'est creee ici, aucun pilote n'est devine.
  const [importOpen, setImportOpen] = useState(false);
  const [activationSection, setActivationSection] = useState<string | null>(null);
  const rulesRef = useRef<HTMLDivElement | null>(null);
  const ruleFormRef = useRef<HTMLDivElement | null>(null);
  // UX-14(a) : trois espaces de travail. Ils ne font que CHANGER CE QUI EST AFFICHE — la
  // recherche, les filtres et la saisie en cours vivent dans cet ecran et leur sont communs,
  // et changer d'espace n'ecrit rien.
  const [space, setSpace] = useState<EditorSpace>('variables');
  const [displaySort, setDisplaySort] = useState<DisplaySort>('form');
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleKind, setRuleKind] = useState('');
  const [ruleField, setRuleField] = useState('');
  const [ruleSection, setRuleSection] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState('');
  // Etats distincts du panneau : « busy repasse a faux » n'est pas une preuve de succes.
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [panelDirty, setPanelDirty] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [outOfFilter, setOutOfFilter] = useState<TemplateField | null>(null);
  const [deleting, setDeleting] = useState<TemplateField | null>(null);
  // UX-14(c) : une règle existante sert de modèle, soit pour une variante unitaire
  // (duplication dans le formulaire guidé), soit pour un lot de cibles (opération serveur).
  const [batchSource, setBatchSource] = useState<ValidationRule | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<ValidationRule | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await repo.getVersion(versionId));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, versionId]);

  useEffect(() => {
    void reload();
  }, [reload]);



  // UX-14(a) : sur un grand modele, tout ouvrir noie la vue d'ensemble et fait payer le rendu
  // de 216 lignes pour une modification qui n'en concerne qu'une. On part des en-tetes et de
  // leurs compteurs ; chaque bloc s'ouvre a la demande, et une recherche ouvre d'office ceux
  // qui contiennent un resultat. L'ajustement se fait PENDANT le rendu : passer par un effet
  // afficherait d'abord un etat qui n'est pas celui qu'on veut montrer.
  if (data && sectionsInitialized.current !== data.version.id) {
    sectionsInitialized.current = data.version.id;
    const largeModel = data.fields.length > LARGE_MODEL_FIELDS;
    // Le tronc commun et les variables orphelines n'ont pas de section declaree : sans elles,
    // un modele sans section s'ouvrirait entierement replie.
    setOpenSections(largeModel ? new Set() : new Set([...data.sections.map((section) => section.sectionKey), '__common__', '__other__']));
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setSaveState('saving');
    try {
      await fn();
      await reload();
      setError(null);
      setSaveState('saved');
      setPanelDirty(false);
      return true;
    } catch (e) {
      setError(msg(e));
      setSaveState('failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <SkeletonList rows={5} label={t('common.loading')} />;
  if (!data) return <p className="text-red-600">{error}</p>;

  const { version, fields, rules, sections } = data;

  // L29 : l'apercu prend tout l'ecran et se sert des donnees DEJA chargees ici — pas de
  // route dediee, sinon le meme ecran devrait franchir deux zones de garde differentes
  // (`member` pour /bases/:id/template et /templates, `admin` pour /admin) alors qu'il ne
  // fait que reafficher ce que l'editeur a en main.
  if (previewing) {
    return <FormPreview version={version} fields={fields} rules={rules} sections={data.sections} onClose={() => setPreviewing(false)} />;
  }

  const editable = version.status === 'draft';
  const normalizedSearch = search.trim().toLocaleLowerCase();
  // Un seul predicat pour la liste ET pour la verification d'apres enregistrement : sans cela,
  // une variable pourrait sortir du filtre sans que l'ecran sache le dire.
  const matchesFilters = (candidate: {
    label: string; fieldKey: string; description?: string | null;
    section: string | null; type: string; scope: string; required: boolean;
  }) => {
    const haystack = [candidate.label, candidate.fieldKey, candidate.description ?? ''].join(' ').toLocaleLowerCase();
    // Le tronc commun est une entree de filtre a part entiere : sans elle, les variables sans
    // section ne sont atteignables que par la recherche.
    const matchesSection = !sectionFilter
      || (sectionFilter === COMMON_SECTION_FILTER ? candidate.section === null : candidate.section === sectionFilter);
    return (!normalizedSearch || haystack.includes(normalizedSearch))
      && matchesSection
      && (!typeFilter || candidate.type === typeFilter)
      && (!scopeFilter || candidate.scope === scopeFilter)
      && (!requiredOnly || candidate.required);
  };
  const filteredFields = fields.filter(matchesFilters);
  const filtersActive = normalizedSearch !== '' || sectionFilter !== '' || typeFilter !== '' || scopeFilter !== '' || requiredOnly;
  // Un echec et un enregistrement en cours priment sur « modifications non enregistrees » :
  // c'est le resultat de la derniere operation qui doit rester lisible.
  const panelSaveState: SaveState = saveState === 'saving' || saveState === 'failed'
    ? saveState
    : panelDirty ? 'dirty' : saveState;
  const resetFilters = () => { setSearch(''); setSectionFilter(''); setTypeFilter(''); setScopeFilter(''); setRequiredOnly(false); };
  // Le nom d'une section vient d'abord des sections de LA VERSION : le libelle denormalise
  // porte par la variable peut dater d'avant un renommage.
  const sectionNameOf = (field: TemplateField) => sectionLabel(t, {
    sectionKey: field.section,
    label: sections.find((section) => section.sectionKey === field.section)?.label ?? field.sectionLabel,
  });
  const sortKeyOf = (field: TemplateField) => {
    switch (displaySort) {
      case 'label': return field.label;
      case 'key': return field.fieldKey;
      case 'section': return sectionNameOf(field);
      case 'type': return fieldTypeLabel(t, field.type);
      case 'scope': return t(`scope.${field.scope}`);
      default: return '';
    }
  };
  // Tri de CONSULTATION : il reordonne l'affichage, jamais les donnees. Le departage retombe
  // sur l'ordre du formulaire, puis sur la cle technique, pour rester stable d'un rendu a l'autre.
  const displayedFields = displaySort === 'form'
    ? filteredFields
    : [...filteredFields].sort((a, b) => COLLATOR.compare(sortKeyOf(a), sortKeyOf(b))
      || fields.indexOf(a) - fields.indexOf(b)
      || COLLATOR.compare(a.fieldKey, b.fieldKey));
  // Recherche et filtres de l'espace Regles : ils lisent les LIBELLES des variables et des
  // blocs cites, jamais le JSON de la regle.
  const ruleNeedle = ruleSearch.trim().toLocaleLowerCase();
  const filteredRules = rules.filter((rule) => {
    const parts = ruleParticipants(rule.rule);
    const haystack = [
      ...parts.fields.map((key) => fields.find((field) => field.fieldKey === key)?.label ?? key),
      ...parts.sections.map((key) => sections.find((section) => section.sectionKey === key)?.label ?? key),
      rule.message ?? '',
    ].join(' ').toLocaleLowerCase();
    return (!ruleNeedle || haystack.includes(ruleNeedle))
      && (!ruleKind || parts.kind === ruleKind)
      && (!ruleField || parts.fields.includes(ruleField))
      && (!ruleSection || parts.sections.includes(ruleSection))
      && (!ruleSeverity || (ruleHasSeverity(rule.rule) && rule.severity === ruleSeverity));
  });
  const fieldGroups = (() => {
    const groups = sections.map((section) => ({
      key: section.sectionKey,
      label: sectionLabel(t, section),
      total: fields.filter((field) => field.section === section.sectionKey).length,
      fields: displayedFields.filter((field) => field.section === section.sectionKey),
    }));
    const commonFields = displayedFields.filter((field) => field.section === null);
    if (commonFields.length > 0) groups.unshift({ key: '__common__', label: t('section.common'), total: fields.filter((field) => field.section === null).length, fields: commonFields });
    const orphanFields = displayedFields.filter((field) => field.section !== null && !sections.some((section) => section.sectionKey === field.section));
    if (orphanFields.length > 0 || sections.length === 0) {
      groups.push({ key: '__other__', label: t('section.other'), total: fields.filter((field) => !sections.some((section) => section.sectionKey === field.section)).length, fields: orphanFields });
    }
    return groups.filter((group) => group.total > 0 || group.fields.length > 0 || (!normalizedSearch && !sectionFilter));
  })();

  function openFieldEditor(field: TemplateField) {
    setOpenSections((current) => new Set(current).add(field.section ?? '__common__'));
    setEditing(field);
    setFieldFormOpen('edit');
    setPanelDirty(false);
    setSaveState('idle');
    setOutOfFilter(null);
  }

  /** Rien ne quitte une variable modifiee sans decision explicite : fermeture par X, Echap,
   * clic sur le fond et navigation Precedente/Suivante passent toutes par ici. */
  function guardLeave(action: () => void) {
    if (panelDirty) setLeaving(() => action);
    else action();
  }

  function closeFieldEditor() {
    setEditing(null);
    setFieldFormOpen(null);
  }

  function scrollToField(fieldId: string) {
    window.setTimeout(() => document.getElementById(`template-field-${fieldId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
  }

  /** Ouvre un groupe et l'amene en vue : choisir une section dans l'index y conduit
   * directement, sans faire defiler les sections precedentes. */
  /** Un bloc est ouvert par choix, ou parce qu'un filtre y trouve un resultat. */
  function groupIsOpen(key: string, matches: number) {
    return openSections.has(key) || (filtersActive && matches > 0);
  }

  function revealGroup(key: string) {
    setOpenSections((current) => new Set(current).add(key));
    window.setTimeout(() => document.getElementById(`template-group-${key}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0);
  }

  // Precedente / Suivante se deplacent dans les RESULTATS AFFICHES : meme filtre, meme tri
  // que la liste. Hors de ces resultats, il n'y a pas de variable suivante a proposer.
  const navigationFields = displayedFields.length > 0 ? displayedFields : fields;
  function adjacentField(fieldId: string, delta: -1 | 1) {
    const index = navigationFields.findIndex((field) => field.id === fieldId);
    return index >= 0 ? navigationFields[index + delta] ?? null : null;
  }
  const fieldGridClass = editable
    ? 'xl:grid-cols-[3rem_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,.7fr)_5rem_minmax(7rem,auto)]'
    : 'xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,.7fr)_5rem]';

  // Drag & drop : depose la variable saisie a la place de la variable cible, persiste
  // le nouvel ordre (display_order), avec mise a jour optimiste de la liste.
  function dropOn(targetId: string) {
    const src = dragId;
    setDragId(null);
    if (!data || !src || src === targetId) return;
    const reordered = [...data.fields];
    const from = reordered.findIndex((f) => f.id === src);
    const to = reordered.findIndex((f) => f.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setData({ ...data, fields: reordered });
    void run(() => repo.reorderFields(version.id, reordered.map((f) => f.id)));
  }

  function moveField(fieldId: string, delta: -1 | 1) {
    if (!data || editing) return;
    const reordered = [...data.fields];
    const from = reordered.findIndex((field) => field.id === fieldId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= reordered.length) return;
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    setData({ ...data, fields: reordered });
    void run(() => repo.reorderFields(version.id, reordered.map((field) => field.id)));
  }

  async function saveEditedField(field: NewField, advance = false) {
    if (!editing) return false;
    const editedId = editing.id;
    const edited = editing;
    const ok = await run(() => repo.updateField(editedId, field));
    if (!ok) return false;
    // La modification peut faire sortir la variable des filtres affiches : on l'annonce et on
    // propose d'y retourner, au lieu de la laisser disparaitre sans explication.
    setOutOfFilter(filtersActive && !matchesFilters(field) ? { ...edited, ...field } as TemplateField : null);
    const next = advance ? adjacentField(editedId, 1) : null;
    if (next) {
      openFieldEditor(next);
      scrollToField(next.id);
    } else {
      closeFieldEditor();
      scrollToField(editedId);
    }
    return true;
  }

  const previousField = editing ? adjacentField(editing.id, -1) : null;
  const nextField = editing ? adjacentField(editing.id, 1) : null;
  // Deux relations distinctes : ce que la variable DECLENCHE, et ce dont elle est la CIBLE.
  const linkedRules = {
    triggers: editing ? rules.filter((rule) => {
      const value = rule.rule as { if?: { field?: unknown }; left_field?: unknown };
      return value?.if?.field === editing.fieldKey || value?.left_field === editing.fieldKey;
    }) : [],
    targets: editing ? rules.filter((rule) => {
      const value = rule.rule as { then?: { field?: unknown }; right_field?: unknown };
      return value?.then?.field === editing.fieldKey || value?.right_field === editing.fieldKey;
    }) : [],
  };

  return (
    <section className="space-y-5 sm:space-y-6">
      <div
        data-testid="template-editor-toolbar"
        className="-mx-4 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:bg-slate-950/95 sm:-mx-6 sm:px-6 md:sticky md:top-0 md:z-30"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onBack} className="btn-ghost min-h-11 px-2">
                ← {t('admin.back')}
              </button>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('admin.editor_context')}</span>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">{templateName ?? t('admin.editor_context')}</h2>
              <span className="badge">{t('admin.version')} {version.versionNumber} · {t(`status.${version.status}`)}</span>
              <span className="text-xs text-slate-500">{t('admin.variable_count').replace('{n}', String(fields.length))}</span>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
            {editable && (
              <button type="button" onClick={() => { setEditing(null); setFieldFormOpen('add'); }} disabled={busy} className="btn-primary">
                {t('admin.add_variable')}
              </button>
            )}
            {/* L29 : voir le formulaire tel que le verra la personne qui saisit, sans creer
                de patient d'essai. Disponible aussi sur une version publiee. */}
            <button type="button" onClick={() => setPreviewing(true)} className="btn-secondary">
              <Eye size={16} aria-hidden /> {t('preview.open')}
            </button>
            {showVersionActions ? (
              <>
                {editable && (
                  <button onClick={() => void run(() => repo.publishVersion(version.id))} disabled={busy} className="btn-primary">
                    {t('admin.publish')}
                  </button>
                )}
                <button onClick={() => void run(() => repo.duplicateVersion(version.id))} disabled={busy} className="btn-secondary">
                  {t('admin.duplicate')}
                </button>
              </>
            ) : (
              !editable && onNewVersion && (
                <button
                  onClick={async () => {
                    setBusy(true);
                    try { const v = await repo.createNextVersion(version.templateId); setError(null); await onNewVersion(v.id); }
                    catch (e) { setError(msg(e)); }
                    finally { setBusy(false); }
                  }}
                  disabled={busy}
                  className="btn-secondary"
                >
                  {t('admin.new_version')}
                </button>
              )
            )}
          </div>
        </div>
        {/* UX-14(a) : trois espaces d'acces direct. La liste des regles ne demande plus de
            traverser toutes les variables, et changer d'espace n'ecrit rien. */}
        <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label={t('admin.spaces')}>
          {EDITOR_SPACES.map((item, index) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`editor-space-${item}`}
              aria-selected={space === item}
              aria-controls={`editor-panel-${item}`}
              tabIndex={space === item ? 0 : -1}
              onClick={() => setSpace(item)}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!delta) return;
                event.preventDefault();
                const next = EDITOR_SPACES[(index + delta + EDITOR_SPACES.length) % EDITOR_SPACES.length];
                setSpace(next);
                document.getElementById(`editor-space-${next}`)?.focus();
              }}
              className={`min-h-11 rounded-full px-3 text-sm font-medium ${space === item
                ? 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-600/20'
                : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {t(item === 'variables' ? 'admin.variables' : item === 'sections' ? 'admin.space_sections' : 'admin.rules')}
              <span className="ml-1.5 text-xs font-normal text-slate-500">
                {item === 'variables' ? fields.length : item === 'sections' ? sections.length : rules.length}
              </span>
            </button>
          ))}
        </div>
        {space === 'variables' && (
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(14rem,2fr)_repeat(3,minmax(9rem,1fr))_auto]">
          <label className="relative block">
            <span className="sr-only">{t('admin.search_variables')}</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('admin.search_variables_hint')}
              aria-label={t('admin.search_variables')}
            />
          </label>
          <label className="sr-only" htmlFor="template-section-filter">{t('admin.filter_section')}</label>
          <select id="template-section-filter" className="input" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} aria-label={t('admin.filter_section')}>
            <option value="">{t('admin.all_sections')}</option>
            <option value={COMMON_SECTION_FILTER}>{t('admin.common_filter')}</option>
            {sections.map((section) => <option key={section.sectionKey} value={section.sectionKey}>{sectionLabel(t, section)}</option>)}
          </select>
          <label className="sr-only" htmlFor="template-type-filter">{t('admin.filter_type')}</label>
          <select id="template-type-filter" className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label={t('admin.filter_type')}>
            <option value="">{t('admin.all_types')}</option>
            {FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(t, type)}</option>)}
          </select>
          <label className="sr-only" htmlFor="template-scope-filter">{t('admin.filter_scope')}</label>
          <select id="template-scope-filter" className="input" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} aria-label={t('admin.filter_scope')}>
            <option value="">{t('admin.all_scopes')}</option>
            {FIELD_SCOPES.map((scope) => <option key={scope} value={scope}>{t(`scope.${scope}`)}</option>)}
          </select>
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs text-slate-700">
            <input type="checkbox" checked={requiredOnly} onChange={(event) => setRequiredOnly(event.target.checked)} />
            {t('admin.filter_required')}
          </label>
        </div>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500" aria-live="polite">
          <span>{t(SAVE_STATE_KEYS[panelSaveState])}</span>
          {space === 'variables' && (
            <span>{t('admin.filtered_count').replace('{shown}', String(filteredFields.length)).replace('{total}', String(fields.length))}</span>
          )}
          {space === 'variables' && filtersActive && (
            <button type="button" className="font-medium text-teal-700 underline underline-offset-2" onClick={resetFilters}>
              {t('admin.reset_filters')}
            </button>
          )}
        </p>
      </div>

      {/* Une modification non enregistree ne se perd jamais sans decision explicite. */}
      <ConfirmDialog
        open={leaving !== null}
        title={t('admin.leave_variable_title')}
        body={t('admin.leave_variable_body')}
        confirmLabel={t('admin.leave_variable_confirm')}
        danger
        onCancel={() => setLeaving(null)}
        onConfirm={() => { const action = leaving; setLeaving(null); setPanelDirty(false); action?.(); }}
      />
      {/* Avant une suppression, montrer ce qui en depend : le serveur refusera sinon. */}
      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.delete_field_title')}
        body={deleting ? (
          <>
            <p>{deleting.label}</p>
            {(() => {
              const dependents = rules.filter((rule) => ruleParticipants(rule.rule).fields.includes(deleting.fieldKey));
              return dependents.length > 0 ? (
                <p className="mt-2 text-amber-800">{t('admin.delete_field_rules').replace('{n}', String(dependents.length))}</p>
              ) : null;
            })()}
          </>
        ) : undefined}
        confirmLabel={t('admin.delete_field_confirm')}
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => { const target = deleting; setDeleting(null); if (target) void run(() => repo.deleteField(target.id)); }}
      />
      {batchSource && (
        <RuleBatchPanel
          versionId={version.id}
          source={batchSource}
          fields={fields}
          sections={sections}
          repo={repo}
          onClose={() => setBatchSource(null)}
          // Le lot est ecrit par le serveur : l'ecran relit la version au lieu de deviner
          // ce qui a ete cree.
          onApplied={() => { void reload(); }}
          // Le lot ne se termine pas sur un cul-de-sac : chaque regle creee est atteignable
          // dans la liste, au meme endroit que les autres.
          onOpenRule={(ruleId) => {
            setBatchSource(null);
            window.setTimeout(() => document.getElementById(`rule-${ruleId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
          }}
        />
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!editable && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('admin.published_readonly')}</p>}

      {/* L31 : les sections avant les variables — on choisit ses regroupements, puis on
          range ses variables dedans. Gelees avec la version, donc invisibles hors brouillon. */}
      {/* L55 : `undefined` signale un serveur qui ignore la colonne. On ne propose alors pas
          une configuration qu'il ne saurait pas enregistrer ; le gabarit reste consultable. */}
      {space === 'sections' && (
      <div id="editor-panel-sections" role="tabpanel" aria-labelledby="editor-space-sections" className="space-y-5">
      {version.diagnosisConfiguration !== undefined && (
        <DiagnosisConfigurationEditor version={version} fields={fields} rules={rules} sections={sections} repo={repo} busy={busy} run={run} />
      )}
      {/* UX-16 : les rubriques communes restent dans l'espace Structure/Sections : elles
          s'intercalent avec les blocs mais n'en deviennent jamais des sous-sections. */}
      {version.commonLayout !== undefined && (
        <CommonLayoutEditor
          layout={version.commonLayout}
          fields={fields}
          sections={sections}
          disabled={!editable || busy}
          onSave={async (operationId, payload, expectedFingerprint) => {
            if (!repo.setCommonLayout) throw new Error('COMMON_LAYOUT_UNSUPPORTED');
            await repo.setCommonLayout(version.id, operationId, payload, expectedFingerprint);
            await reload();
          }}
        />
      )}
      {editable && (
        <SectionsEditor
          sections={sections}
          fields={fields}
          busy={busy}
          onAdd={(sectionKey, label, parentKey) => void run(() => repo.addSection!(version.id, sectionKey, label, parentKey))}
          onMove={(id, parentKey) => void run(() => repo.moveSection!(version.id, id, parentKey))}
          onReorderSiblings={(parentKey, ids) => void run(() => repo.reorderSectionSiblings!(version.id, parentKey, ids))}
          onRename={(sectionId, label) => void run(() => repo.renameSection!(sectionId, label))}
          onDelete={(sectionId) => void run(() => repo.deleteSection!(sectionId))}
          onReorder={(orderedIds) => void run(() => repo.reorderSections!(version.id, orderedIds))}
          onImportBlock={repo.listImportableSections ? () => setImportOpen(true) : undefined}
        />
      )}
      {editable && importOpen && (
        <SectionImportDialog
          repo={repo}
          targetVersionId={version.id}
          onClose={() => setImportOpen(false)}
          // Le cache de session est deja vide par `importSection` ; ce rechargement
          // rapporte le bloc, ses variables et ses regles dans l'ecran.
          onImported={reload}
          onActivate={(sectionKey) => {
            setImportOpen(false);
            setActivationSection(sectionKey);
            // L'activation se decide dans l'espace Regles : on y conduit directement.
            setSpace('rules');
          }}
        />
      )}
      </div>
      )}

      {space === 'variables' && (
      <div id="editor-panel-variables" role="tabpanel" aria-labelledby="editor-space-variables">
        {/* Tri de consultation : il ne touche jamais l'ordre enregistre. Le deplacement est
            suspendu pendant qu'il est actif, sinon « monter » n'aurait plus de sens visible. */}
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-slate-600">
            {t('admin.display_sort')}
            <select
              className="input mt-1"
              value={displaySort}
              aria-label={t('admin.display_sort')}
              onChange={(event) => setDisplaySort(event.target.value as DisplaySort)}
            >
              {DISPLAY_SORTS.map((item) => <option key={item} value={item}>{t(SORT_LABEL_KEYS[item])}</option>)}
            </select>
          </label>
          {displaySort !== 'form' && <p className="max-w-md text-xs text-amber-800">{t('admin.sort_notice')}</p>}
        </div>
        {outOfFilter && (
          <p role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('admin.out_of_filter').replace('{label}', outOfFilter.label)}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => { const target = outOfFilter; resetFilters(); setOutOfFilter(null); revealGroup(target.section ?? '__common__'); scrollToField(target.id); }}
            >
              {t('admin.out_of_filter_action')}
            </button>
          </p>
        )}
        <div className="grid gap-4 xl:grid-cols-[14rem_minmax(0,1fr)]">
        {/* Index compact : atteindre une section de fin de modele sans parcourir les precedentes. */}
        <details open className="h-fit rounded-xl border border-slate-200 p-2">
          <summary className="cursor-pointer px-1 py-1 text-sm font-semibold text-slate-700">{t('admin.section_index')}</summary>
          <p className="px-1 text-xs text-slate-500">{t('admin.section_index_hint')}</p>
          <ul className="mt-1 space-y-0.5">
            {fieldGroups.map((group) => (
              <li key={group.key} className={sections.find((section) => section.sectionKey === group.key)?.parentSectionKey ? 'pl-3' : ''}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                  onClick={() => revealGroup(group.key)}
                >
                  <span className="min-w-0 break-words">{group.label}</span>
                  <span className="shrink-0 text-xs text-slate-500">{group.fields.length} / {group.total}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
        <div className="card overflow-hidden" role="table" aria-label={t('admin.variables')}>
          <div
            role="row"
            className={`hidden border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500 xl:grid xl:gap-2 ${fieldGridClass}`}
          >
            {editable && <span role="columnheader"><span className="sr-only">{t('admin.drag_hint')}</span></span>}
            <span role="columnheader">{t('admin.field_key')}</span>
            <span role="columnheader">{t('admin.label')}</span>
            <span role="columnheader">{t('admin.scope')}</span>
            <span role="columnheader">{t('admin.section')}</span>
            <span role="columnheader">{t('admin.type')}</span>
            <span role="columnheader">{t('admin.required')}</span>
            {editable && <span role="columnheader"><span className="sr-only">{t('common.actions')}</span></span>}
          </div>
          <div role="rowgroup" className="divide-y divide-slate-100">
            {fieldGroups.map((group) => (
              <details
                key={group.key}
                id={`template-group-${group.key}`}
                open={groupIsOpen(group.key, group.fields.length)}
              >
                {/* L'etat d'ouverture appartient a l'ecran : c'est lui qui decide de rendre ou
                    non les lignes du bloc, et un filtre ouvre d'office un bloc qui a des
                    resultats. On neutralise donc la bascule native du widget. */}
                <summary
                  className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50/70 px-4 py-3 text-sm font-semibold text-slate-800"
                  onClick={(event) => {
                    event.preventDefault();
                    setOpenSections((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                      return next;
                    });
                  }}
                >
                  <span>{group.label}</span>
                  <span className="text-xs font-normal text-slate-500">{t('admin.variable_count').replace('{n}', String(group.total))}</span>
                </summary>
                {/* Un bloc replie ne rend pas ses lignes : sur 216 variables, c'est la
                    difference entre un ecran immediat et un ecran qui se reconstruit entier. */}
                <div className="divide-y divide-slate-100">
              {groupIsOpen(group.key, group.fields.length) && group.fields.map((f) => {
                const index = fields.findIndex((field) => field.id === f.id);
                const canDrag = editable && !editing && displaySort === 'form';
                return (
                <div
                  key={f.id}
                  id={`template-field-${f.id}`}
                  role="row"
                  draggable={canDrag}
                  onDragStart={canDrag ? () => setDragId(f.id) : undefined}
                  onDragOver={canDrag ? (e) => e.preventDefault() : undefined}
                  onDrop={canDrag ? () => dropOn(f.id) : undefined}
                  className={
                    `grid gap-2 p-4 xl:items-center xl:gap-2 xl:px-3 xl:py-2.5 ${fieldGridClass}` +
                    (dragId === f.id ? ' opacity-50' : '')
                  }
                >
                  {editable && (
                    <div role="cell" className="flex items-center gap-1 xl:justify-center">
                      <>
                        <span className={'hidden text-slate-400 xl:inline' + (canDrag ? ' cursor-grab select-none' : '')} title={t('admin.drag_hint')} aria-hidden>⠿</span>
                        <button
                          type="button"
                          className="icon-button h-11 w-11 xl:hidden"
                          aria-label={`${t('admin.move_up')} · ${f.label}`}
                          disabled={busy || !!editing || index === 0 || displaySort !== 'form'}
                          onClick={() => moveField(f.id, -1)}
                        >
                          <ArrowUp size={18} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="icon-button h-11 w-11 xl:hidden"
                          aria-label={`${t('admin.move_down')} · ${f.label}`}
                          disabled={busy || !!editing || index === fields.length - 1 || displaySort !== 'form'}
                          onClick={() => moveField(f.id, 1)}
                        >
                          <ArrowDown size={18} aria-hidden />
                        </button>
                      </>
                    </div>
                  )}
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs xl:block">
                    <span className="font-medium text-slate-500 xl:hidden">{t('admin.field_key')}</span>
                    <span className="min-w-0 break-words font-mono">{f.fieldKey}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.label')}</span>
                    <span className="min-w-0 break-words font-medium text-slate-900">{f.label}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.scope')}</span>
                    <span>{t(`scope.${f.scope}`)}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.section')}</span>
                    <span>{sectionLabel(t, { sectionKey: f.section, label: f.sectionLabel })}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.type')}</span>
                     <span>{fieldTypeLabel(t, f.type)}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.required')}</span>
                    <span>{f.required ? '✓' : '—'}</span>
                  </div>
                  {editable && (
                    <div role="cell" className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 xl:mt-0 xl:border-0 xl:pt-0">
                      <>
                        <button type="button" onClick={() => openFieldEditor(f)} className="btn-ghost min-h-11 px-3 text-xs">
                          {t('admin.edit_variable')}
                        </button>
                        {f.inUse ? (
                          <button
                            type="button"
                            disabled
                            className="min-h-11 cursor-not-allowed px-2 text-xs font-medium text-slate-500"
                            title={t('admin.field_locked_hint')}
                          >
                            {t('admin.delete')}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setDeleting(f)} className="min-h-11 px-2 text-xs font-medium text-red-600 hover:underline">
                            {t('admin.delete')}
                          </button>
                        )}
                      </>
                    </div>
                  )}
                </div>
                );
              })}
                </div>
              </details>
            ))}
            {filteredFields.length === 0 && (
              <p className="p-6 text-sm text-slate-500">{t('admin.no_matching_variables')}</p>
            )}
          </div>
        </div>
        </div>
        {editable && fieldFormOpen && (
          <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
            <button type="button" className="absolute inset-0 bg-slate-950/30" aria-label={t('admin.close_panel')} onClick={() => guardLeave(closeFieldEditor)} />
            <aside
              className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="template-field-panel-title"
              onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); guardLeave(closeFieldEditor); } }}
            >
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-4 backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{templateName ?? t('admin.editor_context')}</p>
                    <h3 id="template-field-panel-title" className="mt-1 text-lg font-semibold text-slate-900">
                      {editing ? t('admin.edit_variable') : t('admin.add_variable')}
                    </h3>
                  </div>
                  <button type="button" className="icon-button h-11 w-11" onClick={() => guardLeave(closeFieldEditor)} aria-label={t('admin.close_panel')}>
                    <X size={18} aria-hidden />
                  </button>
                </div>
                {editing && (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary" disabled={!previousField || busy} onClick={() => previousField && guardLeave(() => openFieldEditor(previousField))}>
                        <ArrowLeft size={16} aria-hidden /> {t('admin.previous_variable')}
                      </button>
                      <button type="button" className="btn-secondary" disabled={!nextField || busy} onClick={() => nextField && guardLeave(() => openFieldEditor(nextField))}>
                        {t('admin.next_variable')} <ArrowRight size={16} aria-hidden />
                      </button>
                    </div>
                    {/* Position et section : savoir ou l'on se trouve dans les resultats affiches,
                        et reconnaitre la fin de liste au lieu de la deviner. */}
                    <p className="mt-2 text-xs text-slate-500">
                      {t('admin.panel_position')
                        .replace('{index}', String(Math.max(1, navigationFields.findIndex((field) => field.id === editing.id) + 1)))
                        .replace('{total}', String(navigationFields.length))}
                      {' · '}
                      {t('admin.panel_section').replace('{section}', sectionNameOf(editing))}
                    </p>
                    {!nextField && <p className="mt-1 text-xs text-amber-800">{t('admin.panel_last')}</p>}
                    {!previousField && <p className="mt-1 text-xs text-amber-800">{t('admin.panel_first')}</p>}
                    <p className="mt-1 text-xs text-slate-500" aria-live="polite">
                      {t(SAVE_STATE_KEYS[panelSaveState])}
                    </p>
                    {/* UX-14(b) : les regles liees se lisent la ou l'on modifie la variable. */}
                    <div className="mt-3 rounded-xl border border-slate-200 p-3 text-xs">
                      {linkedRules.triggers.length === 0 && linkedRules.targets.length === 0 && (
                        <p className="text-slate-500">{t('admin.rules_linked_none')}</p>
                      )}
                      {linkedRules.triggers.length > 0 && (
                        <>
                          <p className="font-medium text-slate-700">{t('admin.rules_triggers')}</p>
                          <ul className="mt-1 space-y-1">
                            {linkedRules.triggers.map((rule) => (
                              <li key={rule.id}><RuleSummary rule={rule.rule} fields={fields} sections={sections} /></li>
                            ))}
                          </ul>
                        </>
                      )}
                      {linkedRules.targets.length > 0 && (
                        <>
                          <p className="mt-2 font-medium text-slate-700">{t('admin.rules_targets')}</p>
                          <ul className="mt-1 space-y-1">
                            {linkedRules.targets.map((rule) => (
                              <li key={rule.id}><RuleSummary rule={rule.rule} fields={fields} sections={sections} /></li>
                            ))}
                          </ul>
                        </>
                      )}
                      <button
                        type="button"
                        className="mt-2 font-medium text-teal-700 underline underline-offset-2"
                        onClick={() => guardLeave(() => { setRuleField(editing.fieldKey); setSpace('rules'); closeFieldEditor(); })}
                      >
                        {t('admin.rules_open_space')}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="flex-1 p-4">
                {editing ? (
                  <FieldForm
                    key={editing.id}
                    busy={busy}
                    initial={{
                      fieldKey: editing.fieldKey,
                      label: editing.label,
                      // L27/L28 : préserver la consigne et la valeur proposée lors d’une correction ciblée.
                      description: editing.description,
                      defaultValue: editing.defaultValue,
                      scope: editing.scope,
                      section: editing.section,
                      type: editing.type,
                      required: editing.required,
                      isMultiple: editing.isMultiple,
                      encounterTypes: editing.encounterTypes,
                      allowedValues: editing.allowedValues ? editing.allowedValues.map(String) : null,
                      allowedOptions: fieldOptions(editing),
                      minValue: editing.minValue,
                      maxValue: editing.maxValue,
                      unit: editing.unit,
                      allowMissingCodes: editing.allowMissingCodes,
                      missingReasons: editing.missingReasons,
                      formula: editing.formula,
                    }}
                    lockStructural={editing.inUse ?? false}
                    submitLabel={t('admin.save')}
                    submitAndNextLabel={t('admin.save_next')}
                    onCancel={closeFieldEditor}
                    observationModel={observationModel}
                    sections={sections}
                    fields={fields}
                    onDirtyChange={setPanelDirty}
                    onSubmit={(field) => void saveEditedField(field)}
                    onSubmitAndNext={(field) => saveEditedField(field, true)}
                  />
                ) : (
                  <>
                    <p className="mb-3 text-sm text-slate-600">{t('admin.add_variable_hint')}</p>
                    <FieldForm
                      busy={busy}
                      observationModel={observationModel}
                      sections={sections}
                      fields={fields}
                      onDirtyChange={setPanelDirty}
                      onSubmit={async (field, companion) => {
                        // Ne jamais promettre une soupape qui n'a pas pu être créée. Le serveur garde la contrainte ; l’UI garde le formulaire rempli en cas de conflit.
                        const taken = !!companion && fields.some((item) => item.fieldKey === companion.fieldKey);
                        if (taken) {
                          setError(t('admin.proposal_exists'));
                          return false;
                        }
                        return run(() => repo.addField(version.id, field, companion));
                      }}
                    />
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
      )}

      {space === 'rules' && (
      <div ref={rulesRef} id="editor-panel-rules" role="tabpanel" aria-labelledby="editor-space-rules">
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          {/* Ajouter une regle sans traverser les regles existantes. */}
          {editable && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setEditingRule(null); window.setTimeout(() => ruleFormRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0); }}
            >
              {t('admin.rules_add')}
            </button>
          )}
        </div>
        {/* UX-14(b) : retrouver une regle par sa variable, son bloc, son type ou sa severite. */}
        <div className="mb-3 grid gap-2 md:grid-cols-[minmax(12rem,2fr)_repeat(2,minmax(9rem,1fr))] xl:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(9rem,1fr))]">
          <input
            type="search"
            className="input"
            value={ruleSearch}
            onChange={(event) => setRuleSearch(event.target.value)}
            aria-label={t('admin.rules_search')}
            placeholder={t('admin.rules_search_hint')}
          />
          <select className="input" value={ruleKind} aria-label={t('admin.rules_kind')} onChange={(event) => setRuleKind(event.target.value)}>
            <option value="">{t('admin.all_kinds')}</option>
            <option value="comparison">{t('admin.rule_kind_comparison')}</option>
            <option value="conditional">{t('admin.rule_kind_conditional')}</option>
            <option value="visibility">{t('admin.rule_kind_visibility')}</option>
          </select>
          <select className="input" value={ruleField} aria-label={t('admin.rules_field')} onChange={(event) => setRuleField(event.target.value)}>
            <option value="">{t('admin.all_fields')}</option>
            {fields.map((field) => <option key={field.id} value={field.fieldKey}>{field.label}</option>)}
          </select>
          <select className="input" value={ruleSection} aria-label={t('admin.rules_section')} onChange={(event) => setRuleSection(event.target.value)}>
            <option value="">{t('admin.all_blocks')}</option>
            {sections.filter((section) => !section.parentSectionKey).map((section) => (
              <option key={section.sectionKey} value={section.sectionKey}>{sectionLabel(t, section)}</option>
            ))}
          </select>
          <select className="input" value={ruleSeverity} aria-label={t('admin.rules_severity')} onChange={(event) => setRuleSeverity(event.target.value)}>
            <option value="">{t('admin.all_severities')}</option>
            <option value="block">{t('severity.block')}</option>
            <option value="warn">{t('severity.warn')}</option>
          </select>
        </div>
        <p className="mb-2 text-xs text-slate-500" aria-live="polite">
          {t('admin.rules_count').replace('{shown}', String(filteredRules.length)).replace('{total}', String(rules.length))}
        </p>
        <ul className="space-y-2 text-sm">
          {filteredRules.map((r) => (
            <li key={r.id} id={`rule-${r.id}`} className="card flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <RuleSummary rule={r.rule} fields={fields} sections={sections} />
                {/* Depuis une regle, atteindre directement les variables qu'elle cite. */}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {[...new Set(ruleParticipants(r.rule).fields)]
                    .map((key) => fields.find((field) => field.fieldKey === key))
                    .filter((field): field is TemplateField => !!field)
                    .map((field) => (
                      <button
                        key={field.id}
                        type="button"
                        className="text-xs font-medium text-teal-700 underline underline-offset-2"
                        onClick={() => { setSpace('variables'); openFieldEditor(field); scrollToField(field.id); }}
                      >
                        {field.label}
                      </button>
                    ))}
                </div>
              </div>
              <span className="flex items-center gap-2">
                {/* Une regle d'affichage ne bloque ni n'avertit : lui coller « Bloquant » la
                    decrirait faux. */}
                {ruleHasSeverity(r.rule) && (
                  <span className="text-xs text-slate-500">{t(`severity.${r.severity}`)}</span>
                )}
                {editable && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setEditingRule(r); window.setTimeout(() => ruleFormRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0); }}
                      className="text-xs font-medium text-teal-700 hover:underline"
                    >
                      {t('admin.edit_rule')}
                    </button>
                    {/* Une condition ne se ressaisit pas variable par variable : elle s'applique
                        a plusieurs cibles en une operation serveur. Une comparaison ou une
                        condition de bloc n'a pas de sens multicible : elle se duplique. */}
                    {isBatchSource(r.rule) && repo.previewRuleBatch && repo.createRuleBatch ? (
                      <button type="button" onClick={() => { setEditingRule(null); setBatchSource(r); }}
                        className="text-xs font-medium text-teal-700 hover:underline">
                        {t('rulebatch.open')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingRule(null); setDuplicateSource(r); window.setTimeout(() => ruleFormRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0); }}
                        className="text-xs font-medium text-teal-700 hover:underline"
                      >
                        {t('rulebatch.duplicate')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void run(() => repo.deleteRule(r.id))}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {t('admin.delete')}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        {rules.length === 0 && <p className="text-sm text-slate-500">{t('admin.rules_empty')}</p>}
        {rules.length > 0 && filteredRules.length === 0 && <p className="text-sm text-slate-500">{t('admin.rules_none')}</p>}
        {editable && (
          <div className="mt-3" ref={ruleFormRef}>
            {/* L59 : apres un import, le bloc est visible SANS condition (D7 n'a pas
                copie sa regle d'activation). Le constructeur s'ouvre donc sur ce bloc,
                et l'utilisateur choisit le pilote : c'est L60 qui verifiera un jour la
                compatibilite d'un pilote repris de la source. */}
            {activationSection && !editingRule && (
              <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {t('blockimport.success_activation')}
              </p>
            )}
            <RuleForm
              key={editingRule?.id ?? (duplicateSource ? `duplicate-${duplicateSource.id}` : `new-rule-${activationSection ?? ''}`)}
              initialSectionTarget={editingRule ? null : activationSection}
              fields={fields}
              sections={sections}
              busy={busy}
              existingRules={editingRule ? rules.filter((rule) => rule.id !== editingRule.id) : rules}
              initialRule={editingRule?.rule ?? duplicateSource?.rule}
              initialMessage={editingRule?.message ?? duplicateSource?.message}
              initialSeverity={editingRule?.severity ?? duplicateSource?.severity}
              submitLabel={editingRule ? t('admin.save_rule') : undefined}
              onCancel={editingRule ? () => setEditingRule(null) : duplicateSource ? () => setDuplicateSource(null) : undefined}
              onSubmit={(rule, message, severity) => {
                if (editingRule) {
                  const editedId = editingRule.id;
                  void run(() => repo.updateRule(editedId, rule, message, severity)).then((ok) => {
                    if (!ok) return;
                    setEditingRule(null);
                    // Revenir a la regle concernee, plutot que laisser l'ecran sur le formulaire.
                    window.setTimeout(() => document.getElementById(`rule-${editedId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
                  });
                } else {
                  void run(() => repo.addRule(version.id, rule, message, severity)).then((ok) => {
                    // Le bloc importe est desormais conditionne : le renvoi vers
                    // l'activation a fait son office et n'a plus lieu d'etre affiche.
                    if (ok) { setActivationSection(null); setDuplicateSource(null); }
                  });
                }
              }}
            />
          </div>
        )}
      </div>
      )}
    </section>
  );
}
