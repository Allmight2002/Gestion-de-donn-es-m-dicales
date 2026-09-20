import { withSections } from '../../data/templates';
import { errorMessage, isRefreshRequiredError } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { isMissionAccount } from '../../auth/logic';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { BaseListing } from '../../data/bases';
import type { FieldChange, RecordFormContext } from '../../data/patients';
import { buildCompatiblePatch } from '../../data/patients';
import { definitionVersionId, fieldsForLocalValidation, isMissingRecordFormContextError, mergeRecordFormFields } from '../../data/recordFormContext';
import { recordCompletionSummary, stillEmptyKeys } from '../../domain/recordCompletion';
import { ownerJustificationExempt } from '../../domain/ownerJustification';
import { displayFieldValue, type DiagnosisContext, type TemplateCommonLayout, type TemplateField, type TemplateSection, type ValidationRule } from '../../data/types';
import {
  encounterScopeFieldKeys, enqueueEncounterUpdate, fieldsForOfflineVersion, isOfflineEnabled, offlineCache,
  offlineEncounterFieldScopesKnown, sectionsForOfflineVersion, useOnline, withinEncounterGroupScope,
  OFFLINE_GROUP_ENCOUNTER_REQUIRES_ONLINE,
} from '../../data/offline';
import {
  validateValues, evaluateRules, hiddenFieldKeys, withoutHiddenValues, isMissing, missingCodeOf,
} from '../../domain/validation';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { useToast } from '../../components/Toast';
import { EncounterFields, HiddenValuesConfirmation, HiddenValuesNotice, encounterApplicableFields } from './EncounterFields';
import { SkeletonList } from '../../components/Skeleton';
import { useVisibilityWithdrawal } from './useVisibilityWithdrawal';
import { DiagnosisCoverageNotice, useDiagnosisCoverage } from './DiagnosisCoverageNotice';
import { RecordCompletionNotice } from './RecordCompletion';
import { JustificationField } from './JustificationField';
import { useDirtyForm } from '../../lib/useUnsavedChanges';
import { useWorkDraft } from './useWorkDraft';
import { WorkDraftPanel } from './WorkDraftPanel';

const STATUSES = ['draft', 'complete', 'curated'] as const;

/** Presente le bloc de l'occurrence comme une section ordinaire : ses champs se saisissent ici. */
function sectionsForEncounterScope(
  sections: readonly TemplateSection[],
  groupSectionKey: string | null,
): TemplateSection[] {
  if (groupSectionKey === null) return [...sections];
  return sections.map((section) => (section.sectionKey === groupSectionKey
    ? { ...section, isRepeatable: false }
    : section));
}

function excludedEncounterFieldKeys(context: RecordFormContext | null): Set<string> {
  return new Set((context?.fields ?? [])
    .filter((field) => field.scope === 'encounter' && (
      field.repeatable_group_applicable === false
      || (field.applicability === 'not_applicable' && field.applicability_reason === 'encounter_type')
    ))
    .map((field) => field.field_key));
}

