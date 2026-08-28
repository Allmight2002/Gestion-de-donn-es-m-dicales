import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuth } from '../../auth/useAuth';
import { useCurationRepository } from '../../data/RepositoryProvider';
import type { CurationTaskItem } from '../../data/curation';
import { SkeletonList } from '../../components/Skeleton';

// Pool de curation GLOBAL (cahier v3.0) : reserve aux CURATEURS. Les cas sont designes par
// un CODE OPAQUE (jamais le patient). Le curateur reserve un cas ouvert puis le finalise
// (le role validateur est supprime).
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
  const isStaff = role === 'curateur';
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

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

  if (loading) return <SkeletonList rows={5} label={t('common.loading')} />;
  if (!isStaff) return <p className="text-slate-500">{t('curation.pool_staff_only')}</p>;

  return (
    <section className="max-w-3xl space-y-5 sm:space-y-6">
      <div>
        <h1 className="page-title">{t('curation.pool_title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('curation.pool_hint')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {tasks.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('curation.no_tasks')}</div>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-4 py-2.5">{t('curation.case_code')}</th>
                <th className="px-4 py-2.5">{t('admin.specialty')}</th>
                <th className="px-4 py-2.5">{t('curation.documents')}</th>
                <th className="px-4 py-2.5">{t('curation.status')}</th>
                <th className="px-4 py-2.5">{t('curation.assignee')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const mine = task.assignedTo === user?.id;
                return (
                  <tr key={task.id} className="border-b border-slate-100 last:border-0 transition hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono text-xs">{task.caseCode ?? '—'}</td>
                    <td className="px-4 py-2.5">{task.specialty ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2.5 tabular-nums">{task.documentCount ?? 0}</td>
                    <td className="px-4 py-2.5"><span className={poolStatusBadge(task.status)}>{t(`curstatus.${task.status}` as MessageKey)}</span></td>
                    <td className="px-4 py-2.5">{task.assignedName ?? <span className="text-slate-400">{t('curation.unassigned')}</span>}</td>
                    <td className="px-4 py-2.5 text-right">
                      {role === 'curateur' && task.status === 'open' ? (
                        <button onClick={() => void claim(task.id)} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">
                          {t('curation.claim')}
                        </button>
                      ) : (
                        mine && (
                          <button onClick={() => navigate(`/curation/${task.id}`)} className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline">
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
        </div>
      )}
    </section>
  );
}

function poolStatusBadge(status: string): string {
  const base = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset';
  const tone: Record<string, string> = {
    open: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    in_progress: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    clarification_requested: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  };
  return `${base} ${tone[status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'}`;
}
