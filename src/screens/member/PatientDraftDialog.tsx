import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useI18n } from '../../i18n/useI18n';
import type { useWorkDraft } from './useWorkDraft';

export function PatientDraftDialog({ draft, onCancel, onNew }: {
  draft: ReturnType<typeof useWorkDraft>;
  onCancel: () => void;
  onNew: () => void;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState('');
  const selected = draft.candidates.find((candidate) => candidate.id === selectedId) ?? draft.candidates[0];
  const dateOf = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  return <ConfirmDialog
    open={draft.enabled && draft.candidates.length > 0}
    title={t('draft.entry_title')}
    body={t('draft.entry_body')}
    busy={draft.discarding}
    cancelLabel={t('draft.entry_leave')}
    confirmLabel={t('draft.resume')}
    confirmDisabled={!selected}
    onCancel={onCancel}
    onConfirm={() => { if (selected) draft.resume(selected); }}
  >
    {draft.candidates.length > 1 ? <label className="block text-sm">
      {t('draft.entry_select')}
      <select className="input mt-1" value={selected?.id ?? ''} disabled={draft.discarding} onChange={(event) => setSelectedId(event.target.value)}>
        {draft.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{dateOf(candidate.updatedAt)}</option>)}
      </select>
    </label> : selected && <p className="text-sm text-slate-600">{dateOf(selected.updatedAt)}</p>}
    {draft.candidates.length > 1 && <p className="text-xs text-slate-500">{t('draft.entry_other_drafts')}</p>}
    <p className="text-xs text-slate-500">{t('draft.clinical_only')}</p>
    {draft.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{draft.error}</p>}
    <button type="button" className="btn-danger w-full" disabled={draft.discarding}
      onClick={() => { void draft.discardAllAndStartNew(onNew); }}>{t('draft.entry_new')}</button>
  </ConfirmDialog>;
}
