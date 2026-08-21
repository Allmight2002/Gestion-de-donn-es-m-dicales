import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileText, MoreHorizontal } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { Template, TemplateVersion } from '../../data/types';
import { currentTemplateVersion, preferredTemplateVersion } from '../../domain/templateVersions';
import { useToast } from '../../components/Toast';
import { Menu, MenuItem } from '../../components/Menu';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { TemplateVersionEditor } from '../staff/TemplateVersionEditor';

type Tpl = Template & { versions: TemplateVersion[] };

// "Mes gabarits" cote MEDECIN : gerer ses gabarits PERSONNELS (crees en copiant un modele a
// la creation d'une base). Renommer / supprimer (RLS owns_template) et editer la structure
// d'une version brouillon (reutilise TemplateVersionEditor, sans les actions admin
// publier/dupliquer). Les modeles GLOBAUX (admin) ne sont pas listes ici.
export function MyTemplates() {
  const repo = useTemplateRepository();
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ versionId: string; templateName: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const createOperationKey = useRef<string | null>(null);

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
  // D1 — le serveur REFUSE de supprimer un gabarit utilise par une base. Ce refus doit se voir
  // AU POINT DE CLIC : meme toast que le succes (le message d'erreur en haut de page passait
  // inapercu), et la confirmation se referme dans TOUS les cas, succes comme echec.
  async function removeTemplate(id: string) {
    setBusy(true);
    setError(null);
    try {
      await repo.deleteTemplate(id);
      await reload();
      toast(t('mytemplates.deleted'));
    } catch (e) {
      toast(msg(e), 'warning');
    } finally {
      setConfirmId(null);
      setBusy(false);
    }
  }
  // Cree un gabarit personnel vierge puis ouvre directement son editeur pour ajouter les variables.
  async function createTemplate() {
    if (!newName.trim()) return;
    await run(async () => {
      const result = await repo.createTemplateBundle({
        name: newName.trim(), specialty: newSpec.trim() || null,
        operationKey: createOperationKey.current ?? (createOperationKey.current = crypto.randomUUID()),
      });
      setNewName('');
      setNewSpec('');
      createOperationKey.current = null;
       setSelected({ versionId: result.versionId, templateName: newName.trim() });
    });
  }

  // Edition de la structure d'une version (reutilise l'editeur, sans actions admin).
  if (selected) {
    return (
      <TemplateVersionEditor
        versionId={selected.versionId}
        templateName={selected.templateName}
        showVersionActions={false}
        onNewVersion={(id) => setSelected({ ...selected, versionId: id })}
        onBack={() => { setSelected(null); void reload(); }}
      />
    );
  }

  return (
    <section className="max-w-5xl space-y-5 sm:space-y-6">
      <PageHeader title={t('mytemplates.title')} />

      <SectionCard title={t('mytemplates.create')} icon={FileText}>
        <form onSubmit={(e) => { e.preventDefault(); void createTemplate(); }} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-label">
              {t('admin.name')}
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </label>
            <label className="form-label">
              {t('admin.specialty')}
              <input className="input" value={newSpec} onChange={(e) => setNewSpec(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <button type="submit" disabled={busy || !newName.trim()} className="btn-primary w-full">{t('mytemplates.create')}</button>
            <button type="button" onClick={() => navigate('/templates/from-file')} className="btn-secondary w-full">{t('mytemplates.from_file')}</button>
            <button type="button" onClick={() => navigate('/templates/library')} className="btn-secondary w-full">{t('tlib.title')}</button>
          </div>
        </form>
      </SectionCard>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <SkeletonList rows={3} label={t('common.loading')} />}
      {!loading && templates.length === 0 && (
        <EmptyState icon={FileText} title={t('mytemplates.empty')} />
      )}

       <ul className="card divide-y divide-slate-200 overflow-hidden dark:divide-slate-800">
         {templates.map((tpl) => {
           const preferred = preferredTemplateVersion(tpl.versions);
           const current = currentTemplateVersion(tpl.versions);
           const variableCount = preferred?.fieldCount ?? current?.fieldCount;
           return (
           <li key={tpl.id} className="relative p-4">
             <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="text-base font-semibold text-slate-900">{tpl.name}</h2>
                    {tpl.specialty && <p className="text-sm text-slate-500">{tpl.specialty}</p>}
                    {typeof variableCount === 'number' && (
                      <span className="text-xs text-slate-500">
                        {t('admin.variable_count').replace('{n}', String(variableCount))}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {editId !== tpl.id && (
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                  <button
                    type="button"
                    className="btn-secondary min-w-0 flex-1 sm:flex-none"
                    onClick={() => preferred && setSelected({ versionId: preferred.id, templateName: tpl.name })}
                    disabled={!preferred}
                  >
                    <span>{t('admin.open_template')}</span>
                    <span aria-hidden className="text-lg">→</span>
                  </button>
                  <Menu
                    triggerLabel={`${t('common.actions')} · ${tpl.name}`}
                    triggerClassName="icon-button h-11 w-11 cursor-pointer"
                    triggerContent={<MoreHorizontal size={20} aria-hidden />}
                    panelClassName="card absolute right-0 z-10 mt-2 w-48 space-y-1 p-2 shadow-lg"
                  >
                    <MenuItem onSelect={() => startEdit(tpl)} className="btn-ghost w-full justify-start">
                      {t('admin.rename')}
                    </MenuItem>
                    <MenuItem onSelect={() => setConfirmId(tpl.id)} className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium text-red-600 hover:bg-red-50">
                      {t('admin.delete_template')}
                    </MenuItem>
                  </Menu>
                </div>
              )}
            </div>
            {confirmId === tpl.id && (
              <div className="surface-muted mt-3 flex flex-wrap items-center gap-2 p-3 text-sm" role="status">
                <span className="mr-auto text-slate-600">{t('admin.confirm_delete')}</span>
                <button onClick={() => void removeTemplate(tpl.id)} disabled={busy} className="font-medium text-red-600 hover:underline">{t('common.yes')}</button>
                <button onClick={() => setConfirmId(null)} className="font-medium text-slate-500 hover:text-slate-700">{t('common.no')}</button>
              </div>
            )}
           </li>
           );
         })}
       </ul>
    </section>
  );
}
