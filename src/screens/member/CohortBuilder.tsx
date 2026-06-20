import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useCohortRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { CohortSummary, FilterCondition, FilterDefinition, FilterOp } from '../../data/cohorts';
import type { TemplateField } from '../../data/types';
import type { MessageKey } from '../../i18n/messages';

const OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between'];

// Constitution d'une cohorte (cahier §8.9, §9.1) : filtres combines en ET, apercu
// des effectifs, sauvegarde dynamique ou figee (snapshot patients + rencontres).
export function CohortBuilder() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const cohorts = useCohortRepository();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [list, setList] = useState<CohortSummary[]>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [draftField, setDraftField] = useState('');
  const [draftOp, setDraftOp] = useState<FilterOp>('eq');
  const [draftValue, setDraftValue] = useState('');
  const [draftValue2, setDraftValue2] = useState('');
  const [counts, setCounts] = useState<{ patientCount: number; encounterCount: number } | null>(null);
  const [name, setName] = useState('');
  const [cohortType, setCohortType] = useState<'dynamic' | 'snapshot'>('snapshot');
  const [validatedOnly, setValidatedOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));
  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;

  const load = useCallback(async () => {
    if (!baseId) return;
    try {
      const base = await bases.getBase(baseId);
      if (base?.base.currentTemplateVersionId) {
        const version = await templates.getVersion(base.base.currentTemplateVersionId);
        const sorted = version.fields.sort((a, b) => a.displayOrder - b.displayOrder);
        setFields(sorted);
        setDraftField((prev) => prev || sorted[0]?.fieldKey || '');
      }
      setList(await cohorts.listCohorts(baseId));
    } catch (e) {
      setError(msg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, templates, cohorts]);

  useEffect(() => {
    void load();
  }, [load]);

  function addCondition() {
    const f = fields.find((x) => x.fieldKey === draftField);
    if (!f || !draftValue.trim()) return;
    const cond: FilterCondition = {
      scope: f.scope,
      field: f.fieldKey,
      op: draftOp,
      value: draftOp === 'in' ? draftValue.split(',').map((s) => s.trim()).filter(Boolean) : draftValue.trim(),
      ...(draftOp === 'between' ? { value2: draftValue2.trim() } : {}),
    };
    setConditions((c) => [...c, cond]);
    setDraftValue('');
    setDraftValue2('');
    setCounts(null);
  }

  const buildFilter = (): FilterDefinition => ({ conditions });

  async function onPreview() {
    if (!baseId) return;
    setBusy(true);
    try {
      setCounts(await cohorts.preview(baseId, buildFilter(), validatedOnly));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!baseId || !name.trim()) return;
    setBusy(true);
    try {
      if (cohortType === 'snapshot') await cohorts.createSnapshot(baseId, name.trim(), buildFilter(), validatedOnly);
      else await cohorts.createDynamic(baseId, name.trim(), buildFilter(), validatedOnly);
      setName('');
      setConditions([]);
      setCounts(null);
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('cohort.build')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-slate-700">{t('cohort.conditions')}</h2>
        {conditions.length > 0 && (
          <ul className="space-y-1 text-sm">
            {conditions.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">
                  {labelOf(c.field)} {t(`op.${c.op}` as MessageKey)}{' '}
                  {Array.isArray(c.value) ? c.value.join(', ') : String(c.value)}
                  {c.op === 'between' ? ` … ${String(c.value2)}` : ''}
                </span>
                <button onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                  {t('cohort.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-600">
            {t('cohort.field')}
            <select className="input" value={draftField} onChange={(e) => setDraftField(e.target.value)}>
              {fields.map((f) => (
                <option key={f.id} value={f.fieldKey}>
                  {f.label} ({t(`scope.${f.scope}`)})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            {t('cohort.op')}
            <select className="input" value={draftOp} onChange={(e) => setDraftOp(e.target.value as FilterOp)}>
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {t(`op.${o}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            {t('cohort.value')}
            <input className="input" value={draftValue} onChange={(e) => setDraftValue(e.target.value)} />
          </label>
          {draftOp === 'between' && (
            <label className="flex flex-col text-xs text-slate-600">
              {t('cohort.value2')}
              <input className="input" value={draftValue2} onChange={(e) => setDraftValue2(e.target.value)} />
            </label>
          )}
          <button onClick={addCondition} className="btn-secondary">
            + {t('cohort.add_condition')}
          </button>
        </div>
        {draftOp === 'in' && <p className="text-xs text-slate-400">{t('cohort.in_hint')}</p>}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => void onPreview()} disabled={busy} className="btn-secondary">
          {t('cohort.preview')}
        </button>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={validatedOnly} onChange={(e) => { setValidatedOnly(e.target.checked); setCounts(null); }} />
          {t('cohort.validated_only')}
        </label>
        {counts && (
          <span className="text-sm">
            <strong>{counts.patientCount}</strong> {t('cohort.patients')} · <strong>{counts.encounterCount}</strong> {t('cohort.encounters')}
          </span>
        )}
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('cohort.name')}</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-slate-700">{t('cohort.type')}</span>
          <select className="input mt-1" value={cohortType} onChange={(e) => setCohortType(e.target.value as 'dynamic' | 'snapshot')}>
            <option value="snapshot">{t('cohort.snapshot')}</option>
            <option value="dynamic">{t('cohort.dynamic')}</option>
          </select>
        </label>
        <button onClick={() => void onSave()} disabled={busy || !name.trim()} className="btn-primary">
          {t('cohort.save')}
        </button>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('cohort.list_title')}</h2>
        {list.length === 0 ? (
          <div className="card border-dashed p-8 text-center text-slate-500">{t('cohort.no_cohorts')}</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {list.map((c) => (
              <li key={c.id} className="card flex items-center justify-between px-3 py-2">
                <span>{c.name}</span>
                <span className="flex items-center gap-3 text-xs text-slate-500">
                  {c.cohortType === 'snapshot' ? `${t('cohort.snapshot')} · ${c.memberCount} ${t('cohort.patients')}` : t('cohort.dynamic')}
                  {c.cohortType === 'snapshot' && (
                    <button onClick={() => navigate(`/bases/${baseId}/cohorts/${c.id}/export`)} className="text-teal-700 hover:underline">
                      {t('export.open')}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
