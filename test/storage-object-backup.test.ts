import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  decryptPayload,
  encryptPayload,
  isLoopbackStorageUrl,
  parseEncryptionKey,
  validateManifest,
} from '../scripts/storage-object-backup.mjs';

const validManifest = () => ({
  format: 'meddata-storage-backup/v1',
  createdAt: '2026-07-14T00:00:00.000Z',
  sourceApiSha256: 'a'.repeat(64),
  buckets: [
    {
      id: 'clinical-attachments',
      objects: [
        {
          name: 'base/patient/document.pdf',
          blobFile: 'objects/00000001.bin',
          sha256: 'b'.repeat(64),
          size: 12,
          metadata: { contentType: 'application/pdf', cacheControl: null },
        },
      ],
    },
  ],
  objectCount: 1,
  totalBytes: 12,
});

describe('sauvegarde chiffree des objets Storage', () => {
  test('exige une cle base64 de 32 octets', () => {
    const encoded = randomBytes(32).toString('base64');
    expect(parseEncryptionKey(encoded)).toHaveLength(32);
    expect(() => parseEncryptionKey('pas-du-base64')).toThrow(/base64 stricte/);
    expect(() => parseEncryptionKey(randomBytes(31).toString('base64'))).toThrow(/32 octets/);
  });

  test('chiffre, authentifie et dechiffre sans alteration', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('fixture fictive');
    const encrypted = encryptPayload(key, plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptPayload(key, encrypted)).toEqual(plaintext);

    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptPayload(key, tampered)).toThrow();
  });

  test('refuse par defaut les cibles qui ne sont pas locales', () => {
    expect(isLoopbackStorageUrl('http://127.0.0.1:5000')).toBe(true);
    expect(isLoopbackStorageUrl('http://localhost:5000/storage/v1')).toBe(true);
    expect(isLoopbackStorageUrl('https://project.supabase.co/storage/v1')).toBe(false);
    expect(isLoopbackStorageUrl('invalide')).toBe(false);
  });

  test('valide strictement les totaux et chemins du manifest', () => {
    expect(validateManifest(validManifest())).toEqual({ objectCount: 1, totalBytes: 12 });

    const wrongTotal = validManifest();
    wrongTotal.totalBytes = 11;
    expect(() => validateManifest(wrongTotal)).toThrow(/Totaux incoherents/);

    const traversal = validManifest();
    traversal.buckets[0].objects[0].blobFile = '../secret.bin';
    expect(() => validateManifest(traversal)).toThrow(/Objet invalide/);
  });
});

