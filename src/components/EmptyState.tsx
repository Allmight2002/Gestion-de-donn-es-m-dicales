import type { ElementType, ReactNode } from 'react';

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ElementType;
  compact?: boolean;
}
export function EmptyState({ title, description, action, icon: Icon, compact = false }: EmptyStateProps) {
  return (
    <div className={`rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 text-center ${compact ? 'p-6' : 'p-10'}`}>
      {Icon && (
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      {description && <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
