import { errorMessage, isRefreshRequiredError } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { isMissionAccount } from '../../auth/logic';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { RecordFormContext } from '../../data/patients';
import { buildCompatiblePatch } from '../../data/patients';
import { definitionVersionId, fieldsForLocalValidation, isMissingRecordFormContextError, mergeRecordFormFields } from '../../data/recordFormContext';
import { recordCompletionSummary, stillEmptyKeys } from '../../domain/recordCompletion';
import type { DiagnosisContext, TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { validateValues, evaluateRules, hiddenFieldKeys, withoutHiddenValues } from '../../domain/validation';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { useToast } from '../../components/Toast';
import { EncounterFields, HiddenValuesConfirmation, HiddenValuesNotice } from './EncounterFields';
import { SkeletonList } from '../../components/Skeleton';
import { useVisibilityWithdrawal } from './useVisibilityWithdrawal';
import { DiagnosisCoverageNotice, useDiagnosisCoverage } from './DiagnosisCoverageNotice';
import { RecordCompletionNotice } from './RecordCompletion';
import { useOnline } from '../../data/offline';
import { useDirtyForm } from '../../lib/useUnsavedChanges';
import { useWorkDraft } from './useWorkDraft';
import { WorkDraftPanel } from './WorkDraftPanel';

const STATUSES = ['draft', 'complete', 'curated'] as const;

// Correction / completion des DONNEES PERMANENTES d'un patient. Le motif est requis ;
// chaque champ modifie est journalise cote serveur (update_patient). En brouillon, on peut
// enregistrer des donnees INCOMPLETES (completion ulterieure) ; la completude n'est exigee
// qu'en visant 'curated'.
export function EditPatient() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const { toast } = useToast();
  const { profile } = useAuth();
  const online = useOnline();
  const loadedFor = useRef<string | null>(null);
  const [initialStatus, setInitialStatus] = useState('draft');

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  // Les regles actives calculent la visibilite/couverture ; les regles historiques restent
  // la seule validation bloquante d'une fiche deja existante.
  const [validationRules, setValidationRules] = useState<ValidationRule[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [commonLayout, setCommonLayout] = useState<TemplateCommonLayout | undefined>(undefined);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string>('draft');
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [recordContext, setRecordContext] = useState<RecordFormContext | null>(null);
  // L55/L56 : contrat diagnostique de LA VERSION du dossier (absent = collecte historique).
  const [diagnosisVersionId, setDiagnosisVersionId] = useState<string | null>(null);
  const [diagnosisContext, setDiagnosisContext] = useState<DiagnosisContext[] | undefined>(undefined);
  const [activeDiagnosisVersionId, setActiveDiagnosisVersionId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const compatibleAttempt = useRef<{ requestKey: string; operationId: string } | null>(null);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));
  const back = () => navigate(`/bases/${baseId}/patients/${patientId}`);
  const { track: trackVisibilityWithdrawal } = useVisibilityWithdrawal(rules, fields, sections);
  const navigation = useDirtyForm({ values, status, reason }, !loading && diagnosisVersionId !== null, `${baseId}:${patientId}`);
  const work = useWorkDraft({
    // Une fois le contexte E3 obtenu, la soumission passe par le patch compatible : le brouillon
    // clinique historique ne sait pas porter les ajouts actifs et ne doit pas les perdre.
    context: !recordContext && baseId && patientId && diagnosisVersionId && baseVersion !== null ? {
      baseId, targetId: patientId, kind: 'patient_update', templateVersionId: diagnosisVersionId, entityRevision: String(baseVersion),
    } : null,
    ownerId: profile?.id ?? '', payload: { values, status, reason }, dirty: navigation.dirty, online,
    onRestore: (payload) => { setValues(payload.values); setStatus(initialStatus === 'curated' ? 'curated' : payload.status ?? 'draft'); setReason(payload.reason ?? ''); },
  });

  const load = useCallback(async () => {
    if (!baseId || !patientId) return;
    setLoading(true);
    setReloadRequired(false);
    try {
      const contextPromise = patients.getPatientFormContext
        ? patients.getPatientFormContext(baseId, patientId).catch((e: unknown) => {
          // Déploiement progressif : l'absence précise de la RPC conserve le parcours ancien ;
          // un refus, une erreur réseau ou un contexte invalide restent visibles.
          if (isMissingRecordFormContextError(e)) return null;
          throw e;
        })
        : Promise.resolve(null);
      const [p, base, context] = await Promise.all([
        patients.getPatient(baseId, patientId),
        bases.getBase(baseId),
        contextPromise,
      ]);
      const loadedValues = p?.data ?? {};
      setValues(loadedValues);
      setInitialValues(loadedValues);
      setRecordContext(context);
      if (p) { setStatus(p.validationStatus); setInitialStatus(p.validationStatus); setBaseVersion(p.version ?? null); }
      // §7.4 (audit v12, etendu) : un patient HISTORIQUE s'edite avec SA version de gabarit — memes
      // libelles/champs/regles que le serveur. La version courante de la base n'est qu'un repli.
      const historicalVersionId = context?.record_definition_revision ?? p?.templateVersionId ?? base?.base.currentTemplateVersionId ?? null;
      const activeVersionId = context
        ? (definitionVersionId(context.active_definition) ?? base?.base.currentTemplateVersionId ?? historicalVersionId)
        : historicalVersionId;
      if (historicalVersionId) {
        const historicalPromise = templates.getVersion(historicalVersionId);
        const activePromise = activeVersionId && activeVersionId !== historicalVersionId
          ? templates.getVersion(activeVersionId)
          : historicalPromise;
        const [historical, active] = await Promise.all([historicalPromise, activePromise]);
        if (context) {
          setFields(mergeRecordFormFields(context, historical.fields, active.fields, 'patient'));
          setRules(active.rules);
          setValidationRules(historical.rules);
          setSections(active.sections ?? []);
          setCommonLayout(active.version.commonLayout);
        } else {
          const historicalFields = historical.fields.filter((f) => f.scope === 'patient').sort((a, b) => a.displayOrder - b.displayOrder);
          setFields(historicalFields);
          setRules(historical.rules);
          setValidationRules(historical.rules);
          setSections(historical.sections ?? []);
          setCommonLayout(historical.version.commonLayout);
        }
        setDiagnosisVersionId(historical.version.id);
        setDiagnosisContext(context ? active.version.diagnosisContext : historical.version.diagnosisContext);
        setActiveDiagnosisVersionId(active.version.id);
      } else {
        setFields([]); setRules([]); setValidationRules([]); setSections([]); setCommonLayout(undefined);
        setDiagnosisVersionId(null); setDiagnosisContext(undefined); setActiveDiagnosisVersionId(null);
      }
      setError(null);
      loadedFor.current = `${baseId}:${patientId}`;
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, patientId, bases, templates, patients]);

  useEffect(() => { if (loadedFor.current !== `${baseId}:${patientId}`) void load(); }, [load, baseId, patientId]);

  // L32 — champs masques par une regle d'affichage : ni rendus, ni valides, ni enregistres.
  const { hidden, removed, data: submittedData } = useMemo(() => {
    const hiddenKeys = hiddenFieldKeys(rules, values, fields, sections);
    const stripped = withoutHiddenValues(values, hiddenKeys);
    return { hidden: hiddenKeys, removed: stripped.removed, data: stripped.values };
  }, [rules, values, fields, sections]);

  // E5 : un ajout requis est annonce et compte, mais ne devient pas une obligation retroactive.
  // Le formulaire est donc RENDU avec la meme liste que la validation locale : sans cela,
  // l'ecran afficherait une erreur bloquante pour une variable que l'enregistrement accepte.
  const validationFields = useMemo(() => fieldsForLocalValidation(fields, recordContext), [fields, recordContext]);
  const completion = useMemo(() => recordCompletionSummary(recordContext), [recordContext]);
  const coverage = useDiagnosisCoverage(activeDiagnosisVersionId, diagnosisContext, 'patient', submittedData, fields, rules, sections);
  // Le serveur a decide ce qui est un ajout applicable et ce que le formulaire courant attend ;
  // l'ecran ne fait que retirer du compte ce qui vient d'etre saisi.
  const toFillKeys = useMemo(
    () => (completion ? stillEmptyKeys(completion.additionKeys, values, hidden) : new Set<string>()),
    [completion, values, hidden],
  );
  const pendingRequiredKeys = useMemo(
    () => (completion ? stillEmptyKeys(completion.addedObligationKeys, values, hidden) : new Set<string>()),
    [completion, values, hidden],
  );

  // Voir `EncounterForm` : deux mises a jour peuvent partir du meme gestionnaire, la seconde
  // ne doit pas repartir de l'instantane du rendu.
  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; }, [values]);

  function updatePatientValue(key: string, value: unknown, remove = false) {
    const current = valuesRef.current;
    const next = { ...current };
    if (remove) delete next[key];
    else next[key] = value;
    valuesRef.current = next;
    trackVisibilityWithdrawal(current, next);
    setValues(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId) return;
    if (busy) return;
    if (work.locked) { await persistPatient(); return; }
    const block = [
      // En brouillon : le MEDECIN n'exige pas la completude (mais valide les valeurs
      // renseignees) ; un compte de mission, lui, ne peut jamais enregistrer de brouillon
      // partiel -- comme des la sortie du brouillon ('complete') pour tous les comptes.
      ...validateValues(validationFields, submittedData, isMissionAccount(profile) || status !== 'draft', hidden)
        .map((fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`),
      ...(isMissionAccount(profile) || status !== 'draft' ? evaluateRules(
        validationRules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
        submittedData,
        hidden,
      ).blocking : []),
    ];
    if (!reason.trim()) block.unshift(t('encounter.reason_required'));
    setBlocking(block);
    if (block.length > 0) return;

    if (removed.length > 0 && !confirmationOpen) {
      setConfirmationOpen(true);
      return;
    }
    await persistPatient();
  }

  async function persistPatient() {
    if (!patientId) return;
    setConfirmationOpen(false);

    setBusy(true);
    try {
      if (baseId && recordContext && patients.updatePatientCompatible) {
        const patch = buildCompatiblePatch(
          initialValues,
          values,
          hidden,
          fields.map((field) => field.fieldKey),
        );
        const requestKey = JSON.stringify([recordContext.context_fingerprint, patch, status, reason.trim()]);
        if (compatibleAttempt.current?.requestKey !== requestKey) {
          compatibleAttempt.current = { requestKey, operationId: crypto.randomUUID() };
        }
        await patients.updatePatientCompatible({
          baseId,
          patientId: patientId!,
          patch,
          validationStatus: status,
          reason: reason.trim(),
          expectedRecordRevision: recordContext.record_revision,
          recordDefinitionRevision: recordContext.record_definition_revision,
          operationId: compatibleAttempt.current.operationId,
          contextFingerprint: recordContext.context_fingerprint,
        });
      } else if (work.enabled) await work.commit();
      else await patients.updatePatientData(patientId, submittedData, status, reason.trim(), baseVersion);
      navigation.markClean();
      toast(t('toast.patient_saved')); // UI-2
      back();
    } catch (e) {
      const detail = e as { message?: string };
      if (/CONFLIT_VERSION/i.test(detail?.message ?? '')) {
        setReloadRequired(true);
        // Conserver le libellé historique attendu par les corrections et les tests ; les
        // valeurs locales restent dans `values` et ne sont jamais remplacées par l'erreur.
        setError('Ce patient a ete modifie par une autre personne. Vos changements ne sont pas enregistres : rechargez les donnees avant de recommencer.');
      } else if (isRefreshRequiredError(e)) {
        setReloadRequired(true);
        setError(t('form.refresh_required'));
      } else {
        setError(msg(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={6} label={t('common.loading')} />;

  return (
    <section className="max-w-5xl space-y-5 sm:space-y-6">
      {navigation.guard}
      <div>
        <button onClick={back} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('admin.back')}</button>
        <h1 className="page-title mt-2">{t('patient.edit_permanent')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <WorkDraftPanel draft={work} online={online} baseId={baseId ?? ''} patientId={patientId} />

      <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-5">
        <fieldset disabled={busy || work.locked} className="min-w-0 space-y-5">
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('encounter.status')}</span>
          <select className="input mt-1 w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s} disabled={initialStatus === 'curated' && s !== 'curated'}>{t(`encstatus.${s}`)}</option>
            ))}
          </select>
        </label>

        {/* E5 : les variables ajoutees depuis l'enregistrement de cette fiche, comptees a partir
            du contexte serveur. Rien n'est prerempli et le statut clinique reste celui choisi. */}
        <RecordCompletionNotice
          labels={[...toFillKeys].map(labelOf)}
          requiredLabels={[...pendingRequiredKeys].map(labelOf)}
        />

        {fields.length === 0 ? (
          <p className="text-sm text-slate-500">{t('patient.no_permanent_fields')}</p>
        ) : (
          <EncounterFields
            fields={validationFields}
            values={values}
            hiddenKeys={hidden}
            sections={sections}
            commonLayout={commonLayout}
            rules={validationRules}
            requireComplete={isMissionAccount(profile) || status !== 'draft'}
            toFillKeys={toFillKeys}
            onChange={(k, v) => updatePatientValue(k, v)}
            onRemove={(key) => updatePatientValue(key, undefined, true)}
          />
        )}

        {/* L56 : information NON BLOQUANTE sur les diagnostics sans bloc. Elle ne conditionne
            ni la validation, ni le statut, et n'est jamais enregistree. */}
        <DiagnosisCoverageNotice coverage={coverage} />

        <HiddenValuesNotice removedKeys={removed} fields={fields} />

        {confirmationOpen && (
          <HiddenValuesConfirmation
            removedKeys={removed}
            fields={fields}
            onConfirm={() => void persistPatient()}
            onCancel={() => setConfirmationOpen(false)}
          />
        )}

        <label className="flex flex-col text-sm">
          <span className="font-medium text-slate-700">{t('encounter.reason')} <span className="text-red-500">*</span></span>
          <input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>

        {blocking.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <ul className="list-disc pl-5">
              {blocking.map((b, i) => (<li key={i}>{b}</li>))}
            </ul>
          </div>
        )}

        </fieldset>
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:bg-slate-900">
          <button type="submit" disabled={busy} className="btn-primary">{t('encounter.save')}</button>
          <button type="button" onClick={back} className="btn-secondary">{t('common.cancel')}</button>
          {reloadRequired && <button type="button" onClick={() => navigation.protect(async () => { navigation.resetBaseline(); await load(); })} className="btn-secondary">{t('form.reload_data')}</button>}
          <span className="ml-auto text-xs text-slate-400">{t('common.save_shortcut')}</span>
        </div>
      </form>
    </section>
  );
}
