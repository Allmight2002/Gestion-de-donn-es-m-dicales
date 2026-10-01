import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronDown, ChevronRight, Download, Lock, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { BaseListing, ObservationModel } from '../../data/bases';
import { getTemplateFields } from '../../data/templates';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConfirmationCode, normalizeConfirmationCode, randomConfirmationCode } from '../../components/ConfirmationCode';
import { SectionCard } from '../../components/SectionCard';
import { OptionKeyRepairPanel } from './OptionKeyRepairPanel';
import { BaseRenamedContext } from './baseFocus';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import { OfflineReadinessNotice, useAppShellReadiness } from '../../components/OfflineReadiness';
import { formatDate } from '../../lib/formatDate';
import {
  downloadBaseSnapshot, isOfflineEnabled, offlineCache, snapshotMeta, MAX_OFFLINE_PATIENTS,
  type OfflineMeta, type SnapshotSource,
} from '../../data/offline';

const ROW = 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left sm:px-5';

/** Nom d'un reglage et sa valeur actuelle, sur deux lignes : a 360 px, cote a cote, l'un des deux serait coupe. */
function RowText({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
      {value && <span className="block text-sm text-slate-500 dark:text-slate-400">{value}</span>}
    </span>
  );
}

/** Un reglage : sa valeur se lit sans geste, son detail s'ouvre a la demande. */
function SettingRow({ id, label, value, open, onToggle, children }: {
  id: string; label: string; value?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className={ROW}>
        <RowText label={label} value={value} />
        <ChevronDown size={16} aria-hidden className={`shrink-0 text-slate-400 transition motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={id} hidden={!open} className="space-y-3 px-4 pb-4 text-sm sm:px-5">{children}</div>
    </li>
  );
}

// Reglages d'une base : ce qu'on regle au demarrage puis presque plus jamais. Ces actions
// vivaient dans le menu « … » de la liste des patients, ou elles disputaient la place a la
// saisie quotidienne. Les ecrans de structure (variables, acces, journal) restent des ecrans
// a part entiere, atteints par les sous-onglets de BaseLayout.
export function BaseSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
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
  const [deletionCode, setDeletionCode] = useState<string | null>(null);
  const [deletionCodeInput, setDeletionCodeInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [changingObservationModel, setChangingObservationModel] = useState(false);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const onBaseRenamed = useContext(BaseRenamedContext);
  const toggleRow = (key: string) => setOpenRows((rows) => ({ ...rows, [key]: !rows[key] }));
  // La coquille ne se verifie que la ou une disponibilite hors-ligne est annoncee.
  const { readiness: shellReadiness, checking: shellChecking, check: shellCheck } = useAppShellReadiness(isOfflineEnabled() && cachedMeta !== null);

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
      await shellCheck();
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setSaving(false);
    }
  }, [id, bases, patients, templates, t, shellCheck]);

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
    if (!deletionCode || normalizeConfirmationCode(deletionCodeInput) !== deletionCode) return;
    setDeleting(true);
    try {
      // Le code affiche suffit a confirmer : aucun motif n'est demande pour la mise en corbeille.
      await bases.softDeleteBase(id, '');
      // Une base supprimee ne doit jamais rester consultable dans le cache local.
      await offlineCache.remove(id);
      navigate('/');
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setDeleting(false);
    }
  }, [id, listing, deletionCode, deletionCodeInput, bases, navigate, t]);

  // Un nouveau code a chaque ouverture : on ne recopie pas machinalement celui de la fois d'avant.
  const openDelete = () => {
    setDeletionCode(randomConfirmationCode());
    setDeletionCodeInput('');
    setConfirmDelete(true);
  };

  // Le nom lu part avec le nouveau : si la base a ete renommee ailleurs entre-temps, le serveur
  // refuse au lieu d'ecraser, et la saisie reste dans le champ.
  const renameBase = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!id || !listing || listing.role !== 'owner') return;
    const next = nameDraft.trim();
    if (!next || next === listing.base.name) return;
    setRenaming(true);
    try {
      const base = await bases.renameBase(id, next, listing.base.name);
      setListing({ ...listing, base: { ...listing.base, name: base.name } });
      onBaseRenamed?.(base.name);
      setOpenRows((rows) => ({ ...rows, name: false }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setRenaming(false);
    }
  }, [id, listing, nameDraft, bases, onBaseRenamed, t]);

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
  const canRepairOptions = isOwner || listing.permissions.canEditStructuredData;
  // Le modele se choisit tant que la base est vide ; ensuite, il se lit seulement.
  const observationLocked = total > 0;
  const observationLabel = t(`observation.${observationModel}`);

  return (
    <section className="max-w-3xl space-y-5">
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
        body={(
          <>
            <p>{t('base.delete_restorable')}</p>
            {total > 0 && (
              <p className="mt-2 font-medium text-slate-700">
                {total === 1 ? t('base.patients_warning_one') : t('base.patients_warning_other').replace('{count}', String(total))}
              </p>
            )}
          </>
        )}
        confirmLabel={t('base.delete_confirm')}
        confirmDisabled={!deletionCode || normalizeConfirmationCode(deletionCodeInput) !== deletionCode}
        danger
        busy={deleting}
        onCancel={() => {
          setConfirmDelete(false);
          setDeletionCode(null);
          setDeletionCodeInput('');
        }}
        onConfirm={() => void deleteBase()}
      >
        <div className="pt-1">
          <ConfirmationCode
            id="delete-confirmation-code"
            code={deletionCode}
            value={deletionCodeInput}
            disabled={deleting}
            onChange={setDeletionCodeInput}
          />
        </div>
      </ConfirmDialog>

      <PageHeader title={t('base.tab_settings')} description={t('base.settings_subtitle')} />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {/* Audit UI mobile, lot 5 (5.9 Général A) : une liste de reglages en lignes. Chaque ligne
          dit la valeur actuelle ; le detail s'ouvre a la demande. */}
      <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
        {isOwner && (
          <SettingRow id="setting-name" label={t('settings.name')} value={listing.base.name}
            open={!!openRows.name}
            onToggle={() => { if (!openRows.name) setNameDraft(listing.base.name); toggleRow('name'); }}>
            <form onSubmit={(event) => void renameBase(event)} className="flex max-w-md flex-wrap items-end gap-2">
              <label className="form-label min-w-0 flex-1">
                {t('settings.name_label')}
                <input
                  className="input mt-1"
                  value={nameDraft}
                  maxLength={120}
                  required
                  disabled={renaming}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
              </label>
              <button type="submit" className="btn-secondary"
                disabled={renaming || !nameDraft.trim() || nameDraft.trim() === listing.base.name}>
                {renaming ? t('settings.name_saving') : t('settings.name_save')}
              </button>
            </form>
          </SettingRow>
        )}
        {isOwner && (observationLocked ? (
          <li className={ROW}>
            <RowText
              label={t('observation.model_label')}
              value={<>{observationLabel} · {t('settings.observation_locked')}</>}
            />
            <Lock size={15} aria-hidden className="shrink-0 text-slate-400" />
          </li>
        ) : (
          <SettingRow id="setting-observation" label={t('observation.model_label')} value={observationLabel}
            open={!!openRows.observation} onToggle={() => toggleRow('observation')}>
            <p className="helper-text">{t('observation.empty_only_hint')}</p>
            <label className="form-label max-w-md">
              {t('observation.model_label')}
              <select
                className="input mt-1"
                value={observationModel}
                disabled={changingObservationModel}
                onChange={(event) => void changeObservationModel(event.target.value as ObservationModel)}
              >
                <option value="cross_sectional">{t('observation.cross_sectional')}</option>
                <option value="longitudinal">{t('observation.longitudinal')}</option>
                <option value="event_registry">{t('observation.event_registry')}</option>
              </select>
            </label>
          </SettingRow>
        ))}

        <SettingRow id="setting-offline" label={t('settings.offline')}
          value={cachedMeta
            ? t('settings.offline_on').replace('{date}', formatDate(cachedMeta.cachedAt, lang))
            : t('settings.offline_off')}
          open={!!openRows.offline} onToggle={() => toggleRow('offline')}>
          {/* Avis : ce qui manque hors-ligne se lit avant de choisir. */}
          <p className="text-slate-600 dark:text-slate-300">{t('offline.identity_unavailable')}</p>
          {cachedMeta ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-slate-500">
                {t('offline.cached_at')} {formatDate(cachedMeta.cachedAt, lang)} · {t('offline.expires_at')} {formatDate(cachedMeta.expiresAt, lang)}
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
            <p className="text-slate-500">{t('offline.no_bases')}</p>
          )}
          <OfflineReadinessNotice readiness={shellReadiness} checking={shellChecking} onRecheck={() => void shellCheck()} />
        </SettingRow>

        {/* Les comptes de mission se gerent depuis la barre laterale, pour toutes les bases a la
            fois : ici, un simple lien, pour ne pas avoir a sortir de la base de tete. */}
        {isOwner && (
          <li>
            <Link to="/missions" className={ROW}>
              <RowText label={t('mission.global_title')} />
              <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-400" />
            </Link>
          </li>
        )}
      </ul>

      {/* L30 : reserve a qui peut corriger les donnees de la base -- c'est une ecriture,
          meme si elle ne change que le codage. Le serveur le verifie de toute facon. Outil
          rare : range dans « Avancé ». */}
      {canRepairOptions && id && (
        <section aria-labelledby="settings-advanced" className="space-y-2">
          <h2 id="settings-advanced" className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('settings.advanced')}
          </h2>
          <ul className="card">
            <SettingRow id="setting-options" label={t('options.repair_title')}
              open={!!openRows.options} onToggle={() => toggleRow('options')}>
              <OptionKeyRepairPanel baseId={id} bare />
            </SettingRow>
          </ul>
        </section>
      )}

      {isOwner && (
        <SectionCard title={t('base.settings_danger')} description={t('base.delete_body')} keepDescription icon={Trash2}>
          <button
            type="button"
            onClick={openDelete}
            className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            {t('base.delete')}
          </button>
        </SectionCard>
      )}
    </section>
  );
}
