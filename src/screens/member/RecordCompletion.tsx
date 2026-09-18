import type { ReactNode } from 'react';
import { ListChecks } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';

/**
 * E5 — annonce des variables ajoutées au formulaire après l'enregistrement d'une fiche.
 *
 * Elle est NON BLOQUANTE, comme la couverture diagnostique : elle compte et nomme ce qui reste
 * à renseigner dans le formulaire courant, sans rien écrire, sans proposer de valeur et sans
 * changer le statut clinique du dossier. Une correction indépendante reste enregistrable sans
 * compléter ces ajouts.
 */
export function RecordCompletionNotice({ labels, requiredLabels = [], action }: {
  labels: readonly string[];
  /** Ajouts que le formulaire courant attend ; le serveur les a comptés, l'écran les nomme. */
  requiredLabels?: readonly string[];
  action?: ReactNode;
}) {
  const { t } = useI18n();
  if (labels.length === 0) return null;
  return (
    <div role="status" className="flex gap-2 rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
      <ListChecks size={16} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p>{t('completion.added_count').replace('{n}', String(labels.length))}</p>
        <p className="mt-1 font-medium">{labels.join(', ')}</p>
        {requiredLabels.length > 0 && (
          <p className="mt-1">
            {t('completion.required_count').replace('{n}', String(requiredLabels.length))}{' '}
            <span className="font-medium">{requiredLabels.join(', ')}</span>
          </p>
        )}
        <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">{t('completion.status_unchanged')}</p>
        {action}
      </div>
    </div>
  );
}
