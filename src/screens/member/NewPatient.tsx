import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Send } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { isMissionAccount } from '../../auth/logic';
import { useBaseRepository, useCurationRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import { getTemplateFields } from '../../data/templates';
import type { TemplateField } from '../../data/types';
import type { IdentityMatch, PatientRepository } from '../../data/patients';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { useToast } from '../../components/Toast';
import { FieldInput } from './FieldInput';
import { SectionedFields } from './EncounterFields';
import { Checkbox } from '../../components/Checkbox';
import { SkeletonList } from '../../components/Skeleton';

// Ecran patient (cahier v3.0). Deux modes :
//  - 'manual'  : le medecin saisit lui-meme identite + donnees permanentes -> fiche patient.
//  - 'submit'  : le medecin saisit SEULEMENT l'identite (nom + date de naissance requis),
//                cree le patient, puis CONFIE le cas au staff (pool) -> page de depot des
//                documents deidentifies. Les donnees analytiques seront saisies par le staff.
export function NewPatient({ mode = 'manual' }: { mode?: 'manual' | 'submit' }) {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const curation = useCurationRepository();
  const submitAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  // Confier au pool de curation releve de la curation, fermee aux comptes de mission
  // (docs/spec-comptes-mission.md §4) : la base refuse aussi cette voie.
  const maySubmitToCuration = !isMissionAccount(profile);

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [isCrossSectional, setIsCrossSectional] = useState(false);
  const [canViewIdentity, setCanViewIdentity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [permanent, setPermanent] = useState<Record<string, unknown>>({});
  const [matches, setMatches] = useState<IdentityMatch[]>([]);
  const [ackDuplicate, setAckDuplicate] = useState(false); // B5 : confirmation « patient different »

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  // Detection de doublon (confort) : des que nom + date de naissance sont saisis, on cherche
  // un patient existant a la meme identite. Non bloquant ; on propose d'ouvrir sa fiche ou
  // d'ajouter une rencontre plutot que de recreer un dossier.
  useEffect(() => {
    const name = fullName.trim();
    setAckDuplicate(false); // toute nouvelle identite doit etre re-confirmee
    if (!canViewIdentity || !baseId || !name || !dob) { setMatches([]); return; }
    const handle = setTimeout(() => {
      patients.findIdentityMatches(baseId, name, dob).then(setMatches).catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(handle);
  }, [baseId, canViewIdentity, fullName, dob, patients]);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const maybePatients = patients as Partial<PatientRepository>;
      const countPatients = maybePatients.listPatientsPage
        ? maybePatients.listPatientsPage(baseId, 1, 0).then((r) => r.total)
        : patients.listPatients(baseId).then((rows) => rows.length);
      const [base, existing] = await Promise.all([
        bases.getBase(baseId),
        countPatients,
      ]);
      if (!base?.base.currentTemplateVersionId) {
        setError(t('common.error'));
        return;
      }
      const fields = await getTemplateFields(templates, base.base.currentTemplateVersionId);
      setIsCrossSectional((base.base.observationModel ?? 'longitudinal') === 'cross_sectional');
      setCanViewIdentity(base.role === 'owner' || base.permissions.canViewIdentity);
      setFields(fields.filter((f) => f.scope === 'patient').sort((a, b) => a.displayOrder - b.displayOrder));
      setCode((prev) => prev || `P-${String(existing + 1).padStart(4, '0')}`);
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, templates, patients]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !code.trim()) return;
    // Mode "confier au staff" : nom complet + date de naissance OBLIGATOIRES.
    if (mode === 'submit' && (!fullName.trim() || !dob)) {
      setError(t('patient.identity_required'));
      return;
    }
    const patientCurationInput = mode === 'submit' ? {
      code: code.trim(), fullName: fullName.trim(), dateOfBirth: dob, phone: phone || null,
      address: address || null, externalIdentifier: externalId.trim() || null,
    } : null;
    const submitFingerprint = patientCurationInput ? JSON.stringify(patientCurationInput) : null;
    const isSameOperationRetry = submitFingerprint !== null
      && submitAttempt.current?.fingerprint === submitFingerprint;
    setBusy(true);
    try {
      // B5 : verification FRAICHE au moment de l'enregistrement. La detection debouncee (400 ms)
      // peut ne pas avoir abouti si la saisie est rapide (copier-coller + Entree) -> sans cette
      // re-verification, la garde se contourne involontairement par la vitesse. Best-effort :
      // si la recherche echoue (reseau), on n'empeche pas la creation.
      if (canViewIdentity && !isSameOperationRetry && !ackDuplicate && fullName.trim() && dob) {
        let live = matches;
        try { live = await patients.findIdentityMatches(baseId, fullName.trim(), dob); setMatches(live); } catch { /* best-effort */ }
        if (live.length > 0) {
          const message = t('patient.duplicate_confirm_required');
          setError(message);
          toast(message, 'warning');
          return; // (finally libere busy)
        }
      }
      if (patientCurationInput && submitFingerprint) {
        // Une tentative ayant atteint la RPC conserve sa cle. Si sa reponse se perd, le retry
        // strictement identique doit atteindre la RPC idempotente sans etre bloque par le patient
        // que la premiere tentative a peut-etre deja cree. Toute modification produit une nouvelle
        // empreinte, une nouvelle cle et repasse par la detection normale des doublons.
        if (!isSameOperationRetry) {
          submitAttempt.current = { fingerprint: submitFingerprint, idempotencyKey: crypto.randomUUID() };
        }
        const created = await curation.createPatientCuration(baseId, {
          ...patientCurationInput,
          idempotencyKey: submitAttempt.current!.idempotencyKey,
        });
        toast(t('toast.patient_saved'));
        navigate(`/curation/${created.taskId}`);
        return;
      }
      const created = await patients.createPatient(baseId, {
        code: code.trim(),
        fullName: canViewIdentity ? (fullName.trim() || null) : null,
        dateOfBirth: canViewIdentity ? (dob || null) : null,
        phone: canViewIdentity ? (phone || null) : null,
        address: canViewIdentity ? (address || null) : null,
        externalIdentifier: canViewIdentity ? (externalId.trim() || null) : null,
        permanentData: permanent,
      });
      toast(t('toast.patient_saved')); // UI-2
      navigate(`/bases/${baseId}/patients/${created.id}`);
    } catch (e) {
      // QA : le doublon de CODE patient (contrainte unique) doit parler a l'utilisateur,
      // pas afficher un message SQL brut (« duplicate key value violates ... »).
      const err = e as { code?: string; message?: string };
      if (err?.code === '23505' || /duplicate key|uq_identity_base_code/i.test(err?.message ?? '')) {
        const message = t('patient.code_taken');
        setError(message);
        toast(message, 'warning');
      } else {
        setError(msg(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={7} label={t('common.loading')} />;

  return (
    <section className="max-w-2xl space-y-5 sm:space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="page-title">{mode === 'submit' ? t('patient.submit_title') : t('patient.new')}</h1>
          {/* La saisie s'ouvre directement : confier au staff n'est plus une page intercalaire,
              mais une sortie de secours a un clic depuis le formulaire. */}
          {mode === 'manual' && maySubmitToCuration && (
            <button
              type="button"
              onClick={() => navigate(`/bases/${baseId}/patients/new/submit`)}
              className="btn-secondary"
            >
              <Send size={16} aria-hidden /> {t('create.submit')}
            </button>
          )}
        </div>
      </div>

      {mode === 'submit' && <p className="rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm text-teal-800">{t('patient.submit_hint')}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-6">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">{t('patient.code')}</span>
          <input className="input mt-1" value={code} onChange={(e) => setCode(e.target.value)} required />
          <span className="text-xs text-slate-400">{t('patient.code_hint')}</span>
        </label>

        {canViewIdentity && <fieldset className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
          <legend className="px-1 text-sm font-semibold text-amber-800">{t('patient.identity_section')}</legend>
          <p className="text-xs text-slate-500">{t('patient.identity_note')}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.full_name')}{mode === 'submit' && <span className="text-red-500"> *</span>}</span>
              <input className="input mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} required={mode === 'submit'} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.external_id')}</span>
              <input className="input mt-1" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.dob')}{mode === 'submit' && <span className="text-red-500"> *</span>}</span>
              <input type="date" className="input mt-1" value={dob} onChange={(e) => setDob(e.target.value)} required={mode === 'submit'} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.phone')}</span>
              <input className="input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-700">{t('patient.address')}</span>
            <input className="input mt-1" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
        </fieldset>}

        {/* Doublon potentiel (meme nom + date de naissance) : on previent sans bloquer. */}
        {matches.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">⚠️ {t('patient.duplicate_warning')}</p>
            <ul className="mt-2 space-y-1">
              {matches.map((m) => (
                <li key={m.patientId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs">{m.code}</span>
                  <span>{m.fullName ?? '—'}{m.dateOfBirth ? ` · ${m.dateOfBirth}` : ''}</span>
                  <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${m.patientId}`)} className="font-medium text-teal-700 hover:text-teal-800 hover:underline">{t('patient.duplicate_open')}</button>
                  {!isCrossSectional && <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${m.patientId}/encounters/new`)} className="font-medium text-teal-700 hover:text-teal-800 hover:underline">{t('patient.duplicate_add_encounter')}</button>}
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-amber-200 pt-2">
              <Checkbox
                checked={ackDuplicate}
                onChange={(e) => setAckDuplicate(e.target.checked)}
                label={<span className="font-medium">{t('patient.duplicate_ack')}</span>}
                containerClassName="w-full"
              />
            </div>
          </div>
        )}

        {mode === 'manual' && (
          fields.length === 0 ? (
            <p className="text-sm text-slate-500">{t('patient.no_permanent_fields')}</p>
          ) : (
            <SectionedFields
              fields={fields}
              renderField={(field) => (
                <label className="flex flex-col text-sm">
                  <span className="text-slate-700">
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                    {field.unit && <span className="text-slate-400"> ({field.unit})</span>}
                  </span>
                  <div className="mt-1">
                    <FieldInput
                      field={field}
                      value={permanent[field.fieldKey]}
                      onChange={(value) => setPermanent((current) => ({ ...current, [field.fieldKey]: value }))}
                    />
                  </div>
                </label>
              )}
            />
          )
        )}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} className="btn-primary">
            {mode === 'submit' ? t('patient.submit_continue') : t('patient.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}`)} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <span className="ml-auto text-xs text-slate-400">{t('common.save_shortcut')}</span>
        </div>
      </form>
    </section>
  );
}
