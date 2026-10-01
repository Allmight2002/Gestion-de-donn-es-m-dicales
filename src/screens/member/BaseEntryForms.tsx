import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useEntryFormRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import { EntryFormConflictError, type EntryForm } from '../../data/entryForms';
import type { TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { resolveEntryForm } from '../../domain/entryForms';
import { proposalKeysOf } from '../../domain/proposalField';
import { groupFieldsBySection, repeatableFieldKeys, sectionLabel } from '../../domain/templateSections';
import { errorMessage } from '../../lib/errorMessage';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Checkbox } from '../../components/Checkbox';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';

interface Draft {
  id: string | null;
  rowVersion: number;
  name: string;
  fieldKeys: string[];
  requiredKeys: string[];
}

const EMPTY_DRAFT: Draft = { id: null, rowVersion: 0, name: '', fieldKeys: [], requiredKeys: [] };

/**
 * Formulaires de saisie d'une base : le proprietaire compose des formulaires courts a partir des
 * variables de fiche existantes. Un formulaire ne cree aucune variable et ne porte aucune donnee :
 * le modifier ou le supprimer laisse intacts le gabarit et toutes les fiches.
 */
export function BaseEntryForms() {
  const { id: baseId } = useParams();
  const { t } = useI18n();
  const { toast } = useToast();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const repository = useEntryFormRepository();

  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [commonLayout, setCommonLayout] = useState<TemplateCommonLayout | undefined>(undefined);
  const [forms, setForms] = useState<EntryForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [toDelete, setToDelete] = useState<EntryForm | null>(null);

  const reloadForms = useCallback(async () => {
    if (!baseId) return;
    setForms(await repository.list(baseId));
  }, [baseId, repository]);

  useEffect(() => {
    if (!baseId) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const listing = await bases.getBase(baseId);
        if (!active) return;
        setIsOwner(listing?.role === 'owner');
        const versionId = listing?.base.currentTemplateVersionId;
        if (listing?.role === 'owner' && versionId) {
          const [version, rows] = await Promise.all([templates.getVersion(versionId), repository.list(baseId)]);
          if (!active) return;
          setFields(version.fields);
          setRules(version.rules);
          setSections(version.sections ?? []);
          setCommonLayout(version.version.commonLayout);
          setForms(rows);
        }
        setError(null);
      } catch (e) {
        if (active) setError(errorMessage(e, t('common.error')));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, templates, repository]);

  // Variables proposables : variables de fiche, hors blocs repetables (une occurrence n'est pas
  // la fiche) et hors champs « autre », qui suivent automatiquement leur liste.
  const available = useMemo(() => {
    const patientFields = fields.filter((field) => field.scope === 'patient').sort((a, b) => a.displayOrder - b.displayOrder);
    const groupKeys = repeatableFieldKeys(patientFields, sections);
    const companions = proposalKeysOf(patientFields);
    return patientFields.filter((field) => !groupKeys.has(field.fieldKey) && !companions.has(field.fieldKey));
  }, [fields, sections]);
  const patientFields = useMemo(() => fields.filter((field) => field.scope === 'patient'), [fields]);
  const byKey = useMemo(() => new Map(available.map((field) => [field.fieldKey, field])), [available]);
  // Un formulaire court suit l'ordre du formulaire complet : l'ordre de selection n'a pas de sens.
  const rank = useMemo(() => new Map(available.map((field, index) => [field.fieldKey, index])), [available]);
  const inFormOrder = (keys: string[]) => [...keys].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
  const labelOf = (key: string) => byKey.get(key)?.label ?? key;

  const groups = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const matching = needle
      ? available.filter((field) => `${field.label} ${field.fieldKey}`.toLocaleLowerCase().includes(needle))
      : available;
    return groupFieldsBySection(matching, sections, commonLayout).filter((group) => group.fields.length > 0);
  }, [available, search, sections, commonLayout]);

  const preview = useMemo(
    () => (draft ? resolveEntryForm(draft, patientFields, rules, sections) : null),
    [draft, patientFields, rules, sections],
  );
  const staleKeys = draft ? draft.fieldKeys.filter((key) => !byKey.has(key)) : [];

  const update = (change: (current: Draft) => Draft) => setDraft((current) => (current ? change(current) : current));
  const toggleField = (key: string, checked: boolean) => update((current) => ({
    ...current,
    fieldKeys: checked ? inFormOrder([...current.fieldKeys.filter((k) => k !== key), key]) : current.fieldKeys.filter((k) => k !== key),
    requiredKeys: checked ? current.requiredKeys : current.requiredKeys.filter((k) => k !== key),
  }));
  const toggleRequired = (key: string, checked: boolean) => update((current) => ({
    ...current,
    requiredKeys: checked ? [...new Set([...current.requiredKeys, key])] : current.requiredKeys.filter((k) => k !== key),
  }));

  const open = (form: EntryForm | null) => {
    setDraft(form
      ? { id: form.id, rowVersion: form.rowVersion, name: form.name, fieldKeys: inFormOrder(form.fieldKeys), requiredKeys: [...form.requiredKeys] }
      : EMPTY_DRAFT);
    setDraftError(null);
    setConflict(false);
    setSearch('');
  };

  async function save() {
    if (!draft || !baseId || busy) return;
    // Une variable retiree du gabarit depuis ne peut plus etre enregistree : elle est ignoree.
    const input = {
      name: draft.name.trim(),
      fieldKeys: draft.fieldKeys.filter((key) => byKey.has(key)),
      requiredKeys: draft.requiredKeys.filter((key) => byKey.has(key)),
    };
    if (!input.name) { setDraftError(t('entryform.name_required')); return; }
    if (input.fieldKeys.length === 0) { setDraftError(t('entryform.selected_empty')); return; }
    setBusy(true);
    try {
      if (draft.id) await repository.update(draft.id, draft.rowVersion, input);
      else await repository.create(baseId, input);
      toast(t('entryform.saved'));
      setDraft(null);
      await reloadForms();
    } catch (e) {
      // Conflit : rien n'est ecrit et le brouillon de l'ecran reste tel quel.
      if (e instanceof EntryFormConflictError) { setConflict(true); setDraftError(t('entryform.conflict')); }
      else if ((e as { code?: string })?.code === '23505') setDraftError(t('entryform.name_taken'));
      else setDraftError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete || busy) return;
    setBusy(true);
    try {
      await repository.remove(toDelete.id, toDelete.rowVersion);
      toast(t('entryform.deleted'));
      if (draft?.id === toDelete.id) setDraft(null);
      setToDelete(null);
      await reloadForms();
    } catch (e) {
      setToDelete(null);
      setError(e instanceof EntryFormConflictError ? t('entryform.conflict') : errorMessage(e, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  async function reloadAfterConflict() {
    try {
      const rows = baseId ? await repository.list(baseId) : [];
      setForms(rows);
      // Les reglages de l'ecran sont conserves ; seule la version de reference est rafraichie.
      const fresh = draft?.id ? rows.find((form) => form.id === draft.id) : undefined;
      update((current) => (fresh ? { ...current, rowVersion: fresh.rowVersion } : { ...current, id: null, rowVersion: 0 }));
      setConflict(false);
      setDraftError(null);
    } catch (e) {
      setDraftError(errorMessage(e, t('common.error')));
    }
  }

  if (loading) return <SkeletonList rows={5} label={t('common.loading')} />;

  return (
    <section className="max-w-5xl space-y-5">
      <PageHeader
        title={t('entryform.manage_title')}
        description={t('entryform.manage_subtitle')}
        keepDescription
        actions={isOwner && !draft ? (
          <button type="button" className="btn-primary" onClick={() => open(null)}>
            <Plus size={16} aria-hidden /> {t('entryform.new')}
          </button>
        ) : undefined}
      />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!isOwner ? (
        <p className="text-sm text-slate-500">{t('entryform.owner_only')}</p>
      ) : (
        <>
          <p className="helper-text">{t('entryform.manage_details')}</p>

          {!draft && (forms.length === 0 ? (
            <EmptyState title={t('entryform.none')} />
          ) : (
            <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
              {forms.map((form) => (
                <li key={form.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{form.name}</span>
                    <span className="block text-xs text-slate-500">{t('entryform.count').replace('{n}', String(form.fieldKeys.length))}</span>
                  </span>
                  <button type="button" className="btn-secondary" onClick={() => open(form)} aria-label={`${t('entryform.edit')} ${form.name}`}>
                    <Pencil size={16} aria-hidden /> {t('entryform.edit')}
                  </button>
                  <button type="button" className="btn-ghost text-red-600" onClick={() => setToDelete(form)} aria-label={`${t('entryform.delete')} ${form.name}`}>
                    <Trash2 size={16} aria-hidden /> {t('entryform.delete')}
                  </button>
                </li>
              ))}
            </ul>
          ))}

          {draft && preview && (
            <form
              className="card space-y-4 p-4 sm:p-5"
              onSubmit={(event) => { event.preventDefault(); void save(); }}
            >
              <label className="form-label max-w-md">
                {t('entryform.name')}
                <input
                  className="input mt-1"
                  value={draft.name}
                  maxLength={80}
                  placeholder={t('entryform.name_placeholder')}
                  onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
                />
              </label>

              <div className="grid gap-4 lg:grid-cols-2">
                <section aria-labelledby="entryform-selected" className="min-w-0 space-y-2">
                  <h2 id="entryform-selected" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t('entryform.selected').replace('{n}', String(draft.fieldKeys.length))}
                  </h2>
                  <p className="helper-text">{t('entryform.required_hint')}</p>
                  {draft.fieldKeys.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('entryform.selected_empty')}</p>
                  ) : (
                    <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                      {draft.fieldKeys.map((key, index) => (
                        <li key={key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                          <span className="w-6 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
                          <span className={`min-w-0 flex-1 ${byKey.has(key) ? '' : 'text-slate-400 line-through'}`}>
                            {labelOf(key)}
                            {byKey.get(key) && (
                              <span className="block text-xs text-slate-500">{sectionLabel(t, { sectionKey: byKey.get(key)!.section, label: byKey.get(key)!.sectionLabel })}</span>
                            )}
                          </span>
                          <Checkbox
                            label={t('entryform.required')}
                            checked={draft.requiredKeys.includes(key)}
                            disabled={!byKey.has(key)}
                            onChange={(event) => toggleRequired(key, event.target.checked)}
                          />
                          <button type="button" className="icon-button" aria-label={`${t('entryform.remove')} ${labelOf(key)}`} onClick={() => toggleField(key, false)}>
                            <X size={16} aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {staleKeys.length > 0 && (
                    <p role="status" className="text-xs text-amber-800 dark:text-amber-200">
                      {t('entryform.stale').replace('{list}', staleKeys.join(', '))}
                    </p>
                  )}
                  {preview.dependencyKeys.size > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                      <p className="font-medium text-slate-700 dark:text-slate-200">{t('entryform.dependencies_title')}</p>
                      <p className="helper-text">{t('entryform.dependencies_hint')}</p>
                      <p className="mt-1 text-slate-700 dark:text-slate-200">{[...preview.dependencyKeys].map(labelOf).join(', ')}</p>
                    </div>
                  )}
                </section>

                <section aria-labelledby="entryform-available" className="min-w-0 space-y-2">
                  <h2 id="entryform-available" className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('entryform.available')}</h2>
                  <input
                    className="input"
                    type="search"
                    value={search}
                    aria-label={t('entryform.search')}
                    placeholder={t('entryform.search')}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                    {groups.length === 0 && <p className="p-2 text-sm text-slate-500">{t('entryform.no_results')}</p>}
                    {groups.map((group) => (
                      <fieldset key={group.key} className="min-w-0">
                        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {sectionLabel(t, { sectionKey: group.key, label: group.label })}
                        </legend>
                        {group.fields.map((field) => (
                          <Checkbox
                            key={field.fieldKey}
                            label={field.label}
                            containerClassName="w-full rounded-lg px-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                            checked={draft.fieldKeys.includes(field.fieldKey)}
                            onChange={(event) => toggleField(field.fieldKey, event.target.checked)}
                          />
                        ))}
                      </fieldset>
                    ))}
                  </div>
                </section>
              </div>

              {draftError && <p role="alert" className="text-sm text-red-600">{draftError}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                {conflict && (
                  <button type="button" className="btn-secondary" onClick={() => void reloadAfterConflict()}>{t('entryform.reload')}</button>
                )}
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDraft(null)}>{t('common.cancel')}</button>
                <button type="submit" className="btn-primary" disabled={busy || conflict}>{t('entryform.save')}</button>
              </div>
            </form>
          )}
        </>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={t('entryform.delete_title')}
        body={toDelete ? `${toDelete.name} — ${t('entryform.delete_body')}` : undefined}
        confirmLabel={t('entryform.delete')}
        danger
        busy={busy}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
