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
import { randomBytes } from "node:crypto";
import { serviceUnavailable } from "../errors";
import { ensureFirebaseApp } from "./firebase-app";

/**
 * An issued upload URL and the headers the client MUST send with it. The headers
 * are part of what was signed, so storage refuses the write if they are absent or
 * different — which is how a size limit becomes enforceable at all. Enforcing it
 * only in the API would mean trusting a browser's word about the size of a file
 * the API never sees.
 */
export interface SignedUpload {
  url: string;
  headers: Record<string, string>;
}

export interface StorageSigner {
  /**
   * A signed URL the client PUTs the bytes to. `maxBytes` binds the signature to
   * a size ceiling; storage, not the caller, enforces it.
   */
  signUpload(path: string, contentType: string, maxBytes: number): Promise<SignedUpload>;
  /** A signed URL the client GETs the bytes from (read/download). */
  signDownload(path: string): Promise<string>;
}

/**
 * The GCS header that caps an upload's size. Signed into the URL and sent by the
 * client; a body outside the range is rejected by GCS with a 400. Named here
 * because both the real signer and the loopback stand-in must agree on it — and
 * because the bucket's CORS policy has to allow the browser to send it.
 */
export const CONTENT_LENGTH_RANGE_HEADER = "x-goog-content-length-range";

/** How long an issued signed URL stays valid. */
const SIGNED_URL_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * A deterministic, offline signer for tests (and local dev without GCS
 * credentials). It fabricates a stable URL from the object path so assertions
 * can be exact — it NEVER contacts GCS.
 */
