import { useState, type KeyboardEvent } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { makeValueKey, optionKeys, type FieldOption } from '../../domain/fieldOptions';
import { Checkbox } from '../../components/Checkbox';

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
export function OptionsEditor({
  options,
  onChange,
  /** Variable deja utilisee : une option ne peut plus etre supprimee, seulement desactivee. */
  locked = false,
}: {
  options: FieldOption[];
  onChange: (next: FieldOption[]) => void;
  locked?: boolean;
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
      <p className="helper-text">{t('admin.options_hint')}</p>

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
              {/* Supprimer disparait des que la variable porte des donnees : le serveur le
                  refuserait, et une option retiree rendrait invalides les fiches qui la
                  portent. La desactivation reste offerte, elle. */}
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

      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <p className="text-xs text-slate-500">{options.length} {t('admin.values_count')}</p>
      <p className="helper-text">{t('admin.option_inactive_hint')}</p>
      {locked && <p className="text-xs text-amber-700">{t('admin.options_locked_hint')}</p>}
    </div>
  );
}
