import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField, ValidationRule } from '../../data/types';
import { validateValues, evaluateRules } from '../../domain/validation';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { useToast } from '../../components/Toast';
import { EncounterFields } from './EncounterFields';

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

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string>('draft');
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));
  const back = () => navigate(`/bases/${baseId}/patients/${patientId}`);

  const load = useCallback(async () => {
    if (!baseId || !patientId) return;
    setLoading(true);
    try {
      const [p, base] = await Promise.all([patients.getPatient(baseId, patientId), bases.getBase(baseId)]);
      if (p) { setValues(p.data); setStatus(p.validationStatus); setBaseVersion(p.version ?? null); }
      // §7.4 (audit v12, etendu) : un patient HISTORIQUE s'edite avec SA version de gabarit — memes
      // libelles/champs/regles que le serveur. La version courante de la base n'est qu'un repli.
      const versionId = p?.templateVersionId ?? base?.base.currentTemplateVersionId ?? null;
      if (versionId) {
        const version = await templates.getVersion(versionId);
        setFields(version.fields.filter((f) => f.scope === 'patient').sort((a, b) => a.displayOrder - b.displayOrder));
        setRules(version.rules);
      }
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, patientId, bases, templates, patients]);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId) return;
    const block = [
      // En brouillon : on n'exige PAS la completude (mais on valide les valeurs renseignees).
      ...validateValues(fields, values, status !== 'draft').map((fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`),
      ...evaluateRules(rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })), values).blocking,
    ];
    if (!reason.trim()) block.unshift(t('encounter.reason_required'));
    setBlocking(block);
    if (block.length > 0) return;

    setBusy(true);
    try {
      const saved = await patients.updatePatientData(patientId, values, status, reason.trim(), baseVersion);
      setBaseVersion(saved.version);
      toast(t('toast.patient_saved')); // UI-2
      back();
    } catch (e) {
      const detail = e as { message?: string };
      if (/CONFLIT_VERSION/i.test(detail?.message ?? '')) {
        setError('Ce patient a ete modifie par une autre personne. Vos changements ne sont pas enregistres : rechargez les donnees avant de recommencer.');
      } else {
        setError(msg(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <button onClick={back} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('admin.back')}</button>
        <h1 className="page-title mt-2">{t('patient.edit_permanent')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-5">
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('encounter.status')}</span>
          <select className="input mt-1 w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`encstatus.${s}`)}</option>
            ))}
          </select>
        </label>

        {fields.length === 0 ? (
          <p className="text-sm text-slate-500">{t('patient.no_permanent_fields')}</p>
        ) : (
          <EncounterFields fields={fields} values={values} onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))} />
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

        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} className="btn-primary">{t('encounter.save')}</button>
          <button type="button" onClick={back} className="btn-secondary">{t('common.cancel')}</button>
          {error?.includes('modifie par une autre personne') && <button type="button" onClick={() => void load()} className="btn-secondary">Recharger les donnees</button>}
          <span className="ml-auto text-xs text-slate-400">{t('common.save_shortcut')}</span>
        </div>
      </form>
    </section>
  );
}
