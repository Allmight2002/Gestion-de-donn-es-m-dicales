import type { ElementType, ReactNode } from 'react';

interface SectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
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
  actions,
  icon: Icon,
  children,
  className = '',
  bodyClassName = '',
}: SectionCardProps) {
  const hasHeader = title || description || actions || Icon;
  return (
    <section className={`card overflow-hidden ${className}`}>
      {hasHeader && (
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            {Icon && (
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/15">
                <Icon size={17} aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="section-title">{title}</h2>}
              {description && <p className="section-description">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName || 'p-5'}>{children}</div>
    </section>
  );
}
