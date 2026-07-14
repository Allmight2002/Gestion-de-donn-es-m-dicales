import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useGroupRepository } from '../../data/RepositoryProvider';
import type { ResearchGroup } from '../../data/groups';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { EmptyState } from '../../components/EmptyState';

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
    <section className="max-w-4xl space-y-5">
      <PageHeader title={t('group.title')} description={t('group.subtitle')} />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <SectionCard title={t('group.create')} icon={Users}>
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="form-label flex-1">
            {t('group.name')}
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button type="submit" disabled={busy} className="btn-primary">{t('group.create')}</button>
        </form>
      </SectionCard>

      {items.length === 0 ? (
        <EmptyState icon={Users} title={t('group.empty')} />
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
