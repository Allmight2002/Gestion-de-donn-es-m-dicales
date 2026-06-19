import { useI18n } from '../i18n/useI18n';
import { LANGUAGES } from '../i18n/messages';

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <select
      aria-label="language"
      value={lang}
      onChange={(e) => setLang(e.target.value as (typeof LANGUAGES)[number])}
      className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
    >
      {LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
