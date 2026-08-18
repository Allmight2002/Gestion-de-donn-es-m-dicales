// L25 : l'issue « garder les deux » d'un conflit hors-ligne. Fonction de domaine PURE — ces tests
// ne demarrent ni base, ni navigateur, ni IndexedDB : ils decrivent une decision, pas une
// mecanique. Le scenario de reference est celui de la specification §10 : deux appareils hors
// ligne ajoutent chacun un diagnostic a la meme rencontre.
import { describe, expect, test } from 'vitest';
import { mergeKeepBoth } from './conflictMerge';

const HED = { code: 'S06.4', label: 'Hematome extradural' };
const FEMUR = { code: 'S72.0', label: 'Fracture du femur' };
const PNEUMO = { code: 'J18.9', label: 'Pneumopathie' };

describe('mergeKeepBoth — union des listes de diagnostics', () => {
  test('reunit les deux listes : ordre local d\'abord, puis les nouveautes serveur', () => {
    const r = mergeKeepBoth(
      { diagnostic: [HED, FEMUR] },
      { diagnostic: [HED, PNEUMO] },
    );
    expect(r.data.diagnostic).toEqual([HED, FEMUR, PNEUMO]);
    expect(r.mergedKeys).toEqual(['diagnostic']);
    expect(r.recovered).toBe(1);
  });

  test('aucun doublon de code, et le libelle d\'un code partage reste le mien', () => {
    // Le code est l'identite ; le libelle n'est que l'instantane pris a la saisie.
    const r = mergeKeepBoth(
      { diagnostic: [HED] },
      { diagnostic: [{ code: 'S06.4', label: 'Hematome extra-dural (libelle serveur)' }, FEMUR] },
    );
    expect(r.data.diagnostic).toEqual([HED, FEMUR]);
    expect(r.recovered).toBe(1);
  });

  test('plusieurs variables multivaluees sont fusionnees ensemble', () => {
    const r = mergeKeepBoth(
      { diagnostic: [HED], complications: [PNEUMO] },
      { diagnostic: [FEMUR], complications: [PNEUMO, HED] },
    );
    expect(r.data).toEqual({ diagnostic: [HED, FEMUR], complications: [PNEUMO, HED] });
    expect(r.mergedKeys).toEqual(['diagnostic', 'complications']);
    expect(r.recovered).toBe(2);
  });

  test('les autres variables gardent MA valeur : la fusion ne rend rien au serveur', () => {
    const r = mergeKeepBoth(
      { diagnostic: [HED], glasgow_score: 12, motif: 'chute' },
      { diagnostic: [FEMUR], glasgow_score: 14, motif: 'accident' },
    );
    expect(r.data.glasgow_score).toBe(12);
    expect(r.data.motif).toBe('chute');
  });
});

