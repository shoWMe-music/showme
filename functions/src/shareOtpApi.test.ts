import { describe, it, expect, vi, beforeEach } from "vitest";

type DocData = Record<string, unknown> | null;

const docStore = new Map<string, DocData>();
const writeLog: { op: string; path: string; data?: unknown }[] = [];

function makeDocRef(path: string) {
  return {
    get: async () => {
      const data = docStore.get(path);
      if (data === undefined) {
        return { exists: false, id: path.split("/").pop(), data: () => undefined };
      }
      return { exists: true, id: path.split("/").pop(), data: () => data };
    },
    set: async (data: Record<string, unknown>) => {
      writeLog.push({ op: "set", path, data });
      docStore.set(path, data);
    },
    update: async (patch: Record<string, unknown>) => {
      writeLog.push({ op: "update", path, data: patch });
      const cur = (docStore.get(path) ?? {}) as Record<string, unknown>;
      docStore.set(path, { ...cur, ...patch });
    },
    delete: async () => {
      writeLog.push({ op: "delete", path });
      docStore.delete(path);
    },
    collection: (sub: string) => makeCollection(`${path}/${sub}`),
  };
}

function makeCollection(prefix: string) {
  return {
    doc: (id: string) => makeDocRef(`${prefix}/${id}`),
  };
}

vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (col: string) => makeCollection(col),
  }),
}));

