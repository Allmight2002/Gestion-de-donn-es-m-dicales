import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { VALUE_SET_LIBRARY, mergeValues, parseAllowedValues } from '../../domain/valueSetLibrary';
import { makeProposalField } from '../../domain/proposalField';
import { NOW_TOKEN, TODAY_TOKEN, defaultValueRisk, supportsDefaultValue } from '../../domain/fieldDefaults';
import { HISTORIC_MISSING_CODES, MISSING_CODES, allowedMissingReasons, type MissingCode } from '../../domain/validation';
import type { FieldScope, FieldSection, FieldType, NewField } from '../../data/types';
import type { ObservationModel } from '../../data/bases';
import { Checkbox } from '../../components/Checkbox';

const SCOPES: FieldScope[] = ['patient', 'encounter'];
const SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];
const TYPES: FieldType[] = ['number', 'integer', 'text', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'terminology'];
const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;

const inputCls = 'input';

export function FieldForm({
  onSubmit,
  busy,
  initial,
  lockStructural = false,
  submitLabel,
  onCancel,
  observationModel = 'longitudinal',
}: {
  /** `companion` : champ compagnon « valeur proposée » à créer juste après le champ source. */
  onSubmit: (f: NewField, companion?: NewField) => void | boolean | Promise<void | boolean>;
  busy?: boolean;
  /** Pre-remplissage en mode edition (null/absent = creation). */
  initial?: NewField | null;
  /** Variable deja utilisee : nom interne / portee / type verrouilles (seul le libelle change). */
  lockStructural?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
  observationModel?: ObservationModel;
}) {
  const { t } = useI18n();
  const editing = !!initial;
  const isCrossSectional = observationModel === 'cross_sectional';
  const [fieldKey, setFieldKey] = useState(initial?.fieldKey ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [scope, setScope] = useState<FieldScope>(isCrossSectional ? 'patient' : (initial?.scope ?? 'encounter'));
  const [section, setSection] = useState<FieldSection>(initial?.section ?? 'clinique');
  const [type, setType] = useState<FieldType>(initial?.type ?? 'text');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [encounterTypes, setEncounterTypes] = useState<string[]>(initial?.encounterTypes ?? []);
  // Une valeur par ligne : lisible au-dela de quelques items, et seul format qui autorise
  // une valeur contenant une virgule (cf. parseAllowedValues).
  const [allowedValues, setAllowedValues] = useState((initial?.allowedValues ?? []).join('\n'));
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
  const [defaultValue, setDefaultValue] = useState(initial?.defaultValue ?? '');

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
  const parsedValues = parseAllowedValues(allowedValues);

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
  const literalDateDefault = (type === 'date' || type === 'datetime') && trimmedDefault && trimmedDefault !== dateToken
    ? trimmedDefault
    : null;

  // Insertion par COPIE : les valeurs sont recopiees dans le champ, jamais referencees.
  // Modifier la bibliotheque plus tard ne peut donc pas changer le sens de donnees deja
  // saisies. Fusion sans doublon pour ne jamais ecraser ce que l'utilisateur a deja tape.
  function insertValueSet() {
    const set = VALUE_SET_LIBRARY.find((s) => s.id === valueSetId);
    if (!set) return;
    setAllowedValues(mergeValues(parsedValues, set.values).join('\n'));
    setValueSetId('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fieldKey.trim() || !label.trim()) return;
    const values = parsedValues;
    const built: NewField = {
      fieldKey: fieldKey.trim(), label: label.trim(), description: description.trim() || null, scope: isCrossSectional ? 'patient' : scope, section, type, required,
      // Champ de rencontre uniquement ; liste vide = tous les types (null cote base).
      encounterTypes: !isCrossSectional && scope === 'encounter' && encounterTypes.length > 0 ? encounterTypes : null,
      allowedValues: isChoice && values.length > 0 ? values : null,
      minValue: isNumber ? numOrNull(minValue) : null,
      maxValue: isNumber ? numOrNull(maxValue) : null,
      unit: isNumber && unit.trim() ? unit.trim() : null,
      allowMissingCodes: effectiveMissingReasons.length > 0,
      missingReasons: effectiveMissingReasons,
      defaultValue: allowsDefault && trimmedDefault ? trimmedDefault : null,
    };
    const wantsProposal = supportsProposal && withProposal && !editing;
    const accepted = await onSubmit(
      built,
      wantsProposal ? makeProposalField(built, t('admin.proposal_label_suffix')) : undefined,
    );
    if (accepted === false) return;
    if (!editing) {
      setFieldKey('');
      setLabel('');
      setDescription('');
      setEncounterTypes([]);
      setAllowedValues('');
      setMinValue('');
      setMaxValue('');
      setUnit('');
      setAllowMissingCodes(false);
      setMissingReasons([]);
      setDefaultValue('');
      setWithProposal(false);
    }
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
          {SECTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`section.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-label">
        {t('admin.type')}
        <select
          className={inputCls}
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          disabled={lockStructural}
        >
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {ty}
            </option>
          ))}
        </select>
      </label>
      <Checkbox
        label={t('admin.required')}
        checked={required}
        disabled={lockStructural}
        onChange={(e) => setRequired(e.target.checked)}
        containerClassName="sm:self-end"
      />

      {isChoice && (
        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-3">
          <label className="form-label">
            {t('admin.allowed_values')}
            <textarea
              className={inputCls}
              rows={4}
              value={allowedValues}
              onChange={(e) => setAllowedValues(e.target.value)}
              disabled={lockStructural}
              placeholder={t('admin.allowed_values_ph')}
            />
          </label>
          <p className="text-xs text-slate-500">{parsedValues.length} {t('admin.values_count')}</p>
          {!lockStructural && (
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
          )}
        </div>
      )}
      {/* Soupape a la CREATION seulement : elle cree un second champ. Les diagnostics comme
          les listes restent controles ; la proposition est donc stockee a cote, jamais dedans. */}
      {supportsProposal && !editing && (
        <div className="surface-muted p-3 sm:col-span-2 lg:col-span-3">
          <Checkbox
            label={t(type === 'terminology' ? 'admin.terminology_proposal_enable' : 'admin.proposal_enable')}
            checked={withProposal}
            onChange={(e) => setWithProposal(e.target.checked)}
          />
          <p className="text-xs text-slate-500">{t(type === 'terminology' ? 'admin.terminology_proposal_hint' : 'admin.proposal_hint')}</p>
        </div>
      )}
      {isNumber && (
        <>
          <label className="form-label">
            {t('admin.min')}
            <input className={inputCls + ' w-24'} type="number" value={minValue} disabled={lockStructural} onChange={(e) => setMinValue(e.target.value)} />
          </label>
          <label className="form-label">
            {t('admin.max')}
            <input className={inputCls + ' w-24'} type="number" value={maxValue} disabled={lockStructural} onChange={(e) => setMaxValue(e.target.value)} />
          </label>
          <label className="form-label">
            {t('admin.unit')}
            <input className={inputCls + ' w-24'} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
        </>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
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

      {/* Valeur PROPOSEE : reste modifiable meme sur une variable deja utilisee (elle ne
          change le sens d'aucune donnee deja saisie). */}
      {allowsDefault && (
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
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
                {parsedValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
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
      )}

      {!isCrossSectional && scope === 'encounter' && (
        <fieldset className="surface-muted p-3 sm:col-span-2 lg:col-span-3">
          <legend className="px-1 text-xs font-medium text-slate-600">
            {t('admin.encounter_types')}
          </legend>
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
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {submitLabel ?? t('admin.add_field')}
        </button>
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
