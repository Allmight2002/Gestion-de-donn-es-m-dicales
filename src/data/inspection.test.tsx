// @vitest-environment jsdom
// UX-8 — la cle d'idempotence d'un envoi de document est persistee sur le poste. Son NOM
// portait jusqu'ici la base, le patient, la rencontre, l'empreinte exacte du fichier et le
// libelle libre saisi par le soignant : un poste partage les laissait lisibles dans
// l'inspecteur, sans cloisonnement par compte et sans expiration.
import { afterEach, describe, expect, test } from 'vitest';
import { stableUploadOperationKey } from './inspection';

const SCOPE = 'attachment:b1:p1:e1:pdf';
const HASH = 'a'.repeat(64);
const LABEL = 'Compte rendu opératoire';

const storedKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('upload-operation:'));

describe('stableUploadOperationKey — UX-8', () => {
  afterEach(() => localStorage.clear());

  test('la relance retrouve la meme operation sans rien laisser de lisible', async () => {
    const first = await stableUploadOperationKey(SCOPE, HASH, LABEL);
    const again = await stableUploadOperationKey(SCOPE, HASH, LABEL);
    expect(again).toBe(first);

    // Le nom de la cle ne doit plus rien apprendre a qui ouvre l'inspecteur du poste.
    const keys = storedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('p1');
    expect(keys[0]).not.toContain(HASH);
    expect(keys[0]).not.toContain('opératoire');

    // Un autre fichier, ou un autre libelle, reste une autre operation.
    expect(await stableUploadOperationKey(SCOPE, 'b'.repeat(64), LABEL)).not.toBe(first);
    expect(await stableUploadOperationKey(SCOPE, HASH, 'Autre libellé')).not.toBe(first);
  });

  test('un enregistrement de l\'ancien format est repris puis efface', async () => {
    const legacy = `upload-operation:${SCOPE}:${HASH}:${LABEL}`;
    localStorage.setItem(legacy, 'operation-fictive');

    // Repris : sans cela, une relance apres deploiement creerait une SECONDE operation
    // serveur pour le meme fichier.
    expect(await stableUploadOperationKey(SCOPE, HASH, LABEL)).toBe('operation-fictive');
    expect(localStorage.getItem(legacy)).toBeNull();
    expect(storedKeys()).toHaveLength(1);
    // Et la relance suivante retrouve toujours la meme operation.
    expect(await stableUploadOperationKey(SCOPE, HASH, LABEL)).toBe('operation-fictive');
  });
});
