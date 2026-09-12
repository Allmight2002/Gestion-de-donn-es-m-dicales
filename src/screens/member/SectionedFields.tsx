import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { groupFieldsBySection, sectionLabel } from '../../domain/templateSections';
import { calculateFormProgress } from '../../domain/formProgress';
import { useI18n } from '../../i18n/useI18n';
import { ValidationSummary } from '../../components/ValidationSummary';
import { findProposalField, isProposalSource } from '../../domain/proposalField';

const NO_VALUES: Record<string, unknown> = {};
const NO_RULES: readonly ValidationRule[] = [];
const NO_HIDDEN: ReadonlySet<string> = new Set();

function FieldFrame({ id, fieldKey, message, children }: { id: string; fieldKey: string; message?: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    frame.current?.querySelectorAll<HTMLElement>('input,select,textarea,button[aria-haspopup="dialog"],[role="combobox"]').forEach((control) => {
      if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
      const descriptions = (control.getAttribute('aria-describedby') ?? '').split(' ').filter((value) => value && value !== `${id}-error`);
      if (message) descriptions.push(`${id}-error`);
      if (descriptions.length) control.setAttribute('aria-describedby', descriptions.join(' ')); else control.removeAttribute('aria-describedby');
    });
  });
  return <div ref={frame} id={id} data-field-key={fieldKey} tabIndex={-1} className="min-w-0 scroll-mt-24 space-y-1 rounded-lg focus-visible:outline-2 focus-visible:outline-teal-700">
    {children}
    {message && <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-300">{message}</p>}
  </div>;
}

/** The visible groups never own answers. Collapsing or single-block presentation keeps
 * controls mounted; applicability is provided by the existing engine in the caller. */
