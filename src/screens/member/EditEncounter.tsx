import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { FieldChange } from '../../data/patients';
import type { TemplateField, ValidationRule } from '../../data/types';
import { validateValues, evaluateRules, isMissing, missingCodeOf } from '../../domain/validation';
import { EncounterFields } from './EncounterFields';

const STATUSES = ['draft', 'complete', 'curated'] as const;

// Edition / correction d'une rencontre (cahier §10, critere 12). Le motif est requis ;
// chaque champ modifie est journalise (field_change_log) cote serveur.
export function EditEncounter() {
  const { id: baseId, patientId, encounterId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string>('draft');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<FieldChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));
  const fmt = (v: unknown): string => {
    if (isMissing(v)) return t(`missing.${missingCodeOf(v)!}`);
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  };

  const load = useCallback(async () => {
    if (!baseId || !encounterId) return;
    setLoading(true);
    try {
      const [enc, base, hist] = await Promise.all([
        patients.getEncounter(encounterId),
        bases.getBase(baseId),
        patients.listFieldChanges('encounter', encounterId),
      ]);
      if (enc) {
        const { age_at_encounter: _drop, ...rest } = enc.data;
        void _drop;
        setValues(rest);
        setStatus(enc.validationStatus);
      }
      setHistory(hist);
      if (base?.base.currentTemplateVersionId) {
        const version = await templates.getVersion(base.base.currentTemplateVersionId);
        setFields(version.fields.filter((f) => f.scope === 'encounter').sort((a, b) => a.displayOrder - b.displayOrder));
        setRules(version.rules);
      }
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, encounterId, bases, templates, patients]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId || !encounterId) return;

    const block = [
      ...validateValues(fields, values).map((fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`),
      ...evaluateRules(rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })), values).blocking,
    ];
    if (!reason.trim()) block.unshift(t('encounter.reason_required'));
    setBlocking(block);
    if (block.length > 0) return;

    setBusy(true);
    try {
      await patients.updateEncounter(encounterId, values, status, reason.trim());
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
        <h1 className="page-title mt-2">{t('encounter.edit_title')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="space-y-5">
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('encounter.status')}</span>
          <select className="input mt-1 w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`encstatus.${s}`)}
              </option>
            ))}
          </select>
        </label>

        <EncounterFields fields={fields} values={values} onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))} />

        <label className="flex flex-col text-sm">
          <span className="font-medium text-slate-700">
            {t('encounter.reason')} <span className="text-red-500">*</span>
          </span>
          <input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>

        {blocking.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <ul className="list-disc pl-5">
              {blocking.map((b, i) => (
                <li key={i}>{b}</li>
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
    </section>
  );
}
