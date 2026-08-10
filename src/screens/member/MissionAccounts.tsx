import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { UserPlus } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/messages';
import { useBaseRepository, useMissionRepository } from '../../data/RepositoryProvider';
import { daysUntil, maxExpiryDate, missionStatus, type MissionAccount } from '../../data/mission';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { Checkbox } from '../../components/Checkbox';
import { SkeletonList } from '../../components/Skeleton';

// Ecran « Comptes de mission » (docs/spec-comptes-mission.md §8, cote medecin).
// Toutes les regles sont appliquees par le serveur : cet ecran ne fait que proposer les
// bons choix par defaut — echeance bornee, noms des patients FERMES tant qu'on ne les
// ouvre pas explicitement avec un motif.

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
/** Une date de formulaire (JJ/MM/AAAA) devient une echeance en fin de journee. */
const endOfDay = (value: string): string => new Date(`${value}T23:59:59`).toISOString();
const showDate = (iso: string): string => new Date(iso).toLocaleDateString();

const STATUS_TONE: Record<string, string> = {
  active: 'bg-teal-100 text-teal-800',
  pending: 'bg-amber-100 text-amber-800',
  expired: 'bg-slate-100 text-slate-600',
  revoked: 'bg-red-100 text-red-700',
};

export function MissionAccounts() {
  const { id: baseId } = useParams();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const missions = useMissionRepository();

  const [canManage, setCanManage] = useState(false);
  const [items, setItems] = useState<MissionAccount[]>([]);
  const [email, setEmail] = useState('');
  const [until, setUntil] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return isoDate(d);
  });
  const [canViewIdentity, setCanViewIdentity] = useState(false);
  const [reason, setReason] = useState('');
  const [extendFor, setExtendFor] = useState<string | null>(null);
  const [extendTo, setExtendTo] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const msg = (e: unknown) => errorMessage(e, t('common.error'));
  const maxDate = isoDate(maxExpiryDate());
  const minDate = isoDate(new Date(Date.now() + 86_400_000));

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const base = await bases.getBase(baseId);
      const manage = base?.role === 'owner' || base?.permissions.canManageAccess === true;
      setCanManage(manage);
      if (manage) setItems(await missions.list(baseId));
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases, missions]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, successKey?: MessageKey) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (successKey) setNotice(t(successKey));
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !email.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const { mailSent } = await missions.create({
        baseId,
        email: email.trim(),
        expiresAt: endOfDay(until),
        canViewIdentity,
        identityJustification: canViewIdentity ? reason.trim() : null,
      });
      setNotice(t(mailSent ? 'mission.created' : 'mission.created_no_mail'));
      setEmail('');
      setCanViewIdentity(false);
      setReason('');
      await load();
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={5} label={t('common.loading')} />;

  return (
    <section className="max-w-4xl space-y-5 sm:space-y-6">
      <PageHeader title={t('mission.title')} description={t('mission.subtitle')} />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-teal-700">{notice}</p>}

      {!canManage ? (
        <p className="text-slate-500">{t('mission.owner_only')}</p>
      ) : (
        <>
          <SectionCard title={t('mission.create')} description={t('mission.max_hint')} icon={UserPlus}>
            <form onSubmit={create} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="form-label">
                  {t('mission.email')}
                  <input
                    type="email"
                    required
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
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
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </label>
              </div>

              {/* Case DECOCHEE au depart : le cloisonnement est la regle, l'ouverture l'exception. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                <Checkbox
                  checked={canViewIdentity}
                  onChange={(e) => setCanViewIdentity(e.target.checked)}
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
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                )}
              </div>

              <button type="submit" disabled={busy} className="btn-primary">
                {t('mission.send')}
              </button>
            </form>
          </SectionCard>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('mission.list_title')}</h2>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">{t('mission.none')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {items.map((m) => {
                  const status = missionStatus(m);
                  const left = daysUntil(m.expiresAt);
                  const live = status === 'active' || status === 'pending';
                  return (
                    <li key={m.accessId} className="card space-y-2 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="font-medium">{m.fullName || m.email}</span>
                          {m.fullName && <span className="text-slate-500"> · {m.email}</span>}
                        </span>
                        <span className={`badge ${STATUS_TONE[status]}`}>
                          {t(`mission.status.${status}` as MessageKey)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          {t('mission.until')} {showDate(m.expiresAt)}
                          {live && left >= 0 && ` — ${t('mission.days_left').replace('{n}', String(left))}`}
                        </span>
                        {m.canViewIdentity && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                            {t('mission.identity_on')}
                          </span>
                        )}
                      </div>
                      {live && (
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setExtendFor(extendFor === m.accessId ? null : m.accessId);
                              setExtendTo(isoDate(new Date(m.expiresAt)));
                            }}
                            className="font-medium text-teal-700 hover:underline"
                          >
                            {t('mission.extend')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => missions.resend(baseId!, m.email), 'mission.resent')}
                            className="font-medium text-slate-600 hover:underline"
                          >
                            {t('mission.resend')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(t('mission.revoke_confirm'))) {
                                void run(() => missions.revoke(m.accessId));
                              }
                            }}
                            className="font-medium text-red-600 hover:underline"
                          >
                            {t('mission.revoke')}
                          </button>
                        </div>
                      )}
                      {extendFor === m.accessId && (
                        <form
                          className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void run(() => missions.extend(m.accessId, endOfDay(extendTo))).then(() =>
                              setExtendFor(null)
                            );
                          }}
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
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
