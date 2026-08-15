import type { TemplateField, TerminologyValue } from '../../data/types';
import { isOrphanValue, selectableOptions } from '../../domain/fieldOptions';
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
    // L30 : la valeur enregistree est le CODE de l'option, le libelle n'est qu'affiche.
    // Corriger un libelle ne touche donc aucune fiche. Les options desactivees sortent de
    // la saisie, mais celle que la fiche porte deja reste offerte : la retirer du menu
    // effacerait sa valeur au premier enregistrement.
    case 'select': {
      const opts = selectableOptions(field, value);
      const orphan = isOrphanValue(field, value);
      return (
        <select className={cls} aria-label={field.label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {/* Valeur hors liste (sequelle d'un renommage anterieur a L30) : conservee et
              montree telle quelle, jamais effacee ni remplacee en silence. */}
          {orphan && <option value={value as string}>{String(value)}</option>}
          {opts.map((o) => (
            <option key={o.valueKey} value={o.valueKey}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : [];
      const opts = selectableOptions(field, arr);
      const known = new Set(opts.map((o) => o.valueKey));
      const orphans = arr.filter((v) => !known.has(v));
      return (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => (
            <Checkbox
              key={o.valueKey}
              checked={arr.includes(o.valueKey)}
              onChange={(e) => onChange(e.target.checked ? [...arr, o.valueKey] : arr.filter((x) => x !== o.valueKey))}
              label={o.label}
              containerClassName="text-xs"
            />
          ))}
          {orphans.map((v) => (
            <Checkbox
              key={v}
              checked
              onChange={(e) => onChange(e.target.checked ? [...arr, v] : arr.filter((x) => x !== v))}
              label={v}
              containerClassName="text-xs"
            />
          ))}
        </div>
      );
    }
    default:
      return (
        <input type="text" className={cls} aria-label={field.label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      );
  }
}
