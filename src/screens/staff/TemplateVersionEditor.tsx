import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
import type { ObservationModel } from '../../data/bases';
import { FieldForm } from './FieldForm';
import { fieldOptions } from '../../domain/fieldOptions';
import { sectionLabel } from '../../domain/templateSections';
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

export function TemplateVersionEditor({
  versionId,
  onBack,
  showVersionActions = true,
  onNewVersion,
  observationModel,
}: {
  versionId: string;
  onBack: () => void;
  showVersionActions?: boolean;
  // §8.2 : permet au medecin de creer la version SUIVANTE de son gabarit (copie editable).
  onNewVersion?: (newVersionId: string) => void | Promise<void>;
  observationModel?: ObservationModel;
}) {
  const repo = useTemplateRepository();
  const { t } = useI18n();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateField | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false); // L29 : apercu du formulaire

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

  return (
    <section className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="btn-ghost min-h-11 px-2">
            ← {t('admin.back')}
          </button>
          <h2 className="text-xl font-semibold tracking-tight">
            {t('admin.version')} {version.versionNumber}
          </h2>
          <span className="badge">{t(`status.${version.status}`)}</span>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {/* L29 : voir le formulaire tel que le verra la personne qui saisit, sans creer
              de patient d'essai. Disponible aussi sur une version publiee — voir ce qui est
              saisi aujourd'hui vaut au moins autant que voir un brouillon. */}
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
            onNewVersion && (
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
        <h3 className="mb-3 text-sm font-semibold text-slate-700">{t('admin.fields')}</h3>
        <div className="card overflow-hidden" role="table" aria-label={t('admin.fields')}>
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
              {fields.map((f, index) => {
                const canDrag = editable && !editing;
                return (
                <div
                  key={f.id}
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
                    <span>{f.type}</span>
                  </div>
                  <div role="cell" className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 text-sm xl:block">
                    <span className="text-xs font-medium text-slate-500 xl:hidden">{t('admin.required')}</span>
                    <span>{f.required ? '✓' : '—'}</span>
                  </div>
                  {editable && (
                    <div role="cell" className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 xl:mt-0 xl:border-0 xl:pt-0">
                      <>
                        <button onClick={() => setEditing(f)} className="btn-ghost min-h-11 px-3 text-xs">
                          {t('admin.edit')}
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
        </div>
        {editable && editing && (
          <div className="mt-3">
            <FieldForm
              key={editing.id}
              busy={busy}
              initial={{
                fieldKey: editing.fieldKey,
                label: editing.label,
                // L27/L28 : sans ces deux lignes, corriger le libelle d'une variable
                // effacerait sa consigne de saisie et sa valeur proposee -- `updateField`
                // enverrait alors `p_description: null` et `p_default_value: null`, en silence.
                description: editing.description,
                defaultValue: editing.defaultValue,
                scope: editing.scope,
                section: editing.section,
                type: editing.type,
                required: editing.required,
                encounterTypes: editing.encounterTypes,
                allowedValues: editing.allowedValues ? editing.allowedValues.map(String) : null,
                // L30 : l'editeur travaille sur les options ; le repli sur les seules cles
                // est assure par `fieldOptions` pour une variable anterieure au lot.
                allowedOptions: fieldOptions(editing),
                minValue: editing.minValue,
                maxValue: editing.maxValue,
                unit: editing.unit,
                allowMissingCodes: editing.allowMissingCodes,
                missingReasons: editing.missingReasons,
                // L35 : sans cette ligne, corriger le libelle d'une variable calculee
                // effacerait sa formule -- la variable redeviendrait saisie en silence.
                formula: editing.formula,
              }}
              lockStructural={editing.inUse ?? false}
              submitLabel={t('admin.save')}
              onCancel={() => setEditing(null)}
              observationModel={observationModel}
              sections={sections}
              fields={fields}
              onSubmit={(f) =>
                void run(() => repo.updateField(editing.id, f)).then((ok) => {
                  if (ok) setEditing(null);
                })
              }
            />
          </div>
        )}
        {editable && !editing && (
          <div className="mt-3">
            <FieldForm
              busy={busy}
              observationModel={observationModel}
              sections={sections}
              fields={fields}
              onSubmit={async (f, companion) => {
                // Ne jamais promettre une soupape qui n'a pas pu etre creee. Un conflit est
                // signale avant toute ecriture et le formulaire reste rempli pour correction.
                const taken = !!companion && fields.some((x) => x.fieldKey === companion.fieldKey);
                if (taken) {
                  setError(t('admin.proposal_exists'));
                  return false;
                }
                return run(() => repo.addField(version.id, f, companion));
              }}
            />
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
                  <button
                    onClick={() => void run(() => repo.deleteRule(r.id))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    {t('admin.delete')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {editable && (
          <div className="mt-3">
            <RuleForm
              fields={fields}
              busy={busy}
              existingRules={rules}
              onSubmit={(rule, message, severity) => void run(() => repo.addRule(version.id, rule, message, severity))}
            />
          </div>
        )}
      </div>
    </section>
  );
}
