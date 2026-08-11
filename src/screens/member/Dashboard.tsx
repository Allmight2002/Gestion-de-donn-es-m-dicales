import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronDown, Database, Plus, UserPlus, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { canCreateBase, isMissionAccount } from '../../auth/logic';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { BaseListing, DeletedBase, ObservationModel, PublishedTemplateOption } from '../../data/bases';
import { offlineCache, useOnline, type OfflineMeta } from '../../data/offline';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';

// Tableau de bord (cahier §8.3) : bases possedees + partagees. La creation de base est
// reservee au role MEDECIN (le staff voit seulement les bases auxquelles il a acces).
export function Dashboard() {
  const repo = useBaseRepository();
  const { profile } = useAuth();
  const { t } = useI18n();
  const online = useOnline();
  const mayCreate = canCreateBase(profile);
  const isMission = isMissionAccount(profile);
  const navigate = useNavigate();
  const [bases, setBases] = useState<BaseListing[]>([]);
  const [deletedBases, setDeletedBases] = useState<DeletedBase[]>([]);
  const [offlineBases, setOfflineBases] = useState<OfflineMeta[]>([]);
  const [templates, setTemplates] = useState<PublishedTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [versionId, setVersionId] = useState('');
  const [observationModel, setObservationModel] = useState<ObservationModel>('longitudinal');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<DeletedBase | null>(null);
  const [restoring, setRestoring] = useState(false);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (!online) {
        // HORS-LIGNE : seules les bases enregistrees localement sont consultables.
        setOfflineBases(await offlineCache.list());
        setDeletedBases([]);
        setError(null);
        return;
      }
      const [b, tpl, deleted] = await Promise.all([
        repo.listMyBases(),
        repo.listTemplateModels(),
        mayCreate ? repo.listDeletedBases() : Promise.resolve([]),
      ]);
      setBases(b);
      setDeletedBases(deleted);
      setTemplates(tpl);
      setVersionId((prev) => prev || tpl[0]?.versionId || '');
      void offlineCache.list().then(setOfflineBases).catch(() => {});
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, online, mayCreate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !versionId) return;
    setBusy(true);
    try {
      const base = await repo.createBase(name.trim(), specialty.trim() || null, versionId, observationModel);
      setName('');
      setSpecialty('');
      setCreateOpen(false);
      await reload();
      navigate(`/bases/${base.id}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function restoreBase() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      await repo.restoreDeletedBase(restoreTarget.id);
      setRestoreTarget(null);
      await reload();
    } catch (e) {
      setError(msg(e));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      <ConfirmDialog
        open={restoreTarget !== null}
        title={t('base.restore_title')}
        body={t('base.restore_body')}
        confirmLabel={t('base.restore_confirm')}
        busy={restoring}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void restoreBase()}
      />
      <PageHeader
        title={t('member.dashboard.title')}
        description={t('dashboard.subtitle')}
        actions={mayCreate && online && (
          <>
            <Link to="/missions" className="btn-secondary">
              <UserPlus size={16} aria-hidden /> {t('mission.global_title')}
            </Link>
            <button
              type="button"
              onClick={() => setCreateOpen((open) => !open)}
              className={createOpen ? 'btn-secondary' : 'btn-primary'}
              aria-expanded={createOpen}
            >
              {createOpen ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
              {createOpen ? t('common.cancel') : t('dashboard.new_base')}
            </button>
          </>
        )}
      />

      {mayCreate && online && createOpen && (
        <SectionCard
          title={t('dashboard.create_base')}
          description={t('dashboard.create_hint')}
          icon={Database}
        >
          <form onSubmit={create} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="form-label">
              {t('dashboard.base_name')}
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="form-label">
              {t('admin.specialty')}
              <input className="input" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
            </label>
            <label className="form-label">
              {t('dashboard.gabarit')}
              {/* V1 : modeles OFFICIELS (admin) et jeux de variables PERSONNELS separes en groupes. */}
              <select className="input" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                {templates.some((tpl) => tpl.scope === 'global') && (
                  <optgroup label={t('dashboard.models_official')}>
                    {templates.filter((tpl) => tpl.scope === 'global').map((tpl) => (
                      <option key={tpl.versionId} value={tpl.versionId}>{tpl.name}</option>
                    ))}
                  </optgroup>
                )}
                {templates.some((tpl) => tpl.scope === 'personal') && (
                  <optgroup label={t('dashboard.models_personal')}>
                    {templates.filter((tpl) => tpl.scope === 'personal').map((tpl) => (
                      <option key={tpl.versionId} value={tpl.versionId}>{tpl.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="form-label">
              {t('observation.model_label')}
              <select className="input" value={observationModel} onChange={(e) => setObservationModel(e.target.value as ObservationModel)}>
                <option value="cross_sectional">{t('observation.cross_sectional')}</option>
                <option value="longitudinal">{t('observation.longitudinal')}</option>
                <option value="event_registry">{t('observation.event_registry')}</option>
              </select>
              <span className="helper-text">{t('observation.creation_hint')}</span>
            </label>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/templates/from-file" className="text-sm font-medium text-teal-700 hover:underline">
              {t('dashboard.from_file')}
            </Link>
            <button type="submit" disabled={busy || templates.length === 0} className="btn-primary">
              {t('dashboard.create_base')}
            </button>
          </div>
          </form>
        </SectionCard>
      )}

      {mayCreate && online && templates.length === 0 && !loading && (
        <p className="text-sm text-amber-700">{t('dashboard.no_templates_hint')}</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <SkeletonList rows={3} label={t('common.loading')} />}
      {online && (
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="section-title">{t('dashboard.bases_title')}</h2>
            {!loading && <p className="mt-0.5 text-sm text-slate-500">{t('dashboard.bases_count').replace('{n}', String(bases.length))}</p>}
          </div>
        </div>
        {!loading && bases.length === 0 && isMission ? (
          /* Fin de mission : ni erreur brute, ni ecran vide — on dit ce qui s'est passe
             et ce que devient la saisie deja faite (docs/spec-comptes-mission.md §8). */
          <div className="card space-y-2 p-8 text-center">
            <h3 className="text-base font-semibold text-slate-800">{t('mission.over_title')}</h3>
            <p className="mx-auto max-w-lg text-sm text-slate-500">{t('mission.over_body')}</p>
          </div>
        ) : !loading && bases.length === 0 ? (
          <EmptyState
            icon={Database}
            title={t('dashboard.no_bases')}
            action={mayCreate ? (
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} aria-hidden /> {t('dashboard.new_base')}
              </button>
            ) : undefined}
          />
        ) : (
        <ul className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bases.map((b) => (
          <li key={b.base.id} className="h-full">
            <button
              onClick={() => navigate(`/bases/${b.base.id}`)}
              className="card group flex h-full min-h-44 w-full flex-col gap-3 p-5 text-left transition motion-safe:hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md motion-reduce:transition-none"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/15">
                  <Database size={20} aria-hidden />
                </span>
                <span className="badge">{t(`baserole.${b.role}`)}</span>
              </div>
              <div>
                <div className="font-semibold text-slate-900">{b.base.name}</div>
                {b.base.specialty && <div className="text-sm text-slate-500">{b.base.specialty}</div>}
              </div>
              {b.templateName && (
                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400">
                  <span>{b.templateName} · v{b.versionNumber}</span>
                  <span className="font-medium text-teal-700 transition motion-safe:group-hover:translate-x-0.5 motion-reduce:transition-none">{t('dashboard.open')} →</span>
                </div>
              )}
            </button>
          </li>
        ))}
        </ul>
        )}
      </div>
      )}

      {online && mayCreate && !loading && (
        <details className="group surface-muted overflow-hidden">
          <summary role="button" className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <span className="min-w-0">
              <span className="section-title block">{t('base.trash_title')}</span>
              <span className="mt-0.5 block text-sm text-slate-500">{t('base.trash_hint')}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="badge" aria-label={t('dashboard.bases_count').replace('{n}', String(deletedBases.length))}>{deletedBases.length}</span>
              <ChevronDown size={18} className="text-slate-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
            </span>
          </summary>
          <div className="border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5">
            {deletedBases.length === 0 ? (
              <p className="text-sm text-slate-500">{t('base.trash_empty')}</p>
            ) : (
              <ul className="space-y-3">
                {deletedBases.map((base) => (
                  <li key={base.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-900">{base.name}</h3>
                      <p className="mt-1 text-sm text-slate-500">{base.deletionReason}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {t('base.deleted_on').replace('{date}', new Date(base.deletedAt).toLocaleDateString())}
                        {' · '}
                        {t('base.purge_eligible').replace('{date}', new Date(base.purgeEligibleAt).toLocaleDateString())}
                      </p>
                    </div>
                    <button type="button" className="btn-secondary" onClick={() => setRestoreTarget(base)}>
                      {t('base.restore')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}

      {/* Bases disponibles hors-ligne (consultables sans reseau, donnees analytiques uniquement). */}
      {(!online || offlineBases.length > 0) && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">{t('offline.bases_title')}</h2>
          {offlineBases.length === 0 ? (
            <div className="card border-dashed p-8 text-center text-slate-500">{t('offline.no_bases')}</div>
          ) : (
            <ul className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {offlineBases.map((m) => (
                <li key={m.baseId} className="h-full">
                  <button
                    onClick={() => navigate(`/bases/${m.baseId}`)}
                    className="card group flex h-full min-h-44 w-full flex-col gap-3 p-5 text-left transition motion-safe:hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md motion-reduce:transition-none"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15" aria-hidden>⤓</span>
                      <span className="badge bg-amber-100 text-amber-800">{t('offline.badge')}</span>
                    </div>
                    <div className="font-semibold text-slate-900">{m.baseName}</div>
                    <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400">
                      <span>{m.patientCount} {t('offline.patients')} · {t('offline.cached_at')} {new Date(m.cachedAt).toLocaleDateString()}</span>
                      <span className="text-amber-600 transition motion-safe:group-hover:translate-x-0.5 motion-reduce:transition-none">→</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
