import { errorMessage } from '../../lib/errorMessage';
import { recordRecentBase } from '../../lib/recentBases';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowDownUp, ChevronRight, Columns3, Download, Plus, Search, Upload, Users } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { Language } from '../../i18n/messages';
import { useAuth } from '../../auth/useAuth';
import { useBaseRepository, usePatientRepository, useTemplateRepository, useViewPreferenceRepository } from '../../data/RepositoryProvider';
import type { BaseListing, ObservationModel } from '../../data/bases';
import type { PatientListItem, PatientSortField } from '../../data/patients';
import { displayFieldValue, terminologyMarks, type TerminologyMarks } from '../../data/types';
import { getTemplateFields } from '../../data/templates';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Menu, MenuItem } from '../../components/Menu';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import { OfflineReadinessNotice, useAppShellReadiness } from '../../components/OfflineReadiness';
import { EmptyState } from '../../components/EmptyState';
import { Checkbox } from '../../components/Checkbox';
import { useTopBarActions, type TopBarAction } from '../../components/TopBar';
import { useNarrowViewport } from '../../lib/useNarrowViewport';
import { FULL_FORM_PARAM, useEntryFormSelection } from './EntryFormPicker';
import {
  downloadBaseSnapshot, isOfflineEnabled, offlineCache, snapshotMeta, useOnline, MAX_OFFLINE_PATIENTS,
  type OfflineMeta, type OfflinePatient, type SnapshotSource,
} from '../../data/offline';
import {
  discardIntake, downloadIntakeContext, intakeContextCache, isOfflineIntakeEnabled,
  useIntakeQueue,
  type IntakeEntry, type IntakeContextSource, type OfflineIntakeMeta,
} from '../../data/offlineIntake';

const PAGE_SIZE = 20;

// UX-12(b) : tri de CONSULTATION. Le champ de tri voyage tel quel jusqu'au serveur ; la liste
// n'expose que des colonnes analytiques, conformement a RG-9.
type SortChoice = { field: PatientSortField; direction: 'asc' | 'desc' };
const DEFAULT_SORT: SortChoice = { field: 'created_at', direction: 'asc' };

// Cache local de secours : la source de verite en ligne est la preference serveur par
// UTILISATEUR et par base. Le cache ne contient que des cles de colonnes, aucune valeur clinique.
const columnsStorageKey = (userId: string | undefined, baseId: string | undefined) =>
  userId && baseId ? `meddata:columns:${userId}:${baseId}` : null;

function readStoredColumns(key: string | null): string[] | null {
  if (!key) return null;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : null;
  } catch {
    return null;
  }
}

function writeStoredColumns(key: string | null, keys: string[]): void {
  if (!key) return;
  // Un stockage refuse (mode prive, quota) ne doit pas casser la liste : la preference
  // reste alors valable pour la session seulement.
  try { localStorage.setItem(key, JSON.stringify(keys)); } catch { /* preference non persistee */ }
}

// Colonne affichee dans le tableau patients (sous-ensemble commun en ligne / hors-ligne).
// L30 : `type` et les options voyagent avec elle pour que la liste affiche le LIBELLE de
// l'option et non son code -- sinon un libelle corrige resterait invisible ici.
type Column = {
  id: string; fieldKey: string; label: string;
  type?: string; allowedValues?: unknown; allowedOptions?: unknown;
};
const toColumn = (
  f: { id: string; fieldKey: string; label: string; type?: string; allowedValues?: unknown; allowedOptions?: unknown },
): Column => ({
  id: f.id, fieldKey: f.fieldKey, label: f.label,
  type: f.type, allowedValues: f.allowedValues, allowedOptions: f.allowedOptions,
});
const sortByOrder = <T extends { displayOrder: number }>(a: T, b: T) => a.displayOrder - b.displayOrder;
// Patient du cache -> item de liste : identite TOUJOURS nulle hors-ligne (jamais mise en cache).
const offlineItem = (p: OfflinePatient): PatientListItem => ({
  id: p.id, code: p.code, templateVersionId: p.templateVersionId, data: p.data, validationStatus: p.validationStatus, identity: null,
});
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

