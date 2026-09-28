import type { ReactNode } from 'react';
import { useI18n } from '../i18n/useI18n';
import { HelpTip } from './HelpTip';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * Audit UI mobile, lot 1 (decision 2) : sur telephone, la description passe derriere un ⓘ.
   * Une description qui porte un avertissement ou un etat (hors-ligne, confidentialite) doit
   * rester lisible sans geste : elle garde alors sa place sous le titre.
   */
  keepDescription?: boolean;
  /**
   * Audit UI mobile, lot 2 : sous `lg`, la barre haute porte deja ce titre (nom de la base,
   * code du patient). Le titre ne reste que pour les lecteurs d'ecran ; sur-titre, badge, aide
   * et actions laissent la place, l'ecran les offrant autrement (bouton flottant, menu « ⋯ »).
   * Une description conservee (`keepDescription`) reste affichee.
   */
  titleInTopBar?: boolean;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}
/** En-tete commun : contexte, titre, aide courte et action principale. */
export function PageHeader({ title, description, keepDescription = false, titleInTopBar = false, eyebrow, badge, actions }: PageHeaderProps) {
  const { t } = useI18n();
  const tip = !!description && !keepDescription;
  const desktopOnly = titleInTopBar ? ' max-lg:hidden' : '';
  return (
    // Les actions restent sur la ligne du titre quand elles y tiennent, et passent dessous sinon.
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 max-w-3xl flex-1 basis-60">
        {eyebrow && <div className={`eyebrow mb-1.5${desktopOnly}`}>{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className={`page-title${titleInTopBar ? ' max-lg:sr-only' : ''}`}>{title}</h1>
          {badge && (titleInTopBar ? <span className="max-lg:hidden">{badge}</span> : badge)}
          {tip && <HelpTip label={t('help.page')} className={`-my-2 sm:hidden${desktopOnly}`}>{description}</HelpTip>}
        </div>
        {description && <p className={`page-description${tip ? ' hidden sm:block' : ''}`}>{description}</p>}
      </div>
      {actions && <div className={`flex shrink-0 flex-wrap items-center gap-2${desktopOnly}`}>{actions}</div>}
    </header>
  );
}