export function SectionedFields({ fields, renderField, sections, values, allFields, rules = NO_RULES,
  hiddenKeys = NO_HIDDEN, requireComplete = false, commonLayout }: {
  fields: TemplateField[];
  renderField: (field: TemplateField) => ReactNode;
  sections?: readonly TemplateSection[] | null;
  /** UX-16 : presentation des variables communes, distincte des sections cliniques. */
  commonLayout?: TemplateCommonLayout | null;
  values?: Record<string, unknown>;
  allFields?: readonly TemplateField[];
  rules?: readonly ValidationRule[];
  hiddenKeys?: ReadonlySet<string>;
  requireComplete?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupFieldsBySection(fields, sections, commonLayout), [fields, sections, commonLayout]);
  const roots = groups.filter((group) => !group.parentSectionKey || !groups.some((candidate) => candidate.key === group.parentSectionKey));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [mobileContents, setMobileContents] = useState(false);
  const [single, setSingle] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const previousGroups = useRef<string[] | null>(null);
  const currentField = useRef<string | null>(null);
  const active = roots.some((root) => root.key === current) ? current : roots[0]?.key ?? null;
  const rootFor = (key: string) => {
    const source = (allFields ?? fields).find((field) => isProposalSource(field) && findProposalField(allFields ?? fields, field)?.fieldKey === key);
    const group = groups.find((candidate) => candidate.fields.some((field) => field.fieldKey === (source?.fieldKey ?? key)));
    return group?.parentSectionKey ?? group?.key ?? null;
  };
  const fieldId = (key: string) => `${id}-field-${key}`;
  const groupId = (key: string) => `${id}-group-${key}`;
  const label = (key: string) => {
    const group = groups.find((candidate) => candidate.key === key);
    return sectionLabel(t, { sectionKey: key, label: group?.label });
  };
  const progress = useMemo(() => calculateFormProgress(allFields ?? fields, values ?? NO_VALUES, rules, hiddenKeys, requireComplete),
    [allFields, fields, values, rules, hiddenKeys, requireComplete]);
  const visibleIssues = progress.issues.filter((issue) => submitted || touched.has(issue.fieldKey));
  const issueByKey = new Map(visibleIssues.map((issue) => [issue.fieldKey, issue.message]));

  const reveal = (rootKey: string, targetKey?: string) => {
    setCollapsed((before) => { const next = new Set(before); next.delete(rootKey); return next; });
    setCurrent(rootKey); setMobileContents(false);
    requestAnimationFrame(() => {
      const target = document.getElementById(targetKey ? fieldId(targetKey) : groupId(rootKey))
        ?? [...(host.current?.querySelectorAll<HTMLElement>('[data-proposal-key]') ?? [])].find((node) => node.dataset.proposalKey === targetKey);
      const control = targetKey ? target?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button[aria-haspopup="dialog"],[role="combobox"],output') : target;
      if (control?.tagName === 'OUTPUT') control.tabIndex = -1;
      (control ?? target)?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    });
  };
  const goToField = (key: string) => { const root = rootFor(key); if (root) reveal(root, key); };

  const groupKeys = roots.map((root) => root.key).join('|');
  useEffect(() => {
    const next = groupKeys ? groupKeys.split('|') : [];
    if (previousGroups.current) {
      const added = next.find((key) => !previousGroups.current!.includes(key));
      if (added) setNewGroup(added);
    }
    previousGroups.current = next;
  }, [groupKeys]);
  useEffect(() => {
    const form = host.current?.closest('form');
    if (!form) return;
    const onSubmit = () => {
      setSubmitted(true);
      requestAnimationFrame(() => host.current?.querySelector<HTMLElement>('[data-validation-summary]')?.focus());
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  if (roots.length === 0) return null;
  const rootIndex = roots.findIndex((root) => root.key === active);
  const nextMissing = () => {
    const candidates = progress.missingKeys.filter((key) => rootFor(key));
    const index = currentField.current ? candidates.indexOf(currentField.current) : -1;
    const key = candidates[(index + 1) % candidates.length];
    if (key) goToField(key);
  };
  return <div ref={host} className="@container/sections space-y-4"
    onFocusCapture={(event) => {
      const field = (event.target as HTMLElement).closest<HTMLElement>('[data-field-key]');
      if (field?.dataset.fieldKey) { currentField.current = field.dataset.fieldKey; setCurrent(rootFor(field.dataset.fieldKey)); }
    }}
    onBlurCapture={(event) => {
      const key = (event.target as HTMLElement).closest<HTMLElement>('[data-field-key]')?.dataset.fieldKey;
      if (key) setTouched((before) => new Set(before).add(key));
    }}>
    <div className="space-y-2">
      {values !== undefined && <p className="text-sm text-slate-600 dark:text-slate-300">
        {progress.requiredKeys.size === 0 ? t('form.section_required_none')
          : t('form.section_required_count').replace('{done}', String(progress.filledRequired)).replace('{total}', String(progress.requiredKeys.size))}
        {visibleIssues.length > 0 && ` — ${t('form.section_errors').replace('{n}', String(visibleIssues.length))}`}
      </p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn-secondary @min-[52rem]/sections:hidden" aria-expanded={mobileContents}
          aria-controls={`${id}-contents`} onClick={() => setMobileContents((open) => !open)}>{t('form.sections')}</button>
        {!single && <>
          <button type="button" className="btn-ghost min-h-11" onClick={() => setCollapsed(new Set())}>{t('form.expand_all')}</button>
          <button type="button" className="btn-ghost min-h-11" onClick={() => setCollapsed(new Set(roots.map((root) => root.key)))}>{t('form.collapse_all')}</button>
        </>}
        {progress.missingKeys.length > 0 && <button type="button" className="btn-secondary" onClick={nextMissing}>
          {t('form.next_missing')}
        </button>}
        {roots.length > 1 && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={single} onChange={(event) => setSingle(event.target.checked)} className="h-4 w-4 accent-teal-700" />
          {t('form.single_block')}
        </label>}
      </div>
    </div>
    {newGroup && roots.some((root) => root.key === newGroup) && <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-teal-800 dark:text-teal-200">
      <span>{t('form.block_available')} {label(newGroup)}</span>
      <button type="button" className="btn-ghost min-h-11" onClick={() => { reveal(newGroup); setNewGroup(null); }}>{t('form.go_to_block')}</button>
    </div>}
    {submitted && <ValidationSummary errors={visibleIssues.filter((issue) => rootFor(issue.fieldKey)).map((issue) => ({
      id: issue.fieldKey, targetId: fieldId(issue.fieldKey), label: (allFields ?? fields).find((field) => field.fieldKey === issue.fieldKey)?.label ?? issue.fieldKey,
      message: issue.message,
    }))} onNavigate={(issue) => goToField(issue.id)} />}
    <div className="grid min-w-0 gap-4 @min-[52rem]/sections:grid-cols-[13rem_minmax(0,1fr)]">
      <nav id={`${id}-contents`} aria-label={t('form.contents')}
        className={`${mobileContents ? 'block' : 'hidden'} self-start @min-[52rem]/sections:block`}>
        <ol className="space-y-1 border-l-2 border-slate-200 pl-2 dark:border-slate-700">
          {roots.map((root) => <li key={root.key}><button type="button" aria-current={active === root.key ? 'location' : undefined}
            className={`min-h-11 w-full rounded-lg px-2 py-1.5 text-left text-sm ${active === root.key ? 'bg-teal-50 font-semibold text-teal-900 dark:bg-teal-950 dark:text-teal-100' : 'text-slate-600 dark:text-slate-300'}`}
            onClick={() => reveal(root.key)}>{label(root.key)}</button></li>)}
        </ol>
      </nav>
      <div className="min-w-0 space-y-4">
        {roots.map((root) => {
          const members = groups.filter((group) => group.key === root.key || group.parentSectionKey === root.key);
          const keys = new Set(members.flatMap((group) => group.fields.map((field) => field.fieldKey)));
          const missing = progress.missingKeys.filter((key) => keys.has(key)).length;
          const errors = visibleIssues.filter((issue) => keys.has(issue.fieldKey)).length;
          const expanded = single ? active === root.key : !collapsed.has(root.key);
          return <fieldset key={root.key} hidden={single && active !== root.key} aria-labelledby={`${groupId(root.key)}-title`}
            className="min-w-0 rounded-xl border border-slate-200 px-4 pb-4 dark:border-slate-700">
            <legend className="max-w-full px-1">
              <button id={groupId(root.key)} type="button" aria-expanded={expanded} aria-controls={`${groupId(root.key)}-body`}
                className="flex min-h-11 max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm font-semibold text-slate-800 dark:text-slate-100"
                onClick={() => { setCurrent(root.key); setCollapsed((before) => { const next = new Set(before); if (next.has(root.key)) next.delete(root.key); else next.add(root.key); return next; }); }}>
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span><span id={`${groupId(root.key)}-title`}>{label(root.key)}</span>
                {values !== undefined && <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t('form.required_remaining').replace('{n}', String(missing))}{errors > 0 ? ` · ${t('form.section_errors').replace('{n}', String(errors))}` : ''}</span>}
              </button>
            </legend>
            <div id={`${groupId(root.key)}-body`} hidden={!expanded} className="@container space-y-5">
              {members.map((group) => <div key={group.key} className="space-y-4">
                {group.key !== root.key && <h3 className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-200">{label(group.key)}</h3>}
                {group.fields.map((field) => <FieldFrame key={field.id} id={fieldId(field.fieldKey)} fieldKey={field.fieldKey} message={issueByKey.get(field.fieldKey)}>{renderField(field)}</FieldFrame>)}
              </div>)}
            </div>
          </fieldset>;
        })}
        {single && <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-secondary" disabled={rootIndex <= 0} onClick={() => reveal(roots[rootIndex - 1].key)}>{t('form.previous_block')}</button>
          <span className="text-xs text-slate-500">{rootIndex + 1} / {roots.length}</span>
          <button type="button" className="btn-secondary" disabled={rootIndex >= roots.length - 1} onClick={() => reveal(roots[rootIndex + 1].key)}>{t('form.next_block')}</button>
        </div>}
      </div>
    </div>
  </div>;
}
