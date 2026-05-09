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
      const parentColl = path.slice(0, path.lastIndexOf("/"));
      trackCollection(parentColl, path.split("/").pop()!);
    },
    update: async (patch: Record<string, unknown>) => {
      const cur = (docStore.get(path) ?? {}) as Record<string, unknown>;
      docStore.set(path, { ...cur, ...patch });
    },
    delete: async () => {
      docStore.delete(path);
    },
    collection: (sub: string) => makeCollection(`${path}/${sub}`),
  };
}

function makeCollection(prefix: string) {
  return {
    doc: (id: string) => makeDocRef(`${prefix}/${id}`),
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

vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (col: string) => makeCollection(col),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: async (
          ref: { set: (d: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void> },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => ref.set(data, options),
      };
      await fn(tx);
    },
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

vi.mock("./mail", () => ({
  BREVO_API_KEY: { value: () => "" },
  sendMail: vi.fn(async () => ({ skipped: true })),
}));

import { handleConfirmShareParty } from "./confirmShareApi";
import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import * as jwtLib from "jsonwebtoken";

function makeRequest(
  data: { token?: unknown; party?: unknown; jwt?: unknown },
  auth?: { uid: string; email?: string },
): CallableRequest<{ token: string; party: string; jwt?: string }> {
  return {
    data: data as { token: string; party: string; jwt?: string },
    auth: auth
      ? {
          uid: auth.uid,
          token: { email: auth.email } as Record<string, unknown>,
        }
      : undefined,
    rawRequest: {} as unknown,
    acceptsStreaming: false,
  } as unknown as CallableRequest<{ token: string; party: string; jwt?: string }>;
}

function setDocImmediate(path: string, data: DocData) {
  docStore.set(path, data);
  const idx = path.lastIndexOf("/");
  if (idx > 0) {
    const parent = path.slice(0, idx);
    const id = path.slice(idx + 1);
    trackCollection(parent, id);
  }
}

beforeEach(() => {
  docStore.clear();
  collStore.clear();
});

describe("confirmShareParty — input validation", () => {
  it("throws invalid-argument when token is missing", async () => {
    await expect(
      handleConfirmShareParty(makeRequest({ party: "Performer" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("throws invalid-argument when party is missing", async () => {
    await expect(
      handleConfirmShareParty(makeRequest({ token: "tok" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("uses HttpsError instances", async () => {
    try {
      await handleConfirmShareParty(makeRequest({}));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
    }
  });
});

describe("confirmShareParty — share-level errors", () => {
  it("throws not-found when no share doc exists", async () => {
    await expect(
      handleConfirmShareParty(makeRequest({ token: "missing", party: "Performer" })),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("throws failed-precondition for legacy shares with no access field", async () => {
    setDocImmediate("publicShares/legacy", {
      eventId: "evt-1",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });
    await expect(
      handleConfirmShareParty(
        makeRequest({ token: "legacy", party: "Performer" }, { uid: "u", email: "alice@example.com" }),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("throws failed-precondition for public shares (nothing to verify)", async () => {
    setDocImmediate("publicShares/pub", {
      access: "public",
      eventId: "evt-1",
      ownerUid: "owner-uid",
      recipients: [],
    });
    await expect(
      handleConfirmShareParty(
        makeRequest({ token: "pub", party: "Performer" }, { uid: "u", email: "alice@example.com" }),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("throws failed-precondition when share has no eventId", async () => {
    setDocImmediate("publicShares/no-event", {
      access: "protected",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });
    await expect(
      handleConfirmShareParty(
        makeRequest({ token: "no-event", party: "Performer" }, { uid: "u", email: "alice@example.com" }),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});

describe("confirmShareParty — identity verification", () => {
  it("throws permission-denied when no Firebase Auth and no JWT", async () => {
    setDocImmediate("publicShares/prot-1", {
      access: "protected",
      eventId: "evt-1",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });
    await expect(
      handleConfirmShareParty(makeRequest({ token: "prot-1", party: "Performer" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws permission-denied when Firebase Auth email matches neither participant nor team", async () => {
    setDocImmediate("publicShares/prot-2", {
      access: "protected",
      eventId: "evt-2",
      ownerUid: "owner-uid",
      recipients: [{ email: "stranger@example.com" }],
    });
    setDocImmediate("events/evt-2", { id: "evt-2", name: "Show" });
    setDocImmediate("events/evt-2/participants/perf-profile", {
      profileId: "perf-profile",
      role: "performer",
    });
    setDocImmediate("profiles/perf-profile", { id: "perf-profile" });
    setDocImmediate("profiles/perf-profile/members/uid-alice", {
      email: "alice@example.com",
    });

    await expect(
      handleConfirmShareParty(
        makeRequest(
          { token: "prot-2", party: "Performer" },
          { uid: "stranger-uid", email: "stranger@example.com" },
        ),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws permission-denied when JWT email matches neither participant nor team", async () => {
    setDocImmediate("publicShares/prot-3", {
      access: "protected",
      eventId: "evt-3",
      ownerUid: "owner-uid",
      recipients: [{ email: "stranger@example.com" }],
    });
    setDocImmediate("events/evt-3", { id: "evt-3", name: "Show" });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "prot-3", email: "stranger@example.com", iat: nowSec, exp: nowSec + 3600 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    await expect(
      handleConfirmShareParty(makeRequest({ token: "prot-3", party: "Performer", jwt: token })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws permission-denied for an expired JWT", async () => {
    setDocImmediate("publicShares/prot-4", {
      access: "protected",
      eventId: "evt-4",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "prot-4", email: "alice@example.com", iat: nowSec - 7200, exp: nowSec - 60 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );
    await expect(
      handleConfirmShareParty(makeRequest({ token: "prot-4", party: "Performer", jwt: token })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws permission-denied for a JWT whose token claim mismatches", async () => {
    setDocImmediate("publicShares/prot-5", {
      access: "protected",
      eventId: "evt-5",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "different", email: "alice@example.com", iat: nowSec, exp: nowSec + 3600 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );
    await expect(
      handleConfirmShareParty(makeRequest({ token: "prot-5", party: "Performer", jwt: token })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("confirmShareParty — success paths", () => {
  it("succeeds via Firebase Auth on the profile-member path; writes confirmations + approvals atomically", async () => {
    setDocImmediate("publicShares/ok-1", {
      access: "protected",
      eventId: "evt-10",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
    });
    setDocImmediate("events/evt-10", { id: "evt-10", name: "Show" });
    setDocImmediate("events/evt-10/participants/perf-profile", {
      profileId: "perf-profile",
      role: "performer",
    });
    setDocImmediate("profiles/perf-profile", { id: "perf-profile" });
    setDocImmediate("profiles/perf-profile/members/uid-alice", {
      email: "Alice@Example.com",
    });
    setDocImmediate("events/evt-10/settlement/main", {
      approvals: [{ party: "Venue", approved: true, date: "2026-01-01" }],
    });

    const result = await handleConfirmShareParty(
      makeRequest(
        { token: "ok-1", party: "Performer" },
        { uid: "uid-alice", email: "ALICE@example.com" },
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.verifiedEmail).toBe("alice@example.com");

    const share = docStore.get("publicShares/ok-1") as Record<string, unknown>;
    const confs = share.confirmations as Record<string, unknown>[];
    expect(Array.isArray(confs)).toBe(true);
    expect(confs).toHaveLength(1);
    expect(confs[0].party).toBe("Performer");
    expect(confs[0].email).toBe("alice@example.com");
    expect(typeof confs[0].confirmedAt).toBe("string");

    const settlement = docStore.get("events/evt-10/settlement/main") as Record<string, unknown>;
    const approvals = settlement.approvals as Record<string, unknown>[];
    expect(approvals).toHaveLength(2);
    const performerApproval = approvals.find((a) => a.party === "Performer");
    expect(performerApproval).toBeDefined();
    expect(performerApproval!.approved).toBe(true);
    expect(typeof performerApproval!.date).toBe("string");
  });

  it("succeeds via JWT on the team-member (collaborators) path", async () => {
    setDocImmediate("publicShares/ok-2", {
      access: "protected",
      eventId: "evt-20",
      ownerUid: "owner-uid",
      recipients: [{ email: "bob@example.com" }],
    });
    setDocImmediate("events/evt-20", { id: "evt-20", name: "Show" });
    // No participant matches the party; identity comes from collaborators.
    setDocImmediate("events/evt-20/collaborators/coll-1", {
      email: "Bob@Example.com",
      name: "Bob",
      eventRole: "promoter",
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const token = jwtLib.sign(
      { token: "ok-2", email: "bob@example.com", iat: nowSec, exp: nowSec + 3600 },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    const result = await handleConfirmShareParty(
      makeRequest({ token: "ok-2", party: "Promoter", jwt: token }),
    );
    expect(result.ok).toBe(true);
    expect(result.verifiedEmail).toBe("bob@example.com");

    const share = docStore.get("publicShares/ok-2") as Record<string, unknown>;
    const confs = share.confirmations as Record<string, unknown>[];
    expect(confs).toHaveLength(1);
    expect(confs[0].party).toBe("Promoter");
    expect(confs[0].email).toBe("bob@example.com");

    const settlement = docStore.get("events/evt-20/settlement/main") as Record<string, unknown>;
    const approvals = settlement.approvals as Record<string, unknown>[];
    expect(approvals).toHaveLength(1);
    expect(approvals[0].party).toBe("Promoter");
    expect(approvals[0].approved).toBe(true);
  });

  it("dedupes a repeated confirmation from the same party+email tuple", async () => {
    setDocImmediate("publicShares/dedupe", {
      access: "protected",
      eventId: "evt-30",
      ownerUid: "owner-uid",
      recipients: [{ email: "alice@example.com" }],
      confirmations: [
        { party: "Performer", email: "alice@example.com", confirmedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    setDocImmediate("events/evt-30", { id: "evt-30" });
    setDocImmediate("events/evt-30/participants/perf", {
      profileId: "perf",
      role: "performer",
    });
    setDocImmediate("profiles/perf", { id: "perf" });
    setDocImmediate("profiles/perf/members/uid-alice", { email: "alice@example.com" });

    await handleConfirmShareParty(
      makeRequest(
        { token: "dedupe", party: "Performer" },
        { uid: "uid-alice", email: "alice@example.com" },
      ),
    );

    const share = docStore.get("publicShares/dedupe") as Record<string, unknown>;
    const confs = share.confirmations as Record<string, unknown>[];
    expect(confs).toHaveLength(1);
    // Timestamp should have been refreshed to the new (later) value.
    expect(confs[0].confirmedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});
