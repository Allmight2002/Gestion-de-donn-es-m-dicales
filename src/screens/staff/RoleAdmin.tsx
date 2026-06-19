import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAdminRepository } from '../../data/RepositoryProvider';
import { ASSIGNABLE_ROLES, type AdminProfile } from '../../data/admin';
import type { GlobalRole } from '../../auth/types';

// Administration des roles globaux (cahier v3.0) : l'admin systeme attribue medecin /
// curateur / validateur / analyste. Les roles staff (curation) sont definis ICI, jamais
// par un medecin. Le system_admin est affiche en lecture seule (seede, non modifiable ici).
export function RoleAdmin() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const admin = useAdminRepository();

  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => (e instanceof Error ? e.message : t('common.error'));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProfiles(await admin.listProfiles());
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(userId: string, role: GlobalRole) {
    setBusy(userId);
    try {
      await admin.setGlobalRole(userId, role);
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')} className="text-sm text-teal-700 hover:underline">
          ← {t('admin.back')}
        </button>
        <h1 className="text-2xl font-semibold">{t('roleadmin.title')}</h1>
      </div>
      <p className="text-sm text-slate-500">{t('roleadmin.hint')}</p>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-slate-500">{t('common.loading')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-1">{t('roleadmin.user')}</th>
              <th>{t('roleadmin.role')}</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-1">{p.fullName || <span className="font-mono text-xs text-slate-400">{p.id.slice(0, 8)}</span>}</td>
                <td>
                  {p.globalRole === 'system_admin' ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t('role.system_admin')}</span>
                  ) : (
                    <select
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      value={p.globalRole}
                      disabled={busy === p.id}
                      onChange={(e) => void change(p.id, e.target.value as GlobalRole)}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`role.${r}` as MessageKey)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
