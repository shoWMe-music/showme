import { describe, it, expect, vi, beforeEach } from "vitest";

type DocData = Record<string, unknown> | null;

const docStore = new Map<string, DocData>();
const collStore = new Map<string, Set<string>>();

function trackCollection(path: string, docId: string) {
  const set = collStore.get(path) ?? new Set<string>();
  set.add(docId);
  collStore.set(path, set);
}

function makeDocRef(path: string) {
  return {
    path,
    id: path.split("/").pop()!,
    get: async () => {
      const data = docStore.get(path);
      if (data === undefined) {
        return { exists: false, id: path.split("/").pop(), data: () => undefined };
      }
      return { exists: true, id: path.split("/").pop(), data: () => data };
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      const cur = (docStore.get(path) ?? {}) as Record<string, unknown>;
      docStore.set(path, options?.merge ? { ...cur, ...data } : { ...data });
      const idx = path.lastIndexOf("/");
      if (idx > 0) trackCollection(path.slice(0, idx), path.slice(idx + 1));
    },
    update: async (patch: Record<string, unknown>) => {
      const cur = (docStore.get(path) ?? {}) as Record<string, unknown>;
      docStore.set(path, { ...cur, ...patch });
    },
    delete: async () => {
      docStore.delete(path);
    },
    add: async (data: Record<string, unknown>) => {
      // No-op for activity log writes — not under test here.
      void data;
    },
    collection: (sub: string) => makeCollection(`${path}/${sub}`),
  };
}

function makeCollection(prefix: string) {
  return {
    doc: (id: string) => makeDocRef(`${prefix}/${id}`),
    add: async (_data: Record<string, unknown>) => ({ id: "activity-id" }),
    get: async () => {
      const ids = collStore.get(prefix) ?? new Set<string>();
      const docs = Array.from(ids)
        .map((id) => {
          const fullPath = `${prefix}/${id}`;
          const data = docStore.get(fullPath);
          if (data === undefined) return null;
          return { id, data: () => data };
        })
        .filter(Boolean) as { id: string; data: () => DocData }[];
      return { docs };
    },
  };
}

const fakeFirestore = {
  collection: (col: string) => makeCollection(col),
  runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: async (
        ref: { set: (d: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void> },
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => ref.set(data, options),
      update: async (
        ref: { update: (p: Record<string, unknown>) => Promise<void> },
        patch: Record<string, unknown>,
      ) => ref.update(patch),
    };
    await fn(tx);
  },
};

vi.mock("firebase-admin", () => {
  return {
    apps: [{}],
    initializeApp: vi.fn(),
    firestore: () => fakeFirestore,
    storage: () => ({
      bucket: () => ({
        name: "fake-bucket",
        file: () => ({
          save: async () => undefined,
        }),
      }),
    }),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "TS" },
  getFirestore: () => fakeFirestore,
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

vi.mock("firebase-functions/logger", () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const TEST_JWT_SECRET = "test-secret-please-keep-long-enough";

vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({ value: () => TEST_JWT_SECRET }),
}));

vi.mock("./mail", () => ({
  BREVO_API_KEY: { value: () => "" },
  sendMail: vi.fn(async () => ({ skipped: true })),
}));

import { submitPublicShareComment } from "./publicShares";
import { HttpsError } from "firebase-functions/v2/https";
import * as jwtLib from "jsonwebtoken";

type CommentHandler = (req: unknown) => Promise<unknown>;
const handle = submitPublicShareComment as unknown as CommentHandler;

function makeReq(
  data: Record<string, unknown>,
  auth?: { uid: string; email?: string },
) {
  return {
    data,
    auth: auth
      ? { uid: auth.uid, token: { email: auth.email } as Record<string, unknown> }
      : undefined,
    rawRequest: {} as unknown,
    acceptsStreaming: false,
  };
}

function setDocImmediate(path: string, data: DocData) {
  docStore.set(path, data);
  const idx = path.lastIndexOf("/");
  if (idx > 0) trackCollection(path.slice(0, idx), path.slice(idx + 1));
}

beforeEach(() => {
  docStore.clear();
  collStore.clear();
});

describe("submitPublicShareComment — identity gating", () => {
  it("rejects when neither Firebase Auth nor JWT identity is provided", async () => {
    setDocImmediate("publicShares/com1", {
      access: "protected",
      eventId: "evt-c1",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    await expect(
      handle(
        makeReq({
          token: "com1",
          message: "hi",
          reviewerName: "Performer",
          date: "2026-05-09",
        }),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects on a public share (failed-precondition)", async () => {
    setDocImmediate("publicShares/com2", {
      access: "public",
      eventId: "evt-c2",
      ownerUid: "owner-uid",
      recipients: [],
    });

    await expect(
      handle(
        makeReq(
          {
            token: "com2",
            message: "hi",
            reviewerName: "Performer",
            date: "2026-05-09",
          },
          { uid: "u", email: "alice@example.com" },
        ),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("accepts a verified OTP-JWT identity matched to the event team", async () => {
    setDocImmediate("publicShares/com3", {
      access: "protected",
      eventId: "evt-c3",
      ownerUid: "owner-uid",
      recipients: [{ email: "bob@example.com" }],
    });
    setDocImmediate("events/evt-c3", { id: "evt-c3" });
    setDocImmediate("events/evt-c3/collaborators/coll-1", {
      email: "Bob@Example.com",
      name: "Bob",
    });
    setDocImmediate("events/evt-c3/settlement/main", { comments: [] });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "com3", email: "bob@example.com", iat: nowSec, exp: nowSec + 3600 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    const result = await handle(
      makeReq({
        token: "com3",
        message: "Looks good.",
        reviewerName: "Bob",
        party: "Promoter",
        date: "2026-05-09",
        jwt: token,
      }),
    );
    expect(result).toEqual({ ok: true });

    const settlement = docStore.get("events/evt-c3/settlement/main") as Record<string, unknown>;
    const comments = settlement.comments as Record<string, unknown>[];
    expect(comments).toHaveLength(1);
    expect(comments[0].party).toBe("Promoter");
    expect(comments[0].email).toBe("bob@example.com");
    expect(comments[0].message).toBe("Looks good.");
  });

  it("rejects when verified email does not match any participant or team-member", async () => {
    setDocImmediate("publicShares/com4", {
      access: "protected",
      eventId: "evt-c4",
      ownerUid: "owner-uid",
      recipients: [{ email: "stranger@example.com" }],
    });
    setDocImmediate("events/evt-c4", { id: "evt-c4" });
    setDocImmediate("events/evt-c4/settlement/main", { comments: [] });

    await expect(
      handle(
        makeReq(
          {
            token: "com4",
            message: "hello",
            reviewerName: "Stranger",
            date: "2026-05-09",
          },
          { uid: "u", email: "stranger@example.com" },
        ),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("uses HttpsError instances on validation failure", async () => {
    try {
      await handle(makeReq({ token: "" }));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
    }
  });
});