// Edition / correction d'une rencontre (cahier §10, critere 12). Le motif est requis ;
// chaque champ modifie est journalise (field_change_log) cote serveur.
export function EditEncounter() {
  const { id: baseId, patientId, encounterId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const online = useOnline();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const { toast } = useToast();
  const { profile } = useAuth();
  const loadedFor = useRef<string | null>(null);
  const [initialStatus, setInitialStatus] = useState('draft');

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  // Les regles actives pilotent la visibilite/couverture ; la validation d'une rencontre
  // historique reste celle de sa definition d'origine.
  const [validationRules, setValidationRules] = useState<ValidationRule[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [commonLayout, setCommonLayout] = useState<TemplateCommonLayout | undefined>(undefined);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string>('draft');
  const [encounterType, setEncounterType] = useState('consultation');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<FieldChange[]>([]);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [baseListing, setBaseListing] = useState<BaseListing | null>(null);
  const [recordContext, setRecordContext] = useState<RecordFormContext | null>(null);
  // L55/L56 : contrat diagnostique de LA VERSION de la rencontre (absent = collecte historique).
  const [diagnosisVersionId, setDiagnosisVersionId] = useState<string | null>(null);
  const [diagnosisContext, setDiagnosisContext] = useState<DiagnosisContext[] | undefined>(undefined);
  const [activeDiagnosisVersionId, setActiveDiagnosisVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [offlineEditAllowed, setOfflineEditAllowed] = useState(false);
  const [offlineEditBlocked, setOfflineEditBlocked] = useState(false);
  const compatibleAttempt = useRef<{ requestKey: string; operationId: string } | null>(null);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => e instanceof Error && e.message === OFFLINE_GROUP_ENCOUNTER_REQUIRES_ONLINE
    ? t('offline.group_edit_requires_online')
    : errorMessage(e, t('common.error'));
  const fmt = (v: unknown): string => {
    if (isMissing(v)) return t(`missing.${missingCodeOf(v)!}`);
    return displayFieldValue(v, '—');
  };
  const { track: trackVisibilityWithdrawal } = useVisibilityWithdrawal(rules, fields, sections);
  const navigation = useDirtyForm({ values, status, reason }, !loading && diagnosisVersionId !== null, `${baseId}:${encounterId}`);
  const work = useWorkDraft({
    // Une fois le contexte E3 obtenu, la soumission passe par le patch compatible : le brouillon
    // clinique historique ne sait pas porter les ajouts actifs et ne doit pas les perdre.
    context: !recordContext && baseId && encounterId && diagnosisVersionId && baseUpdatedAt && (online || offlineEditAllowed) ? {
      baseId, targetId: encounterId, kind: 'encounter_update', templateVersionId: diagnosisVersionId, entityRevision: String(Date.parse(baseUpdatedAt)),
    } : null,
    ownerId: profile?.id ?? '', payload: { values, status, reason }, dirty: navigation.dirty, online,
    onRestore: (payload) => { setValues(payload.values); setStatus(initialStatus === 'curated' ? 'curated' : payload.status ?? 'draft'); setReason(payload.reason ?? ''); },
  });

  // L32 — champs masques par une regle d'affichage : ni rendus, ni valides, ni enregistres.
  const applicableFields = useMemo(
    () => recordContext ? fields : encounterApplicableFields(fields, sections, encounterType),
    [fields, sections, encounterType, recordContext],
  );
  const { hidden, removed, data: submittedData } = useMemo(() => {
    const applicableValues = Object.fromEntries(Object.entries(values).filter(([key]) => applicableFields.some((field) => field.fieldKey === key)));
    const hiddenKeys = hiddenFieldKeys(rules, applicableValues, applicableFields, sections);
    for (const field of fields) if (!applicableFields.includes(field)) hiddenKeys.add(field.fieldKey);
    const stripped = withoutHiddenValues(values, hiddenKeys);
    return { hidden: hiddenKeys, removed: stripped.removed, data: stripped.values };
  }, [rules, values, fields, sections, applicableFields]);

  // E5 : voir `EditPatient` — un ajout requis est annonce et compte, sans devenir une
  // obligation retroactive ; le rendu suit donc la meme liste que la validation locale.
  const validationFields = useMemo(() => fieldsForLocalValidation(fields, recordContext), [fields, recordContext]);
  const renderedFields = useMemo(() => fieldsForLocalValidation(applicableFields, recordContext), [applicableFields, recordContext]);
  const completion = useMemo(() => recordCompletionSummary(recordContext), [recordContext]);
  const coverage = useDiagnosisCoverage(activeDiagnosisVersionId, diagnosisContext, 'encounter', submittedData, fields, rules, sections);
  const toFillKeys = useMemo(
    () => (completion ? stillEmptyKeys(completion.additionKeys, values, hidden) : new Set<string>()),
    [completion, values, hidden],
  );
  // §4.5 : dispense serveur du proprietaire reel. Hors connexion, la file conserve son motif :
  // la propriete ne peut pas etre reverifiee et une operation sans motif resterait bloquee au
  // retour du reseau. Aucun droit hors connexion n'est ouvert ni retire par ce lot.
  const reasonOptional = online && ownerJustificationExempt(baseListing, profile);
  const pendingRequiredKeys = useMemo(
    () => (completion ? stillEmptyKeys(completion.addedObligationKeys, values, hidden) : new Set<string>()),
    [completion, values, hidden],
  );

  // Voir `EncounterForm` : deux mises a jour peuvent partir du meme gestionnaire, la seconde
  // ne doit pas repartir de l'instantane du rendu.
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
    if (!baseId || !encounterId) return;
    setLoading(true);
    setReloadRequired(false);
    try {
      if (!online) {
        // HORS-LIGNE : la rencontre et les champs viennent de l'instantane local.
        const snap = await offlineCache.get(baseId);
        const enc = snap?.patients.flatMap((p) => p.encounters).find((e) => e.id === encounterId) ?? null;
        setHistory([]);
        setRecordContext(null);
        setBaseListing(null);
        if (!enc) {
          setOfflineEditAllowed(false);
          setOfflineEditBlocked(true);
          setError(t('offline.not_cached'));
          return;
        }
        const encounterSections = sectionsForOfflineVersion(snap!, enc.templateVersionId);
        const dict = fieldsForOfflineVersion(snap!, enc.templateVersionId);
        // Seule une portee inconnue bloque : un cache anterieur au marqueur ne dit pas a quel
        // groupe la ligne appartient, et editer a l'aveugle produirait une correction irrecuperable.
        if (enc.groupSectionKey === undefined || encounterSections === null || dict === null
          || !offlineEncounterFieldScopesKnown(dict, encounterSections)) {
          setOfflineEditAllowed(false);
          setOfflineEditBlocked(true);
          setError(t('offline.group_edit_requires_online'));
          setValues({});
          setInitialValues({});
          setFields([]);
          setRules([]);
          setValidationRules([]);
          setSections([]);
          return;
        }
        setOfflineEditAllowed(true);
        setOfflineEditBlocked(false);
        // §5 : les champs du groupe pour une occurrence, ceux d'aucun groupe pour une rencontre.
        const scopeFieldKeys = encounterScopeFieldKeys(dict, encounterSections, enc.groupSectionKey);
        const { age_at_encounter: _drop, ...withoutAge } = enc.data;
        void _drop;
        const rest = withinEncounterGroupScope(withoutAge, dict, encounterSections, enc.groupSectionKey);
        valuesRef.current = rest;
        setValues(rest);
        setInitialValues(rest);
        setStatus(enc.validationStatus);
        setInitialStatus(enc.validationStatus);
        setEncounterType(enc.encounterType);
        setBaseUpdatedAt(enc.updatedAt ?? null); // jeton optimiste pour la synchro
        // §7.4/§7.5 : dictionnaire de LA VERSION DE LA RENCONTRE (fieldsByVersion), pas celui de la
        // version courante de la base ; repli sur `fields` (instantane ancien, sans multi-versions).
        const encFields = withSections(dict.filter((field) => field.scope !== 'encounter' || scopeFieldKeys.has(field.fieldKey)), encounterSections)
          .filter((f) => f.scope === 'encounter')
          .sort((a, b) => a.displayOrder - b.displayOrder)
          // §7.5 : un instantane ANTERIEUR (dictionnaire minimal, sans `section`) doit rester
          // editable -> section par defaut, sinon EncounterFields (groupe par section) n'affiche rien.
          .map((f) => ({ ...f, section: f.section === undefined ? 'clinique' : f.section }));
        setFields(encFields as unknown as TemplateField[]);
        const offlineRules = (enc.templateVersionId && snap!.rulesByVersion?.[enc.templateVersionId]) || [];
        setRules(offlineRules as unknown as ValidationRule[]);
        setValidationRules(offlineRules as unknown as ValidationRule[]);
        setSections(sectionsForEncounterScope(encounterSections, enc.groupSectionKey));
        setCommonLayout(undefined);
        // L'instantane transporte le contrat par version : il n'ouvre aucun hors-ligne nouveau.
        setDiagnosisVersionId(enc.templateVersionId ?? null);
        setDiagnosisContext(enc.templateVersionId ? snap!.diagnosisContextByVersion?.[enc.templateVersionId] : undefined);
        setActiveDiagnosisVersionId(enc.templateVersionId ?? null);
        setError(null);
        return;
      }

      setOfflineEditAllowed(false);
      setOfflineEditBlocked(false);

      const contextPromise = patients.getEncounterFormContext
        ? patients.getEncounterFormContext(baseId, encounterId).catch((e: unknown) => {
          // Déploiement progressif : seule l'absence précise de la RPC autorise le repli ancien.
          if (isMissingRecordFormContextError(e)) return null;
          throw e;
        })
        : Promise.resolve(null);
      const [enc, base, hist, context] = await Promise.all([
        patients.getEncounter(encounterId),
        bases.getBase(baseId),
        patients.listFieldChanges('encounter', encounterId),
        contextPromise,
      ]);
      const excludedContextKeys = excludedEncounterFieldKeys(context);
      if (enc) {
        const sourceValues = context
          ? Object.fromEntries(Object.entries(context.values).filter(([key]) => !excludedContextKeys.has(key)))
          : enc.data;
        const { age_at_encounter: _drop, ...rest } = sourceValues;
        void _drop;
        valuesRef.current = rest;
        setValues(rest);
        setInitialValues(rest);
        setRecordContext(context);
        setStatus(enc.validationStatus);
        setInitialStatus(enc.validationStatus);
        setEncounterType(enc.encounterType);
        setBaseUpdatedAt(enc.updatedAt ?? null);
      }
      setBaseListing(base ?? null);
      setHistory(hist);
      // §7.4 : une rencontre HISTORIQUE s'edite avec SA version de gabarit (libelles, champs et
      // regles de l'epoque = memes controles que le serveur). La version courante de la base ne
      // sert que de repli (et a la CREATION d'une nouvelle rencontre).
      const historicalVersionId = context?.record_definition_revision ?? enc?.templateVersionId ?? base?.base.currentTemplateVersionId ?? null;
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
          setFields(mergeRecordFormFields(context, historical.fields, active.fields, 'encounter')
            .filter((field) => !excludedContextKeys.has(field.fieldKey)));
          setRules(active.rules);
          setValidationRules(historical.rules);
          setSections(active.sections ?? []);
          setCommonLayout(active.version.commonLayout);
        } else {
          setFields(historical.fields.filter((f) => f.scope === 'encounter').sort((a, b) => a.displayOrder - b.displayOrder));
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
      loadedFor.current = `${baseId}:${encounterId}`;
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, encounterId, online, bases, templates, patients, t]);

  useEffect(() => {
    if (loadedFor.current !== `${baseId}:${encounterId}`) {
      void load();
      return;
    }
    if (online) {
      setOfflineEditAllowed(false);
      setOfflineEditBlocked(false);
      return;
    }
    if (!baseId || !encounterId) return;

    let active = true;
    setOfflineEditAllowed(false);
    setOfflineEditBlocked(true);
    setError(t('offline.group_edit_requires_online'));
    void offlineCache.get(baseId).then((snap) => {
      if (!active) return;
      const cached = snap?.patients.flatMap((patient) => patient.encounters).find((row) => row.id === encounterId);
      const versionSections = cached ? sectionsForOfflineVersion(snap!, cached.templateVersionId) : null;
      const dictionary = cached ? fieldsForOfflineVersion(snap!, cached.templateVersionId) : null;
      if (!cached || cached.groupSectionKey === undefined || versionSections === null || dictionary === null) {
        setError(cached ? t('offline.group_edit_requires_online') : t('offline.not_cached'));
        return;
      }
      if (!offlineEncounterFieldScopesKnown(dictionary, versionSections)) {
        setError(t('offline.group_edit_requires_online'));
        return;
      }
      const groupScope = cached.groupSectionKey;
      const scopeFieldKeys = encounterScopeFieldKeys(dictionary, versionSections, groupScope);
      const safeValues = withinEncounterGroupScope(valuesRef.current, dictionary, versionSections, groupScope);
      valuesRef.current = safeValues;
      setValues(safeValues);
      setInitialValues((current) => withinEncounterGroupScope(current, dictionary, versionSections, groupScope));
      setFields((current) => current.filter((field) => field.scope !== 'encounter' || scopeFieldKeys.has(field.fieldKey)));
      setRecordContext(null);
      setSections(sectionsForEncounterScope(versionSections, groupScope));
      setOfflineEditAllowed(true);
      setOfflineEditBlocked(false);
      setError(null);
    }).catch(() => {
      if (active) setError(t('offline.group_edit_requires_online'));
    });
    return () => { active = false; };
  }, [load, baseId, encounterId, online, t]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId || !encounterId) return;
    if (busy) return;
    if (work.locked) { await persistEncounter(); return; }

    // Completude exigee des la sortie du brouillon ('complete') pour tous les comptes, et a
    // CHAQUE enregistrement pour un compte de mission (aucun brouillon partiel). Regles
    // bloquantes : finalisation seule.
    const requireComplete = isMissionAccount(profile) || status !== 'draft';
    const ruleEval = evaluateRules(
      validationRules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
      submittedData,
      hidden,
    );
    const block = [
      ...validateValues(validationFields, submittedData, requireComplete, hidden)
        .map((fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`),
      ...(requireComplete ? ruleEval.blocking : []),
    ];
    if (!reason.trim() && !reasonOptional) block.unshift(t('encounter.reason_required'));
    setBlocking(block);
    if (block.length > 0) return;

    if (removed.length > 0 && !confirmationOpen) {
      setConfirmationOpen(true);
      return;
    }
    await persistEncounter();
  }

  async function persistEncounter() {
    if (!baseId || !patientId || !encounterId) return;
    setConfirmationOpen(false);

    setBusy(true);
    try {
      if (!online) {
        if (!isOfflineEnabled()) throw new Error('Mode hors-ligne desactive par la politique de securite');
        if (!offlineEditAllowed) throw new Error(OFFLINE_GROUP_ENCOUNTER_REQUIRES_ONLINE);
        // HORS-LIGNE : on met la correction en file d'attente (synchro au retour du reseau).
        await enqueueEncounterUpdate({
          baseId, patientId, encounterId,
          data: submittedData, reason: reason.trim(), validationStatus: status, baseUpdatedAt,
        });
      } else {
        // EN LIGNE : RPC validee, avec verrou optimiste (refuse si la rencontre a change).
        if (recordContext && patients.updateEncounterCompatible) {
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
          await patients.updateEncounterCompatible({
            baseId,
            encounterId,
            patch,
            validationStatus: status,
            reason: reason.trim(),
            expectedRecordRevision: recordContext.record_revision,
            recordDefinitionRevision: recordContext.record_definition_revision,
            operationId: compatibleAttempt.current.operationId,
            contextFingerprint: recordContext.context_fingerprint,
          });
        } else if (work.enabled) await work.commit();
        else await patients.updateEncounter(encounterId, submittedData, status, reason.trim(), baseUpdatedAt);
      }
      navigation.markClean();
      toast(t(online ? 'toast.encounter_saved' : 'toast.encounter_queued')); // UI-2
      navigate(`/bases/${baseId}/patients/${patientId}`);
    } catch (e) {
      if (isRefreshRequiredError(e)) {
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
        <button onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('encounter.edit_title')}</h1>
      </div>

      {!online && offlineEditBlocked ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error ?? t('offline.group_edit_requires_online')}
        </p>
      ) : (
      <>
      {!online && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {t('offline.edit_queued_hint')}
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <WorkDraftPanel draft={work} online={online} baseId={baseId ?? ''} patientId={patientId} />

      <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-5">
        <fieldset disabled={busy || work.locked} className="min-w-0 space-y-5">
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('encounter.status')}</span>
          <select className="input mt-1 w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s} disabled={initialStatus === 'curated' && s !== 'curated'}>
                {t(`encstatus.${s}`)}
              </option>
            ))}
          </select>
        </label>

        {/* E5 : ajouts du formulaire courant encore vides sur CETTE rencontre. La portee et le
            type de rencontre sont ceux du contexte serveur ; aucune valeur n'est proposee. */}
        <RecordCompletionNotice
          labels={[...toFillKeys].map(labelOf)}
          requiredLabels={[...pendingRequiredKeys].map(labelOf)}
        />

        <EncounterFields
          fields={renderedFields}
          values={values}
          hiddenKeys={hidden}
          sections={sections}
          commonLayout={commonLayout}
          rules={validationRules}
          requireComplete={isMissionAccount(profile) || status !== 'draft'}
          toFillKeys={toFillKeys}
          onChange={(k, v) => updateEncounterValue(k, v)}
          onRemove={(key) => updateEncounterValue(key, undefined, true)}
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

        <JustificationField value={reason} onChange={setReason} optional={reasonOptional} />

        {blocking.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <ul className="list-disc pl-5">
              {blocking.map((b, i) => (
                <li key={i}>{b}</li>
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
          {reloadRequired && <button type="button" onClick={() => navigation.protect(async () => { navigation.resetBaseline(); await load(); })} className="btn-secondary">{t('form.reload_data')}</button>}
          <span className="ml-auto text-xs text-slate-400">{t('common.save_shortcut')}</span>
        </div>
      </form>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('encounter.history')}</h2>
        {history.length === 0 ? (
          <p className="text-xs text-slate-400">{t('encounter.no_history')}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {history.map((h, i) => (
              <li key={i} className="border-b border-slate-100 pb-1">
                <span className="font-mono">{labelOf(h.fieldKey)}</span> :{' '}
                <span className="text-slate-500">{t('history.old')}</span> <span className="line-through">{fmt(h.oldValue)}</span> →{' '}
                <span className="text-slate-500">{t('history.new')}</span> <strong>{fmt(h.newValue)}</strong>
                {h.reason && <span className="ml-2 italic text-slate-400">« {h.reason} »</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      </>
      )}
    </section>
  );
}
