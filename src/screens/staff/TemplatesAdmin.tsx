import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { Template, TemplateVersion } from '../../data/types';
import { TemplateVersionEditor } from './TemplateVersionEditor';

type TemplateWithVersions = Template & { versions: TemplateVersion[] };

export function TemplatesAdmin() {
  const repo = useTemplateRepository();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [templates, setTemplates] = useState<TemplateWithVersions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [busy, setBusy] = useState(false);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await repo.listTemplates());
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { version } = await repo.createTemplate(name.trim(), specialty.trim() || null);
      setName('');
      setSpecialty('');
      await reload();
      setSelected(version.id);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

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

  if (selected) {
    return (
      <TemplateVersionEditor
        versionId={selected}
        onBack={() => {
          setSelected(null);
          void reload();
        }}
      />
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('staff.admin.title')}</h1>
        <button
          onClick={() => navigate('/admin/roles')}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          {t('roleadmin.title')}
        </button>
      </div>

      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50 p-3">
        <label className="flex flex-col text-xs text-slate-600">
          {t('admin.name')}
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          {t('admin.specialty')}
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-teal-700 px-3 py-1 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {t('admin.new_template')}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-slate-500">{t('common.loading')}</p>}
      {!loading && templates.length === 0 && <p className="text-slate-500">{t('admin.no_templates')}</p>}

      <ul className="space-y-2">
        {templates.map((tpl) => (
          <li key={tpl.id} className="rounded border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">
                {tpl.name}
                {tpl.specialty && <span className="ml-2 text-sm text-slate-500">({tpl.specialty})</span>}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tpl.isGlobal ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>
                  {t(`model.${tpl.isGlobal ? 'global' : 'personal'}` as const)}
                </span>
              </div>
              {!tpl.isGlobal && (
                <button
                  onClick={() => void run(() => repo.promoteToGlobal(tpl.id))}
                  disabled={busy}
                  className="rounded border border-teal-600 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60"
                >
                  {t('admin.promote_global')}
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {tpl.versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v.id)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                >
                  {t('admin.version')} {v.versionNumber} · {t(`status.${v.status}`)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
