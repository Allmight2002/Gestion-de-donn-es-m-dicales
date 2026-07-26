import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
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
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  function startEdit(tpl: TemplateWithVersions) {
    setEditId(tpl.id);
    setEditName(tpl.name);
    setEditSpec(tpl.specialty ?? '');
  }
  async function saveEdit() {
    if (!editId || !editName.trim()) return;
    await run(() => repo.renameTemplate(editId, editName.trim(), editSpec.trim() || null));
    setEditId(null);
  }

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
        <h1 className="page-title">{t('staff.admin.title')}</h1>
        <button onClick={() => navigate('/admin/roles')} className="btn-secondary">
          {t('roleadmin.title')}
        </button>
      </div>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-2 p-4">
        <label className="flex flex-col text-xs text-slate-600">
          {t('admin.name')}
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          {t('admin.specialty')}
          <input
            className="input"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy} className="btn-primary">
          {t('admin.new_template')}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-slate-500">{t('common.loading')}</p>}
      {!loading && templates.length === 0 && <p className="text-slate-500">{t('admin.no_templates')}</p>}

      <ul className="space-y-2">
        {templates.map((tpl) => (
          <li key={tpl.id} className="card p-4">
            <div className="flex items-center justify-between gap-2">
              {editId === tpl.id ? (
                <div className="flex flex-wrap items-end gap-2">
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={t('admin.name')} />
                  <input className="input" value={editSpec} onChange={(e) => setEditSpec(e.target.value)} aria-label={t('admin.specialty')} placeholder={t('admin.specialty')} />
                  <button onClick={() => void saveEdit()} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">{t('admin.save')}</button>
                  <button onClick={() => setEditId(null)} className="text-xs font-medium text-slate-500 hover:text-slate-700">{t('common.cancel')}</button>
                </div>
              ) : (
                <div className="font-medium">
                  {tpl.name}
                  {tpl.specialty && <span className="ml-2 text-sm text-slate-500">({tpl.specialty})</span>}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tpl.isGlobal ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>
                    {t(`model.${tpl.isGlobal ? 'global' : 'personal'}` as const)}
                  </span>
                </div>
              )}
              {editId !== tpl.id && (
                <div className="flex flex-wrap items-center gap-3">
                  {!tpl.isGlobal && (
                    <button
                      onClick={() => void run(() => repo.promoteToGlobal(tpl.id))}
                      disabled={busy}
                      className="rounded-lg border border-teal-600 px-2.5 py-1 text-xs font-medium text-teal-700 transition hover:bg-teal-50 disabled:opacity-60"
                    >
                      {t('admin.promote_global')}
                    </button>
                  )}
                  <button onClick={() => startEdit(tpl)} className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline">{t('admin.rename')}</button>
                  {confirmId === tpl.id ? (
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span className="text-slate-600">{t('admin.confirm_delete')}</span>
                      <button onClick={() => void run(async () => { await repo.deleteTemplate(tpl.id); setConfirmId(null); })} disabled={busy} className="font-medium text-red-600 hover:underline">{t('common.yes')}</button>
                      <button onClick={() => setConfirmId(null)} className="font-medium text-slate-500 hover:text-slate-700">{t('common.no')}</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmId(tpl.id)} className="text-xs font-medium text-red-600 hover:underline">{t('admin.delete_template')}</button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {tpl.versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v.id)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:bg-slate-50"
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
