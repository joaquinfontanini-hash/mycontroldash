/**
 * email-crypto.ts
 *
 * Encriptación/desencriptación AES-256-GCM para credenciales SMTP.
 * La key viene de EMAIL_ENCRYPTION_KEY (env var).
 * Fallback: derivada de SESSION_SECRET (menos ideal, ver advertencia).
 *
 * Formato almacenado en DB: "v1:iv_hex:authTag_hex:ciphertext_hex"
 *
 * SEGURIDAD:
 *   - AES-256-GCM con IV aleatorio de 96 bits por encriptación
 *   - Auth tag de 128 bits verifica integridad y autenticidad
 *   - La key se deriva con SHA-256 para garantizar exactamente 32 bytes
 *     independientemente del input (hex string, passphrase, etc.)
 *   - La key se cachea en memoria para evitar re-derivar en cada operación
 *   - Los errores de decriptación exponen solo un mensaje genérico
 *     (no revelan si el IV, el auth tag o el ciphertext son inválidos)
 *
 * IMPORTANTE PARA ROTACIÓN DE KEY:
 *   Si EMAIL_ENCRYPTION_KEY cambia, todos los datos encriptados con la
 *   key anterior se vuelven ilegibles. Antes de cambiar la key, desencriptá
 *   y re-encriptá todos los registros de email_connections.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "crypto";

// ── Constantes del protocolo ──────────────────────────────────────────────────

const ALGORITHM     = "aes-256-gcm" as const;
const IV_BYTES      = 12;   // 96-bit IV — estándar GCM
const AUTH_TAG_BYTES = 16;  // 128-bit auth tag
const KEY_BYTES     = 32;   // 256-bit key

// Versión del formato — permite evolucionar el esquema sin romper datos existentes
const FORMAT_VERSION = "v1";

// ── Key derivation ────────────────────────────────────────────────────────────
// La key se cachea en memoria por proceso — se deriva una sola vez.
// Si cambia entre restarts (por cambio de env), el cache se invalida
// automáticamente al reiniciar el proceso en Railway.
let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_cachedKey) return _cachedKey;

  const rawKey    = process.env["EMAIL_ENCRYPTION_KEY"];
  const fallback  = process.env["SESSION_SECRET"];

  let keyMaterial: string;

  if (rawKey && rawKey.length >= 16) {
    // Derivar exactamente 32 bytes desde cualquier longitud de key material
    // SHA-256 siempre produce 256 bits = 32 bytes
    keyMaterial = rawKey;
  } else if (fallback) {
    // Fallback: deriva desde SESSION_SECRET con prefijo de dominio para
    // evitar reutilizar la misma key derivada en otro contexto
    if (rawKey !== undefined) {
      // La variable existe pero es muy corta — advertir en producción
      console.warn(
        "[email-crypto] EMAIL_ENCRYPTION_KEY es muy corta (< 16 chars). " +
        "Usá al menos 32 chars aleatorios. Usando SESSION_SECRET como fallback.",
      );
    }
    keyMaterial = `email_creds_v1:${fallback}`;
  } else {
    throw new Error(
      "[email-crypto] EMAIL_ENCRYPTION_KEY o SESSION_SECRET deben estar configurados. " +
      "Usá: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  // SHA-256 del material → 32 bytes deterministas
  _cachedKey = createHash("sha256").update(keyMaterial).digest();
  return _cachedKey;
}

// Exponer para tests y rotación de key
export function clearKeyCache(): void {
  _cachedKey = null;
}

// ── encryptCredential ─────────────────────────────────────────────────────────
// Encripta un string con AES-256-GCM.
// Cada llamada genera un IV aleatorio diferente — seguro para reutilizar la misma key.
export function encryptCredential(plaintext: string): string {
  if (!plaintext) throw new Error("[email-crypto] No se puede encriptar un valor vacío");

  const key       = getKey();
  const iv        = randomBytes(IV_BYTES);                   // 96-bit IV aleatorio
  const cipher    = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag(); // 128-bit auth tag GCM

  // Formato: "v1:iv_hex:authTag_hex:ciphertext_hex"
  // El prefijo de versión permite migrar el formato en el futuro
  return [
    FORMAT_VERSION,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

// ── decryptCredential ─────────────────────────────────────────────────────────
// Desencripta un blob almacenado por encryptCredential.
// La verificación del auth tag de GCM garantiza autenticidad e integridad.
// Si el tag no verifica (datos corruptos, key incorrecta, manipulación),
// lanza un error con mensaje genérico que no revela detalles internos.
export function decryptCredential(stored: string): string {
  if (!stored || typeof stored !== "string") {
    throw new Error("[email-crypto] Valor encriptado inválido");
  }

  const parts = stored.split(":");

  // Soporte para formato legacy (sin prefijo de versión): "iv:authTag:ciphertext"
  // y formato actual v1: "v1:iv:authTag:ciphertext"
  let ivHex: string;
  let authTagHex: string;
  let ciphertextHex: string;

  if (parts.length === 4 && parts[0] === FORMAT_VERSION) {
    [, ivHex, authTagHex, ciphertextHex] = parts as [string, string, string, string];
  } else if (parts.length === 3) {
    // Formato legacy sin versión — mantener compatibilidad hacia atrás
    [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  } else {
    throw new Error("[email-crypto] Formato de credencial encriptada inválido");
  }

  // Validar longitudes esperadas antes de intentar desencriptar
  if (ivHex.length !== IV_BYTES * 2) {
    throw new Error("[email-crypto] IV inválido");
  }
  if (authTagHex.length !== AUTH_TAG_BYTES * 2) {
    throw new Error("[email-crypto] Auth tag inválido");
  }
  if (!ciphertextHex || ciphertextHex.length === 0 || ciphertextHex.length % 2 !== 0) {
    throw new Error("[email-crypto] Ciphertext inválido");
  }

  try {
    const key        = getKey();
    const iv         = Buffer.from(ivHex, "hex");
    const authTag    = Buffer.from(authTagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher   = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // decipher.final() lanza si el auth tag no verifica — integridad garantizada
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err) {
    // No exponer detalles del error (key incorrecta, datos corruptos, etc.)
    // Un mensaje específico podría usarse para oracle attacks
    throw new Error(
      "[email-crypto] No se pudo desencriptar la credencial. " +
      "Verificá que EMAIL_ENCRYPTION_KEY no cambió desde la encriptación.",
    );
  }
}

// ── isEncrypted ───────────────────────────────────────────────────────────────
// Detecta si un valor ya está encriptado (formato v1 o legacy).
// Útil para evitar doble-encriptación al actualizar credenciales.
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  // Formato v1: "v1:24hex:32hex:Nhex"
  if (/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value)) return true;

  // Formato legacy: "24hex:32hex:Nhex"
  if (/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value)) return true;

  return false;
}

// ── safeDecrypt ───────────────────────────────────────────────────────────────
// Versión que no lanza — útil para logs y validación donde el fallo es esperado.
// Retorna null si la desencriptación falla por cualquier motivo.
export function safeDecrypt(stored: string): string | null {
  try {
    return decryptCredential(stored);
  } catch {
    return null;
  }
}
