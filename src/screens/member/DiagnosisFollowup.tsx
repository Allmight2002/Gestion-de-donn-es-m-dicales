import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Stethoscope } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { DiagnosisFollowupItem } from '../../data/bases';
import { errorMessage } from '../../lib/errorMessage';
import { formatDate } from '../../lib/formatDate';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { StatusBadge } from '../../components/StatusBadge';

const PAGE_SIZE = 50;
type ScopeFilter = '' | 'patient' | 'encounter';

/**
 * L56 — file des cas dont un diagnostic n'a pas de bloc dans LA VERSION DU DOSSIER.
 *
 * C'est une vue de decision pour le responsable, pas un second parcours de saisie : rien n'y
 * est ecrit, aucune reprise n'y est proposee et aucune notification n'en part. Elle n'affiche
 * que des codes et des comptes — jamais un texte de proposition, qui reste consultable dans
 * son parcours autorise existant. La base refuse de toute facon cette lecture a quiconque
 * n'est pas le medecin proprietaire : le filtre ci-dessous n'est qu'un confort d'affichage.
 */
export function DiagnosisFollowup() {
  const { id: baseId } = useParams();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();

  const [items, setItems] = useState<DiagnosisFollowupItem[]>([]);
  const [byCode, setByCode] = useState<{ code: string; records: number }[]>([]);
  const [codeOptions, setCodeOptions] = useState<string[]>([]);
  const [unclassified, setUnclassified] = useState(0);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFilter>('');
  const [code, setCode] = useState('');
  const [currentOnly, setCurrentOnly] = useState(false);
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
      const versionId = currentOnly ? listing.base.currentTemplateVersionId : null;
      const result = await bases.getDiagnosisFollowupPage(
        baseId,
        { scope: scope || null, code: code || null, versionId },
        PAGE_SIZE,
        page * PAGE_SIZE,
      );
      setItems(result.items);
      setTotal(result.total);
      setByCode(result.byCode);
      setUnclassified(result.unclassifiedRecords);
      setCurrentVersionId(result.currentVersionId);
      // La liste des codes proposes vient de la vue NON filtree par code : filtrer sur un
      // code ne doit pas faire disparaitre les autres du selecteur.
      if (!code) setCodeOptions(result.byCode.map((entry) => entry.code));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, t('common.error')));
    } finally {
      setLoading(false);
    }
  }, [baseId, bases, scope, code, currentOnly, page, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [baseId, scope, code, currentOnly]);

  if (loading) return <SkeletonList rows={5} />;
  if (ownerOnly) return <p role="alert" className="text-sm text-red-600">{t('diagnosis.followup_owner_only')}</p>;

  return (
    <section className="max-w-4xl space-y-5 sm:space-y-6">
      <PageHeader title={t('diagnosis.followup_title')} description={t('diagnosis.followup_subtitle')} />
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">
          <span className="text-slate-700">{t('diagnosis.followup_scope')}</span>
          <select className="input mt-1" value={scope} onChange={(e) => setScope(e.target.value as ScopeFilter)}>
            <option value="">{t('diagnosis.followup_scope_all')}</option>
            <option value="patient">{t('diagnosis.followup_scope_patient')}</option>
            <option value="encounter">{t('diagnosis.followup_scope_encounter')}</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-slate-700">{t('diagnosis.followup_code')}</span>
          <select className="input mt-1" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">{t('diagnosis.followup_code_all')}</option>
            {codeOptions.map((option) => (<option key={option} value={option}>{option}</option>))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-slate-700">{t('diagnosis.followup_version')}</span>
          <select
            className="input mt-1"
            value={currentOnly ? 'current' : 'all'}
            onChange={(e) => setCurrentOnly(e.target.value === 'current')}
            disabled={!currentVersionId}
          >
            <option value="all">{t('diagnosis.followup_version_all')}</option>
            <option value="current">{t('diagnosis.followup_version_current')}</option>
          </select>
        </label>
      </div>

      {/* Agregats : des codes et des comptes, rien qui puisse designer une personne. */}
      {(byCode.length > 0 || unclassified > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {byCode.map((entry) => (
            <span key={entry.code} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              <span className="font-mono">{entry.code}</span> · {entry.records} {t('diagnosis.followup_records')}
            </span>
          ))}
          {unclassified > 0 && (
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-800">
              {t('diagnosis.followup_unclassified')} · {unclassified} {t('diagnosis.followup_records')}
            </span>
          )}
        </div>
      )}

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

      {items.length === 0 ? (
        <EmptyState icon={Stethoscope} title={t('diagnosis.followup_empty')} />
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={`${item.scope}-${item.encounterId ?? item.patientId}`} className="card space-y-1.5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="font-mono text-xs text-slate-500">{item.patientCode}</span>
                <span className="font-medium text-slate-700">
                  {item.scope === 'patient'
                    ? t('diagnosis.followup_scope_patient')
                    : `${t(`encountertype.${item.encounterType}` as MessageKey)}${item.encounterDate ? ` · ${formatDate(item.encounterDate, lang)}` : ''}`}
                </span>
                <StatusBadge status={item.status} />
                <span className="text-xs text-slate-400">
                  {t('diagnosis.followup_source_version')} {item.sourceVersionNumber}
                </span>
                <span className="min-w-0 flex-1" />
                {item.uncoveredCodes.map((uncovered) => (
                  <span key={uncovered} className="rounded-full bg-amber-100 px-2 py-0.5 font-mono text-xs font-medium text-amber-800">
                    {uncovered}
                  </span>
                ))}
                {item.counts.unclassified > 0 && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                    {t('diagnosis.followup_unclassified')}
                  </span>
                )}
                <Link
                  to={item.encounterId
                    ? `/bases/${baseId}/patients/${item.patientId}/encounters/${item.encounterId}/edit`
                    : `/bases/${baseId}/patients/${item.patientId}`}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  {t('diagnosis.followup_open')}
                </Link>
              </div>
              {/* Evolution du gabarit : signalee, jamais appliquee. Le dossier reste dans sa
                  version, et rien n'annonce qu'il serait desormais completable (L57). */}
              {item.codesCoveredInCurrentVersion.length > 0 && (
                <p className="text-xs text-slate-500">
                  {t('diagnosis.followup_now_covered')}{' '}
                  <span className="font-mono">{item.codesCoveredInCurrentVersion.join(', ')}</span>
                  {' · '}{t('diagnosis.followup_no_resume')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
