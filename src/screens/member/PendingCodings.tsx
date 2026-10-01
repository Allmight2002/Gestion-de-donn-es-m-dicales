import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Stethoscope } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { PendingCoding, PendingCodingPage } from '../../data/bases';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { formatDate } from '../../lib/formatDate';

// Codage CIM-11 assiste : les diagnostics restes non codes (« aucune correspondance »,
// « plusieurs correspondances » non choisies, analyse impossible hors connexion) ou proposes
// sans confirmation. Chaque ligne rouvre la fiche ou la rencontre, ou le champ reaffiche le
// texte et ses propositions : la valeur ne change que par un choix explicite du medecin.
// La liste ne montre rien de plus que la file « A completer » : code patient pseudonyme,
// rencontre, variable et texte saisi. La base refuse la lecture hors droit de modification.
const LIMIT = 100;

const editLink = (baseId: string, item: PendingCoding) => (item.encounterId
  ? `/bases/${baseId}/patients/${item.patientId}/encounters/${item.encounterId}/edit`
  : `/bases/${baseId}/patients/${item.patientId}/edit`);

export function PendingCodings() {
  const { id: baseId } = useParams();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();
  const [page, setPage] = useState<PendingCodingPage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setPage(null);
    setFailed(false);
    if (!baseId || !bases.listPendingCodings) {
      setFailed(true);
      return;
    }
    bases.listPendingCodings(baseId, LIMIT).then(
      (result) => { if (alive) setPage(result); },
      // Aucun detail technique : la page dit seulement que la liste est indisponible.
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [baseId, bases]);

  if (!failed && !page) return <SkeletonList rows={5} />;

  return (
    <section className="max-w-4xl space-y-5">
      <PageHeader title={t('codings.title')} description={t('codings.subtitle')} />
      {failed ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('codings.error')}</p>
      ) : page!.items.length === 0 ? (
        <EmptyState icon={Stethoscope} title={t('codings.empty')} />
      ) : (
        <>
          <ul className="space-y-2 text-sm">
            {page!.items.map((item) => (
              <li
                key={`${item.encounterId ?? item.patientId}-${item.fieldKey}-${item.position ?? 0}`}
                className="card flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
              >
                <span className="font-mono text-xs text-slate-500">{item.patientCode}</span>
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {item.encounterId
                    ? `${item.encounterType ? t(`encountertype.${item.encounterType}` as MessageKey) : ''}${item.encounterDate ? ` · ${formatDate(item.encounterDate, lang)}` : ''}`
                    : t('queue.kind_patient')}
                </span>
                <span className="text-xs text-slate-500">
                  {item.fieldLabel}
                  {item.position !== null ? ` · ${t('codings.rank').replace('{n}', String(item.position + 1))}` : ''}
                </span>
                <span
                  className={item.status === 'suggested'
                    ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
                    : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700'}
                >
                  {t(item.status === 'suggested' ? 'codings.status_suggested' : 'codings.status_unmatched')}
                </span>
                <span className="w-full min-w-0 break-words">
                  {item.raw && <span className="italic text-slate-800 dark:text-slate-100">{item.raw}</span>}
                  {item.proposedLabel && (
                    <span className="block text-xs text-slate-500">{t('codings.proposed').replace('{label}', item.proposedLabel)}</span>
                  )}
                </span>
                <Link to={editLink(baseId!, item)} className="text-xs font-medium text-teal-700 hover:underline">
                  {t('codings.open')}
                </Link>
              </li>
            ))}
          </ul>
          {page!.hasMore && <p className="text-xs text-slate-500">{t('codings.more').replace('{n}', String(LIMIT))}</p>}
        </>
      )}
    </section>
  );
}
