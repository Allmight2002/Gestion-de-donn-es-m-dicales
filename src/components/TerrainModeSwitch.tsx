import { useId } from 'react';
import { Smartphone } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { useTerrainMode } from '../lib/terrainMode';

// Audit UI mobile, lot 8 : interrupteur du mode « Terrain », preference de CET appareil. Il ne
// masque que des onglets : chaque ecran garde ses controles, et le serveur les siens.
export function TerrainModeSwitch() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useTerrainMode();
  const labelId = useId();
  const hintId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-labelledby={labelId}
      aria-describedby={hintId}
      onClick={() => setEnabled(!enabled)}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      <Smartphone size={16} aria-hidden className="shrink-0 text-slate-500" />
      <span className="min-w-0 flex-1 leading-tight">
        <span id={labelId} className="block text-sm font-medium text-slate-700 dark:text-slate-200">{t('terrain.label')}</span>
        <span id={hintId} className="block text-xs text-slate-500">{t('terrain.hint')}</span>
      </span>
      <span
        aria-hidden
        className={`relative h-6 w-10 shrink-0 rounded-full transition motion-reduce:transition-none ${enabled ? 'bg-teal-700' : 'bg-slate-300 dark:bg-slate-600'}`}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all motion-reduce:transition-none ${enabled ? 'left-5' : 'left-1'}`} />
      </span>
    </button>
  );
}
