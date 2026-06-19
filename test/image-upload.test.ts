// Tests de la validation des pieces jointes (cahier §14).
import { describe, expect, test } from 'vitest';
import { validateImageFile, validateAttachmentFile, MAX_IMAGE_BYTES, MAX_DOCUMENT_BYTES } from '../src/domain/imageUpload';

describe('validateImageFile (chemin image / reencodage)', () => {
  test('accepte jpg / png / webp', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 1000 })).toMatchObject({ ok: true, ext: 'jpg' });
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toMatchObject({ ok: true, ext: 'png' });
    expect(validateImageFile({ type: 'image/webp', size: 1000 })).toMatchObject({ ok: true, ext: 'webp' });
  });

  test('refuse le PDF et les autres formats (validateur image seul)', () => {
    expect(validateImageFile({ type: 'application/pdf', size: 1000 }).ok).toBe(false);
    expect(validateImageFile({ type: 'image/gif', size: 1000 }).ok).toBe(false);
  });

  test('refuse une image trop volumineuse', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }).ok).toBe(false);
  });
});

describe('validateAttachmentFile (images + PDF + Office)', () => {
  test('image -> ok + isImage true (sera reencodee)', () => {
    expect(validateAttachmentFile({ name: 'scan.PNG', type: 'image/png', size: 1000 })).toMatchObject({ ok: true, ext: 'png', isImage: true });
  });

  test('PDF et Office -> ok + isImage false (envoyes tels quels)', () => {
    expect(validateAttachmentFile({ name: 'cr.pdf', type: 'application/pdf', size: 1000 })).toMatchObject({ ok: true, ext: 'pdf', isImage: false });
    expect(validateAttachmentFile({ name: 'tab.xlsx', type: '', size: 1000 })).toMatchObject({ ok: true, ext: 'xlsx', isImage: false });
    expect(validateAttachmentFile({ name: 'lettre.docx', type: '', size: 1000 })).toMatchObject({ ok: true, ext: 'docx', isImage: false });
  });

  test('extension inconnue -> refus', () => {
    expect(validateAttachmentFile({ name: 'note.txt', type: 'text/plain', size: 10 }).ok).toBe(false);
    expect(validateAttachmentFile({ name: 'archive.zip', type: 'application/zip', size: 10 }).ok).toBe(false);
  });

  test('limites de taille : image 8 Mo, document 20 Mo', () => {
    expect(validateAttachmentFile({ name: 'x.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 }).ok).toBe(false);
    expect(validateAttachmentFile({ name: 'x.pdf', type: 'application/pdf', size: MAX_IMAGE_BYTES + 1 }).ok).toBe(true);
    expect(validateAttachmentFile({ name: 'x.pdf', type: 'application/pdf', size: MAX_DOCUMENT_BYTES + 1 }).ok).toBe(false);
  });
});
