import { FieldInput } from './FieldInput';
import { MISSING_CODES, isMissing, makeMissing, missingCodeOf, type MissingCode } from '../../domain/validation';
import { useI18n } from '../../i18n/useI18n';
import type { TemplateField } from '../../data/types';

// Saisie d'une valeur OU d'un code manquant codifie (non_fait/inconnu/non_applicable),
// distinct du vide (cahier §6, §10).
export function ValueInput({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  const code = missingCodeOf(value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {code === null ? (
        <FieldInput field={field} value={isMissing(value) ? undefined : value} onChange={onChange} />
      ) : (
        <span className="text-xs italic text-slate-400">{t(`missing.${code}`)}</span>
      )}
      {field.allowMissingCodes && (
        <select
          aria-label={`${field.label} — valeur manquante`}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          value={code ?? 'value'}
          onChange={(e) => onChange(e.target.value === 'value' ? null : makeMissing(e.target.value as MissingCode))}
        >
          <option value="value">{t('missing.value')}</option>
          {MISSING_CODES.map((c) => (
            <option key={c} value={c}>
              {t(`missing.${c}` as const)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
