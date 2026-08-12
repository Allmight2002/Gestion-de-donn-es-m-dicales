import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Download, Settings, Trash2, UserPlus } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { BaseListing, ObservationModel } from '../../data/bases';
import { getTemplateFields } from '../../data/templates';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SectionCard } from '../../components/SectionCard';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import {
  downloadBaseSnapshot, isOfflineEnabled, offlineCache, snapshotMeta, MAX_OFFLINE_PATIENTS,
  type OfflineMeta, type SnapshotSource,
} from '../../data/offline';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

// Reglages d'une base : ce qu'on regle au demarrage puis presque plus jamais. Ces actions
// vivaient dans le menu « … » de la liste des patients, ou elles disputaient la place a la
// saisie quotidienne. Les ecrans de structure (variables, acces, journal) restent des ecrans
// a part entiere, atteints par les sous-onglets de BaseLayout.
export function BaseSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const patients = usePatientRepository();
  const templates = useTemplateRepository();

  const [listing, setListing] = useState<BaseListing | null>(null);
  const [total, setTotal] = useState(0);
  const [cachedMeta, setCachedMeta] = useState<OfflineMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionName, setDeletionName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [changingObservationModel, setChangingObservationModel] = useState(false);

  const load = useCallback(async (isCancelled: () => boolean) => {
    if (!id) return;
    setLoading(true);
    try {
      const base = await bases.getBase(id);
      if (isCancelled()) return;
      setListing(base);
      setError(null);
      // Le nombre de patients ne sert qu'au seuil de confirmation du telechargement :
      // son echec ne doit pas empecher d'ouvrir les reglages.
      void patients.listPatientsPage(id, 1, 0)
        .then((page) => { if (!isCancelled()) setTotal(page.total); })
        .catch(() => {});
      void offlineCache.get(id)
        .then((snapshot) => { if (!isCancelled()) setCachedMeta(snapshot ? snapshotMeta(snapshot) : null); })
        .catch(() => {});
    } catch (e) {
      if (!isCancelled()) setError(errorMessage(e, t('common.error')));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, bases, patients]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const doDownloadSnapshot = useCallback(async () => {
    if (!id) return;
    if (!isOfflineEnabled()) {
      setError('Mode hors-ligne desactive par la politique de securite de cet environnement.');
      return;
    }
    setSaving(true);
    try {
      const src: SnapshotSource = {
        // §8 : un seul aller-retour (RPC) ; les methodes ci-dessous restent le repli.
        fetchSnapshot: (bid) => patients.fetchBaseSnapshot(bid),
        getBase: (bid) =>
          bases.getBase(bid).then((b) => (b ? { base: { id: b.base.id, name: b.base.name, currentTemplateVersionId: b.base.currentTemplateVersionId } } : null)),
        listPatients: (bid) => patients.listPatients(bid),
        listEncounters: (pid) => patients.listEncounters(pid),
        getFields: (vid) =>
          getTemplateFields(templates, vid).then((fields) =>
            fields.map((f) => ({ id: f.id, fieldKey: f.fieldKey, label: f.label, scope: f.scope, type: f.type, displayOrder: f.displayOrder })),
          ),
      };
      setCachedMeta(await downloadBaseSnapshot(id, src));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setSaving(false);
    }
  }, [id, bases, patients, templates, t]);

  // §5.8 : au-dela du seuil, l'instantane est un gros bloc -> confirmation avant telechargement.
  const makeAvailableOffline = useCallback(async () => {
    if (total > MAX_OFFLINE_PATIENTS) { setConfirmLarge(true); return; }
    await doDownloadSnapshot();
  }, [total, doDownloadSnapshot]);

  const removeOffline = useCallback(async () => {
    if (!id) return;
    await offlineCache.remove(id);
    setCachedMeta(null);
  }, [id]);

  const deleteBase = useCallback(async () => {
    if (!id || !listing || listing.role !== 'owner') return;
    if (!deletionReason.trim() || deletionName.trim() !== listing.base.name) return;
    setDeleting(true);
    try {
      await bases.softDeleteBase(id, deletionReason.trim());
      // Une base supprimee ne doit jamais rester consultable dans le cache local.
      await offlineCache.remove(id);
      navigate('/');
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setDeleting(false);
    }
  }, [id, listing, deletionReason, deletionName, bases, navigate, t]);

  const observationModel: ObservationModel = listing?.base.observationModel ?? 'longitudinal';
  const changeObservationModel = useCallback(async (next: ObservationModel) => {
    if (!id || !listing || next === observationModel) return;
    setChangingObservationModel(true);
    try {
      await bases.setObservationModel(id, next);
      await load(() => false);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setChangingObservationModel(false);
    }
  }, [id, listing, observationModel, bases, load, t]);

  if (loading) return <SkeletonList rows={5} />;
  if (!listing) return <p className="text-slate-500">{t('notfound.title')}</p>;

  const isOwner = listing.role === 'owner';
  // Un acces a echeance (compte de mission) ne pose pas de copie locale de la base.
  const canManageOffline = listing.expiresAt == null;

  return (
    <section className="space-y-5">
      <ConfirmDialog
        open={confirmLarge}
        title={t('offline.make_available')}
        body={t('offline.large_confirm').replace('{n}', String(total))}
        busy={saving}
        onCancel={() => setConfirmLarge(false)}
        onConfirm={() => { setConfirmLarge(false); void doDownloadSnapshot(); }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('base.delete_title')}
        body={t('base.delete_body')}
        confirmLabel={t('base.delete_confirm')}
        confirmDisabled={!deletionReason.trim() || deletionName.trim() !== listing.base.name}
        danger
        busy={deleting}
        onCancel={() => {
          setConfirmDelete(false);
          setDeletionReason('');
          setDeletionName('');
        }}
        onConfirm={() => void deleteBase()}
      >
        <div className="space-y-3 pt-1">
          <label className="form-label">
            {t('base.delete_reason')}
            <textarea
              className="input mt-1 min-h-20"
              value={deletionReason}
              maxLength={500}
              onChange={(event) => setDeletionReason(event.target.value)}
            />
          </label>
          <label className="form-label">
            {t('base.delete_name_confirm')}
            <input
              className="input mt-1"
              value={deletionName}
              placeholder={t('base.delete_name_hint').replace('{name}', listing.base.name)}
              onChange={(event) => setDeletionName(event.target.value)}
            />
          </label>
        </div>
      </ConfirmDialog>

      <PageHeader title={t('base.tab_settings')} description={t('base.settings_subtitle')} />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {isOwner && (
        <SectionCard title={t('observation.model_label')} description={t('observation.empty_only_hint')} icon={Settings}>
          <label className="form-label max-w-md">
            {t('observation.model_label')}
            <select
              className="input mt-1"
              value={observationModel}
              disabled={changingObservationModel || total > 0}
              onChange={(event) => void changeObservationModel(event.target.value as ObservationModel)}
            >
              <option value="cross_sectional">{t('observation.cross_sectional')}</option>
              <option value="longitudinal">{t('observation.longitudinal')}</option>
              <option value="event_registry">{t('observation.event_registry')}</option>
            </select>
          </label>
        </SectionCard>
      )}

      <SectionCard title={t('offline.available')} description={t('offline.identity_unavailable')} icon={Download}>
        {cachedMeta ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-slate-500">
              {t('offline.cached_at')} {fmtDate(cachedMeta.cachedAt)} · {t('offline.expires_at')} {fmtDate(cachedMeta.expiresAt)}
            </span>
            {canManageOffline && (
              <button type="button" onClick={() => void makeAvailableOffline()} disabled={saving} className="btn-secondary">
                {saving ? t('offline.saving') : t('offline.update')}
              </button>
            )}
            <button type="button" onClick={() => void removeOffline()} className="text-sm font-medium text-slate-500 hover:text-red-600 hover:underline">
              {t('offline.remove')}
            </button>
          </div>
        ) : canManageOffline ? (
          <button type="button" onClick={() => void makeAvailableOffline()} disabled={saving} className="btn-secondary">
            <Download size={16} aria-hidden /> {saving ? t('offline.saving') : t('offline.make_available')}
          </button>
        ) : (
          <p className="text-sm text-slate-500">{t('offline.no_bases')}</p>
        )}
      </SectionCard>

      {/* Les comptes de mission sont geres depuis la barre laterale, pour toutes les bases a la
          fois : on garde le point d'entree ici pour ne pas avoir a sortir de la base de tete. */}
      {isOwner && (
        <SectionCard title={t('mission.tab')} description={t('mission.global_subtitle')} icon={UserPlus}>
          <Link to="/missions" className="btn-secondary">
            <UserPlus size={16} aria-hidden /> {t('mission.global_title')}
          </Link>
        </SectionCard>
      )}

      {isOwner && (
        <SectionCard title={t('base.settings_danger')} description={t('base.delete_body')} icon={Trash2}>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            {t('base.delete')}
          </button>
        </SectionCard>
      )}
    </section>
  );
}
