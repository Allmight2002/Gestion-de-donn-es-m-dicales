import type { TemplateField } from '../../data/types';

const cls = 'rounded border border-slate-300 px-2 py-1 text-sm';

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
        <input
          type="checkbox"
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
              <label key={s} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={arr.includes(s)}
                  onChange={(e) => onChange(e.target.checked ? [...arr, s] : arr.filter((x) => x !== s))}
                />
                {s}
              </label>
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
