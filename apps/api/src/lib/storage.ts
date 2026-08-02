/**
 * Signed-URL issuance for file bytes. The bytes live in Firebase Storage (GCS);
 * the API never proxies them — it authorizes access to the parent metadata row
 * and then hands the client a short-lived signed URL to talk to GCS directly.
 *
 * The signer is an INTERFACE so routes can be tested without touching GCS: the
 * test injects a fake that returns a deterministic URL, and the real
 * `firebase-admin/storage` implementation is loaded lazily (only in production,
 * only when credentials exist) and is never exercised by the suite.
 */
export interface StorageSigner {
  /** A signed URL the client PUTs the bytes to (write/upload). */
  signUpload(path: string, contentType: string): Promise<string>;
  /** A signed URL the client GETs the bytes from (read/download). */
  signDownload(path: string): Promise<string>;
}

/** How long an issued signed URL stays valid. */
const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * A deterministic, offline signer for tests (and local dev without GCS
 * credentials). It fabricates a stable URL from the object path so assertions
 * can be exact — it NEVER contacts GCS.
 */
export function createFakeStorageSigner(): StorageSigner {
  return {
    async signUpload(path, contentType) {
      return `https://fake.storage.local/upload/${encodeURIComponent(path)}?contentType=${encodeURIComponent(contentType)}`;
    },
    async signDownload(path) {
      return `https://fake.storage.local/download/${encodeURIComponent(path)}`;
    },
  };
}

/**
 * The production signer, backed by `firebase-admin/storage`. `firebase-admin` is
 * imported LAZILY inside each method so the module never loads (and never needs
 * credentials) in tests or in services that don't issue signed URLs. Not
 * exercised by the suite — the tests inject the fake.
 */
export function createFirebaseStorageSigner(bucketName: string): StorageSigner {
  async function bucket() {
    const { getStorage } = await import("firebase-admin/storage");
    return getStorage().bucket(bucketName);
  }
  return {
    async signUpload(path, contentType) {
      const file = (await bucket()).file(path);
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        contentType,
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
      return url;
    },
    async signDownload(path) {
      const file = (await bucket()).file(path);
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
      return url;
    },
  };
}

/**
 * The signer `fileRoutes` uses when no explicit one is injected. Falls back to
 * the fake unless real GCS credentials are configured — i.e. outside
 * `NODE_ENV==='test'` AND with a bucket named via `FIREBASE_STORAGE_BUCKET`.
 * Production wires the real signer explicitly via `createFileRoutes(...)`; this
 * default just keeps the app runnable (and the suite hermetic) without one.
 */
export function defaultStorageSigner(): StorageSigner {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (process.env.NODE_ENV === "test" || !bucketName) {
    return createFakeStorageSigner();
  }
  return createFirebaseStorageSigner(bucketName);
}
