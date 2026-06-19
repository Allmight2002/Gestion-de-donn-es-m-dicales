// Tests unitaires de la logique d'auth PURE (cahier §7 : gating par role global).
import { describe, expect, test } from 'vitest';
import { mapProfileRow, landingPathFor, isAllowedInArea, canCreateBase, type ProfileRow } from '../src/auth/logic';

const adminRow: ProfileRow = { id: 's1', full_name: 'Admin', global_role: 'system_admin', language: 'fr' };
const medecinRow: ProfileRow = { id: 'm1', full_name: 'Medecin', global_role: 'medecin', language: 'en' };
const curateurRow: ProfileRow = { id: 'c1', full_name: 'Curateur', global_role: 'curateur', language: 'fr' };

describe('mapProfileRow', () => {
  test('mappe une ligne system_admin', () => {
    expect(mapProfileRow(adminRow)).toEqual({ id: 's1', fullName: 'Admin', globalRole: 'system_admin', language: 'fr' });
  });

  test('role inconnu -> repli sur analyste (jamais d escalade de privilege)', () => {
    expect(mapProfileRow({ id: 'x', full_name: null, global_role: 'member', language: null })).toEqual({
      id: 'x',
      fullName: '',
      globalRole: 'analyste',
      language: 'fr',
    });
  });

  test('ligne absente -> null', () => {
    expect(mapProfileRow(null)).toBeNull();
  });
});

describe('landingPathFor', () => {
  test('system_admin -> /admin', () => {
    expect(landingPathFor(mapProfileRow(adminRow)!)).toBe('/admin');
  });
  test('medecin -> /', () => {
    expect(landingPathFor(mapProfileRow(medecinRow)!)).toBe('/');
  });
});

describe('isAllowedInArea', () => {
  test('system_admin : zone admin OK, zone member non', () => {
    const p = mapProfileRow(adminRow)!;
    expect(isAllowedInArea(p, 'admin')).toBe(true);
    expect(isAllowedInArea(p, 'member')).toBe(false);
  });
  test('non-admin (medecin, curateur) : zone member OK, zone admin non', () => {
    for (const row of [medecinRow, curateurRow]) {
      const p = mapProfileRow(row)!;
      expect(isAllowedInArea(p, 'member')).toBe(true);
      expect(isAllowedInArea(p, 'admin')).toBe(false);
    }
  });
  test('profil null -> jamais autorise', () => {
    expect(isAllowedInArea(null, 'member')).toBe(false);
    expect(isAllowedInArea(null, 'admin')).toBe(false);
  });
});

describe('canCreateBase', () => {
  test('seul le medecin peut creer une base', () => {
    expect(canCreateBase(mapProfileRow(medecinRow))).toBe(true);
    expect(canCreateBase(mapProfileRow(curateurRow))).toBe(false);
    expect(canCreateBase(mapProfileRow(adminRow))).toBe(false);
    expect(canCreateBase(null)).toBe(false);
  });
});
