import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuth } from '../../auth/useAuth';
import { useAuditRepository, useCurationRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TaskBundle, DraftEncounter } from '../../data/curation';
import type { TemplateField } from '../../data/types';
import { FieldInput } from './FieldInput';
import { EncounterFields, fieldAppliesToType } from './EncounterFields';
import { useSignedFile } from '../../lib/useSignedFile';

const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;
const newEncounter = (): DraftEncounter => ({ encounter_type: 'consultation', encounter_date: '', age_unit: 'years', data: {} });

// §11 : lien de document qui ne genere l'URL signee (et l'audit) qu'au CLIC, puis l'ouvre.
function RawDocumentLink({ label, load, onReveal }: { label: string; load: () => Promise<string | null>; onReveal: () => void }) {
  const { t } = useI18n();
  const { busy, error, reveal } = useSignedFile(load, onReveal);
  return (
    <button
      type="button"
      onClick={() => void reveal().then((u) => { if (u) window.open(u, '_blank', 'noopener,noreferrer'); })}
      disabled={busy}
      className="text-teal-700 hover:underline disabled:opacity-50"
    >
      {busy ? `${label} …` : error ? `${label} (${t('common.error')})` : label}
    </button>
  );
}

// Poste de travail d'un cas de curation (POOL GLOBAL, cahier v3.0). Base-less : le cas est
// designe par un CODE OPAQUE, jamais par le patient. Le curateur RESERVE, structure puis
// FINALISE directement ; le medecin proprietaire depose les documents (deidentifies).
export function CurationTask() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, profile } = useAuth();
  const templates = useTemplateRepository();
  const curation = useCurationRepository();
  const audit = useAuditRepository();

  const [bundle, setBundle] = useState<TaskBundle | null>(null);
  const [patientFields, setPatientFields] = useState<TemplateField[]>([]);
  const [encounterFields, setEncounterFields] = useState<TemplateField[]>([]);
  const [patientData, setPatientData] = useState<Record<string, unknown>>({});
  const [encounters, setEncounters] = useState<DraftEncounter[]>([]);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docLabel, setDocLabel] = useState('');
  const [dragging, setDragging] = useState(false);
  const [question, setQuestion] = useState(''); // clarification : question du curateur
  const [answer, setAnswer] = useState('');      // clarification : reponse du medecin
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

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

  const { task, documents, draft, patientIdentity, clarifications } = bundle;
  const role = profile?.globalRole;
  const assignedToMe = task.assignedTo === user?.id;
  const isCurator = role === 'curateur';
  const isOwnerMedecin = role === 'medecin'; // un medecin qui charge le cas en est proprietaire (RLS)

  const isPreparing = task.status === 'preparing'; // pas encore envoye au pool
  const canClaim = isCurator && task.status === 'open';
  const canStartDraft = isCurator && assignedToMe && !draft && task.status === 'in_progress';
  // Le curateur affecte structure (canEdit) PUIS finalise directement (plus de validateur).
  const canEdit = isCurator && assignedToMe && !!draft && draft.status === 'draft' && task.status === 'in_progress';
  const canAddDocs = isOwnerMedecin && isPreparing; // depot tant que le cas est en preparation
  const canSubmitRequest = isOwnerMedecin && isPreparing; // envoyer au pool
  // Clarification (§4.3) : le curateur affecte pose une question quand le cas est en cours ;
  // le medecin proprietaire repond a la clarification ouverte.
  const canAskClarification = isCurator && assignedToMe && task.status === 'in_progress';
  const hasOpenClarification = clarifications.some((c) => c.status === 'open');
  const canAnswerClarification = isOwnerMedecin && hasOpenClarification;

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
        <button onClick={() => navigate(-1)} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('admin.back')}</button>
        <h1 className="page-title">{t('curation.task_title')}</h1>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-xs text-slate-600">{task.caseCode ?? '—'}</span>
        <span className={taskStatusBadge(task.status)}>{t(`curstatus.${task.status}` as MessageKey)}</span>
        <span className="badge">{t(`curation.scope_${task.scope}` as MessageKey)}</span>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded-xl border border-teal-100 bg-teal-50 p-2.5 text-sm text-teal-800">{notice}</p>}

      {/* Le medecin proprietaire voit les donnees minimales (lecture seule) ; le staff ne
          voit QUE le code opaque (la RLS ne lui renvoie aucune identite). */}
      {patientIdentity ? (
        <fieldset className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-sm shadow-sm">
          <legend className="px-1 text-xs font-semibold text-amber-800">{t('curation.min_identity')}</legend>
          <div><span className="text-slate-500">{t('patient.full_name')} :</span> {patientIdentity.fullName ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.dob')} :</span> {patientIdentity.dateOfBirth ?? '—'}</div>
          <div><span className="text-slate-500">{t('patient.code')} :</span> <span className="font-mono">{task.targetPatientCode ?? '—'}</span></div>
        </fieldset>
      ) : task.targetPatientCode ? (
        <div className="text-sm text-slate-600">
          {t('curation.target_patient')} : <span className="font-mono">{task.targetPatientCode}</span>
        </div>
      ) : null}

      {/* Demande pas encore envoyee au pool : on explique la condition (documents requis). */}
      {canSubmitRequest && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">⚠️ {t('curation.preparing_banner')}</p>
      )}

      {canClaim && (
        <button
          onClick={() => void run(() => curation.claimTask(task.id), t('curation.claimed'))}
          disabled={busy}
          className="btn-primary"
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
      <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-amber-800">{t('curation.raw_documents')}</h2>
        {documents.length === 0 ? (
          <p className="text-xs text-slate-500">{t('curation.no_documents')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {documents.map((d) => (
              <li key={d.id}>
                {/* §11 : l'URL signee (et l'audit) ne sont generes qu'au CLIC, pas au chargement. */}
                <RawDocumentLink
                  label={d.label ?? d.storagePath}
                  load={() => curation.documentUrl(d.id, d.storagePath)}
                  onReveal={() => void audit.logRawDocumentRead(d.id)}
                />
                <span className="ml-2 text-xs text-slate-400">{d.mimeType}</span>
              </li>
            ))}
          </ul>
        )}
        {canAddDocs && (
          <div className="mt-4 space-y-3 border-t border-amber-200 pt-4">
            <p className="text-xs text-amber-700">{t('curation.deident_note')}</p>
            <label className="block text-xs text-slate-600">
              {t('curation.document_label')}
              <input className="input mt-1" value={docLabel} onChange={(e) => setDocLabel(e.target.value)} />
            </label>

            {/* Zone de glisser-deposer visible (ou clic pour parcourir). */}
            <label
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setDocFile(f); }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors ${
                dragging ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-300 bg-white text-slate-500 hover:border-teal-400 hover:bg-slate-50'
              }`}
            >
              <span className="text-2xl">⬆️</span>
              {docFile ? (
                <span className="font-medium text-slate-700">📄 {docFile.name}</span>
              ) : (
                <span>{t('curation.dropzone')}</span>
              )}
              <input type="file" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            </label>

            <button
              type="button"
              disabled={busy || !docFile}
              onClick={() => void run(async () => {
                await curation.addRawDocument({ submissionId: task.submissionId, baseId: task.baseId, file: docFile!, label: docLabel || undefined });
                setDocFile(null); setDocLabel('');
              }, t('curation.uploaded'))}
              className="btn-primary"
            >
              {t('curation.add_document')}
            </button>
          </div>
        )}
      </div>

      {/* Envoi de la demande au pool (medecin proprietaire) : exige >= 1 document. */}
      {canSubmitRequest && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy || documents.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await curation.submitRequest(task.id);
                navigate(`/bases/${task.baseId}/curation`);
              } catch (e) {
                setError(msg(e));
                setBusy(false);
              }
            }}
            className="btn-primary"
          >
            {t('curation.submit_request')}
          </button>
          {documents.length === 0 && <p className="text-xs text-slate-500">{t('curation.submit_needs_doc')}</p>}
        </div>
      )}

      {/* Clarification (§4.3) : fil de questions/reponses entre le curateur et le medecin. */}
      {(clarifications.length > 0 || canAskClarification) && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-700">{t('curation.clarifications')}</h2>
          <ul className="space-y-2">
            {clarifications.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p><span className="font-medium text-slate-700">❓ {c.question}</span></p>
                {c.answer ? (
                  <p className="mt-1 text-teal-800">↳ {c.answer}</p>
                ) : (
                  <p className="mt-1 text-xs italic text-amber-600">{t('curation.clar_pending')}</p>
                )}
                {/* Le medecin proprietaire repond a la clarification ouverte. */}
                {canAnswerClarification && c.status === 'open' && (
                  <div className="mt-2 space-y-2">
                    <textarea className="input" placeholder={t('curation.clar_answer_ph')} value={answer} onChange={(e) => setAnswer(e.target.value)} />
                    <button
                      disabled={busy || !answer.trim()}
                      onClick={() => void run(async () => { await curation.answerClarification(c.id, answer.trim()); setAnswer(''); }, t('curation.clar_answered'))}
                      className="btn-primary"
                    >
                      {t('curation.clar_send_answer')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {/* Le curateur affecte pose une nouvelle question (cas en cours). */}
          {canAskClarification && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <textarea className="input" placeholder={t('curation.clar_question_ph')} value={question} onChange={(e) => setQuestion(e.target.value)} />
              <button
                disabled={busy || !question.trim()}
                onClick={() => void run(async () => { await curation.requestClarification(task.id, question.trim()); setQuestion(''); }, t('curation.clar_requested'))}
                className="btn-secondary"
              >
                {t('curation.clar_ask')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Brouillon (structuration par le curateur) — cote STAFF uniquement. */}
      {!isOwnerMedecin && (!draft ? (
        <div className="card p-4">
          <p className="text-sm text-slate-500">{t('curation.no_draft')}</p>
          {canStartDraft && (
            <button
              onClick={() => void run(() => curation.ensureDraft(task.id, task.baseId))}
              disabled={busy}
              className="btn-primary mt-2"
            >
              {t('curation.start_draft')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <fieldset disabled={!canEdit} className="space-y-5 disabled:opacity-70">
            {/* Portee 'patient' : donnees permanentes. Portee 'encounter' : rencontre(s) seulement. */}
            {task.scope !== 'encounter' && (
              <div className="card p-4">
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
            )}

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
                <div key={i} className="card p-3">
                  <div className="mb-2 flex flex-wrap items-end gap-2">
                    <label className="flex flex-col text-xs text-slate-600">
                      {t('encounter.type')}
                      <select className="input" value={enc.encounter_type} onChange={(e) => updateEncounter(i, { encounter_type: e.target.value })}>
                        {ENCOUNTER_TYPES.map((x) => (<option key={x} value={x}>{t(`encountertype.${x}`)}</option>))}
                      </select>
                    </label>
                    <label className="flex flex-col text-xs text-slate-600">
                      {t('encounter.date')}
                      <input type="date" className="input" value={enc.encounter_date} onChange={(e) => updateEncounter(i, { encounter_date: e.target.value })} />
                    </label>
                    {canEdit && (
                      <button type="button" onClick={() => setEncounters((l) => l.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">{t('cohort.remove')}</button>
                    )}
                  </div>
                  <EncounterFields fields={encounterFields.filter((f) => fieldAppliesToType(f, enc.encounter_type))} values={enc.data} onChange={(k, v) => updateEncounter(i, { data: { ...enc.data, [k]: v } })} />
                </div>
              ))}
            </div>
          </fieldset>

          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void run(() => curation.saveDraft(draft.id, patientData, encounters), t('curation.saved'))}
                disabled={busy}
                className="btn-secondary"
              >
                {t('curation.save_draft')}
              </button>
              {/* Le curateur finalise directement (plus de validateur) : enregistre puis finalise. */}
              <button
                onClick={() => void run(async () => { await curation.saveDraft(draft.id, patientData, encounters); await curation.finalizeTask(task.id); }, t('curation.finalized'))}
                disabled={busy}
                className="btn-primary"
              >
                {t('curation.finalize')}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function taskStatusBadge(status: string): string {
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
