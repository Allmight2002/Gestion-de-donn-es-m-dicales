import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAuth } from '../../auth/useAuth';
import { canCreateBase } from '../../auth/logic';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { BaseListing, PublishedTemplateOption } from '../../data/bases';

// Tableau de bord (cahier §8.3) : bases possedees + partagees. La creation de base est
// reservee au role MEDECIN (le staff voit seulement les bases auxquelles il a acces).
export function Dashboard() {
  const repo = useBaseRepository();
  const { profile } = useAuth();
  const { t } = useI18n();
  const mayCreate = canCreateBase(profile);
  const navigate = useNavigate();
  const [bases, setBases] = useState<BaseListing[]>([]);
  const [templates, setTemplates] = useState<PublishedTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [versionId, setVersionId] = useState('');
  const [busy, setBusy] = useState(false);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [b, tpl] = await Promise.all([repo.listMyBases(), repo.listTemplateModels()]);
      setBases(b);
      setTemplates(tpl);
      setVersionId((prev) => prev || tpl[0]?.versionId || '');
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !versionId) return;
    setBusy(true);
    try {
      const base = await repo.createBase(name.trim(), specialty.trim() || null, versionId);
      setName('');
      setSpecialty('');
      await reload();
      navigate(`/bases/${base.id}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="page-title">{t('member.dashboard.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('app.tagline')}</p>
      </div>

      {mayCreate && (
        <form onSubmit={create} className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('dashboard.create_base')}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
              {t('dashboard.base_name')}
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
              {t('admin.specialty')}
              <input className="input" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
            </label>
            <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
              {t('dashboard.gabarit')}
              <select className="input" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                {templates.map((tpl) => (
                  <option key={tpl.versionId} value={tpl.versionId}>
                    {tpl.name} · {t(`model.${tpl.scope}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy || templates.length === 0} className="btn-primary">
              {t('dashboard.create_base')}
            </button>
          </div>
        </form>
      )}

      {mayCreate && templates.length === 0 && !loading && (
        <p className="text-sm text-amber-700">{t('dashboard.no_templates_hint')}</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-slate-500">{t('common.loading')}</p>}
      {!loading && bases.length === 0 && (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('dashboard.no_bases')}</div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bases.map((b) => (
          <li key={b.base.id}>
            <button
              onClick={() => navigate(`/bases/${b.base.id}`)}
              className="card group flex w-full flex-col gap-3 p-5 text-left transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/15">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="8" ry="3" />
                    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
                  </svg>
                </span>
                <span className="badge">{t(`baserole.${b.role}`)}</span>
              </div>
              <div>
                <div className="font-semibold text-slate-900">{b.base.name}</div>
                {b.base.specialty && <div className="text-sm text-slate-500">{b.base.specialty}</div>}
              </div>
              {b.templateName && (
                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400">
                  <span>{t('dashboard.gabarit')} : {b.templateName} v{b.versionNumber}</span>
                  <span className="text-teal-600 transition group-hover:translate-x-0.5">→</span>
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
