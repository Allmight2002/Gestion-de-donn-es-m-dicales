import { useState } from 'react';
import type { TemplateField } from '../../data/types';

/** Au-dela de ce nombre, parcourir une liste native devient l'irritant principal (UX-14(b)). */
const SEARCHABLE_FIELD_COUNT = 8;

/**
 * Selecteur de variable RECHERCHABLE. La recherche ne fait que reduire la liste proposee :
 * la valeur echangee reste la cle de la variable, les exclusions de type/portee/formule
 * restent decidees par l'appelant, et la variable deja choisie reste toujours proposee —
 * filtrer ne doit jamais effacer une reponse deja donnee.
 *
 * Sorti de `RuleForm` en UX-14(d) : le deplacement direct d'une variable pose exactement le
 * meme probleme sur 216 lignes — choisir une cible sans la faire defiler — et deux listes
 * recherchables qui divergeraient se comporteraient differemment au clavier.
 */
export function FieldSelect({
  label, value, options, optionLabel, onChange, searchLabel, chooseLabel, emptyLabel, countLabel,
}: {
  label: string;
  value: string;
  options: TemplateField[];
  optionLabel: (field: TemplateField) => string;
  onChange: (value: string) => void;
  searchLabel: string;
  chooseLabel: string;
  emptyLabel: string;
  countLabel: (shown: number, total: number) => string;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? options.filter((field) => field.fieldKey === value
      || `${field.label} ${field.fieldKey} ${optionLabel(field)}`.toLocaleLowerCase().includes(needle))
    : options;
  const searchable = options.length >= SEARCHABLE_FIELD_COUNT;
  return (
    <div className="flex flex-col text-xs text-slate-600">
      <span>{label}</span>
      {searchable && (
        <input
          type="search"
          className="input mt-1"
          value={query}
          autoComplete="off"
          aria-label={`${searchLabel} — ${label}`}
          placeholder={searchLabel}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <select className="input mt-1" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{chooseLabel}</option>
        {shown.map((field) => <option key={field.id} value={field.fieldKey}>{optionLabel(field)}</option>)}
      </select>
      {searchable && needle !== '' && (
        <span className="mt-1 text-[11px] text-slate-500" role="status">
          {shown.length === 0 ? emptyLabel : countLabel(shown.length, options.length)}
        </span>
      )}
    </div>
  );
}
