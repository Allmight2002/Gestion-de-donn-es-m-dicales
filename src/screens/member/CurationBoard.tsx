import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useCurationRepository } from '../../data/RepositoryProvider';
import type { CurationTaskItem } from '../../data/curation';

// "Suivi des demandes" cote MEDECIN (cahier v3.0) : liste, EN LECTURE SEULE, les cas
// confies au staff (pool) et leur avancement. La soumission se fait desormais depuis les
// parcours de creation patient / rencontre ("Confier au staff"), plus depuis cet ecran.
export function CurationBoard() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const curation = useCurationRepository();

  const [tasks, setTasks] = useState<CurationTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      setTasks(await curation.listBaseSubmissions(baseId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, curation]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(taskId: string, reason: string, deletePatient: boolean) {
    setBusy(true);
    try {
      await curation.deleteRequest(taskId, reason, deletePatient);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('admin.back')}</button>
        <h1 className="page-title mt-2">{t('curation.board')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('curation.board_hint')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {tasks.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('curation.no_tasks')}</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">{t('curation.case_code')}</th>
                <th className="px-4 py-2.5">{t('curation.target_patient')}</th>
                <th className="px-4 py-2.5">{t('curation.scope')}</th>
                <th className="px-4 py-2.5">{t('curation.status')}</th>
                <th className="px-4 py-2.5">{t('curation.assignee')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-slate-100 last:border-0 transition hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-mono text-xs">{task.caseCode ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{task.targetPatientCode ?? '—'}</td>
                  <td className="px-4 py-2.5">{t(`curation.scope_${task.scope}` as MessageKey)}</td>
                  <td className="px-4 py-2.5"><span className={curStatusBadge(task.status)}>{t(`curstatus.${task.status}` as MessageKey)}</span></td>
                  <td className="px-4 py-2.5">{task.assignedTo ? (task.assignedName ?? t('curation.in_charge')) : <span className="text-slate-400">{t('curation.unassigned')}</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => navigate(`/curation/${task.id}`)} className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline">{t('curation.open')}</button>
                    {/* Une demande validee n'est pas supprimable (provenance) : on n'offre pas l'action. */}
                    {task.status !== 'validated' && (
                      <span className="ml-3"><DeleteRequestMenu busy={busy} onConfirm={(reason, deletePatient) => remove(task.id, reason, deletePatient)} /></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Pastille de statut coloree selon l'avancement du cas.
function curStatusBadge(status: string): string {
  const base = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset';
  const tone: Record<string, string> = {
    preparing: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    open: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    in_progress: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    clarification_requested: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  };
  return `${base} ${tone[status] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'}`;
}

// Suppression d'une demande avec MOTIF (confirmation) et CHOIX de portee : la demande seule,
// ou le patient ET la demande (utile si le patient avait ete cree juste pour cette demande).
function DeleteRequestMenu({
  busy,
  onConfirm,
}: {
  busy?: boolean;
  onConfirm: (reason: string, deletePatient: boolean) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-red-600 hover:underline">
        {t('curation.delete')}
      </button>
    );
  }

  const confirm = (deletePatient: boolean) => {
    void onConfirm(reason.trim(), deletePatient);
    setOpen(false);
    setReason('');
  };

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <input
        aria-label={t('del.reason')}
        placeholder={t('del.reason')}
        className="rounded border border-slate-300 px-2 py-0.5 text-xs"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button disabled={busy || !reason.trim()} onClick={() => confirm(false)} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
        {t('curation.delete_request_only')}
      </button>
      <button disabled={busy || !reason.trim()} onClick={() => confirm(true)} className="rounded bg-red-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50">
        {t('curation.delete_with_patient')}
      </button>
      <button onClick={() => { setOpen(false); setReason(''); }} className="text-xs text-slate-500 hover:underline">
        {t('common.cancel')}
      </button>
    </span>
  );
}
