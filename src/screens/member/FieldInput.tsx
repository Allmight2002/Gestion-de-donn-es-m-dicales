import type { TemplateField, TerminologyValue } from '../../data/types';
import { TerminologyInput } from './TerminologyInput';
import { Checkbox } from '../../components/Checkbox';

const cls = 'input';

// Rendu basique d'un champ de gabarit selon son type. Les controles complets
// (bornes, requis, valeurs manquantes codifiees) arrivent a l'etape 7.
export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case 'boolean':
      return (
        <Checkbox
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={field.label}
        />
      );
    case 'number':
    case 'integer':
      return (
        <input
          type="number"
          className={cls}
          aria-label={field.label}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <input type="date" className={cls} aria-label={field.label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          className={cls}
          aria-label={field.label}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'terminology':
      return (
        <TerminologyInput
          field={field}
          value={value}
          onChange={(v: TerminologyValue | null) => onChange(v)}
        />
      );
    case 'select': {
      const opts = Array.isArray(field.allowedValues) ? field.allowedValues : [];
      return (
        <select className={cls} aria-label={field.label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {opts.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      );
    }
    case 'multiselect': {
      const opts = Array.isArray(field.allowedValues) ? field.allowedValues : [];
      const arr = Array.isArray(value) ? (value as unknown[]).map(String) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const s = String(o);
            return (
              <Checkbox
                  key={s}
                  checked={arr.includes(s)}
                  onChange={(e) => onChange(e.target.checked ? [...arr, s] : arr.filter((x) => x !== s))}
                  label={s}
                  containerClassName="text-xs"
                />
            );
          })}
        </div>
      );
    }
    default:
      return (
        <input type="text" className={cls} aria-label={field.label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      );
  }
}
