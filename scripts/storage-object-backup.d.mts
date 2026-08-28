export function parseEncryptionKey(value: string | undefined): Buffer;
export function encryptPayload(key: Buffer, plaintext: Uint8Array): Buffer;
export function decryptPayload(key: Buffer, encrypted: Uint8Array): Buffer;
export function isLoopbackStorageUrl(value: string): boolean;
export function validateManifest(manifest: unknown): {
  objectCount: number;
  totalBytes: number;
};

