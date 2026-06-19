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
      <h1 className="text-2xl font-semibold">{t('member.dashboard.title')}</h1>

      {mayCreate && (
      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50 p-3">
        <label className="flex flex-col text-xs text-slate-600">
          {t('dashboard.base_name')}
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          {t('admin.specialty')}
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          {t('dashboard.gabarit')}
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
          >
            {templates.map((tpl) => (
              <option key={tpl.versionId} value={tpl.versionId}>
                {tpl.name} · {t(`model.${tpl.scope}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || templates.length === 0}
          className="rounded bg-teal-700 px-3 py-1 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {t('dashboard.create_base')}
        </button>
      </form>
      )}

      {mayCreate && templates.length === 0 && !loading && (
        <p className="text-sm text-amber-700">{t('dashboard.no_templates_hint')}</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-slate-500">{t('common.loading')}</p>}
      {!loading && bases.length === 0 && <p className="text-slate-500">{t('dashboard.no_bases')}</p>}

      <ul className="grid gap-3 sm:grid-cols-2">
        {bases.map((b) => (
          <li key={b.base.id}>
            <button
              onClick={() => navigate(`/bases/${b.base.id}`)}
              className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-teal-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{b.base.name}</span>
                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                  {t(`baserole.${b.role}`)}
                </span>
              </div>
              {b.base.specialty && <div className="text-sm text-slate-500">{b.base.specialty}</div>}
              {b.templateName && (
                <div className="mt-1 text-xs text-slate-400">
                  {t('dashboard.gabarit')} : {b.templateName} v{b.versionNumber}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
