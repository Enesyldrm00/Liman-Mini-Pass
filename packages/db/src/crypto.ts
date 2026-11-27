import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
  type KeyObject,
} from "node:crypto";

// Env values are encrypted in the application before they reach the database (ROADMAP
// section 7): AES-256-GCM with a random 12-byte nonce per value, and `app_id:key` as
// additional authenticated data, so a value copied onto another row does not decrypt.
//
// Stored form: `v1:` + base64(nonce ‖ ciphertext ‖ tag). The prefix names the key version;
// a rotated key gets a new prefix and the DB check on `value_enc` learns it too.

export const ENCRYPTION_KEY_BYTES = 32;
const VERSION_PREFIX = "v1:";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

/** Exactly 32 bytes in standard base64 with padding: 43 characters and one `=`. */
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Parses `LIMAN_ENCRYPTION_KEY`. Returns null when it is not 32 bytes of base64, so the
 * caller can report the variable by name without echoing its value. The key is a
 * KeyObject: it does not print its bytes when logged or serialised by accident.
 */
export function parseEncryptionKey(base64: string): KeyObject | null {
  if (!KEY_PATTERN.test(base64)) {
    return null;
  }
  const bytes = Buffer.from(base64, "base64");
  return bytes.length === ENCRYPTION_KEY_BYTES ? createSecretKey(bytes) : null;
}

/** Decryption failed: wrong key, tampered value, or a value moved to another row. */
export class EnvDecryptError extends Error {
  constructor() {
    super("Env value could not be decrypted");
    this.name = "EnvDecryptError";
  }
}

export interface EnvCipher {
  encrypt(appId: string, key: string, value: string): string;
  /** Throws {@link EnvDecryptError}; the message never contains the value. */
  decrypt(appId: string, key: string, stored: string): string;
}

const aad = (appId: string, key: string) => Buffer.from(`${appId}:${key}`, "utf8");

export function createEnvCipher(secret: KeyObject): EnvCipher {
  if (secret.type !== "secret" || secret.symmetricKeySize !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`Encryption key must be ${String(ENCRYPTION_KEY_BYTES)} bytes`);
  }

  return {
    encrypt(appId, key, value) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, secret, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad(appId, key));
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const blob = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
      return `${VERSION_PREFIX}${blob.toString("base64")}`;
    },

    decrypt(appId, key, stored) {
      if (!stored.startsWith(VERSION_PREFIX)) {
        throw new EnvDecryptError();
      }
      const blob = Buffer.from(stored.slice(VERSION_PREFIX.length), "base64");
      if (blob.length < NONCE_BYTES + TAG_BYTES) {
        throw new EnvDecryptError();
      }
      const nonce = blob.subarray(0, NONCE_BYTES);
      const tag = blob.subarray(blob.length - TAG_BYTES);
      const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);
      try {
        const decipher = createDecipheriv(ALGORITHM, secret, nonce, { authTagLength: TAG_BYTES });
        decipher.setAAD(aad(appId, key));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        // OpenSSL's message says nothing useful and must not be relied on not to.
        throw new EnvDecryptError();
      }
    },
  };
}
