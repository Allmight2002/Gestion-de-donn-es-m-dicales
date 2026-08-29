import { FieldInput } from './FieldInput';
import { allowedMissingReasons, isMissing, makeMissing, missingCodeOf, type MissingCode } from '../../domain/validation';
import { useI18n } from '../../i18n/useI18n';
import type { TemplateField } from '../../data/types';

// Saisie d'une valeur OU d'une RAISON de valeur manquante, distincte du vide (cahier §6, §10).
// Les raisons proposees sont celles de la variable en cours (L33) : « non realise » convient a
// un examen, pas a un sexe.
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
  const allowed = allowedMissingReasons(field);
  // Une fiche ancienne peut porter une raison que la variable ne propose plus (gabarit
  // repris dans une nouvelle version). On l'affiche quand meme, sinon le selecteur s'ouvre
  // vide et la fiche devient illisible — puis inmodifiable au premier enregistrement.
  const options = code && !allowed.includes(code) ? [...allowed, code] : allowed;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {code === null ? (
        <FieldInput field={field} value={isMissing(value) ? undefined : value} onChange={onChange} />
      ) : (
        <span className="text-xs italic text-slate-400">{t(`missing.${code}`)}</span>
      )}
      {options.length > 0 && (
        <select
          aria-label={`${field.label} — valeur manquante`}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-500 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          value={code ?? 'value'}
          onChange={(e) => onChange(e.target.value === 'value' ? null : makeMissing(e.target.value as MissingCode))}
        >
          <option value="value">{t('missing.value')}</option>
          {options.map((c) => (
            <option key={c} value={c}>
              {t(`missing.${c}` as const)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
