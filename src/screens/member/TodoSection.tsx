import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, ClipboardCheck, Clock, FilePen, MessageCircleQuestion } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository, useMissionRepository, useWorkDraftRepository } from '../../data/RepositoryProvider';
import type { BaseListing, BaseTodoCounts } from '../../data/bases';
import type { WorkDraftKind, WorkDraftSummary } from '../../data/workDrafts';
import { daysUntil, missionStatus, type MissionAccount } from '../../data/mission';
import { formatDateTime } from '../../lib/formatDate';

// Audit UI mobile, lot 8 : la page « A faire » tient la promesse du tableau de bord
// (« reprenez une saisie et suivez les travaux en cours »). Trois lectures legeres, chacune
// facultative : si l'une echoue ou n'existe pas encore sur le serveur, sa rubrique disparait
// et les autres restent. Rien ne s'affiche avant la liste des bases, et rien n'est bloque.
// Les brouillons locaux (hors ligne) restent dans « Synchronisation », qui les gere.
const MISSION_NOTICE_DAYS = 14;
const DRAFTS_SHOWN = 5;
// my_todo_counts s'arrete a 100 dossiers incomplets par base : la file donne le compte exact.
const INCOMPLETE_CAP = 100;

const DRAFT_TITLE: Record<WorkDraftKind, MessageKey> = {
  patient_create: 'todo.draft_patient_create',
  patient_update: 'todo.draft_patient_update',
  encounter_create: 'todo.draft_encounter_create',
  encounter_update: 'todo.draft_encounter_update',
};

// Chaque brouillon rouvre SON formulaire, qui le retrouve et propose explicitement de le
// reprendre (useWorkDraft) ; le lien ne donne acces a rien que l'ecran ne controle deja.
function draftLink(draft: WorkDraftSummary): string | null {
  const base = `/bases/${draft.baseId}`;
  switch (draft.kind) {
    case 'patient_create': return `${base}/patients/new/manual`;
    case 'patient_update': return draft.targetId ? `${base}/patients/${draft.targetId}/edit` : null;
    case 'encounter_create': return draft.targetId ? `${base}/patients/${draft.targetId}/encounters/new/manual` : null;
    case 'encounter_update':
      return draft.patientId && draft.targetId ? `${base}/patients/${draft.patientId}/encounters/${draft.targetId}/edit` : null;
    default: return null;
  }
}

type Row = { key: string; to: string; Icon: typeof FilePen; title: string; meta: string };
/** null : lecture non tentee (methode absente, rubrique hors role). */
type Outcome<T> = { ok: true; value: T } | { ok: false } | null;

const settle = <T,>(read: (() => Promise<T>) | null): Promise<Outcome<T>> => (read
  ? Promise.resolve().then(read).then((value) => ({ ok: true as const, value }), () => ({ ok: false as const }))
  : Promise.resolve(null));

export function TodoSection({ bases, showMissions }: { bases: BaseListing[]; showMissions: boolean }) {
  const { t, lang } = useI18n();
  const baseRepository = useBaseRepository();
  const workDrafts = useWorkDraftRepository();
  const missions = useMissionRepository();
  const [drafts, setDrafts] = useState<WorkDraftSummary[] | null>(null);
  const [counts, setCounts] = useState<BaseTodoCounts[] | null>(null);
  const [soon, setSoon] = useState<MissionAccount[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [allDrafts, setAllDrafts] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      settle(workDrafts.listMine ? () => workDrafts.listMine!() : null),
      settle(baseRepository.getTodoCounts ? () => baseRepository.getTodoCounts!() : null),
      settle(showMissions ? () => missions.list() : null),
    ]).then(([mine, perBase, missionRows]) => {
      if (!alive) return;
      setDrafts(mine?.ok ? mine.value : null);
      setCounts(perBase?.ok ? perBase.value : null);
      setSoon(missionRows?.ok
        ? missionRows.value
          .filter((mission) => {
            const status = missionStatus(mission);
            return (status === 'active' || status === 'pending') && daysUntil(mission.expiresAt) <= MISSION_NOTICE_DAYS;
          })
          .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
        : null);
      // Toutes les lectures tentees ont echoue : on le dit une fois, sans detail technique.
      const attempted = [mine, perBase, missionRows].filter((outcome) => outcome !== null);
      setUnavailable(attempted.length > 0 && attempted.every((outcome) => !outcome.ok));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [workDrafts, baseRepository, missions, showMissions]);

  if (!loaded) return null;
  // Seules les bases de la liste sont nommees et atteignables depuis ici.
  const nameOf = new Map(bases.map((listing) => [listing.base.id, listing.base.name]));
  const known = <T extends { baseId: string }>(items: T[] | null) => (items ?? []).filter((item) => nameOf.has(item.baseId));

  const draftRows: Row[] = known(drafts).flatMap((draft) => {
    const to = draftLink(draft);
    if (!to) return [];
    return [{
      key: `draft-${draft.id}`, to, Icon: FilePen,
      title: t(DRAFT_TITLE[draft.kind]).replace('{code}', draft.patientCode ?? '—'),
      meta: t('todo.draft_meta').replace('{date}', formatDateTime(draft.updatedAt, lang)).replace('{base}', nameOf.get(draft.baseId)!),
    }];
  });
  const perBase = known(counts);
  const rows: Row[] = [
    ...(allDrafts ? draftRows : draftRows.slice(0, DRAFTS_SHOWN)),
    ...perBase.filter((c) => c.clarifications > 0).map((c) => ({
      key: `clarifications-${c.baseId}`, to: `/bases/${c.baseId}/curation`, Icon: MessageCircleQuestion,
      title: t('todo.clarifications').replace('{n}', String(c.clarifications)), meta: nameOf.get(c.baseId)!,
    })),
    ...perBase.filter((c) => c.incomplete > 0).map((c) => ({
      key: `incomplete-${c.baseId}`, to: `/bases/${c.baseId}/queue`, Icon: ClipboardCheck,
      title: t('todo.incomplete').replace('{n}', c.incomplete >= INCOMPLETE_CAP ? `${INCOMPLETE_CAP}+` : String(c.incomplete)),
      meta: nameOf.get(c.baseId)!,
    })),
    ...(soon ?? []).map((mission) => ({
      key: `mission-${mission.accessId}`, to: '/missions', Icon: Clock,
      title: t('todo.mission').replace('{n}', String(Math.max(daysUntil(mission.expiresAt), 0))),
      meta: t('todo.mission_meta').replace('{label}', mission.accountLabel).replace('{base}', mission.baseName),
    })),
  ];
  if (rows.length === 0 && !unavailable) return null;

  return (
    <section aria-labelledby="todo-title" className="space-y-3">
      <h2 id="todo-title" className="section-title">{t('todo.title')}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t('todo.unavailable')}</p>
      ) : (
        <ul className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
          {rows.map(({ key, to, Icon, title, meta }) => (
            <li key={key}>
              <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <Icon size={18} aria-hidden className="shrink-0 text-teal-700 dark:text-teal-300" />
                <span className="min-w-0 flex-1">
                  {/* Le titre porte l'essentiel (code, nombre, jours) : il passe a la ligne. */}
                  <span className="block break-words text-sm font-medium text-slate-900 dark:text-slate-100">{title}</span>
                  <span className="block truncate text-xs text-slate-500">{meta}</span>
                </span>
                <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!allDrafts && draftRows.length > DRAFTS_SHOWN && (
        <button type="button" onClick={() => setAllDrafts(true)} className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300">
          {t('todo.show_all_drafts').replace('{n}', String(draftRows.length))}
        </button>
      )}
    </section>
  );
}
