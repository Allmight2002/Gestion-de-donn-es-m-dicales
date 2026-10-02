import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronDown, ChevronRight, Stethoscope } from 'lucide-react';
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
// sans confirmation. Chaque ligne, « Coder », rouvre la fiche ou la rencontre SUR LE CHAMP, ou
// il reaffiche le texte et ses propositions : la valeur ne change que par un choix explicite du
// medecin. Les lignes sont regroupees par patient : la liste reste courte meme a 100 entrees.
// La liste ne montre rien de plus que la file « A completer » : code patient pseudonyme,
// rencontre, variable et texte saisi. La base refuse la lecture hors droit de modification.
const LIMIT = 100;

const editLink = (baseId: string, item: PendingCoding) => `${item.encounterId
  ? `/bases/${baseId}/patients/${item.patientId}/encounters/${item.encounterId}/edit`
  : `/bases/${baseId}/patients/${item.patientId}/edit`}?field=${encodeURIComponent(item.fieldKey)}`;

/** Regroupement par patient, dans l'ordre de la liste (modifications les plus recentes d'abord). */
function byPatient(items: readonly PendingCoding[]) {
  const groups = new Map<string, { patientId: string; patientCode: string; items: PendingCoding[] }>();
  for (const item of items) {
    const group = groups.get(item.patientId) ?? { patientId: item.patientId, patientCode: item.patientCode, items: [] };
    group.items.push(item);
    groups.set(item.patientId, group);
  }
  return [...groups.values()];
}

export function PendingCodings() {
  const { id: baseId } = useParams();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();
  const [page, setPage] = useState<PendingCodingPage | null>(null);
  const [failed, setFailed] = useState(false);
  // Patients deplies ; un seul patient l'est d'emblee.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (patientId: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(patientId)) next.delete(patientId);
    else next.add(patientId);
    return next;
  });

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

  if (!failed && !page) return <SkeletonList rows={5} label={t('common.loading')} />;
  const groups = page ? byPatient(page.items) : [];

  return (
    <section className="max-w-4xl space-y-5">
      <PageHeader title={t('codings.title')} description={t('codings.subtitle')} />
      {failed ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('codings.error')}</p>
      ) : groups.length === 0 ? (
        <EmptyState icon={Stethoscope} title={t('codings.empty')} />
      ) : (
        <>
          <ul className="space-y-2 text-sm">
            {groups.map((group) => {
              const single = groups.length === 1;
              const expanded = single || open.has(group.patientId);
              const panelId = `codings-${group.patientId}`;
              return (
                <li key={group.patientId} className="card overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    disabled={single}
                    onClick={() => toggle(group.patientId)}
                    className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800/60"
                  >
                    <span className="font-mono text-sm font-semibold text-teal-800 dark:text-teal-300">{group.patientCode}</span>
                    <span className="min-w-0 flex-1 text-xs text-slate-500">{t('codings.count').replace('{n}', String(group.items.length))}</span>
                    {!single && (
                      <ChevronDown size={16} aria-hidden className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
                    )}
                  </button>
                  {expanded && (
                    <ul id={panelId} className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                      {group.items.map((item) => (
                        <li key={`${item.encounterId ?? item.patientId}-${item.fieldKey}-${item.position ?? 0}`}>
                          {/* La ligne entiere mene au champ : « Coder » dit ce que l'on y fait. */}
                          <Link
                            to={editLink(baseId!, item)}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                          >
                            <span className="min-w-0 flex-1 space-y-1">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                              </span>
                              {item.raw && <span className="block break-words italic text-slate-800 dark:text-slate-100">{item.raw}</span>}
                              {item.proposedLabel && (
                                <span className="block break-words text-xs text-slate-500">{t('codings.proposed').replace('{label}', item.proposedLabel)}</span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-0.5 font-medium text-teal-700 dark:text-teal-300">
                              {t('codings.open')}
                              <ChevronRight size={16} aria-hidden />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {page!.hasMore && <p className="text-xs text-slate-500">{t('codings.more').replace('{n}', String(LIMIT))}</p>}
        </>
      )}
    </section>
  );
}
