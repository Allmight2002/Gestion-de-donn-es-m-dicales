import { errorMessage } from '../../lib/errorMessage';
import { recordRecentBase } from '../../lib/recentBases';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Columns3, Download, Plus, Users } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { BaseListing } from '../../data/bases';
import type { PatientListItem } from '../../data/patients';
import { getTemplateFields } from '../../data/templates';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import {
  downloadBaseSnapshot, isOfflineEnabled, offlineCache, snapshotMeta, useOnline, MAX_OFFLINE_PATIENTS,
  type OfflineMeta, type OfflinePatient, type SnapshotSource,
} from '../../data/offline';

const PAGE_SIZE = 20;

// Colonne affichee dans le tableau patients (sous-ensemble commun en ligne / hors-ligne).
type Column = { id: string; fieldKey: string; label: string };
const toColumn = (f: { id: string; fieldKey: string; label: string }): Column => ({ id: f.id, fieldKey: f.fieldKey, label: f.label });
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
  const { t } = useI18n();
  const online = useOnline();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();

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
  // Copie hors-ligne (controles disponibles en ligne).
  const [cachedMeta, setCachedMeta] = useState<OfflineMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmLarge, setConfirmLarge] = useState(false); // UI-2 : modale §5.8 (grosse base)

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
    try {
      if (!online) {
        // HORS-LIGNE : tout vient de l'instantane local (analytique uniquement).
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
        setVisibleFieldKeys(available.slice(0, 5).map((field) => field.fieldKey));
        setRows(snap.patients.map(offlineItem));
        setTotal(snap.patients.length);
        setCachedMeta(snapshotMeta(snap));
        setError(null);
        return;
      }

      // EN LIGNE : base + page de patients EN PARALLELE (independants), puis champs du gabarit.
      setOfflineView(false);
      const [baseResult, pageResult] = await Promise.allSettled([
        bases.getBase(id),
        patients.listPatientsPage(id, PAGE_SIZE, page * PAGE_SIZE),
      ]);
      if (isCancelled()) return;
      if (baseResult.status === 'rejected') throw baseResult.reason;
      const b = baseResult.value;
      setListing(b);
      if (b) {
        setBaseName(b.base.name);
        recordRecentBase(id, b.base.name); // UI-1 : navigation laterale « bases recentes »
      }
      if (pageResult.status === 'rejected') throw pageResult.reason;
      const pageRes = pageResult.value;
      setRows(pageRes.rows);
      setTotal(pageRes.total);
      if (b?.base.currentTemplateVersionId) {
        const fields = await getTemplateFields(templates, b.base.currentTemplateVersionId);
        if (isCancelled()) return;
        const available = fields.filter((f) => f.scope === 'patient').sort(sortByOrder).map(toColumn);
        setFields(available);
        setVisibleFieldKeys((current) => {
          const retained = current.filter((key) => available.some((field) => field.fieldKey === key));
          return retained.length > 0 ? retained : available.slice(0, 5).map((field) => field.fieldKey);
        });
      }
      void offlineCache.get(id)
        .then((s) => { if (!isCancelled()) setCachedMeta(s ? snapshotMeta(s) : null); })
        .catch(() => {});
      setError(null);
    } catch (e) {
      if (!isCancelled()) setError(errorMessage(e, t('common.error')));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page, online, bases, templates, patients]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

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
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setSaving(false);
    }
  }, [id, bases, patients, templates, t]);

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

  if (loading) return <SkeletonList rows={6} />;
  if (!offlineView && !listing) return <p className="text-slate-500">{t('notfound.title')}</p>;
  const canEdit = !offlineView && !!listing && (listing.role === 'owner' || listing.permissions.canEditStructuredData);
  const visibleFields = fields.filter((field) => visibleFieldKeys.includes(field.fieldKey));

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
      {/* UI-1 : le retour + la navigation (import/cohortes/journal/acces/gabarit/curation) vivent
          desormais dans BaseLayout (fil d'Ariane + onglets). Ici : titre, role et actions patients. */}
      <PageHeader
        title={baseName}
        description={!offlineView
          ? `${t('base.gabarit')} : ${listing?.templateName ? `${listing.templateName} v${listing.versionNumber}` : '—'}`
          : t('offline.identity_unavailable')}
        badge={offlineView ? (
          <span className="badge bg-amber-100 text-amber-800">{t('offline.read_only')}</span>
        ) : (
          listing && <span className="badge">{t(`baserole.${listing.role}`)}</span>
        )}
        actions={!offlineView && listing && canEdit ? (
          <button onClick={() => navigate(`/bases/${id}/patients/new`)} className="btn-primary">
            <Plus size={16} aria-hidden /> {t('patient.new')}
          </button>
        ) : undefined}
      />

      {/* Copie hors-ligne : bouton d'enregistrement (en ligne) ou bandeau (hors-ligne). */}
      {!offlineView ? (
        <div className="surface-muted flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <Download size={16} className="text-slate-400" aria-hidden />
          <button onClick={() => void makeAvailableOffline()} disabled={saving} className="font-medium text-teal-700 hover:underline disabled:opacity-50">
            {saving ? t('offline.saving') : cachedMeta ? t('offline.update') : t('offline.make_available')}
          </button>
          {cachedMeta && (
            <>
              <span className="text-slate-500">
                · {t('offline.available')} ({t('offline.cached_at')} {fmtDate(cachedMeta.cachedAt)})
              </span>
              <button onClick={() => void removeOffline()} className="text-slate-400 hover:text-red-600 hover:underline">{t('offline.remove')}</button>
            </>
          )}
        </div>
      ) : (
        cachedMeta && (
          <div className="text-xs text-slate-500">
            {t('offline.identity_unavailable')} · {t('offline.cached_at')} {fmtDate(cachedMeta.cachedAt)} · {t('offline.expires_at')} {fmtDate(cachedMeta.expiresAt)}
          </div>
        )
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {!(offlineView && !cachedMeta) && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="section-title">{t('patient.list_title')}</h2>
              <p className="mt-0.5 text-sm text-slate-500">{t('patient.list_count').replace('{n}', String(total))}</p>
            </div>
            {fields.length > 0 && (
              <details className="relative">
                <summary className="btn-secondary cursor-pointer list-none">
                  <Columns3 size={16} aria-hidden />
                  {t('patient.columns')}
                  <span className="text-xs text-slate-400">
                    {t('patient.columns_count').replace('{visible}', String(visibleFields.length)).replace('{total}', String(fields.length))}
                  </span>
                </summary>
                <div className="card absolute right-0 z-10 mt-2 w-80 max-w-[calc(100vw-2rem)] p-4 shadow-lg">
                  <p className="helper-text mb-3">{t('patient.columns_hint')}</p>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {fields.map((field) => (
                      <label key={field.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={visibleFieldKeys.includes(field.fieldKey)}
                          onChange={(event) => setVisibleFieldKeys((current) => (
                            event.target.checked
                              ? [...current, field.fieldKey]
                              : current.filter((key) => key !== field.fieldKey)
                          ))}
                        />
                        {field.label}
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('patient.no_patients')}
            />
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
                        <td key={f.id}>{formatCell(p.data[f.fieldKey])}</td>
                      ))}
                      <td className="text-right">
                        {canEdit && (
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

          {!offlineView && total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-slate-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {t('pager.of')} {total}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50"
                >
                  {t('pager.prev')}
                </button>
                <button
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 disabled:opacity-50"
                >
                  {t('pager.next')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}
