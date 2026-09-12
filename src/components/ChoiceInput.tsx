import { useId, useState, type ChangeEvent } from 'react';
import { useI18n } from '../i18n/useI18n';
import type { FieldOption } from '../domain/fieldOptions';
import { Checkbox } from './Checkbox';

/**
 * Présentation choisie par FieldInput à partir du nombre et de la longueur des options.
 * La valeur échangée reste toujours la clé stable de l'option.
 */
export type ChoicePresentation = 'radios' | 'select' | 'grid' | 'search' | 'search-multiple';

export interface ChoiceInputProps {
  label: string;
  options: readonly FieldOption[];
  value: string | string[] | null | undefined;
  onChange: (value: string | string[] | null) => void;
  presentation: ChoicePresentation;
  name?: string;
  emptyLabel?: string;
  singleHint?: string;
  multipleHint?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  clearSearchLabel?: string;
  clearSelectionLabel?: string;
  removeLabel?: string;
}

const inputClass = 'h-5 w-5 shrink-0 accent-teal-700 dark:accent-teal-500';

function singleValue(value: ChoiceInputProps['value']): string {
  return typeof value === 'string' ? value : '';
}

function multipleValues(value: ChoiceInputProps['value']): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function optionText(option: FieldOption): string {
  return option.label || option.valueKey;
}

function SearchBox({
  query,
  onQueryChange,
  inputId,
  listId,
  hasResults,
  searchLabel,
  searchPlaceholder,
  clearSearchLabel,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  inputId: string;
  listId: string;
  hasResults: boolean;
  searchLabel: string;
  searchPlaceholder: string;
  clearSearchLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={inputId}>{searchLabel}</label>
      <input
        id={inputId}
        type="search"
        className="input"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value)}
        placeholder={searchPlaceholder}
        autoComplete="off"
        aria-label={searchLabel}
        aria-describedby={!hasResults ? `${listId}-empty` : undefined}
      />
      {query !== '' && (
        <button
          type="button"
          className="btn-ghost shrink-0 px-2"
          onClick={() => onQueryChange('')}
          aria-label={clearSearchLabel}
        >
          ×
        </button>
      )}
    </div>
  );
}

