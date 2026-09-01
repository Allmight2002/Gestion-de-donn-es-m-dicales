import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { ClipboardCheck, Target, TrendingUp, Users } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { CompletenessRow, InclusionStats } from '../../data/bases';
import { useToast } from '../../components/Toast';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';

// D2 — Courbe d'inclusion : inclusions cumulees par mois vs OBJECTIF date (le graphique de
// reunion d'etude). Analytique pur (aucune identite). L'objectif est fixe par le proprietaire.
const W = 620, H = 170, PL = 36, PR = 14, PT = 16, PB = 24;

export function BaseStats() {
  const { id: baseId } = useParams();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();
  const { toast } = useToast();

  const [stats, setStats] = useState<InclusionStats | null>(null);
  const [completeness, setCompleteness] = useState<CompletenessRow[]>([]); // B1
  const [isOwner, setIsOwner] = useState(false);
  const [target, setTarget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const [s, listing, comp] = await Promise.all([
        bases.getInclusionStats(baseId),
        bases.getBase(baseId),
        // B1 resiliente : RPC pas encore deployee -> section masquee, page intacte.
        bases.getCompletenessStats(baseId).catch(() => [] as CompletenessRow[]),
      ]);
      setStats(s);
      setCompleteness(comp);
      setIsOwner(listing?.role === 'owner');
      setTarget(s.target != null ? String(s.target) : '');
      setTargetDate(s.targetDate ?? '');
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases]);

  useEffect(() => { void load(); }, [load]);

  async function saveTarget(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !stats) return;
    const expectedRevision = stats.targetRevision;
    setBusy(true);
    try {
      const n = target.trim() === '' ? null : Math.max(1, Math.round(Number(target)));
      await bases.setInclusionTarget(baseId, n, targetDate || null, expectedRevision);
      toast(t('stats.saved'));
      await load();
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  // Serie CUMULEE + geometrie du graphique (SVG maison, zero dependance).
  const chart = useMemo(() => {
    if (!stats || stats.monthly.length === 0) return null;
    let acc = 0;
    const cum = stats.monthly.map((m) => { acc += m.count; return { month: m.month, total: acc }; });
    const maxY = Math.max(acc, stats.target ?? 0, 1);
    const n = cum.length;
    const x = (i: number) => (n === 1 ? (PL + W - PR) / 2 : PL + (i * (W - PL - PR)) / (n - 1));
    const y = (v: number) => PT + (H - PT - PB) * (1 - v / maxY);
    const pts = cum.map((c, i) => `${x(i)},${y(c.total)}`).join(' ');
    const area = `${PL},${y(0)} ${pts} ${x(n - 1)},${y(0)}`;
    const mLabel = (m: string) =>
      new Date(`${m}-01T00:00:00`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { month: 'short', year: '2-digit' });
    return { cum, maxY, x, y, pts, area, mLabel, last: cum[n - 1] };
  }, [stats, lang]);

  if (loading) return <SkeletonList rows={4} />;
  if (!stats) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;

  const pct = stats.target ? Math.min(100, Math.round((stats.total / stats.target) * 100)) : null;

  return (
    <section className="max-w-4xl space-y-5 sm:space-y-6">
      <PageHeader title={t('stats.page_title')} description={t('stats.page_subtitle')} />
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><Users size={19} aria-hidden /></span>
          <div><p className="text-sm text-slate-500">{t('stats.total')}</p><p className="text-2xl font-semibold tracking-tight text-slate-900">{stats.total}</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><Target size={19} aria-hidden /></span>
          <div><p className="text-sm text-slate-500">{t('stats.target_label')}</p><p className="text-2xl font-semibold tracking-tight text-slate-900">{stats.target ?? '—'}</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"><TrendingUp size={19} aria-hidden /></span>
          <div><p className="text-sm text-slate-500">{t('stats.progress')}</p><p className="text-2xl font-semibold tracking-tight text-slate-900">{pct != null ? `${pct} %` : '—'}</p></div>
        </div>
      </div>

      <SectionCard
        title={t('stats.title')}
        icon={TrendingUp}
        actions={stats.target && (
            <p className="text-xs text-slate-400">
              {t('stats.target_label')} : {stats.target}
              {stats.targetDate ? ` · ${new Date(stats.targetDate).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric' })}` : ''}
            </p>
        )}
      >

        {!chart ? (
          <p className="py-8 text-center text-sm text-slate-500">{t('stats.no_data')}</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t('stats.title')}>
              {/* Ligne d'objectif (pointillee) */}
              {stats.target != null && stats.target > 0 && (
                <>
                  <line x1={PL} y1={chart.y(stats.target)} x2={W - PR} y2={chart.y(stats.target)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="5 4" opacity="0.8" />
                  <text x={W - PR} y={chart.y(stats.target) - 4} textAnchor="end" fontSize="11" fill="#94a3b8">{t('stats.target_label')} {stats.target}</text>
                </>
              )}
              {/* Aire + courbe cumulative */}
              <polygon points={chart.area} fill="#0d9488" opacity="0.13" />
              <polyline points={chart.pts} fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* Dernier point + valeur */}
              <circle cx={chart.x(chart.cum.length - 1)} cy={chart.y(chart.last.total)} r="4" fill="#0d9488" />
              <text x={Math.min(chart.x(chart.cum.length - 1) + 8, W - PR)} y={chart.y(chart.last.total) + 4} fontSize="12" fontWeight="600" fill="#0d9488">
                {chart.last.total}
              </text>
              {/* Reperes temporels : premier et dernier mois */}
              <text x={PL} y={H - 6} fontSize="11" fill="#94a3b8">{chart.mLabel(chart.cum[0].month)}</text>
              <text x={W - PR} y={H - 6} textAnchor="end" fontSize="11" fill="#94a3b8">{chart.mLabel(chart.last.month)}</text>
            </svg>
            {pct != null && (
              <div className="mt-2">
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{stats.total} / {stats.target} ({pct} %)</p>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* B1 — completude par variable, les moins renseignees d'abord (liste de travail). */}
      {completeness.length > 0 && (
        <SectionCard title={t('stats.completeness_title')} description={t('stats.completeness_hint')} icon={ClipboardCheck}>
          <ul className="space-y-2">
            {completeness.map((r) => {
              const observed = r.observed ?? r.filled;
              const missingCoded = r.missingCoded ?? 0;
              const pct = r.total > 0 ? Math.round((r.filled / r.total) * 100) : null;
              const barColor = pct == null ? 'bg-slate-300' : pct >= 80 ? 'bg-teal-600' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
              return (
                <li key={`${r.mode ?? 'legacy'}-${r.templateVersionId ?? 'v'}-${r.scope}-${r.fieldKey}`} className="text-sm">
                  <div className="mb-0.5 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-slate-700">
                      {r.label}
                      <span className="ml-1.5 text-[11px] text-slate-400">{t(`scope.${r.scope}`)}</span>
                      {r.versionNumber != null && <span className="ml-1.5 text-[11px] text-slate-400">v{r.versionNumber}</span>}
                    </span>
                    <span className="whitespace-nowrap text-xs text-slate-500">
                      {pct == null ? '—' : `${r.filled} / ${r.total} (${pct} %)`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct ?? 0}%` }} />
                  </div>
                  {missingCoded > 0 && (
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {observed} {t('stats.observed_short')} + {missingCoded} {t('stats.missing_coded_short')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {isOwner && (
        <SectionCard title={t('stats.goal_title')} description={t('stats.goal_description')} icon={Target}>
          <form onSubmit={saveTarget} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="form-label">
              {t('stats.target_label')}
              <input type="number" min="1" className="input w-full sm:w-36" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="150" />
            </label>
            <label className="form-label">
              {t('stats.target_date')}
              <input type="date" className="input" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </label>
            <button type="submit" disabled={busy} className="btn-primary">{t('stats.save')}</button>
            <span className="helper-text sm:pb-2">{t('stats.target_hint')}</span>
          </form>
        </SectionCard>
      )}
    </section>
  );
}
