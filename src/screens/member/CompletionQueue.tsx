import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { usePatientRepository } from '../../data/RepositoryProvider';
import type { CompletionItem } from '../../data/patients';
import { StatusBadge } from '../../components/StatusBadge';
import { SkeletonList } from '../../components/Skeleton';
import { formatDate } from '../../lib/formatDate';

// B2 v1 — file de travail « a completer » : dossiers non finalises + champs requis manquants,
// avec acces direct au bon formulaire. La completion devient un flux visible d'equipe.
export function CompletionQueue() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const patients = usePatientRepository();

  const [items, setItems] = useState<CompletionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      setItems(await patients.getCompletionQueue(baseId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, patients]);

  useEffect(() => { void load(); }, [load]);

  const openItem = (it: CompletionItem) =>
    navigate(it.kind === 'patient'
      ? `/bases/${baseId}/patients/${it.patientId}/edit`
      : `/bases/${baseId}/patients/${it.patientId}/encounters/${it.encounterId}/edit`);

  if (loading) return <SkeletonList rows={5} />;

  return (
    <section className="max-w-3xl space-y-4">
      <p className="text-sm text-slate-500">{t('queue.subtitle')}</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {items.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('queue.empty')}</div>
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
