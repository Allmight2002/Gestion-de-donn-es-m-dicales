import type { TemplateField } from '../../data/types';
import { selectableOptions } from '../../domain/fieldOptions';
import { TerminologyInput } from './TerminologyInput';
import { DatePickerInput } from '../../components/DatePickerInput';
import { ChoiceInput, type ChoicePresentation } from '../../components/ChoiceInput';
import { Checkbox } from '../../components/Checkbox';

const cls = 'input';

// Les seuils restent lisibles et déterministes : la largeur réelle est ensuite gérée par la
// grille responsive. Les listes de huit éléments ou de libellés très longs sont recherchables,
// tandis que les listes intermédiaires restent des contrôles natifs faciles à parcourir.
const SHORT_CHOICE_LIMIT = 5;
const SHORT_LABEL_LIMIT = 32;
const LONG_CHOICE_LIMIT = 8;
const LONG_LABEL_LIMIT = 48;

function optionPresentation(
  type: 'select' | 'multiselect',
  options: readonly { label: string }[],
): ChoicePresentation {
  const hasLongLabel = options.some((option) => option.label.length > LONG_LABEL_LIMIT);
  const long = options.length >= LONG_CHOICE_LIMIT || hasLongLabel;
  if (type === 'multiselect') return long ? 'search-multiple' : 'grid';
  if (long) return 'search';
  if (options.length >= 2 && options.length <= SHORT_CHOICE_LIMIT && options.every((option) => option.label.length <= SHORT_LABEL_LIMIT)) {
    return 'radios';
  }
  return 'select';
}

function optionsHeldByValue(field: TemplateField, value: unknown) {
  const options = selectableOptions(field, value);
  const held = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : typeof value === 'string' && value !== '' ? [value] : [];
  const known = new Set(options.map((option) => option.valueKey));
  // Une valeur historique inconnue n'est jamais supprimée au changement de présentation.
  for (const valueKey of held) {
    if (!known.has(valueKey)) {
      options.push({ valueKey, label: valueKey, isActive: false });
      known.add(valueKey);
    }
  }
  return options;
}

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
        <DatePickerInput value={(value as string) ?? ''} ariaLabel={field.label} onChange={onChange} />
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
          onChange={(v) => onChange(v)}
        />
      );
    // L30 : la valeur enregistree est le CODE de l'option, le libelle n'est qu'affiche.
    // Corriger un libelle ne touche donc aucune fiche. Les options desactivees sortent de
    // la saisie, mais celle que la fiche porte deja reste offerte : la retirer du menu
    // effacerait sa valeur au premier enregistrement.
    case 'select': {
      const opts = optionsHeldByValue(field, value);
      const presentation = optionPresentation('select', selectableOptions(field, undefined));
      return (
        <ChoiceInput
          label={field.label}
          options={opts}
          value={typeof value === 'string' ? value : null}
          onChange={onChange}
          presentation={presentation}
          name={field.fieldKey}
        />
      );
    }
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : [];
      const opts = optionsHeldByValue(field, arr);
      const presentation = optionPresentation('multiselect', selectableOptions(field, undefined));
      return (
        <ChoiceInput
          label={field.label}
          options={opts}
          value={arr}
          onChange={onChange}
          presentation={presentation}
          name={field.fieldKey}
        />
      );
    }
    default:
      return (
        <input type="text" className={cls} aria-label={field.label} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      );
  }
}