export function createFakeStorageSigner(): StorageSigner {
  return {
    async signUpload(path, contentType, maxBytes) {
      return {
        url: `https://fake.storage.local/upload/${encodeURIComponent(path)}?contentType=${encodeURIComponent(contentType)}`,
        headers: {
          "content-type": contentType,
          [CONTENT_LENGTH_RANGE_HEADER]: `0,${maxBytes}`,
        },
      };
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
    // MUST come before `getStorage()`. Signing is reachable from PUBLIC routes,
    // which carry no token, so the token verifier — which used to be the only
    // thing that ever called `initializeApp()` — never runs on that path. Without
    // this line a published profile with an uploaded picture 500s with "The
    // default Firebase app does not exist". Idempotent; see lib/firebase-app.
    await ensureFirebaseApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
    });
    const { getStorage } = await import("firebase-admin/storage");
    return getStorage().bucket(bucketName);
  }
  return {
    async signUpload(path, contentType, maxBytes) {
      const file = (await bucket()).file(path);
      // The size ceiling is signed as an extension header, so GCS enforces it on
      // the write. The client must echo it exactly or the signature fails — see
      // `SignedUpload`, and note the bucket CORS policy must allow the header.
      const headers = { [CONTENT_LENGTH_RANGE_HEADER]: `0,${maxBytes}` };
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        contentType,
        extensionHeaders: headers,
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
      return { url, headers: { "content-type": contentType, ...headers } };
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
 * The LOOPBACK signer: a real, working upload for a laptop with no GCS bucket.
 *
 * The fake signer above points at `https://fake.storage.local`, a host that
 * resolves nowhere — so with it wired in, a browser can reach step 1 of an upload
 * (get a URL) and never step 2 (PUT the bytes). That is fine for a unit test
 * asserting the URL string, and useless for proving the flow works, which is the
 * one thing this project asks of a change (`verify-e2e`). So in local dev the
 * signed URL points back at the API's own object sink and the bytes really do
 * round-trip: upload → download returns what was uploaded.
 *
 * The URL carries an unguessable, single-use-shaped GRANT ID rather than the
 * object path: the id IS the capability, exactly as the signature is in a real
 * GCS URL, so nothing about an object can be reached by guessing its name. Grants
 * expire on the same clock as a signed URL. Objects live in memory — this is a
 * development substitute, not storage, and it says so by forgetting everything on
 * restart.
 */
export interface LoopbackObject {
  contentType: string;
  bytes: Buffer;
}

/** What one issued grant permits: this object, this way, until this moment. */
interface LoopbackGrant {
  path: string;
  contentType: string;
  action: "write" | "read";
  /** The size ceiling this grant was issued under — the sink enforces it, as GCS would. */
  maxBytes: number;
  expiresAt: number;
}

export interface LoopbackObjectStore {
  /** Redeem a grant id; null when unknown or expired. */
  redeem(
    grantId: string,
  ): { path: string; contentType: string; action: "write" | "read"; maxBytes: number } | null;
  put(path: string, object: LoopbackObject): void;
  get(path: string): LoopbackObject | undefined;
}

export interface LoopbackStorageSigner extends StorageSigner {
  /** The sink the signed URLs point at — `fileRoutes` mounts its two routes. */
  readonly objects: LoopbackObjectStore;
}

/**
 * The URL path (under the API prefix) the loopback signer points its URLs at.
 * Short on purpose: Fastify caps a route parameter at 100 characters, so the
 * grant id must be an id and not an encoded payload.
 */
export const LOOPBACK_OBJECT_ROUTE = "/files/local-object/:grantId";

/** Is this signer the loopback one — i.e. does the API need to mount its sink? */
export function isLoopbackStorageSigner(signer: StorageSigner): signer is LoopbackStorageSigner {
  return "objects" in signer;
}

export function createLoopbackStorageSigner(baseUrl: string): LoopbackStorageSigner {
  const grants = new Map<string, LoopbackGrant>();
  const objects = new Map<string, LoopbackObject>();
  const origin = baseUrl.replace(/\/$/, "");

  function sign(
    path: string,
    contentType: string,
    action: "write" | "read",
    maxBytes: number,
  ): string {
    const grantId = randomBytes(24).toString("base64url");
    grants.set(grantId, {
      path,
      contentType,
      action,
      maxBytes,
      expiresAt: Date.now() + SIGNED_URL_TTL_MS,
    });
    return `${origin}/api/v1/files/local-object/${grantId}`;
  }

  return {
    objects: {
      redeem(grantId) {
        const grant = grants.get(grantId);
        if (!grant) return null;
        if (grant.expiresAt < Date.now()) {
          grants.delete(grantId);
          return null;
        }
        return {
          path: grant.path,
          contentType: grant.contentType,
          action: grant.action,
          maxBytes: grant.maxBytes,
        };
      },
      put(path, object) {
        objects.set(path, object);
      },
      get(path) {
        return objects.get(path);
      },
    },
    async signUpload(path, contentType, maxBytes) {
      return {
        url: sign(path, contentType, "write", maxBytes),
        headers: {
          "content-type": contentType,
          [CONTENT_LENGTH_RANGE_HEADER]: `0,${maxBytes}`,
        },
      };
    },
    async signDownload(path) {
      return sign(path, "application/octet-stream", "read", 0);
    },
  };
}

/**
 * The signer for a deployment that was never told where to put files. It REFUSES
 * rather than inventing a URL: handing a browser a signed URL for a bucket that
 * was never configured is how the upload flow shipped "working" and silently
 * broken — the API answered 201 with a URL to nowhere, so every trace of the
 * failure lived in the user's network tab and none of it in ours.
 */
export function createUnconfiguredStorageSigner(): StorageSigner {
  const refuse = async (): Promise<never> => {
    throw serviceUnavailable(
      "File storage is not configured on this deployment (FIREBASE_STORAGE_BUCKET is unset).",
    );
  };
  return { signUpload: refuse, signDownload: refuse };
}

/**
 * The signer `fileRoutes` uses when no explicit one is injected:
 *   - tests → the deterministic fake (hermetic, asserts exact URLs);
 *   - a configured bucket → the real Firebase/GCS signer;
 *   - production without a bucket → refuse loudly (503), never a URL to nowhere;
 *   - anything else (a laptop) → the loopback sink, so uploads actually work.
 *
 * `PUBLIC_API_BASE_URL` names the origin a browser reaches this API on; it only
 * matters for the loopback branch and defaults to the local dev address.
 */
export function defaultStorageSigner(): StorageSigner {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (process.env.NODE_ENV === "test") return createFakeStorageSigner();
  if (bucketName) return createFirebaseStorageSigner(bucketName);
  if (process.env.NODE_ENV === "production") return createUnconfiguredStorageSigner();
  return createLoopbackStorageSigner(
    process.env.PUBLIC_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`,
  );
}
