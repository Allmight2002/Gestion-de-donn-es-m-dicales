import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, X } from 'lucide-react';
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
import { FieldMoveDialog, type FieldMove } from './FieldMoveDialog';
import { templateFieldToNewField } from '../../domain/templateFields';
import { SkeletonList } from '../../components/Skeleton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EditorStructure, editorGroups } from './EditorStructure';

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

type EditorSpace = 'structure' | 'rules' | 'diagnosis' | 'preview';
const EDITOR_SPACES: EditorSpace[] = ['structure', 'rules', 'diagnosis', 'preview'];
const SPACE_LABELS: Record<EditorSpace, MessageKey> = {
  structure: 'editor.structure', rules: 'admin.rules', diagnosis: 'editor.diagnosis', preview: 'editor.preview',
};
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
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [requiredOnly, setRequiredOnly] = useState(false);
  // `null` = aucun choix explicite encore fait ; `''` = choix explicite « Toutes les variables ».
  const [activeGroupChoice, setActiveGroup] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleDirty, setRuleDirty] = useState(false);
  const [diagnosisDirty, setDiagnosisDirty] = useState(false);
  const [sectionsDirty, setSectionsDirty] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [ruleContext, setRuleContext] = useState<{ group?: string; field?: string } | null>(null);
  const [returnTo, setReturnTo] = useState<EditorSpace | null>(null);
  const [previewVisited, setPreviewVisited] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
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
  const [space, setSpace] = useState<EditorSpace>('structure');
  const [displaySort, setDisplaySort] = useState<DisplaySort>('form');
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleKind, setRuleKind] = useState('');
  const [ruleField, setRuleField] = useState('');
  const [ruleRelation, setRuleRelation] = useState('');
  const [ruleSection, setRuleSection] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState('');
  // Etats distincts du panneau : « busy repasse a faux » n'est pas une preuve de succes.
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [panelDirty, setPanelDirty] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [outOfFilter, setOutOfFilter] = useState<TemplateField | null>(null);
  const [deleting, setDeleting] = useState<TemplateField | null>(null);
  // UX-14(d) : déplacement direct. Sur 216 lignes, glisser une variable traverse plusieurs
  // écrans et les flèches demandent autant de clics que de rangs franchis.
  const [moving, setMoving] = useState<TemplateField | null>(null);
  // UX-14(c) : une règle existante sert de modèle, soit pour une variante unitaire
  // (duplication dans le formulaire guidé), soit pour un lot de cibles (opération serveur).
  const [batchSource, setBatchSource] = useState<ValidationRule | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<ValidationRule | null>(null);
  const [ruleDraftRevision, setRuleDraftRevision] = useState(0);
  const scrollPositions = useRef<Partial<Record<EditorSpace, number>>>({});
  const dirty = panelDirty || ruleDirty || diagnosisDirty || sectionsDirty || layoutDirty;

  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);

  useEffect(() => {
    if (!fieldFormOpen || space !== 'structure') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = () => [...panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')]
      .filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0 && !element.closest('[hidden]'));
    (panel.querySelector<HTMLElement>('input:not(:disabled)') ?? focusable()[0])?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    panel.addEventListener('keydown', trap);
    return () => panel.removeEventListener('keydown', trap);
  }, [fieldFormOpen, editing?.id, space]);

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



  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setSaveState('saving');
    try {
      await fn();
      await reload();
      setError(null);
      setSaveState('saved');
      return true;
    } catch (e) {
      setError(msg(e));
      setSaveState('failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Index memorises AVANT les retours anticipes : un hook ne peut pas etre conditionnel.
  const groups = useMemo(
    () => (data ? editorGroups(data.fields, data.sections, data.version.commonLayout, t) : []),
    [data, t],
  );
  // Le compte de regles d'une variable est lu une fois PAR LIGNE. Recalcule a chaque ligne, il
  // reparcourait toutes les regles : 216 lignes x 26 regles a chaque frappe de recherche. Il se
  // calcule ici une seule fois, en un parcours des regles et un des variables.
  const ruleCountByFieldId = useMemo(() => {
    const counts = new Map<string, number>();
    if (!data) return counts;
    const parentOf = new Map(data.sections.map((section) => [section.sectionKey, section.parentSectionKey ?? section.sectionKey]));
    const parsed = data.rules.map((rule) => ruleParticipants(rule.rule));
    for (const field of data.fields) {
      const root = field.section ? parentOf.get(field.section) ?? field.section : null;
      let total = 0;
      for (const parts of parsed) {
        if (parts.fields.includes(field.fieldKey) || (root !== null && parts.sections.includes(root))) total += 1;
      }
      counts.set(field.id, total);
    }
    return counts;
  }, [data]);

  if (loading && !data) return <SkeletonList rows={5} label={t('common.loading')} />;
  if (!data) return <p className="text-red-600">{error}</p>;

  const { version, fields, rules, sections } = data;

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
  // L'ecran s'ouvre sur la PREMIERE rubrique du sommaire, comme la maquette : ouvrir un grand
  // modele ne doit pas commencer par derouler ses 216 variables. Une recherche ou un filtre
  // bascule explicitement vers « Toutes les variables », qui donne le chemin de chaque resultat.
  // Premiere rubrique NON VIDE : un modele dont le tronc commun est vide ouvrirait sinon sur
  // une page sans aucune variable, alors que l'utilisateur vient justement voir les siennes.
  const activeGroup = activeGroupChoice
    ?? (groups.find((group) => group.fields.length > 0)?.key ?? groups[0]?.key ?? '');
  const selectedGroup = groups.find((group) => group.key === activeGroup);
  const fieldGroupOf = (field: TemplateField) => groups.find((group) => group.fields.some((candidate) => candidate.id === field.id));
  const rootOf = (key: string) => sections.find((section) => section.sectionKey === key)?.parentSectionKey ?? key;
  const rulesForField = (rule: ValidationRule, field: TemplateField) => {
    const parts = ruleParticipants(rule.rule);
    return parts.fields.includes(field.fieldKey) || (!!field.section && parts.sections.includes(rootOf(field.section)));
  };
  const rulesForGroup = (rule: ValidationRule, key: string) => {
    const group = groups.find((candidate) => candidate.key === key);
    if (!group) return false;
    const relevantFields = [...group.fields, ...groups.filter((candidate) => candidate.parentKey === key).flatMap((candidate) => candidate.fields)];
    const parts = ruleParticipants(rule.rule);
    return (!group.common && parts.sections.includes(rootOf(key))) || relevantFields.some((field) => parts.fields.includes(field.fieldKey));
  };
  const inheritedRules = activeGroup && selectedGroup && !selectedGroup.common
    ? rules.filter((rule) => ruleParticipants(rule.rule).sections.includes(rootOf(activeGroup))) : [];
  const filteredFields = activeGroup ? (selectedGroup?.fields ?? []) : fields.filter(matchesFilters);
  const filtersActive = !activeGroup && (normalizedSearch !== '' || sectionFilter !== '' || typeFilter !== '' || scopeFilter !== '' || requiredOnly);
  // Un echec et un enregistrement en cours priment sur « modifications non enregistrees » :
  // c'est le resultat de la derniere operation qui doit rester lisible.
  const panelSaveState: SaveState = saveState === 'saving' || saveState === 'failed'
    ? saveState
    : dirty ? 'dirty' : saveState;
  const resetFilters = () => { setSearch(''); setSectionFilter(''); setTypeFilter(''); setScopeFilter(''); setRequiredOnly(false); };
  // Le nom d'une section vient d'abord des sections de LA VERSION : le libelle denormalise
  // porte par la variable peut dater d'avant un renommage.
  const sectionNameOf = (field: TemplateField) => {
    const group = fieldGroupOf(field);
    return group ? [groups.find((parent) => parent.key === group.parentKey)?.label, group.label].filter(Boolean).join(' / ') : sectionLabel(t, { sectionKey: field.section, label: field.sectionLabel });
  };
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
    if (ruleContext) return (!ruleContext.group || rulesForGroup(rule, ruleContext.group))
      && (!ruleContext.field || fields.some((field) => field.fieldKey === ruleContext.field && rulesForField(rule, field)));
    const parts = ruleParticipants(rule.rule);
    const haystack = [
      ...parts.fields, ...parts.sections,
      ...parts.fields.map((key) => fields.find((field) => field.fieldKey === key)?.label ?? key),
      ...parts.sections.map((key) => sections.find((section) => section.sectionKey === key)?.label ?? key),
      rule.message ?? '',
    ].join(' ').toLocaleLowerCase();
    const relation = rule.rule as { if?: { field?: string }; then?: { field?: string }; left_field?: string; right_field?: string };
    return (!ruleNeedle || haystack.includes(ruleNeedle))
      && (!ruleKind || parts.kind === ruleKind)
      && (!ruleField || parts.fields.includes(ruleField))
      && (!ruleField || !ruleRelation || (ruleRelation === 'source'
        ? (relation.if?.field ?? relation.left_field) === ruleField
        : (relation.then?.field ?? relation.right_field) === ruleField))
      && (!ruleSection || rulesForGroup(rule, ruleSection))
      && (!ruleSeverity || (ruleHasSeverity(rule.rule) && rule.severity === ruleSeverity));
  });
  function openFieldEditor(field: TemplateField) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(field);
    setFieldFormOpen('edit');
    setPanelDirty(false);
    setSaveState('idle');
    setOutOfFilter(null);
  }

  /** Rien ne quitte une variable modifiee sans decision explicite : fermeture par X, Echap,
   * clic sur le fond et navigation Precedente/Suivante passent toutes par ici. */
  function guardLeave(action: () => void) {
    if (busy) return;
    if (panelDirty) setLeaving(() => () => { setPanelDirty(false); action(); });
    else action();
  }

  function guardAll(action: () => void) {
    if (busy) return;
    if (dirty) setLeaving(() => action); else action();
  }

  function guardRule(action: () => void) {
    if (busy) return;
    const next = () => { setRuleDirty(false); setRuleDraftRevision((value) => value + 1); action(); };
    if (ruleDirty) setLeaving(() => next); else next();
  }

  function closeRuleForm() {
    setRuleFormOpen(false); setRuleDirty(false); setEditingRule(null); setDuplicateSource(null);
  }

  function changeSpace(next: EditorSpace) {
    scrollPositions.current[space] = window.scrollY;
    if (next === 'preview') setPreviewVisited(true);
    setSpace(next);
    window.setTimeout(() => {
      // Retrouver sa position utile en revenant sur un espace. On ecrit `scrollTop` plutot que
      // d'appeler `window.scrollTo` : meme resultat dans le navigateur, sans faire remonter a
      // chaque changement d'onglet l'erreur « not implemented » de l'environnement de test.
      const racine = document.scrollingElement ?? document.documentElement;
      if (racine) racine.scrollTop = scrollPositions.current[next] ?? 0;
      if (!(next === 'structure' && fieldFormOpen)) document.getElementById(`editor-space-${next}`)?.focus({ preventScroll: true });
    }, 0);
  }

  function selectGroup(key: string) {
    setActiveGroup(key);
    window.setTimeout(() => document.getElementById('editor-structure-heading')?.focus(), 0);
  }

  function openContextRules(context: { field?: string; group?: string }) {
    setRuleContext(context); setReturnTo('structure'); changeSpace('rules');
  }

  function revealRuleField(field: TemplateField) {
    const reveal = () => {
      setReturnTo('rules'); changeSpace('structure');
      if (editing?.id !== field.id) { setActiveGroup(fieldGroupOf(field)?.key ?? ''); openFieldEditor(field); }
      scrollToField(field.id);
    };
    if (editing?.id === field.id) reveal(); else guardLeave(reveal);
  }

  function closeFieldEditor() {
    setEditing(null);
    setFieldFormOpen(null);
    setPanelDirty(false);
    window.setTimeout(() => returnFocus.current?.isConnected && returnFocus.current.focus(), 0);
  }

  function scrollToField(fieldId: string) {
    window.setTimeout(() => document.getElementById(`template-field-${fieldId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
  }

  function scrollToRule(ruleId: string) {
    window.setTimeout(() => document.getElementById(`rule-${ruleId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
  }

  // Precedente / Suivante se deplacent dans les RESULTATS AFFICHES : meme filtre, meme tri
  // que la liste. Hors de ces resultats, il n'y a pas de variable suivante a proposer.
  const navigationFields = displayedFields;
  function adjacentField(fieldId: string, delta: -1 | 1) {
    const index = navigationFields.findIndex((field) => field.id === fieldId);
    return index >= 0 ? navigationFields[index + delta] ?? null : null;
  }
  // Drag & drop : depose la variable saisie a la place de la variable cible, persiste
  // le nouvel ordre (display_order), avec mise a jour optimiste de la liste.
  function dropOn(src: string, targetId: string) {
    if (!data || !src || src === targetId) return;
    const reordered = [...data.fields];
    const from = reordered.findIndex((f) => f.id === src);
    const to = reordered.findIndex((f) => f.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    void run(() => repo.reorderFields(version.id, reordered.map((f) => f.id)));
  }

  function moveField(fieldId: string, delta: -1 | 1) {
    if (!data || editing) return;
    const reordered = [...data.fields];
    const from = reordered.findIndex((field) => field.id === fieldId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= reordered.length) return;
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    void run(() => repo.reorderFields(version.id, reordered.map((field) => field.id)));
  }

  /**
   * UX-14(d) — applique un déplacement direct.
   *
   * Deux écritures, dans cet ordre : la section d'abord, le rang ensuite. Si la seconde
   * échoue, la variable est dans la bonne section à son ancien rang — un état visible et
   * corrigeable. L'inverse laisserait un rang correct dans la mauvaise section, que rien à
   * l'écran ne signalerait. La modification passe par la conversion exhaustive : la RPC
   * remplace la ligne entière, et un attribut oublié disparaîtrait du gabarit.
   */
  async function applyMove(field: TemplateField, move: FieldMove) {
    const ok = await run(async () => {
      if ((field.section ?? null) !== move.section) {
        await repo.updateField(field.id, templateFieldToNewField(field, { section: move.section }));
      }
      await repo.reorderFields(version.id, move.orderedIds);
    });
    if (ok) setMoving(null);
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
              <button onClick={() => guardAll(onBack)} className="btn-ghost min-h-11 px-2">
                ← {t('admin.back')}
              </button>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('admin.editor_context')}</span>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">{templateName ?? t('admin.editor_context')}</h2>
              <span className="badge">{t('admin.version')} {version.versionNumber} · {t(`status.${version.status}`)}</span>
              <span className="text-xs text-slate-500">{t('admin.variable_count').replace('{n}', String(fields.length))}</span>
              <span className="text-xs text-slate-500">{sections.length} {t('admin.space_sections')} · {rules.length} {t('admin.rules')}</span>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
            {editable && (
              <button type="button" onClick={() => guardLeave(() => { setSpace('structure'); setEditing(null); setFieldFormOpen('add'); setSaveState('idle'); })} disabled={busy} className="btn-primary">
                {t('admin.add_variable')}
              </button>
            )}
            {showVersionActions ? (
              <>
                {editable && (
                  <button onClick={() => void run(() => repo.publishVersion(version.id))} disabled={busy || dirty} className="btn-primary">
                    {t('admin.publish')}
                  </button>
                )}
                <button onClick={() => void run(() => repo.duplicateVersion(version.id))} disabled={busy || dirty} className="btn-secondary">
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
        {/* Four workspaces share loaded domain objects and keep each draft mounted. */}
        <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label={t('admin.spaces')}>
          {EDITOR_SPACES.map((item, index) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`editor-space-${item}`}
              aria-selected={space === item}
              aria-controls={`editor-panel-${item}`}
              /* Sans nom explicite, le compteur colle au libelle : « Regles26 ». */
              aria-label={item === 'structure' ? `${t(SPACE_LABELS[item])} · ${t('admin.variable_count').replace('{n}', String(fields.length))}`
                : item === 'rules' ? `${t(SPACE_LABELS[item])} · ${rules.length}`
                : undefined}
              tabIndex={space === item ? 0 : -1}
              onClick={() => changeSpace(item)}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!delta && event.key !== 'Home' && event.key !== 'End') return;
                event.preventDefault();
                const next = event.key === 'Home' ? EDITOR_SPACES[0] : event.key === 'End' ? EDITOR_SPACES[EDITOR_SPACES.length - 1]
                  : EDITOR_SPACES[(index + delta + EDITOR_SPACES.length) % EDITOR_SPACES.length];
                changeSpace(next);
                document.getElementById(`editor-space-${next}`)?.focus();
              }}
              className={`min-h-11 rounded-full px-3 text-sm font-medium ${space === item
                ? 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-600/20'
                : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {t(SPACE_LABELS[item])}
              <span className="ml-1.5 text-xs font-normal text-slate-500">
                {item === 'structure' ? fields.length : item === 'rules' ? rules.length : ''}
              </span>
            </button>
          ))}
        </div>
        {space === 'structure' && (
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(14rem,2fr)_repeat(3,minmax(9rem,1fr))_auto]">
          <label className="relative block">
            <span className="sr-only">{t('admin.search_variables')}</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setActiveGroup(''); }}
              placeholder={t('admin.search_variables_hint')}
              aria-label={t('admin.search_variables')}
            />
          </label>
          <label className="sr-only" htmlFor="template-section-filter">{t('admin.filter_section')}</label>
          <select id="template-section-filter" className="input" value={sectionFilter} onChange={(event) => { setSectionFilter(event.target.value); setActiveGroup(''); }} aria-label={t('admin.filter_section')}>
            <option value="">{t('admin.all_sections')}</option>
            <option value={COMMON_SECTION_FILTER}>{t('admin.common_filter')}</option>
            {sections.map((section) => <option key={section.sectionKey} value={section.sectionKey}>{sectionLabel(t, section)}</option>)}
          </select>
          <label className="sr-only" htmlFor="template-type-filter">{t('admin.filter_type')}</label>
          <select id="template-type-filter" className="input" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setActiveGroup(''); }} aria-label={t('admin.filter_type')}>
            <option value="">{t('admin.all_types')}</option>
            {FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(t, type)}</option>)}
          </select>
          <label className="sr-only" htmlFor="template-scope-filter">{t('admin.filter_scope')}</label>
          <select id="template-scope-filter" className="input" value={scopeFilter} onChange={(event) => { setScopeFilter(event.target.value); setActiveGroup(''); }} aria-label={t('admin.filter_scope')}>
            <option value="">{t('admin.all_scopes')}</option>
            {FIELD_SCOPES.map((scope) => <option key={scope} value={scope}>{t(`scope.${scope}`)}</option>)}
          </select>
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs text-slate-700">
            <input type="checkbox" checked={requiredOnly} onChange={(event) => { setRequiredOnly(event.target.checked); setActiveGroup(''); }} />
            {t('admin.filter_required')}
          </label>
        </div>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500" aria-live="polite">
          <span>{t(SAVE_STATE_KEYS[panelSaveState])}</span>
          {space === 'structure' && (
            <span>{t('admin.filtered_count').replace('{shown}', String(filteredFields.length)).replace('{total}', String(fields.length))}</span>
          )}
          {space === 'structure' && filtersActive && (
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
        onConfirm={() => { const action = leaving; setLeaving(null); action?.(); }}
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
      {moving && (
        <FieldMoveDialog
          field={moving}
          fields={fields}
          sections={sections}
          busy={busy}
          onCancel={() => setMoving(null)}
          onMove={(move) => void applyMove(moving, move)}
        />
      )}
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
      <div hidden={space !== 'structure'} id="editor-panel-structure" role="tabpanel" aria-labelledby="editor-space-structure">
        {/* Retour explicite vers l'espace d'ou l'on vient : un aller-retour ne doit jamais
            obliger a retrouver soi-meme son point de depart. */}
        {returnTo === 'rules' && <button type="button" className="btn-ghost mb-3" onClick={() => changeSpace('rules')}>← {t('editor.return_rules')}</button>}
        {returnTo === 'diagnosis' && <button type="button" className="btn-ghost mb-3" onClick={() => changeSpace('diagnosis')}>← {t('editor.return_diagnosis')}</button>}
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
              onClick={() => { const target = outOfFilter; resetFilters(); setOutOfFilter(null); setActiveGroup(''); scrollToField(target.id); }}
            >
              {t('admin.out_of_filter_action')}
            </button>
          </p>
        )}
        <EditorStructure
          groups={groups} activeKey={activeGroup} onSelect={selectGroup}
          displayedFields={displayedFields} allFields={fields} editable={editable} busy={busy}
          canReorder={displaySort === 'form' && !fieldFormOpen}
          onOpen={(field) => guardLeave(() => openFieldEditor(field))}
          onMove={setMoving} onStep={moveField} onDelete={setDeleting} onDrop={dropOn}
          onRules={(field) => openContextRules(field ? { field: field.fieldKey } : { group: activeGroup })}
          ruleCount={(field) => ruleCountByFieldId.get(field.id) ?? 0}
          context={inheritedRules.map((rule) => <p key={rule.id} className="text-sm text-slate-600"><RuleSummary rule={rule.rule} fields={fields} sections={sections} /></p>)}
          management={<><button type="button" className="btn-secondary mb-4" aria-expanded={managementOpen} onClick={() => setManagementOpen(!managementOpen)}>{t('editor.manage_structure')}</button>      <div hidden={!managementOpen} className="space-y-5" aria-label={t('editor.manage_structure')}>
      {/* UX-16 : les rubriques communes restent dans l'espace Structure/Sections : elles
          s'intercalent avec les blocs mais n'en deviennent jamais des sous-sections. */}
      {version.commonLayout === undefined && <p role="status" className="text-sm text-amber-800">{t('editor.layout_unavailable')}</p>}
      {version.commonLayout !== undefined && (
        <CommonLayoutEditor
          layout={version.commonLayout}
          onDirtyChange={setLayoutDirty}
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
          onDirtyChange={setSectionsDirty}
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
            setRuleFormOpen(true);
            // L'activation se decide dans l'espace Regles : on y conduit directement.
            setSpace('rules');
          }}
        />
      )}
      </div>

</>}
        />
        {fieldFormOpen && (
          <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
            {/* Fond cliquable pour la souris. Hors de l'arbre d'accessibilite : il portait le
                MEME nom que la croix, et « Fermer le panneau » designait alors deux commandes.
                Le clavier garde la croix et Echap, qui suffisent au dialogue modal. */}
            <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 bg-slate-950/30" onClick={() => guardLeave(closeFieldEditor)} />
            <aside
              ref={panelRef}
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
                    {editing && <p className="mt-1 break-words font-mono text-xs text-slate-500">{editing.fieldKey} · {t(`scope.${editing.scope}`)}</p>}
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
                      {editing.section && rules.filter((rule) => ruleParticipants(rule.rule).sections.includes(rootOf(editing.section!))).map((rule) => (
                        <div key={rule.id} className="mb-2"><p className="font-medium">{t('editor.inherited_condition')}</p><RuleSummary rule={rule.rule} fields={fields} sections={sections} /></div>
                      ))}
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
                        onClick={() => openContextRules({ field: editing.fieldKey })}
                      >
                        {t('admin.rules_open_space')}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <fieldset disabled={!editable || busy} className="min-w-0 flex-1 p-4">
                {editing ? (
                  <FieldForm
                    key={editing.id}
                    busy={busy || !editable}
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
                    onCancel={() => guardLeave(closeFieldEditor)}
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
                      defaultSection={selectedGroup?.common ? null : sections.some((section) => section.sectionKey === activeGroup) ? activeGroup : undefined}
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
              </fieldset>
            </aside>
          </div>
        )}
      </div>

      <div hidden={space !== 'rules'} ref={rulesRef} id="editor-panel-rules" role="tabpanel" aria-labelledby="editor-space-rules">
        {returnTo === 'diagnosis' && <button type="button" className="btn-ghost mb-3" onClick={() => changeSpace('diagnosis')}>← {t('editor.return_diagnosis')}</button>}
        {(ruleContext || returnTo === 'structure') && <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-ghost" onClick={() => changeSpace('structure')}>← {t('editor.return_structure')}</button>
          {ruleContext && <>
            <p className="text-sm">{t('editor.rules_context').replace('{context}', ruleContext.field
              ? fields.find((field) => field.fieldKey === ruleContext.field)?.label ?? ruleContext.field
              : groups.find((group) => group.key === ruleContext.group)?.label ?? ruleContext.group ?? '')}</p>
            <button type="button" className="btn-secondary" onClick={() => setRuleContext(null)}>{t('editor.rules_global')}</button>
          </>}
        </div>}
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          {/* Ajouter une regle sans traverser les regles existantes. */}
          {editable && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => guardRule(() => { setEditingRule(null); setDuplicateSource(null); setRuleFormOpen(true); window.setTimeout(() => ruleFormRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0); })}
            >
              {t('admin.rules_add')}
            </button>
          )}
        </div>
        {/* UX-14(b) : retrouver une regle par sa variable, son bloc, son type ou sa severite. */}
        <div hidden={!!ruleContext} className={!ruleContext ? 'mb-3 grid gap-2 md:grid-cols-[minmax(12rem,2fr)_repeat(2,minmax(9rem,1fr))] xl:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(9rem,1fr))]' : ''}>
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
          <select className="input" value={ruleRelation} aria-label={t('editor.rule_relation')} onChange={(event) => setRuleRelation(event.target.value)}>
            <option value="">{t('editor.rule_relation_all')}</option>
            <option value="source">{t('admin.rules_triggers')}</option>
            <option value="target">{t('admin.rules_targets')}</option>
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
            <li key={r.id} id={`rule-${r.id}`} className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 py-3">
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
                        onClick={() => revealRuleField(field)}
                      >
                        {field.label}
                      </button>
                    ))}
                  {ruleParticipants(r.rule).sections.map((key) => <button type="button" key={key} className="text-xs font-medium text-teal-700 underline underline-offset-2"
                    onClick={() => { setReturnTo('rules'); changeSpace('structure'); selectGroup(key); }}>
                    {t('editor.open_section').replace('{section}', groups.find((group) => group.key === key)?.label ?? key)}
                  </button>)}
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
                      onClick={() => guardRule(() => { setEditingRule(r); setDuplicateSource(null); setRuleFormOpen(true); window.setTimeout(() => ruleFormRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0); })}
                      className="text-xs font-medium text-teal-700 hover:underline"
                    >
                      {t('admin.edit_rule')}
                    </button>
                    {/* Une condition ne se ressaisit pas variable par variable : elle s'applique
                        a plusieurs cibles en une operation serveur. Une comparaison ou une
                        condition de bloc n'a pas de sens multicible : elle se duplique. */}
                    {isBatchSource(r.rule) && repo.previewRuleBatch && repo.createRuleBatch ? (
                      <button type="button" onClick={() => setBatchSource(r)}
                        className="text-xs font-medium text-teal-700 hover:underline">
                        {t('rulebatch.open')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => guardRule(() => { setEditingRule(null); setDuplicateSource(r); setRuleFormOpen(true); window.setTimeout(() => ruleFormRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0); })}
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
        {editable && ruleFormOpen && (
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
              key={`${ruleDraftRevision}-${editingRule?.id ?? (duplicateSource ? `duplicate-${duplicateSource.id}` : `new-rule-${activationSection ?? ''}`)}`}
              initialSectionTarget={editingRule ? null : activationSection}
              fields={fields}
              sections={sections}
              busy={busy}
              onDirtyChange={setRuleDirty}
              existingRules={editingRule ? rules.filter((rule) => rule.id !== editingRule.id) : rules}
              initialRule={editingRule?.rule ?? duplicateSource?.rule}
              initialMessage={editingRule?.message ?? duplicateSource?.message}
              initialSeverity={editingRule?.severity ?? duplicateSource?.severity}
              submitLabel={editingRule ? t('admin.save_rule') : undefined}
              onCancel={() => guardRule(closeRuleForm)}
              onSubmit={(rule, message, severity) => {
                if (editingRule) {
                  const editedId = editingRule.id;
                  void run(() => repo.updateRule(editedId, rule, message, severity)).then((ok) => {
                    if (!ok) return;
                    closeRuleForm();
                    // Revenir a la regle concernee, plutot que laisser l'ecran sur le formulaire.
                    window.setTimeout(() => document.getElementById(`rule-${editedId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
                  });
                } else {
                  void run(() => repo.addRule(version.id, rule, message, severity)).then((ok) => {
                    // Le bloc importe est desormais conditionne : le renvoi vers
                    // l'activation a fait son office et n'a plus lieu d'etre affiche.
                    if (ok) { setActivationSection(null); closeRuleForm(); }
                  });
                }
              }}
            />
          </div>
        )}
      </div>
      <div hidden={space !== 'diagnosis'} id="editor-panel-diagnosis" role="tabpanel" aria-labelledby="editor-space-diagnosis">
        {version.diagnosisConfiguration !== undefined
          ? <DiagnosisConfigurationEditor version={version} fields={fields} rules={rules} sections={sections} repo={repo} busy={busy} run={run}
              onDirtyChange={setDiagnosisDirty}
              // Le meme objet regle, ouvert la ou il se modifie : aucune seconde configuration.
              onOpenRule={(ruleId) => { setRuleContext(null); setReturnTo('diagnosis'); changeSpace('rules'); scrollToRule(ruleId); }}
              onOpenField={(fieldKey) => {
                const field = fields.find((candidate) => candidate.fieldKey === fieldKey);
                if (!field) return;
                setReturnTo('diagnosis'); changeSpace('structure');
                setActiveGroup(fieldGroupOf(field)?.key ?? '');
                scrollToField(field.id);
              }} />
          : <p role="status">{t('editor.diagnosis_unavailable')}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => { setRuleContext(null); setSpace('rules'); }}>{t('admin.rules_open_space')}</button>
          <button type="button" className="btn-secondary" onClick={() => changeSpace('preview')}>{t('preview.open')}</button>
        </div>
      </div>
      <div hidden={space !== 'preview'} id="editor-panel-preview" role="tabpanel" aria-labelledby="editor-space-preview">
        {previewVisited && <FormPreview version={version} fields={fields} rules={rules} sections={sections} onClose={() => changeSpace('structure')} />}
      </div>
    </section>
  );
}
