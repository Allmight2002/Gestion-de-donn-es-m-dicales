import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import type { InspectionStatus } from '../data/inspection';
import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';

const BADGE: Record<InspectionStatus, { className: string; Icon: typeof CheckCircle2 }> = {
  accepted: { className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', Icon: CheckCircle2 },
  accepted_client: { className: 'bg-slate-100 text-slate-600 ring-slate-500/20', Icon: CheckCircle2 },
  pending: { className: 'bg-amber-50 text-amber-700 ring-amber-600/20', Icon: Clock3 },
  scanning: { className: 'bg-sky-50 text-sky-700 ring-sky-600/20', Icon: LoaderCircle },
  quarantined: { className: 'bg-red-50 text-red-700 ring-red-600/20', Icon: ShieldAlert },
};

export function InspectionStatusBadge({ status }: { status: InspectionStatus }) {
  const { t } = useI18n();
  const { className, Icon } = BADGE[status];
  return (
    <span className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{t(`inspection.${status}` as MessageKey)}</span>
    </span>
  );
}

export function RetryInspectionButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      title={t('inspection.retry')}
      aria-label={t('inspection.retry')}
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
