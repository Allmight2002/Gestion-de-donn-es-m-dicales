// Inspection par MAGIC BYTES des fichiers deposes (cahier §5.3).
// Ces fonctions sont PURES (ou navigateur via Blob/crypto). On verifie qu'un fichier
// deguise (mauvaise signature pour l'extension) est REFUSE, defense en profondeur cote
// client avant tout upload.
import { describe, expect, test } from 'vitest';
import {
  detectContainer, inspectHeader, inspectFile, sha256Hex, MAX_DOCUMENT_BYTES,
} from '../src/domain/imageUpload';

const SIG = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], // %PDF-1.4
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0],
  webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  zip: [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0],
  ole: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  exe: [0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0], // "MZ" (executable Windows)
};
const u8 = (b: number[]) => new Uint8Array(b);
// Faux File minimal (name/size/slice) — evite la dependance au global File de Node.
function fakeFile(name: string, bytes: number[]): File {
  const data = new Uint8Array(bytes);
  return { name, size: data.byteLength, slice: (s = 0, e = data.byteLength) => new Blob([data.slice(s, e)]) } as unknown as File;
}

describe('detectContainer (signatures)', () => {
  test('reconnait les conteneurs attendus', () => {
    expect(detectContainer(u8(SIG.pdf))).toBe('pdf');
    expect(detectContainer(u8(SIG.png))).toBe('png');
    expect(detectContainer(u8(SIG.jpg))).toBe('jpg');
    expect(detectContainer(u8(SIG.webp))).toBe('webp');
    expect(detectContainer(u8(SIG.zip))).toBe('zip');
    expect(detectContainer(u8(SIG.ole))).toBe('ole');
  });
  test('signature inconnue ou vide -> null', () => {
    expect(detectContainer(u8(SIG.exe))).toBeNull();
    expect(detectContainer(u8([]))).toBeNull();
  });
});

describe('inspectHeader (coherence extension <-> signature)', () => {
  test('accepte les fichiers coherents', () => {
    expect(inspectHeader({ name: 'compte-rendu.pdf', size: 2000 }, u8(SIG.pdf))).toMatchObject({ ok: true, ext: 'pdf', type: 'application/pdf' });
    expect(inspectHeader({ name: 'scan.PNG', size: 2000 }, u8(SIG.png))).toMatchObject({ ok: true, ext: 'png', isImage: true });
    expect(inspectHeader({ name: 'lettre.docx', size: 2000 }, u8(SIG.zip))).toMatchObject({ ok: true, ext: 'docx' });
    expect(inspectHeader({ name: 'vieux.xls', size: 2000 }, u8(SIG.ole))).toMatchObject({ ok: true, ext: 'xls' });
  });

  test('REFUSE un .exe renomme en .pdf (signature MZ)', () => {
    const r = inspectHeader({ name: 'innocent.pdf', size: 2000 }, u8(SIG.exe));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/refuse par securite/i);
  });

  test('REFUSE un ZIP deguise en .png (signature ne correspond pas)', () => {
    expect(inspectHeader({ name: 'photo.png', size: 2000 }, u8(SIG.zip)).ok).toBe(false);
  });

  test('REFUSE une extension non autorisee, meme avec une vraie signature', () => {
    expect(inspectHeader({ name: 'archive.zip', size: 2000 }, u8(SIG.zip)).ok).toBe(false);
    expect(inspectHeader({ name: 'note.txt', size: 10 }, u8(SIG.pdf)).ok).toBe(false);
  });

  test('REFUSE un fichier trop volumineux (avant meme la signature)', () => {
    expect(inspectHeader({ name: 'gros.pdf', size: MAX_DOCUMENT_BYTES + 1 }, u8(SIG.pdf)).ok).toBe(false);
  });
});

describe('inspectFile (lecture des octets reels)', () => {
  test('lit l entete et accepte un vrai PDF', async () => {
    expect(await inspectFile(fakeFile('a.pdf', SIG.pdf))).toMatchObject({ ok: true, ext: 'pdf' });
  });
  test('refuse un faux PDF (octets executables)', async () => {
    expect((await inspectFile(fakeFile('a.pdf', SIG.exe))).ok).toBe(false);
  });
});

describe('sha256Hex', () => {
  test('empreinte deterministe (vecteur du blob vide)', async () => {
    expect(await sha256Hex(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
