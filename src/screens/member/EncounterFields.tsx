import { useId, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { isMultipleTerminology, type TemplateCommonLayout, type TemplateField, type TemplateSection, type ValidationRule } from '../../data/types';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { findProposalField, isProposalSource, proposalKeysOf } from '../../domain/proposalField';
import { calculatedValue, FORMULA_TIME_UNITS, formulaUsesTemporalOperands, isCalculatedField, normalizeFormulaTimeUnit } from '../../domain/fieldFormula';
import { ChoiceWithProposal } from './ChoiceWithProposal';
import { ValueInput } from './ValueInput';
import { SectionedFields } from './SectionedFields';
import { ConfirmDialog } from '../../components/ConfirmDialog';
export { SectionedFields } from './SectionedFields';

export function FieldLabel({ field, fields, prefilled = false }: {
  field: TemplateField;
  fields?: readonly TemplateField[];
  prefilled?: boolean;
}) {
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const temporalFormula = Boolean(fields && formulaUsesTemporalOperands(field.formula, fields));
  const formulaUnit = isCalculatedField(field)
    ? temporalFormula ? normalizeFormulaTimeUnit(field.unit) : field.unit
    : field.unit;
  const renderedUnit = formulaUnit && isCalculatedField(field) && (FORMULA_TIME_UNITS as readonly string[]).includes(formulaUnit)
    ? t(`form.unit_${formulaUnit}` as MessageKey)
    : formulaUnit;
  return (
    <span className="flex items-center gap-1 text-slate-700">
      {field.label}
      {field.description && (
        <span className="relative inline-flex">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            aria-label={t('form.field_help')}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((open) => !open)}
          >
            <CircleHelp aria-hidden="true" size={16} />
          </button>
          {helpOpen && <span id={helpId} role="tooltip" className="absolute left-0 top-full z-10 w-64 rounded bg-slate-800 p-2 text-xs font-normal text-white shadow-lg">{field.description}</span>}
        </span>
      )}
      {field.required && <span className="text-red-500"> *</span>}
      {renderedUnit && <span className="text-slate-400"> ({renderedUnit})</span>}
      {/* Valeur venue du jeu de variables, pas encore confirmee par la personne qui saisit :
          la mention disparait des qu'on y touche. Rien n'est enregistre a ce sujet. */}
      {prefilled && (
        <span
          title={t('form.prefilled_hint')}
          className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
        >
          {t('form.prefilled')}
        </span>
      )}
    </span>
  );
}

/**
 * L35 — resultat d'une variable CALCULEE. Toujours en lecture seule : la valeur vient de la
 * formule du gabarit, jamais de la personne qui saisit, et elle n'est enregistree nulle part.
 *
 * Elle se met a jour des qu'un operande change, parce qu'elle est recalculee a chaque rendu
 * a partir des valeurs du formulaire — il n'y a rien a synchroniser, donc rien qui puisse se
 * desynchroniser. Un resultat ABSENT (operande manquant, valeur manquante codifiee, division
 * par zero) s'affiche comme tel, jamais comme un zero qui se lirait comme une mesure.
 */
export function CalculatedValue({
  field,
  values,
  fields,
}: {
  field: TemplateField;
  values: Record<string, unknown>;
  fields: readonly TemplateField[];
}) {
  const { t } = useI18n();
  const result = calculatedValue(field, values, fields);
  return (
    <output
      aria-label={field.label}
      title={t('form.calculated_hint')}
      className="flex min-h-11 items-center gap-2 text-sm text-slate-700"
    >
      {result === null ? (
        <span className="italic text-slate-400">{t('form.calculated_absent')}</span>
      ) : (
        <span className="font-medium tabular-nums">{result}</span>
      )}
      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {t('form.calculated')}
      </span>
    </output>
  );
}

/** Un champ de rencontre s'applique-t-il a ce type ? (encounterTypes null/vide = tous). */
export const fieldAppliesToType = (f: TemplateField, type: string) =>
  !f.encounterTypes || f.encounterTypes.length === 0 || f.encounterTypes.includes(type);

/**
 * L32 — annonce les valeurs qui seront retirees a l'enregistrement parce que leur variable
 * n'est plus affichee. La decision du lot est l'effacement, JAMAIS EN SILENCE : ce bandeau
 * est l'annonce, et rien n'est efface tant que la fiche n'est pas enregistree.
 */
