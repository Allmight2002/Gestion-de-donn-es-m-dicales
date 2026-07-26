import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAdminRepository } from '../../data/RepositoryProvider';
import { ASSIGNABLE_ROLES, type AdminProfile } from '../../data/admin';
import type { GlobalRole } from '../../auth/types';

// Administration des roles globaux (cahier v3.0) : l'admin systeme attribue medecin ou
// curateur. Les roles staff (curation) sont definis ICI, jamais par un medecin. Le
// system_admin est affiche en lecture seule (seede, non modifiable ici).
export function RoleAdmin() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const admin = useAdminRepository();

  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

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
      <div>
        <button onClick={() => navigate('/admin')} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('roleadmin.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('roleadmin.hint')}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-slate-500">{t('common.loading')}</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">{t('roleadmin.user')}</th>
                <th className="px-4 py-2.5">{t('roleadmin.role')}</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">{p.fullName || <span className="font-mono text-xs text-slate-400">{p.id.slice(0, 8)}</span>}</td>
                  <td className="px-4 py-2.5">
                    {p.globalRole === 'system_admin' ? (
                      <span className="badge">{t('role.system_admin')}</span>
                    ) : (
                      <select
                        className="input max-w-xs"
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
        </div>
      )}
    </section>
  );
}
