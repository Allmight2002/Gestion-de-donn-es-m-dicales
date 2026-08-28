// UI-2 — dates LISIBLES partout (fini l'ISO brut « 2026-06-28T10:32:11Z » a l'ecran).
// Locale alignee sur la langue de l'app ; valeur illisible -> renvoyee telle quelle (jamais bloquant).
import type { Language } from '../i18n/messages';

const LOCALE: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB' };

/** « 28 juin 2026 » — pour une DATE (rencontre, naissance...). */
export function formatDate(value: string | number | Date, lang: Language): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** « 28 juin 2026, 10:32 » — pour un HORODATAGE (export, journal, cache...). */
export function formatDateTime(value: string | number | Date, lang: Language): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
