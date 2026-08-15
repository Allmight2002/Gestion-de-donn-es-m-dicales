// L30 — options de liste a code interne stable.
//
// POURQUOI. Une option de `select` / `multiselect` etait stockee EN TEXTE : la chaine
// elle-meme partait dans la donnee. Corriger une option -- « hematome » en « hématome » --
// rendait les fiches deja saisies invalides et scindait une modalite en deux. Le code
// (`valueKey`) part desormais en base ; le libelle reste modifiable.
//
// Contenu PUR (aucune I/O), comme `valueSetLibrary` : la base reste la source de verite,
// ce module ne fait que lire, rendre et proposer.

/** Une option telle qu'elle vit en base : `allowed_options`. */
export interface FieldOption {
  /** Ce qui part dans la donnee. Ne change JAMAIS une fois l'option creee. */
  valueKey: string;
  /** Ce qui s'affiche. Modifiable sans toucher aux fiches deja saisies. */
  label: string;
  /** Une option retiree du formulaire est desactivee, jamais supprimee. */
  isActive: boolean;
}

/**
 * Deux ecritures pour la meme option : `value_key` / `is_active` cote base (PostgREST,
 * instantane hors-ligne) et `valueKey` / `isActive` cote DTO du front. Les deux sont
 * acceptees ici, une fois pour toutes : c'est le seul endroit du code ou la distinction a
 * un sens, et une conversion oubliee ailleurs viderait une liste en silence.
 */
interface RawOption {
  value_key?: unknown;
  valueKey?: unknown;
  label?: unknown;
  is_active?: unknown;
  isActive?: unknown;
}

interface OptionCarrier {
  allowedOptions?: unknown;
  allowedValues?: unknown;
}

function fromRaw(raw: unknown): FieldOption | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as RawOption;
  const key = typeof o.value_key === 'string' ? o.value_key : o.valueKey;
  const valueKey = typeof key === 'string' && key !== '' ? key : null;
  if (!valueKey) return null;
  const active = o.is_active ?? o.isActive;
  return {
    valueKey,
    label: typeof o.label === 'string' && o.label !== '' ? o.label : valueKey,
    isActive: active !== false,
  };
}

/**
 * Options d'une variable, quelle que soit la forme dont on dispose.
 *
 * Repli sur `allowedValues` : un instantane hors-ligne telecharge AVANT ce lot, ou une
 * copie de l'application non rafraichie, ne connait que la liste des cles. Les traiter
 * comme des options verbatim (cle = libelle) rend exactement le comportement anterieur,
 * qui reste le bon pour ces listes.
 */
export function fieldOptions(field: OptionCarrier | null | undefined): FieldOption[] {
  if (!field) return [];
  if (Array.isArray(field.allowedOptions)) {
    return field.allowedOptions.map(fromRaw).filter((o): o is FieldOption => o !== null);
  }
  if (Array.isArray(field.allowedValues)) {
    return field.allowedValues
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .map((v) => ({ valueKey: v, label: v, isActive: true }));
  }
  return [];
}

/**
 * Options PROPOSABLES a la saisie, plus celles que la fiche porte deja.
 *
 * Une option desactivee sort du formulaire, mais une fiche qui en porte une doit rester
 * lisible et modifiable sur ses autres champs : la retirer du menu deroulant reviendrait
 * a effacer sa valeur au premier enregistrement. Elle est donc conservee, et c'est
 * l'appelant qui la signale a l'ecran.
 */
export function selectableOptions(
  field: OptionCarrier | null | undefined,
  current: unknown,
): FieldOption[] {
  const held = new Set(
    (Array.isArray(current) ? current : [current])
      .filter((v): v is string => typeof v === 'string' && v !== ''),
  );
  return fieldOptions(field).filter((o) => o.isActive || held.has(o.valueKey));
}

/** Libelle d'une valeur stockee. Une valeur inconnue est rendue TELLE QUELLE, jamais masquee. */
export function optionLabel(field: OptionCarrier | null | undefined, value: unknown): string {
  if (typeof value !== 'string') return '';
  return fieldOptions(field).find((o) => o.valueKey === value)?.label ?? value;
}

/** Vrai si la valeur stockee ne correspond a aucune option connue (sequelle d'un renommage). */
export function isOrphanValue(field: OptionCarrier | null | undefined, value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  const options = fieldOptions(field);
  return options.length > 0 && !options.some((o) => o.valueKey === value);
}

/**
 * Rendu lisible d'une valeur de liste, y compris multiple.
 *
 * Sans ce passage par les options, un ecran de lecture afficherait le CODE la ou le
 * medecin attend le libelle -- et continuerait d'afficher l'ancien texte apres une
 * correction, c'est-a-dire exactement la confusion que le lot supprime.
 */
export function displayOptionValue(field: OptionCarrier | null | undefined, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => optionLabel(field, v)).filter(Boolean).join(', ');
  }
  return optionLabel(field, value);
}

const ACCENTS = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ';
const PLAIN = 'aaaaaaceeeeiiiinooooouuuuyyoa';

/**
 * Code propose pour une option NOUVELLE, derive de son libelle.
 *
 * Le code n'est jamais montre au saisisseur ; il est montre au medecin qui construit son
 * formulaire, parce que c'est lui qui apparaitra dans la colonne de code de l'export.
 * Le derive du libelle plutot que de tirer un identifiant opaque garde ce fichier lisible.
 *
 * Une fois cree, un code ne bouge plus : renommer le libelle ne le recalcule pas.
 */
export function makeValueKey(label: string, taken: readonly string[]): string {
  const base = label
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .split('')
    .map((c) => {
      const i = ACCENTS.indexOf(c);
      return i >= 0 ? PLAIN[i] : c;
    })
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  // Un libelle entierement non latin (arabe, cyrillique...) ne laisse rien : on retombe
  // sur un code neutre plutot que sur une chaine vide, qui serait refusee par la base.
  const seed = base || 'option';
  if (!taken.includes(seed)) return seed;
  for (let n = 2; ; n += 1) {
    const candidate = `${seed}_${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Forme attendue par la base (`allowed_options`). */
export function toRawOptions(options: readonly FieldOption[]): { value_key: string; label: string; is_active: boolean }[] {
  return options.map((o) => ({ value_key: o.valueKey, label: o.label, is_active: o.isActive }));
}

/** Miroir des cles, dans l'ordre : ce que la base tient dans `allowed_values`. */
export function optionKeys(options: readonly FieldOption[]): string[] {
  return options.map((o) => o.valueKey);
}
