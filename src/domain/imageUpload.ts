// Validation des pieces jointes de la fiche patient (cahier §12, §14) — PUR, testable.
// Images (jpg/jpeg/png/webp) : reencodees a l'upload pour supprimer les metadonnees (EXIF).
// Documents (pdf, doc/docx, xls/xlsx) : envoyes tels quels. Le medecin confirme la
// deidentification dans tous les cas. Validation par EXTENSION (le type MIME des fichiers
// Office est peu fiable cote navigateur).

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 Mo (reencodage)
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 Mo (PDF / Office)

const EXT_BY_TYPE: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type ImageValidation = { ok: true; type: AllowedImageType; ext: string } | { ok: false; error: string };

/** Validateur IMAGE seul (chemin de reencodage) — conserve pour la garde EXIF. */
export function validateImageFile(file: { type: string; size: number }): ImageValidation {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as AllowedImageType)) {
    return { ok: false, error: 'Format non autorise : jpg, png ou webp uniquement (pas de PDF).' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `Image trop volumineuse (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} Mo).` };
  }
  const type = file.type as AllowedImageType;
  return { ok: true, type, ext: EXT_BY_TYPE[type] };
}

interface AttachmentFormat {
  mime: string;
  isImage: boolean;
}
/** Catalogue des formats acceptes, par extension (source de verite). */
export const ALLOWED_ATTACHMENT_FORMATS: Record<string, AttachmentFormat> = {
  jpg: { mime: 'image/jpeg', isImage: true },
  jpeg: { mime: 'image/jpeg', isImage: true },
  png: { mime: 'image/png', isImage: true },
  webp: { mime: 'image/webp', isImage: true },
  pdf: { mime: 'application/pdf', isImage: false },
  doc: { mime: 'application/msword', isImage: false },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', isImage: false },
  xls: { mime: 'application/vnd.ms-excel', isImage: false },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', isImage: false },
};
/** Valeur de l'attribut HTML `accept` pour le selecteur de fichier. */
export const ALLOWED_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx';

export type AttachmentValidation =
  | { ok: true; ext: string; type: string; isImage: boolean }
  | { ok: false; error: string };

const extOf = (name: string): string => (name.split('.').pop() ?? '').toLowerCase();

/** Validateur ELARGI : images + PDF + Office (cahier §14). */
export function validateAttachmentFile(file: { name: string; type: string; size: number }): AttachmentValidation {
  const ext = extOf(file.name);
  const fmt = ALLOWED_ATTACHMENT_FORMATS[ext];
  if (!fmt) {
    return { ok: false, error: 'Format non autorise : images (jpg, png, webp), PDF ou Office (doc, docx, xls, xlsx).' };
  }
  const max = fmt.isImage ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (file.size > max) {
    return { ok: false, error: `Fichier trop volumineux (max ${Math.round(max / 1024 / 1024)} Mo).` };
  }
  return { ok: true, ext, type: fmt.mime, isImage: fmt.isImage };
}
