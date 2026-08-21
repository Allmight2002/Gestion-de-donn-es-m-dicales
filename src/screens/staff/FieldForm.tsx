import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { VALUE_SET_LIBRARY } from '../../domain/valueSetLibrary';
import { fieldOptions, makeValueKey, optionKeys, type FieldOption } from '../../domain/fieldOptions';
import { OptionsEditor } from './OptionsEditor';
import { makeProposalField } from '../../domain/proposalField';
import { NOW_TOKEN, TODAY_TOKEN, defaultValueRisk, supportsDefaultValue } from '../../domain/fieldDefaults';
import { HISTORIC_MISSING_CODES, MISSING_CODES, allowedMissingReasons, type MissingCode } from '../../domain/validation';
import {
  FORMULA_OPERATORS,
  checkFieldFormula,
  composeFormula,
  formulaProblemKey,
  operandCandidates,
  parseFormula,
  type FormulaOperator,
} from '../../domain/fieldFormula';
import type { FieldScope, FieldSection, FieldType, NewField, TemplateField, TemplateSection } from '../../data/types';
import type { ObservationModel } from '../../data/bases';
import { LEGACY_SECTION_KEYS, sectionLabel } from '../../domain/templateSections';
import { fieldTypeLabel } from '../../domain/templateLabels';
import { Checkbox } from '../../components/Checkbox';

const SCOPES: FieldScope[] = ['patient', 'encounter'];
const TYPES: FieldType[] = ['number', 'integer', 'text', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'terminology'];
const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;

const inputCls = 'input';

/** Valeur du selecteur d'operande designant « une constante », par opposition a une variable. */
const LITERAL_CHOICE = '__literal__';

