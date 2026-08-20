import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MoreHorizontal } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { Template, TemplateVersion } from '../../data/types';
import { currentTemplateVersion, draftTemplateVersion, preferredTemplateVersion } from '../../domain/templateVersions';
import { useToast } from '../../components/Toast';
import { Menu, MenuItem } from '../../components/Menu';
import { TemplateVersionEditor } from './TemplateVersionEditor';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';

type TemplateWithVersions = Template & { versions: TemplateVersion[] };

export function TemplatesAdmin() {
  const repo = useTemplateRepository();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateWithVersions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ versionId: string; templateName: string } | null>(null);
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
      setSelected({ versionId: version.id, templateName: name.trim() });
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

  // D1 — meme motif que "Mes gabarits" : le refus serveur doit etre visible au point de clic
  // et la confirmation se refermer meme en cas d'echec.
  async function removeTemplate(id: string) {
    setBusy(true);
    setError(null);
    try {
      await repo.deleteTemplate(id);
      await reload();
      toast(t('admin.template_deleted'));
    } catch (e) {
      toast(msg(e), 'warning');
    } finally {
      setConfirmId(null);
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <TemplateVersionEditor
        versionId={selected.versionId}
        templateName={selected.templateName}
        onBack={() => {
          setSelected(null);
          void reload();
        }}
      />
    );
  }

  return (
    <section className="space-y-5 sm:space-y-6">
      <PageHeader
        title={t('staff.admin.title')}
        actions={<button onClick={() => navigate('/admin/roles')} className="btn-secondary w-full sm:w-auto">
          {t('roleadmin.title')}
        </button>}
      />

      <form onSubmit={create} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <label className="form-label">
          {t('admin.name')}
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="form-label">
          {t('admin.specialty')}
          <input
            className="input"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy} className={busy ? 'btn-primary btn-pending w-full' : 'btn-primary w-full'}>
          {t('admin.new_template')}
        </button>
      </form>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <SkeletonList rows={4} label={t('common.loading')} />}
      {!loading && templates.length === 0 && <p className="text-slate-500">{t('admin.no_templates')}</p>}

       <ul className="grid gap-3 sm:grid-cols-2">
         {templates.map((tpl) => {
           const preferred = preferredTemplateVersion(tpl.versions);
           const current = currentTemplateVersion(tpl.versions);
           const draft = draftTemplateVersion(tpl.versions);
           return (
           <li key={tpl.id} className="card relative flex min-h-44 flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              {editId === tpl.id ? (
                <div className="grid min-w-0 flex-1 gap-3">
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={t('admin.name')} />
                  <input className="input" value={editSpec} onChange={(e) => setEditSpec(e.target.value)} aria-label={t('admin.specialty')} placeholder={t('admin.specialty')} />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => void saveEdit()} disabled={busy} className={busy ? 'btn-primary btn-pending' : 'btn-primary'}>{t('admin.save')}</button>
                    <button onClick={() => setEditId(null)} className="btn-secondary">{t('common.cancel')}</button>
                  </div>
                </div>
              ) : (
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">{tpl.name}</h2>
                  {tpl.specialty && <p className="mt-1 text-sm text-slate-500">{tpl.specialty}</p>}
                  <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs ${tpl.isGlobal ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>
                    {t(`model.${tpl.isGlobal ? 'global' : 'personal'}` as const)}
                  </span>
                </div>
              )}
              {editId !== tpl.id && (
                <Menu
                  triggerLabel={`${t('common.actions')} · ${tpl.name}`}
                  triggerClassName="icon-button h-11 w-11 cursor-pointer"
                  triggerContent={<MoreHorizontal size={20} aria-hidden />}
                  panelClassName="card absolute right-0 z-10 mt-2 w-56 space-y-1 p-2 shadow-lg"
                >
                  {!tpl.isGlobal && (
                    <MenuItem onSelect={() => void run(() => repo.promoteToGlobal(tpl.id))} disabled={busy} className="btn-ghost w-full justify-start text-teal-700">
                      {t('admin.promote_global')}
                    </MenuItem>
                  )}
                  <MenuItem onSelect={() => startEdit(tpl)} className="btn-ghost w-full justify-start">{t('admin.rename')}</MenuItem>
                  <MenuItem onSelect={() => setConfirmId(tpl.id)} className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium text-red-600 hover:bg-red-50">{t('admin.delete_template')}</MenuItem>
                </Menu>
              )}
            </div>
            {confirmId === tpl.id && (
              <div className="surface-muted mt-4 flex flex-wrap items-center gap-2 p-3 text-sm" role="status">
                <span className="mr-auto text-slate-600">{t('admin.confirm_delete')}</span>
                <button onClick={() => void removeTemplate(tpl.id)} disabled={busy} className="font-medium text-red-600 hover:underline">{t('common.yes')}</button>
                <button onClick={() => setConfirmId(null)} className="font-medium text-slate-500 hover:text-slate-700">{t('common.no')}</button>
              </div>
            )}
             <button
               type="button"
               className="mt-auto w-full rounded-xl border border-teal-100 bg-teal-50/60 p-3 text-left transition hover:border-teal-300 hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
               onClick={() => preferred && setSelected({ versionId: preferred.id, templateName: tpl.name })}
               disabled={!preferred}
             >
               <span className="flex items-center justify-between gap-3">
                 <span className="text-sm font-semibold text-teal-900">{t('admin.open_template')}</span>
                 <span aria-hidden className="text-lg text-teal-700">→</span>
               </span>
               {preferred ? (
                 <span className="mt-1 block text-xs text-teal-800">
                   {draft && draft.id === preferred.id ? t('admin.version_in_progress') : t('admin.current_version')}
                   {' · '}{t('admin.version')} {preferred.versionNumber} · {t(`status.${preferred.status}`)}
                 </span>
               ) : (
                 <span className="mt-1 block text-xs text-slate-500">{t('admin.no_templates')}</span>
               )}
               {draft && current && draft.id !== current.id && (
                 <span className="mt-1 block text-xs font-medium text-teal-700">{t('admin.new_version_available')}</span>
               )}
             </button>
             {current && (
               <p className="mt-3 text-xs text-slate-500">
                 {t('admin.current_version')} : {t('admin.version')} {current.versionNumber} · {t(`status.${current.status}`)}
                 {typeof current.fieldCount === 'number' && ` · ${t('admin.variable_count').replace('{n}', String(current.fieldCount))}`}
               </p>
             )}
             <p className="mt-1 text-xs text-slate-500">{t('admin.version_explanation')}</p>
             <details className="mt-3 border-t border-slate-100 pt-3">
               <summary className="cursor-pointer text-sm font-medium text-slate-700">{t('admin.version_history')} ({tpl.versions.length})</summary>
               <div className="mt-2 space-y-2">
                 {[...tpl.versions].sort((a, b) => b.versionNumber - a.versionNumber).map((v) => (
                   <button
                     key={v.id}
                     type="button"
                     onClick={() => setSelected({ versionId: v.id, templateName: tpl.name })}
                     className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                   >
                     <span>{t('admin.open_version')} {v.versionNumber}</span>
                     <span className="badge">{t(`status.${v.status}`)}</span>
                   </button>
                 ))}
               </div>
             </details>
           </li>
           );
         })}
       </ul>
    </section>
  );
}
