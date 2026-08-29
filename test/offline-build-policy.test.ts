import { describe, expect, test } from 'vitest';
import { assertOfflineBuildPolicy } from '../scripts/offline-build-policy.mjs';

describe('gate de build hors-ligne', () => {
  test('accepte le defaut et la desactivation explicite', () => {
    expect(() => assertOfflineBuildPolicy({})).not.toThrow();
    expect(() => assertOfflineBuildPolicy({
      VITE_OFFLINE_MODE: 'disabled',
      VITE_OFFLINE_ADMIN_ACK: 'false',
    })).not.toThrow();
  });

  test('refuse le mode demo ou un acquittement partiel dans une release normale', () => {
    expect(() => assertOfflineBuildPolicy({
      VITE_OFFLINE_MODE: 'demo',
      VITE_OFFLINE_ADMIN_ACK: 'true',
    })).toThrow(/Build de production refuse/);
    expect(() => assertOfflineBuildPolicy({
      VITE_OFFLINE_MODE: 'disabled',
      VITE_OFFLINE_ADMIN_ACK: 'true',
    })).toThrow(/Build de production refuse/);
  });

  test('autorise seulement le preview LOT 13 explicitement isole', () => {
    expect(() => assertOfflineBuildPolicy({
      VITE_OFFLINE_MODE: 'demo',
      VITE_OFFLINE_ADMIN_ACK: 'true',
      ALLOW_OFFLINE_DEMO_BUILD: 'true',
    })).not.toThrow();
    expect(() => assertOfflineBuildPolicy({
      VITE_OFFLINE_MODE: 'unexpected',
      VITE_OFFLINE_ADMIN_ACK: 'false',
      ALLOW_OFFLINE_DEMO_BUILD: 'true',
    })).toThrow(/Configuration hors-ligne invalide/);
  });
});
