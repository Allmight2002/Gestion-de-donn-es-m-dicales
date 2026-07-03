// @vitest-environment jsdom
// A4 : le brouillon local (localStorage) fait un aller-retour fidele et s'efface a la demande.
import { afterEach, describe, expect, test } from 'vitest';
import { saveDraft, loadDraft, clearDraft } from './drafts';

describe('drafts (brouillon local anti-perte)', () => {
  afterEach(() => localStorage.clear());

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
});
