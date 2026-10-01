import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useI18n } from '../../i18n/useI18n';
import type { WorkDraft } from '../../data/workDrafts';
import type { useWorkDraft } from './useWorkDraft';

export function WorkDraftPanel({ draft, online, showCandidates = true }: {
  draft: ReturnType<typeof useWorkDraft>;
  online: boolean;
  showCandidates?: boolean;
}) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<{ kind: 'resume' | 'discard'; draft: WorkDraft } | null>(null);
  if (!draft.enabled) return null;
  if (!showCandidates && draft.candidates.length > 0) return null;
  const local = draft.support === 'local';
  const time = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  // La sauvegarde automatique reste silencieuse : saisie en cours, sauvegarde et accuse ne
  // s'affichent pas (ils decalaient le formulaire sans rien demander). Le panneau n'apparait
  // que pour un etat a traiter : echec, verrou, saisie non protegee hors ligne ou brouillon a
  // reprendre. Les enregistrements deja confirmes ne se rappellent pas ici.
  const locked = draft.locked && draft.state?.status !== 'consumed';
  const unprotectedOffline = !online && !local && draft.dirty && !draft.loading;
  const status = locked ? t('draft.locked') : unprotectedOffline ? t('draft.offline') : null;
  if (!status && !draft.error && draft.candidates.length === 0) return null;
  return <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
    {status && <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <p role="status" aria-live="polite" className="min-w-0 text-slate-700 dark:text-slate-200">{status}</p>
    </div>}
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
