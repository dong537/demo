import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptAesGcm, decryptAesGcm } from './aes-gcm';

const KEY = randomBytes(32).toString('hex');

describe('AES-256-GCM credential crypto', () => {
  it('round-trips a credential payload', () => {
    const plaintext = JSON.stringify({
      apikey: 'synthetic-api-key-for-aes-roundtrip',
      zone: 'synthetic-zone',
    });
    const encrypted = encryptAesGcm(plaintext, KEY);
    expect(decryptAesGcm(encrypted, KEY)).toBe(plaintext);
  });

  it('produces ivHex:authTagHex:ciphertextHex format', () => {
    const encrypted = encryptAesGcm('secret', KEY);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/);
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it('uses a random IV so the same plaintext yields different ciphertext', () => {
    const a = encryptAesGcm('same', KEY);
    const b = encryptAesGcm('same', KEY);
    expect(a).not.toBe(b);
    expect(decryptAesGcm(a, KEY)).toBe('same');
    expect(decryptAesGcm(b, KEY)).toBe('same');
  });

  it('throws on malformed input that is missing segments', () => {
    expect(() => decryptAesGcm('onlyonepart', KEY)).toThrow('invalid_encrypted_format');
    expect(() => decryptAesGcm('iv:tag', KEY)).toThrow('invalid_encrypted_format');
  });

  it('fails to decrypt when the key is wrong', () => {
    const encrypted = encryptAesGcm('secret', KEY);
    const wrongKey = randomBytes(32).toString('hex');
    expect(() => decryptAesGcm(encrypted, wrongKey)).toThrow();
  });

  it('fails to decrypt when the ciphertext is tampered', () => {
    const encrypted = encryptAesGcm('secret', KEY);
    const [iv, tag, ciphertext] = encrypted.split(':');
    const flipped = ciphertext[0] === '0' ? '1' : '0';
    const tampered = `${iv}:${tag}:${flipped}${ciphertext.slice(1)}`;
    expect(() => decryptAesGcm(tampered, KEY)).toThrow();
  });
});
