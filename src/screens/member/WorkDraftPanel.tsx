import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useI18n } from '../../i18n/useI18n';
import type { WorkDraft } from '../../data/workDrafts';
import type { useWorkDraft } from './useWorkDraft';

export function WorkDraftPanel({ draft, online, baseId, patientId }: {
  draft: ReturnType<typeof useWorkDraft>;
  online: boolean;
  baseId: string;
  patientId?: string;
}) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<{ kind: 'resume' | 'discard'; draft: WorkDraft } | null>(null);
  if (!draft.enabled) return null;
  const local = draft.support === 'local';
  const time = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  // L'etat affiche suit le SUPPORT reellement accuse : une copie locale n'est jamais annoncee
  // comme une revision serveur, et une ancienne reussite ne masque pas l'echec le plus recent.
  const status = draft.loading ? t('draft.searching')
    : draft.locked && draft.state?.status !== 'consumed' ? t('draft.locked')
      : !online && !local ? t('draft.offline')
        : draft.state?.status === 'saving' ? t('draft.saving')
          : draft.protected && draft.state?.receipt
            ? t(local ? 'draft.saved_local' : 'draft.saved_server').replace('{time}', time(draft.state.receipt.updatedAt))
            : t('draft.unsaved');
  return <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
    <p role="status" aria-live="polite" className="text-slate-700 dark:text-slate-200">{status}</p>
    <p className="text-xs text-slate-500">{t('draft.clinical_only')}</p>
    {draft.error && <div className="space-y-2 text-amber-900 dark:text-amber-200"><p role="alert">{draft.error}</p>
      {!draft.locked && <button type="button" onClick={draft.retry} className="btn-secondary" disabled={(!online && !local) || draft.loading}>{t('draft.retry')}</button>}
      {draft.locked && <p>{t('draft.locked_hint')}</p>}
    </div>}
    {draft.candidates.length > 0 && <div className="space-y-2">
      <p className="font-medium">{t('draft.available')}</p>
      {draft.candidates.map((candidate) => <div key={candidate.id} className="flex flex-wrap items-center gap-2">
        <span>{t('draft.candidate').replace('{date}', time(candidate.updatedAt)).replace('{expiry}', time(candidate.expiresAt))}</span>
        <button type="button" className="btn-secondary" disabled={draft.discarding} onClick={() => setChoice({ kind: 'resume', draft: candidate })}>{t('draft.resume')}</button>
        <button type="button" className="btn-ghost min-h-11" disabled={draft.discarding} onClick={() => setChoice({ kind: 'discard', draft: candidate })}>{t('draft.delete')}</button>
      </div>)}
      <button type="button" className="btn-secondary" onClick={draft.startNew}>{t('draft.start_new')}</button>
    </div>}
    {draft.completed.map((completed) => completed.result && <p key={completed.id} className="text-xs text-emerald-800 dark:text-emerald-200">
      {t(local ? 'draft.queued_local' : 'draft.saved_record').replace('{date}', time(completed.updatedAt))}{' '}
      <Link className="underline" to={`/bases/${baseId}/patients/${completed.context.kind === 'patient_create' || completed.context.kind === 'patient_update' ? completed.result.id : patientId ?? completed.context.targetId}`}>
        {t('draft.open_record')}{completed.result.code ? ` ${completed.result.code}` : ''}
      </Link>
    </p>)}
    <ConfirmDialog open={choice !== null} title={choice?.kind === 'discard' ? t('draft.discard_title') : t('draft.resume_title')}
      body={choice?.kind === 'discard' ? t('draft.discard_body') : t('draft.resume_body')}
      confirmLabel={choice?.kind === 'discard' ? t('draft.discard_confirm') : t('draft.resume_confirm')}
      onCancel={() => setChoice(null)} onConfirm={() => {
        if (choice?.kind === 'resume') draft.resume(choice.draft);
        else if (choice) void draft.discard(choice.draft);
        setChoice(null);
      }} />
  </div>;
}
