import { useId, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
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
 *
 * Audit UI mobile, lot 6 (5.13) : la recherche et la liste native ne font plus qu'UN controle,
 * une liste recherchable (combobox ARIA 1.2). La liste s'ouvre dans le flux, sous le champ :
 * dans un panneau ou une fenetre qui defile, elle n'est jamais rognee. Sous le seuil, la liste
 * native reste la plus simple.
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
  // `null` : pas de recherche en cours, le champ montre la variable choisie.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const searchable = options.length >= SEARCHABLE_FIELD_COUNT;

  if (!searchable) {
    return (
      <div className="flex flex-col text-xs text-slate-600">
        <span>{label}</span>
        <select className="input mt-1" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{chooseLabel}</option>
          {options.map((field) => <option key={field.id} value={field.fieldKey}>{optionLabel(field)}</option>)}
        </select>
      </div>
    );
  }

  const selected = options.find((field) => field.fieldKey === value);
  const needle = (query ?? '').trim().toLocaleLowerCase();
  const shown = needle
    ? options.filter((field) => field.fieldKey === value
      || `${field.label} ${field.fieldKey} ${optionLabel(field)}`.toLocaleLowerCase().includes(needle))
    : options;
  // Premiere entree : « Choisir… », qui vide le choix comme dans la liste native.
  const entries: { key: string; text: string }[] = [
    { key: '', text: chooseLabel },
    ...shown.map((field) => ({ key: field.fieldKey, text: optionLabel(field) })),
  ];
  const optionId = (index: number) => `${listId}-option-${index}`;

  const close = () => { setOpen(false); setQuery(null); setActive(-1); };
  const choose = (key: string) => { onChange(key); close(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) { setOpen(true); setActive(Math.max(0, entries.findIndex((entry) => entry.key === value))); return; }
      setActive((current) => Math.min(entries.length - 1, Math.max(0, current + delta)));
    } else if (event.key === 'Enter' && open) {
      // Sans ce garde, Entree soumettrait le formulaire de la regle au lieu de choisir.
      event.preventDefault();
      if (active >= 0 && entries[active]) choose(entries[active].key);
    } else if (event.key === 'Escape' && open) {
      // Echap referme la liste, pas le panneau qui la contient.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="flex flex-col text-xs text-slate-600">
      <span>{label}</span>
      <div className="relative mt-1">
        <input
          type="text"
          role="combobox"
          className="input pr-9"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          placeholder={searchLabel}
          value={query ?? (selected ? optionLabel(selected) : '')}
          // Ouverte au toucher, a la frappe ou par les fleches, pas au simple passage du focus :
          // parcourir le formulaire au clavier ne deplie pas chaque liste.
          onClick={() => setOpen(true)}
          // Taper remplace le libelle affiche au lieu de s'y ajouter.
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label={label} onMouseDown={(event) => event.preventDefault()}
          className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {entries.map((entry, index) => (
            <li
              key={entry.key || '__choose__'}
              id={optionId(index)}
              role="option"
              aria-selected={entry.key === value}
              // Le champ garde le focus (liste ci-dessus) : on choisit au doigt comme au clavier.
              onClick={() => choose(entry.key)}
              className={`min-h-11 cursor-pointer rounded-lg px-3 py-2.5 text-sm ${index === active ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-100'} ${entry.key === value ? 'font-semibold' : ''} ${entry.key === '' ? 'text-slate-500' : ''}`}
            >
              {entry.text}
            </li>
          ))}
        </ul>
      )}
      {needle !== '' && (
        <span className="mt-1 text-[11px] text-slate-500" role="status">
          {shown.length === 0 ? emptyLabel : countLabel(shown.length, options.length)}
        </span>
      )}
    </div>
  );
}
