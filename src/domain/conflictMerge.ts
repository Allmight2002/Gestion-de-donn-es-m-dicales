// L25 — Resolution « garder les deux » d'un conflit de synchronisation hors-ligne.
//
// Deux appareils hors ligne ajoutent chacun un diagnostic a la meme rencontre. Le premier
// synchronise ; le second voit son jeton `baseUpdatedAt` perime et le conflit remonte. La
// resolution etait binaire : « garder ma version » ECRASE le diagnostic ajoute par l'autre.
//
// L'union n'est possible QUE parce que chaque valeur porte un identifiant stable : son CODE.
// Sur un champ a valeur unique, deux versions differentes ne se fusionnent pas — il faut choisir.
//
// Fonction de DOMAINE PURE : aucune base, aucun navigateur, aucun reseau. La couche hors-ligne
// l'appelle, l'ecran ne la reimplemente pas. Sa purete n'est pas un gout d'architecture : la
// charge rejouee doit etre DETERMINISTE pour rester idempotente (cf. `resolveKeepBoth`).
import { isTerminologyList } from '../data/types';

export interface KeepBothMerge {
  /** Charge COMPLETE a rejouer : ma version, listes de diagnostics unies. */
  data: Record<string, unknown>;
  /**
   * Cles dont la liste a effectivement recupere des valeurs venues du serveur.
   *
   * VIDE = la fusion est identique a « garder ma version » : il n'y a rien a sauver, et l'ecran
   * ne doit alors PAS proposer l'issue. Un conflit qui ne porte que sur des champs a valeur
   * unique n'a rien a fusionner ; proposer une fusion impossible serait pire que ne rien
   * proposer, parce que le bouton promettrait un sauvetage qui n'a pas lieu. La visibilite est
   * donc DERIVEE de la fusion elle-meme : le bouton et l'action ne peuvent pas diverger.
   */
  mergedKeys: string[];
  /** Nombre de valeurs que « garder ma version » aurait detruites. */
  recovered: number;
}

/**
 * Union des deux versions d'une rencontre en conflit.
 *
 * Regles, dans cet ordre :
 *
 * 1. **Toutes les cles viennent de MA version.** « Garder les deux » est une variante de
 *    « garder ma version » qui n'ecrase pas les ajouts de l'autre — pas un troisieme arbitrage
 *    qui rendrait les champs a valeur unique au serveur sans le dire.
 * 2. **Seules les cles portant une liste de terminologie DES DEUX COTES sont unies** : ordre
 *    local d'abord, puis les nouveautes serveur, jamais de doublon de code. Une liste d'un cote
 *    et un code de donnee manquante (ou rien) de l'autre sont deux representations
 *    CONTRADICTOIRES : il n'y a rien a unir, ma version reste.
 * 3. **Le libelle d'un code present des deux cotes reste le mien.** Le code est l'identite ; le
 *    libelle n'est que l'instantane pris a la saisie.
 * 4. **Une cle presente seulement cote serveur n'est pas reprise.** Sans la valeur de base, on ne
 *    peut pas distinguer un ajout de l'autre appareil d'une suppression que j'ai faite hors-ligne.
 *    C'est deja le comportement de « garder ma version » ; ce lot n'elargit pas la question.
 *
 * Limite assumee : sans valeur de base, l'union ressuscite une valeur que l'autre appareil aurait
 * volontairement retiree. C'est le sens meme du bouton — on ne perd rien — et c'est pourquoi il
 * reste un choix explicite de l'utilisateur, jamais une resolution automatique.
 */
export function mergeKeepBoth(
  mine: Record<string, unknown>,
  server: Record<string, unknown> | null | undefined,
): KeepBothMerge {
  const data: Record<string, unknown> = { ...mine };
  const mergedKeys: string[] = [];
  let recovered = 0;
  if (!server) return { data, mergedKeys, recovered };

  for (const [key, mineValue] of Object.entries(mine)) {
    if (!isTerminologyList(mineValue)) continue;
    const serverValue = server[key];
    if (!isTerminologyList(serverValue)) continue;

    const union = [...mineValue];
    const codes = new Set(mineValue.map((v) => v.code));
    for (const value of serverValue) {
      if (codes.has(value.code)) continue; // deja porte : le libelle local fait foi
      codes.add(value.code);               // defense : une liste serveur ne peut pas doubler un code
      union.push(value);
    }
    // On ne REECRIT la cle que si l'union apporte quelque chose : sinon la charge reste
    // exactement celle de « garder ma version », octet pour octet.
    if (union.length === mineValue.length) continue;
    recovered += union.length - mineValue.length;
    data[key] = union;
    mergedKeys.push(key);
  }
  return { data, mergedKeys, recovered };
}
