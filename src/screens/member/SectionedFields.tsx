import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { groupFieldsBySection, maskedRepeatableSectionKeys, sectionLabel, withRepeatableSteps, type SectionGroup } from '../../domain/templateSections';
import { calculateFormProgress } from '../../domain/formProgress';
import { useI18n } from '../../i18n/useI18n';
import { ValidationSummary } from '../../components/ValidationSummary';
import { BottomSheet } from '../../components/BottomSheet';
import { findProposalField, isProposalSource, proposalKeysOf } from '../../domain/proposalField';
import { arrangeOptionGroups, flattenOptionNodes, type OptionNode } from '../../domain/optionGroups';

const NO_VALUES: Record<string, unknown> = {};
const NO_RULES: readonly ValidationRule[] = [];
const NO_HIDDEN: ReadonlySet<string> = new Set();
const NO_TO_FILL: ReadonlySet<string> = new Set();

/** Le focus differe attend que le bloc vise soit affiche. Les demandes du composant partagent
 * un seul creneau : la plus recente remplace la precedente. Si l utilisateur a lui-meme pris
 * la main entre-temps, la lui reprendre lui ferait perdre sa frappe — on lui laisse son champ. */
function deferFocus(frame: { current: number | null }, move: () => void) {
  if (frame.current !== null) cancelAnimationFrame(frame.current);
  const focusedBefore = document.activeElement;
  frame.current = requestAnimationFrame(() => {
    frame.current = null;
    const focusedNow = document.activeElement;
    if (focusedNow && focusedNow !== focusedBefore && focusedNow !== document.body) return;
    move();
  });
}

function FieldFrame({ id, fieldKey, message, children }: { id: string; fieldKey: string; message?: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    frame.current?.querySelectorAll<HTMLElement>('input,select,textarea,button[aria-haspopup="dialog"],[role="combobox"]').forEach((control) => {
      if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
      const descriptions = (control.getAttribute('aria-describedby') ?? '').split(' ').filter((value) => value && value !== `${id}-error`);
      if (message) descriptions.push(`${id}-error`);
      if (descriptions.length) control.setAttribute('aria-describedby', descriptions.join(' ')); else control.removeAttribute('aria-describedby');
    });
  });
  return <div ref={frame} id={id} data-field-key={fieldKey} tabIndex={-1} className="min-w-0 scroll-mt-24 space-y-1 rounded-lg focus-visible:outline-2 focus-visible:outline-teal-700">
    {children}
    {message && <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-300">{message}</p>}
  </div>;
}

/** The visible groups never own answers. Collapsing or single-block presentation keeps
 * controls mounted; applicability is provided by the existing engine in the caller. */