describe('mergeKeepBoth — les cas ou il n\'y a RIEN a fusionner', () => {
  // mergedKeys vide est le signal que l'ecran ne doit pas proposer l'issue : le bouton
  // promettrait un sauvetage qui n'a pas lieu.
  const rienAFusionner = (r: ReturnType<typeof mergeKeepBoth>) => {
    expect(r.mergedKeys).toEqual([]);
    expect(r.recovered).toBe(0);
  };

  test('un conflit qui ne porte que sur des champs a valeur unique', () => {
    const mine = { glasgow_score: 12, sortie: '2026-08-10' };
    const r = mergeKeepBoth(mine, { glasgow_score: 14, sortie: '2026-08-12' });
    rienAFusionner(r);
    expect(r.data).toEqual(mine);
  });

  test('un diagnostic a valeur UNIQUE : deux couples differents ne se fusionnent pas', () => {
    const r = mergeKeepBoth({ diagnostic: HED }, { diagnostic: FEMUR });
    rienAFusionner(r);
    expect(r.data.diagnostic).toEqual(HED);
  });

  test('la liste serveur est deja incluse dans la mienne', () => {
    const r = mergeKeepBoth({ diagnostic: [HED, FEMUR] }, { diagnostic: [FEMUR] });
    rienAFusionner(r);
    expect(r.data.diagnostic).toEqual([HED, FEMUR]);
  });

  test('un code de donnee manquante et une liste sont CONTRADICTOIRES, dans les deux sens', () => {
    const manquant = { __missing__: 'non_fait' };
    const a = mergeKeepBoth({ diagnostic: manquant }, { diagnostic: [HED] });
    rienAFusionner(a);
    expect(a.data.diagnostic).toEqual(manquant);
    const b = mergeKeepBoth({ diagnostic: [HED] }, { diagnostic: manquant });
    rienAFusionner(b);
    expect(b.data.diagnostic).toEqual([HED]);
  });

  test('une liste vide cote serveur n\'apporte rien (la base la refuse, on ne s\'y fie pas)', () => {
    const r = mergeKeepBoth({ diagnostic: [HED] }, { diagnostic: [] });
    rienAFusionner(r);
    expect(r.data.diagnostic).toEqual([HED]);
  });

  test('une liste a choix multiples (codes recopies dans le gabarit) n\'est pas unie', () => {
    // Hors perimetre §10 : une deselection y est une correction deliberee, pas un ajout perdu.
    const r = mergeKeepBoth({ antecedents: ['hta'] }, { antecedents: ['hta', 'diabete'] });
    rienAFusionner(r);
    expect(r.data.antecedents).toEqual(['hta']);
  });

  test('une cle presente SEULEMENT cote serveur n\'est pas reprise', () => {
    // Sans valeur de base, on ne peut pas distinguer l'ajout de l'autre appareil d'une
    // suppression que j'ai faite hors-ligne. C'est deja le comportement de « garder ma version ».
    const r = mergeKeepBoth({ diagnostic: [HED] }, { diagnostic: [HED], commentaire: 'ajout serveur' });
    rienAFusionner(r);
    expect(r.data).toEqual({ diagnostic: [HED] });
  });

  test('aucune valeur serveur connue (rencontre non relue) : la fusion vaut ma version', () => {
    const mine = { diagnostic: [HED] };
    for (const server of [null, undefined]) {
      const r = mergeKeepBoth(mine, server);
      rienAFusionner(r);
      expect(r.data).toEqual(mine);
    }
  });
});

describe('mergeKeepBoth — purete et determinisme (idempotence du rejeu)', () => {
  test('n\'altere aucune des deux entrees', () => {
    const mine = { diagnostic: [HED] };
    const server = { diagnostic: [FEMUR] };
    mergeKeepBoth(mine, server);
    expect(mine).toEqual({ diagnostic: [HED] });
    expect(server).toEqual({ diagnostic: [FEMUR] });
  });

  test('deux appels produisent la MEME charge, a l\'octet pres', () => {
    // C'est la condition de l'idempotence : l'empreinte serveur porte sur la charge. Une fusion
    // qui varierait d'un appel a l'autre ferait echouer le rejeu en OFFLINE_OPERATION_MISMATCH.
    const mine = { diagnostic: [HED, FEMUR], glasgow_score: 12 };
    const server = { diagnostic: [PNEUMO, HED] };
    expect(JSON.stringify(mergeKeepBoth(mine, server).data))
      .toBe(JSON.stringify(mergeKeepBoth(mine, server).data));
  });

  test('refusionner un resultat deja fusionne ne le change plus', () => {
    // Rejeu apres une reponse reseau perdue : la charge recalculee est identique, donc le serveur
    // retrouve son accuse et n'ecrit pas une seconde fois.
    const server = { diagnostic: [PNEUMO] };
    const first = mergeKeepBoth({ diagnostic: [HED] }, server);
    const second = mergeKeepBoth(first.data, server);
    expect(second.data).toEqual(first.data);
    expect(second.mergedKeys).toEqual([]);
  });

  test('l\'ordre des cles de ma version est conserve', () => {
    const r = mergeKeepBoth({ z: 1, diagnostic: [HED], a: 2 }, { diagnostic: [FEMUR] });
    expect(Object.keys(r.data)).toEqual(['z', 'diagnostic', 'a']);
  });
});