export function HiddenValuesNotice({
  removedKeys,
  fields,
}: {
  removedKeys: readonly string[];
  fields: TemplateField[];
}) {
  const { t } = useI18n();
  if (removedKeys.length === 0) return null;
  const labels = removedKeys.map((key) => fields.find((f) => f.fieldKey === key)?.label ?? key);
  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {t('form.hidden_removed').replace('{n}', String(removedKeys.length))} {labels.join(', ')}
    </div>
  );
}

/**
 * Confirmation explicite requise uniquement lorsqu'un retrait de diagnostic va masquer
 * des valeurs déjà saisies. Annuler ferme l'annonce mais ne touche jamais aux valeurs du
 * formulaire ; l'appelant ne retire les clés qu'au moment de la persistance confirmée.
 */
export function HiddenValuesConfirmation({
  removedKeys,
  fields,
  onConfirm,
  onCancel,
}: {
  removedKeys: readonly string[];
  fields: TemplateField[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (removedKeys.length === 0) return null;
  const labels = removedKeys.map((key) => fields.find((f) => f.fieldKey === key)?.label ?? key);
  return <ConfirmDialog open title={t('form.diagnostic_withdrawal_title')}
    body={<><p>{t('form.diagnostic_withdrawal_body').replace('{n}', String(removedKeys.length))}</p><p className="mt-2">{labels.join(', ')}</p></>}
    confirmLabel={t('form.diagnostic_withdrawal_confirm')} cancelLabel={t('form.diagnostic_withdrawal_cancel')}
    onConfirm={onConfirm} onCancel={onCancel} />;
}

// Regroupement visuel commun aux variables patient et rencontre. La section de
// secours evite qu'une ancienne variable incomplete disparaisse du formulaire.
// Rendu des champs de rencontre par section, reutilise par la creation et l'edition.
// Les sections sont celles de la version du gabarit (L31), pas une liste figee.
export function EncounterFields({
  fields,
  values,
  onChange,
  onRemove,
  prefilledKeys,
  hiddenKeys,
  sections,
  commonLayout,
  rules,
  requireComplete,
}: {
  fields: TemplateField[];
  values: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
  onRemove: (key: string) => void;
  /** Cles preremplies par le jeu de variables et pas encore modifiees (L28). */
  prefilledKeys?: Set<string>;
  /** Cles masquees par une regle d'affichage (L32) : elles ne sont pas rendues du tout. */
  hiddenKeys?: ReadonlySet<string>;
  /** Sections de la version (L31). Facultatives : voir `SectionedFields`. */
  sections?: readonly TemplateSection[] | null;
  /** UX-16 : placement de presentation des variables communes. */
  commonLayout?: TemplateCommonLayout | null;
  rules?: readonly ValidationRule[];
  requireComplete?: boolean;
}) {
  // Les champs compagnons sont rendus AVEC leur champ source, jamais isolement.
  const companionKeys = proposalKeysOf(fields);
  const visibleFields = fields.filter(
    (field) => !companionKeys.has(field.fieldKey) && !hiddenKeys?.has(field.fieldKey),
  );
  return (
    <SectionedFields
      fields={visibleFields}
      sections={sections}
      commonLayout={commonLayout}
      allFields={fields}
      values={values}
      rules={rules}
      hiddenKeys={hiddenKeys}
      requireComplete={requireComplete}
      renderField={(field) => {
        const proposal = isProposalSource(field) ? findProposalField(fields, field) : undefined;
        return (
          <div className="flex flex-col text-sm">
                            <FieldLabel field={field} fields={fields} prefilled={prefilledKeys?.has(field.fieldKey) ?? false} />
            <div className="mt-1">
              {/* L35 : une variable calculee n'est JAMAIS saisissable — pas de champ, pas de
                  raison de valeur manquante, rien a enregistrer. */}
              {isCalculatedField(field) ? (
                <CalculatedValue field={field} values={Object.fromEntries(Object.entries(values).filter(([key]) => !hiddenKeys?.has(key)))} fields={fields} />
              ) : proposal ? (
                <ChoiceWithProposal
                  field={field}
                  proposal={proposal}
                  value={values[field.fieldKey]}
                  proposalValue={values[proposal.fieldKey]}
                  onChange={onChange}
                  onRemove={onRemove}
                />
              ) : (
                <ValueInput
                  field={field}
                  value={values[field.fieldKey]}
                  // L21 : retirer la DERNIERE valeur d'une liste supprime la CLE, au lieu
                  // d'ecrire `[]` ou de laisser un `null` derriere soi. La base refuse le
                  // tableau vide, et « pas de valeur » n'a qu'une seule representation.
                  onChange={(v) =>
                    v === null && isMultipleTerminology(field)
                      ? onRemove(field.fieldKey)
                      : onChange(field.fieldKey, v)
                  }
                />
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