export function SectionedFields({ fields, renderField, sections, values, allFields, rules = NO_RULES,
  hiddenKeys = NO_HIDDEN, requireComplete = false, commonLayout, leadingBlock, toFillKeys = NO_TO_FILL, repeatableGroup,
  visibilityRules, maskedRepeatableGroup, focusFieldKey }: {
  fields: TemplateField[];
  renderField: (field: TemplateField) => ReactNode;
  sections?: readonly TemplateSection[] | null;
  commonLayout?: TemplateCommonLayout | null;
  values?: Record<string, unknown>;
  allFields?: readonly TemplateField[];
  rules?: readonly ValidationRule[];
  hiddenKeys?: ReadonlySet<string>;
  requireComplete?: boolean;
  /** Presentation only: identity never enters template fields, rules or analytical progress. */
  leadingBlock?: { label: string; content: ReactNode };
  /** E5 — variables ajoutées après l'enregistrement de la fiche et encore vides. L'ensemble
   * vient de l'appelant, qui le tient du contexte serveur ; ce composant ne fait que le
   * compter, l'annoncer et y conduire. Aucune valeur n'est proposée. */
  toFillKeys?: ReadonlySet<string>;
  /**
   * L68 — rendu d'un bloc REPETABLE. Un tel bloc decrit une occurrence, pas la fiche : ses
   * variables ne se saisissent pas une a une ici, le tableau d'occurrences les porte. Sans ce
   * rendu — ecran de rencontre, creation de patient — aucun bloc repetable n'est intercale et
   * le formulaire garde exactement le comportement qu'il avait.
   */
  repeatableGroup?: (section: TemplateSection) => ReactNode;
  /**
   * L72 — regles qui ont calcule `hiddenKeys`, quand elles different de `rules` (une fiche
   * historique valide avec les regles de sa version mais s'affiche avec les regles actives).
   * Elles decident si le bloc parent d'un groupe est masque ; par defaut, `rules`.
   */
  visibilityRules?: readonly { rule: unknown }[];
  /**
   * L72 D10 — contenu d'un groupe dont le bloc est masque. `null` retire l'etape ; sans ce
   * rendu, un groupe masque disparait avec son bloc. L'etape n'est jamais un lieu de saisie :
   * elle annonce des occurrences deja enregistrees, que l'ecran laisse supprimer une a une.
   */
  maskedRepeatableGroup?: (section: TemplateSection) => ReactNode;
  /**
   * Champ a ouvrir des l'affichage (lien « Coder » de « Diagnostics a coder ») : son bloc
   * s'affiche et le champ prend le focus, une seule fois. Absent de ce formulaire : ignore.
   */
  focusFieldKey?: string | null;
}) {
  const { t } = useI18n();
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupFieldsBySection(fields, sections, commonLayout), [fields, sections, commonLayout]);
  // Le bloc clinique porte encore la règle d'applicabilité, mais chaque sous-section devient
  // une étape de saisie. Un parent vide reste un contexte dans le sommaire et au-dessus de
  // ses enfants, sans créer une étape vide. Les groupes communs UX-16 sont des racines et
  // restent des étapes distinctes, sans changer leur section sémantique.
  const formGroups = useMemo(() => {
    const roots = groups.filter((group) => !group.parentSectionKey || !groups.some((candidate) => candidate.key === group.parentSectionKey));
    const childrenByParent = new Map<string, SectionGroup<TemplateField>[]>();
    for (const group of groups) if (group.parentSectionKey) {
      const children = childrenByParent.get(group.parentSectionKey) ?? [];
      children.push(group);
      childrenByParent.set(group.parentSectionKey, children);
    }
    const result: SectionGroup<TemplateField>[] = [];
    const visited = new Set<string>();
    const visit = (group: SectionGroup<TemplateField>) => {
      if (visited.has(group.key)) return;
      visited.add(group.key);
      if (group.fields.length > 0) result.push(group);
      for (const child of childrenByParent.get(group.key) ?? []) visit(child);
    };
    for (const root of roots) visit(root);
    // Une hierarchie mal formee peut laisser un groupe visible sans racine declarée. Le garder
    // accessible évite de perdre silencieusement ses variables.
    for (const group of groups) visit(group);
    return result;
  }, [groups]);
  // Les blocs repetables reprennent leur place parmi les autres blocs (§8.1). Ils ne portent
  // aucune variable saisissable sur la fiche, donc `groupFieldsBySection` ne les voit pas.
  // L72 — un groupe enfant herite de la visibilite de son bloc : decidee ici, sur la section,
  // pour que chaque ecran qui confie ses groupes a ce composant en herite sans calcul propre.
  const rulesForVisibility = visibilityRules ?? rules;
  const masked = useMemo(
    () => (repeatableGroup
      ? maskedRepeatableSectionKeys(sections, rulesForVisibility, values ?? NO_VALUES, hiddenKeys)
      : new Set<string>()),
    [repeatableGroup, sections, rulesForVisibility, values, hiddenKeys],
  );
  const formSteps = useMemo(
    () => withRepeatableSteps(formGroups, repeatableGroup ? sections : null, masked, commonLayout),
    [formGroups, sections, repeatableGroup, masked, commonLayout],
  );
  // L74 — sous une liste multiple, les variables qu'elle fait apparaitre se regroupent par
  // option. Le meme arbre sert au rendu et a l'ordre de parcours : « suivant » suit l'affichage.
  const optionTrees = useMemo(() => {
    const ruleList = rulesForVisibility.map((entry) => entry.rule);
    const companions = proposalKeysOf(allFields ?? fields);
    return new Map(formGroups.map((group) => [group.key, arrangeOptionGroups(group.fields, ruleList, companions)]));
  }, [formGroups, rulesForVisibility, allFields, fields]);
  const displayRank = useMemo(() => {
    const ranks = new Map<string, number>();
    for (const group of formGroups) {
      for (const field of flattenOptionNodes(optionTrees.get(group.key) ?? [])) ranks.set(field.fieldKey, ranks.size);
    }
    return ranks;
  }, [formGroups, optionTrees]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  // Lot 2 (5.6-B) : sur telephone, le sommaire s'ouvre en panneau bas au lieu de repousser le formulaire.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [single, setSingle] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [nativeIssue, setNativeIssue] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const previousGroups = useRef<string[] | null>(null);
  const currentField = useRef<string | null>(null);
  const leadingKey = `${id}-leading`;
  type Step = { key: string; group: SectionGroup<TemplateField> | null; repeatable: TemplateSection | null; maskedContent?: ReactNode };
  // D10 — un groupe masque ne reste une etape que si l'ecran a quelque chose de reel a en dire.
  const contentSteps: Step[] = formSteps.flatMap((step): Step[] => {
    if (step.kind === 'fields') return [{ key: step.group.key, group: step.group, repeatable: null }];
    if (!step.masked) return [{ key: step.section.sectionKey, group: null, repeatable: step.section }];
    const maskedContent = maskedRepeatableGroup?.(step.section);
    return maskedContent === null || maskedContent === undefined || maskedContent === false ? []
      : [{ key: step.section.sectionKey, group: null, repeatable: step.section, maskedContent }];
  });
  const steps: Step[] = leadingBlock ? [{ key: leadingKey, group: null, repeatable: null }, ...contentSteps] : contentSteps;
  const active = steps.some((root) => root.key === current) ? current : steps[0]?.key ?? null;
  const revealingInvalid = useRef(false);
  const focusFrame = useRef<number | null>(null);
  const stepFor = (key: string) => {
    const source = (allFields ?? fields).find((field) => isProposalSource(field) && findProposalField(allFields ?? fields, field)?.fieldKey === key);
    const fieldKey = source?.fieldKey ?? key;
    return formGroups.find((group) => group.fields.some((field) => field.fieldKey === fieldKey))?.key ?? null;
  };
  // Une variable compagnon se range avec sa source, juste apres elle.
  const rankOf = (key: string) => {
    const own = displayRank.get(key);
    if (own !== undefined) return own;
    const source = (allFields ?? fields).find((field) => isProposalSource(field) && findProposalField(allFields ?? fields, field)?.fieldKey === key);
    const sourceRank = source ? displayRank.get(source.fieldKey) : undefined;
    return sourceRank === undefined ? Number.MAX_SAFE_INTEGER : sourceRank + 0.5;
  };
  const byDisplay = (keys: readonly string[]) => [...keys].sort((a, b) => rankOf(a) - rankOf(b));
  const fieldId = (key: string) => `${id}-field-${key}`;
  const groupId = (key: string) => `${id}-group-${key}`;
  const label = (key: string) => {
    if (key === leadingKey && leadingBlock) return leadingBlock.label;
    const group = groups.find((candidate) => candidate.key === key);
    // Un bloc repetable ne porte pas de groupe de variables : son libelle vient de la section
    // declaree, jamais d'une chaine traduite (§8.6).
    const declared = (sections ?? []).find((candidate) => candidate.sectionKey === key);
    return sectionLabel(t, { sectionKey: key, label: group?.label ?? declared?.label });
  };
  const progress = useMemo(() => calculateFormProgress(allFields ?? fields, values ?? NO_VALUES, rules, hiddenKeys, requireComplete),
    [allFields, fields, values, rules, hiddenKeys, requireComplete]);
  const visibleIssues = progress.issues.filter((issue) => submitted || touched.has(issue.fieldKey));
  const issueByKey = new Map(visibleIssues.map((issue) => [issue.fieldKey, issue.message]));
  // Une variable annoncée mais absente du rendu courant (bloc masqué, autre portée) ne serait
  // atteignable par aucune étape : elle sort du compte au lieu de promettre un chemin inexistant.
  const toFillSteps = byDisplay([...toFillKeys].filter((key) => stepFor(key)));

  const reveal = (rootKey: string, targetKey?: string) => {
    setCollapsed((before) => { const next = new Set(before); next.delete(rootKey); return next; });
    setCurrent(rootKey); setSheetOpen(false);
    deferFocus(focusFrame, () => {
      const target = document.getElementById(targetKey ? fieldId(targetKey) : groupId(rootKey))
        ?? [...(host.current?.querySelectorAll<HTMLElement>('[data-proposal-key]') ?? [])].find((node) => node.dataset.proposalKey === targetKey);
      const control = targetKey ? target?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button[aria-haspopup="dialog"],[role="combobox"],output') : target;
      if (control?.tagName === 'OUTPUT') control.tabIndex = -1;
      (control ?? target)?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    });
  };
  const goToField = (key: string) => { const step = stepFor(key); if (step) reveal(step, key); };

  // Un groupe masque n'est pas « disponible » : il n'annonce que ce qui y reste enregistre.
  const groupKeys = contentSteps.filter((step) => step.maskedContent === undefined).map((step) => step.key).join('|');
  useEffect(() => {
    const next = groupKeys ? groupKeys.split('|') : [];
    if (previousGroups.current) {
      const added = next.find((key) => !previousGroups.current!.includes(key));
      if (added) setNewGroup(added);
    }
    previousGroups.current = next;
  }, [groupKeys]);
  // Lot 2 (5.6-B) : quand le formulaire porte une barre d'action (FormActionBar), la navigation
  // de blocs y prend place, toujours a portee de pouce ; sinon (apercu, curation), elle reste
  // sous le bloc. La barre est rendue avec le formulaire : on la cherche des que les champs
  // existent (sans champ, ce composant ne rend rien et n'a pas de formulaire ou chercher).
  const [navSlots, setNavSlots] = useState<{ prev: HTMLElement; next: HTMLElement } | null>(null);
  const hasSteps = steps.length > 0;
  useLayoutEffect(() => {
    const form = host.current?.closest('form');
    const prev = form?.querySelector<HTMLElement>('[data-form-nav="prev"]') ?? null;
    const next = form?.querySelector<HTMLElement>('[data-form-nav="next"]') ?? null;
    setNavSlots(prev && next ? { prev, next } : null);
  }, [hasSteps]);
  useEffect(() => {
    const form = host.current?.closest('form');
    if (!form) return;
    const onSubmit = () => {
      setSubmitted(true);
      deferFocus(focusFrame, () => host.current?.querySelector<HTMLElement>('[data-validation-summary]')?.focus());
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);
  const focusedOnce = useRef(false);
  const focusStep = focusFieldKey ? stepFor(focusFieldKey) : null;
  useEffect(() => {
    if (!focusFieldKey || !focusStep || focusedOnce.current) return;
    focusedOnce.current = true;
    goToField(focusFieldKey);
    // `goToField` ne lit que l'etat courant des etapes, deja resume par `focusStep`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFieldKey, focusStep]);

  if (steps.length === 0) return null;
  const rootIndex = steps.findIndex((root) => root.key === active);
  const nextMissing = () => {
    const candidates = byDisplay(progress.missingKeys.filter((key) => stepFor(key)));
    const index = currentField.current ? candidates.indexOf(currentField.current) : -1;
    const key = candidates[(index + 1) % candidates.length];
    if (key) goToField(key);
  };
  const nextToFill = () => {
    const index = currentField.current ? toFillSteps.indexOf(currentField.current) : -1;
    const key = toFillSteps[(index + 1) % toFillSteps.length];
    if (key) goToField(key);
  };
  // Compte d'un bloc : requis restants, erreurs, variables ajoutees a renseigner.
  const statsText = (root: Step) => {
    if (values === undefined || root.key === leadingKey) return null;
    const keys = new Set(root.group?.fields.map((field) => field.fieldKey) ?? []);
    const missing = progress.missingKeys.filter((key) => keys.has(key)).length;
    const errors = visibleIssues.filter((issue) => keys.has(issue.fieldKey)).length;
    const toFill = toFillSteps.filter((key) => keys.has(key)).length;
    if (missing === 0 && errors === 0 && toFill === 0) return null;
    return `${t('form.required_remaining').replace('{n}', String(missing))}${errors > 0 ? ` · ${t('form.section_errors').replace('{n}', String(errors))}` : ''}${toFill > 0 ? ` · ${t('form.to_fill_remaining').replace('{n}', String(toFill))}` : ''}`;
  };
  const showProgress = values !== undefined && (progress.requiredKeys.size > 0 || visibleIssues.length > 0 || toFillSteps.length > 0);
  // Le compte complet reste la phrase lue (spec UX §5.1) ; l'ecran en montre la forme courte.
  const progressFull = `${progress.requiredKeys.size === 0 ? t('form.section_required_none')
    : t('form.section_required_count').replace('{done}', String(progress.filledRequired)).replace('{total}', String(progress.requiredKeys.size))}${
    visibleIssues.length > 0 ? ` — ${t('form.section_errors').replace('{n}', String(visibleIssues.length))}` : ''}${
    toFillSteps.length > 0 ? ` — ${t('form.to_fill_count').replace('{n}', String(toFillSteps.length))}` : ''}`;
  const progressShort = [
    progress.requiredKeys.size === 0 ? null
      : t('form.required_short').replace('{done}', String(progress.filledRequired)).replace('{total}', String(progress.requiredKeys.size)),
    visibleIssues.length > 0 ? t('form.section_errors').replace('{n}', String(visibleIssues.length)) : null,
    toFillSteps.length > 0 ? t('form.to_fill_remaining').replace('{n}', String(toFillSteps.length)) : null,
  ].filter(Boolean).join(' · ') || t('form.section_required_none');
  const renderNodes = (nodes: readonly OptionNode<TemplateField>[]): ReactNode => nodes.map((node) => node.kind === 'field'
    ? <FieldFrame key={node.field.id} id={fieldId(node.field.fieldKey)} fieldKey={node.field.fieldKey} message={issueByKey.get(node.field.fieldKey)}>{renderField(node.field)}</FieldFrame>
    // L74 D8 — une precision du pilote, pas un nouveau bloc : retrait leger et filet a gauche,
    // titre en petit gras, aucun encadre. Retrait reduit sur un ecran etroit.
    : <fieldset key={node.key} data-option-group={node.key}
      className="min-w-0 space-y-5 border-l-2 border-slate-200 pl-2 @min-[28rem]:pl-4 dark:border-slate-700">
      <legend className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{node.label}</legend>
      {renderNodes(node.children)}
    </fieldset>);
  const blockList = (onSelect: (key: string) => void, withStatus: boolean) => (
    <ol className="space-y-1 border-l-2 border-slate-200 pl-2 dark:border-slate-700">
      {steps.map((root) => {
        const status = withStatus ? statsText(root) : null;
        return <li key={root.key}><button type="button" aria-current={active === root.key ? 'location' : undefined}
          className={`min-h-11 w-full rounded-lg px-2 py-1.5 text-left text-sm ${active === root.key ? 'bg-teal-50 font-semibold text-teal-900 dark:bg-teal-950 dark:text-teal-100' : 'text-slate-600 dark:text-slate-300'}`}
          onClick={() => onSelect(root.key)}>
          {label(root.key)}
          {status && <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{status}</span>}
        </button></li>;
      })}
    </ol>
  );
  // « Un bloc a la fois » (le defaut) et tout deplier/replier vivent avec le sommaire : ils
  // reglent la navigation entre blocs, pas la saisie.
  const modeControls = <div className="mt-3 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
    {steps.length > 1 && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
      <input type="checkbox" checked={single} onChange={(event) => setSingle(event.target.checked)} className="h-4 w-4 accent-teal-700" />
      {t('form.single_block')}
    </label>}
    {!single && <div className="flex flex-wrap gap-1">
      <button type="button" className="btn-ghost min-h-11" onClick={() => setCollapsed(new Set())}>{t('form.expand_all')}</button>
      <button type="button" className="btn-ghost min-h-11" onClick={() => setCollapsed(new Set(steps.map((root) => root.key)))}>{t('form.collapse_all')}</button>
    </div>}
  </div>;
  return <div ref={host} className="@container/sections space-y-4"
    onInvalidCapture={(event) => {
      event.preventDefault();
      if (revealingInvalid.current) return;
      revealingInvalid.current = true;
      setSubmitted(true);
      const control = event.target as HTMLElement;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
        const controlLabel = (control.labels?.[0]?.querySelector('span') ?? control.labels?.[0])?.textContent?.trim();
        setNativeIssue(`${controlLabel ? `${controlLabel} : ` : ''}${control.validationMessage}`);
      }
      const key = control.closest<HTMLElement>('[data-field-key]')?.dataset.fieldKey;
      const root = key ? stepFor(key) : leadingBlock ? leadingKey : null;
      if (root) reveal(root, key);
      requestAnimationFrame(() => { control.focus(); revealingInvalid.current = false; });
    }}
    onInputCapture={() => setNativeIssue(null)}
    onFocusCapture={(event) => {
      const field = (event.target as HTMLElement).closest<HTMLElement>('[data-field-key]');
      if (!field?.dataset.fieldKey) return;
      currentField.current = field.dataset.fieldKey;
      // Une variable inconnue de CE formulaire — celles du formulaire d'occurrence d'un bloc
      // repetable, rendues par un moteur imbrique — ne doit pas ramener l'ecran au premier
      // bloc : la personne perdrait le groupe dans lequel elle est en train de saisir.
      const step = stepFor(field.dataset.fieldKey);
      if (step) setCurrent(step);
    }}
    onBlurCapture={(event) => {
      const key = (event.target as HTMLElement).closest<HTMLElement>('[data-field-key]')?.dataset.fieldKey;
      if (key) setTouched((before) => new Set(before).add(key));
    }}>
    {/* Lot 2 (5.6-B) : une seule ligne avant le premier champ — bloc courant, avancement, et
        acces au prochain champ obligatoire manquant. */}
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {steps.length > 1 && <button type="button" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}
        className="btn-secondary min-w-0 max-w-full justify-start @min-[52rem]/sections:hidden">
        <span className="sr-only">{t('form.contents')} : </span>
        <span className="truncate">{rootIndex + 1}/{steps.length} · {label(steps[rootIndex]?.key ?? steps[0].key)}</span>
        <ChevronDown size={16} aria-hidden className="shrink-0" />
      </button>}
      {showProgress && <span className="text-xs text-slate-600 dark:text-slate-300">
        <span aria-hidden="true">{progressShort}</span>
        <span className="sr-only">{progressFull}</span>
      </span>}
      {progress.missingKeys.length > 0 && <button type="button" onClick={nextMissing} aria-label={t('form.next_missing')} title={t('form.next_missing')}
        className="icon-button shrink-0 border border-slate-300 text-teal-700 dark:border-slate-700 dark:text-teal-300">
        <ArrowRight size={16} aria-hidden />
      </button>}
      {toFillSteps.length > 0 && <button type="button" className="btn-secondary" onClick={nextToFill}>
        {t('form.next_to_fill')}
      </button>}
    </div>
    {newGroup && contentSteps.some((step) => step.key === newGroup) && <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-teal-800 dark:text-teal-200">
      <span>{t('form.block_available')} {label(newGroup)}</span>
      <button type="button" className="btn-ghost min-h-11" onClick={() => { reveal(newGroup); setNewGroup(null); }}>{t('form.go_to_block')}</button>
    </div>}
    {nativeIssue && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{nativeIssue}</p>}
    {submitted && <ValidationSummary errors={visibleIssues.filter((issue) => stepFor(issue.fieldKey))
      .sort((a, b) => rankOf(a.fieldKey) - rankOf(b.fieldKey)).map((issue) => ({
      id: issue.fieldKey, targetId: fieldId(issue.fieldKey), label: (allFields ?? fields).find((field) => field.fieldKey === issue.fieldKey)?.label ?? issue.fieldKey,
      message: issue.message,
    }))} onNavigate={(issue) => goToField(issue.id)} />}
    <div className="grid min-w-0 gap-4 @min-[52rem]/sections:grid-cols-[13rem_minmax(0,1fr)]">
      <nav id={`${id}-contents`} aria-label={t('form.contents')} className="hidden self-start @min-[52rem]/sections:block">
        {blockList((key) => reveal(key), false)}
        {modeControls}
      </nav>
      <div className="min-w-0 space-y-4">
        {steps.map((root) => {
          const group = root.group;
          const status = statsText(root);
          const expanded = single ? active === root.key : !collapsed.has(root.key);
          return <fieldset key={root.key} hidden={single && active !== root.key} aria-labelledby={`${groupId(root.key)}-title`}
            className="min-w-0 rounded-xl border border-slate-200 px-4 pb-4 dark:border-slate-700">
            <legend className="max-w-full px-1">
              {/* Un bloc a la fois : replier le seul bloc affiche n'aurait pas de sens, le titre
                  n'est donc plus un bouton (5.6). Il reste la cible du focus quand on y va. */}
              {single ? <span id={groupId(root.key)} tabIndex={-1}
                className="flex min-h-11 max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm font-semibold text-slate-800 outline-none dark:text-slate-100">
                <span id={`${groupId(root.key)}-title`}>{label(root.key)}</span>
                {status && <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{status}</span>}
              </span> : <button id={groupId(root.key)} type="button" aria-expanded={expanded} aria-controls={`${groupId(root.key)}-body`}
                className="flex min-h-11 max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm font-semibold text-slate-800 dark:text-slate-100"
                onClick={() => { setCurrent(root.key); setCollapsed((before) => { const next = new Set(before); if (next.has(root.key)) next.delete(root.key); else next.add(root.key); return next; }); }}>
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span><span id={`${groupId(root.key)}-title`}>{label(root.key)}</span>
                {status && <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{status}</span>}
              </button>}
            </legend>
            <div id={`${groupId(root.key)}-body`} hidden={!expanded} className="@container space-y-5">
              {root.key === leadingKey && leadingBlock?.content}
              {/* Un groupe enfant se lit comme une sous-section : le libelle de son bloc au-dessus (D9). */}
              {(group?.parentSectionKey ?? root.repeatable?.parentSectionKey) && (
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {label((group?.parentSectionKey ?? root.repeatable?.parentSectionKey)!)}
                </p>
              )}
              {root.repeatable && (root.maskedContent ?? repeatableGroup?.(root.repeatable))}
              {group && renderNodes(optionTrees.get(group.key) ?? [])}
            </div>
          </fieldset>;
        })}
        {single && !navSlots && <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-secondary" disabled={rootIndex <= 0} onClick={() => reveal(steps[rootIndex - 1].key)}>{t('form.previous_block')}</button>
          <span className="text-xs text-slate-500">{rootIndex + 1} / {steps.length}</span>
          <button type="button" className="btn-secondary" disabled={rootIndex >= steps.length - 1} onClick={() => reveal(steps[rootIndex + 1].key)}>{t('form.next_block')}</button>
        </div>}
      </div>
    </div>
    {single && steps.length > 1 && navSlots && <>
      {createPortal(<button type="button" disabled={rootIndex <= 0} onClick={() => reveal(steps[rootIndex - 1].key)}
        aria-label={t('form.previous_block')} title={t('form.previous_block')}
        className="icon-button shrink-0 border border-slate-300 dark:border-slate-700">
        <ChevronLeft size={18} aria-hidden />
      </button>, navSlots.prev)}
      {createPortal(<button type="button" disabled={rootIndex >= steps.length - 1} onClick={() => reveal(steps[rootIndex + 1].key)}
        className="btn-secondary shrink-0 max-sm:px-3">
        <span className="max-sm:sr-only">{t('form.next_block')}</span>
        <ChevronRight size={16} aria-hidden />
      </button>, navSlots.next)}
    </>}
    {sheetOpen && <BottomSheet title={t('form.contents')} onClose={() => setSheetOpen(false)}>
      {/* Le panneau se ferme d'abord : le focus rendu au bouton du sommaire, le bloc choisi le prend. */}
      {blockList((key) => { setSheetOpen(false); requestAnimationFrame(() => reveal(key)); }, true)}
      {modeControls}
    </BottomSheet>}
  </div>;
}
