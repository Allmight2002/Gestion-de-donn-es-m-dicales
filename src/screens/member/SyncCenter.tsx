import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { usePatientRepository } from '../../data/RepositoryProvider';
import {
  flushOutbox, offlineCache, resolveKeepMine, resolveKeepServer, useOnline, useOutbox,
  type FlushDeps, type FlushReport, type OfflineMeta, type OutboxEntry,
} from '../../data/offline';
import { recentClientErrors } from '../../lib/reportError';

// Centre de synchronisation (§13, Phases 2/3) : modifications hors-ligne en attente +
// resolution des conflits. La synchro rejoue chaque correction via la RPC validee
// (verrou optimiste) ; un conflit = la rencontre a change cote serveur entre-temps.
export function SyncCenter() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const patients = usePatientRepository();
  const entries = useOutbox();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<FlushReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // E3 : etat du systeme (instantanes hors-ligne disponibles + dernieres anomalies techniques).
  const [snapshots, setSnapshots] = useState<OfflineMeta[]>([]);
  const [errors] = useState(() => recentClientErrors());
  useEffect(() => { offlineCache.list().then(setSnapshots).catch(() => setSnapshots([])); }, []);

  const deps: FlushDeps = {
    updateEncounter: (id, data, status, reason, exp) => patients.updateEncounter(id, data, status, reason, exp),
    getEncounter: (id) => patients.getEncounter(id),
  };
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  const sync = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await flushOutbox(deps));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients]);

  const pending = entries.filter((e) => e.state === 'pending');
  const conflicts = entries.filter((e) => e.state === 'conflict');

  return (
    <section className="max-w-3xl space-y-6">
      {/* E3 : etat du systeme en un coup d'oeil. */}
      <div className="space-y-3">
        <h1 className="page-title">{t('status.title')}</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card p-3">
            <p className="text-xs text-slate-500">{t('status.connection')}</p>
            <p className={`text-sm font-medium ${online ? 'text-teal-700' : 'text-amber-700'}`}>
              {online ? t('status.online') : t('status.offline')}
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-slate-500">{t('status.pending_writes')}</p>
            <p className="text-sm font-medium text-slate-700">{pending.length}{conflicts.length > 0 ? ` · ${conflicts.length} ${t('sync.conflicts').toLowerCase()}` : ''}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-slate-500">{t('status.offline_bases')}</p>
            <p className="text-sm font-medium text-slate-700">{snapshots.length}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-slate-500">{t('status.version')}</p>
            <p className="text-sm font-medium text-slate-700">{__APP_VERSION__} · {import.meta.env.MODE}</p>
          </div>
        </div>

        {snapshots.length > 0 && (
          <ul className="space-y-1 text-xs text-slate-500">
            {snapshots.map((s) => (
              <li key={s.baseId} className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="font-medium text-slate-600">{s.baseName}</span>
                <span>{s.patientCount} {t('status.patients')} · {new Date(s.cachedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}

        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{t('status.errors')} ({errors.length})</summary>
          {errors.length === 0 ? (
            <p className="mt-1 text-slate-400">{t('status.no_errors')}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {errors.slice().reverse().map((e, i) => (
                <li key={i} className="border-b border-slate-100 pb-1">
                  <span className="font-mono">{e.name}: {e.message}</span>
                  <span className="ml-2 text-slate-400">{new Date(e.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title">{t('sync.title')}</h2>
        <button onClick={() => void sync()} disabled={busy || !online || pending.length === 0} className="btn-primary">
          {busy ? t('offline.saving') : `${t('sync.now')}${pending.length ? ` (${pending.length})` : ''}`}
        </button>
      </div>
      {!online && <p className="text-sm text-amber-700">{t('sync.offline_hint')}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {report && (
        <p className="text-sm text-slate-600">
          {t('sync.synced')} : {report.synced} · {t('sync.conflicts')} : {report.conflicts} · {t('sync.failed')} : {report.failed}
        </p>
      )}

      {entries.length === 0 && (
        <div className="card border-dashed p-10 text-center text-slate-500">{t('sync.empty')}</div>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-red-700">{t('sync.conflicts')} ({conflicts.length})</h2>
          {conflicts.map((e) => (
            <ConflictCard key={e.id} entry={e} deps={deps} onError={setError} />
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">{t('sync.pending')} ({pending.length})</h2>
          {pending.map((e) => (
            <div key={e.id} className="card p-4 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-slate-700">{t('sync.encounter_edit')}</span>
                <button
                  onClick={() => navigate(`/bases/${e.baseId}/patients/${e.patientId}`)}
                  className="text-xs text-teal-700 hover:underline"
                >
                  {t('sync.view_patient')}
                </button>
              </div>
              <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">{JSON.stringify(e.data, null, 2)}</pre>
              {e.reason && <p className="mt-1 text-xs italic text-slate-400">« {e.reason} »</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConflictCard({ entry, deps, onError }: { entry: OutboxEntry; deps: FlushDeps; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onError(''); }
    catch (e) { onError(errorMessage(e, t('common.error'))); }
    finally { setBusy(false); }
  };

  return (
    <div className="card border-red-200 p-4 text-sm">
      <p className="mb-2 text-xs text-red-700">{t('sync.conflict_explain')}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-500">{t('sync.mine')}</div>
          <pre className="overflow-x-auto rounded bg-teal-50 p-2 text-xs text-slate-700">{JSON.stringify(entry.data, null, 2)}</pre>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-500">{t('sync.server')}</div>
          <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">{entry.serverData ? JSON.stringify(entry.serverData, null, 2) : '—'}</pre>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button disabled={busy} onClick={() => void run(() => resolveKeepMine(entry.id, deps))} className="btn-secondary">
          {t('sync.keep_mine')}
        </button>
        <button disabled={busy} onClick={() => void run(() => resolveKeepServer(entry.id))} className="btn-secondary">
          {t('sync.keep_server')}
        </button>
      </div>
    </div>
  );
}
