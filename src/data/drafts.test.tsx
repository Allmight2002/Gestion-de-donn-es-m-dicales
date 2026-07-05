// @vitest-environment jsdom
// A4 : le brouillon local (localStorage) fait un aller-retour fidele et s'efface a la demande.
import { afterEach, describe, expect, test } from 'vitest';
import { setOfflineUser } from './offline';
import {
  DRAFT_TTL_MS,
  saveDraft,
  loadDraft,
  clearDraft,
  purgeExpiredDrafts,
  clearDraftsForCurrentUser,
} from './drafts';

describe('drafts (brouillon local anti-perte)', () => {
  afterEach(() => {
    localStorage.clear();
    setOfflineUser(null);
  });

  test('save -> load conserve la donnee + un horodatage, puis clear supprime', () => {
    expect(loadDraft('encounter', 'p1')).toBeNull();
    saveDraft('encounter', 'p1', { score: 12 });
    const d = loadDraft<{ score: number }>('encounter', 'p1');
    expect(d?.data.score).toBe(12);
    expect(typeof d?.at).toBe('number');
    clearDraft('encounter', 'p1');
    expect(loadDraft('encounter', 'p1')).toBeNull();
  });

  test('les brouillons sont distincts par entite', () => {
    saveDraft('encounter', 'p1', { score: 1 });
    expect(loadDraft('encounter', 'p2')).toBeNull(); // autre patient -> autre cle
  });

  test('un brouillon expire est ignore puis supprime', () => {
    localStorage.setItem(
      'meddata:draft:encounter::p1',
      JSON.stringify({ at: Date.now() - DRAFT_TTL_MS - 1, data: { score: 99 } }),
    );

    expect(loadDraft('encounter', 'p1')).toBeNull();
    expect(localStorage.getItem('meddata:draft:encounter::p1')).toBeNull();
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
    saveDraft('encounter', 'p1', { score: 1 });
    setOfflineUser('bob');
    saveDraft('encounter', 'p1', { score: 2 });

    setOfflineUser('alice');
    expect(clearDraftsForCurrentUser()).toBe(1);
    expect(loadDraft('encounter', 'p1')).toBeNull();

    setOfflineUser('bob');
    expect(loadDraft<{ score: number }>('encounter', 'p1')?.data.score).toBe(2);
  });
});
