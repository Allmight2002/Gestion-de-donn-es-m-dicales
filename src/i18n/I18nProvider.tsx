import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LANGUAGES, messages, type Language, type MessageKey } from './messages';

export interface I18nContextValue {
  lang: Language;
  setLang(lang: Language): void;
  t(key: MessageKey): string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'registre.lang';

function initialLang(): Language {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  }
  return 'fr';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLang);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Language) => setLangState(next), []);
  const t = useCallback((key: MessageKey) => messages[lang][key] ?? key, [lang]);

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
