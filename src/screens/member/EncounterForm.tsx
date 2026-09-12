import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Send } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { isMissionAccount } from '../../auth/logic';
import { useBaseRepository, useCurationRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { DiagnosisContext, TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { validateValues, evaluateRules, hiddenFieldKeys, withoutHiddenValues } from '../../domain/validation';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { saveDraft, loadDraft, clearDraft, type DraftEnvelope } from '../../data/drafts';
import { newOfflineId, useOnline } from '../../data/offline';
import {
  enqueueEncounterCreate, intakeContextCache, intakeQueue, isLocalPatientId,
  isOfflineIntakeEnabled, type PatientCreateEntry,
} from '../../data/offlineIntake';
import { useToast } from '../../components/Toast';
import { EncounterFields, HiddenValuesConfirmation, HiddenValuesNotice, fieldAppliesToType } from './EncounterFields';
import { forgetPrefilled, initialValuesFromDefaults, isClearedValue } from '../../domain/fieldDefaults';
import { SkeletonList } from '../../components/Skeleton';
import { useVisibilityWithdrawal } from './useVisibilityWithdrawal';
import { DiagnosisCoverageNotice, useDiagnosisCoverage } from './DiagnosisCoverageNotice';
import { useDirtyForm } from '../../lib/useUnsavedChanges';
import { useWorkDraft } from './useWorkDraft';
import { WorkDraftPanel } from './WorkDraftPanel';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { localWorkDraftRepository } from '../../data/localWorkDrafts';

// A4 : un brouillon de rencontre ne retient que de l'ANALYTIQUE (aucune identite).
interface EncounterDraft {
  templateVersionId?: string;
  encounterType: string;
  encounterDate: string;
  status: string;
  values: Record<string, unknown>;
}

const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;
const STATUSES = ['draft', 'complete', 'curated'] as const;

// Saisie dynamique d'une rencontre (cahier §8.5, §10) : champs par section, controles,
// valeurs manquantes codifiees, statut, age calcule (apercu), regles de coherence.
export function EncounterForm() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const online = useOnline();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const curation = useCurationRepository();
  const { toast } = useToast();
  const { profile } = useAuth();
  // Meme regle que pour le patient : la voie curation est fermee aux comptes de mission.
  const maySubmitToCuration = !isMissionAccount(profile);

  // Dossier patient ENCORE LOCAL (cree hors-ligne, en attente de synchronisation).
  const [localParent, setLocalParent] = useState<PatientCreateEntry | null>(null);
  const offlineIntakeMode = !!patientId && isLocalPatientId(patientId) && isOfflineIntakeEnabled();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [commonLayout, setCommonLayout] = useState<TemplateCommonLayout | undefined>(undefined);
  // L55/L56 : contrat diagnostique de LA VERSION du dossier (absent = collecte historique).
  const [versionId, setVersionId] = useState<string | null>(null);
  const [diagnosisContext, setDiagnosisContext] = useState<DiagnosisContext[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [encounterType, setEncounterType] = useState<string>('consultation');
  const [encounterDate, setEncounterDate] = useState('');
  const [status, setStatus] = useState<string>('draft');
  const [values, setValues] = useState<Record<string, unknown>>({});
  // Cles preremplies par le jeu de variables et pas encore touchees (L28) : affichage seul.
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set());
  const [age, setAge] = useState<number | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false); // A4
  const [localCandidate, setLocalCandidate] = useState<DraftEnvelope<EncounterDraft> | null>(null);
  const [localSavedAt, setLocalSavedAt] = useState<number | null>(null);
  const [localSaveError, setLocalSaveError] = useState(false);
  const [discardLocalOpen, setDiscardLocalOpen] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const intakeAttempt = useRef<{ fingerprint: string; operationKey: string } | null>(null);
  const draftReady = useRef(false); // A4 : autorise l'autosave seulement apres chargement + restauration

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));
  const { track: trackVisibilityWithdrawal, reset: resetVisibilityWithdrawal } = useVisibilityWithdrawal(rules, fields, sections);
  const navigation = useDirtyForm({ values, encounterType, encounterDate, status }, !loading && versionId !== null, `${baseId}:${patientId}`);
  const work = useWorkDraft({
    repository: offlineIntakeMode ? localWorkDraftRepository : undefined,
    support: offlineIntakeMode ? 'local' : 'server',
    context: baseId && patientId && versionId ? {
      baseId, kind: 'encounter_create', targetId: patientId, templateVersionId: versionId, entityRevision: null,
    } : null,
    ownerId: profile?.id ?? '', payload: { values, encounterType, encounterDate, status, ageUnit: 'years' }, dirty: navigation.dirty, online,
    onRestore: (payload) => { setValues(payload.values); setEncounterType(payload.encounterType ?? 'consultation');
      setEncounterDate(payload.encounterDate ?? ''); setStatus(payload.status ?? 'draft'); setPrefilled(new Set()); },
  });

  // L32 — la visibilite s'evalue sur EXACTEMENT ce qui partira au serveur : les champs
  // applicables au type choisi. Evaluer sur autre chose ferait diverger l'ecran du serveur
  // des qu'une variable pilote cesse de s'appliquer au type de visite.
  const applicableFields = useMemo(
    () => fields.filter((f) => fieldAppliesToType(f, encounterType)),
    [fields, encounterType],
  );
  const { hidden, removed, data: submittedData } = useMemo(() => {
    const applicableData = Object.fromEntries(
      Object.entries(values).filter(([k]) => applicableFields.some((f) => f.fieldKey === k)),
    );
    const hiddenKeys = hiddenFieldKeys(rules, applicableData, applicableFields, sections);
    for (const field of fields) if (!applicableFields.includes(field)) hiddenKeys.add(field.fieldKey);
    const stripped = withoutHiddenValues(values, hiddenKeys);
    return { hidden: hiddenKeys, removed: stripped.removed, data: stripped.values };
  }, [values, fields, applicableFields, rules, sections]);

  const coverage = useDiagnosisCoverage(versionId, diagnosisContext, 'encounter', submittedData, fields, rules, sections);

  // Un MEME gestionnaire peut emettre DEUX mises a jour : choisir une valeur controlee pose
  // la valeur, puis efface la proposition compagnon (`ChoiceWithProposal`). Construite sur
  // l'instantane du rendu, la seconde repartait d'un etat qui ignorait la premiere et
  // l'ecrasait — la valeur choisie disparaissait sans erreur. On enchaine donc sur la
  // derniere valeur connue, resynchronisee a chaque commit.
  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; }, [values]);

  function updateEncounterValue(key: string, value: unknown, remove = false) {
    const current = valuesRef.current;
    const next = { ...current };
    if (remove) delete next[key];
    else next[key] = value;
    valuesRef.current = next;
    trackVisibilityWithdrawal(current, next);
    setValues(next);
  }

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      // RENCONTRE D'UN DOSSIER LOCAL (patient cree hors-ligne) : tout vient du contexte
      // de saisie et de la file cloisonnee — aucun appel reseau, jamais la base existante.
      if (offlineIntakeMode && patientId) {
        const parent = await intakeQueue.localPatient(patientId);
        if (!parent) {
          setError(t('intake.parent_missing'));
          return;
        }
        const ctx = await intakeContextCache.get(baseId);
        if (!ctx) {
          setError(t('intake.context_required'));
          return;
        }
        setLocalParent(parent);
        const encounterFields = ctx.fields.filter((f) => f.scope === 'encounter').sort((a, b) => a.displayOrder - b.displayOrder);
        setFields(encounterFields);
        setRules(ctx.rules);
        setSections(ctx.sections ?? []);
        setCommonLayout(ctx.commonLayout);
        // Le contexte prepare EN LIGNE transporte deja le contrat et sa version : rien de
        // nouveau n'est ouvert au hors-ligne, l'information s'affiche simplement a l'identique.
        setVersionId(ctx.templateVersionId);
        setDiagnosisContext(ctx.diagnosisContext);
        const draft = loadDraft<EncounterDraft>('encounter', patientId);
        setLocalCandidate(draft);
        const proposed = initialValuesFromDefaults(encounterFields);
        setValues(proposed.values); setPrefilled(proposed.prefilled);
        loadedFor.current = `${baseId}:${patientId}`;
        setError(null);
        return;
      }
      if (!online && isOfflineIntakeEnabled()) {
        // Les rencontres des patients DEJA ENREGISTRES ne se saisissent pas hors-ligne.
        setError(t('intake.server_patient_unsupported'));
        return;
      }
      const base = await bases.getBase(baseId);
      if (!base?.base.currentTemplateVersionId) {
        setError(t('common.error'));
        return;
      }
      const version = await templates.getVersion(base.base.currentTemplateVersionId);
      const encounterFields = version.fields.filter((f) => f.scope === 'encounter').sort((a, b) => a.displayOrder - b.displayOrder);
      setFields(encounterFields);
      setRules(version.rules);
      setSections(version.sections ?? []);
      setCommonLayout(version.version.commonLayout);
      setVersionId(version.version.id);
      setDiagnosisContext(version.version.diagnosisContext);
      // A4 : restaurer un brouillon local eventuel (saisie non enregistree recuperee).
      const draft = patientId ? loadDraft<EncounterDraft>('encounter', patientId) : null;
      setLocalCandidate(draft);
      {
        // Preremplissage a la CREATION seulement, et jamais par-dessus un brouillon : une
        // valeur que la personne avait effacee ne doit pas reapparaitre a la reprise.
        const proposed = initialValuesFromDefaults(encounterFields);
        setValues(proposed.values);
        setPrefilled(proposed.prefilled);
      }
      setError(null);
      loadedFor.current = `${baseId}:${patientId}`;
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
      draftReady.current = true; // autosave actif seulement apres ce premier chargement
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, patientId, bases, templates, online, offlineIntakeMode]);

  // A4 : sauvegarde continue (debounce) du brouillon ANALYTIQUE tant qu'il y a du contenu.
  useEffect(() => {
    if (!draftReady.current || !patientId || !versionId || !offlineIntakeMode || work.enabled || localCandidate || !navigation.dirty) return;
    const hasContent = !!encounterDate || Object.keys(values).length > 0;
    const handle = setTimeout(() => {
      if (hasContent) {
        const saved = saveDraft<EncounterDraft>('encounter', patientId, { templateVersionId: versionId, encounterType, encounterDate, status, values });
        setLocalSaveError(!saved); setLocalSavedAt(saved ? Date.now() : null);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [patientId, encounterType, encounterDate, status, values, versionId, offlineIntakeMode, localCandidate, navigation.dirty, work.enabled]);

  function resumeLocalDraft() {
    if (!localCandidate) return;
    if (localCandidate.data.templateVersionId !== versionId) {
      setError('La version de ce brouillon local est différente ou inconnue. La copie est conservée ; elle ne peut pas remplacer automatiquement ce formulaire.');
      return;
    }
    const data = localCandidate.data;
    setValues(data.values); setEncounterDate(data.encounterDate); setEncounterType(data.encounterType); setStatus(data.status);
    setLocalCandidate(null); setDraftRestored(true); setPrefilled(new Set());
  }

  function discardDraft() {
    if (patientId) clearDraft('encounter', patientId);
    setEncounterType('consultation');
    setEncounterDate('');
    setStatus('draft');
    resetVisibilityWithdrawal();
    // Abandonner le brouillon rend un formulaire NEUF : les propositions reviennent.
    const proposed = initialValuesFromDefaults(fields);
    setValues(proposed.values);
    setPrefilled(proposed.prefilled);
    setDraftRestored(false);
    setLocalCandidate(null); setLocalSavedAt(null); setLocalSaveError(false); setDiscardLocalOpen(false);
  }

  useEffect(() => {
    if (loadedFor.current !== `${baseId}:${patientId}`) void load();
  }, [load, baseId, patientId]);

  // Apercu de l'age : calcule par le systeme des que la date est posee (DOB jamais exposee).
  // HORS-LIGNE (dossier local) : l'age est calcule LOCALEMENT depuis la date de naissance
  // de l'operation parente — le serveur le recalcule de toute facon a la synchronisation.
  useEffect(() => {
    let on = true;
    if (!patientId || !encounterDate) {
      setAge(null);
      return;
    }
    if (offlineIntakeMode && localParent) {
      const dob = localParent.payload.dateOfBirth;
      if (!dob) { setAge(null); return; }
      const d = new Date(`${dob}T00:00:00`);
      const ref = new Date(`${encounterDate}T00:00:00`);
      let years = ref.getFullYear() - d.getFullYear();
      const beforeBirthday = ref.getMonth() < d.getMonth()
        || (ref.getMonth() === d.getMonth() && ref.getDate() < d.getDate());
      if (beforeBirthday) years -= 1;
      setAge(years >= 0 ? years : null);
      return;
    }
    patients
      .computeAge(patientId, encounterDate)
      .then((a) => on && setAge(a))
      .catch(() => on && setAge(null));
    return () => {
      on = false;
    };
  }, [patientId, encounterDate, patients, offlineIntakeMode, localParent]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId) return;
    if (busy) return;
    if (work.locked) { await persistEncounter(); return; }

    // Seuls les champs APPLICABLES au type choisi sont valides / envoyes (ex: pas d'admission
    // pour une consultation). Les valeurs des champs masques ne sont pas soumises : c'est ICI
    // que l'effacement decide par le lot a lieu, apres l'annonce faite a l'ecran.
    const applicable = applicableFields;
    const applicableData = submittedData;
    // Le serveur exige la completude des la sortie du brouillon ('complete') pour tous les
    // comptes, et a CHAQUE enregistrement pour un compte de mission (aucun brouillon partiel).
    // Le frontend reproduit exactement cette frontiere (regles bloquantes : finalisation seule).
    const requireComplete = isMissionAccount(profile) || status !== 'draft';
    const fieldErrors = validateValues(applicable, applicableData, requireComplete, hidden).map((fe) =>
      `${labelOf(fe.fieldKey)} : ${fe.message}`
    );
    const ruleEval = evaluateRules(
      rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
      applicableData,
      hidden,
    );
    const block = [...fieldErrors, ...(requireComplete ? ruleEval.blocking : [])];
    if (!encounterDate) block.unshift(t('encounter.date'));
    setBlocking(block);
    setWarnings(ruleEval.warnings);
    if (block.length > 0) return;

    if (removed.length > 0 && !confirmationOpen) {
      setConfirmationOpen(true);
      return;
    }
    await persistEncounter();
  }

  async function persistEncounter() {
    if (!baseId || !patientId) return;
    setConfirmationOpen(false);

    setBusy(true);
    try {
      // RENCONTRE D'UN DOSSIER LOCAL : mise en file DEPENDANTE du patient en attente
      // (aucun appel reseau ; le serveur rejouera patient puis rencontre, dans l'ordre).
      if (offlineIntakeMode && localParent) {
        if (work.enabled) {
          await work.commit(); clearDraft('encounter', patientId); navigation.markClean();
          toast(t('intake.encounter_saved_pending')); navigate(`/bases/${baseId}`); return;
        }
        const fingerprint = JSON.stringify({ encounterType, encounterDate, status, submittedData });
        if (intakeAttempt.current?.fingerprint !== fingerprint) intakeAttempt.current = { fingerprint, operationKey: newOfflineId() };
        await enqueueEncounterCreate({
          baseId,
          operationKey: intakeAttempt.current.operationKey,
          parentOperationKey: localParent.id,
          payload: {
            encounterType, encounterDate, validationStatus: status, ageUnit: 'years', data: submittedData,
          },
        });
        clearDraft('encounter', patientId); // A4 : la saisie est enregistree -> plus de brouillon
        toast(t('intake.encounter_saved_pending'));
        navigation.markClean();
        navigate(`/bases/${baseId}`);
        return;
      }
      if (work.enabled) await work.commit();
      else await patients.createEncounter(patientId, {
        encounterType, encounterDate, validationStatus: status, ageUnit: 'years', data: submittedData,
      });
      clearDraft('encounter', patientId); // A4 : la saisie est enregistree -> plus de brouillon
      toast(t('toast.encounter_saved')); // UI-2 : la reussite se voit
      navigation.markClean();
      navigate(`/bases/${baseId}/patients/${patientId}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  // Confier la rencontre au staff : cree une demande de portee 'encounter' et ouvre la page
  // de depot des documents deidentifies. La saisie en cours reste dans son brouillon local.
  async function submitToStaff() {
    if (!baseId || !patientId) return;
    setBusy(true);
    try {
      const { taskId } = await curation.createSubmission(baseId, patientId, null, 'encounter');
      navigate(`/curation/${taskId}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={6} label={t('common.loading')} />;

  return (
    <section className="max-w-5xl space-y-5 sm:space-y-6">
      {navigation.guard}
      <div>
        <button onClick={() => navigate(offlineIntakeMode ? `/bases/${baseId}` : `/bases/${baseId}/patients/${patientId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="page-title">{t('encounter.new')}</h1>
          {maySubmitToCuration && !offlineIntakeMode && (
            <button type="button" onClick={() => navigation.protect(submitToStaff)} disabled={busy || work.locked} className="btn-secondary">
              <Send size={16} aria-hidden /> {t('create.submit')}
            </button>
          )}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <WorkDraftPanel draft={work} online={online} baseId={baseId ?? ''} patientId={patientId} />
      {localCandidate && <div className="space-y-2 rounded-xl border border-sky-200 p-3 text-sm">
        <p>Un brouillon sur cet appareil du {new Date(localCandidate.at).toLocaleString()} est disponible.</p>
        <button type="button" className="btn-secondary" onClick={() => navigation.protect(resumeLocalDraft)}>Reprendre le brouillon local</button>{' '}
        <button type="button" className="btn-secondary" onClick={() => setDiscardLocalOpen(true)}>Supprimer le brouillon local</button>
      </div>}
      {offlineIntakeMode && !work.enabled && <p role="status" className="text-sm text-slate-600">{localSaveError ? 'Sauvegarde locale impossible — dernières modifications non protégées.'
        : localSavedAt ? `Brouillon conservé sur cet appareil à ${new Date(localSavedAt).toLocaleTimeString()}` : 'Modifications non sauvegardées sur cet appareil.'}</p>}
      <ConfirmDialog open={discardLocalOpen} title="Supprimer le brouillon local ?" body="Le brouillon sera supprimé et le formulaire remis à son état initial."
        confirmLabel="Supprimer le brouillon" onConfirm={discardDraft} onCancel={() => setDiscardLocalOpen(false)} />

      {draftRestored && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
          <span>{t('draft.restored')}</span>
          <button type="button" onClick={() => setDiscardLocalOpen(true)} className="whitespace-nowrap font-medium text-sky-700 hover:underline">
            {t('draft.discard')}
          </button>
        </div>
      )}

      <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-5">
        <fieldset disabled={busy || work.locked} className="min-w-0 space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col text-sm">
            <span className="text-slate-700">{t('encounter.type')}</span>
            <select className="input mt-1" value={encounterType} onChange={(e) => setEncounterType(e.target.value)}>
              {ENCOUNTER_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`encountertype.${x}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-slate-700">{t('encounter.date')}</span>
            {/* A2 : focus d'emblee sur la date (type/statut ont un defaut) -> saisie sans la souris. */}
            <input type="date" autoFocus className="input mt-1" value={encounterDate} onChange={(e) => setEncounterDate(e.target.value)} required />
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-slate-700">{t('encounter.status')}</span>
            <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`encstatus.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {t('encounter.age')} : <strong>{age ?? '—'}</strong>
          <span className="ml-2 text-xs text-teal-600">{t('encounter.age_hint')}</span>
        </div>

        <EncounterFields
          fields={applicableFields}
          values={values}
          prefilledKeys={prefilled}
          hiddenKeys={hidden}
          rules={rules}
          requireComplete={isMissionAccount(profile) || status !== 'draft'}
          onChange={(k, v) => {
            // Effacer une proposition jamais confirmee retire la cle, au lieu d'enregistrer
            // une valeur vide la ou une fiche non preremplie n'aurait rien du tout.
            const wasProposed = prefilled.has(k);
            setPrefilled((current) => forgetPrefilled(current, k));
            updateEncounterValue(k, v, wasProposed && isClearedValue(v));
          }}
          onRemove={(key) => {
            setPrefilled((current) => forgetPrefilled(current, key));
            updateEncounterValue(key, undefined, true);
          }}
          sections={sections}
          commonLayout={commonLayout}
        />

        {/* L56 : information NON BLOQUANTE sur les diagnostics sans bloc. Elle ne conditionne
            ni la validation, ni le statut, et n'est jamais enregistree. */}
        <DiagnosisCoverageNotice coverage={coverage} />

        <HiddenValuesNotice removedKeys={removed} fields={fields} />

        {confirmationOpen && (
          <HiddenValuesConfirmation
            removedKeys={removed}
            fields={fields}
            onConfirm={() => void persistEncounter()}
            onCancel={() => setConfirmationOpen(false)}
          />
        )}

        {blocking.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">{t('encounter.blocking')}</p>
            <ul className="list-disc pl-5">
              {blocking.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">{t('encounter.warnings')}</p>
            <ul className="list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        </fieldset>
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:bg-slate-900">
          <button type="submit" disabled={busy} className="btn-primary">
            {t('encounter.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <span className="ml-auto text-xs text-slate-400">{t('common.save_shortcut')}</span>
        </div>
      </form>
    </section>
  );
}
