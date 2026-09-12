// @vitest-environment jsdom
// A4 : le brouillon local (localStorage) fait un aller-retour fidele et s'efface a la demande.
// UX-8 : ce qui est ecrit sur l'appareil est borne par une matrice, survit a un enregistrement
// corrompu, ne se relit pas au hasard, et ne survit pas a l'arrivee d'un autre compte.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setOfflineUser } from './offline';
import {
  DRAFT_FORMAT,
  DRAFT_TTL_MS,
  saveDraft,
  loadDraft,
  clearDraft,
  purgeExpiredDrafts,
  purgeForeignDrafts,
  clearDraftsForCurrentUser,
} from './drafts';

/** Un brouillon de rencontre, tel que l'ecran de saisie l'ecrit reellement. */
const draft = (values: Record<string, unknown> = {}) => ({
  templateVersionId: 'v1',
  encounterType: 'consultation',
  encounterDate: '2026-09-12',
  status: 'draft',
  values,
});

describe('drafts (brouillon local anti-perte)', () => {
  beforeEach(() => setOfflineUser('alice'));
  afterEach(() => {
    localStorage.clear();
    setOfflineUser(null);
  });

  test('save -> load conserve la donnee + un horodatage, puis clear supprime', () => {
    expect(loadDraft('encounter', 'p1')).toBeNull();
    saveDraft('encounter', 'p1', draft({ score: 12 }));
    const d = loadDraft<ReturnType<typeof draft>>('encounter', 'p1');
    expect(d?.data.values).toEqual({ score: 12 });
    expect(typeof d?.at).toBe('number');
    clearDraft('encounter', 'p1');
    expect(loadDraft('encounter', 'p1')).toBeNull();
  });

  test('les brouillons sont distincts par entite', () => {
    saveDraft('encounter', 'p1', draft({ score: 1 }));
    expect(loadDraft('encounter', 'p2')).toBeNull(); // autre patient -> autre cle
  });

  test('un brouillon expire est ignore puis supprime', () => {
    localStorage.setItem(
      'meddata:draft:encounter:alice:p1',
      JSON.stringify({ at: Date.now() - DRAFT_TTL_MS - 1, data: draft({ score: 99 }) }),
    );

    expect(loadDraft('encounter', 'p1')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter:alice:p1')).toBeNull();
  });

  test('purgeExpiredDrafts efface les brouillons trop anciens et conserve les recents', () => {
    const now = Date.now();
    localStorage.setItem('meddata:draft:encounter::old', JSON.stringify({ at: now - DRAFT_TTL_MS - 1, data: {} }));
    localStorage.setItem('meddata:draft:encounter::fresh', JSON.stringify({ at: now - DRAFT_TTL_MS + 1, data: {} }));

    expect(purgeExpiredDrafts(now)).toBe(1);
    expect(localStorage.getItem('meddata:draft:encounter::old')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter::fresh')).not.toBeNull();
  });

  test('clearDraftsForCurrentUser efface seulement les brouillons du compte courant', () => {
    setOfflineUser('alice');
    saveDraft('encounter', 'p1', draft({ score: 1 }));
    setOfflineUser('bob');
    saveDraft('encounter', 'p1', draft({ score: 2 }));

    setOfflineUser('alice');
    expect(clearDraftsForCurrentUser()).toBe(1);
    expect(loadDraft('encounter', 'p1')).toBeNull();

    setOfflineUser('bob');
    expect(loadDraft<ReturnType<typeof draft>>('encounter', 'p1')?.data.values).toEqual({ score: 2 });
  });

  test('the 24 hour lifetime is not extended by another save, and quota failures are reported', () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    expect(saveDraft('encounter', 'p1', draft({ score: 1 }))).toBe(true);
    now.mockReturnValue(start + DRAFT_TTL_MS - 1);
    expect(saveDraft('encounter', 'p1', draft({ score: 2 }))).toBe(true);
    now.mockReturnValue(start + DRAFT_TTL_MS);
    expect(saveDraft('encounter', 'p1', draft({ score: 3 }))).toBe(false);
    expect(loadDraft('encounter', 'p1')).toBeNull();
    now.mockRestore();
    expect(saveDraft('encounter', 'p2', draft({ text: 'x'.repeat(256 * 1024) }))).toBe(false);
    expect(loadDraft('encounter', 'p2')).toBeNull();
    setOfflineUser(null);
    expect(saveDraft('encounter', 'p3', draft({ score: 1 }))).toBe(false);
  });

  // UX-8 — la matrice des donnees autorisees est verifiee AVANT l'ecriture : un refus ne doit
  // rien laisser sur l'appareil, et l'ecran annonce alors une saisie non protegee.
  test('UX-8 : un compartiment non declare ou un type inconnu est refuse sans rien ecrire', () => {
    expect(saveDraft('encounter', 'p1', { ...draft(), patientName: 'Fictif' })).toBe(false);
    expect(localStorage.getItem('meddata:draft:encounter:alice:p1')).toBeNull();

    // Un `kind` que la matrice ne declare pas n'a aucune place autorisee sur cet appareil.
    expect(saveDraft('identity', 'p1', draft())).toBe(false);
    expect(localStorage.getItem('meddata:draft:identity:alice:p1')).toBeNull();

    // Une charge qui n'est pas un objet ne passe pas non plus.
    expect(saveDraft('encounter', 'p1', 'texte libre')).toBe(false);
    expect(saveDraft('encounter', 'p1', draft())).toBe(true);
  });

  test('UX-8 : un enregistrement corrompu est supprime et n\'interrompt pas le balayage', () => {
    const now = Date.now();
    localStorage.setItem('meddata:draft:encounter:alice:corrompu', '{ceci n\'est pas du JSON');
    localStorage.setItem('meddata:draft:encounter:alice:vieux', JSON.stringify({ at: now - DRAFT_TTL_MS - 1, data: draft() }));
    localStorage.setItem('meddata:draft:encounter:alice:recent', JSON.stringify({ at: now, data: draft() }));

    // Sans traitement par enregistrement, le premier octet corrompu conservait le second.
    expect(purgeExpiredDrafts(now)).toBe(2);
    expect(localStorage.getItem('meddata:draft:encounter:alice:corrompu')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter:alice:vieux')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter:alice:recent')).not.toBeNull();
    // Lu directement, un enregistrement illisible part aussi : personne ne le reprendra jamais.
    localStorage.setItem('meddata:draft:encounter:alice:p9', '<<<');
    expect(loadDraft('encounter', 'p9')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter:alice:p9')).toBeNull();
  });

  test('UX-8 : un format anterieur se relit, un format inconnu ne se relit ni ne se detruit', () => {
    const now = Date.now();
    // Avant UX-8, l'enveloppe ne portait pas de numero de format : elle reste lisible.
    localStorage.setItem('meddata:draft:encounter:alice:legacy',
      JSON.stringify({ at: now, data: draft({ score: 7 }) }));
    expect(loadDraft<ReturnType<typeof draft>>('encounter', 'legacy')?.data.values).toEqual({ score: 7 });
    // Et la sauvegarde suivante la reecrit au format courant, sans repartir le TTL a zero.
    saveDraft('encounter', 'legacy', draft({ score: 8 }));
    const migrated = JSON.parse(localStorage.getItem('meddata:draft:encounter:alice:legacy') ?? '{}');
    expect(migrated.v).toBe(DRAFT_FORMAT);
    expect(migrated.createdAt).toBe(now);

    // Un onglet plus ancien ne doit pas effacer ce qu'un onglet a jour vient d'ecrire.
    localStorage.setItem('meddata:draft:encounter:alice:futur',
      JSON.stringify({ at: now, v: DRAFT_FORMAT + 1, data: { autre: true } }));
    expect(loadDraft('encounter', 'futur')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter:alice:futur')).not.toBeNull();
    // Il part quand son temps est ecoule, comme n'importe quel autre brouillon.
    expect(purgeExpiredDrafts(now + DRAFT_TTL_MS)).toBe(2);
    expect(localStorage.getItem('meddata:draft:encounter:alice:futur')).toBeNull();
  });

  // Le trou de migration du poste partage : l'ancien format A4 ecrivait des cles sans segment
  // utilisateur. Les servir au premier compte qui ouvre la meme fiche serait exactement la
  // fuite que le partitionnement etait cense empecher.
  test('UX-8 : une cle sans compte n\'est servie a personne, et une enveloppe tronquee part', () => {
    localStorage.setItem('meddata:draft:encounter::p1',
      JSON.stringify({ at: Date.now(), data: draft({ score: 3 }) }));
    setOfflineUser('alice');
    expect(loadDraft('encounter', 'p1')).toBeNull();

    // Et sans compte actif, la lecture ne retombe pas sur cette cle non plus.
    setOfflineUser(null);
    expect(loadDraft('encounter', 'p1')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter::p1')).not.toBeNull();

    // Une enveloppe sans charge ne traverse plus la lecture : la reprise echouait ensuite,
    // au moment ou l'ecran cherchait la version du gabarit.
    setOfflineUser('alice');
    localStorage.setItem('meddata:draft:encounter:alice:p2', JSON.stringify({ at: Date.now() }));
    expect(loadDraft('encounter', 'p2')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter:alice:p2')).toBeNull();
  });

  test('UX-8 : a l\'ouverture de session, les brouillons d\'un autre compte quittent l\'appareil', () => {
    setOfflineUser('alice');
    saveDraft('encounter', 'p1', draft({ score: 1 }));
    setOfflineUser('bob');
    saveDraft('encounter', 'p2', draft({ score: 2 }));

    // Bob ouvre la session : les rendre inaccessibles ne suffit pas, ils doivent partir.
    expect(purgeForeignDrafts('bob')).toBe(1);
    expect(localStorage.getItem('meddata:draft:encounter:alice:p1')).toBeNull();
    expect(loadDraft<ReturnType<typeof draft>>('encounter', 'p2')?.data.values).toEqual({ score: 2 });
  });
});
