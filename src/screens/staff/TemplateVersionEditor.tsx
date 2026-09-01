import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, Search, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { NewField, TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
import type { ObservationModel } from '../../data/bases';
import { FieldForm } from './FieldForm';
import { fieldOptions } from '../../domain/fieldOptions';
import { sectionLabel } from '../../domain/templateSections';
import { fieldTypeLabel } from '../../domain/templateLabels';
import { FormPreview } from './FormPreview';
import { RuleForm, RuleSummary, ruleHasSeverity } from './RuleForm';
import { SectionsEditor } from './SectionsEditor';
import { SkeletonList } from '../../components/Skeleton';

interface Loaded {
  version: TemplateVersion;
  fields: TemplateField[];
  rules: ValidationRule[];
  sections: TemplateSection[];
}

const FIELD_TYPES: TemplateField['type'][] = ['text', 'integer', 'number', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'terminology'];
const FIELD_SCOPES: TemplateField['scope'][] = ['patient', 'encounter'];

export function TemplateVersionEditor({
  versionId,
  onBack,
  showVersionActions = true,
  onNewVersion,
  observationModel,
  templateName,
}: {
  versionId: string;
  onBack: () => void;
  showVersionActions?: boolean;
  // §8.2 : permet au medecin de creer la version SUIVANTE de son gabarit (copie editable).
  onNewVersion?: (newVersionId: string) => void | Promise<void>;
  observationModel?: ObservationModel;
  /** Contexte lisible transmis par la carte ou la base qui a ouvert l’éditeur. */
  templateName?: string;
}) {
  const repo = useTemplateRepository();
  const { t } = useI18n();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateField | null>(null);
  const [fieldFormOpen, setFieldFormOpen] = useState<'add' | 'edit' | null>(null);
  const [editingRule, setEditingRule] = useState<ValidationRule | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false); // L29 : apercu du formulaire
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const sectionsInitialized = useRef<string | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await repo.getVersion(versionId));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, versionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!data || sectionsInitialized.current === data.version.id) return;
    setOpenSections(new Set(data.sections.map((section) => section.sectionKey)));
    sectionsInitialized.current = data.version.id;
  }, [data]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
      setError(null);
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <SkeletonList rows={5} label={t('common.loading')} />;
  if (!data) return <p className="text-red-600">{error}</p>;

  const { version, fields, rules, sections } = data;

  // L29 : l'apercu prend tout l'ecran et se sert des donnees DEJA chargees ici — pas de
  // route dediee, sinon le meme ecran devrait franchir deux zones de garde differentes
  // (`member` pour /bases/:id/template et /templates, `admin` pour /admin) alors qu'il ne
  // fait que reafficher ce que l'editeur a en main.
  if (previewing) {
    return <FormPreview version={version} fields={fields} rules={rules} sections={data.sections} onClose={() => setPreviewing(false)} />;
  }

  const editable = version.status === 'draft';
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredFields = fields.filter((field) => {
    const haystack = [field.label, field.fieldKey, field.description ?? ''].join(' ').toLocaleLowerCase();
    return (!normalizedSearch || haystack.includes(normalizedSearch))
      && (!sectionFilter || field.section === sectionFilter)
      && (!typeFilter || field.type === typeFilter)
      && (!scopeFilter || field.scope === scopeFilter)
      && (!requiredOnly || field.required);
  });
  const fieldGroups = (() => {
    const groups = sections.map((section) => ({
      key: section.sectionKey,
      label: sectionLabel(t, section),
      total: fields.filter((field) => field.section === section.sectionKey).length,
      fields: filteredFields.filter((field) => field.section === section.sectionKey),
    }));
    const orphanFields = filteredFields.filter((field) => !sections.some((section) => section.sectionKey === field.section));
    if (orphanFields.length > 0 || sections.length === 0) {
      groups.push({ key: '__other__', label: t('section.other'), total: fields.filter((field) => !sections.some((section) => section.sectionKey === field.section)).length, fields: orphanFields });
    }
    return groups.filter((group) => group.total > 0 || group.fields.length > 0 || (!normalizedSearch && !sectionFilter));
  })();

  function openFieldEditor(field: TemplateField) {
    setOpenSections((current) => new Set(current).add(field.section));
    setEditing(field);
    setFieldFormOpen('edit');
  }

  function closeFieldEditor() {
    setEditing(null);
    setFieldFormOpen(null);
  }

  function scrollToField(fieldId: string) {
    window.setTimeout(() => document.getElementById(`template-field-${fieldId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0);
  }

  function adjacentField(fieldId: string, delta: -1 | 1) {
    const navigationFields = filteredFields.length > 0 ? filteredFields : fields;
    const index = navigationFields.findIndex((field) => field.id === fieldId);
    return index >= 0 ? navigationFields[index + delta] ?? null : null;
  }
  const fieldGridClass = editable
    ? 'xl:grid-cols-[3rem_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,.7fr)_5rem_minmax(7rem,auto)]'
    : 'xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,.7fr)_5rem]';

  // Drag & drop : depose la variable saisie a la place de la variable cible, persiste
  // le nouvel ordre (display_order), avec mise a jour optimiste de la liste.
  function dropOn(targetId: string) {
    const src = dragId;
    setDragId(null);
    if (!data || !src || src === targetId) return;
    const reordered = [...data.fields];
    const from = reordered.findIndex((f) => f.id === src);
    const to = reordered.findIndex((f) => f.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setData({ ...data, fields: reordered });
    void run(() => repo.reorderFields(version.id, reordered.map((f) => f.id)));
  }

  function moveField(fieldId: string, delta: -1 | 1) {
    if (!data || editing) return;
    const reordered = [...data.fields];
    const from = reordered.findIndex((field) => field.id === fieldId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= reordered.length) return;
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    setData({ ...data, fields: reordered });
    void run(() => repo.reorderFields(version.id, reordered.map((field) => field.id)));
  }

  async function saveEditedField(field: NewField, advance = false) {
    if (!editing) return false;
    const editedId = editing.id;
    const ok = await run(() => repo.updateField(editedId, field));
    if (!ok) return false;
    const next = advance ? adjacentField(editedId, 1) : null;
    if (next) {
      openFieldEditor(next);
      scrollToField(next.id);
    } else {
      closeFieldEditor();
      scrollToField(editedId);
    }
    return true;
  }

  const previousField = editing ? adjacentField(editing.id, -1) : null;
  const nextField = editing ? adjacentField(editing.id, 1) : null;

  return (
    <section className="space-y-5 sm:space-y-6">
      <div
        data-testid="template-editor-toolbar"
        className="-mx-4 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:bg-slate-950/95 sm:-mx-6 sm:px-6 md:sticky md:top-0 md:z-30"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onBack} className="btn-ghost min-h-11 px-2">
                ← {t('admin.back')}
              </button>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('admin.editor_context')}</span>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">{templateName ?? t('admin.editor_context')}</h2>
              <span className="badge">{t('admin.version')} {version.versionNumber} · {t(`status.${version.status}`)}</span>
              <span className="text-xs text-slate-500">{t('admin.variable_count').replace('{n}', String(fields.length))}</span>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
            {editable && (
              <button type="button" onClick={() => { setEditing(null); setFieldFormOpen('add'); }} disabled={busy} className="btn-primary">
                {t('admin.add_variable')}
              </button>
            )}
            {/* L29 : voir le formulaire tel que le verra la personne qui saisit, sans creer
                de patient d'essai. Disponible aussi sur une version publiee. */}
            <button type="button" onClick={() => setPreviewing(true)} className="btn-secondary">
              <Eye size={16} aria-hidden /> {t('preview.open')}
            </button>
            {showVersionActions ? (
              <>
                {editable && (
                  <button onClick={() => void run(() => repo.publishVersion(version.id))} disabled={busy} className="btn-primary">
                    {t('admin.publish')}
                  </button>
                )}
                <button onClick={() => void run(() => repo.duplicateVersion(version.id))} disabled={busy} className="btn-secondary">
                  {t('admin.duplicate')}
                </button>
              </>
            ) : (
              !editable && onNewVersion && (
                <button
                  onClick={async () => {
                    setBusy(true);
                    try { const v = await repo.createNextVersion(version.templateId); setError(null); await onNewVersion(v.id); }
                    catch (e) { setError(msg(e)); }
                    finally { setBusy(false); }
                  }}
                  disabled={busy}
                  className="btn-secondary"
                >
                  {t('admin.new_version')}
                </button>
              )
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(14rem,2fr)_repeat(3,minmax(9rem,1fr))_auto]">
          <label className="relative block">
            <span className="sr-only">{t('admin.search_variables')}</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('admin.search_variables_hint')}
              aria-label={t('admin.search_variables')}
            />
          </label>
          <label className="sr-only" htmlFor="template-section-filter">{t('admin.filter_section')}</label>
          <select id="template-section-filter" className="input" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} aria-label={t('admin.filter_section')}>
            <option value="">{t('admin.all_sections')}</option>
            {sections.map((section) => <option key={section.sectionKey} value={section.sectionKey}>{sectionLabel(t, section)}</option>)}
          </select>
          <label className="sr-only" htmlFor="template-type-filter">{t('admin.filter_type')}</label>
          <select id="template-type-filter" className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label={t('admin.filter_type')}>
            <option value="">{t('admin.all_types')}</option>
            {FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(t, type)}</option>)}
          </select>
          <label className="sr-only" htmlFor="template-scope-filter">{t('admin.filter_scope')}</label>
          <select id="template-scope-filter" className="input" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)} aria-label={t('admin.filter_scope')}>
            <option value="">{t('admin.all_scopes')}</option>
            {FIELD_SCOPES.map((scope) => <option key={scope} value={scope}>{t(`scope.${scope}`)}</option>)}
          </select>
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs text-slate-700">
            <input type="checkbox" checked={requiredOnly} onChange={(event) => setRequiredOnly(event.target.checked)} />
            {t('admin.filter_required')}
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500" aria-live="polite">{busy ? t('admin.saving') : t('admin.saved')} · {filteredFields.length} / {fields.length}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!editable && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('admin.published_readonly')}</p>}

      {/* L31 : les sections avant les variables — on choisit ses regroupements, puis on
          range ses variables dedans. Gelees avec la version, donc invisibles hors brouillon. */}
      {editable && (
        <SectionsEditor
          sections={sections}
          fields={fields}
          busy={busy}
          onAdd={(sectionKey, label) => void run(() => repo.addSection!(version.id, sectionKey, label))}
          onRename={(sectionId, label) => void run(() => repo.renameSection!(sectionId, label))}
          onDelete={(sectionId) => void run(() => repo.deleteSection!(sectionId))}
          onReorder={(orderedIds) => void run(() => repo.reorderSections!(version.id, orderedIds))}
        />
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">{t('admin.variables')}</h3>
        <div className="card overflow-hidden" role="table" aria-label={t('admin.variables')}>
          <div
            role="row"
            className={`hidden border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500 xl:grid xl:gap-2 ${fieldGridClass}`}
          >
            {editable && <span role="columnheader"><span className="sr-only">{t('admin.drag_hint')}</span></span>}
            <span role="columnheader">{t('admin.field_key')}</span>
            <span role="columnheader">{t('admin.label')}</span>
            <span role="columnheader">{t('admin.scope')}</span>
            <span role="columnheader">{t('admin.section')}</span>
            <span role="columnheader">{t('admin.type')}</span>
            <span role="columnheader">{t('admin.required')}</span>
            {editable && <span role="columnheader"><span className="sr-only">{t('common.actions')}</span></span>}
          </div>
          <div role="rowgroup" className="divide-y divide-slate-100">
            {fieldGroups.map((group) => (
              <details
                key={group.key}
                open={openSections.has(group.key)}
                onToggle={(event) => {
                  const isOpen = (event.currentTarget as HTMLDetailsElement).open;
                  setOpenSections((current) => {
                    const next = new Set(current);
                    if (isOpen) next.add(group.key); else next.delete(group.key);
                    return next;
                  });
                }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50/70 px-4 py-3 text-sm font-semibold text-slate-800">
                  <span>{group.label}</span>
                  <span className="text-xs font-normal text-slate-500">{t('admin.variable_count').replace('{n}', String(group.total))}</span>
                </summary>
                <div className="divide-y divide-slate-100">
              {group.fields.map((f) => {
                const index = fields.findIndex((field) => field.id === f.id);
                const canDrag = editable && !editing;
                return (
                <div
                  key={f.id}
                  id={`template-field-${f.id}`}
                  role="row"
                  draggable={canDrag}
                  onDragStart={canDrag ? () => setDragId(f.id) : undefined}
                  onDragOver={canDrag ? (e) => e.preventDefault() : undefined}
                  onDrop={canDrag ? () => dropOn(f.id) : undefined}
                  className={
                    `grid gap-2 p-4 xl:items-center xl:gap-2 xl:px-3 xl:py-2.5 ${fieldGridClass}` +
                    (dragId === f.id ? ' opacity-50' : '')
                  }
                >
                  {editable && (
                    <div role="cell" className="flex items-center gap-1 xl:justify-center">
                      <>
                        <span className={'hidden text-slate-400 xl:inline' + (canDrag ? ' cursor-grab select-none' : '')} title={t('admin.drag_hint')} aria-hidden>⠿</span>
                        <button
                          type="button"
                          className="icon-button h-11 w-11 xl:hidden"
                          aria-label={`${t('admin.move_up')} · ${f.label}`}
                          disabled={busy || !!editing || index === 0}
                          onClick={() => moveField(f.id, -1)}
                        >
                          <ArrowUp size={18} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="icon-button h-11 w-11 xl:hidden"
                          aria-label={`${t('admin.move_down')} · ${f.label}`}
                          disabled={busy || !!editing || index === fields.length - 1}
                          onClick={() => moveField(f.id, 1)}
                        >
                          <ArrowDown size={18} aria-hidden />
                        </button>
                      </>
                    </div>
                  )}
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-xs xl:block">
                    <span className="font-medium text-slate-500 xl:hidden">{t('admin.field_key')}</span>
                    <span className="min-w-0 break-words font-mono">{f.fieldKey}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.label')}</span>
                    <span className="min-w-0 break-words font-medium text-slate-900">{f.label}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.scope')}</span>
                    <span>{t(`scope.${f.scope}`)}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.section')}</span>
                    <span>{sectionLabel(t, { sectionKey: f.section, label: f.sectionLabel })}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.type')}</span>
                     <span>{fieldTypeLabel(t, f.type)}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.required')}</span>
                    <span>{f.required ? '✓' : '—'}</span>
                  </div>
                  {editable && (
                    <div role="cell" className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 xl:mt-0 xl:border-0 xl:pt-0">
                      <>
                        <button type="button" onClick={() => openFieldEditor(f)} className="btn-ghost min-h-11 px-3 text-xs">
                          {t('admin.edit_variable')}
                        </button>
                        {f.inUse ? (
                          <button
                            type="button"
                            disabled
                            className="min-h-11 cursor-not-allowed px-2 text-xs font-medium text-slate-500"
                            title={t('admin.field_locked_hint')}
                          >
                            {t('admin.delete')}
                          </button>
                        ) : (
                          <button onClick={() => void run(() => repo.deleteField(f.id))} className="min-h-11 px-2 text-xs font-medium text-red-600 hover:underline">
                            {t('admin.delete')}
                          </button>
                        )}
                      </>
                    </div>
                  )}
                </div>
                );
              })}
                </div>
              </details>
            ))}
            {filteredFields.length === 0 && (
              <p className="p-6 text-sm text-slate-500">{t('admin.no_matching_variables')}</p>
            )}
          </div>
        </div>
        {editable && fieldFormOpen && (
          <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
            <button type="button" className="absolute inset-0 bg-slate-950/30" aria-label={t('admin.close_panel')} onClick={closeFieldEditor} />
            <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="template-field-panel-title">
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-4 backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{templateName ?? t('admin.editor_context')}</p>
                    <h3 id="template-field-panel-title" className="mt-1 text-lg font-semibold text-slate-900">
                      {editing ? t('admin.edit_variable') : t('admin.add_variable')}
                    </h3>
                  </div>
                  <button type="button" className="icon-button h-11 w-11" onClick={closeFieldEditor} aria-label={t('admin.close_panel')}>
                    <X size={18} aria-hidden />
                  </button>
                </div>
                {editing && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" disabled={!previousField || busy} onClick={() => previousField && openFieldEditor(previousField)}>
                      <ArrowLeft size={16} aria-hidden /> {t('admin.previous_variable')}
                    </button>
                    <button type="button" className="btn-secondary" disabled={!nextField || busy} onClick={() => nextField && openFieldEditor(nextField)}>
                      {t('admin.next_variable')} <ArrowRight size={16} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex-1 p-4">
                {editing ? (
                  <FieldForm
                    key={editing.id}
                    busy={busy}
                    initial={{
                      fieldKey: editing.fieldKey,
                      label: editing.label,
                      // L27/L28 : préserver la consigne et la valeur proposée lors d’une correction ciblée.
                      description: editing.description,
                      defaultValue: editing.defaultValue,
                      scope: editing.scope,
                      section: editing.section,
                      type: editing.type,
                      required: editing.required,
                      isMultiple: editing.isMultiple,
                      encounterTypes: editing.encounterTypes,
                      allowedValues: editing.allowedValues ? editing.allowedValues.map(String) : null,
                      allowedOptions: fieldOptions(editing),
                      minValue: editing.minValue,
                      maxValue: editing.maxValue,
                      unit: editing.unit,
                      allowMissingCodes: editing.allowMissingCodes,
                      missingReasons: editing.missingReasons,
                      formula: editing.formula,
                    }}
                    lockStructural={editing.inUse ?? false}
                    submitLabel={t('admin.save')}
                    submitAndNextLabel={t('admin.save_next')}
                    onCancel={closeFieldEditor}
                    observationModel={observationModel}
                    sections={sections}
                    fields={fields}
                    onSubmit={(field) => void saveEditedField(field)}
                    onSubmitAndNext={(field) => saveEditedField(field, true)}
                  />
                ) : (
                  <>
                    <p className="mb-3 text-sm text-slate-600">{t('admin.add_variable_hint')}</p>
                    <FieldForm
                      busy={busy}
                      observationModel={observationModel}
                      sections={sections}
                      fields={fields}
                      onSubmit={async (field, companion) => {
                        // Ne jamais promettre une soupape qui n'a pas pu être créée. Le serveur garde la contrainte ; l’UI garde le formulaire rempli en cas de conflit.
                        const taken = !!companion && fields.some((item) => item.fieldKey === companion.fieldKey);
                        if (taken) {
                          setError(t('admin.proposal_exists'));
                          return false;
                        }
                        return run(() => repo.addField(version.id, field, companion));
                      }}
                    />
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">{t('admin.rules')}</h3>
        <ul className="space-y-2 text-sm">
          {rules.map((r) => (
            <li key={r.id} className="card flex items-start justify-between gap-3 px-3 py-2">
              <RuleSummary rule={r.rule} fields={fields} />
              <span className="flex items-center gap-2">
                {/* Une regle d'affichage ne bloque ni n'avertit : lui coller « Bloquant » la
                    decrirait faux. */}
                {ruleHasSeverity(r.rule) && (
                  <span className="text-xs text-slate-500">{t(`severity.${r.severity}`)}</span>
                )}
                {editable && (
                  <>
                    <button type="button" onClick={() => setEditingRule(r)} className="text-xs font-medium text-teal-700 hover:underline">
                      {t('admin.edit_rule')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void run(() => repo.deleteRule(r.id))}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {t('admin.delete')}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        {editable && (
          <div className="mt-3">
            <RuleForm
              key={editingRule?.id ?? 'new-rule'}
              fields={fields}
              busy={busy}
              existingRules={editingRule ? rules.filter((rule) => rule.id !== editingRule.id) : rules}
              initialRule={editingRule?.rule}
              initialMessage={editingRule?.message}
              initialSeverity={editingRule?.severity}
              submitLabel={editingRule ? t('admin.save_rule') : undefined}
              onCancel={editingRule ? () => setEditingRule(null) : undefined}
              onSubmit={(rule, message, severity) => {
                if (editingRule) {
                  void run(() => repo.updateRule(editingRule.id, rule, message, severity)).then((ok) => {
                    if (ok) setEditingRule(null);
                  });
                } else {
                  void run(() => repo.addRule(version.id, rule, message, severity));
                }
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
