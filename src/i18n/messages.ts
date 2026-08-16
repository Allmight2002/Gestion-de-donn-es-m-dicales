import type { MessageDictionary } from './messages.fr';

export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export type { MessageDictionary, MessageKey } from './messages.fr';

const STORAGE_KEY = 'registre.lang';

const loaders = {
  fr: async () => (await import('./messages.fr')).messages,
  en: async () => (await import('./messages.en')).messages,
} satisfies Record<Language, () => Promise<MessageDictionary>>;

const loaded = new Map<Language, MessageDictionary>();
const pending = new Map<Language, Promise<MessageDictionary>>();

export function initialLanguage(): Language {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  }
  return 'fr';
}

export function getLoadedMessages(language: Language): MessageDictionary | null {
  return loaded.get(language) ?? null;
}

export function loadMessages(language: Language): Promise<MessageDictionary> {
  const cached = loaded.get(language);
  if (cached) return Promise.resolve(cached);

  const current = pending.get(language);
  if (current) return current;

  const request = loaders[language]().then((dictionary) => {
    loaded.set(language, dictionary);
    pending.delete(language);
    return dictionary;
  }, (error: unknown) => {
    pending.delete(language);
    throw error;
  });
  pending.set(language, request);
  return request;
}

export function storeLanguage(language: Language): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, language);
}
