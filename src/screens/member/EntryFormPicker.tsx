import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useEntryFormRepository } from '../../data/RepositoryProvider';
import type { EntryForm } from '../../data/entryForms';
import { useI18n } from '../../i18n/useI18n';

/**
 * Choix du formulaire de saisie d'une fiche : formulaire complet ou formulaire court de la base.
 *
 * Le choix est un etat LOCAL de l'ecran : changer de formulaire ne quitte pas la page et ne
 * perd aucune saisie. `?form=<id>` ne sert qu'a ouvrir l'ecran directement sur un formulaire.
 * Un compte de mission ne peut pas enregistrer de fiche partielle : il garde le formulaire complet.
 */
export function useEntryFormSelection(baseId: string | undefined, enabled: boolean) {
  const repository = useEntryFormRepository();
  const [params] = useSearchParams();
  const [requestedId] = useState(() => params.get('form'));
  const [forms, setForms] = useState<EntryForm[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [loading, setLoading] = useState(enabled && requestedId !== null);
  const [problem, setProblem] = useState<'load' | 'missing' | null>(null);

  useEffect(() => {
    if (!baseId || !enabled) { setForms([]); setLoading(false); return; }
    let active = true;
    repository.list(baseId).then((rows) => {
      if (!active) return;
      setForms(rows);
      // Un lien vers un formulaire supprime retombe sur le formulaire complet, et le dit.
      if (requestedId && !rows.some((form) => form.id === requestedId)) { setSelectedId(null); setProblem('missing'); }
    }).catch(() => {
      if (!active) return;
      setForms([]);
      if (requestedId) { setSelectedId(null); setProblem('load'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [baseId, enabled, repository, requestedId]);

  const selected = useMemo(
    () => (enabled ? forms.find((form) => form.id === selectedId) ?? null : null),
    [enabled, forms, selectedId],
  );
  return { forms: enabled ? forms : [], selected, loading, problem, select: (id: string | null) => { setSelectedId(id); setProblem(null); } };
}

export function EntryFormPicker({ forms, selected, onSelect, disabled = false }: {
  forms: readonly EntryForm[];
  selected: EntryForm | null;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (forms.length === 0) return null;
  // Une seule ligne, au meme endroit en creation et en modification : le choix du formulaire
  // ne doit pas repousser le premier champ sous le premier ecran.
  return (
    <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-slate-700 dark:text-slate-200">{t('entryform.picker_label')}</span>
      <select
        className="input w-auto min-w-0 max-w-full sm:w-72"
        value={selected?.id ?? ''}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value || null)}
      >
        <option value="">{t('entryform.full')}</option>
        {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
      </select>
    </label>
  );
}

export function EntryFormNotice({ selected, problem, unavailableCount, mode }: {
  selected: EntryForm | null;
  problem: 'load' | 'missing' | null;
  unavailableCount?: number;
  /** A la creation, rien n'est encore « conserve » : le reste du dossier se complete ensuite. */
  mode: 'create' | 'edit';
}) {
  const { t } = useI18n();
  if (problem) {
    return <p role="status" className="text-sm text-amber-800 dark:text-amber-200">{t(problem === 'missing' ? 'entryform.missing' : 'entryform.load_error')}</p>;
  }
  if (!selected) return null;
  return (
    <p role="status" className="text-xs text-teal-800 dark:text-teal-200">
      {t(mode === 'create' ? 'entryform.short_notice_new' : 'entryform.short_notice')}
      {unavailableCount ? <span className="block">{t('entryform.stale_count').replace('{n}', String(unavailableCount))}</span> : null}
    </p>
  );
}
