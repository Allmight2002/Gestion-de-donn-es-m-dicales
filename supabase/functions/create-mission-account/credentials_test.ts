import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  createCredentialCipher,
  generateMissionPassword,
  missionTechnicalEmail,
  normalizeMissionIdentifier,
  sha256Hex,
} from './credentials.ts';

function key(byte: number): string {
  const bytes = new Uint8Array(32).fill(byte);
  let binary = '';
  for (const item of bytes) binary += String.fromCharCode(item);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

Deno.test('genere des mots de passe robustes, uniques et sans caracteres ambigus', () => {
  const passwords = new Set(Array.from({ length: 200 }, () => generateMissionPassword()));
  assertEquals(passwords.size, 200);
  for (const password of passwords) {
    assertEquals(password.length, 24);
    assert(/[A-Z]/u.test(password));
    assert(/[a-z]/u.test(password));
    assert(/[0-9]/u.test(password));
    assert(/[!@#$%*\-_+=]/u.test(password));
    assert(!/[0O1Il]/u.test(password));
  }
});

Deno.test('normalise l identifiant et garde l email technique hors du contrat utilisateur', () => {
  assertEquals(normalizeMissionIdentifier(' Mission-Neuro-01 '), 'mission-neuro-01');
  assertEquals(missionTechnicalEmail(' Mission-Neuro-01 '), 'mission-neuro-01@mission.meddata.invalid');
});

Deno.test('chiffre en AES-GCM avec un nonce aleatoire et refuse une autre cle', async () => {
  const first = await createCredentialCipher(key(7));
  const second = await createCredentialCipher(key(8));
  const one = await first.encrypt('V7!solide-mission#2026');
  const two = await first.encrypt('V7!solide-mission#2026');
  assert(one.ciphertext !== 'V7!solide-mission#2026');
  assert(one.ciphertext !== two.ciphertext);
  assert(one.nonce !== two.nonce);
  assertEquals(await first.decrypt(one), 'V7!solide-mission#2026');
  await assertRejects(() => second.decrypt(one));
});

Deno.test('produit une empreinte stable sans conserver la valeur source', async () => {
  const hash = await sha256Hex('demande sensible');
  assertEquals(hash.length, 64);
  assert(!hash.includes('demande sensible'));
  assertEquals(hash, await sha256Hex('demande sensible'));
});
