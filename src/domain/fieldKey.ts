// Cle technique d'une variable : forme attendue par la base pour toute cle NOUVELLE ou
// RENOMMEE (migration 20261011150000). Une cle existante hors de ce format reste valide.
import { asciiSlug } from './fieldOptions';

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Ramene une saisie libre au format de cle : `IMC` -> `imc`, `Date d'entrée` ->
 * `date_dentree`, `2e bilan` -> `v_2e_bilan`. Rend une chaine vide si rien ne subsiste
 * (saisie entierement non latine ou ponctuation seule).
 */
export function normalizeFieldKey(raw: string): string {
  const slug = asciiSlug(raw);
  const prefixed = /^[0-9]/.test(slug) ? `v_${slug}` : slug;
  return prefixed.slice(0, 63).replace(/_+$/, '');
}
