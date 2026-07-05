import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuditRepository } from '../../data/RepositoryProvider';
import type { ActivityEvent } from '../../data/audit';
import { formatDateTime } from '../../lib/formatDate';

// C3 — Journal d'activite d'une base : timeline HUMAINE construite sur audit_log (imports, acces,
// suppressions, exports, publications). Les lectures sensibles (identite/documents) en sont exclues
// (vue dediee E1). Lecture seule.
const KNOWN_ACTIONS = new Set([
  'data_imported', 'access_granted', 'access_changed', 'access_revoked', 'invitation_created',
  'patient_deleted', 'encounter_deleted', 'export_created', 'template_published', 'base_deleted',
]);

export function ActivityLog() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const audit = useAuditRepository();

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      setEvents(await audit.getBaseActivity(baseId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, audit]);

  useEffect(() => { void load(); }, [load]);

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
    return null;
  };

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('activity.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('activity.subtitle')}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {events.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('activity.empty')}</div>
      ) : (
        <ul className="space-y-2 text-sm">
          {events.map((e, i) => {
            const detail = detailOf(e);
            return (
              <li key={i} className="card flex items-start justify-between gap-3 px-3 py-2">
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
    </section>
  );
}
