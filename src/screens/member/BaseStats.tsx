import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { ChevronDown, ClipboardCheck, Target, TrendingUp } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { CompletenessRow, InclusionStats } from '../../data/bases';
import { getTemplateFields } from '../../data/templates';
import type { TemplateField } from '../../data/types';
import { FALLBACK_SECTION_KEY, LEGACY_SECTION_KEYS, sectionKeyOf, sectionLabel } from '../../domain/templateSections';
import { useToast } from '../../components/Toast';
import { SkeletonList } from '../../components/Skeleton';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';

// D2 — Courbe d'inclusion : inclusions cumulees par mois vs OBJECTIF date (le graphique de
// reunion d'etude). Analytique pur (aucune identite). L'objectif est fixe par le proprietaire.
const W = 620, H = 170, PL = 36, PR = 14, PT = 16, PB = 24;
// Audit UI mobile, lot 4 (5.8-B) : la completude montre d'abord les variables a reprendre.
const COMPLETENESS_PREVIEW = 10;

type CompletenessGroup = { key: string; label: string; rank: number; first: number; rows: CompletenessRow[] };

/**
 * « Voir toutes » : les variables regroupees par section du formulaire, dans l'ordre voulu
 * par le proprietaire, la section de secours en dernier. Dans chaque section, l'ordre du
 * serveur (les moins renseignees d'abord) est conserve. Une variable introuvable dans sa
 * version tombe dans la section de secours : elle reste affichee.
 */
function groupCompletenessBySection(
  rows: readonly CompletenessRow[],
  fieldsByVersion: ReadonlyMap<string, readonly TemplateField[]>,
  currentVersionId: string | null,
  t: Parameters<typeof sectionLabel>[0],
): CompletenessGroup[] {
  const groups = new Map<string, CompletenessGroup>();
  rows.forEach((row, index) => {
    const field = fieldsByVersion.get(row.templateVersionId ?? currentVersionId ?? '')
      ?.find((f) => f.fieldKey === row.fieldKey && f.scope === row.scope);
    const key = field ? sectionKeyOf(field) : FALLBACK_SECTION_KEY;
    const own = sectionLabel(t, { sectionKey: key, label: field?.sectionLabel });
    const label = field?.parentSectionKey
      ? `${sectionLabel(t, { sectionKey: field.parentSectionKey, label: field.parentSectionLabel })} › ${own}`
      : own;
    const legacyRank = (LEGACY_SECTION_KEYS as readonly string[]).indexOf(key);
    const rank = key === FALLBACK_SECTION_KEY ? Number.POSITIVE_INFINITY
      : field?.sectionOrder ?? (legacyRank === -1 ? Number.MAX_SAFE_INTEGER : legacyRank);
    // Meme libelle d'une version a l'autre = meme section pour la lecture.
    const group = groups.get(label) ?? { key: `${key}-${groups.size}`, label, rank, first: index, rows: [] };
    group.rank = Math.min(group.rank, rank);
    group.rows.push(row);
    groups.set(label, group);
  });
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.first - b.first);
}

