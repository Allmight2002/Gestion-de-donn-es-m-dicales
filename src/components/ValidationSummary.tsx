import { useId, type ReactNode } from 'react';
import { useI18n } from '../i18n/useI18n';

/** Erreur affichable dans un résumé de validation après une action de soumission. */
export interface ValidationSummaryItem {
  /** Identifiant stable de l'erreur, utile à la logique de l'écran appelant. */
  id: string;
  label: ReactNode;
  message?: ReactNode;
  /** ID du contrôle réellement rendu ; sans cette propriété, aucun lien artificiel n'est créé. */
  targetId?: string;
}

export interface ValidationSummaryProps {
  errors: readonly ValidationSummaryItem[];
  title?: ReactNode;
  onNavigate?: (item: ValidationSummaryItem) => void;
  className?: string;
}

/**
 * Résumé compact et navigable des erreurs connues par un formulaire.
 *
 * Le composant ne déclenche aucune validation et ne gère pas l'état « soumis » : l'écran
 * appelant décide quand le rendre, ce qui évite une annonce à chaque frappe. Un lien est
 * produit seulement lorsqu'un contrôle cible explicite a été fourni.
 */
export function ValidationSummary({ errors, title, onNavigate, className = '' }: ValidationSummaryProps) {
  const { t } = useI18n();
  const titleId = useId();
  if (errors.length === 0) return null;

  return (
    <section
      className={`rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200 ${className}`}
      role="region"
      tabIndex={-1}
      data-validation-summary
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="font-semibold">{title ?? t('form.errors_title')}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {errors.map((item) => (
          <li key={item.id}>
            {item.targetId ? (
              <a
                href={`#${item.targetId}`}
                onClick={(event) => { if (onNavigate) { event.preventDefault(); onNavigate(item); } }}
                className="font-medium underline underline-offset-2"
              >
                {item.label}
              </a>
            ) : (
              <span className="font-medium">{item.label}</span>
            )}
            {item.message && <span> : {item.message}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
