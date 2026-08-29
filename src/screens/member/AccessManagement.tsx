import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useAccessRepository, useBaseRepository } from '../../data/RepositoryProvider';
import {
  permissionsForPreset, presetOf, roleForPermissions, ROLE_PRESETS,
  type AccessItem, type BasePermissions, type IdentityAudit, type InvitationItem, type RolePreset,
} from '../../data/access';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { SkeletonList } from '../../components/Skeleton';
import { Checkbox } from '../../components/Checkbox';

// Partage de base ENTRE MEDECINS uniquement (v3.0). Le role curateur est un role GLOBAL
// (admin) qui travaille le pool de curation, jamais invite ici.
const PERMISSION_KEYS: (keyof BasePermissions)[] = [
  'canViewIdentity', 'canViewRawDocuments', 'canEditStructuredData', 'canExportData', 'canManageAccess',
];
const AUDIT_PAGE_SIZE = 20;

// C1 : le profil affiche = celui qui correspond aux cases cochees, sinon « Personnalise ».
const presetLabel = (p: BasePermissions, t: (k: MessageKey) => string): string =>
  t(`access.preset.${presetOf(p) ?? 'custom'}` as MessageKey);

// Gestion des acces (cahier v3.0 §10) : inviter par email avec un role et 6
// permissions granulaires ; voir / revoquer les invitations en attente ; voir,
// ajuster les permissions et revoquer les acces actuels. Proprietaire (ou
// can_manage_access) uniquement ; la base applique aussi les invariants par CHECK.
export function AccessManagement() {
  const { id: baseId } = useParams();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const accessRepo = useAccessRepository();

  const [canManage, setCanManage] = useState(false);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [accessList, setAccessList] = useState<AccessItem[]>([]);
  const [idAudit, setIdAudit] = useState<IdentityAudit | null>(null); // E1
  const [auditVisibleCount, setAuditVisibleCount] = useState(AUDIT_PAGE_SIZE);
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
    setAuditVisibleCount(AUDIT_PAGE_SIZE);
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

  if (loading) {
    return (
      <section className="max-w-4xl space-y-6">
        <PageHeader title={t('access.title')} description={t('access.subtitle')} />
        <SkeletonList rows={5} label={t('common.loading')} />
      </section>
    );
  }

  return (
    <section className="max-w-4xl space-y-5 sm:space-y-6">
      <PageHeader title={t('access.title')} description={t('access.subtitle')} />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {!canManage ? (
        <p className="text-slate-500">{t('access.owner_only')}</p>
      ) : (
        <>
          <SectionCard title={t('access.invite')} description={t(`access.preset_desc.${presetOf(perms) ?? 'custom'}` as MessageKey)}>
          <form onSubmit={invite} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
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
            <fieldset className="grid grid-cols-2 gap-1 lg:grid-cols-3">
              <legend className="mb-2 text-xs font-medium text-slate-500">{t('access.fine_tune')}</legend>
              {PERMISSION_KEYS.map((k) => (
                <Checkbox
                  key={k}
                  label={t(`access.perm.${k}` as MessageKey)}
                  checked={perms[k]}
                  onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))}
                  containerClassName="w-full"
                />
              ))}
            </fieldset>
            {link && (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs dark:border-teal-800 dark:bg-teal-950/50" role="status" aria-live="polite">
                <span className="font-medium text-teal-800 dark:text-teal-200">{t('access.link_created')}</span>
                <code className="ml-1 break-all text-slate-700 dark:text-slate-200">{link}</code>
              </div>
            )}
          </form>
          </SectionCard>

          <SectionCard title={t('access.pending')} bodyClassName="p-4 sm:p-5">
            {invitations.length === 0 ? (
              <p className="text-sm text-slate-500">{t('access.no_pending')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {invitations.map((inv) => (
                  <li key={inv.id} className="surface-muted flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {inv.email} · <span className="font-medium">{presetLabel(inv.permissions, t)}</span>
                    </span>
                    <button type="button" onClick={() => void run(() => accessRepo.revokeInvitation(inv.id))} className="btn-ghost min-h-11 text-red-700 dark:text-red-300">
                      {t('access.revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={t('access.current')} bodyClassName="p-4 sm:p-5">
            {accessList.length === 0 ? (
              <p className="text-sm text-slate-500">{t('access.no_access')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {accessList.map((a) => (
                  <li key={a.id} className="surface-muted p-3 sm:p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-medium">
                        {a.fullName ?? a.userId.slice(0, 8)} · {presetLabel(a.permissions, t)}
                      </span>
                      <button type="button" onClick={() => void run(() => accessRepo.revokeAccess(a.id))} className="btn-ghost min-h-11 self-start text-red-700 dark:text-red-300 sm:self-auto">
                        {t('access.revoke')}
                      </button>
                    </div>
                    <fieldset
                      className="mt-2 grid grid-cols-2 gap-1 lg:grid-cols-3"
                      aria-label={a.fullName ?? a.userId.slice(0, 8)}
                    >
                      {PERMISSION_KEYS.map((k) => (
                        <Checkbox
                          key={k}
                          label={t(`access.perm.${k}` as MessageKey)}
                          disabled={busy}
                          checked={a.permissions[k]}
                          onChange={(e) => void run(() => accessRepo.setPermissions(a.id, { ...a.permissions, [k]: e.target.checked }))}
                          containerClassName="w-full"
                        />
                      ))}
                    </fieldset>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {idAudit && (
            <SectionCard title={t('access.identity_activity')} description={t('access.identity_activity_hint')} bodyClassName="p-4 sm:p-5">
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
                  <details className="surface-muted group overflow-hidden">
                    <summary role="button" className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 text-sm font-medium text-slate-700">
                      <span className="mr-auto">{t('access.identity_details').replace('{n}', String(idAudit.reads.length))}</span>
                      <ChevronDown size={18} className="text-slate-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                    </summary>
                    <div className="border-t border-slate-200 p-3">
                      <ul className="space-y-1 text-xs">
                        {idAudit.reads.slice(0, auditVisibleCount).map((r, i) => (
                          <li key={`${r.at}-${i}`} className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                            <span>
                              <span className="font-medium text-slate-700">{r.readerName}</span>
                              <span className="text-slate-400"> → </span>
                              <span className="font-mono">{r.patientCode ?? '—'}</span>
                            </span>
                            <time className="text-slate-400" dateTime={r.at}>{new Date(r.at).toLocaleString()}</time>
                          </li>
                        ))}
                      </ul>
                      {auditVisibleCount < idAudit.reads.length && (
                        <button
                          type="button"
                          className="btn-secondary mt-3 w-full sm:w-auto"
                          onClick={() => setAuditVisibleCount((count) => count + AUDIT_PAGE_SIZE)}
                        >
                          {t('common.show_more')}
                        </button>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </section>
  );
}
