/**
 * email-crypto.ts
 *
 * AES-256-GCM encryption/decryption for sensitive email provider credentials.
 * The key comes from EMAIL_ENCRYPTION_KEY env var (32-byte hex).
 * Falls back to a derived key from SESSION_SECRET (less ideal but functional).
 *
 * Format stored in DB: "iv_hex:authTag_hex:ciphertext_hex"
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function getKey(): Buffer {
  const raw = process.env["EMAIL_ENCRYPTION_KEY"];
  if (raw && raw.length >= 32) {
    // Use first 32 chars as key material
    return Buffer.from(createHash("sha256").update(raw).digest("hex").slice(0, 64), "hex");
  }
  const fallback = process.env["SESSION_SECRET"];
  if (!fallback) {
    throw new Error("EMAIL_ENCRYPTION_KEY or SESSION_SECRET must be set to encrypt credentials");
  }
  return Buffer.from(createHash("sha256").update("email_creds:" + fallback).digest("hex").slice(0, 64), "hex");
}

export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptCredential(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted credential format");
  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Returns true if the value looks like an encrypted blob (not a plaintext credential) */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value);
}
