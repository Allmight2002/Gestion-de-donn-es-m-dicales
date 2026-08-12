import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Download,
  Filter,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Users,
  X,
} from 'lucide-react';
import { errorMessage } from '../../lib/errorMessage';
import { formatDate } from '../../lib/formatDate';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useCohortRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { CohortSummary, FilterCondition, FilterDefinition, FilterOp } from '../../data/cohorts';
import { getTemplateFields } from '../../data/templates';
import type { TemplateField } from '../../data/types';
import type { MessageKey } from '../../i18n/messages';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { WorkflowSteps } from '../../components/WorkflowSteps';
import { Checkbox } from '../../components/Checkbox';
import { ConfirmDialog } from '../../components/ConfirmDialog';

const ALL_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between'];
const SIMPLE_OPS: FilterOp[] = ['eq', 'neq'];
const TEXT_OPS: FilterOp[] = ['eq', 'neq', 'in'];

interface FreezeCandidate {
  cohort: CohortSummary;
  name: string;
  unvalidatedCount: number;
}

interface SnapshotWarning {
  name: string;
  filter: FilterDefinition;
  validatedOnly: boolean;
  unvalidatedCount: number;
}

function operatorsFor(field: TemplateField | undefined): FilterOp[] {
  if (!field) return SIMPLE_OPS;
  if (['number', 'integer', 'date', 'datetime'].includes(field.type)) return ALL_OPS;
  if (field.type === 'select' || field.type === 'boolean') return SIMPLE_OPS;
  return TEXT_OPS;
}

