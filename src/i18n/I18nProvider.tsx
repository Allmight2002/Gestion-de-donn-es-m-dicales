import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getLoadedMessages,
  initialLanguage,
  loadMessages,
  storeLanguage,
  type Language,
  type MessageDictionary,
  type MessageKey,
} from './messages';

export interface I18nContextValue {
  lang: Language;
  pendingLang: Language | null;
  setLang(lang: Language): void;
  t(key: MessageKey): string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLanguage);
  const [dictionary, setDictionary] = useState<MessageDictionary | null>(() => getLoadedMessages(lang));
  const [pendingLang, setPendingLang] = useState<Language | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (dictionary) return;
    let active = true;
    void loadMessages(lang).then((loaded) => {
      if (active) setDictionary(loaded);
    });
    return () => { active = false; };
  }, [dictionary, lang]);

  useEffect(() => {
    storeLanguage(lang);
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Language) => {
    if (next === lang || next === pendingLang) return;
    const currentRequest = ++requestId.current;
    setPendingLang(next);
    void loadMessages(next).then((loaded) => {
      if (requestId.current !== currentRequest) return;
      setDictionary(loaded);
      setLangState(next);
      setPendingLang(null);
    }, () => {
      if (requestId.current === currentRequest) setPendingLang(null);
    });
  }, [lang, pendingLang]);

  const t = useCallback((key: MessageKey) => dictionary?.[key] ?? key, [dictionary]);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, pendingLang, setLang, t }),
    [lang, pendingLang, setLang, t],
  );

  if (!dictionary) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm font-medium text-slate-600" role="status">
        {lang === 'fr' ? 'Chargement…' : 'Loading…'}
      </div>
    );
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
