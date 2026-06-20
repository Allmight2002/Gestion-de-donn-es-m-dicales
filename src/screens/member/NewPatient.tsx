import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useCurationRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField } from '../../data/types';
import type { IdentityMatch } from '../../data/patients';
import { FieldInput } from './FieldInput';

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
  const [permanent, setPermanent] = useState<Record<string, unknown>>({});
  const [matches, setMatches] = useState<IdentityMatch[]>([]);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  // Detection de doublon (confort) : des que nom + date de naissance sont saisis, on cherche
  // un patient existant a la meme identite. Non bloquant ; on propose d'ouvrir sa fiche ou
  // d'ajouter une rencontre plutot que de recreer un dossier.
  useEffect(() => {
    const name = fullName.trim();
    if (!baseId || !name || !dob) { setMatches([]); return; }
    const handle = setTimeout(() => {
      patients.findIdentityMatches(baseId, name, dob).then(setMatches).catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(handle);
  }, [baseId, fullName, dob, patients]);

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
    // Mode "confier au staff" : nom complet + date de naissance OBLIGATOIRES.
    if (mode === 'submit' && (!fullName.trim() || !dob)) {
      setError(t('patient.identity_required'));
      return;
    }
    setBusy(true);
    try {
      const created = await patients.createPatient(baseId, {
        code: code.trim(),
        fullName: fullName.trim() || null,
        dateOfBirth: dob || null,
        phone: phone || null,
        address: address || null,
        externalIdentifier: externalId.trim() || null,
        permanentData: mode === 'submit' ? {} : permanent,
      });
      if (mode === 'submit') {
        // Confie le cas au pool (portee patient) -> page de depot des documents.
        const { taskId } = await curation.createSubmission(baseId, created.id, null, 'patient');
        navigate(`/curation/${taskId}`);
      } else {
        navigate(`/bases/${baseId}/patients/${created.id}`);
      }
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{mode === 'submit' ? t('patient.submit_title') : t('patient.new')}</h1>
      </div>

      {mode === 'submit' && <p className="rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm text-teal-800">{t('patient.submit_hint')}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="space-y-6">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">{t('patient.code')}</span>
          <input className="input mt-1" value={code} onChange={(e) => setCode(e.target.value)} required />
          <span className="text-xs text-slate-400">{t('patient.code_hint')}</span>
        </label>

        <fieldset className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
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
        </fieldset>

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
                  <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${m.patientId}/encounters/new`)} className="font-medium text-teal-700 hover:text-teal-800 hover:underline">{t('patient.duplicate_add_encounter')}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mode === 'manual' && (
          <fieldset className="card space-y-3 p-4">
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
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="btn-primary">
            {mode === 'submit' ? t('patient.submit_continue') : t('patient.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}`)} className="btn-secondary">
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}