function SearchResults({
  label,
  options,
  selected,
  multiple,
  listId,
  onChoose,
  onToggle,
}: {
  label: string;
  options: readonly FieldOption[];
  selected: string | string[];
  multiple: boolean;
  listId: string;
  onChoose: (value: string) => void;
  onToggle: (value: string, checked: boolean) => void;
}) {
  const selectedValues = Array.isArray(selected) ? selected : [selected];
  if (options.length === 0) return null;

  return (
    <ul
      id={listId}
      aria-label={label}
      className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      {options.map((option) => {
        const checked = selectedValues.includes(option.valueKey);
        return (
          <li key={option.valueKey}>
            {multiple ? (
              <label className={`flex min-h-11 cursor-pointer items-start gap-2.5 px-3 py-2 text-sm leading-5 text-slate-700 hover:bg-slate-50 focus-within:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-within:bg-slate-800 ${checked ? 'bg-teal-50 dark:bg-teal-950' : ''}`}>
                <input
                  type="checkbox"
                  className={inputClass}
                  checked={checked}
                  onChange={(event) => onToggle(option.valueKey, event.target.checked)}
                  aria-label={optionText(option)}
                />
                <span className="min-w-0 break-words">{optionText(option)}</span>
              </label>
            ) : (
              <label
                className={`flex min-h-11 w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left text-sm leading-5 focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-teal-700 ${checked
                  ? 'bg-teal-50 font-medium text-teal-900 dark:bg-teal-950 dark:text-teal-100'
                  : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <input type="radio" name={listId} value={option.valueKey} checked={checked} onChange={() => onChoose(option.valueKey)} className={inputClass} />
                <span className="min-w-0 break-words">{optionText(option)}</span>
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SelectionSummary({
  options,
  selected,
  countLabel,
  listLabel,
  clearSelectionLabel,
  removeLabel,
  onRemove,
  onClear,
}: {
  options: readonly FieldOption[];
  selected: readonly string[];
  countLabel: string;
  listLabel: string;
  clearSelectionLabel?: string;
  /** Gabarit du libelle de retrait : le {label} de l'option y est insere. */
  removeLabel: string;
  onRemove: (value: string) => void;
  onClear: () => void;
}) {
  if (selected.length === 0) return null;
  const byKey = new Map(options.map((option) => [option.valueKey, option]));

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300" role="status" aria-live="polite">
        {countLabel}
      </p>
      <ul className="flex flex-wrap gap-2" aria-label={listLabel}>
        {selected.map((value) => {
          const option = byKey.get(value);
          const text = option?.label || value;
          return (
            <li key={value} className="flex max-w-full items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-sm text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-100">
              <span className="min-w-0 break-words">{text}</span>
              <button
                type="button"
                className="min-h-11 min-w-11 shrink-0 rounded-md px-1 text-xs font-medium text-teal-800 hover:bg-teal-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700 dark:text-teal-100 dark:hover:bg-teal-900"
                onClick={() => onRemove(value)}
                aria-label={removeLabel.replace('{label}', text)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {clearSelectionLabel && (
        <button type="button" className="btn-ghost min-h-11 px-2 text-xs" onClick={onClear}>
          {clearSelectionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Rendu partagé des choix courts et longs. Les callbacks reçoivent les codes persistables,
 * jamais les libellés. Les options fournies à ce composant doivent déjà contenir les valeurs
 * historiques actuellement portées par la fiche.
 */
export function ChoiceInput({
  label,
  options,
  value,
  onChange,
  presentation,
  name,
  emptyLabel = '—',
  singleHint,
  multipleHint,
  searchLabel,
  searchPlaceholder,
  noResultsLabel,
  clearSearchLabel,
  clearSelectionLabel,
  removeLabel,
}: ChoiceInputProps) {
  const { t } = useI18n();
  const id = useId();
  const searchId = `${id}-search`;
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const multiple = presentation === 'grid' || presentation === 'search-multiple';
  const selected = multiple ? multipleValues(value) : singleValue(value);
  const selectedValues = multiple ? multipleValues(value) : [singleValue(value)];
  // Les libelles par defaut viennent du dictionnaire : aucun texte visible n'est fige en dur.
  const single = singleHint ?? t('choice.single_hint');
  const many = multipleHint ?? t('choice.multiple_hint');
  const noResults = noResultsLabel ?? t('choice.no_results');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = presentation === 'search' || presentation === 'search-multiple'
    ? options.filter((option) => optionText(option).toLocaleLowerCase().includes(normalizedQuery))
    : options;

  function changeMultiple(optionKey: string, checked: boolean) {
    const current = multipleValues(value);
    const next = checked
      ? (current.includes(optionKey) ? current : [...current, optionKey])
      : current.filter((item) => item !== optionKey);
    onChange(next);
  }

  if (presentation === 'select') {
    return (
      <select
        className="input"
        name={name}
        aria-label={label}
        value={singleValue(value)}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.valueKey} value={option.valueKey}>{optionText(option)}</option>
        ))}
      </select>
    );
  }

  if (presentation === 'radios') {
    return (
      <fieldset className="space-y-1" aria-label={label}>
        <p className="text-xs text-slate-500 dark:text-slate-400">{single}</p>
        <div className="grid grid-cols-1 gap-2 @min-[28rem]:grid-cols-2 @min-[44rem]:grid-cols-3">
          {options.map((option) => (
            <label key={option.valueKey} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm leading-5 text-slate-700 hover:bg-slate-100/80 focus-within:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-slate-800/70 dark:focus-within:bg-slate-800/70 ${singleValue(value) === option.valueKey ? 'bg-teal-50 dark:bg-teal-950' : ''}`}>
              <input
                type="radio"
                name={id}
                value={option.valueKey}
                checked={singleValue(value) === option.valueKey}
                onChange={() => onChange(option.valueKey)}
                className={inputClass}
              />
              <span className="min-w-0 break-words">{optionText(option)}</span>
            </label>
          ))}
        </div>
        {singleValue(value) !== '' && (
          <button type="button" className="btn-ghost min-h-11 px-2 text-xs" onClick={() => onChange(null)}>
            {clearSelectionLabel ?? t('choice.clear_answer_to').replace('{label}', label)}
          </button>
        )}
      </fieldset>
    );
  }

  if (presentation === 'grid') {
    return (
      <fieldset className="space-y-1" aria-label={label}>
        <p className="text-xs text-slate-500 dark:text-slate-400">{many}</p>
        <div className="grid grid-cols-1 gap-2 @min-[28rem]:grid-cols-2 @min-[44rem]:grid-cols-3">
          {options.map((option) => (
            <Checkbox
              key={option.valueKey}
              label={optionText(option)}
              checked={selectedValues.includes(option.valueKey)}
              onChange={(event) => changeMultiple(option.valueKey, event.target.checked)}
              containerClassName="min-w-0 items-start"
            />
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <div className="space-y-2" data-choice-presentation={presentation}>
      <p className="text-xs text-slate-500 dark:text-slate-400">{multiple ? many : single}</p>
      {multiple && (
        <SelectionSummary
          options={options}
          selected={selectedValues}
          countLabel={t('choice.selection_count').replace('{n}', String(selectedValues.length)).replace('{label}', label)}
          listLabel={t('choice.selections_of').replace('{label}', label)}
          clearSelectionLabel={clearSelectionLabel}
          removeLabel={removeLabel ?? t('choice.remove')}
          onRemove={(optionKey) => changeMultiple(optionKey, false)}
          onClear={() => onChange([])}
        />
      )}
      {!multiple && singleValue(value) !== '' && (
        <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-100">
          <span className="min-w-0 flex-1 break-words">{options.find((option) => option.valueKey === singleValue(value))?.label ?? singleValue(value)}</span>
          <button
            type="button"
            className="btn-ghost min-h-8 shrink-0 px-2 text-xs"
            onClick={() => onChange(null)}
          >
            {clearSelectionLabel ?? t('choice.clear_answer')}
          </button>
        </div>
      )}
      <SearchBox
        query={query}
        onQueryChange={setQuery}
        inputId={searchId}
        listId={listId}
        hasResults={filtered.length > 0}
        searchLabel={searchLabel ?? t('choice.search_label').replace('{label}', label)}
        searchPlaceholder={searchPlaceholder ?? t('choice.search_placeholder')}
        clearSearchLabel={clearSearchLabel ?? t('choice.clear_search')}
      />
      <SearchResults
        label={label}
        options={filtered}
        selected={selected}
        multiple={multiple}
        listId={listId}
        onChoose={(optionKey) => { onChange(optionKey); setQuery(''); }}
        onToggle={changeMultiple}
      />
      {filtered.length === 0 && <p id={`${listId}-empty`} className="text-xs text-slate-500 dark:text-slate-400" role="status">{noResults}</p>}
    </div>
  );
}
