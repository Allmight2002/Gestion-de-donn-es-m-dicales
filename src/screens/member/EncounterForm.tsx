import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField, ValidationRule } from '../../data/types';
import { validateValues, evaluateRules } from '../../domain/validation';
import { EncounterFields, fieldAppliesToType } from './EncounterFields';

const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;
const STATUSES = ['draft', 'complete', 'curated'] as const;

// Saisie dynamique d'une rencontre (cahier §8.5, §10) : champs par section, controles,
// valeurs manquantes codifiees, statut, age calcule (apercu), regles de coherence.
export function EncounterForm() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [encounterType, setEncounterType] = useState<string>('consultation');
  const [encounterDate, setEncounterDate] = useState('');
  const [status, setStatus] = useState<string>('draft');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [age, setAge] = useState<number | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
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
      setFields(version.fields.filter((f) => f.scope === 'encounter').sort((a, b) => a.displayOrder - b.displayOrder));
      setRules(version.rules);
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, templates]);

  useEffect(() => {
    void load();
  }, [load]);

  // Apercu de l'age : calcule par le systeme des que la date est posee (DOB jamais exposee).
  useEffect(() => {
    let on = true;
    if (!patientId || !encounterDate) {
      setAge(null);
      return;
    }
    patients
      .computeAge(patientId, encounterDate)
      .then((a) => on && setAge(a))
      .catch(() => on && setAge(null));
    return () => {
      on = false;
    };
  }, [patientId, encounterDate, patients]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId) return;

    // Seuls les champs APPLICABLES au type choisi sont valides / envoyes (ex: pas d'admission
    // pour une consultation). Les valeurs des champs masques ne sont pas soumises.
    const applicable = fields.filter((f) => fieldAppliesToType(f, encounterType));
    const applicableData = Object.fromEntries(
      Object.entries(values).filter(([k]) => applicable.some((f) => f.fieldKey === k)),
    );
    const fieldErrors = validateValues(applicable, applicableData).map((fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`);
    const ruleEval = evaluateRules(
      rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
      applicableData,
    );
    const block = [...fieldErrors, ...ruleEval.blocking];
    if (!encounterDate) block.unshift(t('encounter.date'));
    setBlocking(block);
    setWarnings(ruleEval.warnings);
    if (block.length > 0) return;

    setBusy(true);
    try {
      await patients.createEncounter(patientId, {
        encounterType, encounterDate, validationStatus: status, ageUnit: 'years', data: applicableData,
      });
      navigate(`/bases/${baseId}/patients/${patientId}`);
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
        <button onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('encounter.new')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
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
            <input type="date" className="input mt-1" value={encounterDate} onChange={(e) => setEncounterDate(e.target.value)} required />
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
          fields={fields.filter((f) => fieldAppliesToType(f, encounterType))}
          values={values}
          onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
        />

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

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="btn-primary">
            {t('encounter.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="btn-secondary">
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}