vi.mock("firebase-functions/v2/https", () => {
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

const sendMailMock = vi.fn(async (_opts: unknown) => ({ skipped: true }));
vi.mock("./mail", () => ({
  BREVO_API_KEY: { value: () => "" },
  sendMail: (...args: unknown[]) => sendMailMock(args[0]),
}));

import {
  handleRequestShareOtp,
  handleVerifyShareOtp,
} from "./shareOtpApi";
import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import * as jwtLib from "jsonwebtoken";
import { createHash } from "node:crypto";

function emailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

function makeReq<T>(data: T): CallableRequest<T> {
  return {
    data,
    auth: undefined,
    rawRequest: {} as unknown,
    acceptsStreaming: false,
  } as unknown as CallableRequest<T>;
}

beforeEach(() => {
  docStore.clear();
  writeLog.length = 0;
  sendMailMock.mockClear();
});

describe("requestShareOtp", () => {
  it("throws invalid-argument when token is missing", async () => {
    await expect(
      handleRequestShareOtp(makeReq({ token: "", email: "alice@example.com" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("throws invalid-argument when email is malformed", async () => {
    await expect(
      handleRequestShareOtp(makeReq({ token: "tok", email: "not-an-email" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("throws permission-denied when share is missing", async () => {
    await expect(
      handleRequestShareOtp(makeReq({ token: "missing", email: "alice@example.com" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws permission-denied when email is not in recipients", async () => {
    docStore.set("publicShares/share-1", {
      eventId: "ev1",
      recipients: [{ email: "alice@example.com" }],
    });

    await expect(
      handleRequestShareOtp(makeReq({ token: "share-1", email: "bob@example.com" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("writes an OTP doc and sends mail when email is a recipient", async () => {
    docStore.set("publicShares/share-2", {
      eventId: "ev1",
      recipients: [{ email: "Alice@Example.com" }],
    });
    docStore.set("events/ev1", { name: "Test Show" });

    const result = await handleRequestShareOtp(
      makeReq({ token: "share-2", email: "alice@example.com" }),
    );
    expect(result).toEqual({ ok: true });
    const otpPath = `publicShares/share-2/otp/${emailHash("alice@example.com")}`;
    const stored = docStore.get(otpPath) as Record<string, unknown>;
    expect(stored).toBeDefined();
    expect(typeof stored.codeHash).toBe("string");
    expect(typeof stored.salt).toBe("string");
    expect(stored.attempts).toBe(0);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("rate-limits to 3 codes per email per rolling hour", async () => {
    docStore.set("publicShares/share-3", {
      eventId: "ev1",
      recipients: [{ email: "alice@example.com" }],
    });

    for (let i = 0; i < 3; i++) {
      await handleRequestShareOtp(
        makeReq({ token: "share-3", email: "alice@example.com" }),
      );
    }

    await expect(
      handleRequestShareOtp(makeReq({ token: "share-3", email: "alice@example.com" })),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("resets the rate window after one hour", async () => {
    docStore.set("publicShares/share-4", {
      eventId: "ev1",
      recipients: [{ email: "alice@example.com" }],
    });

    const otpPath = `publicShares/share-4/otp/${emailHash("alice@example.com")}`;
    const longAgo = Date.now() - 2 * 60 * 60 * 1000;
    docStore.set(otpPath, {
      codeHash: "old",
      salt: "old",
      expiresAt: longAgo + 1000,
      attempts: 0,
      createdAt: longAgo,
      rateWindow: { startedAt: longAgo, count: 3 },
    });

    const result = await handleRequestShareOtp(
      makeReq({ token: "share-4", email: "alice@example.com" }),
    );
    expect(result).toEqual({ ok: true });
    const stored = docStore.get(otpPath) as Record<string, unknown>;
    const rw = stored.rateWindow as { count: number };
    expect(rw.count).toBe(1);
  });
});

describe("verifyShareOtp", () => {
  function seedShare(token: string, email: string) {
    docStore.set(`publicShares/${token}`, {
      eventId: "ev1",
      recipients: [{ email }],
    });
  }

  async function seedOtp(token: string, email: string, code: string, overrides?: Partial<Record<string, unknown>>) {
    seedShare(token, email);
    await handleRequestShareOtp(makeReq({ token, email }));
    const otpPath = `publicShares/${token}/otp/${emailHash(email)}`;
    const stored = docStore.get(otpPath) as Record<string, unknown>;
    if (overrides) {
      docStore.set(otpPath, { ...stored, ...overrides });
    }
    // Recompute codeHash for the requested code so tests can assert success.
    const salt = (overrides?.salt as string | undefined) ?? (stored.salt as string);
    const computed = createHash("sha256").update(`${salt}:${code}`).digest("hex");
    docStore.set(otpPath, { ...(docStore.get(otpPath) as Record<string, unknown>), codeHash: computed, salt });
  }

  it("throws not-found when no OTP doc exists", async () => {
    await expect(
      handleVerifyShareOtp(makeReq({ token: "nope", email: "alice@example.com", code: "123456" })),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("throws not-found and deletes the doc when expired", async () => {
    await seedOtp("share-v1", "alice@example.com", "123456");
    const otpPath = `publicShares/share-v1/otp/${emailHash("alice@example.com")}`;
    const stored = docStore.get(otpPath) as Record<string, unknown>;
    docStore.set(otpPath, { ...stored, expiresAt: Date.now() - 1000 });

    await expect(
      handleVerifyShareOtp(makeReq({ token: "share-v1", email: "alice@example.com", code: "123456" })),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(docStore.has(otpPath)).toBe(false);
  });

  it("increments attempts on wrong code and throws permission-denied", async () => {
    await seedOtp("share-v2", "alice@example.com", "123456");
    const otpPath = `publicShares/share-v2/otp/${emailHash("alice@example.com")}`;

    await expect(
      handleVerifyShareOtp(makeReq({ token: "share-v2", email: "alice@example.com", code: "000000" })),
    ).rejects.toMatchObject({ code: "permission-denied" });

    const stored = docStore.get(otpPath) as Record<string, unknown>;
    expect(stored.attempts).toBe(1);
  });

  it("deletes the doc on the 5th wrong attempt", async () => {
    await seedOtp("share-v3", "alice@example.com", "123456");
    const otpPath = `publicShares/share-v3/otp/${emailHash("alice@example.com")}`;

    for (let i = 0; i < 5; i++) {
      await expect(
        handleVerifyShareOtp(makeReq({ token: "share-v3", email: "alice@example.com", code: "000000" })),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
    expect(docStore.has(otpPath)).toBe(false);
  });

  it("throws resource-exhausted when attempts already at max", async () => {
    await seedOtp("share-v4", "alice@example.com", "123456", { attempts: 5 });
    const otpPath = `publicShares/share-v4/otp/${emailHash("alice@example.com")}`;

    await expect(
      handleVerifyShareOtp(makeReq({ token: "share-v4", email: "alice@example.com", code: "123456" })),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(docStore.has(otpPath)).toBe(false);
  });

  it("returns a JWT and deletes the OTP doc on a correct code", async () => {
    await seedOtp("share-v5", "alice@example.com", "123456");
    const otpPath = `publicShares/share-v5/otp/${emailHash("alice@example.com")}`;

    const result = await handleVerifyShareOtp(
      makeReq({ token: "share-v5", email: "alice@example.com", code: "123456" }),
    );
    expect(typeof result.jwt).toBe("string");
    expect(docStore.has(otpPath)).toBe(false);

    const decoded = jwtLib.verify(result.jwt, TEST_JWT_SECRET, { algorithms: ["HS256"] }) as Record<string, unknown>;
    expect(decoded.token).toBe("share-v5");
    expect(decoded.email).toBe("alice@example.com");
    expect(typeof decoded.exp).toBe("number");
  });

  it("uses HttpsError instances", async () => {
    try {
      await handleVerifyShareOtp(makeReq({ token: "", email: "alice@example.com", code: "123" }));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
    }
  });
});