export function CohortBuilder() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const cohorts = useCohortRepository();

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [list, setList] = useState<CohortSummary[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
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
  const [liveCounts, setLiveCounts] = useState<Record<string, { patientCount: number; encounterCount: number }>>({});
  const [freezeCandidate, setFreezeCandidate] = useState<FreezeCandidate | null>(null);
  const [snapshotWarning, setSnapshotWarning] = useState<SnapshotWarning | null>(null);

  const msg = (value: unknown) => errorMessage(value, t('common.error'));
  const selectedField = fields.find((field) => field.fieldKey === draftField);
  const availableOps = operatorsFor(selectedField);
  const labelOf = (key: string) => fields.find((field) => field.fieldKey === key)?.label ?? key;
  const currentStep = counts ? 3 : conditions.length > 0 ? 2 : 1;

  const load = useCallback(async () => {
    if (!baseId) return;
    try {
      const base = await bases.getBase(baseId);
      if (base?.base.currentTemplateVersionId) {
        const sorted = (await getTemplateFields(templates, base.base.currentTemplateVersionId))
          .sort((a, b) => a.displayOrder - b.displayOrder);
        setFields(sorted);
        setDraftField((previous) => previous || sorted[0]?.fieldKey || '');
      }
      const existing = await cohorts.listCohorts(baseId);
      setList(existing);
      const dynamicCounts = await Promise.all(existing
        .filter((cohort) => cohort.cohortType === 'dynamic')
        .map(async (cohort) => [cohort.id, await cohorts.preview(baseId, cohort.filterDefinition, cohort.validatedOnly)] as const));
      setLiveCounts(Object.fromEntries(dynamicCounts));
      if (existing.length === 0) setBuilderOpen(true);
    } catch (value) {
      setError(msg(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, templates, cohorts]);

  useEffect(() => { void load(); }, [load]);

  function resetBuilder() {
    setConditions([]);
    setDraftValue('');
    setDraftValue2('');
    setCounts(null);
    setName('');
    setCohortType('snapshot');
    setValidatedOnly(true);
    setError(null);
  }

  function openBuilder() {
    resetBuilder();
    setBuilderOpen(true);
  }

  function closeBuilder() {
    resetBuilder();
    setBuilderOpen(false);
  }

  function onFieldChange(fieldKey: string) {
    const field = fields.find((item) => item.fieldKey === fieldKey);
    setDraftField(fieldKey);
    setDraftOp(operatorsFor(field)[0]);
    setDraftValue('');
    setDraftValue2('');
  }

  function addCondition() {
    const field = fields.find((item) => item.fieldKey === draftField);
    if (!field || !draftValue.trim() || (draftOp === 'between' && !draftValue2.trim())) return;

    const toCheck = draftOp === 'in'
      ? draftValue.split(',').map((item) => item.trim()).filter(Boolean)
      : [draftValue.trim(), ...(draftOp === 'between' ? [draftValue2.trim()] : [])].filter(Boolean);
    if (field.type === 'integer' && toCheck.some((value) => !/^-?\d+$/.test(value))) {
      setError(t('cohort.value_int').replace('{field}', field.label));
      return;
    }
    if (field.type === 'number' && toCheck.some((value) => !/^-?\d+(\.\d+)?$/.test(value.replace(',', '.')))) {
      setError(t('cohort.value_num').replace('{field}', field.label));
      return;
    }
    if ((field.type === 'date' || field.type === 'datetime') && toCheck.some((value) => !/^\d{4}-\d{2}-\d{2}/.test(value))) {
      setError(t('cohort.value_date').replace('{field}', field.label));
      return;
    }

    const normalize = (value: string) => (field.type === 'number' ? value.replace(',', '.') : value);
    const condition: FilterCondition = {
      scope: field.scope,
      field: field.fieldKey,
      op: draftOp,
      value: draftOp === 'in'
        ? draftValue.split(',').map((item) => item.trim()).filter(Boolean).map(normalize)
        : normalize(draftValue.trim()),
      ...(draftOp === 'between' ? { value2: normalize(draftValue2.trim()) } : {}),
    };
    setConditions((current) => [...current, condition]);
    setDraftValue('');
    setDraftValue2('');
    setCounts(null);
    setError(null);
  }

  function removeCondition(index: number) {
    setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setCounts(null);
  }

  const buildFilter = (): FilterDefinition => ({ conditions });

  async function countUnvalidated(filter: FilterDefinition): Promise<number> {
    if (!baseId) return 0;
    const [all, validated] = await Promise.all([
      cohorts.preview(baseId, filter, false),
      cohorts.preview(baseId, filter, true),
    ]);
    return Math.max(0, all.patientCount - validated.patientCount);
  }

  async function createSnapshot(nameToSave: string, filter: FilterDefinition, snapshotValidatedOnly: boolean, closeBuilderAfterSave: boolean) {
    if (!baseId) return;
    setBusy(true);
    try {
      await cohorts.createSnapshot(baseId, nameToSave, filter, snapshotValidatedOnly);
      setSnapshotWarning(null);
      setFreezeCandidate(null);
      if (closeBuilderAfterSave) {
        resetBuilder();
        setBuilderOpen(false);
      }
      await load();
    } catch (value) {
      setError(msg(value));
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    if (!baseId) return;
    setBusy(true);
    try {
      setCounts(await cohorts.preview(baseId, buildFilter(), validatedOnly));
      setError(null);
    } catch (value) {
      setError(msg(value));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!baseId || !name.trim()) return;
    if (!counts) {
      setError(t('cohort.must_preview'));
      return;
    }
    setBusy(true);
    try {
      if (cohortType === 'snapshot') {
        const filter = buildFilter();
        if (!validatedOnly) {
          const unvalidatedCount = await countUnvalidated(filter);
          if (unvalidatedCount > 0) {
            setSnapshotWarning({ name: name.trim(), filter, validatedOnly, unvalidatedCount });
            return;
          }
        }
        await cohorts.createSnapshot(baseId, name.trim(), filter, validatedOnly);
      } else await cohorts.createDynamic(baseId, name.trim(), buildFilter(), validatedOnly);
      resetBuilder();
      setBuilderOpen(false);
      await load();
    } catch (value) {
      setError(msg(value));
    } finally {
      setBusy(false);
    }
  }

  async function startFreeze(cohort: CohortSummary) {
    if (!baseId) return;
    setBusy(true);
    try {
      const unvalidatedCount = cohort.validatedOnly ? 0 : await countUnvalidated(cohort.filterDefinition);
      setFreezeCandidate({
        cohort,
        name: t('cohort.freeze_name')
          .replace('{name}', cohort.name)
          .replace('{date}', formatDate(new Date().toISOString(), lang)),
        unvalidatedCount,
      });
      setError(null);
    } catch (value) {
      setError(msg(value));
    } finally {
      setBusy(false);
    }
  }

  function renderDraftValue(label: string, value: string, onChange: (value: string) => void) {
    if (draftOp === 'in') {
      return <input className="input" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
    }
    if (selectedField?.type === 'select' && Array.isArray(selectedField.allowedValues)) {
      return (
        <select className="input" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">—</option>
          {selectedField.allowedValues.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
        </select>
      );
    }
    if (selectedField?.type === 'boolean') {
      return (
        <select className="input" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">—</option>
          <option value="true">{t('common.yes')}</option>
          <option value="false">{t('common.no')}</option>
        </select>
      );
    }
    const type = selectedField?.type === 'date'
      ? 'date'
      : selectedField?.type === 'datetime'
        ? 'datetime-local'
        : 'text';
    return (
      <input
        type={type}
        inputMode={selectedField?.type === 'number' ? 'decimal' : selectedField?.type === 'integer' ? 'numeric' : undefined}
        className="input"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <section className="space-y-5 sm:space-y-6">
      <PageHeader
        title={t('cohort.build')}
        description={t('cohort.subtitle')}
        actions={builderOpen ? (
          list.length > 0 && <button type="button" onClick={closeBuilder} className="btn-secondary"><X size={16} aria-hidden /> {t('common.cancel')}</button>
        ) : (
          <button type="button" onClick={openBuilder} className="btn-primary"><Plus size={16} aria-hidden /> {t('cohort.new')}</button>
        )}
      />

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {builderOpen && (
        <div className="space-y-4">
          <WorkflowSteps
            current={currentStep}
            steps={[
              { label: t('cohort.step_population'), description: t('cohort.step_population_hint') },
              { label: t('cohort.step_preview'), description: t('cohort.step_preview_hint') },
              { label: t('cohort.step_save'), description: t('cohort.step_save_hint') },
            ]}
          />

          <SectionCard title={t('cohort.conditions')} description={t('cohort.conditions_hint')} icon={Filter}>
            <div className="space-y-5">
              <div className="surface-muted p-2">
                <Checkbox
                  checked={validatedOnly}
                  onChange={(event) => { setValidatedOnly(event.target.checked); setCounts(null); }}
                  label={(
                    <span className="flex items-center gap-2 font-semibold text-slate-800">
                      <ShieldCheck size={16} className="text-teal-700" aria-hidden /> {t('cohort.validated_only')}
                    </span>
                  )}
                  description={t('cohort.validated_hint')}
                  containerClassName="w-full items-start"
                />
              </div>

              {conditions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">{t('cohort.no_conditions')}</p>
              ) : (
                <ol className="space-y-2">
                  {conditions.map((condition, index) => (
                    <li key={`${condition.field}-${index}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-50 text-xs font-semibold text-teal-700">{index + 1}</span>
                      <span className="font-medium text-slate-800">{labelOf(condition.field)}</span>
                      <span className="text-slate-500">{t(`op.${condition.op}` as MessageKey)}</span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        {Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value)}
                        {condition.op === 'between' ? ` – ${String(condition.value2)}` : ''}
                      </span>
                      <button type="button" onClick={() => removeCondition(index)} className="ml-auto text-xs font-medium text-red-600 hover:underline">
                        {t('cohort.remove')}
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              <div className="surface-muted grid gap-3 p-4 md:grid-cols-12 md:items-end">
                <label className="form-label md:col-span-4">
                  {t('cohort.field')}
                  <select className="input" value={draftField} onChange={(event) => onFieldChange(event.target.value)}>
                    {fields.map((field) => (
                      <option key={field.id} value={field.fieldKey}>{field.label} · {t(`scope.${field.scope}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label md:col-span-3">
                  {t('cohort.op')}
                  <select className="input" value={draftOp} onChange={(event) => { setDraftOp(event.target.value as FilterOp); setDraftValue2(''); }}>
                    {availableOps.map((operator) => <option key={operator} value={operator}>{t(`op.${operator}` as MessageKey)}</option>)}
                  </select>
                </label>
                <label className={`form-label ${draftOp === 'between' ? 'md:col-span-2' : 'md:col-span-3'}`}>
                  {t('cohort.value')}
                  {renderDraftValue(t('cohort.value'), draftValue, setDraftValue)}
                </label>
                {draftOp === 'between' && (
                  <label className="form-label md:col-span-2">
                    {t('cohort.value2')}
                    {renderDraftValue(t('cohort.value2'), draftValue2, setDraftValue2)}
                  </label>
                )}
                <button
                  type="button"
                  onClick={addCondition}
                  disabled={!draftValue.trim() || (draftOp === 'between' && !draftValue2.trim())}
                  className="btn-secondary md:col-span-2"
                >
                  <Plus size={16} aria-hidden /> {t('cohort.add_condition')}
                </button>
              </div>
              {draftOp === 'in' && <p className="helper-text">{t('cohort.in_hint')}</p>}
            </div>
          </SectionCard>

          <SectionCard
            title={t('cohort.preview_title')}
            description={counts ? t('cohort.preview_hint') : t('cohort.preview_empty')}
            icon={Users}
            actions={(
              <button type="button" onClick={() => void onPreview()} disabled={busy} className={counts ? 'btn-secondary' : 'btn-primary'}>
                <RefreshCw size={16} aria-hidden /> {t('cohort.preview')}
              </button>
            )}
          >
            {counts ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-teal-50 p-4 ring-1 ring-inset ring-teal-600/15">
                  <p className="text-sm font-medium text-teal-800">{t('cohort.patients')}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-teal-900">{counts.patientCount}</p>
                </div>
                <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-inset ring-sky-600/15">
                  <p className="text-sm font-medium text-sky-800">{t('cohort.encounters')}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-sky-900">{counts.encounterCount}</p>
                </div>
              </div>
            ) : (
              <div className="h-2 rounded-full bg-slate-100" />
            )}
          </SectionCard>

          {counts && (
            <SectionCard title={t('cohort.step_save')} description={t('cohort.type')} icon={Snowflake}>
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={`cursor-pointer rounded-xl border p-4 transition ${cohortType === 'snapshot' ? 'border-teal-400 bg-teal-50/70 ring-2 ring-teal-500/15' : 'border-slate-200 hover:border-slate-300'}`}>
                    <span className="flex items-start gap-3">
                      <input type="radio" name="cohort-type" value="snapshot" checked={cohortType === 'snapshot'} onChange={() => setCohortType('snapshot')} className="mt-1" />
                      <span>
                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                          <Snowflake size={16} className="text-teal-700" aria-hidden /> {t('cohort.snapshot')}
                          <span className="badge">{t('cohort.recommended')}</span>
                        </span>
                        <span className="mt-1.5 block text-sm leading-5 text-slate-500">{t('cohort.snapshot_hint')}</span>
                      </span>
                    </span>
                  </label>
                  <label className={`cursor-pointer rounded-xl border p-4 transition ${cohortType === 'dynamic' ? 'border-teal-400 bg-teal-50/70 ring-2 ring-teal-500/15' : 'border-slate-200 hover:border-slate-300'}`}>
                    <span className="flex items-start gap-3">
                      <input type="radio" name="cohort-type" value="dynamic" checked={cohortType === 'dynamic'} onChange={() => setCohortType('dynamic')} className="mt-1" />
                      <span>
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <RefreshCw size={16} className="text-teal-700" aria-hidden /> {t('cohort.dynamic')}
                        </span>
                        <span className="mt-1.5 block text-sm leading-5 text-slate-500">{t('cohort.dynamic_hint')}</span>
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-end">
                  <label className="form-label flex-1">
                    {t('cohort.name')}
                    <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  <button type="button" onClick={() => void onSave()} disabled={busy || !name.trim()} className="btn-primary">
                    {t('cohort.save')}
                  </button>
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <h2 className="section-title">{t('cohort.list_title')}</h2>
          <p className="section-description">{t('cohort.list_hint')}</p>
        </div>
        {list.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('cohort.no_cohorts')}
            description={t('cohort.no_cohorts_hint')}
            action={!builderOpen ? <button type="button" className="btn-primary" onClick={openBuilder}><Plus size={16} aria-hidden /> {t('cohort.new')}</button> : undefined}
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((cohort) => (
              <li key={cohort.id} className="card flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900">{cohort.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {cohort.cohortType === 'snapshot'
                        ? t('cohort.created_on').replace('{date}', cohort.snapshotAt ? formatDate(cohort.snapshotAt, lang) : '—')
                        : t('cohort.auto_updated')}
                    </p>
                  </div>
                  <span className="badge">
                    {cohort.cohortType === 'snapshot' ? t('cohort.snapshot') : t('cohort.dynamic')}
                  </span>
                </div>
                {cohort.cohortType === 'snapshot' && (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <span className="text-sm text-slate-600"><strong className="text-slate-900">{cohort.memberCount}</strong> {t('cohort.patients')}</span>
                    <button onClick={() => navigate(`/bases/${baseId}/cohorts/${cohort.id}/export`)} className="btn-secondary">
                      <Download size={16} aria-hidden /> {t('export.open')}
                    </button>
                  </div>
                )}
                {cohort.cohortType === 'dynamic' && (
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <p className="text-sm text-slate-600">
                      {liveCounts[cohort.id] ? (
                        <><strong className="text-slate-900">{liveCounts[cohort.id].patientCount}</strong> {t('cohort.patients')} · <strong className="text-slate-900">{liveCounts[cohort.id].encounterCount}</strong> {t('cohort.encounters')}</>
                      ) : t('cohort.live_count_loading')}
                    </p>
                    <p className="text-sm text-slate-500">{t('cohort.dynamic_export_hint')}</p>
                    <button type="button" onClick={() => void startFreeze(cohort)} disabled={busy} className="btn-secondary">
                      <Snowflake size={16} aria-hidden /> {t('cohort.freeze_now')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={freezeCandidate !== null}
        title={t('cohort.freeze_title')}
        body={freezeCandidate?.unvalidatedCount
          ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('cohort.unvalidated_warning').replace('{n}', String(freezeCandidate.unvalidatedCount))}</p>
          : undefined}
        confirmLabel={t('cohort.freeze_confirm')}
        confirmDisabled={!freezeCandidate?.name.trim()}
        busy={busy}
        onCancel={() => setFreezeCandidate(null)}
        onConfirm={() => {
          if (freezeCandidate) void createSnapshot(freezeCandidate.name.trim(), freezeCandidate.cohort.filterDefinition, freezeCandidate.cohort.validatedOnly, false);
        }}
      >
        <label className="form-label">
          {t('cohort.freeze_name_label')}
          <input
            className="input"
            value={freezeCandidate?.name ?? ''}
            onChange={(event) => setFreezeCandidate((current) => current ? { ...current, name: event.target.value } : current)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={snapshotWarning !== null}
        title={t('cohort.unvalidated_title')}
        body={snapshotWarning ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('cohort.unvalidated_warning').replace('{n}', String(snapshotWarning.unvalidatedCount))}</p> : undefined}
        confirmLabel={t('cohort.unvalidated_confirm')}
        busy={busy}
        onCancel={() => setSnapshotWarning(null)}
        onConfirm={() => {
          if (snapshotWarning) void createSnapshot(snapshotWarning.name, snapshotWarning.filter, snapshotWarning.validatedOnly, true);
        }}
      />
    </section>
  );
}
