import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Checkbox } from '../../components/Checkbox';
import { SkeletonList } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import type { IdentityMatch, PatientIdentityInfo, PatientListItem, PatientRepository } from '../../data/patients';
import { useBaseRepository, usePatientRepository } from '../../data/RepositoryProvider';
import type { BaseListing } from '../../data/bases';
import { canCorrectPatientIdentity } from '../../domain/patientIdentity';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { DatePickerInput } from '../../components/DatePickerInput';

export function EditPatientIdentity() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const patients = usePatientRepository();
  const { toast } = useToast();

  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [base, setBase] = useState<BaseListing | null>(null);
  const [identity, setIdentity] = useState<PatientIdentityInfo>({
    fullName: null,
    dateOfBirth: null,
    phone: null,
    address: null,
    externalIdentifier: null,
  });
  const [reason, setReason] = useState('');
  const [matches, setMatches] = useState<IdentityMatch[]>([]);
  const [ackDuplicate, setAckDuplicate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = useCallback(() => navigate(`/bases/${baseId}/patients/${patientId}`), [baseId, patientId, navigate]);
  const load = useCallback(async () => {
    if (!baseId || !patientId) return;
    setLoading(true);
    try {
      const [loadedPatient, loadedBase] = await Promise.all([
        patients.getPatient(baseId, patientId),
        bases.getBase(baseId),
      ]);
      setPatient(loadedPatient);
      setBase(loadedBase);
      if (loadedPatient?.identity) setIdentity(loadedPatient.identity);
      setError(canCorrectPatientIdentity(loadedBase, loadedPatient) ? null : t('patient.identity_edit_forbidden'));
    } catch (cause) {
      setError(errorMessage(cause, t('common.error')));
    } finally {
      setLoading(false);
    }
  }, [baseId, patientId, bases, patients, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setAckDuplicate(false);
    const fullName = identity.fullName?.trim() ?? '';
    const dateOfBirth = identity.dateOfBirth ?? '';
    const maybePatients = patients as Partial<PatientRepository>;
    if (!baseId || !patientId || !fullName || !dateOfBirth || !maybePatients.findIdentityMatches) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      maybePatients.findIdentityMatches!(baseId, fullName, dateOfBirth)
        .then((rows) => setMatches(rows.filter((match) => match.patientId !== patientId)))
        .catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(handle);
  }, [baseId, patientId, identity.fullName, identity.dateOfBirth, patients]);

  const setField = (field: keyof PatientIdentityInfo, value: string) => {
    setIdentity((current) => ({ ...current, [field]: value || null }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!baseId || !patientId || !patient || !canCorrectPatientIdentity(base, patient)) return;
    if (!reason.trim()) {
      setError(t('encounter.reason_required'));
      return;
    }
    if (patient.version == null) {
      setError(t('patient.identity_version_conflict'));
      return;
    }

    setBusy(true);
    try {
      const fullName = identity.fullName?.trim() ?? '';
      const dateOfBirth = identity.dateOfBirth ?? '';
      if (!ackDuplicate && fullName && dateOfBirth) {
        const maybePatients = patients as Partial<PatientRepository>;
        let live = matches;
        if (maybePatients.findIdentityMatches) {
          try {
            live = (await maybePatients.findIdentityMatches(baseId, fullName, dateOfBirth))
              .filter((match) => match.patientId !== patientId);
            setMatches(live);
          } catch { /* Avertissement best-effort, comme a la creation. */ }
        }
        if (live.length > 0) {
          setError(t('patient.duplicate_correction_confirm_required'));
          return;
        }
      }

      await patients.updatePatientIdentity(patientId, {
        fullName: identity.fullName?.trim() || null,
        dateOfBirth: identity.dateOfBirth || null,
        phone: identity.phone?.trim() || null,
        address: identity.address?.trim() || null,
        externalIdentifier: identity.externalIdentifier?.trim() || null,
      }, reason.trim(), patient.version);
      toast(t('toast.patient_saved'));
      back();
    } catch (cause) {
      const detail = cause as { message?: string };
      setError(/CONFLIT_VERSION/i.test(detail.message ?? '')
        ? t('patient.identity_version_conflict')
        : errorMessage(cause, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={6} label={t('common.loading')} />;
  const allowed = canCorrectPatientIdentity(base, patient);

  return (
    <section className="max-w-2xl space-y-5 sm:space-y-6">
      <div>
        <button type="button" onClick={back} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('patient.edit_identity_title')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {allowed && (
        <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-5">
          <fieldset className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
            <legend className="px-1 text-sm font-semibold text-amber-800">{t('patient.identity_section')}</legend>
            <p className="text-xs text-slate-500">{t('patient.identity_note')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-slate-700">{t('patient.full_name')}</span>
                <input className="input mt-1" value={identity.fullName ?? ''} onChange={(event) => setField('fullName', event.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">{t('patient.external_id')}</span>
                <input className="input mt-1" value={identity.externalIdentifier ?? ''} onChange={(event) => setField('externalIdentifier', event.target.value)} />
              </label>
              <div className="block text-sm">
                <span className="text-slate-700">{t('patient.dob')}</span>
                <div className="mt-1">
                  <DatePickerInput value={identity.dateOfBirth} ariaLabel={t('patient.dob')} onChange={(value) => setField('dateOfBirth', value ?? '')} />
                </div>
              </div>
              <label className="block text-sm">
                <span className="text-slate-700">{t('patient.phone')}</span>
                <input className="input mt-1" value={identity.phone ?? ''} onChange={(event) => setField('phone', event.target.value)} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.address')}</span>
              <input className="input mt-1" value={identity.address ?? ''} onChange={(event) => setField('address', event.target.value)} />
            </label>
          </fieldset>

          {matches.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">⚠️ {t('patient.duplicate_warning')}</p>
              <ul className="mt-2 space-y-1">
                {matches.map((match) => (
                  <li key={match.patientId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs">{match.code}</span>
                    <span>{match.fullName ?? '—'}{match.dateOfBirth ? ` · ${match.dateOfBirth}` : ''}</span>
                    <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${match.patientId}`)} className="font-medium text-teal-700 hover:underline">
                      {t('patient.duplicate_open')}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-amber-200 pt-2">
                <Checkbox
                  checked={ackDuplicate}
                  onChange={(event) => setAckDuplicate(event.target.checked)}
                  label={<span className="font-medium">{t('patient.duplicate_ack')}</span>}
                  containerClassName="w-full"
                />
              </div>
            </div>
          )}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">{t('encounter.reason')} <span className="text-red-500">*</span></span>
            <input className="input mt-1" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>

          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary">{t('patient.save_identity')}</button>
            <button type="button" onClick={back} className="btn-secondary">{t('common.cancel')}</button>
            <span className="ml-auto text-xs text-slate-400">{t('common.save_shortcut')}</span>
          </div>
        </form>
      )}
    </section>
  );
}
