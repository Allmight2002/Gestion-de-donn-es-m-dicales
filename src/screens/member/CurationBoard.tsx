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
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm text-teal-700 hover:underline">← {t('admin.back')}</button>
        <h1 className="text-2xl font-semibold">{t('curation.board')}</h1>
      </div>
      <p className="text-sm text-slate-500">{t('curation.board_hint')}</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {tasks.length === 0 ? (
        <p className="text-slate-500">{t('curation.no_tasks')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-1">{t('curation.case_code')}</th>
              <th>{t('curation.target_patient')}</th>
              <th>{t('curation.scope')}</th>
              <th>{t('curation.status')}</th>
              <th>{t('curation.assignee')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className="border-b">
                <td className="py-1 font-mono text-xs">{task.caseCode ?? '—'}</td>
                <td className="font-mono text-xs">{task.targetPatientCode ?? '—'}</td>
                <td>{t(`curation.scope_${task.scope}` as MessageKey)}</td>
                <td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`curstatus.${task.status}` as MessageKey)}</span></td>
                <td>{task.assignedTo ? (task.assignedName ?? t('curation.in_charge')) : <span className="text-slate-400">{t('curation.unassigned')}</span>}</td>
                <td className="text-right">
                  <button onClick={() => navigate(`/curation/${task.id}`)} className="text-xs text-teal-700 hover:underline">{t('curation.open')}</button>
                  {/* Une demande validee n'est pas supprimable (provenance) : on n'offre pas l'action. */}
                  {task.status !== 'validated' && (
                    <span className="ml-3"><DeleteRequestMenu busy={busy} onConfirm={(reason, deletePatient) => remove(task.id, reason, deletePatient)} /></span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
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
