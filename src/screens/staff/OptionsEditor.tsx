import { useState, type KeyboardEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { makeValueKey, optionKeys, type FieldOption } from '../../domain/fieldOptions';
import { Checkbox } from '../../components/Checkbox';
import { HelpDetails } from '../../components/HelpTip';

/**
 * L30 — editeur des options d'une liste controlee.
 *
 * Remplace la zone de texte libre, qui melangeait le libelle et la valeur stockee. Ici,
 * le LIBELLE se modifie a volonte et le CODE, fixe a la creation de l'option, ne bouge
 * plus jamais : c'est ce qui permet de corriger « hematome » en « hématome » sans
 * invalider les fiches deja saisies ni scinder une modalite en deux.
 *
 * Le code est affiche mais non modifiable. Le montrer n'est pas un detail technique
 * gratuit : c'est lui qui apparaitra dans la colonne de code de l'export, donc dans
 * l'analyse.
 */
/** Option retiree de la liste alors que des dossiers la portent encore. */
export interface RetiredOption {
  option: FieldOption;
  records: number;
}

// Valeur technique du choix « vider » dans le menu : `makeValueKey` ne produit jamais de code
// commencant par `_`, donc aucune option creee a l'ecran ne peut la porter.
const CLEAR_CHOICE = '__clear__';

export function OptionsEditor({
  options,
  onChange,
  /** Variable deja utilisee, sans comptes d'usage : une option ne peut plus etre supprimee,
   *  seulement desactivee (parcours qui ne sait pas remplacer les valeurs). */
  locked = false,
  retired = [],
  replacements = {},
  onReplacementChange,
  showReplacementError = false,
}: {
  options: FieldOption[];
  onChange: (next: FieldOption[]) => void;
  locked?: boolean;
  /** Variable deja utilisee, comptes connus : options retirees encore choisies dans des
   *  dossiers. Chacune exige un remplacement ou le vidage avant l'enregistrement. */
  retired?: RetiredOption[];
  /** Code retire -> code de remplacement, `null` = vider, absent = pas encore choisi. */
  replacements?: Record<string, string | null | undefined>;
  onReplacementChange?: (valueKey: string, replacement: string | null | undefined) => void;
  showReplacementError?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const label = draft.trim();
    if (!label) return;
    // Doublon compare sur le libelle NORMALISE : deux options qui ne different que par la
    // casse seraient indiscernables a la saisie et ambigues a la conversion.
    if (options.some((o) => o.label.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      setError(t('admin.option_duplicate'));
      return;
    }
    setError(null);
    onChange([...options, { valueKey: makeValueKey(label, optionKeys(options)), label, isActive: true }]);
    setDraft('');
  }

  function onDraftKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Entree ajoute l'option au lieu de soumettre le formulaire entier : on saisit une
    // liste de vingt valeurs a la chaine, pas une par visite d'ecran.
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  const update = (index: number, patch: Partial<FieldOption>) =>
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="helper-text">{t('admin.options_hint')} <HelpDetails>{t('admin.options_hint_details')}</HelpDetails></p>

      {options.length === 0 && <p className="text-xs text-slate-500">{t('admin.options_empty')}</p>}

      <ul className="flex flex-col gap-2">
        {options.map((option, index) => (
          <li key={option.valueKey} className="surface-muted flex flex-wrap items-center gap-2 p-2">
            <input
              className="input flex-1 min-w-40"
              aria-label={`${t('admin.option_label')} ${index + 1}`}
              value={option.label}
              onChange={(e) => update(index, { label: e.target.value })}
            />
            <code className="text-xs text-slate-500" title={t('admin.option_code')}>
              {t('admin.option_code')} : {option.valueKey}
            </code>
            <Checkbox
              label={option.isActive ? t('admin.option_deactivate') : t('admin.option_reactivate')}
              checked={!option.isActive}
              onChange={(e) => update(index, { isActive: !e.target.checked })}
              containerClassName="text-xs"
            />
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                className="btn-ghost px-2"
                aria-label={`${t('admin.option_up')} ${option.label}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-ghost px-2"
                aria-label={`${t('admin.option_down')} ${option.label}`}
                disabled={index === options.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              {/* Sans comptes d'usage, supprimer disparait des que la variable porte des
                  donnees : une option retiree rendrait invalides les fiches qui la portent.
                  Avec les comptes, le retrait passe par un remplacement choisi ci-dessous. */}
              {!locked && (
                <button
                  type="button"
                  className="btn-ghost px-2 text-red-700"
                  aria-label={`${t('admin.option_remove')} ${option.label}`}
                  onClick={() => onChange(options.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <label className="form-label flex-1 min-w-40">
          {t('admin.option_add')}
          <input
            className="input"
            value={draft}
            placeholder={t('admin.option_new_ph')}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={onDraftKeyDown}
          />
        </label>
        <button type="button" className="btn-secondary" onClick={add} disabled={!draft.trim()}>
          {t('admin.option_add')}
        </button>
      </div>

      {retired.length > 0 && (
        <fieldset className="surface-muted flex flex-col gap-2 p-2">
          <legend className="text-sm font-semibold text-slate-700">{t('admin.option_retired_title')}</legend>
          {retired.map(({ option, records }) => {
            const choice = replacements[option.valueKey];
            const value = choice === undefined ? '' : choice === null ? CLEAR_CHOICE : choice;
            return (
              <div key={option.valueKey} className="flex flex-wrap items-end gap-2">
                <span className="text-sm text-slate-700">
                  {t('admin.option_retired_row').replace('{label}', option.label).replace('{n}', String(records))}
                </span>
                <label className="form-label flex-1 min-w-40">
                  {t('admin.option_replacement_label').replace('{label}', option.label)}
                  <select
                    className="input"
                    value={value}
                    aria-invalid={showReplacementError && choice === undefined}
                    onChange={(e) => onReplacementChange?.(option.valueKey,
                      e.target.value === '' ? undefined : e.target.value === CLEAR_CHOICE ? null : e.target.value)}
                  >
                    <option value="">{t('admin.option_replacement_choose')}</option>
                    {options.filter((o) => o.isActive).map((o) => (
                      <option key={o.valueKey} value={o.valueKey}>{o.label}</option>
                    ))}
                    <option value={CLEAR_CHOICE}>{t('admin.option_replacement_clear')}</option>
                  </select>
                </label>
                <button type="button" className="btn-ghost px-2" onClick={() => onChange([...options, option])}>
                  {t('admin.option_restore')}
                </button>
              </div>
            );
          })}
          <p className="helper-text">{t('admin.option_replacement_hint')}</p>
          {showReplacementError && (
            <p role="alert" className="text-xs text-red-700">{t('admin.option_replacement_required')}</p>
          )}
        </fieldset>
      )}

      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <p className="text-xs text-slate-500">{options.length} {t('admin.values_count')}</p>
      <p className="helper-text">{t('admin.option_inactive_hint')}</p>
      {locked && <p className="text-xs text-amber-700">{t('admin.options_locked_hint')}</p>}
    </div>
  );
}
