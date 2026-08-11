const encoder = new TextEncoder();
const decoder = new TextDecoder();

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*-_+=';
const PASSWORD_ALPHABET = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function randomIndex(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > 256) throw new Error('Borne aleatoire invalide');
  const limit = 256 - (256 % max);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte); while (byte[0] >= limit);
  return byte[0] % max;
}

function randomChar(alphabet: string): string {
  return alphabet[randomIndex(alphabet.length)];
}

/** Mot de passe robuste, sans caracteres visuellement ambigus. */
export function generateMissionPassword(length = 24): string {
  if (!Number.isInteger(length) || length < 16 || length > 64) throw new Error('Longueur de mot de passe invalide');
  const chars = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGITS), randomChar(SYMBOLS)];
  while (chars.length < length) chars.push(randomChar(PASSWORD_ALPHABET));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function normalizeMissionIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function missionTechnicalEmail(identifier: string): string {
  return `${normalizeMissionIdentifier(identifier)}@mission.meddata.invalid`;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.trim().replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface CredentialEnvelope {
  ciphertext: string;
  nonce: string;
}

export interface CredentialCipher {
  encrypt(password: string): Promise<CredentialEnvelope>;
  decrypt(envelope: CredentialEnvelope): Promise<string>;
}

export async function createCredentialCipher(encodedKey: string): Promise<CredentialCipher> {
  const rawKey = decodeBase64Url(encodedKey);
  if (rawKey.byteLength !== 32) throw new Error('MISSION_CREDENTIALS_ENCRYPTION_KEY doit contenir 32 octets');
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

  return {
    async encrypt(password) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoder.encode(password));
      return { ciphertext: encodeBase64Url(new Uint8Array(encrypted)), nonce: encodeBase64Url(nonce) };
    },
    async decrypt(envelope) {
      const clear = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64Url(envelope.nonce) },
        key,
        decodeBase64Url(envelope.ciphertext),
      );
      return decoder.decode(clear);
    },
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
