import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { checkAppShellReady, type AppShellReadiness, type AppShellRequirement } from '../pwa/appShell';
import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';

const REASON_KEYS: Record<AppShellRequirement, MessageKey> = {
  unsupported: 'offline.shell_unsupported',
  not_registered: 'offline.shell_not_registered',
  not_activated: 'offline.shell_not_activated',
  shell_not_cached: 'offline.shell_not_cached',
};

/**
 * « Disponible hors-ligne » ne portait que sur l'instantane enregistre en IndexedDB. Or sans
 * coquille applicative precachee, le navigateur n'atteint jamais le code qui saurait le lire :
 * l'ecran annoncait donc une disponibilite que le demarrage a froid ne tenait pas. Ce controle
 * verifie l'autre moitie du contrat, et l'ecran ne promet plus que ce qu'il peut prouver.
 */
export function useAppShellReadiness(active: boolean) {
  const [readiness, setReadiness] = useState<AppShellReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const next = await checkAppShellReady();
      if (mounted.current) setReadiness(next);
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!active) { setReadiness(null); return; }
    void check();
  }, [active, check]);

  return { readiness, checking, check };
}

/** N'affiche rien tant que la coquille tient sa promesse : seul le manque merite un message. */
export function OfflineReadinessNotice({ readiness, checking, onRecheck }: {
  readiness: AppShellReadiness | null;
  checking: boolean;
  onRecheck: () => void;
}) {
  const { t } = useI18n();
  if (!readiness || readiness.ready) return null;
  return (
    <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle size={16} aria-hidden /> {t('offline.shell_incomplete')}
      </p>
      <ul className="mt-1 list-disc pl-6">
        {readiness.missing.map((reason) => <li key={reason}>{t(REASON_KEYS[reason])}</li>)}
      </ul>
      <p className="mt-1 text-xs">{t('offline.shell_hint')}</p>
      <button type="button" className="btn-secondary mt-2" disabled={checking} onClick={onRecheck}>
        {checking ? t('offline.shell_checking') : t('offline.shell_recheck')}
      </button>
    </div>
  );
}
