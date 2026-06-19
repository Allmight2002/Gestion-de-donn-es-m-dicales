import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository, useCurationRepository, usePatientRepository } from '../../data/RepositoryProvider';
import type { CurationTaskItem } from '../../data/curation';
import type { BaseListing } from '../../data/bases';
import type { PatientListItem } from '../../data/patients';

// Suivi de curation cote MEDECIN (cahier v3.0) : il SOUMET un cas au pool global
// (documents deidentifies a deposer ensuite) et suit l'avancement de ses cas. La
// structuration/validation est faite par le staff (pool), plus par invitation.
export function CurationBoard() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const curation = useCurationRepository();
  const patients = usePatientRepository();

  const [listing, setListing] = useState<BaseListing | null>(null);
  const [tasks, setTasks] = useState<CurationTaskItem[]>([]);
  const [patientList, setPatientList] = useState<PatientListItem[]>([]);
  const [targetPatient, setTargetPatient] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [scope, setScope] = useState<'patient' | 'encounter'>('patient');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));
  const isOwner = listing?.role === 'owner';

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const base = await bases.getBase(baseId);
      setListing(base);
      setTasks(await curation.listBaseSubmissions(baseId));
      if (base?.role === 'owner') setPatientList(await patients.listPatients(baseId));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, curation, patients]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitCase(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !targetPatient) return;
    setBusy(true);
    try {
      const { taskId } = await curation.createSubmission(baseId, targetPatient, externalRef.trim() || null, scope);
      navigate(`/curation/${taskId}`); // -> deposer les documents deidentifies
    } catch (e) {
      setError(msg(e));
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

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {isOwner && (
        <form onSubmit={submitCase} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-4">
          <h2 className="w-full text-sm font-semibold text-slate-700">{t('curation.submit_case')}</h2>
          <p className="w-full text-xs text-amber-700">{t('curation.deident_note')}</p>
          <label className="flex flex-col text-xs text-slate-600">
            {t('curation.target_patient')}
            <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={targetPatient} onChange={(e) => setTargetPatient(e.target.value)} required>
              <option value="">—</option>
              {patientList.map((p) => (
                <option key={p.id} value={p.id}>{p.code}{p.identity?.fullName ? ` · ${p.identity.fullName}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            {t('curation.scope')}
            <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={scope} onChange={(e) => setScope(e.target.value as 'patient' | 'encounter')}>
              <option value="patient">{t('curation.scope_patient')}</option>
              <option value="encounter">{t('curation.scope_encounter')}</option>
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            {t('curation.external_ref')}
            <input className="rounded border border-slate-300 px-2 py-1 text-sm" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !targetPatient} className="rounded bg-teal-700 px-3 py-1 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60">
            {t('curation.submit_case_btn')}
          </button>
        </form>
      )}

      <div>
        <h2 className="mb-2 font-medium">{t('curation.my_cases')}</h2>
        {tasks.length === 0 ? (
          <p className="text-slate-500">{t('curation.no_tasks')}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="py-1">{t('curation.case_code')}</th>
                <th>{t('curation.target_patient')}</th>
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
                  <td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`curstatus.${task.status}` as MessageKey)}</span></td>
                  <td>{task.assignedTo ? (task.assignedName ?? t('curation.in_charge')) : <span className="text-slate-400">{t('curation.unassigned')}</span>}</td>
                  <td className="text-right">
                    <button onClick={() => navigate(`/curation/${task.id}`)} className="text-xs text-teal-700 hover:underline">{t('curation.open')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
