import { useLayoutEffect, type ReactNode } from 'react';
import { useI18n } from '../i18n/useI18n';

/**
 * Audit UI mobile, lot 1 (T6) — la barre d'enregistrement des formulaires, ecrite une fois.
 *
 * Recopiee dans chaque formulaire, elle occupait deux lignes sur telephone (94 px) et y
 * affichait un raccourci clavier. Ici :
 * - une ligne : l'action principale, « Annuler » a partir de `lg`, puis les actions de reprise ;
 *   sous `lg`, le formulaire inscrit ✕ dans la barre haute (`useTopBar`), qui remplace « Annuler » ;
 * - le raccourci clavier n'apparait qu'avec un pointeur fin, et jamais sur un ecran etroit ;
 * - sur telephone, la barre est collee au bas de l'ecran, zone sure comprise ; le defilement vers
 *   un champ (Tab, erreur) s'arrete au-dessus d'elle, pour qu'elle ne masque jamais le champ actif.
 */
export function FormActionBar({ children, onCancel, extra, notice }: {
  /** L'action principale (bouton `submit`). */
  children: ReactNode;
  onCancel?: () => void;
  /** Actions de reprise, rares (recharger apres un conflit…), apres « Annuler ». */
  extra?: ReactNode;
  /** Etat qui empeche d'enregistrer, annonce au-dessus des boutons. */
  notice?: ReactNode;
}) {
  const { t } = useI18n();

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = '5rem';
    return () => { root.style.scrollPaddingBottom = previous; };
  }, []);

  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:bottom-2 sm:mx-0 sm:rounded-xl sm:border sm:p-3 sm:shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      {notice && <p role="status" className="mb-2 text-sm text-amber-700">{notice}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary max-lg:hidden">
            {t('common.cancel')}
          </button>
        )}
        {extra}
        <span className="keyboard-hint ml-auto text-xs text-slate-400 max-sm:hidden">{t('common.save_shortcut')}</span>
      </div>
    </div>
  );
}
