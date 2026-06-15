import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "./secret-box";

describe("secret-box", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const secret = "sk-or-v1-abcdef0123456789";
    const cipher = encryptSecret(secret);
    expect(cipher.startsWith("enc:v1:")).toBe(true);
    expect(cipher).not.toContain(secret);
    expect(decryptSecret(cipher)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV) but same plaintext", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("treats already-encrypted input as a no-op for encrypt", () => {
    const once = encryptSecret("key");
    expect(encryptSecret(once)).toBe(once);
  });

  it("returns plaintext input unchanged on decrypt (migration path)", () => {
    expect(decryptSecret("plain-key")).toBe("plain-key");
    expect(isEncrypted("plain-key")).toBe(false);
  });

  it("keeps empty strings empty", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("throws on a corrupt ciphertext", () => {
    expect(() => decryptSecret("enc:v1:not-valid-base64-tag")).toThrow();
  });
});
