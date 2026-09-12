import { errorMessage, isRefreshRequiredError } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { isMissionAccount } from '../../auth/logic';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { DiagnosisContext, TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { validateValues, evaluateRules, hiddenFieldKeys, withoutHiddenValues } from '../../domain/validation';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { useToast } from '../../components/Toast';
import { EncounterFields, HiddenValuesConfirmation, HiddenValuesNotice } from './EncounterFields';
import { SkeletonList } from '../../components/Skeleton';
import { useVisibilityWithdrawal } from './useVisibilityWithdrawal';
import { DiagnosisCoverageNotice, useDiagnosisCoverage } from './DiagnosisCoverageNotice';
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
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [commonLayout, setCommonLayout] = useState<TemplateCommonLayout | undefined>(undefined);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string>('draft');
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  // L55/L56 : contrat diagnostique de LA VERSION du dossier (absent = collecte historique).
  const [diagnosisVersionId, setDiagnosisVersionId] = useState<string | null>(null);
  const [diagnosisContext, setDiagnosisContext] = useState<DiagnosisContext[] | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));
  const back = () => navigate(`/bases/${baseId}/patients/${patientId}`);
  const { track: trackVisibilityWithdrawal } = useVisibilityWithdrawal(rules, fields, sections);
  const navigation = useDirtyForm({ values, status, reason }, !loading && diagnosisVersionId !== null, `${baseId}:${patientId}`);
  const work = useWorkDraft({
    context: baseId && patientId && diagnosisVersionId && baseVersion !== null ? {
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
      const [p, base] = await Promise.all([patients.getPatient(baseId, patientId), bases.getBase(baseId)]);
      if (p) { setValues(p.data); setStatus(p.validationStatus); setInitialStatus(p.validationStatus); setBaseVersion(p.version ?? null); }
      // §7.4 (audit v12, etendu) : un patient HISTORIQUE s'edite avec SA version de gabarit — memes
      // libelles/champs/regles que le serveur. La version courante de la base n'est qu'un repli.
      const versionId = p?.templateVersionId ?? base?.base.currentTemplateVersionId ?? null;
      if (versionId) {
        const version = await templates.getVersion(versionId);
        setFields(version.fields.filter((f) => f.scope === 'patient').sort((a, b) => a.displayOrder - b.displayOrder));
        setRules(version.rules);
        setSections(version.sections ?? []);
        setCommonLayout(version.version.commonLayout);
        setDiagnosisVersionId(version.version.id);
        setDiagnosisContext(version.version.diagnosisContext);
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

  const coverage = useDiagnosisCoverage(diagnosisVersionId, diagnosisContext, 'patient', submittedData, fields, rules, sections);

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
      ...validateValues(fields, submittedData, isMissionAccount(profile) || status !== 'draft', hidden)
        .map((fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`),
      ...(isMissionAccount(profile) || status !== 'draft' ? evaluateRules(
        rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
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
      if (work.enabled) await work.commit();
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

        {fields.length === 0 ? (
          <p className="text-sm text-slate-500">{t('patient.no_permanent_fields')}</p>
        ) : (
          <EncounterFields
            fields={fields}
            values={values}
            hiddenKeys={hidden}
            sections={sections}
            commonLayout={commonLayout}
            rules={rules}
            requireComplete={isMissionAccount(profile) || status !== 'draft'}
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
