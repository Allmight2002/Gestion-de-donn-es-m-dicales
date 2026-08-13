import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { useClientErrorRepository } from '../../data/RepositoryProvider';
import { ERROR_CONTEXTS, type ClientErrorLogEntry, type ErrorContext } from '../../data/clientErrors';
import { errorMessage } from '../../lib/errorMessage';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';

export function SystemStatus() {
  const { t } = useI18n();
  const repo = useClientErrorRepository();
  const [context, setContext] = useState<ErrorContext | null>(null);
  const [entries, setEntries] = useState<ClientErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await repo.listRecent({ context })); setError(null); }
    catch (cause) { setError(errorMessage(cause, t('common.error'))); }
    finally { setLoading(false); }
  }, [context, repo, t]);
  useEffect(() => { void load(); }, [load]);
  const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

  return <section className="space-y-5 sm:space-y-6">
    <PageHeader title={t('system_status.title')} description={t('system_status.subtitle')} actions={<button className="btn-secondary" onClick={() => void load()}>{t('system_status.refresh')}</button>} />
    <label className="form-label max-w-sm">{t('system_status.context')}
      <select className="input" value={context ?? ''} onChange={(event) => setContext((event.target.value || null) as ErrorContext | null)}>
        <option value="">{t('system_status.all_contexts')}</option>
        {ERROR_CONTEXTS.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {loading ? <SkeletonList rows={5} label={t('common.loading')} /> : entries.length === 0 ? <p className="text-sm text-slate-500">{t('system_status.empty')}</p> : <ul className="space-y-3">
      {entries.map((entry) => <li key={entry.id} className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{entry.error_name}</h2><p className="mt-1 text-sm text-slate-600">{entry.error_message}</p></div><span className="badge">{entry.occurrence_count} {t('system_status.occurrences')}</span></div>
        <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3"><div><dt className="font-medium">{t('system_status.context')}</dt><dd>{entry.context}</dd></div><div><dt className="font-medium">{t('system_status.first_seen')}</dt><dd>{date(entry.occurred_at)}</dd></div><div><dt className="font-medium">{t('system_status.last_seen')}</dt><dd>{date(entry.last_occurred_at)}</dd></div></dl>
        {(entry.stack || entry.component_stack) && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-teal-700">{t('system_status.details')}</summary><pre className="mt-2 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-700">{[entry.stack, entry.component_stack].filter(Boolean).join('\n\n')}</pre></details>}
      </li>)}
    </ul>}
  </section>;
}
