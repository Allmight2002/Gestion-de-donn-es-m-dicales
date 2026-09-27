import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import {
  Download, FileCog, History, KeyRound, MessageSquare, RotateCcw, Search, ShieldCheck, Trash2, Upload, Users, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuditRepository } from '../../data/RepositoryProvider';
import type { ActivityEvent } from '../../data/audit';
import { formatDay, formatTime } from '../../lib/formatDate';
import { overflowFadeClass, useOverflowEdges } from '../../lib/useOverflowEdges';
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
  // E6 : une evolution du formulaire est une action de la base comme une autre, et c'est ici
  // qu'on retrouve QUI l'a appliquee, QUAND, avec quel impact et vers quelle revision.
  'form_preparation_applied',
] as const;
// Toutes les actions qu'`audit_log` peut porter pour une base et que `base_activity_log`
// renvoie. Le filtre garde sa liste courte ; l'affichage, lui, ne doit plus retomber sur le
// code technique brut (`mission_credentials_revealed`…), illisible et insecable sur telephone.
const LABELLED_ACTIONS = [
  ...ACTION_OPTIONS,
  'attachment_deleted', 'base_restored', 'base_purge_challenge_prepared', 'base_purge_challenge_confirmed',
  'base_purged', 'cohort_deleted', 'curation_clarification_requested', 'curation_clarification_answered',
  'curation_finalized', 'curation_request_deleted', 'form_preparation_saved', 'form_preparation_previewed',
  'form_preparation_resumed', 'form_preparation_conflict', 'form_preparation_apply_refused',
  'form_preparation_discarded', 'form_preparation_expired', 'identity_search', 'mission_granted',
  'mission_extended', 'mission_revoked', 'mission_credentials_creation_requested',
  'mission_credentials_created', 'mission_credentials_regeneration_requested',
  'mission_credentials_regenerated', 'mission_credentials_revealed', 'option_keys_repaired',
  'patient_identity_corrected',
] as const;
const KNOWN_ACTIONS = new Set<string>(LABELLED_ACTIONS);

/** Audit UI mobile, lot 4 (5.9-B) : une icone par famille d'actions, pour parcourir d'un coup d'oeil. */
function iconOf(action: string): LucideIcon {
  if (action === 'data_imported') return Upload;
  if (action === 'export_created') return Download;
  if (action.endsWith('_deleted') || action.startsWith('base_purge')) return Trash2;
  if (action === 'base_restored') return RotateCcw;
  if (action.startsWith('access_') || action === 'invitation_created') return KeyRound;
  if (action.startsWith('mission_')) return Users;
  if (action === 'template_published' || action.startsWith('form_preparation_')) return FileCog;
  if (action === 'file_inspected') return ShieldCheck;
  if (action.startsWith('curation_')) return MessageSquare;
  if (action === 'identity_search' || action === 'patient_identity_corrected') return Search;
  if (action === 'option_keys_repaired') return Wrench;
  return History;
}

