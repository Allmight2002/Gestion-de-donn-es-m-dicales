import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuth } from '../../auth/useAuth';
import { useCurationRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TaskBundle, DraftEncounter } from '../../data/curation';
import type { TemplateField } from '../../data/types';
import { FieldInput } from './FieldInput';
import { EncounterFields } from './EncounterFields';

const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;
const newEncounter = (): DraftEncounter => ({ encounter_type: 'consultation', encounter_date: '', age_unit: 'years', data: {} });

// Poste de travail d'un cas de curation (POOL GLOBAL, cahier v3.0). Base-less : le cas est
// designe par un CODE OPAQUE, jamais par le patient. Le curateur RESERVE puis structure ;
// le validateur valide ; le medecin proprietaire depose les documents (deidentifies).
export function CurationTask() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, profile } = useAuth();
  const templates = useTemplateRepository();
  const curation = useCurationRepository();

  const [bundle, setBundle] = useState<TaskBundle | null>(null);
  const [patientFields, setPatientFields] = useState<TemplateField[]>([]);
  const [encounterFields, setEncounterFields] = useState<TemplateField[]>([]);
  const [patientData, setPatientData] = useState<Record<string, unknown>>({});
  const [encounters, setEncounters] = useState<DraftEncounter[]>([]);
  const [comment, setComment] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docLabel, setDocLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const b = await curation.getTaskBundle(taskId);
      setBundle(b);
      if (b?.draft) {
        setPatientData(b.draft.patientData ?? {});
        setEncounters(b.draft.encounters ?? []);
      }
      if (b?.task.templateVersionId) {
        const version = await templates.getVersion(b.task.templateVersionId);
        const sorted = [...version.fields].sort((a, b2) => a.displayOrder - b2.displayOrder);
        setPatientFields(sorted.filter((f) => f.scope === 'patient'));
        setEncounterFields(sorted.filter((f) => f.scope === 'encounter'));
      }
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, curation, templates]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (!bundle) return <p className="text-slate-500">{t('notfound.title')}</p>;

  const { task, documents, draft, reviews } = bundle;
  const role = profile?.globalRole;
  const assignedToMe = task.assignedTo === user?.id;
  const isCurator = role === 'curateur';
  const isValidator = role === 'validateur';
  const isOwnerMedecin = role === 'medecin'; // un medecin qui charge le cas en est proprietaire (RLS)

  const canClaim = isCurator && task.status === 'open';
  const canStartDraft = isCurator && assignedToMe && !draft && task.status === 'in_progress';
  const canEdit = isCurator && assignedToMe && !!draft && draft.status === 'draft';
  const canValidate = isValidator && !!draft && draft.status === 'submitted';
  const canAddDocs = isOwnerMedecin;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      setNotice(ok ?? null);
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }

  const updateEncounter = (i: number, patch: Partial<DraftEncounter>) =>
    setEncounters((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <section className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-sm text-teal-700 hover:underline">← {t('admin.back')}</button>
        <h1 className="text-2xl font-semibold">{t('curation.task_title')}</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs">{task.caseCode ?? '—'}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`curstatus.${task.status}` as MessageKey)}</span>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded bg-teal-50 p-2 text-sm text-teal-800">{notice}</p>}

      {/* Le medecin proprietaire voit le patient cible ; le staff ne voit QUE le code opaque. */}
      {task.targetPatientCode && (
        <div className="text-sm text-slate-600">
          {t('curation.target_patient')} : <span className="font-mono">{task.targetPatientCode}</span>
        </div>
      )}

      {canClaim && (
        <button
          onClick={() => void run(() => curation.claimTask(task.id), t('curation.claimed'))}
          disabled={busy}
          className="rounded bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {t('curation.claim')}
        </button>
      )}
      {isCurator && assignedToMe && task.status === 'in_progress' && (
        <button
          onClick={() => void run(() => curation.releaseTask(task.id), t('curation.released'))}
          disabled={busy}
          className="ml-2 text-xs text-slate-500 hover:underline"
        >
          {t('curation.release')}
        </button>
      )}

      {/* Documents (deidentifies) */}
      <div className="rounded border border-amber-200 bg-amber-50/40 p-4">
        <h2 className="mb-2 text-sm font-semibold text-amber-800">{t('curation.raw_documents')}</h2>
        {documents.length === 0 ? (
          <p className="text-xs text-slate-500">{t('curation.no_documents')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {documents.map((d) => (
              <li key={d.id}>
                {d.signedUrl ? (
                  <a href={d.signedUrl} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">{d.label ?? d.storagePath}</a>
                ) : (
                  <span>{d.label ?? d.storagePath}</span>
                )}
                <span className="ml-2 text-xs text-slate-400">{d.mimeType}</span>
              </li>
            ))}
          </ul>
        )}
        {canAddDocs && (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-amber-200 pt-3">
            <p className="w-full text-xs text-amber-700">{t('curation.deident_note')}</p>
            <label className="flex flex-col text-xs text-slate-600">
              {t('curation.document_label')}
              <input className="rounded border border-slate-300 px-2 py-1 text-sm" value={docLabel} onChange={(e) => setDocLabel(e.target.value)} />
            </label>
            <input type="file" className="text-xs" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            <button
              type="button"
              disabled={busy || !docFile}
              onClick={() => void run(async () => {
                await curation.addRawDocument({ submissionId: task.submissionId, baseId: task.baseId, file: docFile!, label: docLabel || undefined });
                setDocFile(null); setDocLabel('');
              }, t('curation.uploaded'))}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-60"
            >
              {t('curation.add_document')}
            </button>
          </div>
        )}
      </div>

      {/* Brouillon (structuration par le curateur) */}
      {!draft ? (
        <div className="rounded border border-slate-200 p-4">
          <p className="text-sm text-slate-500">{t('curation.no_draft')}</p>
          {canStartDraft && (
            <button
              onClick={() => void run(() => curation.ensureDraft(task.id, task.baseId))}
              disabled={busy}
              className="mt-2 rounded bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {t('curation.start_draft')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <fieldset disabled={!canEdit} className="space-y-5 disabled:opacity-70">
            <div className="rounded border border-slate-200 p-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('patient.permanent_section')}</h2>
              {patientFields.map((f) => (
                <label key={f.id} className="mb-2 flex flex-col text-sm">
                  <span className="text-slate-700">{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
                  <div className="mt-1">
                    <FieldInput field={f} value={patientData[f.fieldKey]} onChange={(v) => setPatientData((p) => ({ ...p, [f.fieldKey]: v }))} />
                  </div>
                </label>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{t('patient.encounters')}</h2>
                {canEdit && (
                  <button type="button" onClick={() => setEncounters((l) => [...l, newEncounter()])} className="text-xs text-teal-700 hover:underline">
                    + {t('encounter.add')}
                  </button>
                )}
              </div>
              {encounters.length === 0 && <p className="text-xs text-slate-400">{t('patient.no_encounters')}</p>}
              {encounters.map((enc, i) => (
                <div key={i} className="rounded border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-end gap-2">
                    <label className="flex flex-col text-xs text-slate-600">
                      {t('encounter.type')}
                      <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={enc.encounter_type} onChange={(e) => updateEncounter(i, { encounter_type: e.target.value })}>
                        {ENCOUNTER_TYPES.map((x) => (<option key={x} value={x}>{t(`encountertype.${x}`)}</option>))}
                      </select>
                    </label>
                    <label className="flex flex-col text-xs text-slate-600">
                      {t('encounter.date')}
                      <input type="date" className="rounded border border-slate-300 px-2 py-1 text-sm" value={enc.encounter_date} onChange={(e) => updateEncounter(i, { encounter_date: e.target.value })} />
                    </label>
                    {canEdit && (
                      <button type="button" onClick={() => setEncounters((l) => l.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">{t('cohort.remove')}</button>
                    )}
                  </div>
                  <EncounterFields fields={encounterFields} values={enc.data} onChange={(k, v) => updateEncounter(i, { data: { ...enc.data, [k]: v } })} />
                </div>
              ))}
            </div>
          </fieldset>

          {canEdit && (
            <div className="flex gap-2">
              <button
                onClick={() => void run(() => curation.saveDraft(draft.id, patientData, encounters), t('curation.saved'))}
                disabled={busy}
                className="rounded border border-teal-600 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60"
              >
                {t('curation.save_draft')}
              </button>
              <button
                onClick={() => void run(async () => { await curation.saveDraft(draft.id, patientData, encounters); await curation.submitDraft(draft.id); }, t('curation.submitted'))}
                disabled={busy}
                className="rounded bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {t('curation.submit')}
              </button>
            </div>
          )}

          {canValidate && (
            <div className="space-y-2 rounded border border-slate-200 p-4">
              <h2 className="text-sm font-semibold text-slate-700">{t('curation.validation')}</h2>
              <textarea className="w-full rounded border border-slate-300 px-2 py-1 text-sm" placeholder={t('curation.comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="flex gap-2">
                <button
                  onClick={() => void run(() => curation.validateDraft(draft.id, 'approved', comment.trim() || null), t('curation.approved_ok'))}
                  disabled={busy}
                  className="rounded bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {t('curation.approve')}
                </button>
                <button
                  onClick={() => void run(() => curation.validateDraft(draft.id, 'rejected', comment.trim() || null), t('curation.rejected_ok'))}
                  disabled={busy}
                  className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  {t('curation.reject')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {reviews.length > 0 && (
        <div className="rounded border border-slate-200 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('curation.reviews')}</h2>
          <ul className="space-y-1 text-xs">
            {reviews.map((r) => (
              <li key={r.id}>
                <span className={r.decision === 'approved' ? 'text-teal-700' : 'text-red-600'}>{t(`curdecision.${r.decision}` as MessageKey)}</span>
                {r.comment && <span className="ml-2 italic text-slate-500">« {r.comment} »</span>}
                <span className="ml-2 text-slate-400">{r.createdAt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
