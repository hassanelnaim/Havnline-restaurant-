import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Encryption for secrets HavnLine has to store in the database, like each
 * restaurant's Twilio sub-account auth token. With the key set, a copy of
 * the database alone (a leaked backup, a stolen export) doesn't hand over
 * every restaurant's phone account; the key lives only in Vercel.
 *
 * Key: SECRETS_ENCRYPTION_KEY in Vercel, any long random string. Without
 * it, secrets are stored as before (plain text) and nothing changes.
 *
 * Once secrets are stored encrypted, the key must never be removed or
 * changed: the server could no longer read them, and every restaurant's
 * phone line would stop working. Keep a copy somewhere safe.
 *
 * Stored form: "enc:v1:" + base64(12-byte IV + 16-byte auth tag + ciphertext),
 * AES-256-GCM. Values without the prefix are read as plain text, so old
 * rows keep working and are upgraded as they're read (see context.ts).
 */
const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) return null;
  return createHash("sha256").update(`havnline-secrets:${raw}`).digest();
}

export function encryptionConfigured(): boolean {
  return key() !== null;
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Encrypts when the key is set; otherwise returns the value unchanged. */
export function sealSecret(plain: string): string {
  const k = key();
  if (!k || isSealed(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Reads a stored secret, encrypted or not. null if it can't be decrypted. */
export function openSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isSealed(stored)) return stored;
  const k = key();
  if (!k) {
    console.error("[secretBox] a stored secret is encrypted but SECRETS_ENCRYPTION_KEY is not set");
    return null;
  }
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    console.error("[secretBox] a stored secret could not be decrypted (was SECRETS_ENCRYPTION_KEY changed?)");
    return null;
  }
}
