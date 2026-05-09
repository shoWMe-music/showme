import { describe, it, expect, vi, beforeEach } from "vitest";

type DocData = Record<string, unknown> | null;

const docStore = new Map<string, DocData>();

const mockGet = vi.fn(async (path: string) => {
  const data = docStore.get(path);
  if (data === undefined) {
    return { exists: false, id: path.split("/").pop(), data: () => undefined };
  }
  return { exists: true, id: path.split("/").pop(), data: () => data };
});

vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: () => mockGet(`${col}/${id}`),
      }),
    }),
  }),
}));

vi.mock("firebase-functions/v2/https", async () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    HttpsError,
    onCall: (_opts: unknown, handler: unknown) => handler,
  };
});

const TEST_JWT_SECRET = "test-secret-please-keep-long-enough";

vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({
    value: () => TEST_JWT_SECRET,
  }),
}));

vi.mock("./mail", () => ({
  BREVO_API_KEY: { value: () => "" },
  sendMail: vi.fn(async () => ({ skipped: true })),
}));

import { handleGetPublicShare } from "./publicShareApi";
import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import * as jwtLib from "jsonwebtoken";

function makeRequest(
  data: { token?: unknown; jwt?: unknown },
  auth?: { uid: string; email?: string },
): CallableRequest<{ token: string; jwt?: string }> {
  return {
    data: data as { token: string; jwt?: string },
    auth: auth
      ? {
          uid: auth.uid,
          token: { email: auth.email } as Record<string, unknown>,
        }
      : undefined,
    rawRequest: {} as unknown,
    acceptsStreaming: false,
  } as unknown as CallableRequest<{ token: string; jwt?: string }>;
}

beforeEach(() => {
  docStore.clear();
  mockGet.mockClear();
});

describe("getPublicShare", () => {
  it("throws invalid-argument when token is missing", async () => {
    await expect(
      handleGetPublicShare(makeRequest({})),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("throws invalid-argument when token is empty string", async () => {
    await expect(
      handleGetPublicShare(makeRequest({ token: "   " })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("throws not-found when the share doc does not exist", async () => {
    await expect(
      handleGetPublicShare(makeRequest({ token: "missing" })),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("returns the share immediately when access is public — no auth required", async () => {
    docStore.set("publicShares/pub-1", {
      access: "public",
      eventId: "EVT-1",
      ownerUid: "owner-uid",
      recipients: [],
      snapshot: { event: { name: "Show" } },
    });

    const result = await handleGetPublicShare(makeRequest({ token: "pub-1" }));

    expect(result.share.id).toBe("pub-1");
    expect(result.share.access).toBe("public");
    expect((result.share.snapshot as Record<string, unknown>).event).toEqual({
      name: "Show",
    });
  });

  it("throws permission-denied when access is protected and caller email is not a recipient", async () => {
    docStore.set("publicShares/prot-1", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    await expect(
      handleGetPublicShare(
        makeRequest({ token: "prot-1" }, { uid: "rando-uid", email: "bob@example.com" }),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws permission-denied when access is protected and caller is unauthenticated", async () => {
    docStore.set("publicShares/prot-2", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    await expect(
      handleGetPublicShare(makeRequest({ token: "prot-2" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("returns share when access is protected and caller email matches a recipient (case-insensitive)", async () => {
    docStore.set("publicShares/prot-3", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "Alice@Example.com" }],
      snapshot: { event: { name: "Match" } },
    });

    const result = await handleGetPublicShare(
      makeRequest({ token: "prot-3" }, { uid: "alice-uid", email: "ALICE@example.com" }),
    );

    expect(result.share.id).toBe("prot-3");
  });

  it("returns share when access is protected and caller is the owner", async () => {
    docStore.set("publicShares/prot-4", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    const result = await handleGetPublicShare(
      makeRequest({ token: "prot-4" }, { uid: "owner-uid", email: "owner@example.com" }),
    );

    expect(result.share.id).toBe("prot-4");
  });

  it("treats absent access field as protected (legacy compat) — owner can still read", async () => {
    docStore.set("publicShares/legacy-1", {
      ownerUid: "owner-uid",
      recipients: [],
      snapshot: { event: { name: "Legacy" } },
    });

    const result = await handleGetPublicShare(
      makeRequest({ token: "legacy-1" }, { uid: "owner-uid" }),
    );
    expect(result.share.id).toBe("legacy-1");

    await expect(
      handleGetPublicShare(makeRequest({ token: "legacy-1" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects an obviously malformed jwt with permission-denied", async () => {
    docStore.set("publicShares/prot-5", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    await expect(
      handleGetPublicShare(makeRequest({ token: "prot-5", jwt: "fake.jwt.value" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("accepts a valid OTP-JWT for a recipient (no Firebase Auth user required)", async () => {
    docStore.set("publicShares/jwt-1", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
      snapshot: { event: { name: "JWT Show" } },
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "jwt-1", email: "alice@example.com", iat: nowSec, exp: nowSec + 3600 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    const result = await handleGetPublicShare(
      makeRequest({ token: "jwt-1", jwt: token }),
    );
    expect(result.share.id).toBe("jwt-1");
  });

  it("rejects a JWT whose token claim does not match the requested token", async () => {
    docStore.set("publicShares/jwt-2", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "different-token", email: "alice@example.com", iat: nowSec, exp: nowSec + 3600 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    await expect(
      handleGetPublicShare(makeRequest({ token: "jwt-2", jwt: token })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects an expired JWT", async () => {
    docStore.set("publicShares/jwt-3", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "jwt-3", email: "alice@example.com", iat: nowSec - 7200, exp: nowSec - 60 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    await expect(
      handleGetPublicShare(makeRequest({ token: "jwt-3", jwt: token })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects a JWT whose email claim is not in the recipient list", async () => {
    docStore.set("publicShares/jwt-4", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "jwt-4", email: "stranger@example.com", iat: nowSec, exp: nowSec + 3600 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    await expect(
      handleGetPublicShare(makeRequest({ token: "jwt-4", jwt: token })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("strips otp subcollection data if it leaks into the doc body", async () => {
    docStore.set("publicShares/pub-2", {
      access: "public",
      ownerUid: "owner-uid",
      recipients: [],
      otp: { "abc": { codeHash: "secret" } },
    });

    const result = await handleGetPublicShare(makeRequest({ token: "pub-2" }));
    expect("otp" in result.share).toBe(false);
  });

  it("uses HttpsError instances", async () => {
    try {
      await handleGetPublicShare(makeRequest({}));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
    }
  });
});
