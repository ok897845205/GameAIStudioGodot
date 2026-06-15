import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Symmetric encryption for API keys at rest.
 *
 * SECURITY NOTE — this is obfuscation, not true secrecy. The passphrase is
 * embedded in the application, so anyone with the installed app (or this
 * source) can derive the key and recover the plaintext. Its only goal is to
 * keep API keys from sitting in plaintext in config files / source, so a
 * casual inspection of `media-generation.json` or the repo doesn't leak them.
 * For real protection, route generation through a server-side proxy so the
 * keys never reach the client at all.
 *
 * Format: `enc:v1:<base64(iv[12] | tag[16] | ciphertext)>`.
 */

const VERSION_PREFIX = "enc:v1:";
// Embedded passphrase. Override at runtime with GAMEAISTUDIO_SECRET_KEY if you
// ship your own build with a different obfuscation key.
const EMBEDDED_PASSPHRASE = "gameaistudio::media-secret::v1::a7f3c1e9";
const KDF_SALT = Buffer.from("gameaistudio-secret-box-salt-v1", "utf8");
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | undefined;

function derivedKey(): Buffer {
  if (cachedKey) return cachedKey;
  const passphrase = process.env.GAMEAISTUDIO_SECRET_KEY?.trim() || EMBEDDED_PASSPHRASE;
  cachedKey = scryptSync(passphrase, KDF_SALT, KEY_BYTES);
  return cachedKey;
}

/** True when `value` is already a secret-box ciphertext. */
export function isEncrypted(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith(VERSION_PREFIX);
}

/** Encrypts a plaintext secret into the `enc:v1:` envelope. Empty stays empty. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * Decrypts an `enc:v1:` ciphertext. A plaintext input (no prefix) is returned
 * as-is so callers can migrate existing plaintext config transparently. Throws
 * only when a ciphertext is present but corrupt/undecryptable.
 */
export function decryptSecret(value: string): string {
  if (!value || !isEncrypted(value)) return value;
  const raw = Buffer.from(value.slice(VERSION_PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = raw.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
