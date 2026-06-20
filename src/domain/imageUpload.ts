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

/** Validateur ELARGI : images + PDF + Office (cahier §14). Type DECLARE seulement. */
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

// === Inspection par MAGIC BYTES (cahier §5.3) ================================
// Le type MIME et l'extension declares par le navigateur sont falsifiables (un .exe
// renomme .pdf passe la validation par extension). On lit donc la SIGNATURE reelle des
// premiers octets et on verifie qu'elle correspond au conteneur attendu pour l'extension.
// C'est de la defense en profondeur cote client : ca bloque les fichiers deguises, mais
// ne remplace pas un antivirus serveur (un vrai PDF peut contenir une charge active).
// Limite connue : la signature confirme le CONTENEUR (docx/xlsx = ZIP, doc/xls = OLE),
// pas le sous-type Office exact.
export type Container = 'pdf' | 'png' | 'jpg' | 'webp' | 'zip' | 'ole';

const EXPECTED_CONTAINER: Record<string, Container> = {
  jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf',
  docx: 'zip', xlsx: 'zip', doc: 'ole', xls: 'ole',
};

/** Conteneur reel deduit des premiers octets (magic bytes). PUR. null si inconnu. */
export function detectContainer(h: Uint8Array): Container | null {
  const at = (off: number, sig: number[]) => sig.every((b, i) => h[off + i] === b);
  if (at(0, [0x25, 0x50, 0x44, 0x46])) return 'pdf';                 // %PDF
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return 'png';                 // .PNG
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpg';                       // JPEG (SOI)
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp'; // RIFF....WEBP
  if (at(0, [0x50, 0x4b])) return 'zip';                             // PK.. (docx/xlsx)
  if (at(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'; // doc/xls anciens
  return null;
}

export type FileInspection =
  | { ok: true; ext: string; type: string; isImage: boolean; detectedContainer: Container }
  | { ok: false; error: string };

/** Coherence extension <-> signature reelle. PUR (testable sans objet File). */
export function inspectHeader(meta: { name: string; size: number }, header: Uint8Array): FileInspection {
  const base = validateAttachmentFile({ name: meta.name, type: '', size: meta.size });
  if (!base.ok) return base;
  const expected = EXPECTED_CONTAINER[base.ext];
  const detected = detectContainer(header);
  if (detected !== expected) {
    return {
      ok: false,
      error:
        `Le contenu ne correspond pas a l'extension .${base.ext} ` +
        `(signature reelle : ${detected ?? 'inconnue'}). Fichier refuse par securite.`,
    };
  }
  return { ok: true, ext: base.ext, type: base.type, isImage: base.isImage, detectedContainer: detected };
}

/** Lit l'entete du fichier (16 octets) et verifie la signature. Navigateur. */
export async function inspectFile(file: File): Promise<FileInspection> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return inspectHeader({ name: file.name, size: file.size }, header);
}

/** SHA-256 (hex) d'un blob — empreinte d'integrite de l'objet stocke. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
