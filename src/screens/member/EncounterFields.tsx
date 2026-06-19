import type { FieldSection, TemplateField } from '../../data/types';
import { useI18n } from '../../i18n/useI18n';
import { ValueInput } from './ValueInput';

const SECTIONS: FieldSection[] = ['clinique', 'biologie', 'paraclinique'];

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
  return (
    <>
      {SECTIONS.map((section) => {
        const sectionFields = fields.filter((f) => f.section === section);
        if (sectionFields.length === 0) return null;
        return (
          <fieldset key={section} className="space-y-3 rounded border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">{t(`section.${section}`)}</legend>
            {sectionFields.map((f) => (
              <label key={f.id} className="flex flex-col text-sm">
                <span className="text-slate-700">
                  {f.label}
                  {f.required && <span className="text-red-500"> *</span>}
                  {f.unit && <span className="text-slate-400"> ({f.unit})</span>}
                </span>
                <div className="mt-1">
                  <ValueInput field={f} value={values[f.fieldKey]} onChange={(v) => onChange(f.fieldKey, v)} />
                </div>
              </label>
            ))}
          </fieldset>
        );
      })}
    </>
  );
}