/** Jour local de l'evenement : c'est lui qui regroupe les lignes. */
const dayKey = (value: string | Date) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

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
  const [filterScroller, filterEdges] = useOverflowEdges<HTMLDivElement>();

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
    // E6 : l'impact est l'INSTANTANE fige par le serveur au moment de l'application. On ne
    // relit pas la version de gabarit vivante : elle a pu changer depuis, et l'historique
    // raconterait alors une evolution qui n'a pas eu lieu.
    if (e.action === 'form_preparation_applied') {
      const parts: string[] = [];
      if (typeof m.target_revision === 'number') {
        parts.push(`${t('activity.form_revision')} ${m.target_revision}`);
      }
      const added = Number(m.added_fields ?? 0);
      if (added > 0) {
        const required = Number(m.added_required_fields ?? 0);
        parts.push(
          `${added} ${t('activity.form_added_fields')}${
            required > 0 ? ` (${required} ${t('activity.form_added_required')})` : ''
          }`,
        );
      }
      const rules = Number(m.added_rules ?? 0);
      if (rules > 0) parts.push(`${rules} ${t('activity.form_added_rules')}`);
      const associations = Number(m.added_diagnosis_associations ?? 0);
      if (associations > 0) parts.push(`${associations} ${t('activity.form_added_associations')}`);
      const patients = Number(m.affected_patients ?? 0);
      const encounters = Number(m.affected_encounters ?? 0);
      if (patients + encounters > 0) {
        parts.push(`${patients + encounters} ${t('activity.form_affected_records')}`);
      }
      // Le detail nominatif des variables n'arrive que pour le proprietaire ; sans lui, le
      // resume reste vrai, simplement moins precis.
      if (Array.isArray(m.added_field_keys) && m.added_field_keys.length > 0) {
        parts.push(m.added_field_keys.filter((k): k is string => typeof k === 'string').join(', '));
      }
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    if (e.action === 'file_inspected' && typeof m.status === 'string') {
      return [m.status, m.engine, m.detected_mime_type].filter((v) => typeof v === 'string' && v.length > 0).join(' · ');
    }
    return null;
  };

  // Audit UI mobile, lot 4 (5.9-B) : les lignes se lisent par jour, du plus recent au plus ancien.
  const days = useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const groups: { key: string; label: string; events: ActivityEvent[] }[] = [];
    for (const event of events) {
      const key = dayKey(event.at);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        const label = key === dayKey(now) ? t('activity.today')
          : key === dayKey(yesterday) ? t('activity.yesterday')
            : formatDay(event.at, lang, now);
        group = { key, label, events: [] };
        groups.push(group);
      }
      group.events.push(event);
    }
    return groups;
  }, [events, lang, t]);

  if (loading) return <SkeletonList rows={6} label={t('common.loading')} />;

  return (
    <section className="max-w-4xl space-y-5">
      <PageHeader title={t('activity.title')} description={t('activity.subtitle')} />

      {/* Audit UI mobile, lot 4 (T5, 5.9-B) : le filtre tient sur une ligne de pastilles qui
          defile ; le bord estompe dit qu'il en reste hors ecran. */}
      <div ref={filterScroller} role="group" aria-label={t('activity.filter_group')}
        className={`-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 ${overflowFadeClass(filterEdges)}`}>
        {['', ...ACTION_OPTIONS].map((action) => {
          const active = actionFilter === action;
          return (
            <button key={action || 'all'} type="button" aria-pressed={active} onClick={() => setActionFilter(action)}
              className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-medium transition ${
                active
                  ? 'border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-400 dark:bg-teal-900/40 dark:text-teal-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}>
              {action ? labelOf(action) : t('activity.filter_all')}
            </button>
          );
        })}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {events.length === 0 ? (
        <EmptyState icon={History} title={t('activity.empty')} />
      ) : days.map((day) => (
        <section key={day.key} aria-labelledby={`activity-day-${day.key}`} className="space-y-2">
          <h2 id={`activity-day-${day.key}`} className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {day.label}
          </h2>
          {/* Une carte par jour, une ligne par action : icone · action · heure, puis l'auteur. */}
          <ul aria-labelledby={`activity-day-${day.key}`} className="card divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {day.events.map((e, i) => {
              const detail = detailOf(e);
              const Icon = iconOf(e.action);
              // Decision 8 : « Vous » vient du serveur ; sans le drapeau, le nom reste affiche.
              const actor = e.actorIsSelf ? t('activity.you') : e.actorName;
              return (
                <li key={`${e.id}-${i}`} className="flex items-start gap-3 px-3 py-2.5">
                  <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
                  {/* `min-w-0` + coupure des mots longs : un libelle ou un detail insecable ne doit
                      plus elargir la ligne au-dela de l'ecran (debordement a 360 px). */}
                  <div className="min-w-0 flex-1 break-words">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{labelOf(e.action)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{actor}{detail && <> · <span>{detail}</span></>}</p>
                  </div>
                  <time dateTime={e.at} className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatTime(e.at, lang)}</time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {hasMore && (
        <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn-secondary">
          {loadingMore ? t('common.loading') : t('activity.load_more')}
        </button>
      )}
    </section>
  );
}
