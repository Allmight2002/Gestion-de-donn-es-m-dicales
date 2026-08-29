import { useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import type { MessageKey } from '../i18n/messages';
import { getTheme, setTheme, type ThemeMode } from '../lib/theme';

// UI-1 — Selecteur de theme (segmente 3 positions) : clair / sombre / systeme.
const MODES: { mode: ThemeMode; Icon: typeof Sun }[] = [
  { mode: 'light', Icon: Sun },
  { mode: 'dark', Icon: Moon },
  { mode: 'system', Icon: Monitor },
];

export function ThemeToggle() {
  const { t } = useI18n();
  const [mode, setMode] = useState<ThemeMode>(getTheme);

  function choose(m: ThemeMode) {
    setTheme(m);
    setMode(m);
  }

  return (
    <div role="group" aria-label={t('theme.label')} className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
      {MODES.map(({ mode: m, Icon }) => (
        <button
          key={m}
          type="button"
          aria-label={t(`theme.${m}` as MessageKey)}
          aria-pressed={mode === m}
          title={t(`theme.${m}` as MessageKey)}
          onClick={() => choose(m)}
          className={`rounded-md p-1.5 transition ${mode === m ? 'bg-teal-700 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
        >
          <Icon size={14} aria-hidden />
        </button>
      ))}
    </div>
  );
}
