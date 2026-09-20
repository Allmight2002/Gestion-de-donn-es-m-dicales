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
  // Lecture faite PENDANT le rendu (initialiseur de useState) : un stockage refuse
  // (navigation privee, politique) ne doit pas faire echouer le montage de l'application.
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
    }
  } catch { /* stockage indisponible : langue par defaut */ }
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
  // Appelee depuis un effet a CHAQUE montage : un stockage refuse (navigation privee,
  // quota) ferait echouer toute l'application, pas seulement la preference de langue.
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, language);
  } catch { /* stockage indisponible : la langue vaut pour la session courante */ }
}
