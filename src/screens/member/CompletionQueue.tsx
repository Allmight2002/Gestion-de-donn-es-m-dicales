import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ClipboardCheck } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { usePatientRepository } from '../../data/RepositoryProvider';
import type { CompletionItem } from '../../data/patients';
import { StatusBadge } from '../../components/StatusBadge';
import { SkeletonList } from '../../components/Skeleton';
import { formatDate } from '../../lib/formatDate';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';

// B2 v1 — file de travail « a completer » : dossiers non finalises + champs requis manquants,
// avec acces direct au bon formulaire. La completion devient un flux visible d'equipe.
const PAGE_SIZE = 50;

export function CompletionQueue() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const patients = usePatientRepository();

  const [items, setItems] = useState<CompletionItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const res = await patients.getCompletionQueuePage(baseId, PAGE_SIZE, page * PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, page, patients]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { setPage(0); }, [baseId]);

  const openItem = (it: CompletionItem) =>
    navigate(it.kind === 'patient'
      ? `/bases/${baseId}/patients/${it.patientId}/edit`
      : `/bases/${baseId}/patients/${it.patientId}/encounters/${it.encounterId}/edit`);

  if (loading) return <SkeletonList rows={5} />;

  return (
    <section className="max-w-4xl space-y-5">
      <PageHeader title={t('queue.title')} description={t('queue.subtitle')} />
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} {t('pager.of')} {total}
          </span>
          <span className="inline-flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('pager.prev')}
            </button>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('pager.next')}
            </button>
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t('queue.empty')} />
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((it) => (
            <li key={`${it.kind}-${it.encounterId ?? it.patientId}`} className="card flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
              <span className="font-mono text-xs text-slate-500">{it.code}</span>
              <span className="font-medium text-slate-700">
                {it.kind === 'patient'
                  ? t('queue.kind_patient')
                  : `${t(`encountertype.${it.encounterType}` as MessageKey)} · ${it.encounterDate ? formatDate(it.encounterDate, lang) : ''}`}
              </span>
              <StatusBadge status={it.status} />
              <span className="min-w-0 flex-1" />
              {it.missing.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-slate-400">{t('queue.missing')} :</span>
                  {it.missing.map((m) => (
                    <span key={m} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{m}</span>
                  ))}
                </span>
              )}
              <button onClick={() => openItem(it)} className="text-xs font-medium text-teal-700 hover:underline">
                {t('queue.complete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
