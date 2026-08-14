import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Format: iv:authTag:ciphertext (all hex) — same as provider credential encryption
export function encryptAesGcm(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex.slice(0, 64), 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptAesGcm(encrypted: string, keyHex: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('invalid_encrypted_format');
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = Buffer.from(keyHex.slice(0, 64), 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
