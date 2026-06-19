import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuth } from '../../auth/useAuth';
import { useCurationRepository } from '../../data/RepositoryProvider';
import type { CurationTaskItem } from '../../data/curation';

// Pool de curation GLOBAL (cahier v3.0) : reserve au staff (curateur/validateur). Les cas
// sont designes par un CODE OPAQUE (jamais le patient). Le curateur reserve un cas ouvert ;
// le validateur ouvre les cas soumis pour les valider.
export function CurationPool() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, profile } = useAuth();
  const curation = useCurationRepository();

  const [tasks, setTasks] = useState<CurationTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = profile?.globalRole;
  const isStaff = role === 'curateur' || role === 'validateur';
  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await curation.listPool());
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curation]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(id: string) {
    setBusy(true);
    try {
      await curation.claimTask(id);
      navigate(`/curation/${id}`);
    } catch (e) {
      setError(msg(e));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (!isStaff) return <p className="text-slate-500">{t('curation.pool_staff_only')}</p>;

  return (
    <section className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold">{t('curation.pool_title')}</h1>
      <p className="text-sm text-slate-500">{t('curation.pool_hint')}</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {tasks.length === 0 ? (
        <p className="text-slate-500">{t('curation.no_tasks')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-1">{t('curation.case_code')}</th>
              <th>{t('curation.status')}</th>
              <th>{t('curation.assignee')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const mine = task.assignedTo === user?.id;
              return (
                <tr key={task.id} className="border-b">
                  <td className="py-1 font-mono text-xs">{task.caseCode ?? '—'}</td>
                  <td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`curstatus.${task.status}` as MessageKey)}</span></td>
                  <td>{task.assignedName ?? <span className="text-slate-400">{t('curation.unassigned')}</span>}</td>
                  <td className="text-right">
                    {role === 'curateur' && task.status === 'open' ? (
                      <button onClick={() => void claim(task.id)} disabled={busy} className="rounded bg-teal-700 px-2 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60">
                        {t('curation.claim')}
                      </button>
                    ) : (
                      (mine || role === 'validateur') && (
                        <button onClick={() => navigate(`/curation/${task.id}`)} className="text-xs text-teal-700 hover:underline">
                          {t('curation.open')}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
