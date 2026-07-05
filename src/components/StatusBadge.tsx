import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';

// UI-2 — pastille de statut de validation COLOREE (avant : pilule grise partout).
// brouillon = ambre (en cours), complete = bleu (saisi), finalise = vert (valide).
const STYLES: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-800',
  complete: 'bg-sky-50 text-sky-700',
  curated: 'bg-green-50 text-green-700',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const style = STYLES[status] ?? 'bg-slate-100 text-slate-600';
  const label = ['draft', 'complete', 'curated'].includes(status) ? t(`encstatus.${status}` as MessageKey) : status;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
