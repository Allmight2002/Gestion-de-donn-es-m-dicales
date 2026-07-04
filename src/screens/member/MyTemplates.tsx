import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { Template, TemplateVersion } from '../../data/types';
import { TemplateVersionEditor } from '../staff/TemplateVersionEditor';

type Tpl = Template & { versions: TemplateVersion[] };

// "Mes gabarits" cote MEDECIN : gerer ses gabarits PERSONNELS (crees en copiant un modele a
// la creation d'une base). Renommer / supprimer (RLS owns_template) et editer la structure
// d'une version brouillon (reutilise TemplateVersionEditor, sans les actions admin
// publier/dupliquer). Les modeles GLOBAUX (admin) ne sont pas listes ici.
export function MyTemplates() {
  const repo = useTemplateRepository();
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newSpec, setNewSpec] = useState('');

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const all = await repo.listTemplates();
      setTemplates(all.filter((tpl) => !tpl.isGlobal && tpl.ownerUserId === user?.id));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, user?.id]);

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
  function startEdit(tpl: Tpl) {
    setEditId(tpl.id);
    setEditName(tpl.name);
    setEditSpec(tpl.specialty ?? '');
  }
  async function saveEdit() {
    if (!editId || !editName.trim()) return;
    await run(() => repo.renameTemplate(editId, editName.trim(), editSpec.trim() || null));
    setEditId(null);
  }
  // Cree un gabarit personnel vierge puis ouvre directement son editeur pour ajouter les variables.
  async function createTemplate() {
    if (!newName.trim()) return;
    await run(async () => {
      const v = await repo.createPersonalTemplate(newName.trim(), newSpec.trim() || null);
      setNewName('');
      setNewSpec('');
      setSelected(v.id);
    });
  }

  // Edition de la structure d'une version (reutilise l'editeur, sans actions admin).
  if (selected) {
    return <TemplateVersionEditor versionId={selected} showVersionActions={false} onNewVersion={(id) => setSelected(id)} onBack={() => { setSelected(null); void reload(); }} />;
  }

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <button onClick={() => navigate('/')} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('base.back_to_dashboard')}</button>
        <h1 className="page-title mt-2">{t('mytemplates.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('mytemplates.hint')}</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void createTemplate(); }} className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('mytemplates.create')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
            {t('admin.name')}
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </label>
          <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
            {t('admin.specialty')}
            <input className="input" value={newSpec} onChange={(e) => setNewSpec(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !newName.trim()} className="btn-primary">{t('mytemplates.create')}</button>
          <button type="button" onClick={() => navigate('/templates/from-file')} className="btn-secondary">{t('mytemplates.from_file')}</button>
          <button type="button" onClick={() => navigate('/templates/library')} className="btn-secondary">{t('tlib.title')}</button>
        </div>
      </form>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-slate-500">{t('common.loading')}</p>}
      {!loading && templates.length === 0 && (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('mytemplates.empty')}</div>
      )}

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
                </div>
              )}
              {editId !== tpl.id && (
                <div className="flex flex-wrap items-center gap-3">
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
                <button key={v.id} onClick={() => setSelected(v.id)} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:bg-slate-50">
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
