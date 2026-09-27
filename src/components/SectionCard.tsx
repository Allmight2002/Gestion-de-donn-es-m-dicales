import type { ElementType, ReactNode } from 'react';
import { useI18n } from '../i18n/useI18n';
import { HelpTip } from './HelpTip';

interface SectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  /**
   * Audit UI mobile, lot 3 : sur telephone, la description passe derriere un ⓘ, comme celle
   * des en-tetes de page. Un avis (etat, confidentialite, consequence d'une suppression) doit
   * rester lisible sans geste : il garde alors sa place sous le titre.
   */
  keepDescription?: boolean;
  actions?: ReactNode;
  icon?: ElementType;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}
/** Surface commune pour une section de travail, avec une hierarchie stable. */
export function SectionCard({
  title,
  description,
  keepDescription = false,
  actions,
  icon: Icon,
  children,
  className = '',
  bodyClassName = '',
}: SectionCardProps) {
  const { t } = useI18n();
  const hasHeader = title || description || actions || Icon;
  const tip = !!description && !keepDescription;
  return (
    <section className={`card overflow-hidden ${className}`}>
      {hasHeader && (
        // Audit UI mobile, lot 1 (T2-A) : sur telephone, l'icone decorative disparait, les marges
        // se resserrent et les actions restent sur la ligne du titre quand elles y tiennent.
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 flex-1 basis-48 gap-3">
            {Icon && (
              <span className="mt-0.5 hidden h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/15 sm:grid">
                <Icon size={17} aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              {(title || tip) && (
                <div className="flex items-center gap-x-1">
                  {title && <h2 className="section-title">{title}</h2>}
                  {tip && <HelpTip label={t('help.section')} className="-my-2.5 sm:hidden">{description}</HelpTip>}
                </div>
              )}
              {description && <p className={`section-description${tip ? ' hidden sm:block' : ''}`}>{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName || 'p-4 sm:p-5'}>{children}</div>
    </section>
  );
}
