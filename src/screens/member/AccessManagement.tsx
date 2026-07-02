import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAccessRepository, useBaseRepository } from '../../data/RepositoryProvider';
import {
  permissionsForPreset, presetOf, roleForPermissions, ROLE_PRESETS,
  type AccessItem, type BasePermissions, type IdentityAudit, type InvitationItem, type RolePreset,
} from '../../data/access';

// Partage de base ENTRE MEDECINS uniquement (v3.0). Le role curateur est un role GLOBAL
// (admin) qui travaille le pool de curation, jamais invite ici.
const PERMISSION_KEYS: (keyof BasePermissions)[] = [
  'canViewIdentity', 'canViewRawDocuments', 'canEditStructuredData', 'canExportData', 'canManageAccess',
];

// C1 : le profil affiche = celui qui correspond aux cases cochees, sinon « Personnalise ».
const presetLabel = (p: BasePermissions, t: (k: MessageKey) => string): string =>
  t(`access.preset.${presetOf(p) ?? 'custom'}` as MessageKey);

// Gestion des acces (cahier v3.0 §10) : inviter par email avec un role et 6
// permissions granulaires ; voir / revoquer les invitations en attente ; voir,
// ajuster les permissions et revoquer les acces actuels. Proprietaire (ou
// can_manage_access) uniquement ; la base applique aussi les invariants par CHECK.
export function AccessManagement() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const accessRepo = useAccessRepository();

  const [canManage, setCanManage] = useState(false);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [accessList, setAccessList] = useState<AccessItem[]>([]);
  const [idAudit, setIdAudit] = useState<IdentityAudit | null>(null); // E1
  const [email, setEmail] = useState('');
  // C1 : on part du profil le moins privilegie (Moniteur = lecture seule) ; l'invitant elargit
  // volontairement. Le role de partage (viewer/editor) est deduit des permissions a l'envoi.
  const [perms, setPerms] = useState<BasePermissions>(permissionsForPreset('monitor'));
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const base = await bases.getBase(baseId);
      const manage = base?.role === 'owner' || base?.permissions.canManageAccess === true;
      setCanManage(manage);
      if (manage) {
        setInvitations(await accessRepo.listInvitations(baseId));
        setAccessList(await accessRepo.listAccess(baseId));
        // E1 : section resiliente — si la RPC n'est pas encore deployee, on masque sans casser.
        try { setIdAudit(await accessRepo.getIdentityAudit(baseId)); } catch { setIdAudit(null); }
      }
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, accessRepo]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyPreset(value: string) {
    if (value !== 'custom') setPerms(permissionsForPreset(value as RolePreset));
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !email.trim()) return;
    setBusy(true);
    try {
      // Le role de partage decoule des permissions (editor des qu'il y a de la saisie).
      const { token } = await accessRepo.createInvitation(baseId, email.trim(), roleForPermissions(perms), perms);
      setLink(`${window.location.origin}/accept-invitation?token=${token}`);
      setEmail('');
      await load();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('access.title')}</h1>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {!canManage ? (
        <p className="text-slate-500">{t('access.owner_only')}</p>
      ) : (
        <>
          <form onSubmit={invite} className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-slate-700">{t('access.invite')}</h2>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-slate-600">
                {t('access.email')}
                <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="flex flex-col text-xs text-slate-600">
                {t('access.profile')}
                <select className="input" value={presetOf(perms) ?? 'custom'} onChange={(e) => applyPreset(e.target.value)}>
                  {ROLE_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {t(`access.preset.${p}` as MessageKey)}
                    </option>
                  ))}
                  <option value="custom">{t('access.preset.custom')}</option>
                </select>
              </label>
              <button type="submit" disabled={busy} className="btn-primary">
                {t('access.send_invite')}
              </button>
            </div>
            <p className="text-xs text-slate-500">{t(`access.preset_desc.${presetOf(perms) ?? 'custom'}` as MessageKey)}</p>
            <fieldset className="grid grid-cols-2 gap-1 text-xs text-slate-600 sm:grid-cols-3">
              <legend className="mb-1 text-xs font-medium text-slate-500">{t('access.fine_tune')}</legend>
              {PERMISSION_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={perms[k]}
                    onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))}
                  />
                  {t(`access.perm.${k}` as MessageKey)}
                </label>
              ))}
            </fieldset>
            {link && (
              <div className="rounded-xl border border-teal-100 bg-teal-50 p-3 text-xs">
                <span className="text-teal-800">{t('access.link_created')}</span>
                <code className="ml-1 break-all">{link}</code>
              </div>
            )}
          </form>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('access.pending')}</h2>
            {invitations.length === 0 ? (
              <p className="text-sm text-slate-500">{t('access.no_pending')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {invitations.map((inv) => (
                  <li key={inv.id} className="card flex items-center justify-between px-3 py-2">
                    <span>
                      {inv.email} · <span className="font-medium">{presetLabel(inv.permissions, t)}</span>
                    </span>
                    <button onClick={() => void run(() => accessRepo.revokeInvitation(inv.id))} className="text-xs text-red-600 hover:underline">
                      {t('access.revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('access.current')}</h2>
            {accessList.length === 0 ? (
              <p className="text-sm text-slate-500">{t('access.no_access')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {accessList.map((a) => (
                  <li key={a.id} className="card px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {a.fullName ?? a.userId.slice(0, 8)} · {presetLabel(a.permissions, t)}
                      </span>
                      <button onClick={() => void run(() => accessRepo.revokeAccess(a.id))} className="text-xs text-red-600 hover:underline">
                        {t('access.revoke')}
                      </button>
                    </div>
                    <fieldset className="mt-1 grid grid-cols-2 gap-1 text-xs text-slate-500 sm:grid-cols-3">
                      {PERMISSION_KEYS.map((k) => (
                        <label key={k} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={a.permissions[k]}
                            onChange={(e) => void run(() => accessRepo.setPermissions(a.id, { ...a.permissions, [k]: e.target.checked }))}
                          />
                          {t(`access.perm.${k}` as MessageKey)}
                        </label>
                      ))}
                    </fieldset>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {idAudit && (
            <div>
              <h2 className="mb-1 text-sm font-semibold text-slate-700">{t('access.identity_activity')}</h2>
              <p className="mb-3 text-xs text-slate-500">{t('access.identity_activity_hint')}</p>
              {idAudit.reads.length === 0 ? (
                <p className="text-sm text-slate-500">{t('access.identity_none')}</p>
              ) : (
                <div className="space-y-3">
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {idAudit.byReader.map((s, i) => (
                      <li key={i} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                        <span className="font-medium text-slate-700">{s.readerName}</span>
                        <span className="text-slate-500"> · {s.count} {t('access.reads_word')}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-1 text-xs">
                    {idAudit.reads.map((r, i) => (
                      <li key={i} className="flex items-center justify-between border-b border-slate-100 pb-1">
                        <span>
                          <span className="font-medium text-slate-700">{r.readerName}</span>
                          <span className="text-slate-400"> → </span>
                          <span className="font-mono">{r.patientCode ?? '—'}</span>
                        </span>
                        <span className="text-slate-400">{new Date(r.at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
