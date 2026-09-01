import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Lightbulb } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { BaseProposal } from '../../data/bases';
import { errorMessage } from '../../lib/errorMessage';
import { formatDate } from '../../lib/formatDate';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { SkeletonList } from '../../components/Skeleton';

type ProposalGroup = {
  fieldKey: string;
  label: string;
  scope: BaseProposal['scope'];
  variableTotal: number;
  items: BaseProposal[];
};

const PAGE_SIZE = 50;

// L12 : une vue de decision, pas un second editeur. Chaque proposition conserve sa fiche
// source et sa valeur d'origine ; aucune action n'ecrit ni ne masque quoi que ce soit ici.
export function BaseProposals() {
  const { id: baseId } = useParams();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();
  const [items, setItems] = useState<BaseProposal[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const listing = await bases.getBase(baseId);
      if (listing?.role !== 'owner') {
        setOwnerOnly(true);
        setItems([]);
        setTotal(0);
        setError(null);
        return;
      }
      setOwnerOnly(false);
      const result = await bases.getBaseProposalsPage(baseId, PAGE_SIZE, page * PAGE_SIZE);
      setItems(result.items);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, t('common.error')));
    } finally {
      setLoading(false);
    }
  }, [baseId, bases, page, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [baseId]);

  const groups = useMemo(() => {
    const byVariable = new Map<string, ProposalGroup>();
    for (const item of items) {
      const key = `${item.scope}:${item.fieldKey}`;
      const group = byVariable.get(key);
      if (group) group.items.push(item);
      else byVariable.set(key, {
        fieldKey: item.fieldKey,
        label: item.label,
        scope: item.scope,
        variableTotal: item.variableTotal,
        items: [item],
      });
    }
    return [...byVariable.values()].sort((a, b) => a.label.localeCompare(b.label, lang));
  }, [items, lang]);

  if (loading) return <SkeletonList rows={5} />;
  if (ownerOnly) return <p role="alert" className="text-sm text-red-600">{t('proposals.owner_only')}</p>;

  return (
    <section className="max-w-4xl space-y-5 sm:space-y-6">
      <PageHeader title={t('proposals.title')} description={t('proposals.subtitle')} />
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
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('pager.prev')}
            </button>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('pager.next')}
            </button>
          </span>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState icon={Lightbulb} title={t('proposals.empty')} />
      ) : groups.map((group) => (
        <SectionCard
          key={`${group.scope}:${group.fieldKey}`}
          title={group.label}
          actions={<span className="text-xs text-slate-500">{group.variableTotal} {t('proposals.occurrences')}</span>}
        >
          <ul className="space-y-2 text-sm">
            {group.items.map((item) => (
              <li key={`${item.patientId}:${item.encounterId ?? 'patient'}:${item.proposalValue}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="min-w-0 flex-1 font-medium text-slate-800">{item.proposalValue}</span>
                <span className="font-mono text-xs text-slate-500">{item.patientCode}</span>
                <span className="text-xs text-slate-500">
                  {item.encounterType
                    ? `${t(`encountertype.${item.encounterType}` as MessageKey)}${item.encounterDate ? ` · ${formatDate(item.encounterDate, lang)}` : ''}`
                    : t('proposals.patient_data')}
                </span>
                <Link
                  to={item.encounterId
                    ? `/bases/${baseId}/patients/${item.patientId}/encounters/${item.encounterId}/edit`
                    : `/bases/${baseId}/patients/${item.patientId}`}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  {t('proposals.open_record')}
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}
    </section>
  );
}
