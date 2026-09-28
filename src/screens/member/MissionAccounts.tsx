import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronDown, Copy, Eye, EyeOff, MoreHorizontal, Plus, RotateCcw, UserPlus, X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository, useMissionRepository } from '../../data/RepositoryProvider';
import {
  daysUntil,
  maxExpiryDate,
  missionStatus,
  type MissionAccount,
  type MissionCredential,
} from '../../data/mission';
import type { BaseListing } from '../../data/bases';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { Checkbox } from '../../components/Checkbox';
import { SkeletonList } from '../../components/Skeleton';
import { Menu, MenuItem } from '../../components/Menu';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const endOfDay = (value: string): string => new Date(`${value}T23:59:59`).toISOString();
const showDate = (iso: string): string => new Date(iso).toLocaleDateString();

const STATUS_TONE: Record<string, string> = {
  active: 'bg-teal-100 text-teal-800',
  pending: 'bg-amber-100 text-amber-800',
  expired: 'bg-slate-100 text-slate-600',
  revoked: 'bg-red-100 text-red-700',
};

export function MissionAccounts() {
  const { id: routeBaseId } = useParams();
  const globalView = !routeBaseId;
  const { t } = useI18n();
  const bases = useBaseRepository();
  const missions = useMissionRepository();

  const [ownedBases, setOwnedBases] = useState<BaseListing[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState(routeBaseId ?? '');
  const [canManage, setCanManage] = useState(false);
  const [items, setItems] = useState<MissionAccount[]>([]);
  const [accountLabel, setAccountLabel] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [until, setUntil] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return isoDate(d);
  });
  const [canViewIdentity, setCanViewIdentity] = useState(false);
  const [reason, setReason] = useState('');
  const [extendFor, setExtendFor] = useState<string | null>(null);
  const [extendTo, setExtendTo] = useState('');
  const [revealed, setRevealed] = useState<{ accessId: string; credential: MissionCredential } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Audit UI mobile, lot 5 (5.11 A) : la liste d'abord ; la creation s'ouvre a la demande et
  // les missions terminees restent repliees.
  const [createOpen, setCreateOpen] = useState(false);
  const [endedOpen, setEndedOpen] = useState(false);
  const createOperation = useRef<string | null>(null);
  const regenerationOperations = useRef(new Map<string, string>());

  const msg = (e: unknown) => errorMessage(e, t('common.error'));
  const maxDate = isoDate(maxExpiryDate());
  const minDate = isoDate(new Date(Date.now() + 86_400_000));
  const targetBaseId = routeBaseId ?? selectedBaseId;

  const resetCreateOperation = () => { createOperation.current = null; };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (routeBaseId) {
        const base = await bases.getBase(routeBaseId);
        const owner = base?.role === 'owner';
        setCanManage(owner);
        setOwnedBases(base && owner ? [base] : []);
        if (owner) setItems(await missions.list(routeBaseId));
        else setItems([]);
      } else {
        const allBases = await bases.listMyBases();
        const owned = allBases.filter((base) => base.role === 'owner');
        setOwnedBases(owned);
        setCanManage(owned.length > 0);
        setSelectedBaseId((current) => current || owned[0]?.base.id || '');
        setItems(await missions.list());
      }
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeBaseId, bases, missions]);

  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!targetBaseId || !accountLabel.trim() || !loginIdentifier.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      createOperation.current ??= crypto.randomUUID();
      const credential = await missions.create({
        operationId: createOperation.current,
        baseId: targetBaseId,
        accountLabel: accountLabel.trim(),
        loginIdentifier: loginIdentifier.trim(),
        expiresAt: endOfDay(until),
        canViewIdentity,
        identityJustification: canViewIdentity ? reason.trim() : null,
      });
      await load();
      const created = (await missions.list(targetBaseId)).find(
        (item) => item.loginIdentifier === credential.loginIdentifier,
      );
      if (created) setRevealed({ accessId: created.accessId, credential });
      setNotice(t('mission.created'));
      setAccountLabel('');
      setLoginIdentifier('');
      setCanViewIdentity(false);
      setReason('');
      createOperation.current = null;
      setCreateOpen(false);
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function extend(mission: MissionAccount) {
    setBusy(true);
    try {
      await missions.extend(mission.accessId, endOfDay(extendTo));
      setExtendFor(null);
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(mission: MissionAccount) {
    setBusy(true);
    setNotice(null);
    try {
      const credential = await missions.reveal(mission.accessId);
      setRevealed({ accessId: mission.accessId, credential });
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword(mission: MissionAccount) {
    setBusy(true);
    try {
      const credential = revealed?.accessId === mission.accessId
        ? revealed.credential
        : await missions.reveal(mission.accessId);
      setRevealed({ accessId: mission.accessId, credential });
      await navigator.clipboard.writeText(credential.password);
      setNotice(t('mission.password_copied'));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(mission: MissionAccount) {
    if (!window.confirm(t('mission.regenerate_confirm'))) return;
    setBusy(true);
    setNotice(null);
    try {
      const operationId = regenerationOperations.current.get(mission.accessId) ?? crypto.randomUUID();
      regenerationOperations.current.set(mission.accessId, operationId);
      const credential = await missions.regenerate(mission.accessId, operationId);
      regenerationOperations.current.delete(mission.accessId);
      setRevealed({ accessId: mission.accessId, credential });
      setNotice(t('mission.regenerated'));
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(mission: MissionAccount) {
    if (!window.confirm(t('mission.revoke_confirm'))) return;
    setBusy(true);
    setNotice(null);
    try {
      await missions.revoke(mission.accessId);
      if (revealed?.accessId === mission.accessId) setRevealed(null);
      await load();
      setNotice(t('mission.revoked'));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={5} label={t('common.loading')} />;

  const current = items.filter((mission) => ['active', 'pending'].includes(missionStatus(mission)));
  const ended = items.filter((mission) => !['active', 'pending'].includes(missionStatus(mission)));

  const renderMission = (mission: MissionAccount) => {
    const status = missionStatus(mission);
    const left = daysUntil(mission.expiresAt);
    const live = status === 'active' || status === 'pending';
    const shown = revealed?.accessId === mission.accessId ? revealed.credential : null;
    // Un compte revoque ou sans justificatifs actifs n'a plus aucune action possible.
    const manageable = status !== 'revoked' && mission.credentialStatus === 'active';
    return (
      <li key={mission.accessId} className="card space-y-3 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{mission.accountLabel}</p>
            {globalView && (
              <Link to={`/bases/${mission.baseId}`} className="text-xs font-medium text-teal-700 hover:underline">
                {mission.baseName}
              </Link>
            )}
          </div>
          <span className={`badge shrink-0 ${STATUS_TONE[status]}`}>
            {t(`mission.status.${status}` as MessageKey)}
          </span>
          {/* Regenerer et revoquer : des gestes rares et confirmes, ranges dans « ⋯ ». */}
          {manageable && (
            <Menu
              triggerLabel={`${t('common.actions')} · ${mission.accountLabel}`}
              triggerClassName="icon-button -my-2 -mr-2 h-11 w-11 shrink-0 cursor-pointer"
              triggerContent={<MoreHorizontal size={20} aria-hidden />}
              panelClassName="card absolute right-0 z-10 mt-2 w-64 space-y-1 p-2 shadow-lg"
            >
              <MenuItem onSelect={() => void regenerate(mission)} disabled={busy} className="btn-ghost w-full justify-start">
                <RotateCcw size={16} aria-hidden /> {t('mission.regenerate')}
              </MenuItem>
              <MenuItem
                onSelect={() => void revoke(mission)}
                disabled={busy}
                className="flex min-h-11 w-full items-center rounded-xl px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                {t('mission.revoke')}
              </MenuItem>
            </Menu>
          )}
        </div>

        {/* Audit UI mobile, lots 0 et 5 : un compte revoque n'a ni identifiant ni mot de passe
            utilisables ; son nom suffit a le reconnaitre. */}
        {status !== 'revoked' && (
          <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
            <div>
              <span className="text-xs font-medium text-slate-500">{t('mission.identifier')}</span>
              <p className="mt-1 break-all font-mono text-sm text-slate-900">
                {mission.loginIdentifier ?? t('mission.legacy_disabled')}
              </p>
            </div>
            {mission.credentialStatus === 'active' && (
              <div>
                <span className="text-xs font-medium text-slate-500">{t('mission.password')}</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="min-w-36 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                    {shown?.password ?? '••••••••••••'}
                  </code>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => shown ? setRevealed(null) : void reveal(mission)}
                    className="icon-button"
                    title={shown ? t('mission.hide_password') : t('mission.show_password')}
                    aria-label={shown ? t('mission.hide_password') : t('mission.show_password')}
                  >
                    {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void copyPassword(mission)}
                    className="icon-button"
                    title={t('mission.copy_password')}
                    aria-label={t('mission.copy_password')}
                  >
                    <Copy size={16} aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>
            {t('mission.until')} {showDate(mission.expiresAt)}
            {live && left >= 0 && ` — ${t('mission.days_left').replace('{n}', String(left))}`}
          </span>
          {mission.canViewIdentity && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              {t('mission.identity_on')}
            </span>
          )}
          {manageable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setExtendFor(extendFor === mission.accessId ? null : mission.accessId);
                setExtendTo(isoDate(new Date(mission.expiresAt)));
              }}
              className="ml-auto font-medium text-teal-700 hover:underline"
            >
              {t('mission.extend')}
            </button>
          )}
        </div>

        {extendFor === mission.accessId && (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2"
            onSubmit={(e) => { e.preventDefault(); void extend(mission); }}
          >
            <label className="form-label text-xs">
              {t('mission.extend_to')}
              <input
                type="date"
                required
                className="input"
                min={minDate}
                max={maxDate}
                value={extendTo}
                onChange={(e) => setExtendTo(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy} className="btn-primary">
              {t('mission.extend')}
            </button>
          </form>
        )}
      </li>
    );
  };

  return (
    <section className="max-w-5xl space-y-5 sm:space-y-6">
      <PageHeader
        title={globalView ? t('mission.global_title') : t('mission.title')}
        description={globalView ? t('mission.global_subtitle') : t('mission.subtitle')}
        actions={canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen((open) => !open)}
            aria-expanded={createOpen}
            className={createOpen ? 'btn-secondary' : 'btn-primary'}
          >
            {createOpen ? <X size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
            {createOpen ? t('common.cancel') : t('mission.new_button')}
          </button>
        )}
      />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-teal-700">{notice}</p>}

      {!canManage ? (
        <p className="text-slate-500">{t('mission.owner_only')}</p>
      ) : (
        <>
          {createOpen && (
          <SectionCard title={t('mission.create')} description={t('mission.max_hint')} keepDescription icon={UserPlus}>
            <form onSubmit={create} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {globalView && (
                  <label className="form-label">
                    {t('mission.base')}
                    <select
                      required
                      className="input"
                      value={selectedBaseId}
                      onChange={(e) => { setSelectedBaseId(e.target.value); resetCreateOperation(); }}
                    >
                      {ownedBases.map((base) => (
                        <option key={base.base.id} value={base.base.id}>{base.base.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="form-label">
                  {t('mission.account_label')}
                  <input
                    required
                    maxLength={120}
                    className="input"
                    value={accountLabel}
                    onChange={(e) => { setAccountLabel(e.target.value); resetCreateOperation(); }}
                  />
                </label>
                <label className="form-label">
                  {t('mission.identifier')}
                  {/* Le tiret de la classe est ECHAPPE : les navigateurs compilent `pattern` avec le
                      drapeau `v`, qui refuse `.-` en classe de caracteres. Une expression qui ne
                      compile pas fait IGNORER l'attribut — le champ n'etait donc plus valide cote
                      navigateur et un identifiant non conforme partait jusqu'au serveur. Meme regle
                      que `IDENTIFIER_RE` de create-mission-account ; la saisie est deja minuscule. */}
                  <input
                    required
                    minLength={3}
                    maxLength={48}
                    pattern="[A-Za-z0-9](?:[A-Za-z0-9.\-]{1,46}[A-Za-z0-9])?"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="input font-mono"
                    value={loginIdentifier}
                    onChange={(e) => { setLoginIdentifier(e.target.value.toLowerCase()); resetCreateOperation(); }}
                  />
                  <span className="helper-text">{t('mission.identifier_hint')}</span>
                </label>
                <label className="form-label">
                  {t('mission.until')}
                  <input
                    type="date"
                    required
                    className="input"
                    min={minDate}
                    max={maxDate}
                    value={until}
                    onChange={(e) => { setUntil(e.target.value); resetCreateOperation(); }}
                  />
                </label>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                <Checkbox
                  checked={canViewIdentity}
                  onChange={(e) => { setCanViewIdentity(e.target.checked); resetCreateOperation(); }}
                  label={t('mission.identity_label')}
                  description={t('mission.identity_hint')}
                  containerClassName="w-full items-start"
                />
                {canViewIdentity && (
                  <label className="form-label mt-3">
                    {t('mission.identity_reason')}
                    <input
                      required
                      className="input"
                      value={reason}
                      onChange={(e) => { setReason(e.target.value); resetCreateOperation(); }}
                    />
                  </label>
                )}
              </div>

              <button type="submit" disabled={busy} className="btn-primary">
                {t('mission.create_button')}
              </button>
            </form>
          </SectionCard>
          )}

          {items.length === 0 ? (
            <p className="text-sm text-slate-500">{t('mission.none')}</p>
          ) : (
            <>
              <section aria-labelledby="missions-current" className="space-y-3">
                <h2 id="missions-current" className="text-sm font-semibold text-slate-700">
                  {t('mission.current_title').replace('{n}', String(current.length))}
                </h2>
                {current.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('mission.none_current')}</p>
                ) : (
                  <ul className="space-y-3 text-sm">{current.map(renderMission)}</ul>
                )}
              </section>

              {ended.length > 0 && (
                <section className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setEndedOpen((open) => !open)}
                    aria-expanded={endedOpen}
                    aria-controls="missions-ended"
                    className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold text-slate-700"
                  >
                    <span className="flex-1">{t('mission.ended_title').replace('{n}', String(ended.length))}</span>
                    <ChevronDown size={18} aria-hidden className={`shrink-0 text-slate-500 transition motion-reduce:transition-none ${endedOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <div id="missions-ended" hidden={!endedOpen}>
                    <ul className="space-y-3 text-sm">{ended.map(renderMission)}</ul>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
