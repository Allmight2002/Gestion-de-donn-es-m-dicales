import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useGroupRepository } from '../../data/RepositoryProvider';
import type { ResearchGroup } from '../../data/groups';

// C2 v1 — Groupes de recherche (etiquette d'organisation) : regrouper ses bases par equipe/projet.
// Cette version n'affecte PAS l'acces (toujours gere par base) ; c'est une vue d'organisation.
export function GroupList() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const groups = useGroupRepository();

  const [items, setItems] = useState<ResearchGroup[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await groups.listGroups()); setError(null); }
    catch (e) { setError(errorMessage(e, t('common.error'))); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await groups.createGroup(name.trim()); setName(''); await load(); setError(null); }
    catch (e) { setError(errorMessage(e, t('common.error'))); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <button onClick={() => navigate('/')} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('base.back_to_dashboard')}</button>
        <h1 className="page-title mt-2">{t('group.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('group.subtitle')}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <form onSubmit={create} className="card flex flex-wrap items-end gap-2 p-4">
        <label className="flex flex-1 flex-col text-xs text-slate-600">
          {t('group.name')}
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy} className="btn-primary">{t('group.create')}</button>
      </form>

      {items.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('group.empty')}</div>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((g) => (
            <li key={g.id} className="card flex items-center justify-between px-3 py-2">
              <button onClick={() => navigate(`/groups/${g.id}`)} className="font-medium text-teal-700 hover:text-teal-800 hover:underline">{g.name}</button>
              <span className="text-xs text-slate-400">{g.baseCount} {t('group.bases')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
