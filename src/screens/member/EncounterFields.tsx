import { Fragment, useId, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import type { FieldSection, TemplateField } from '../../data/types';
import { useI18n } from '../../i18n/useI18n';
import { findProposalField, isProposalSource, proposalKeysOf } from '../../domain/proposalField';
import { ChoiceWithProposal } from './ChoiceWithProposal';
import { ValueInput } from './ValueInput';

const DEFINED_SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];
const SECTIONS = [...DEFINED_SECTIONS, 'other'] as const;
type DisplaySection = (typeof SECTIONS)[number];

const displaySectionOf = (section: unknown): DisplaySection =>
  DEFINED_SECTIONS.includes(section as FieldSection) ? section as FieldSection : 'other';

export function FieldLabel({ field, prefilled = false }: { field: TemplateField; prefilled?: boolean }) {
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
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
      {field.unit && <span className="text-slate-400"> ({field.unit})</span>}
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

// Regroupement visuel commun aux variables patient et rencontre. La section de
// secours evite qu'une ancienne variable incomplete disparaisse du formulaire.
export function SectionedFields({
  fields,
  renderField,
}: {
  fields: TemplateField[];
  renderField: (field: TemplateField) => ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      {SECTIONS.map((section) => {
        const sectionFields = fields.filter((field) => displaySectionOf(field.section) === section);
        if (sectionFields.length === 0) return null;
        return (
          <fieldset key={section} className="card space-y-3 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">{t(`section.${section}`)}</legend>
            {sectionFields.map((field) => (
              <Fragment key={field.id}>{renderField(field)}</Fragment>
            ))}
          </fieldset>
        );
      })}
    </>
  );
}

// Rendu des champs de rencontre par section (clinique / biologie / paraclinique),
// reutilise par la creation et l'edition.
export function EncounterFields({
  fields,
  values,
  onChange,
  onRemove,
  prefilledKeys,
  hiddenKeys,
}: {
  fields: TemplateField[];
  values: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
  onRemove: (key: string) => void;
  /** Cles preremplies par le jeu de variables et pas encore modifiees (L28). */
  prefilledKeys?: Set<string>;
  /** Cles masquees par une regle d'affichage (L32) : elles ne sont pas rendues du tout. */
  hiddenKeys?: ReadonlySet<string>;
}) {
  // Les champs compagnons sont rendus AVEC leur champ source, jamais isolement.
  const companionKeys = proposalKeysOf(fields);
  const visibleFields = fields.filter(
    (field) => !companionKeys.has(field.fieldKey) && !hiddenKeys?.has(field.fieldKey),
  );
  return (
    <SectionedFields
      fields={visibleFields}
      renderField={(field) => {
        const proposal = isProposalSource(field) ? findProposalField(fields, field) : undefined;
        return (
          <div className="flex flex-col text-sm">
            <FieldLabel field={field} prefilled={prefilledKeys?.has(field.fieldKey) ?? false} />
            <div className="mt-1">
              {proposal ? (
                <ChoiceWithProposal
                  field={field}
                  proposal={proposal}
                  value={values[field.fieldKey]}
                  proposalValue={values[proposal.fieldKey]}
                  onChange={onChange}
                  onRemove={onRemove}
                />
              ) : (
                <ValueInput field={field} value={values[field.fieldKey]} onChange={(v) => onChange(field.fieldKey, v)} />
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