export function FieldForm({
  onSubmit,
  onSubmitAndNext,
  busy,
  initial,
  lockStructural = false,
  submitLabel,
  submitAndNextLabel,
  onCancel,
  observationModel = 'longitudinal',
  sections,
  fields = [],
  }: {
  /** `companion` : champ compagnon « valeur proposée » à créer juste après le champ source. */
  onSubmit: (f: NewField, companion?: NewField) => void | boolean | Promise<void | boolean>;
  /** Variante utilisée par l’éditeur pour enregistrer puis sélectionner la variable suivante. */
  onSubmitAndNext?: (f: NewField, companion?: NewField) => void | boolean | Promise<void | boolean>;
  busy?: boolean;
  /** Pre-remplissage en mode edition (null/absent = creation). */
  initial?: NewField | null;
  /** Variable deja utilisee : nom interne / portee / type verrouilles (seul le libelle change). */
  lockStructural?: boolean;
  submitLabel?: string;
  submitAndNextLabel?: string;
  onCancel?: () => void;
  observationModel?: ObservationModel;
  /** Sections de la version (L31). Absentes -> les trois codes historiques, comme avant le lot. */
  sections?: readonly TemplateSection[] | null;
  /**
   * Variables DEJA presentes dans la version (L35) : ce sont les operandes possibles d'une
   * variable calculee. Absentes -> le bloc « variable calculee » n'est pas propose, faute de
   * quoi que ce soit a calculer.
   */
  fields?: readonly TemplateField[];
}) {
  const { t } = useI18n();
  const editing = !!initial;
  const isCrossSectional = observationModel === 'cross_sectional';
  // Un ecran sans liste chargee reste utilisable : il propose les trois sections
  // historiques, exactement ce qu'il proposait avant le lot.
  const sectionChoices: { sectionKey: string; label: string }[] = sections?.length
    ? sections.map((s) => ({ sectionKey: s.sectionKey, label: s.label }))
    : LEGACY_SECTION_KEYS.map((key) => ({ sectionKey: key, label: key }));
  const [fieldKey, setFieldKey] = useState(initial?.fieldKey ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [scope, setScope] = useState<FieldScope>(isCrossSectional ? 'patient' : (initial?.scope ?? 'encounter'));
  // Une base qui a supprime « clinique » ne doit pas se voir proposer une section qui
  // n'existe plus : a defaut de valeur initiale, on prend la PREMIERE de la version.
  const [section, setSection] = useState<FieldSection>(
    initial?.section ?? sections?.[0]?.sectionKey ?? 'clinique',
  );
  const [type, setType] = useState<FieldType>(initial?.type ?? 'text');
  const [required, setRequired] = useState(initial?.required ?? false);
  // L21 : cardinalite du champ. Structurelle, donc soumise a `lockStructural` comme le type
  // et la portee -- une variable deja utilisee ne bascule pas entre valeur unique et liste.
  const [isMultiple, setIsMultiple] = useState(initial?.isMultiple ?? false);
  const [encounterTypes, setEncounterTypes] = useState<string[]>(initial?.encounterTypes ?? []);
  // L30 : la liste n'est plus du texte libre mais des options { code, libelle, actif }.
  // `fieldOptions` retombe sur l'ancienne liste de chaines quand la variable est
  // anterieure au lot -- cle = libelle, exactement le comportement d'avant.
  const [options, setOptions] = useState<FieldOption[]>(() => fieldOptions(initial));
  const [valueSetId, setValueSetId] = useState('');
  const [withProposal, setWithProposal] = useState(false);
  const [minValue, setMinValue] = useState(initial?.minValue != null ? String(initial.minValue) : '');
  const [maxValue, setMaxValue] = useState(initial?.maxValue != null ? String(initial.maxValue) : '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  // A la creation, les trois raisons historiques sont PRE-COCHEES mais la case maitresse
  // reste decochee : une variable neuve n'accepte toujours aucune valeur manquante tant que
  // personne ne le demande, exactement comme avant ce lot.
  const [missingReasons, setMissingReasons] = useState<MissingCode[]>(
    initial ? allowedMissingReasons(initial) : [],
  );
  const [allowMissingCodes, setAllowMissingCodes] = useState(
    initial ? allowedMissingReasons(initial).length > 0 : false,
  );
  const [missingOpen, setMissingOpen] = useState(Boolean(initial?.allowMissingCodes));
  const [defaultValue, setDefaultValue] = useState(initial?.defaultValue ?? '');

  // --- L35 : variable calculee ---------------------------------------------------------
  // Trois selecteurs guides, jamais une expression a taper : la liste n'offre que des
  // operandes admissibles, donc un operande inconnu ou une autre variable calculee sont
  // impossibles a choisir. La formule ENREGISTREE reste du texte canonique (« a - b »),
  // relu par le meme `parseFormula` cote serveur et cote export.
  const initialFormula = parseFormula(initial?.formula);
  const [calculated, setCalculated] = useState(Boolean(initialFormula));
  const [formulaOpen, setFormulaOpen] = useState(Boolean(initialFormula));
  const [leftOperand, setLeftOperand] = useState(
    initialFormula ? (initialFormula.left.kind === 'field' ? initialFormula.left.fieldKey : LITERAL_CHOICE) : '',
  );
  const [leftLiteral, setLeftLiteral] = useState(
    initialFormula && initialFormula.left.kind === 'literal' ? String(initialFormula.left.value) : '',
  );
  const [formulaOperator, setFormulaOperator] = useState<FormulaOperator>(initialFormula?.operator ?? '-');
  const [rightOperand, setRightOperand] = useState(
    initialFormula ? (initialFormula.right.kind === 'field' ? initialFormula.right.fieldKey : LITERAL_CHOICE) : '',
  );
  const [rightLiteral, setRightLiteral] = useState(
    initialFormula && initialFormula.right.kind === 'literal' ? String(initialFormula.right.value) : '',
  );

  const isChoice = type === 'select' || type === 'multiselect';
  // Les listes conservent leur perimetre historique (rencontre). L4 etend uniquement la
  // terminologie, pour laquelle la soupape est utile aussi dans les donnees permanentes.
  const supportsProposal = type === 'terminology' || (isChoice && scope === 'encounter');
  const isNumber = type === 'number' || type === 'integer';
  const toggleEncType = (x: string) =>
    setEncounterTypes((prev) => (prev.includes(x) ? prev.filter((y) => y !== x) : [...prev, x]));
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
  // La case maitresse ferme tout ; sinon la liste fait foi. Cocher la case sans choisir de
  // raison revient a demander les trois historiques : c'est ce que faisait le booleen seul.
  const effectiveMissingReasons = !allowMissingCodes
    ? []
    : missingReasons.length > 0
      ? MISSING_CODES.filter((c) => missingReasons.includes(c))
      : [...HISTORIC_MISSING_CODES];
  const toggleMissingReason = (c: MissingCode) =>
    setMissingReasons((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  // Variable deja utilisee : AJOUTER une raison reste possible (elargir n'invalide aucune
  // fiche), RETIRER est refuse par le serveur. L'interface grise donc les seules raisons
  // deja en service, au lieu de laisser tenter un retrait qui finira en erreur.
  const lockedReasons = lockStructural && initial ? allowedMissingReasons(initial) : [];
  // Seules les options ACTIVES peuvent etre proposees par defaut : proposer une modalite
  // qu'on vient de retirer du formulaire n'aurait pas de sens (la base le refuse aussi).
  const activeOptions = options.filter((o) => o.isActive);

  // La proposition n'a de sens que sur les types ou elle epargne une frappe (jamais sur une
  // liste multiple ni sur un diagnostic : la base les refuse aussi).
  const allowsDefault = supportsDefaultValue(type);
  const trimmedDefault = defaultValue.trim();
  // Avertissement, jamais refus : le medecin connait sa variable ; l'interface l'alerte quand
  // la proposition risque de repondre a sa place.
  const defaultRisk = allowsDefault && trimmedDefault ? defaultValueRisk({ fieldKey, label, type }) : null;
  // Une date fixee dans un gabarit vieillit ; le constructeur ne propose donc que le jeton
  // dynamique. Une valeur litterale deja enregistree reste offerte pour ne pas l'effacer.
  const dateToken = type === 'datetime' ? NOW_TOKEN : TODAY_TOKEN;

  // --- L35 : assemblage et verification de la formule ------------------------------------
  const effectiveScope: FieldScope = isCrossSectional ? 'patient' : scope;
  // Operandes admissibles : meme portee, variables SAISIES, nombre, date ou date-heure. Une variable
  // calculee n'y figure pas -- c'est ce qui supprime la question des cycles.
  const candidates = operandCandidates(fields, { scope: effectiveScope, fieldKey: fieldKey.trim() });
  const operandToken = (choice: string, literal: string) =>
    choice === LITERAL_CHOICE ? literal.trim() : choice;
  const formulaText = composeFormula(
    operandToken(leftOperand, leftLiteral),
    formulaOperator,
    operandToken(rightOperand, rightLiteral),
  );
  // Meme regle que le serveur, appliquee ici pour que le motif se lise DANS le formulaire au
  // lieu de revenir en erreur a l'enregistrement. Le serveur revalide et reste seul juge.
  const formulaCheck = checkFieldFormula(formulaText, { scope: effectiveScope, fieldKey: fieldKey.trim() }, fields);
  // Le type de sortie est DEDUIT, jamais choisi : c'est ce qui distingue une calculatrice
  // d'un champ numerique ordinaire dont on promettrait le contenu.
  const outputType = calculated && formulaCheck.ok ? formulaCheck.outputType ?? null : null;
  const formulaReady = calculated && formulaCheck.ok;
  // Une variable deja utilisee ne bascule pas en calculee : les valeurs deja saisies sous sa
  // cle seraient masquees par un calcul, sans etre effacees ni signalees (la base le refuse).
  const canCalculate = !lockStructural && candidates.length > 0;
  const literalDateDefault = (type === 'date' || type === 'datetime') && trimmedDefault && trimmedDefault !== dateToken
    ? trimmedDefault
    : null;

  // Insertion par COPIE : les valeurs sont recopiees dans le champ, jamais referencees.
  // Modifier la bibliotheque plus tard ne peut donc pas changer le sens de donnees deja
  // saisies. Fusion sans doublon pour ne jamais ecraser ce que l'utilisateur a deja tape.
  function insertValueSet() {
    const set = VALUE_SET_LIBRARY.find((s) => s.id === valueSetId);
    if (!set) return;
    setOptions((current) => {
      const next = [...current];
      for (const value of set.values) {
        if (next.some((o) => o.label.toLocaleLowerCase() === value.toLocaleLowerCase())) continue;
        next.push({ valueKey: makeValueKey(value, optionKeys(next)), label: value, isActive: true });
      }
      return next;
    });
    setValueSetId('');
  }

  async function submit(e?: FormEvent, advance = false) {
    e?.preventDefault();
    if (!fieldKey.trim() || !label.trim()) return;
    // Une formule incomplete ou refusee n'est jamais envoyee : le motif est deja affiche.
    if (calculated && !formulaCheck.ok) return;
    const listed = isChoice && options.length > 0 ? options : null;
    if (formulaReady) {
      // Tout ce qui n'a pas de sens sur une variable calculee part explicitement a vide, au
      // lieu de trainer une valeur que la base refuserait : rien n'est saisi sous cette
      // variable, donc ni obligation, ni valeur proposee, ni raison de valeur manquante.
      const save = advance ? (onSubmitAndNext ?? onSubmit) : onSubmit;
      const accepted = await save({
        fieldKey: fieldKey.trim(), label: label.trim(), description: description.trim() || null,
        scope: effectiveScope, section,
        type: (outputType ?? 'number') as FieldType,
        required: false,
        isMultiple: false,
        encounterTypes: !isCrossSectional && effectiveScope === 'encounter' && encounterTypes.length > 0 ? encounterTypes : null,
        allowedOptions: null,
        allowedValues: null,
        minValue: null,
        maxValue: null,
        unit: unit.trim() || null,
        allowMissingCodes: false,
        missingReasons: [],
        defaultValue: null,
        formula: formulaText,
      });
      if (accepted === false) return;
      if (!editing) resetAfterCreate();
      return;
    }
    const built: NewField = {
      fieldKey: fieldKey.trim(), label: label.trim(), description: description.trim() || null, scope: isCrossSectional ? 'patient' : scope, section, type, required,
      // Un retour vers un autre type n'emporte JAMAIS la cardinalite : la base refuse
      // `is_multiple` hors terminologie, et l'ecran ne doit pas provoquer ce refus.
      isMultiple: type === 'terminology' && isMultiple,
      // Champ de rencontre uniquement ; liste vide = tous les types (null cote base).
      encounterTypes: !isCrossSectional && scope === 'encounter' && encounterTypes.length > 0 ? encounterTypes : null,
      // Les DEUX partent : les options font foi, le miroir des codes garde lisible une
      // copie de l'application qui n'a pas encore ete rafraichie.
      allowedOptions: listed,
      allowedValues: listed ? optionKeys(listed) : null,
      minValue: isNumber ? numOrNull(minValue) : null,
      maxValue: isNumber ? numOrNull(maxValue) : null,
      unit: isNumber && unit.trim() ? unit.trim() : null,
      allowMissingCodes: effectiveMissingReasons.length > 0,
      missingReasons: effectiveMissingReasons,
      defaultValue: allowsDefault && trimmedDefault ? trimmedDefault : null,
    };
    const wantsProposal = supportsProposal && withProposal && !editing;
    const save = advance ? (onSubmitAndNext ?? onSubmit) : onSubmit;
    const accepted = await save(
      built,
      wantsProposal ? makeProposalField(built, t('admin.proposal_label_suffix')) : undefined,
    );
    if (accepted === false) return;
    if (!editing) resetAfterCreate();
  }

  function resetAfterCreate() {
    setFieldKey('');
    setLabel('');
    setDescription('');
    setEncounterTypes([]);
    setOptions([]);
    setMinValue('');
    setMaxValue('');
    setUnit('');
    setAllowMissingCodes(false);
    setMissingReasons([]);
    setDefaultValue('');
    setWithProposal(false);
    setIsMultiple(false);
    setCalculated(false);
    setLeftOperand('');
    setLeftLiteral('');
    setFormulaOperator('-');
    setRightOperand('');
    setRightLiteral('');
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="form-label">
        {t('admin.field_key')}
        <input
          className={inputCls}
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
          disabled={lockStructural}
          required
        />
      </label>
      <label className="form-label">
        {t('admin.label')}
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} required />
      </label>
      <label htmlFor="field-description" className="form-label sm:col-span-2">
        {t('admin.field_description')}
        <textarea id="field-description" aria-label={t('admin.field_description')} className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <span className="helper-text">{t('admin.field_description_hint')}</span>
      </label>
      <label className="form-label">
        {isCrossSectional ? t('observation.single_form_scope') : t('admin.scope')}
        {isCrossSectional ? (
          <span className="input mt-1 flex items-center text-slate-600">{t('scope.patient')}</span>
        ) : (
          <select
            className={inputCls}
            value={scope}
            onChange={(e) => setScope(e.target.value as FieldScope)}
            disabled={lockStructural}
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`scope.${s}`)}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="form-label">
        {t('admin.section')}
        <select className={inputCls} value={section} onChange={(e) => setSection(e.target.value as FieldSection)}>
          {sectionChoices.map((s) => (
            <option key={s.sectionKey} value={s.sectionKey}>
              {sectionLabel(t, s)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-label">
        {t('admin.type')}
        {/* L35 : sur une variable calculee, le type est DEDUIT de la formule, jamais choisi.
            Le selecteur disparait plutot que d'etre grise : il n'y a rien a decider. */}
        {calculated ? (
          <span className="input mt-1 flex items-center text-slate-600">
            {outputType ? t(`admin.formula_output_${outputType}`) : t('admin.formula_output_unknown')}
          </span>
        ) : (
          <select
            className={inputCls}
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
            disabled={lockStructural}
          >
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {fieldTypeLabel(t, ty)}
              </option>
            ))}
          </select>
        )}
      </label>
      {/* Rien n'etant saisi sous une variable calculee, personne ne pourrait la « completer » :
          l'obligation n'a pas de sens et la base la refuse. */}
      {!calculated && (
        <Checkbox
          label={t('admin.required')}
          checked={required}
          disabled={lockStructural}
          onChange={(e) => setRequired(e.target.checked)}
          containerClassName="sm:self-end"
        />
      )}

      {/* --- L35 : variable calculee ------------------------------------------------------
          Trois selecteurs, jamais une expression a taper : la liste n'offre que des operandes
          admissibles. Le produit livre la CALCULATRICE ; la formule appartient a celui qui
          definit le gabarit, au meme titre que le libelle ou les valeurs autorisees. */}
      <details className="sm:col-span-2 lg:col-span-3" open={formulaOpen} onToggle={(event) => setFormulaOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('admin.formula_category')}</summary>
        <div className="mt-3 flex flex-col gap-2">
        <Checkbox
          label={t('admin.formula_enable')}
          checked={calculated}
          disabled={!canCalculate}
          onChange={(e) => setCalculated(e.target.checked)}
        />
        <span className="helper-text">
          {canCalculate
            ? t('admin.formula_hint')
            : lockStructural
              ? t('admin.formula_locked')
              : t('admin.formula_no_operand')}
        </span>
        {calculated && (
          <fieldset className="surface-muted flex flex-col gap-3 p-3">
            <legend className="px-1 text-xs font-medium text-slate-600">{t('admin.formula')}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <label className="form-label">
                {t('admin.formula_left')}
                <select
                  className={inputCls}
                  value={leftOperand}
                  onChange={(e) => setLeftOperand(e.target.value)}
                >
                  <option value="">{t('admin.formula_choose')}</option>
                  {candidates.map((f) => (
                    <option key={f.id} value={f.fieldKey}>{f.label}</option>
                  ))}
                  <option value={LITERAL_CHOICE}>{t('admin.formula_constant')}</option>
                </select>
              </label>
              {leftOperand === LITERAL_CHOICE && (
                <label className="form-label">
                  {t('admin.formula_constant')}
                  <input
                    className={inputCls + ' w-28'}
                    type="number"
                    step="any"
                    value={leftLiteral}
                    onChange={(e) => setLeftLiteral(e.target.value)}
                  />
                </label>
              )}
              <label className="form-label">
                {t('admin.formula_operator')}
                <select
                  className={inputCls + ' w-20'}
                  value={formulaOperator}
                  onChange={(e) => setFormulaOperator(e.target.value as FormulaOperator)}
                >
                  {FORMULA_OPERATORS.map((op) => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                {t('admin.formula_right')}
                <select
                  className={inputCls}
                  value={rightOperand}
                  onChange={(e) => setRightOperand(e.target.value)}
                >
                  <option value="">{t('admin.formula_choose')}</option>
                  {candidates.map((f) => (
                    <option key={f.id} value={f.fieldKey}>{f.label}</option>
                  ))}
                  <option value={LITERAL_CHOICE}>{t('admin.formula_constant')}</option>
                </select>
              </label>
              {rightOperand === LITERAL_CHOICE && (
                <label className="form-label">
                  {t('admin.formula_constant')}
                  <input
                    className={inputCls + ' w-28'}
                    type="number"
                    step="any"
                    value={rightLiteral}
                    onChange={(e) => setRightLiteral(e.target.value)}
                  />
                </label>
              )}
            </div>
            {formulaCheck.ok ? (
              <p className="text-xs text-slate-600">
                {t('admin.formula_preview').replace('{formula}', formulaText)}
              </p>
            ) : (
              <p role="status" className="text-xs text-amber-700">
                {t(formulaProblemKey(formulaCheck.problem ?? 'syntax')).replace('{name}', formulaCheck.detail ?? '')}
              </p>
            )}
            <p className="helper-text">{t('admin.formula_not_stored')}</p>
          </fieldset>
        )}
        </div>
      </details>

      {/* L21 : reservee au diagnostic. Une liste FERMEE recopiee dans le gabarit reste du
          ressort de `multiselect` ; deux facons de faire la meme chose seraient une dette. */}
      {type === 'terminology' && !calculated && (
        <details className="sm:col-span-2 lg:col-span-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('admin.terminology_category')}</summary>
          <div className="mt-2 flex flex-col gap-1">
          <Checkbox
            label={t('admin.field_multiple')}
            checked={isMultiple}
            disabled={lockStructural}
            onChange={(e) => setIsMultiple(e.target.checked)}
          />
          <span className="helper-text">{t('admin.field_multiple_hint')}</span>
          </div>
        </details>
      )}

      {/* L30 : l'editeur reste ACTIF sur une variable deja utilisee -- c'est tout l'objet
          du lot. Seule la suppression d'une option y est retiree ; renommer, ajouter,
          desactiver et reordonner restent possibles et ne touchent aucune fiche. */}
      {isChoice && !calculated && (
        <details className="sm:col-span-2 lg:col-span-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('admin.options_category')}</summary>
          <fieldset className="mt-3 flex flex-col gap-3">
            <legend className="sr-only">{t('admin.options')}</legend>
            <OptionsEditor options={options} onChange={setOptions} locked={lockStructural} />
            <div className="flex flex-wrap items-end gap-2">
            <label className="form-label">
              {t('admin.value_set')}
              <select className={inputCls} value={valueSetId} onChange={(e) => setValueSetId(e.target.value)}>
                <option value="">{t('admin.value_set_none')}</option>
                {VALUE_SET_LIBRARY.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.domain} · {s.name} ({s.values.length})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={insertValueSet} disabled={!valueSetId} className="btn-secondary">
              {t('admin.value_set_insert')}
            </button>
            <p className="text-xs text-slate-500">{t('admin.value_set_hint')}</p>
            </div>
          </fieldset>
        </details>
      )}
      {/* Soupape a la CREATION seulement : elle cree un second champ. Les diagnostics comme
          les listes restent controles ; la proposition est donc stockee a cote, jamais dedans. */}
      {supportsProposal && !editing && !calculated && (
        <div className="surface-muted p-3 sm:col-span-2 lg:col-span-3">
          <Checkbox
            label={t(type === 'terminology' ? 'admin.terminology_proposal_enable' : 'admin.proposal_enable')}
            checked={withProposal}
            onChange={(e) => setWithProposal(e.target.checked)}
          />
          <p className="text-xs text-slate-500">{t(type === 'terminology' ? 'admin.terminology_proposal_hint' : 'admin.proposal_hint')}</p>
        </div>
      )}
      {(isNumber || calculated) && (
        <details className="sm:col-span-2 lg:col-span-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('admin.numeric_constraints')}</summary>
          <div className="mt-3 flex flex-wrap gap-3">
          {/* Des bornes sur un resultat calcule seraient INERTES : rien n'est saisi, donc rien
              a valider. Les afficher promettrait un controle qui n'existe pas. */}
          {!calculated && (
            <>
              <label className="form-label">
                {t('admin.min')}
                <input className={inputCls + ' w-24'} type="number" value={minValue} disabled={lockStructural} onChange={(e) => setMinValue(e.target.value)} />
              </label>
              <label className="form-label">
                {t('admin.max')}
                <input className={inputCls + ' w-24'} type="number" value={maxValue} disabled={lockStructural} onChange={(e) => setMaxValue(e.target.value)} />
              </label>
            </>
          )}
          <label className="form-label">
            {t('admin.unit')}
            <input className={inputCls + ' w-24'} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          </div>
        </details>
      )}
      {/* Une variable calculee n'est jamais saisie : elle ne peut donc pas porter de raison
          de valeur manquante. Son resultat, lui, est simplement ABSENT quand un operande
          manque -- ce qui n'a pas a etre configure. */}
      {!calculated && (
      <details className="sm:col-span-2 lg:col-span-3" open={missingOpen} onToggle={(event) => setMissingOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('admin.missing_category')}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <Checkbox
          label={t('admin.allow_missing')}
          checked={allowMissingCodes}
          disabled={lockedReasons.length > 0}
          onChange={(e) => {
            setAllowMissingCodes(e.target.checked);
            if (e.target.checked && missingReasons.length === 0) setMissingReasons([...HISTORIC_MISSING_CODES]);
          }}
        />
        {allowMissingCodes && (
          <fieldset className="surface-muted p-3">
            <legend className="px-1 text-xs font-medium text-slate-600">{t('admin.missing_reasons')}</legend>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {MISSING_CODES.map((c) => (
                <Checkbox
                  key={c}
                  label={t(`missing.${c}` as const)}
                  checked={missingReasons.includes(c)}
                  disabled={lockedReasons.includes(c)}
                  onChange={() => toggleMissingReason(c)}
                />
              ))}
            </div>
            <p className="helper-text mt-2">{t('admin.missing_reasons_hint')}</p>
            {lockedReasons.length > 0 && (
              <p className="mt-1 text-xs text-amber-700">{t('admin.missing_reasons_locked')}</p>
            )}
          </fieldset>
        )}
      </div>
      </details>
      )}

      {/* Valeur PROPOSEE : reste modifiable meme sur une variable deja utilisee (elle ne
          change le sens d'aucune donnee deja saisie). Jamais sur une variable calculee :
          sa valeur vient de la formule, il n'y a rien a proposer. */}
      {allowsDefault && !calculated && (
        <details className="sm:col-span-2 lg:col-span-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('admin.default_category')}</summary>
        <div className="mt-2 flex flex-col gap-1">
          <label htmlFor="field-default" className="form-label">
            {t('admin.field_default')}
            {type === 'date' || type === 'datetime' ? (
              <select
                id="field-default"
                aria-label={t('admin.field_default')}
                className={inputCls}
                value={trimmedDefault}
                onChange={(e) => setDefaultValue(e.target.value)}
              >
                <option value="">{t('admin.field_default_none')}</option>
                <option value={dateToken}>
                  {t(type === 'datetime' ? 'admin.field_default_now' : 'admin.field_default_today')}
                </option>
                {literalDateDefault && <option value={literalDateDefault}>{literalDateDefault}</option>}
              </select>
            ) : type === 'boolean' ? (
              <select
                id="field-default"
                aria-label={t('admin.field_default')}
                className={inputCls}
                value={trimmedDefault}
                onChange={(e) => setDefaultValue(e.target.value)}
              >
                <option value="">{t('admin.field_default_none')}</option>
                <option value="true">{t('common.yes')}</option>
                <option value="false">{t('common.no')}</option>
              </select>
            ) : type === 'select' ? (
              <select
                id="field-default"
                aria-label={t('admin.field_default')}
                className={inputCls}
                value={trimmedDefault}
                onChange={(e) => setDefaultValue(e.target.value)}
              >
                <option value="">{t('admin.field_default_none')}</option>
                {/* La valeur enregistree est le CODE ; c'est le libelle qui s'affiche. */}
                {activeOptions.map((o) => (
                  <option key={o.valueKey} value={o.valueKey}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                id="field-default"
                aria-label={t('admin.field_default')}
                type={isNumber ? 'number' : 'text'}
                className={inputCls}
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
              />
            )}
            <span className="helper-text">{t('admin.field_default_hint')}</span>
          </label>
          {defaultRisk && (
            <p role="status" className="text-xs text-amber-700">
              ⚠️ {t(defaultRisk === 'clinical' ? 'admin.field_default_warn_clinical' : 'admin.field_default_warn_shape')}
            </p>
          )}
        </div>
        </details>
      )}

      {!isCrossSectional && scope === 'encounter' && (
        <details className="surface-muted p-3 sm:col-span-2 lg:col-span-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('admin.encounter_category')}</summary>
          <fieldset className="mt-2">
            <legend className="sr-only">{t('admin.encounter_types')}</legend>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {ENCOUNTER_TYPES.map((x) => (
              <Checkbox
                key={x}
                label={t(`encountertype.${x}`)}
                checked={encounterTypes.includes(x)}
                disabled={lockStructural}
                onChange={() => toggleEncType(x)}
              />
            ))}
            </div>
          </fieldset>
        </details>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {submitLabel ?? t('admin.add_variable_form')}
        </button>
        {editing && onSubmitAndNext && (
          <button type="button" onClick={() => void submit(undefined, true)} disabled={busy} className="btn-secondary">
            {submitAndNextLabel ?? t('admin.save_next')}
          </button>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            {t('admin.cancel')}
          </button>
        )}
      </div>
      {editing && lockStructural && (
        <p className="text-xs text-amber-700 sm:col-span-2 lg:col-span-3">{t('admin.field_locked_hint')}</p>
      )}
    </form>
  );
}
