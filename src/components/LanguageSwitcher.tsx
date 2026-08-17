import { useI18n } from '../i18n/useI18n';
import { LANGUAGES } from '../i18n/messages';

export function LanguageSwitcher() {
  const { lang, pendingLang, setLang } = useI18n();
  return (
    <select
      aria-label="language"
      aria-busy={pendingLang !== null}
      value={pendingLang ?? lang}
      onChange={(e) => setLang(e.target.value as (typeof LANGUAGES)[number])}
      disabled={pendingLang !== null}
      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
    >
      {LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
