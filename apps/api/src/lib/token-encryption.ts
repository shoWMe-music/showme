import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * SEALING A LONG-LIVED CREDENTIAL — plain TypeScript, no framework, no database.
 *
 * A Google refresh token does not expire on its own, cannot be scoped down after
 * the fact, and is a working key to a person's entire calendar until either they
 * or we revoke it. It is therefore never written to Postgres as issued.
 *
 * THE SCHEME: AES-256-GCM, key from `CALENDAR_TOKEN_ENCRYPTION_KEY` (32 random
 * bytes, base64, held in Secret Manager and mounted into the Cloud Run service —
 * it does not exist inside the database it protects). Each seal draws a fresh
 * 96-bit nonce; ciphertext, nonce and authentication tag are stored as three
 * base64 columns.
 *
 * WHY GCM AND NOT CBC-OR-ANYTHING-ELSE. GCM is authenticated: `open` verifies the
 * tag before returning a single byte of plaintext, so a ciphertext that has been
 * edited, truncated, or lifted off another row FAILS instead of decrypting to
 * something. Unauthenticated modes hand an attacker who can WRITE this table the
 * ability to steer the plaintext — with a bearer credential on the other end of
 * the decrypt, that is not a theoretical distinction.
 *
 * WHY THE NONCE MUST BE FRESH EVERY TIME. Reusing a (key, nonce) pair under GCM
 * is catastrophic rather than merely untidy: it leaks the XOR of the two
 * plaintexts and, worse, allows forgery of the authentication tag for that key.
 * `randomBytes(12)` per seal, never a counter, never derived from the row.
 *
 * WHAT `context` IS FOR — the last mile. GCM's associated data is authenticated
 * but not encrypted, so binding a ciphertext to WHERE IT LIVES costs nothing and
 * closes a real hole: an attacker with write access could otherwise copy the
 * sealed token from row A onto row B and have the API sync victim A's calendar
 * into attacker B's account, with the key never leaving Secret Manager. Sealing
 * under `user|provider|account` makes that copy fail to open. Pass the same
 * context to `seal` and `open` or the tag will not verify — which is the point.
 *
 * WHAT A DATABASE-ONLY COMPROMISE YIELDS: nothing readable. Ciphertext, nonce and
 * tag are all useless without the 32 bytes, which are not in the dump.
 */

/** The three pieces GCM needs back, base64. All three are required to open. */
export interface SealedSecret {
  ciphertext: string;
  /** The 96-bit nonce this ciphertext was sealed under. Unique per seal. */
  iv: string;
  /** The GCM authentication tag — what makes tampering detectable. */
  authTag: string;
}

export interface SecretSealer {
  seal(plaintext: string, context: string): SealedSecret;
  /** Throws `SecretTamperedError` if the key, the context or the bytes are wrong. */
  open(sealed: SealedSecret, context: string): string;
}

/**
 * The one failure `open` has. Deliberately says nothing about WHICH part failed:
 * wrong key, edited ciphertext and stolen-from-another-row are indistinguishable
 * to a caller, and an error message that told them apart would be an oracle.
 */
export class SecretTamperedError extends Error {
  constructor(message = "Sealed secret failed authentication") {
    super(message);
    this.name = "SecretTamperedError";
  }
}

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
/** 96 bits — the nonce length GCM is specified and optimised for. */
const IV_BYTES = 12;

/**
 * Decode and check the configured key. A key of the wrong length is a
 * configuration mistake that must fail at wiring time, not on the first user who
 * tries to connect a calendar.
 */
export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CALENDAR_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

export function createSecretSealer(base64Key: string): SecretSealer {
  const key = decodeEncryptionKey(base64Key);

  return {
    seal(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
      };
    },

    open(sealed, context) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"));
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(sealed.ciphertext, "base64")),
          decipher.final(),
        ]);
        return plaintext.toString("utf8");
      } catch {
        // `decipher.final()` throws on a bad tag; a malformed iv/tag length throws
        // from the setters. Both mean the same thing to a caller: do not trust it.
        throw new SecretTamperedError();
      }
    },
  };
}

/**
 * Derive a PURPOSE-SPECIFIC subkey from the same 32 bytes.
 *
 * The OAuth `state` parameter needs a MAC key, and using the encryption key
 * directly for two different algorithms is the classic way to turn two sound
 * primitives into one unsound system. One HMAC with a fixed, versioned label
 * gives each purpose its own key while keeping one secret to rotate.
 */
export function deriveSubkey(base64Key: string, label: string): Buffer {
  const key = decodeEncryptionKey(base64Key);
  // Node's crypto has no HKDF-expand simpler than this for a single 32-byte
  // output; one HMAC over a domain-separating label IS that step.
  return createHmac("sha256", key).update(label, "utf8").digest();
}

/** Constant-time compare for MACs — a fast `===` on a tag leaks it byte by byte. */
export function equalsConstantTime(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