// Accueil d'une base : informations + tableau des patients (cahier §8.4), pagine.
// Hors-ligne (§13) : lecture seule a partir de l'instantane ANALYTIQUE enregistre (sans identite).
export function BaseHome() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const marks = terminologyMarks(t);
  const online = useOnline();
  const { profile } = useAuth();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const viewPreferences = useViewPreferenceRepository();

  const [listing, setListing] = useState<BaseListing | null>(null);
  const [baseName, setBaseName] = useState('');
  const [offlineView, setOfflineView] = useState(false);
  const [rows, setRows] = useState<PatientListItem[]>([]);
  const [fields, setFields] = useState<Column[]>([]);
  const [visibleFieldKeys, setVisibleFieldKeys] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // UX-12 : un echec de chargement n'est pas une base inexistante. Les deux etats sont
  // distingues ici pour ne jamais transformer une panne en « page introuvable ».
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState<SortChoice>(DEFAULT_SORT);
  // Copie hors-ligne (controles disponibles en ligne).
  const [cachedMeta, setCachedMeta] = useState<OfflineMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [columnsSyncError, setColumnsSyncError] = useState(false);
  const [confirmLarge, setConfirmLarge] = useState(false); // UI-2 : modale §5.8 (grosse base)
  // Saisie hors-ligne (intake-only) : contexte prepare + file locale de CE compte.
  const intakeEnabled = isOfflineIntakeEnabled();
  const pendingIntakes = useIntakeQueue(id);
  const [intakeMeta, setIntakeMeta] = useState<OfflineIntakeMeta | null>(null);
  // La coquille ne se verifie que la ou une disponibilite hors-ligne est annoncee.
  const { readiness: shellReadiness, checking: shellChecking, check: shellCheck } = useAppShellReadiness(isOfflineEnabled() && cachedMeta !== null);
  const [intakeOfflineView, setIntakeOfflineView] = useState(false);

  // Changement direct de base : l'ecran repart de la premiere page, sans recherche ni tri
  // herites. L'ajustement se fait PENDANT le rendu pour qu'aucune requete ne parte avec le
  // contexte precedent (un effet declencherait d'abord un chargement sur l'ancienne page).
  const [context, setContext] = useState(id);
  if (context !== id) {
    setContext(id);
    setPage(0); setSearch(''); setAppliedSearch(''); setSort(DEFAULT_SORT);
    setRows([]); setTotal(0); setBaseName(''); setListing(null); setError(null); setLoadFailed(false);
  }

  // La recherche part sur Entree (jamais pendant la frappe) et ramene toujours a la premiere
  // page : un filtre modifie sur la page 3 n'a aucune raison de repartir de la page 3.
  const applySearch = (value: string) => {
    const next = value.trim();
    if (next === appliedSearch) return;
    setAppliedSearch(next);
    setPage(0);
  };
  // Droit de recherche nominative appris au dernier chargement de CETTE base. Il decide
  // seulement quelle operation l'ecran appelle : le serveur reverifie role et permission.
  const identityAllowed = useRef<{ baseId: string; allowed: boolean } | null>(null);

  const columnsKey = columnsStorageKey(profile?.id, id);
  // Repli de session quand le navigateur refuse d'ecrire (mode prive, quota). En ligne, ce
  // meme etat evite qu'une pagination ecrase une modification dont l'enregistrement serveur
  // est encore en vol. Il reste attache a la paire compte/base et inutilisable sans cle de compte.
  const sessionColumns = useRef<{ key: string; keys: string[] } | null>(null);
  const columnsWriteQueue = useRef<Promise<void>>(Promise.resolve());
  // Ne depend ni de `online` ni de `offlineView` : `load` en depend, et chaque bascule de la
  // vue hors-ligne relancerait un chargement complet (squelette puis re-rendu). Les appelants
  // portent la garde : le chemin en ligne de `load` et `applyColumns`.
  const queueColumnSave = useCallback((keys: string[]) => {
    if (!id) return;
    const write = columnsWriteQueue.current.then(() => viewPreferences.saveVisiblePatientFieldKeys(id, keys));
    // Une écriture en échec ne doit pas bloquer les suivantes ; elle reste signalée sans
    // exposer le message SQL ou une information interne au frontend.
    columnsWriteQueue.current = write.catch(() => {});
    void write.then(
      () => setColumnsSyncError(false),
      () => setColumnsSyncError(true),
    );
  }, [id, viewPreferences]);

  const load = useCallback(async (isCancelled: () => boolean) => {
    if (!id) return;
    setLoading(true);
    // Ne jamais conserver l'etat d'une autre base pendant une navigation ou un echec.
    setListing(null);
    setBaseName('');
    setRows([]);
    setFields([]);
    setVisibleFieldKeys([]);
    setTotal(0);
    setCachedMeta(null);
    setError(null);
    setLoadFailed(false);
    try {
      if (!online) {
        // MODE INTAKE-ONLY : la lecture de la base est explicitement INDISPONIBLE hors-ligne
        // (invariant §3.11). Aucun instantane n'est lu ni reconstruit ; seule la file locale
        // des creations en attente est affichee.
        if (intakeEnabled) {
          if (isCancelled()) return;
          setOfflineView(false);
          setRows([]); setFields([]); setCachedMeta(null); setTotal(0); setListing(null);
          setIntakeOfflineView(true);
          setError(null);
          return;
        }
        // HORS-LIGNE (mode demo historique) : tout vient de l'instantane local (analytique uniquement).
        const snap = await offlineCache.get(id);
        if (isCancelled()) return;
        setOfflineView(true);
        if (!snap) {
          setRows([]); setFields([]); setCachedMeta(null); setError(t('offline.not_cached'));
          return;
        }
        setBaseName(snap.baseName);
        recordRecentBase(id, snap.baseName); // UI-1 : navigation laterale « bases recentes »
        const available = snap.fields.filter((f) => f.scope === 'patient').sort(sortByOrder).map(toColumn);
        setFields(available);
        const stored = readStoredColumns(columnsKey)
          ?? (columnsKey && sessionColumns.current?.key === columnsKey ? sessionColumns.current.keys : null);
        const retained = stored?.filter((key) => available.some((field) => field.fieldKey === key)) ?? [];
        setVisibleFieldKeys(stored === null
          ? available.slice(0, 5).map((field) => field.fieldKey)
          : stored.length === 0
            ? []
            : retained.length > 0 ? retained : available.slice(0, 5).map((field) => field.fieldKey));
        setRows(snap.patients.map(offlineItem));
        setTotal(snap.patients.length);
        setCachedMeta(snapshotMeta(snap));
        setError(null);
        return;
      }

      // EN LIGNE : base + page de patients EN PARALLELE (independants), puis champs du gabarit.
      setOfflineView(false);
      setIntakeOfflineView(false);
      // Recherche globale (code OU nom) pour qui peut chercher par nom sur cette base. Elle se
      // résout en deux temps : l'opération auditée rend des identifiants — jamais un nom —, et
      // la page analytique est ensuite relue par le chemin habituel, sous la RLS. Sans droit
      // nominatif, la recherche reste celle du code, avec le tri choisi.
      const globalSearch = appliedSearch !== '' && !!patients.searchPatientIds
        && identityAllowed.current?.baseId === id && identityAllowed.current.allowed;
      const [baseResult, pageResult] = await Promise.allSettled([
        bases.getBase(id),
        globalSearch
          ? patients.searchPatientIds!(id, appliedSearch, PAGE_SIZE, page * PAGE_SIZE)
            .then(async (found) => (found.ids.length === 0
              ? { rows: [], total: found.total }
              : patients.listPatientsPage(id, found.ids.length, 0, { ids: found.ids })
                .then((listed) => ({
                  // L'ordre est celui décidé par le serveur : le relire ici ne doit pas le perdre.
                  rows: found.ids
                    .map((patientId) => listed.rows.find((row) => row.id === patientId))
                    .filter((row): row is (typeof listed.rows)[number] => !!row),
                  total: found.total,
                }))))
          : patients.listPatientsPage(id, PAGE_SIZE, page * PAGE_SIZE, {
            codeQuery: appliedSearch || null,
            sort: { field: sort.field, direction: sort.direction },
          }),
      ]);
      if (isCancelled()) return;
      if (baseResult.status === 'rejected') throw baseResult.reason;
      const b = baseResult.value;
      setListing(b);
      identityAllowed.current = {
        baseId: id,
        allowed: profile?.globalRole === 'medecin' && !!b?.permissions.canViewIdentity,
      };
      if (b) {
        setBaseName(b.base.name);
        recordRecentBase(id, b.base.name); // UI-1 : navigation laterale « bases recentes »
      }
      if (pageResult.status === 'rejected') throw pageResult.reason;
      const pageRes = pageResult.value;
      // Une page devenue vide (suppression, filtre) est recalee sur la derniere page existante :
      // rester sur une page qui n'existe plus donnerait une liste vide sans explication.
      const lastPage = Math.max(0, Math.ceil(pageRes.total / PAGE_SIZE) - 1);
      if (pageRes.rows.length === 0 && page > lastPage) {
        setPage(lastPage);
        return;
      }
      setRows(pageRes.rows);
      setTotal(pageRes.total);
      if (b?.base.currentTemplateVersionId) {
        const fields = await getTemplateFields(templates, b.base.currentTemplateVersionId);
        if (isCancelled()) return;
        const available = fields.filter((f) => f.scope === 'patient').sort(sortByOrder).map(toColumn);
        setFields(available);
        // En ligne, le serveur est la source de verite et suit le compte entre appareils.
        // Le cache local ne sert qu'au demarrage sans ligne serveur ou en cas d'indisponibilite.
        // `[]` est un choix explicite (aucune colonne) et ne doit jamais redevenir le defaut.
        const sessionStored = columnsKey && sessionColumns.current?.key === columnsKey
          ? sessionColumns.current.keys : null;
        let serverStored: string[] | null = null;
        let serverRead = false;
        if (sessionStored === null) {
          try {
            serverStored = await viewPreferences.getVisiblePatientFieldKeys(id);
            serverRead = true;
          } catch {
            // La liste reste utilisable ; le cache local ou le defaut prend le relais.
            setColumnsSyncError(true);
          }
        }
        if (isCancelled()) return;
        const localStored = readStoredColumns(columnsKey);
        const stored = sessionStored ?? serverStored ?? localStored;
        const retained = stored?.filter((key) => available.some((field) => field.fieldKey === key)) ?? [];
        const next = stored === null
          ? available.slice(0, 5).map((field) => field.fieldKey)
          : stored.length === 0
            ? []
            : retained.length > 0 ? retained : available.slice(0, 5).map((field) => field.fieldKey);
        setVisibleFieldKeys(next);
        if (columnsKey) sessionColumns.current = { key: columnsKey, keys: next };
        writeStoredColumns(columnsKey, next);
        if (serverRead && serverStored === null && localStored !== null) {
          // Migration douce de l'ancien stockage local : elle ne remplace jamais une ligne
          // serveur existante et ne transporte que des cles de colonnes.
          queueColumnSave(next);
        } else if (serverRead && serverStored !== null
          && (serverStored.length !== next.length || serverStored.some((key, index) => key !== next[index]))) {
          // Purge serveur des variables supprimees ou devenues invisibles dans la version active.
          queueColumnSave(next);
        }
      }
      void offlineCache.get(id)
        .then((s) => { if (!isCancelled()) setCachedMeta(s ? snapshotMeta(s) : null); })
        .catch(() => {});
      setError(null);
    } catch (e) {
      if (!isCancelled()) { setError(errorMessage(e, t('common.error'))); setLoadFailed(true); }
    } finally {
      if (!isCancelled()) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page, online, bases, templates, patients, viewPreferences, queueColumnSave, appliedSearch, sort.field, sort.direction, columnsKey, profile?.globalRole]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  // Reprise explicite apres une panne de chargement : meme requete, sans quitter l'ecran.
  const reload = useCallback(() => load(() => false), [load]);

  // Telecharge l'instantane analytique de la base pour consultation hors-ligne.
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

  // §5.8 : sur une grande base, l'instantane est un gros bloc -> modale de confirmation (UI-2)
  // avant de le charger ; en dessous du seuil, telechargement direct.
  const makeAvailableOffline = useCallback(async () => {
    if (total > MAX_OFFLINE_PATIENTS) { setConfirmLarge(true); return; }
    await doDownloadSnapshot();
  }, [total, doDownloadSnapshot]);

  const removeOffline = useCallback(async () => {
    if (!id) return;
    await offlineCache.remove(id);
    setCachedMeta(null);
  }, [id]);

  // Prepare EN LIGNE le contexte de saisie (formulaire seul, sans les donnees existantes).
  const doPrepareIntake = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const src: IntakeContextSource = {
        getBase: (bid) => bases.getBase(bid),
        getVersion: (vid) => templates.getVersion(vid),
      };
      setIntakeMeta(await downloadIntakeContext(id, src));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setSaving(false);
    }
  }, [id, bases, templates, t]);

  // Etat du contexte de saisie local (badge « pret »), reevalue a chaque affichage en ligne.
  useEffect(() => {
    if (!intakeEnabled || !id || !online) return;
    void intakeContextCache.get(id)
      .then((ctx) => setIntakeMeta(ctx ? {
        baseId: ctx.baseId, baseName: ctx.baseName, preparedAt: ctx.preparedAt, expiresAt: ctx.expiresAt,
      } : null))
      .catch(() => setIntakeMeta(null));
  }, [id, online, intakeEnabled]);

  // Le modele d'observation se regle dans l'onglet Parametres ; ici il ne sert qu'a savoir
  // si la base porte des rencontres (colonne « ajouter une rencontre »).
  const observationModel: ObservationModel = listing?.base.observationModel ?? 'longitudinal';
  const isCrossSectional = observationModel === 'cross_sectional';
  const canEdit = !offlineView && !!listing && (listing.role === 'owner' || listing.permissions.canEditStructuredData);
  const canCreate = !offlineView && !!listing && (
    listing.role === 'owner' || listing.canCreateStructuredData === true || listing.permissions.canEditStructuredData
  );
  // Un acces a echeance (compte de mission) ne pose pas de copie locale et n'importe pas de
  // fichier : la base refuse les deux, l'ecran ne doit donc pas les promettre.
  const isMissionAccess = !!listing && listing.expiresAt != null;
  const narrow = useNarrowViewport();
  // Formulaires courts de la base : un raccourci de creation, la fiche reste la meme.
  const entrySelection = useEntryFormSelection(id, canCreate);
  const entryForms = entrySelection.forms;
  // « Nouveau patient » ouvre le formulaire par defaut de la base ; le formulaire complet reste
  // alors accessible a cote des autres formulaires courts.
  const defaultEntryForm = entrySelection.defaultForm;
  const otherEntryForms = [
    ...(defaultEntryForm ? [{ id: FULL_FORM_PARAM, name: t('entryform.full') }] : []),
    ...entryForms.filter((form) => form.id !== defaultEntryForm?.id),
  ];
  // Audit UI mobile, lot 2 (5.4-B) : sur telephone, ce qui alimente la liste (import, saisie
  // hors-ligne) passe dans « ⋯ » de la barre haute ; les memes actions restent dans la page
  // a partir de `lg`. L'action du quotidien, « Nouveau patient », devient un bouton flottant.
  const topBarActions: TopBarAction[] = [];
  if (canEdit && !isMissionAccess) {
    topBarActions.push({ label: t('base.tab_import'), onSelect: () => navigate(`/bases/${id}/import`) });
  }
  for (const form of otherEntryForms) {
    topBarActions.push({ label: t('entryform.new_patient_with').replace('{form}', form.name), onSelect: () => navigate(`/bases/${id}/patients/new/manual?form=${encodeURIComponent(form.id)}`) });
  }
  if (intakeEnabled && listing && canCreate && !isMissionAccess) {
    topBarActions.push({
      label: saving ? t('intake.preparing') : intakeMeta ? t('intake.update') : t('intake.prepare'),
      onSelect: () => void doPrepareIntake(),
      disabled: saving,
    });
  }
  useTopBarActions(loading || intakeOfflineView ? null : topBarActions);

  if (loading) return <SkeletonList rows={6} />;
  // MODE INTAKE-ONLY hors-ligne : panneau dedie — ni liste serveur, ni instantane.
  if (intakeOfflineView) {
    return (
      <PendingIntakesPanel
        baseId={id ?? ''}
        entries={pendingIntakes}
        onDiscard={(entryId) => void discardIntake(entryId)}
      />
    );
  }
  // Un echec de chargement laisse la base inconnue : on montre la panne et une reprise, pas
  // « introuvable », qui affirmerait a tort que cette base n'existe pas.
  if (!offlineView && !listing) {
    return loadFailed ? (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600">{error ?? t('patient.list_unavailable')}</p>
        <button type="button" className="btn-secondary" onClick={() => void reload()}>{t('patient.list_retry')}</button>
      </div>
    ) : <p className="text-slate-500">{t('notfound.title')}</p>;
  }
  const canManageOffline = !offlineView && !!listing && !isMissionAccess;
  const visibleFields = fields.filter((field) => visibleFieldKeys.includes(field.fieldKey));
  const searching = appliedSearch !== '';
  // Rôle ET permission sur cette base, plus un serveur qui sait répondre. Les trois sont
  // nécessaires : le rôle gouverne l'affichage du champ, la permission gouverne ce que la
  // recherche peut faire remonter, et l'absence d'opération serveur ne se devine pas.
  const identitySearchAvailable = !offlineView
    && profile?.globalRole === 'medecin'
    && !!listing?.permissions.canViewIdentity
    && !!patients.searchPatientIds;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const applyColumns = (next: string[]) => {
    setVisibleFieldKeys(next);
    if (columnsKey) sessionColumns.current = { key: columnsKey, keys: next };
    writeStoredColumns(columnsKey, next);
    if (online && !offlineView) queueColumnSave(next);
  };
  const changeSort = (next: SortChoice) => { setSort(next); setPage(0); };
  // Deux acces a la pagination, deux informations differentes : en tete, la position dans
  // l'ensemble des resultats ; en pied, la plage affichee. Un meme texte rendu deux fois
  // n'aiderait ni la lecture ni les technologies d'assistance.
  const pager = (position: 'top' | 'bottom') => (
    <nav aria-label={t(position === 'top' ? 'patient.pagination_top' : 'patient.pagination_bottom')}
      className={`flex flex-wrap items-center justify-between gap-2 text-sm ${position === 'bottom' ? 'mt-3' : ''}`}>
      <span className="text-slate-500">
        {position === 'top'
          ? t('patient.page_summary').replace('{page}', String(page + 1)).replace('{pages}', String(pageCount)).replace('{total}', String(total))
          : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} ${t('pager.of')} ${total}`}
      </span>
      <div className="flex flex-wrap gap-2">
        {position === 'top' && (
          <button type="button" disabled={page === 0} onClick={() => setPage(0)}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50">{t('patient.page_first')}</button>
        )}
        <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50">{t('pager.prev')}</button>
        <button type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50">{t('pager.next')}</button>
        {position === 'top' && (
          <button type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(pageCount - 1)}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50">{t('patient.page_last')}</button>
        )}
      </div>
    </nav>
  );

  return (
    <section className="space-y-5">
      {/* UI-2 : confirmation §5.8 (grosse base) en modale themable, plus window.confirm. */}
      <ConfirmDialog
        open={confirmLarge}
        title={t('offline.make_available')}
        body={t('offline.large_confirm').replace('{n}', String(total))}
        busy={saving}
        onCancel={() => setConfirmLarge(false)}
        onConfirm={() => { setConfirmLarge(false); void doDownloadSnapshot(); }}
      />
      {/* La navigation vit dans BaseLayout (fil d'Ariane + onglets) et les reglages de la base
          dans l'onglet Parametres. Ici : titre, role et actions de saisie. */}
      <PageHeader
        title={baseName}
        // Sous lg, la barre haute porte le nom de la base (lot 2) ; hors-ligne, l'en-tete reste
        // entier, parce que son badge et sa description disent l'etat de la copie.
        titleInTopBar={!offlineView}
        description={!offlineView
          ? (listing?.templateName ? `${listing.templateName} · v${listing.versionNumber}` : undefined)
          : t('offline.identity_unavailable')}
        // Hors-ligne, la description est un etat (identite indisponible) : elle reste lisible.
        keepDescription={offlineView}
        badge={offlineView ? (
          <span className="badge bg-amber-100 text-amber-800">{t('offline.read_only')}</span>
        ) : (
          listing && <span className="badge">{t(`baserole.${listing.role}`)}</span>
        )}
        actions={!offlineView && listing ? (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {/* Importer n'est pas une destination mais une facon d'alimenter cette liste :
                l'action vit donc a cote de la saisie, et non dans la barre d'onglets. */}
            {canEdit && !isMissionAccess && (
              <button onClick={() => navigate(`/bases/${id}/import`)} className="btn-secondary flex-1 sm:flex-none">
                <Upload size={16} aria-hidden /> {t('base.tab_import')}
              </button>
            )}
            {canCreate && otherEntryForms.length > 0 && (
              <div className="shrink-0 max-lg:hidden">
                <Menu
                  triggerLabel={t('entryform.new_with')}
                  triggerClassName="btn-secondary"
                  triggerContent={t('entryform.new_with')}
                  panelClassName="card absolute right-0 z-10 mt-2 w-64 max-w-[calc(100vw-2rem)] p-2 shadow-lg"
                >
                  {otherEntryForms.map((form) => (
                    <MenuItem key={form.id} onSelect={() => navigate(`/bases/${id}/patients/new/manual?form=${encodeURIComponent(form.id)}`)}>
                      {form.name}
                    </MenuItem>
                  ))}
                </Menu>
              </div>
            )}
            {canCreate && (
              <button onClick={() => navigate(`/bases/${id}/patients/new/manual`)} className="btn-primary flex-1 sm:flex-none">
                <Plus size={16} aria-hidden /> {t('patient.new')}
              </button>
            )}
          </div>
        ) : undefined}
      />

      {/* Une copie existante reste signalee, sans bandeau permanent pleine largeur. */}
      {!offlineView && cachedMeta ? (
        <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Download size={14} className="shrink-0 text-slate-400" aria-hidden />
            {t('offline.available')} · {t('offline.cached_at')} {fmtDate(cachedMeta.cachedAt)}
          </span>
          {canManageOffline && (
            <button onClick={() => void makeAvailableOffline()} disabled={saving} className="font-medium text-teal-700 hover:underline disabled:opacity-50">
              {saving ? t('offline.saving') : t('offline.update')}
            </button>
          )}
          <button onClick={() => void removeOffline()} className="text-slate-400 hover:text-red-600 hover:underline">{t('offline.remove')}</button>
          <OfflineReadinessNotice readiness={shellReadiness} checking={shellChecking} onRecheck={() => void shellCheck()} />
        </div>
      ) : offlineView ? (
        cachedMeta && (
          <div className="text-xs text-slate-500">
            {t('offline.identity_unavailable')} · {t('offline.cached_at')} {fmtDate(cachedMeta.cachedAt)} · {t('offline.expires_at')} {fmtDate(cachedMeta.expiresAt)}
          </div>
        )
      ) : null}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {/* Saisie hors-ligne (intake-only) : preparation du CONTEXTE en ligne uniquement. */}
      {intakeEnabled && !offlineView && listing && canCreate && !isMissionAccess && (
        // Sous lg, l'action passe dans « ⋯ » (lot 2) ; l'etat « prete » reste affiche.
        <div className={`inline-flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs${intakeMeta ? '' : ' max-lg:hidden'}`}>
          {/* Audit UI mobile, lot 0 — non prepare, l'etat repetait mot pour mot le bouton
              (« Préparer la saisie hors-ligne » deux fois) : seul l'etat « prete » est annonce. */}
          {intakeMeta && <span className="text-slate-500">{t('intake.prepared')}</span>}
          <button onClick={() => void doPrepareIntake()} disabled={saving} className="font-medium text-teal-700 hover:underline disabled:opacity-50 max-lg:hidden">
            {saving ? t('intake.preparing') : intakeMeta ? t('offline.update') : t('intake.prepare')}
          </button>
        </div>
      )}

      {!(offlineView && !cachedMeta) && (
        // Lot 2 (5.4-B) : sur telephone, la liste arrive sous les onglets — recherche, tri et
        // colonnes sur une ligne, le decompte, puis les patients (cartes sous 768 px).
        <div className="@container/list space-y-3 max-lg:pb-20">
          <h2 className="sr-only">{t('patient.list_title')}</h2>
          <div className="flex items-center gap-2">
            {/* UX-12(b) : recherche et tri sont resolus par le SERVEUR avant la pagination ;
                la liste reste presentee par code et variables analytiques (RG-9). */}
            {!offlineView && (
              <form role="search" className="relative min-w-0 flex-1"
                onSubmit={(event) => { event.preventDefault(); applySearch(search); }}>
                <label className="sr-only" htmlFor="patient-search">{t('patient.search')}</label>
                <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input id="patient-search" type="search" className="input pl-9" value={search} autoComplete="off"
                  enterKeyHint="search"
                  placeholder={t(identitySearchAvailable ? 'patient.search_global_placeholder' : 'patient.search_placeholder')}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    // Vider le champ (croix native, effacement) rend la liste complete sans Entree.
                    if (event.target.value === '') applySearch('');
                  }} />
              </form>
            )}
            {!offlineView && search !== '' && (
              <button type="button" className="btn-ghost min-h-11 shrink-0 px-2" onClick={() => { setSearch(''); applySearch(''); }}>
                {t('patient.search_clear')}
              </button>
            )}
            {!offlineView && (
              <Menu
                triggerLabel={t('patient.sort_menu')}
                triggerClassName="btn-secondary shrink-0 px-3"
                triggerContent={<ArrowDownUp size={16} aria-hidden />}
                panelClassName="card absolute right-0 z-10 mt-2 w-64 max-w-[calc(100vw-2rem)] space-y-3 p-4 shadow-lg"
              >
                {/* En recherche globale, l'ordre est celui du code, decide par le serveur :
                    laisser le tri actif afficherait un controle sans effet. getByLabel de
                    Playwright inclut le texte des options du label enveloppant : un libelle
                    explicite evite de confondre ce tri avec le champ Code patient. */}
                <label className="form-label" htmlFor="patient-sort">{t('patient.sort')}
                  <select id="patient-sort" className="input" aria-label={t('patient.sort')}
                    value={sort.field} disabled={identitySearchAvailable && searching}
                    onChange={(event) => changeSort({ ...sort, field: event.target.value as PatientSortField })}>
                    <option value="created_at">{t('patient.sort_created')}</option>
                    <option value="patient_code">{t('patient.sort_code')}</option>
                  </select>
                </label>
                <button type="button" className="btn-secondary w-full"
                  onClick={() => changeSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}>
                  <ArrowDownUp size={16} aria-hidden />
                  {sort.direction === 'asc' ? t('patient.sort_asc') : t('patient.sort_desc')}
                </button>
              </Menu>
            )}
            {fields.length > 0 && (
              <div className={offlineView ? 'ml-auto' : 'shrink-0'}>
                <Menu
                  triggerLabel={t('patient.columns')}
                  triggerClassName="btn-secondary cursor-pointer px-3"
                  triggerContent={
                    <>
                      <Columns3 size={16} aria-hidden />
                      <span className="max-sm:sr-only">{t('patient.columns')}</span>
                      <span className="text-xs text-slate-400 max-sm:sr-only">
                        {t('patient.columns_count').replace('{visible}', String(visibleFields.length)).replace('{total}', String(fields.length))}
                      </span>
                    </>
                  }
                  panelClassName="card absolute right-0 z-10 mt-2 w-80 max-w-[calc(100vw-2rem)] p-4 shadow-lg"
                >
                <p className="helper-text mb-3">{t('patient.columns_hint')}</p>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {fields.map((field) => (
                    <Checkbox
                        key={field.id}
                        label={field.label}
                        containerClassName="rounded-lg px-2 hover:bg-slate-50"
                        checked={visibleFieldKeys.includes(field.fieldKey)}
                        onChange={(event) => applyColumns(event.target.checked
                          ? [...visibleFieldKeys, field.fieldKey]
                          : visibleFieldKeys.filter((key) => key !== field.fieldKey))}
                    />
                  ))}
                </div>
                </Menu>
              </div>
            )}
          </div>
          {/* Recherche globale : un seul champ, code ou nom, sans choix préalable. La partie
              nominative n'existe que pour un médecin disposant du droit d'identité sur CETTE base ;
              l'autorisation est revérifiée par l'opération serveur, qui ne rend que des
              identifiants. */}
          {!offlineView && (
            <p className="helper-text">
              {t(identitySearchAvailable ? 'patient.search_global_note' : 'patient.search_identity_unavailable')}
            </p>
          )}
          <p className="text-xs text-slate-500">
            {t('patient.list_count').replace('{n}', String(total))}
            {!offlineView && !(identitySearchAvailable && searching) && ` · ${t('patient.sort_summary')
              .replace('{field}', t(sort.field === 'patient_code' ? 'patient.sort_code' : 'patient.sort_created'))
              .replace('{direction}', t(sort.direction === 'asc' ? 'patient.sort_asc' : 'patient.sort_desc').toLocaleLowerCase())}`}
          </p>
          {columnsSyncError && (
            <p role="status" className="text-xs text-amber-700">{t('patient.columns_sync_error')}</p>
          )}
          {!offlineView && total > PAGE_SIZE && pager('top')}
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title={searching ? t('patient.no_search_results') : t(canCreate ? 'patient.no_patients' : 'patient.no_patients_readonly')}
              action={canCreate && !searching ? (
                <button onClick={() => navigate(`/bases/${id}/patients/new/manual`)} className="btn-primary">
                  <Plus size={16} aria-hidden /> {t('patient.new')}
                </button>
              ) : undefined}
            />
          ) : narrow ? (
            // Lot 2 (T4) : une carte par patient sous 768 px — le code, trois valeurs choisies
            // dans « Colonnes affichées », et l'ouverture de la fiche en un geste.
            <ul className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
              {rows.map((p) => {
                const shown = visibleFields.slice(0, 3)
                  .map((f) => ({ field: f, text: formatCell(p.data[f.fieldKey], f, lang, marks) }))
                  .filter((cell) => cell.text !== '—');
                return (
                  <li key={p.id} className="flex items-stretch">
                    <button type="button" onClick={() => navigate(`/bases/${id}/patients/${p.id}`)}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm font-semibold text-teal-800 dark:text-teal-300">{p.code}</span>
                        {shown.length > 0 && (
                          <span className="block truncate text-sm text-slate-600 dark:text-slate-300">
                            {shown.map((cell, index) => (
                              <Fragment key={cell.field.id}>
                                {index > 0 && ' · '}
                                <span className="sr-only">{cell.field.label} : </span>{cell.text}
                              </Fragment>
                            ))}
                          </span>
                        )}
                      </span>
                      {!(canEdit && !isCrossSectional) && <ChevronRight size={18} aria-hidden className="shrink-0 text-slate-400" />}
                    </button>
                    {canEdit && !isCrossSectional && (
                      <button type="button" onClick={() => navigate(`/bases/${id}/patients/${p.id}/encounters/new`)}
                        aria-label={`${t('encounter.add')} — ${p.code}`} title={t('encounter.add')}
                        className="icon-button my-auto mr-2 shrink-0 text-teal-700">
                        <Plus size={18} aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="data-table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[1] bg-slate-50/95">{t('patient.code')}</th>
                    {visibleFields.map((f) => (
                      <th key={f.id}>{f.label}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="sticky left-0 z-[1] bg-white font-mono text-xs">
                        <button onClick={() => navigate(`/bases/${id}/patients/${p.id}`)} className="font-medium text-teal-700 hover:text-teal-800 hover:underline">
                          {p.code}
                        </button>
                      </td>
                      {visibleFields.map((f) => (
                        <td key={f.id}>{formatCell(p.data[f.fieldKey], f, lang, marks)}</td>
                      ))}
                      <td className="text-right">
                        {canEdit && !isCrossSectional && (
                          <button
                            onClick={() => navigate(`/bases/${id}/patients/${p.id}/encounters/new`)}
                            className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline"
                          >
                            + {t('encounter.add')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!offlineView && total > PAGE_SIZE && pager('bottom')}
        </div>
      )}
      {/* Lot 2 (5.4-B) : l'action du quotidien reste sous le pouce. Liste vide : l'etat vide
          porte deja ce bouton, et deux boutons identiques se feraient concurrence. */}
      {canCreate && rows.length > 0 && (
        <button type="button" onClick={() => navigate(`/bases/${id}/patients/new/manual`)}
          className="btn-primary fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-20 rounded-full px-5 shadow-lg lg:hidden">
          <Plus size={18} aria-hidden /> {t('patient.new')}
        </button>
      )}
    </section>
  );
}

function formatCell(v: unknown, field: Column | undefined, lang: Language, marks: TerminologyMarks): string {
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return displayFieldValue(v, '—', field, lang, marks);
}

// MODE INTAKE-ONLY (hors-ligne) : la SEULE chose visible est la file locale de CE compte.
// Jamais melangee a la liste serveur ; les identifiants locaux n'appellent jamais Supabase.
function PendingIntakesPanel({ baseId, entries, onDiscard }: {
  baseId: string;
  entries: IntakeEntry[];
  onDiscard: (entryId: string) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const patients = entries.filter((e) => e.kind === 'patient_create');
  const encounters = entries.filter((e) => e.kind === 'encounter_create');
  const stateBadge = (state: IntakeEntry['state']) => {
    const cls = state === 'rejected' || state === 'blocked'
      ? 'bg-red-100 text-red-800'
      : state === 'conflict' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
    const label = state === 'conflict' ? t('sync.conflicts')
      : state === 'syncing' ? t('sync.syncing')
        : state === 'rejected' ? t('sync.rejected')
          : state === 'expired' ? t('sync.expired')
            : t('sync.pending');
    return <span className={`badge ${cls}`}>{label}</span>;
  };
  return (
    <section className="space-y-5">
      <PageHeader
        title={t('intake.pending_title')}
        description={t('intake.blocked_read')}
        keepDescription
        badge={<span className="badge bg-amber-100 text-amber-800">{t('offline.badge')}</span>}
        actions={(
          <button onClick={() => navigate(`/bases/${baseId}/patients/new/manual`)} className="btn-primary flex-1 sm:flex-none">
            <Plus size={16} aria-hidden /> {t('intake.new_patient')}
          </button>
        )}
      />
      {patients.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('sync.empty')}
          action={(
            <button onClick={() => navigate(`/bases/${baseId}/patients/new/manual`)} className="btn-primary">
              <Plus size={16} aria-hidden /> {t('intake.new_patient')}
            </button>
          )}
        />
      ) : (
        <div className="space-y-3">
          {patients.map((p) => (
            <div key={p.id} className="card p-4 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">{t('sync.intake_patient')}</span>
                {stateBadge(p.state)}
              </div>
              <p className="font-mono text-xs text-slate-500">{p.payload.code}</p>
              {p.payload.fullName && <p className="text-slate-700">{p.payload.fullName}{p.payload.dateOfBirth ? ` · ${p.payload.dateOfBirth}` : ''}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/bases/${baseId}/patients/${p.localPatientId}/encounters/new`)}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  + {t('encounter.add')}
                </button>
                <button type="button" onClick={() => onDiscard(p.id)} className="text-xs text-slate-400 hover:text-red-600 hover:underline">
                  {t('offline.remove')}
                </button>
              </div>
            </div>
          ))}
          {encounters.map((e) => (
            <div key={e.id} className="card p-4 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">{t('sync.intake_encounter')}</span>
                {stateBadge(e.state)}
              </div>
              <p className="text-xs text-slate-500">
                {e.payload.encounterType} · {e.payload.encounterDate}
                {e.state === 'blocked' && ` · ${t('sync.intake_blocked')}`}
              </p>
              <button type="button" onClick={() => onDiscard(e.id)} className="mt-2 text-xs text-slate-400 hover:text-red-600 hover:underline">
                {t('offline.remove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
