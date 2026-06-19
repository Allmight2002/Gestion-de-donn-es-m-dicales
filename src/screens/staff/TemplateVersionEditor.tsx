import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField, TemplateVersion, ValidationRule } from '../../data/types';
import { FieldForm } from './FieldForm';
import { RuleForm } from './RuleForm';

interface Loaded {
  version: TemplateVersion;
  fields: TemplateField[];
  rules: ValidationRule[];
}

export function TemplateVersionEditor({
  versionId,
  onBack,
  showVersionActions = true,
}: {
  versionId: string;
  onBack: () => void;
  showVersionActions?: boolean;
}) {
  const repo = useTemplateRepository();
  const { t } = useI18n();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

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
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (!data) return <p className="text-red-600">{error}</p>;

  const { version, fields, rules } = data;
  const editable = version.status === 'draft';

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-teal-700 hover:underline">
            ← {t('admin.back')}
          </button>
          <h2 className="text-xl font-semibold">
            {t('admin.version')} {version.versionNumber}
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {t(`status.${version.status}`)}
          </span>
        </div>
        {showVersionActions && (
          <div className="flex gap-2">
            {editable && (
              <button
                onClick={() => void run(() => repo.publishVersion(version.id))}
                disabled={busy}
                className="rounded bg-teal-700 px-3 py-1 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {t('admin.publish')}
              </button>
            )}
            <button
              onClick={() => void run(() => repo.duplicateVersion(version.id))}
              disabled={busy}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              {t('admin.duplicate')}
            </button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!editable && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">{t('admin.published_readonly')}</p>}

      <div>
        <h3 className="mb-2 font-medium">{t('admin.fields')}</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-1">{t('admin.field_key')}</th>
              <th>{t('admin.label')}</th>
              <th>{t('admin.scope')}</th>
              <th>{t('admin.section')}</th>
              <th>{t('admin.type')}</th>
              <th>{t('admin.required')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-1 font-mono text-xs">{f.fieldKey}</td>
                <td>{f.label}</td>
                <td>{t(`scope.${f.scope}`)}</td>
                <td>{t(`section.${f.section}`)}</td>
                <td>{f.type}</td>
                <td>{f.required ? '✓' : ''}</td>
                <td className="text-right">
                  {editable && (
                    <button
                      onClick={() => void run(() => repo.deleteField(f.id))}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {t('admin.delete')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <div className="mt-3">
            <FieldForm busy={busy} onSubmit={(f) => void run(() => repo.addField(version.id, f))} />
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 font-medium">{t('admin.rules')}</h3>
        <ul className="space-y-1 text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1">
              <code className="text-xs">{JSON.stringify(r.rule)}</code>
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
              busy={busy}
              onSubmit={(rule, message, severity) => void run(() => repo.addRule(version.id, rule, message, severity))}
            />
          </div>
        )}
      </div>
    </section>
  );
}
