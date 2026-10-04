import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ChevronDown, MoreHorizontal, Plus, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useEntryFormRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import { EntryFormConflictError, type EntryForm } from '../../data/entryForms';
import type { TemplateCommonLayout, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { resolveEntryForm } from '../../domain/entryForms';
import { proposalKeysOf } from '../../domain/proposalField';
import { groupFieldsBySection, repeatableFieldKeys, sectionLabel } from '../../domain/templateSections';
import { errorMessage } from '../../lib/errorMessage';
import { PageHeader } from '../../components/PageHeader';
import { HelpDetails } from '../../components/HelpTip';
import { Menu, MenuItem } from '../../components/Menu';
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
  // Formulaire ouvert par « Nouveau patient » (`null` = formulaire complet).
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  // Sections de « Variables de la base » depliees ; toutes le sont pendant une recherche.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [toDelete, setToDelete] = useState<EntryForm | null>(null);

  const reloadForms = useCallback(async () => {
    if (!baseId) return;
    const [rows, current] = await Promise.all([repository.list(baseId), repository.getDefault(baseId)]);
    setForms(rows);
    setDefaultId(current);
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
          const [version, rows, current] = await Promise.all([
            templates.getVersion(versionId), repository.list(baseId), repository.getDefault(baseId),
          ]);
          if (!active) return;
          setFields(version.fields);
          setRules(version.rules);
          setSections(version.sections ?? []);
          setCommonLayout(version.version.commonLayout);
          setForms(rows);
          setDefaultId(current);
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
  // Libelle de toute variable de fiche, y compris une dependance hors des variables proposables :
  // jamais de cle technique a l'ecran.
  const labelByKey = useMemo(() => new Map(patientFields.map((field) => [field.fieldKey, field.label])), [patientFields]);
  const labelOf = (key: string) => labelByKey.get(key) ?? key;

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
  // Une variable retiree de la base depuis n'est plus proposee : elle n'est ni listee ni
  // enregistree, seulement comptee.
  const chosenKeys = draft ? draft.fieldKeys.filter((key) => byKey.has(key)) : [];
  const staleCount = draft ? draft.fieldKeys.length - chosenKeys.length : 0;
  const searching = search.trim().length > 0;
  const toggleGroup = (key: string) => setOpenGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

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
    setOpenGroups(new Set());
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

  async function changeDefault(formId: string | null) {
    if (!baseId || busy) return;
    setBusy(true);
    setDefaultError(null);
    try {
      await repository.setDefault(baseId, formId);
      setDefaultId(formId);
      toast(t('entryform.default_saved'));
    } catch (e) {
      // Formulaire supprime entre-temps : rien n'est ecrit, la liste est rechargee.
      if (e instanceof EntryFormConflictError) {
        setDefaultError(t('entryform.conflict'));
        await reloadForms().catch(() => {});
      } else {
        setDefaultError(errorMessage(e, t('common.error')));
      }
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
        // La phrase utile reste lisible ; son explication s'ouvre derriere ⓘ (lot 3, T3-A).
        description={<>{t('entryform.manage_subtitle')} <HelpDetails>{t('entryform.manage_details')}</HelpDetails></>}
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
          {!draft && (forms.length === 0 ? (
            <EmptyState title={t('entryform.none')} />
          ) : (
            // La ligne ouvre le formulaire ; « ⋯ » porte Modifier et Supprimer (T4, T9) : plus aucun
            // bouton ne dispute la largeur au nom, et l'action destructive quitte le premier niveau.
            <>
            {/* Le formulaire ouvert par « Nouveau patient » : une personne peu familiere de
                l'application ne cherche pas le selecteur, elle tombe directement sur le bon. */}
            <div className="card space-y-1 p-4 sm:p-5">
              <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-100">{t('entryform.default_label')}</span>
                <select
                  className="input w-auto min-w-0 max-w-full sm:w-72"
                  value={defaultId ?? ''}
                  disabled={busy}
                  onChange={(event) => void changeDefault(event.target.value || null)}
                >
                  <option value="">{t('entryform.full')}</option>
                  {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
                </select>
              </label>
              <p className="helper-text">{t('entryform.default_hint')}</p>
              {defaultError && <p role="alert" className="text-sm text-red-600">{defaultError}</p>}
            </div>
            <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
              {forms.map((form) => (
                <li key={form.id} className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => open(form)}
                    aria-label={`${t('entryform.edit')} ${form.name}`}
                    className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:px-5"
                  >
                    <span className="block break-words text-sm font-medium text-slate-800 dark:text-slate-100">
                      {form.name}
                      {form.id === defaultId && <span className="badge ml-2 align-middle">{t('entryform.default_badge')}</span>}
                    </span>
                    <span className="block whitespace-nowrap text-xs text-slate-500">{t('entryform.count').replace('{n}', String(form.fieldKeys.length))}</span>
                  </button>
                  <Menu
                    triggerLabel={`${t('common.actions')} · ${form.name}`}
                    triggerClassName="icon-button h-11 w-11"
                    triggerContent={<MoreHorizontal size={20} aria-hidden />}
                    panelClassName="card absolute right-0 z-10 mt-2 w-48 space-y-1 p-2 shadow-lg"
                  >
                    <MenuItem onSelect={() => open(form)}>{t('entryform.edit')}</MenuItem>
                    <MenuItem onSelect={() => setToDelete(form)} className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium text-red-600 hover:bg-red-50">
                      {t('entryform.delete')}
                    </MenuItem>
                  </Menu>
                </li>
              ))}
            </ul>
            </>
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
                    {t('entryform.selected').replace('{n}', String(chosenKeys.length))}
                  </h2>
                  <p className="helper-text">{t('entryform.required_hint')}</p>
                  {chosenKeys.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('entryform.selected_empty')}</p>
                  ) : (
                    <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                      {chosenKeys.map((key, index) => {
                        const field = byKey.get(key)!;
                        return (
                          // Sur telephone, « Indispensable » passe sous le libelle : sur une seule ligne,
                          // le libelle se reduisait a quelques pixels et chevauchait la case.
                          <li key={key} className="flex items-start gap-2 px-3 py-1.5 text-sm">
                            <span className="w-6 shrink-0 pt-2.5 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
                            <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2">
                              <span className="block min-w-0 break-words pt-2 sm:flex-1 sm:py-2">
                                {field.label}
                                <span className="block text-xs text-slate-500">{sectionLabel(t, { sectionKey: field.section, label: field.sectionLabel })}</span>
                              </span>
                              <Checkbox
                                label={t('entryform.required')}
                                containerClassName="-ml-2 sm:ml-0 sm:shrink-0"
                                checked={draft.requiredKeys.includes(key)}
                                onChange={(event) => toggleRequired(key, event.target.checked)}
                              />
                            </div>
                            <button type="button" className="icon-button shrink-0" aria-label={`${t('entryform.remove')} ${field.label}`} onClick={() => toggleField(key, false)}>
                              <X size={16} aria-hidden />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {staleCount > 0 && (
                    <p role="status" className="text-xs text-amber-800 dark:text-amber-200">
                      {t('entryform.stale_count').replace('{n}', String(staleCount))}
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
                  {/* Sections repliees, avec le compte des variables retenues : la liste suit la page
                      au lieu de defiler dans un cadre (double defilement sur telephone). Une recherche
                      deplie tout ; une base a une seule section la montre d'emblee. */}
                  <div className="space-y-2">
                    {groups.length === 0 && <p className="p-2 text-sm text-slate-500">{t('entryform.no_results')}</p>}
                    {groups.map((group, index) => {
                      const title = sectionLabel(t, { sectionKey: group.key, label: group.label });
                      const expanded = searching || groups.length === 1 || openGroups.has(group.key);
                      const inForm = group.fields.filter((field) => draft.fieldKeys.includes(field.fieldKey)).length;
                      const panelId = `entryform-group-${index}`;
                      return (
                        <div key={group.key} className="rounded-xl border border-slate-200 dark:border-slate-700">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            disabled={searching || groups.length === 1}
                            onClick={() => toggleGroup(group.key)}
                            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 disabled:cursor-default dark:text-slate-200"
                          >
                            <span className="min-w-0 flex-1 break-words">{title}</span>
                            <span aria-hidden className="shrink-0 text-xs tabular-nums text-slate-500">{inForm}/{group.fields.length}</span>
                            <span className="sr-only">
                              {t('entryform.group_count').replace('{n}', String(inForm)).replace('{total}', String(group.fields.length))}
                            </span>
                            <ChevronDown size={16} aria-hidden className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
                          </button>
                          {expanded && (
                            <fieldset id={panelId} className="min-w-0 border-t border-slate-100 p-1 dark:border-slate-800">
                              <legend className="sr-only">{title}</legend>
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
                          )}
                        </div>
                      );
                    })}
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
