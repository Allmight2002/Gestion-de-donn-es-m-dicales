import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { ChevronDown, Plus, X } from 'lucide-react';
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
  // Audit UI mobile, lot 5 (5.9 Accès A) : les membres d'abord ; l'invitation, les droits d'un
  // membre et la surveillance s'ouvrent a la demande.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [monitoringOpen, setMonitoringOpen] = useState(false);

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
      <PageHeader
        title={t('access.title')}
        description={t('access.subtitle')}
        actions={canManage && (
          <button
            type="button"
            onClick={() => setInviteOpen((open) => !open)}
            aria-expanded={inviteOpen}
            className={inviteOpen ? 'btn-secondary' : 'btn-primary'}
          >
            {inviteOpen ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
            {inviteOpen ? t('common.cancel') : t('access.invite_button')}
          </button>
        )}
      />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {!canManage ? (
        <p className="text-slate-500">{t('access.owner_only')}</p>
      ) : (
        <>
          {/* L'invitation : e-mail, profil et droits AVANT le bouton qui la cree. */}
          {inviteOpen && (
            <SectionCard title={t('access.invite')}>
              <form onSubmit={invite} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>
                {/* Ce que le profil permet : un avis, lisible avant d'envoyer. */}
                <p className="text-sm text-slate-600 dark:text-slate-300">{t(`access.preset_desc.${presetOf(perms) ?? 'custom'}` as MessageKey)}</p>
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
                <button type="submit" disabled={busy} className="btn-primary">
                  {t('access.send_invite')}
                </button>
                {link && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs dark:border-teal-800 dark:bg-teal-950/50" role="status" aria-live="polite">
                    <span className="font-medium text-teal-800 dark:text-teal-200">{t('access.link_created')}</span>
                    <code className="ml-1 break-all text-slate-700 dark:text-slate-200">{link}</code>
                  </div>
                )}
              </form>
            </SectionCard>
          )}

          <section aria-labelledby="access-current" className="space-y-3">
            <h2 id="access-current" className="section-title">{t('access.current')}</h2>
            {accessList.length === 0 ? (
              <p className="text-sm text-slate-500">{t('access.no_access')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {accessList.map((a) => {
                  const name = a.fullName ?? a.userId.slice(0, 8);
                  const granted = PERMISSION_KEYS.filter((k) => a.permissions[k]);
                  const open = editingId === a.id;
                  return (
                    <li key={a.id} className="card p-3 sm:p-4">
                      {/* Carte compacte : le nom, le profil, les droits en pastilles. */}
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-900 dark:text-slate-100">{name}</p>
                          <p className="text-slate-500 dark:text-slate-400">{presetLabel(a.permissions, t)}</p>
                          {granted.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('access.rights_of').replace('{name}', name)}>
                              {granted.map((k) => (
                                <li key={k} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                  {t(`access.perm.${k}` as MessageKey)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingId(open ? null : a.id)}
                          aria-expanded={open}
                          aria-controls={`access-rights-${a.id}`}
                          className="btn-ghost min-h-11 shrink-0"
                        >
                          {t('access.edit_rights')}
                        </button>
                      </div>
                      {open && (
                        <div id={`access-rights-${a.id}`} className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                          <fieldset className="grid grid-cols-2 gap-1 lg:grid-cols-3" aria-label={name}>
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
                          <button type="button" onClick={() => void run(() => accessRepo.revokeAccess(a.id))} className="btn-ghost min-h-11 text-red-700 dark:text-red-300">
                            {t('access.revoke')}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Rien en attente : pas de section vide. */}
          {invitations.length > 0 && (
            <SectionCard title={t('access.pending')} bodyClassName="p-4 sm:p-5">
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
            </SectionCard>
          )}

          {/* E1 : les consultations d'identite, repliees dans « Surveillance ». */}
          {idAudit && (
            <section className="space-y-3">
              <button
                type="button"
                onClick={() => setMonitoringOpen((open) => !open)}
                aria-expanded={monitoringOpen}
                aria-controls="access-monitoring"
                className="flex min-h-11 w-full items-center gap-2 text-left"
              >
                <span className="section-title flex-1">{t('access.monitoring')}</span>
                <ChevronDown size={18} aria-hidden className={`shrink-0 text-slate-500 transition motion-reduce:transition-none ${monitoringOpen ? 'rotate-180' : ''}`} />
              </button>
              <div id="access-monitoring" hidden={!monitoringOpen}>
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
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
