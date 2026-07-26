import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useGroupRepository } from '../../data/RepositoryProvider';
import type { GroupBase } from '../../data/groups';
import type { BaseListing } from '../../data/bases';
import { ConfirmDialog } from '../../components/ConfirmDialog';

// C2 v1 — detail d'un groupe : renommer/supprimer, rattacher/detacher des bases (dont on est
// proprietaire). Organisation seulement : ne touche pas a l'acces.
export function GroupDetail() {
  const { groupId } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const groups = useGroupRepository();
  const bases = useBaseRepository();

  const [name, setName] = useState('');
  const [groupBases, setGroupBases] = useState<GroupBase[]>([]);
  const [myBases, setMyBases] = useState<BaseListing[]>([]);
  const [attachId, setAttachId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false); // UI-2 : modale au lieu de window.confirm

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const [all, gb, mine] = await Promise.all([groups.listGroups(), groups.getGroupBases(groupId), bases.listMyBases()]);
      setName(all.find((g) => g.id === groupId)?.name ?? '');
      setGroupBases(gb);
      setMyBases(mine);
      setError(null);
    } catch (e) { setError(errorMessage(e, t('common.error'))); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, groups, bases]);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await load(); setError(null); }
    catch (e) { setError(errorMessage(e, t('common.error'))); }
    finally { setBusy(false); }
  }

  // Bases rattachables : celles dont JE suis proprietaire et qui ne sont pas deja dans CE groupe.
  const attachable = myBases.filter((b) => b.role === 'owner' && !groupBases.some((gb) => gb.id === b.base.id));

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <button onClick={() => navigate('/groups')} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('group.title')}</button>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="input flex-1 text-lg font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (groupId && name.trim()) void run(() => groups.renameGroup(groupId, name.trim())); }}
            aria-label={t('group.name')}
          />
          <button onClick={() => setConfirmDelete(true)} className="btn-secondary text-red-600">
            {t('group.delete')}
          </button>
          <ConfirmDialog
            open={confirmDelete}
            title={t('group.delete')}
            body={t('group.delete_confirm')}
            danger
            busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => { if (groupId) void run(async () => { await groups.deleteGroup(groupId); setConfirmDelete(false); navigate('/groups'); }); }}
          />
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="card flex flex-wrap items-end gap-2 p-4">
        <label className="flex flex-1 flex-col text-xs text-slate-600">
          {t('group.attach')}
          <select className="input mt-1" value={attachId} onChange={(e) => setAttachId(e.target.value)}>
            <option value="">{attachable.length ? '—' : t('group.no_attachable')}</option>
            {attachable.map((b) => (
              <option key={b.base.id} value={b.base.id}>{b.base.name}{b.base.specialty ? ` · ${b.base.specialty}` : ''}</option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !attachId || !groupId}
          onClick={() => { if (groupId && attachId) void run(async () => { await groups.attachBase(groupId, attachId); setAttachId(''); }); }}
          className="btn-primary"
        >
          {t('group.attach_action')}
        </button>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('group.detail_bases')}</h2>
        {groupBases.length === 0 ? (
          <p className="text-sm text-slate-500">{t('group.no_bases')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {groupBases.map((b) => (
              <li key={b.id} className="card flex items-center justify-between px-3 py-2">
                <button onClick={() => navigate(`/bases/${b.id}`)} className="font-medium text-teal-700 hover:text-teal-800 hover:underline">
                  {b.name}{b.specialty ? <span className="ml-1 text-xs text-slate-400">{b.specialty}</span> : null}
                </button>
                <button disabled={busy} onClick={() => void run(() => groups.detachBase(b.id))} className="text-xs text-red-600 hover:underline">
                  {t('group.detach')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
