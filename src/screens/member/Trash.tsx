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
// restauration remet la base en ligne sans remettre les acces partages, comme avant.
export function Trash() {
  const repo = useBaseRepository();
  const { t } = useI18n();
  const online = useOnline();
  const [deleted, setDeleted] = useState<DeletedBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DeletedBase | null>(null);
  const [restoring, setRestoring] = useState(false);

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
      <PageHeader title={t('base.trash_title')} description={t('base.trash_hint')} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
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
                  {t('base.purge_eligible').replace('{date}', new Date(base.purgeEligibleAt).toLocaleDateString())}
                </p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setRestoreTarget(base)}>
                {t('base.restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
