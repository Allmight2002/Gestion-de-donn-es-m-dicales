import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { FieldChange } from '../../data/patients';
import { displayFieldValue, type TemplateField, type ValidationRule } from '../../data/types';
import { enqueueEncounterUpdate, isOfflineEnabled, offlineCache, useOnline } from '../../data/offline';
import { validateValues, evaluateRules, isMissing, missingCodeOf } from '../../domain/validation';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { useToast } from '../../components/Toast';
import { EncounterFields } from './EncounterFields';
import { SkeletonList } from '../../components/Skeleton';

const STATUSES = ['draft', 'complete', 'curated'] as const;

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

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string>('draft');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<FieldChange[]>([]);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));
  const fmt = (v: unknown): string => {
    if (isMissing(v)) return t(`missing.${missingCodeOf(v)!}`);
    return displayFieldValue(v, '—');
  };

  const load = useCallback(async () => {
    if (!baseId || !encounterId) return;
    setLoading(true);
    try {
      if (!online) {
        // HORS-LIGNE : la rencontre et les champs viennent de l'instantane local.
        const snap = await offlineCache.get(baseId);
        const enc = snap?.patients.flatMap((p) => p.encounters).find((e) => e.id === encounterId) ?? null;
        if (enc) {
          const { age_at_encounter: _drop, ...rest } = enc.data;
          void _drop;
          setValues(rest);
          setStatus(enc.validationStatus);
          setBaseUpdatedAt(enc.updatedAt ?? null); // jeton optimiste pour la synchro
        }
        setHistory([]);
        // §7.4/§7.5 : dictionnaire de LA VERSION DE LA RENCONTRE (fieldsByVersion), pas celui de la
        // version courante de la base ; repli sur `fields` (instantane ancien, sans multi-versions).
        const dict = (enc?.templateVersionId && snap?.fieldsByVersion?.[enc.templateVersionId]) || snap?.fields || [];
        const encFields = dict
          .filter((f) => f.scope === 'encounter')
          .sort((a, b) => a.displayOrder - b.displayOrder)
          // §7.5 : un instantane ANTERIEUR (dictionnaire minimal, sans `section`) doit rester
          // editable -> section par defaut, sinon EncounterFields (groupe par section) n'affiche rien.
          .map((f) => ({ ...f, section: f.section ?? 'clinique' }));
        setFields(encFields as unknown as TemplateField[]);
        const offlineRules = (enc?.templateVersionId && snap?.rulesByVersion?.[enc.templateVersionId]) || [];
        setRules(offlineRules as unknown as ValidationRule[]);
        setError(null);
        return;
      }

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
        setBaseUpdatedAt(enc.updatedAt ?? null);
      }
      setHistory(hist);
      // §7.4 : une rencontre HISTORIQUE s'edite avec SA version de gabarit (libelles, champs et
      // regles de l'epoque = memes controles que le serveur). La version courante de la base ne
      // sert que de repli (et a la CREATION d'une nouvelle rencontre).
      const versionId = enc?.templateVersionId ?? base?.base.currentTemplateVersionId ?? null;
      if (versionId) {
        const version = await templates.getVersion(versionId);
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
  }, [baseId, encounterId, online, bases, templates, patients]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId || !encounterId) return;

    const requireComplete = status === 'curated';
    const ruleEval = evaluateRules(
      rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
      values,
    );
    const block = [
      ...validateValues(fields, values, requireComplete).map((fe) => `${labelOf(fe.fieldKey)} : ${fe.message}`),
      ...(requireComplete ? ruleEval.blocking : []),
    ];
    if (!reason.trim()) block.unshift(t('encounter.reason_required'));
    setBlocking(block);
    if (block.length > 0) return;

    setBusy(true);
    try {
      if (!online) {
        if (!isOfflineEnabled()) throw new Error('Mode hors-ligne desactive par la politique de securite');
        // HORS-LIGNE : on met la correction en file d'attente (synchro au retour du reseau).
        await enqueueEncounterUpdate({
          baseId, patientId, encounterId,
          data: values, reason: reason.trim(), validationStatus: status, baseUpdatedAt,
        });
      } else {
        // EN LIGNE : RPC validee, avec verrou optimiste (refuse si la rencontre a change).
        await patients.updateEncounter(encounterId, values, status, reason.trim(), baseUpdatedAt);
      }
      toast(t(online ? 'toast.encounter_saved' : 'toast.encounter_queued')); // UI-2
      navigate(`/bases/${baseId}/patients/${patientId}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={6} label={t('common.loading')} />;

  return (
    <section className="max-w-2xl space-y-5 sm:space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('encounter.edit_title')}</h1>
      </div>

      {!online && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {t('offline.edit_queued_hint')}
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-5">
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

        <EncounterFields
          fields={fields}
          values={values}
          onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
          onRemove={(key) => setValues((current) => {
            const { [key]: _removed, ...remaining } = current;
            return remaining;
          })}
        />

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

        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} className="btn-primary">
            {t('encounter.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="btn-secondary">
            {t('common.cancel')}
          </button>
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
    </section>
  );
}
