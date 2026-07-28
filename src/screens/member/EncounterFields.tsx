import { Fragment, type ReactNode } from 'react';
import type { FieldSection, TemplateField } from '../../data/types';
import { useI18n } from '../../i18n/useI18n';
import { findProposalField, isChoiceField, proposalKeysOf } from '../../domain/proposalField';
import { ChoiceWithProposal } from './ChoiceWithProposal';
import { ValueInput } from './ValueInput';

const DEFINED_SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];
const SECTIONS = [...DEFINED_SECTIONS, 'other'] as const;
type DisplaySection = (typeof SECTIONS)[number];

const displaySectionOf = (section: unknown): DisplaySection =>
  DEFINED_SECTIONS.includes(section as FieldSection) ? section as FieldSection : 'other';

/** Un champ de rencontre s'applique-t-il a ce type ? (encounterTypes null/vide = tous). */
export const fieldAppliesToType = (f: TemplateField, type: string) =>
  !f.encounterTypes || f.encounterTypes.length === 0 || f.encounterTypes.includes(type);

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
}: {
  fields: TemplateField[];
  values: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
}) {
  // Les champs compagnons sont rendus AVEC leur champ source, jamais isolement.
  const companionKeys = proposalKeysOf(fields);
  const visibleFields = fields.filter((field) => !companionKeys.has(field.fieldKey));
  return (
    <SectionedFields
      fields={visibleFields}
      renderField={(field) => {
        const proposal = isChoiceField(field) ? findProposalField(fields, field) : undefined;
        return (
          <div className="flex flex-col text-sm">
            <span className="text-slate-700">
              {field.label}
              {field.required && <span className="text-red-500"> *</span>}
              {field.unit && <span className="text-slate-400"> ({field.unit})</span>}
            </span>
            <div className="mt-1">
              {proposal ? (
                <ChoiceWithProposal
                  field={field}
                  proposal={proposal}
                  value={values[field.fieldKey]}
                  proposalValue={values[proposal.fieldKey]}
                  onChange={onChange}
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
