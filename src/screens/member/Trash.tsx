import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { DeletedBase } from '../../data/bases';
import { useOnline } from '../../data/offline';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';

// Corbeille des bases (demenagee du tableau de bord vers la barre laterale) : la
// restauration remet la base en ligne sans remettre les acces partages. D10 ajoute
// une purge definitive confirmee par le serveur et rejouable apres un incident Storage.
function newOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const suffix = Math.floor(Math.random() * 0x1_0000_0000_0000).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

export function Trash() {
  const repo = useBaseRepository();
  const { t } = useI18n();
  const online = useOnline();
  const [deleted, setDeleted] = useState<DeletedBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DeletedBase | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<DeletedBase | null>(null);
  const [purgeName, setPurgeName] = useState('');
  const [purgeOperationId, setPurgeOperationId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const reload = useCallback(async () => {
    if (!online) {
      setDeleted([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setDeleted(await repo.listDeletedBases());
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, online, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function restoreBase() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      await repo.restoreDeletedBase(restoreTarget.id);
      setRestoreTarget(null);
      await reload();
    } catch (e) {
      setError(msg(e));
    } finally {
      setRestoring(false);
    }
  }

  function openPurge(base: DeletedBase) {
    setPurgeTarget(base);
    setPurgeName('');
    setPurgeOperationId(base.purgeOperationId ?? newOperationId());
    setError(null);
    setSuccess(null);
  }

  function closePurge() {
    if (purging) return;
    setPurgeTarget(null);
    setPurgeName('');
    setPurgeOperationId(null);
  }

  async function purgeBase() {
    if (!purgeTarget || !purgeOperationId || purgeName.trim() !== purgeTarget.name) return;
    const purgedName = purgeTarget.name;
    setPurging(true);
    setError(null);
    setSuccess(null);
    try {
      await repo.purgeDeletedBase(purgeTarget.id, purgeOperationId);
      setPurging(false);
      closePurge();
      await reload();
      setSuccess(t('base.purge_success').replace('{name}', purgedName));
    } catch (e) {
      setError(msg(e));
    } finally {
      setPurging(false);
    }
  }

  return (
    <section className="space-y-5">
      <ConfirmDialog
        open={restoreTarget !== null}
        title={t('base.restore_title')}
        body={t('base.restore_body')}
        confirmLabel={t('base.restore_confirm')}
        busy={restoring}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void restoreBase()}
      />
      <ConfirmDialog
        open={purgeTarget !== null}
        title={t('base.purge_title')}
        body={purgeTarget ? (
          <div className="text-sm text-slate-700">
            <label className="block space-y-1 text-sm font-medium text-slate-700" htmlFor="purge-base-name">
              <span>{t('base.purge_name_label').replace('{name}', purgeTarget.name)}</span>
              <input
                id="purge-base-name"
                className="input w-full"
                value={purgeName}
                onChange={(event) => setPurgeName(event.target.value)}
                autoComplete="off"
                disabled={purging}
              />
            </label>
            {purgeName.length > 0 && purgeName.trim() !== purgeTarget.name && (
              <p className="text-xs text-red-600">{t('base.purge_name_invalid')}</p>
            )}
          </div>
        ) : undefined}
        confirmLabel={t('base.purge_confirm')}
        confirmDisabled={!purgeTarget || purgeName.trim() !== purgeTarget.name}
        danger
        busy={purging}
        onCancel={closePurge}
        onConfirm={() => void purgeBase()}
      />
      <PageHeader title={t('base.trash_title')} description={t('base.trash_hint')} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
      {!online ? (
        <p className="text-sm text-slate-500">{t('base.trash_offline')}</p>
      ) : loading ? (
        <SkeletonList rows={3} label={t('common.loading')} />
      ) : deleted.length === 0 ? (
        <EmptyState icon={Trash2} title={t('base.trash_empty')} />
      ) : (
        <ul className="space-y-3">
          {deleted.map((base) => (
            <li key={base.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">{base.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{base.deletionReason}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {t('base.deleted_on').replace('{date}', new Date(base.deletedAt).toLocaleDateString())}
                  {' · '}
                  {t('base.purge_immediate')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRestoreTarget(base)}
                  disabled={base.purgePending || purging}
                >
                  {t('base.restore')}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => openPurge(base)}
                  disabled={purging}
                >
                  {base.purgePending ? t('base.purge_retry') : t('base.purge')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
