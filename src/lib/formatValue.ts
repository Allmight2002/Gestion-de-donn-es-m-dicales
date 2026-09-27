// Audit UI mobile, lot 0 — valeurs cliniques affichees lisiblement. PUR AFFICHAGE : la valeur
// stockee, l'export et le calcul des formules restent inchanges. Une valeur qui n'a pas la forme
// attendue est rendue telle quelle : on ne perd jamais une information pour la mettre en forme.
import type { Language } from '../i18n/messages';

const LOCALE: Record<Language, string> = { fr: 'fr-FR', en: 'en-GB' };
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * « 2026-02-18 » -> « 18/02/2026 ». La date est lue comme date CIVILE : `new Date('2026-02-18')`
 * la lirait en UTC et l'afficherait la veille dans un fuseau a l'ouest de Greenwich.
 */
export function formatStoredDate(value: string, lang: Language): string {
  const match = DATE_ONLY.exec(value);
  if (!match) return value;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return value;
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short' }).format(date);
}

/**
 * « 2026-08-21T14:00 » -> « 21/08/2026 14:00 ». La saisie `datetime-local` ne porte pas de fuseau :
 * l'heure affichee est l'heure saisie. Une valeur avec fuseau (« Z », « +01:00 ») reste brute
 * plutot que d'etre convertie.
 */
export function formatStoredDateTime(value: string, lang: Language): string {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return value;
  const [year, month, day, hours, minutes] = [
    Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]),
  ];
  const date = new Date(year, month, day, hours, minutes);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day
    || date.getHours() !== hours || date.getMinutes() !== minutes) return value;
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/**
 * Resultat de formule : « 0.286111 » -> « 0,29 ». Au plus 2 decimales, ou 2 chiffres significatifs
 * sous 1 pour ne jamais afficher 0 a la place d'une petite valeur. L'export garde la precision.
 */
export function formatCalculatedNumber(value: number, lang: Language): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  const options: Intl.NumberFormatOptions = magnitude > 0 && magnitude < 1
    ? { maximumSignificantDigits: 2 }
    : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat(LOCALE[lang], options).format(value);
}
