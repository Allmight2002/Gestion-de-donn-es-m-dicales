import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useFormPreparationRepository } from '../../data/RepositoryProvider';
import type { DeletedBase } from '../../data/bases';
import type { PurgeChallengeReceipt } from '../../data/formPreparations';
import { FormPreparationError } from '../../data/formPreparations';
import { useOnline } from '../../data/offline';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConfirmationCode } from '../../components/ConfirmationCode';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';

// Corbeille des bases (demenagee du tableau de bord vers la barre laterale) : la
// restauration remet la base en ligne sans remettre les acces partages. D10 ajoute
// une purge definitive confirmee par le serveur et rejouable apres un incident Storage.
function newOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const suffix = Math.floor(Math.random() * 0x1_0000_0000_0000).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

export function Trash() {
  const repo = useBaseRepository();
  const formPreparations = useFormPreparationRepository();
  const { t } = useI18n();
  const online = useOnline();
  const [deleted, setDeleted] = useState<DeletedBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DeletedBase | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<DeletedBase | null>(null);
  const [purgeCode, setPurgeCode] = useState('');
  const [purgeChallenge, setPurgeChallenge] = useState<(PurgeChallengeReceipt & { code?: string }) | null>(null);
  const [purgeIssueOperationId, setPurgeIssueOperationId] = useState<string | null>(null);
  const [purgeConfirmOperationId, setPurgeConfirmOperationId] = useState<string | null>(null);
  const [purgeOperationId, setPurgeOperationId] = useState<string | null>(null);
  const [purgeChallengeLoading, setPurgeChallengeLoading] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const purgeInFlight = useRef(false);
  // Un challenge consomme ne peut pas etre reconfirme : le rejeu d'une purge interrompue
  // repart directement sur la meme cle d'operation Edge, sans redemander le code.
  const purgeConfirmed = useRef(false);
  const purgeDialogBaseId = useRef<string | null>(null);

  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const reload = useCallback(async () => {
    if (!online) {
      setDeleted([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setDeleted(await repo.listDeletedBases());
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, online, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function restoreBase() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      await repo.restoreDeletedBase(restoreTarget.id);
      setRestoreTarget(null);
      await reload();
    } catch (e) {
      setError(msg(e));
    } finally {
      setRestoring(false);
    }
  }

  async function issuePurgeChallenge(base: DeletedBase, operationId: string) {
    if (!formPreparations.available) {
      setPurgeError(t('base.purge_challenge_unavailable'));
      setPurgeChallengeLoading(false);
      return;
    }
    setPurgeChallengeLoading(true);
    setPurgeError(null);
    try {
      const challenge = await formPreparations.issuePurgeChallenge(base.id, operationId);
      if (!challenge.challengeId || !challenge.code || challenge.baseId !== base.id) {
        if (purgeDialogBaseId.current === base.id) setPurgeError(t('base.purge_challenge_unavailable'));
        return;
      }
      if (purgeDialogBaseId.current !== base.id) return;
      // Le code est affiché pour une recopie volontaire ; il n'est ni journalisé, ni conservé,
      // ni tenu pour une autorisation. Le serveur reste seul juge de la confirmation.
      setPurgeChallenge(challenge);
    } catch (cause) {
      if (purgeDialogBaseId.current !== base.id) return;
      setPurgeError(cause instanceof FormPreparationError && cause.code === 'FORM_PREPARATION_UNAVAILABLE'
        ? t('base.purge_challenge_unavailable') : msg(cause));
    } finally {
      if (purgeDialogBaseId.current === base.id) setPurgeChallengeLoading(false);
    }
  }

  function openPurge(base: DeletedBase) {
    purgeDialogBaseId.current = base.id;
    setPurgeTarget(base);
    setPurgeCode('');
    setPurgeChallenge(null);
    const issueOperationId = newOperationId();
    setPurgeIssueOperationId(issueOperationId);
    setPurgeConfirmOperationId(newOperationId());
    setPurgeOperationId(base.purgeOperationId ?? newOperationId());
    purgeConfirmed.current = false;
    setPurgeChallengeLoading(true);
    setError(null);
    setPurgeError(null);
    setSuccess(null);
    void issuePurgeChallenge(base, issueOperationId);
  }

  function closePurge() {
    if (purging) return;
    purgeDialogBaseId.current = null;
    setPurgeTarget(null);
    setPurgeCode('');
    setPurgeChallenge(null);
    setPurgeIssueOperationId(null);
    setPurgeConfirmOperationId(null);
    setPurgeOperationId(null);
    purgeConfirmed.current = false;
    setPurgeChallengeLoading(false);
    setPurgeError(null);
  }

  async function purgeBase() {
    const normalizedCode = purgeCode.trim().toUpperCase();
    if (!purgeTarget || !purgeChallenge || !purgeConfirmOperationId || !purgeOperationId || !purgeChallenge.code
      || normalizedCode.length !== 5 || purgeChallengeLoading || purgeInFlight.current) return;
    purgeInFlight.current = true;
    const purgedName = purgeTarget.name;
    setPurging(true);
    setPurgeError(null);
    setSuccess(null);
    try {
      if (!purgeConfirmed.current) {
        await formPreparations.confirmPurgeChallenge(
          purgeTarget.id,
          purgeChallenge.challengeId,
          normalizedCode,
          purgeConfirmOperationId,
        );
        // Le serveur a consomme le challenge. La suppression definitive elle-meme reste une
        // operation distincte, portee par l'Edge D10 et rejouable avec la meme cle.
        purgeConfirmed.current = true;
      }
      await repo.purgeDeletedBase(purgeTarget.id, purgeOperationId);
      setPurging(false);
      closePurge();
      await reload();
      setSuccess(t('base.purge_success').replace('{name}', purgedName));
    } catch (e) {
      const code = e instanceof FormPreparationError ? e.code : '';
      setPurgeError(code === 'PURGE_CHALLENGE_MISMATCH' ? t('base.purge_code_mismatch') : msg(e));
      // Un code errone est une NOUVELLE tentative de confirmation ; une reponse perdue doit au
      // contraire rejouer la meme cle d'operation pour rester idempotente cote serveur.
      if (code === 'PURGE_CHALLENGE_MISMATCH') setPurgeConfirmOperationId(newOperationId());
    } finally {
      purgeInFlight.current = false;
      setPurging(false);
    }
  }

  return (
    <section className="space-y-5">
      <ConfirmDialog
        open={restoreTarget !== null}
        title={t('base.restore_title')}
        body={t('base.restore_body')}
        confirmLabel={t('base.restore_confirm')}
        busy={restoring}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void restoreBase()}
      />
      <ConfirmDialog
        open={purgeTarget !== null}
        title={t('base.purge_title')}
        body={purgeTarget ? (
          <div className="text-sm text-slate-700">
            <p className="font-medium">{t('base.purge_irreversible')}</p>
            {purgeTarget.patientCount > 0 && (
              <p className="mt-2">{purgeTarget.patientCount === 1
                ? t('base.patients_warning_one')
                : t('base.patients_warning_other').replace('{count}', String(purgeTarget.patientCount))}</p>
            )}
            {purgeChallengeLoading && <p role="status" className="mt-3 text-xs text-slate-500">{t('base.purge_challenge_loading')}</p>}
            <div className="mt-3">
              <ConfirmationCode
                id="purge-confirmation-code"
                code={purgeChallenge?.code ?? null}
                value={purgeCode}
                disabled={purging || purgeChallengeLoading}
                onChange={(value) => { setPurgeCode(value); setPurgeError(null); }}
              />
            </div>
            {purgeError && <p role="alert" className="mt-1 text-xs text-red-600">{purgeError}</p>}
            {!purgeChallengeLoading && !purgeChallenge && purgeIssueOperationId && <button
              type="button"
              className="text-xs font-medium text-teal-700 underline underline-offset-2"
              onClick={() => purgeTarget && void issuePurgeChallenge(purgeTarget, purgeIssueOperationId)}
            >{t('base.purge_code_retry')}</button>}
          </div>
        ) : undefined}
        confirmLabel={t('base.purge_confirm')}
        confirmDisabled={!purgeTarget || !purgeChallenge?.code || purgeCode.trim().length !== 5 || purgeChallengeLoading}
        danger
        busy={purging}
        onCancel={closePurge}
        onConfirm={() => void purgeBase()}
      />
      <PageHeader title={t('base.trash_title')} description={t('base.trash_hint')} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
      {!online ? (
        <p className="text-sm text-slate-500">{t('base.trash_offline')}</p>
      ) : loading ? (
        <SkeletonList rows={3} label={t('common.loading')} />
      ) : deleted.length === 0 ? (
        <EmptyState icon={Trash2} title={t('base.trash_empty')} />
      ) : (
        <ul className="space-y-3">
          {deleted.map((base) => (
            <li key={base.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">{base.name}</h3>
                {base.deletionReason && <p className="mt-1 text-sm text-slate-500">{base.deletionReason}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  {t('base.deleted_on').replace('{date}', new Date(base.deletedAt).toLocaleDateString())}
                  {' · '}
                  {t('base.purge_immediate')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRestoreTarget(base)}
                  disabled={base.purgePending || purging}
                >
                  {t('base.restore')}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => openPurge(base)}
                  disabled={purging || !formPreparations.available}
                  title={formPreparations.available ? undefined : t('base.purge_challenge_unavailable')}
                >
                  {base.purgePending ? t('base.purge_retry') : t('base.purge')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
