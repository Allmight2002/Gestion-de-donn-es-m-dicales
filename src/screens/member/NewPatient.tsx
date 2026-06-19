import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField } from '../../data/types';
import { FieldInput } from './FieldInput';

const AUTH_STATUSES = ['not_requested', 'granted', 'refused', 'withdrawn', 'unknown'] as const;

// Ecran "Nouveau patient" (cahier §8.5) : identite (zone restreinte) + code unique
// + donnees PERMANENTES (champs scope=patient du gabarit courant). Les rencontres,
// l'age calcule et les controles complets arrivent a l'etape 7.
export function NewPatient() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [authStatus, setAuthStatus] = useState<string>('not_requested');
  const [authDate, setAuthDate] = useState('');
  const [permanent, setPermanent] = useState<Record<string, unknown>>({});

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const base = await bases.getBase(baseId);
      if (!base?.base.currentTemplateVersionId) {
        setError(t('common.error'));
        return;
      }
      const version = await templates.getVersion(base.base.currentTemplateVersionId);
      setFields(version.fields.filter((f) => f.scope === 'patient').sort((a, b) => a.displayOrder - b.displayOrder));
      const existing = await patients.listPatients(baseId);
      setCode((prev) => prev || `P-${String(existing.length + 1).padStart(4, '0')}`);
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
    setBusy(true);
    try {
      await patients.createPatient(baseId, {
        code: code.trim(),
        fullName: fullName.trim() || null,
        dateOfBirth: dob || null,
        phone: phone || null,
        address: address || null,
        externalIdentifier: externalId.trim() || null,
        authStatus,
        authDate: authDate || null,
        permanentData: permanent,
      });
      navigate(`/bases/${baseId}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm text-teal-700 hover:underline">
          ← {t('admin.back')}
        </button>
        <h1 className="text-2xl font-semibold">{t('patient.new')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="space-y-6">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">{t('patient.code')}</span>
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={code} onChange={(e) => setCode(e.target.value)} required />
          <span className="text-xs text-slate-400">{t('patient.code_hint')}</span>
        </label>

        <fieldset className="space-y-3 rounded border border-amber-200 bg-amber-50/40 p-4">
          <legend className="px-1 text-sm font-semibold text-amber-800">{t('patient.identity_section')}</legend>
          <p className="text-xs text-slate-500">{t('patient.identity_note')}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.full_name')}</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.external_id')}</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.dob')}</span>
              <input type="date" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={dob} onChange={(e) => setDob(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.phone')}</span>
              <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-700">{t('patient.address')}</span>
            <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.auth_status')}</span>
              <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={authStatus} onChange={(e) => setAuthStatus(e.target.value)}>
                {AUTH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`authstatus.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">{t('patient.auth_date')}</span>
              <input type="date" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={authDate} onChange={(e) => setAuthDate(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">{t('patient.permanent_section')}</legend>
          {fields.length === 0 && <p className="text-xs text-slate-400">—</p>}
          {fields.map((f) => (
            <label key={f.id} className="flex flex-col text-sm">
              <span className="text-slate-700">
                {f.label}
                {f.required && <span className="text-red-500"> *</span>}
                {f.unit && <span className="text-slate-400"> ({f.unit})</span>}
              </span>
              <div className="mt-1">
                <FieldInput field={f} value={permanent[f.fieldKey]} onChange={(v) => setPermanent((p) => ({ ...p, [f.fieldKey]: v }))} />
              </div>
            </label>
          ))}
        </fieldset>

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60">
            {t('patient.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}`)} className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100">
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}
