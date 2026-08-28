import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { History } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuditRepository } from '../../data/RepositoryProvider';
import type { ActivityEvent } from '../../data/audit';
import { formatDateTime } from '../../lib/formatDate';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';

// C3 — Journal d'activite d'une base : timeline HUMAINE construite sur audit_log (imports, acces,
// suppressions, exports, publications). Les lectures sensibles (identite/documents) en sont exclues
// (vue dediee E1). Lecture seule.
const PAGE_SIZE = 50;
const ACTION_OPTIONS = [
  'data_imported', 'access_granted', 'access_changed', 'access_revoked', 'invitation_created',
  'patient_deleted', 'encounter_deleted', 'export_created', 'template_published', 'file_inspected', 'base_deleted',
] as const;
const KNOWN_ACTIONS = new Set<string>(ACTION_OPTIONS);

export function ActivityLog() {
  const { id: baseId } = useParams();
  const { t, lang } = useI18n();
  const audit = useAuditRepository();

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const rows = await audit.getBaseActivity(baseId, {
        limit: PAGE_SIZE,
        action: actionFilter || null,
      });
      setEvents(rows);
      setHasMore(rows.length === PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoading(false);
    }
  }, [baseId, audit, actionFilter, t]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (!baseId || events.length === 0) return;
    setLoadingMore(true);
    try {
      const rows = await audit.getBaseActivity(baseId, {
        before: events[events.length - 1].at,
        beforeId: events[events.length - 1].id,
        limit: PAGE_SIZE,
        action: actionFilter || null,
      });
      setEvents((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoadingMore(false);
    }
  };

  const labelOf = (action: string) =>
    KNOWN_ACTIONS.has(action) ? t(`activity.action.${action}` as MessageKey) : action;

  // Detail court pour quelques actions (le reste : juste l'auteur + l'heure).
  const detailOf = (e: ActivityEvent): string | null => {
    const m = e.metadata ?? {};
    if (e.action === 'data_imported') {
      const nu = Number(m.patients_new ?? 0), up = Number(m.patients_updated ?? 0), en = Number(m.encounters ?? 0), err = Number(m.errors ?? 0);
      return `${nu + up} ${t('status.patients')} · ${en} ${t('activity.encounters')}${err > 0 ? ` · ${err} ${t('activity.errors')}` : ''}`;
    }
    if ((e.action === 'patient_deleted' || e.action === 'encounter_deleted') && typeof m.reason === 'string') {
      return `« ${m.reason} »`;
    }
    if (e.action === 'file_inspected' && typeof m.status === 'string') {
      return [m.status, m.engine, m.detected_mime_type].filter((v) => typeof v === 'string' && v.length > 0).join(' · ');
    }
    return null;
  };

  if (loading) return <SkeletonList rows={6} label={t('common.loading')} />;

  return (
    <section className="max-w-4xl space-y-5">
      <PageHeader title={t('activity.title')} description={t('activity.subtitle')} />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="activity-action-filter" className="text-sm font-medium text-slate-600">
          {t('activity.filter_label')}
        </label>
        <select
          id="activity-action-filter"
          className="input max-w-xs"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">{t('activity.filter_all')}</option>
          {ACTION_OPTIONS.map((action) => (
            <option key={action} value={action}>{labelOf(action)}</option>
          ))}
        </select>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {events.length === 0 ? (
        <EmptyState icon={History} title={t('activity.empty')} />
      ) : (
        <ul className="space-y-2 text-sm">
          {events.map((e, i) => {
            const detail = detailOf(e);
            return (
              <li key={`${e.at}-${e.action}-${i}`} className="card flex items-start justify-between gap-3 px-3 py-2">
                <div>
                  <span className="font-medium text-slate-700">{labelOf(e.action)}</span>
                  <span className="text-slate-400"> — {e.actorName}</span>
                  {detail && <div className="text-xs text-slate-500">{detail}</div>}
                </div>
                <span className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(e.at, lang)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn-secondary">
          {loadingMore ? t('common.loading') : t('activity.load_more')}
        </button>
      )}
    </section>
  );
}