export function BaseStats() {
  const { id: baseId } = useParams();
  const { t, lang } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const { toast } = useToast();

  const [stats, setStats] = useState<InclusionStats | null>(null);
  const [completeness, setCompleteness] = useState<CompletenessRow[]>([]); // B1
  const [isOwner, setIsOwner] = useState(false);
  const [target, setTarget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [allCompleteness, setAllCompleteness] = useState(false);
  const [completenessQuery, setCompletenessQuery] = useState('');
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [fieldsByVersion, setFieldsByVersion] = useState<ReadonlyMap<string, readonly TemplateField[]> | null>(null);

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
      setCurrentVersionId(listing?.base.currentTemplateVersionId ?? null);
      setFieldsByVersion(null);
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

  // Les sections ne sont lues qu'a l'ouverture de « Voir toutes ». Aide de presentation : si
  // la lecture echoue, la liste reste simple, sans erreur ni donnee perdue.
  useEffect(() => {
    if (!allCompleteness || fieldsByVersion) return;
    const versionIds = [...new Set(completeness.map((r) => r.templateVersionId ?? currentVersionId))]
      .filter((id): id is string => Boolean(id));
    if (versionIds.length === 0) return;
    let active = true;
    Promise.all(versionIds.map(async (id) => [id, await getTemplateFields(templates, id)] as const))
      .then((entries) => { if (active) setFieldsByVersion(new Map(entries)); })
      .catch(() => { /* regroupement indisponible : liste simple */ });
    return () => { active = false; };
  }, [allCompleteness, fieldsByVersion, completeness, currentVersionId, templates]);

  async function saveTarget(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !stats) return;
    const expectedRevision = stats.targetRevision;
    setBusy(true);
    try {
      const n = target.trim() === '' ? null : Math.max(1, Math.round(Number(target)));
      await bases.setInclusionTarget(baseId, n, targetDate || null, expectedRevision);
      toast(t('stats.saved'));
      setGoalOpen(false);
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

  // Resume de la completude, et reperes (portee, version) montres seulement s'ils varient.
  const completenessSummary = useMemo(() => {
    const measured = completeness.filter((r) => r.total > 0);
    return {
      zero: measured.filter((r) => r.filled === 0).length,
      complete: measured.filter((r) => r.filled >= r.total).length,
      partial: measured.filter((r) => r.filled > 0 && r.filled < r.total).length,
      showScope: new Set(completeness.map((r) => r.scope)).size > 1,
      showVersion: new Set(completeness.map((r) => r.versionNumber ?? null)).size > 1,
    };
  }, [completeness]);

  if (loading) return <SkeletonList rows={4} />;
  if (!stats) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;

  const pct = stats.target ? Math.min(100, Math.round((stats.total / stats.target) * 100)) : null;
  const query = completenessQuery.trim().toLocaleLowerCase();
  const shownCompleteness = allCompleteness
    ? completeness.filter((r) => !query || r.label.toLocaleLowerCase().includes(query))
    : completeness.slice(0, COMPLETENESS_PREVIEW);
  const completenessGroups = allCompleteness && fieldsByVersion
    ? groupCompletenessBySection(shownCompleteness, fieldsByVersion, currentVersionId, t)
    : null;

  const completenessItem = (r: CompletenessRow) => {
    const observed = r.observed ?? r.filled;
    const missingCoded = r.missingCoded ?? 0;
    const rowPct = r.total > 0 ? Math.round((r.filled / r.total) * 100) : null;
    const barColor = rowPct == null ? 'bg-slate-300' : rowPct >= 80 ? 'bg-teal-600' : rowPct >= 50 ? 'bg-amber-500' : 'bg-red-500';
    return (
      <li key={`${r.mode ?? 'legacy'}-${r.templateVersionId ?? 'v'}-${r.scope}-${r.fieldKey}`} className="text-sm">
        <div className="mb-0.5 flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-slate-700">
            {r.label}
            {completenessSummary.showScope && <span className="ml-1.5 text-[11px] text-slate-400">{t(`scope.${r.scope}`)}</span>}
            {completenessSummary.showVersion && r.versionNumber != null && <span className="ml-1.5 text-[11px] text-slate-400">v{r.versionNumber}</span>}
          </span>
          <span className="whitespace-nowrap text-xs text-slate-500">
            {rowPct == null ? '—' : `${r.filled} / ${r.total} (${rowPct} %)`}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100">
          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${rowPct ?? 0}%` }} />
        </div>
        {missingCoded > 0 && (
          <p className="mt-0.5 text-[11px] text-slate-400">
            {observed} {t('stats.observed_short')} + {missingCoded} {t('stats.missing_coded_short')}
          </p>
        )}
      </li>
    );
  };

  return (
    <section className="max-w-4xl space-y-5 sm:space-y-6">
      <PageHeader title={t('stats.page_title')} description={t('stats.page_subtitle')} />
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {/* Audit UI mobile, lot 4 (5.8-A) : les trois indicateurs tiennent sur une ligne, et le
          proprietaire regle l'objectif a la demande, juste en dessous. */}
      <div className="card">
        <dl className="grid grid-cols-3 divide-x divide-slate-100 text-center dark:divide-slate-800">
          {([
            [t('stats.total'), String(stats.total)],
            [t('stats.target_label'), stats.target != null ? String(stats.target) : '—'],
            [t('stats.progress'), pct != null ? `${pct} %` : '—'],
          ] as const).map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse px-2 py-3">
              <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
        {isOwner && (
          <>
            <button type="button" aria-expanded={goalOpen} aria-controls="stats-goal-form" onClick={() => setGoalOpen((open) => !open)}
              className="flex min-h-11 w-full items-center gap-2 border-t border-slate-100 px-4 py-2 text-left sm:px-5 dark:border-slate-800">
              <Target size={16} aria-hidden className="shrink-0 text-teal-700 dark:text-teal-300" />
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">{t('stats.goal_title')}</span>
              <span className="text-sm font-medium text-teal-700 dark:text-teal-300">{stats.target != null ? t('stats.goal_edit') : t('stats.goal_define')}</span>
              <ChevronDown size={16} aria-hidden className={`shrink-0 text-slate-400 transition motion-reduce:transition-none ${goalOpen ? 'rotate-180' : ''}`} />
            </button>
            <form id="stats-goal-form" hidden={!goalOpen} onSubmit={saveTarget}
              className="flex flex-col gap-4 border-t border-slate-100 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:p-5 dark:border-slate-800">
              <p className="helper-text sm:basis-full">{t('stats.goal_description')}</p>
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
          </>
        )}
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
          {/* Audit UI mobile, lot 4 (5.8-B) : le resume d'abord, puis les variables a reprendre. */}
          <p className="mb-3 flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {t('stats.completeness_zero').replace('{n}', String(completenessSummary.zero))}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {t('stats.completeness_partial').replace('{n}', String(completenessSummary.partial))}
            </span>
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">
              {t('stats.completeness_full').replace('{n}', String(completenessSummary.complete))}
            </span>
          </p>
          {allCompleteness && (
            <label className="mb-3 block">
              <span className="sr-only">{t('stats.completeness_search')}</span>
              <input type="search" className="input" value={completenessQuery} placeholder={t('stats.completeness_search')}
                onChange={(e) => setCompletenessQuery(e.target.value)} />
            </label>
          )}
          {shownCompleteness.length === 0 && <p className="text-sm text-slate-500">{t('stats.completeness_no_match')}</p>}
          {completenessGroups ? (
            <div className="space-y-4">
              {completenessGroups.map((group, index) => (
                <section key={group.key} aria-labelledby={`stats-section-${index}`}>
                  <h3 id={`stats-section-${index}`} className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{group.label}</h3>
                  <ul className="space-y-2">{group.rows.map(completenessItem)}</ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="space-y-2">{shownCompleteness.map(completenessItem)}</ul>
          )}
          {completeness.length > COMPLETENESS_PREVIEW && (
            <button type="button" aria-expanded={allCompleteness} className="btn-ghost mt-2 -ml-3"
              onClick={() => { setAllCompleteness((all) => !all); setCompletenessQuery(''); }}>
              {allCompleteness
                ? t('stats.completeness_show_less').replace('{n}', String(COMPLETENESS_PREVIEW))
                : t('stats.completeness_show_all').replace('{n}', String(completeness.length))}
            </button>
          )}
        </SectionCard>
      )}
    </section>
  );
}
