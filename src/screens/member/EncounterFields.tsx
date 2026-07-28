import type { FieldSection, TemplateField } from '../../data/types';
import { useI18n } from '../../i18n/useI18n';
import { findProposalField, isChoiceField, proposalKeysOf } from '../../domain/proposalField';
import { ChoiceWithProposal } from './ChoiceWithProposal';
import { ValueInput } from './ValueInput';

const SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];

/** Un champ de rencontre s'applique-t-il a ce type ? (encounterTypes null/vide = tous). */
export const fieldAppliesToType = (f: TemplateField, type: string) =>
  !f.encounterTypes || f.encounterTypes.length === 0 || f.encounterTypes.includes(type);

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
  const { t } = useI18n();
  // Les champs compagnons sont rendus AVEC leur champ source, jamais isolement.
  const companionKeys = proposalKeysOf(fields);
  return (
    <>
      {SECTIONS.map((section) => {
        const sectionFields = fields.filter((f) => f.section === section && !companionKeys.has(f.fieldKey));
        if (sectionFields.length === 0) return null;
        return (
          <fieldset key={section} className="card space-y-3 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">{t(`section.${section}`)}</legend>
            {sectionFields.map((f) => {
              const proposal = isChoiceField(f) ? findProposalField(fields, f) : undefined;
              return (
                <div key={f.id} className="flex flex-col text-sm">
                  <span className="text-slate-700">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                    {f.unit && <span className="text-slate-400"> ({f.unit})</span>}
                  </span>
                  <div className="mt-1">
                    {proposal ? (
                      <ChoiceWithProposal
                        field={f}
                        proposal={proposal}
                        value={values[f.fieldKey]}
                        proposalValue={values[proposal.fieldKey]}
                        onChange={onChange}
                      />
                    ) : (
                      <ValueInput field={f} value={values[f.fieldKey]} onChange={(v) => onChange(f.fieldKey, v)} />
                    )}
                  </div>
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </>
  );
}
