import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField, TemplateVersion, ValidationRule } from '../../data/types';
import type { ObservationModel } from '../../data/bases';
import { FieldForm } from './FieldForm';
import { RuleForm, RuleSummary } from './RuleForm';

interface Loaded {
  version: TemplateVersion;
  fields: TemplateField[];
  rules: ValidationRule[];
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

  if (loading && !data) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (!data) return <p className="text-red-600">{error}</p>;

  const { version, fields, rules } = data;
  const editable = version.status === 'draft';

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

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-teal-700">
            ← {t('admin.back')}
          </button>
          <h2 className="text-xl font-semibold tracking-tight">
            {t('admin.version')} {version.versionNumber}
          </h2>
          <span className="badge">{t(`status.${version.status}`)}</span>
        </div>
        {showVersionActions ? (
          <div className="flex gap-2">
            {editable && (
              <button onClick={() => void run(() => repo.publishVersion(version.id))} disabled={busy} className="btn-primary">
                {t('admin.publish')}
              </button>
            )}
            <button onClick={() => void run(() => repo.duplicateVersion(version.id))} disabled={busy} className="btn-secondary">
              {t('admin.duplicate')}
            </button>
          </div>
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

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!editable && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('admin.published_readonly')}</p>}

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">{t('admin.fields')}</h3>
        <div className="card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                {editable && <th className="w-8 px-2 py-2.5" />}
                <th className="px-4 py-2.5">{t('admin.field_key')}</th>
                <th className="px-4 py-2.5">{t('admin.label')}</th>
                <th className="px-4 py-2.5">{t('admin.scope')}</th>
                <th className="px-4 py-2.5">{t('admin.section')}</th>
                <th className="px-4 py-2.5">{t('admin.type')}</th>
                <th className="px-4 py-2.5">{t('admin.required')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => {
                const canDrag = editable && !editing;
                return (
                <tr
                  key={f.id}
                  draggable={canDrag}
                  onDragStart={canDrag ? () => setDragId(f.id) : undefined}
                  onDragOver={canDrag ? (e) => e.preventDefault() : undefined}
                  onDrop={canDrag ? () => dropOn(f.id) : undefined}
                  className={
                    'border-b border-slate-100 last:border-0' +
                    (dragId === f.id ? ' opacity-50' : '')
                  }
                >
                  {editable && (
                    <td
                      className={'px-2 py-2.5 text-center text-slate-400' + (canDrag ? ' cursor-grab select-none' : '')}
                      title={t('admin.drag_hint')}
                    >
                      ⠿
                    </td>
                  )}
                  <td className="px-4 py-2.5 font-mono text-xs">{f.fieldKey}</td>
                  <td className="px-4 py-2.5">{f.label}</td>
                  <td className="px-4 py-2.5">{t(`scope.${f.scope}`)}</td>
                  <td className="px-4 py-2.5">{t(`section.${f.section}`)}</td>
                  <td className="px-4 py-2.5">{f.type}</td>
                  <td className="px-4 py-2.5">{f.required ? '✓' : ''}</td>
                  <td className="px-4 py-2.5 text-right">
                    {editable && (
                      <span className="flex items-center justify-end gap-3">
                        <button onClick={() => setEditing(f)} className="text-xs font-medium text-teal-700 hover:underline">
                          {t('admin.edit')}
                        </button>
                        {f.inUse ? (
                          <span className="text-xs text-slate-300" title={t('admin.field_locked_hint')}>{t('admin.delete')}</span>
                        ) : (
                          <button onClick={() => void run(() => repo.deleteField(f.id))} className="text-xs font-medium text-red-600 hover:underline">
                            {t('admin.delete')}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && editing && (
          <div className="mt-3">
            <FieldForm
              key={editing.id}
              busy={busy}
              initial={{
                fieldKey: editing.fieldKey,
                label: editing.label,
                scope: editing.scope,
                section: editing.section,
                type: editing.type,
                required: editing.required,
                encounterTypes: editing.encounterTypes,
                allowedValues: editing.allowedValues ? editing.allowedValues.map(String) : null,
                minValue: editing.minValue,
                maxValue: editing.maxValue,
                unit: editing.unit,
                allowMissingCodes: editing.allowMissingCodes,
              }}
              lockStructural={editing.inUse ?? false}
              submitLabel={t('admin.save')}
              onCancel={() => setEditing(null)}
              observationModel={observationModel}
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
                <span className="text-xs text-slate-500">{t(`severity.${r.severity}`)}</span>
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
              onSubmit={(rule, message, severity) => void run(() => repo.addRule(version.id, rule, message, severity))}
            />
          </div>
        )}
      </div>
    </section>
  );
}
