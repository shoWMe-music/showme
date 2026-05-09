/**
 * Integration tests for db.ts functions.
 *
 * These test the actual function logic by mocking the Firestore SDK.
 * For full end-to-end tests against the emulator, use `npm run test:integration`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Firebase modules before importing db functions
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ id: "mock-doc" });
const mockCollection = vi.fn().mockReturnValue({});
const mockQuery = vi.fn().mockReturnValue({});
const mockWhere = vi.fn().mockReturnValue({});
const mockOrderBy = vi.fn().mockReturnValue({});
const mockServerTimestamp = vi.fn().mockReturnValue("TIMESTAMP");

const { mockCallable, mockHttpsCallable } = vi.hoisted(() => {
  const callable = vi.fn();
  return {
    mockCallable: callable,
    mockHttpsCallable: vi.fn().mockReturnValue(callable),
  };
});

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  serverTimestamp: () => mockServerTimestamp(),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  Timestamp: { now: () => ({ toDate: () => new Date() }) },
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockHttpsCallable,
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirestoreDb: vi.fn().mockReturnValue({}),
  getFirebaseFunctions: vi.fn().mockReturnValue({ __functions: true }),
}));

vi.mock("@/lib/firebaseAuth", () => ({
  getAuthClient: vi.fn().mockReturnValue({
    currentUser: { uid: "test-user-123", email: "test@example.com" },
  }),
}));

// Now import the functions under test
import {
  cacheShareJwt,
  callConfirmShareParty,
  callPublicShareGet,
  callRequestShareOtp,
  callSubmitPublicShareComment,
  callVerifyShareOtp,
  clearShareJwt,
  createPublicEventShare,
  fetchPublicShareByToken,
  insertShareTokenRow,
  ShareAuthRequiredError,
} from "./db";

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
  }
});

// ---------------------------------------------------------------------------
// createPublicEventShare
// ---------------------------------------------------------------------------

describe("createPublicEventShare", () => {
  it("writes share document with correct structure", async () => {
    await createPublicEventShare("token-abc", {
      eventId: "EVT-001",
      access: "protected",
      recipients: [{ email: "user@test.com" }],
      snapshotData: { event: { name: "Test" } },
      sections: ["event-info", "deal-structure"],
      tabs: ["details"],
      level: "sections",
      creatorName: "Daniel",
    });

    expect(mockSetDoc).toHaveBeenCalled();
    const [, data] = mockSetDoc.mock.calls[0];
    expect(data.kind).toBe("event_snapshot");
    expect(data.eventId).toBe("EVT-001");
    expect(data.access).toBe("protected");
    expect(data.recipients).toEqual([{ email: "user@test.com" }]);
    expect(data.creatorName).toBe("Daniel");
    expect(data.ownerUid).toBe("test-user-123");
    expect(data.snapshotData).toEqual({ event: { name: "Test" } });
  });

  it("persists access='public' with empty recipients for public links", async () => {
    await createPublicEventShare("token-public", {
      eventId: "EVT-002",
      access: "public",
      recipients: [],
      snapshotData: {},
      sections: [],
      tabs: ["details"],
      level: "all",
      creatorName: "Operator",
    });

    const [, data] = mockSetDoc.mock.calls[0];
    expect(data.access).toBe("public");
    expect(data.recipients).toEqual([]);
  });

  // Regression: nested `undefined` values in snapshotData were causing Firestore
  // to reject the write, which silently broke /shared/event/$eventId share-link
  // generation for any event with optional fields unset (e.g. ticketingProvider
  // on a draft). The payload must be deeply scrubbed before writing.
  it("strips deeply nested undefined values from snapshotData", async () => {
    await createPublicEventShare("token-with-undefined", {
      eventId: "EVT-003",
      access: "public",
      recipients: [],
      snapshotData: {
        event: {
          id: "EVT-003",
          name: "Draft Event",
          date: "2026-05-10",
          venue: "Hall",
          ticketingProvider: undefined, // common on drafts
          eventStatus: "draft",
        },
        deal: { dealType: "guarantee", artistGuarantee: 1000, customField: undefined },
        revenue: undefined,
      },
      sections: [],
      tabs: ["details"],
      level: "all",
      creatorName: "Operator",
    });

    const [, data] = mockSetDoc.mock.calls[0];
    const snap = data.snapshotData as Record<string, unknown>;
    // Deep scrub must drop undefined keys (top-level and nested) so Firestore
    // accepts the write.
    expect(snap).not.toHaveProperty("revenue");
    expect((snap.event as Record<string, unknown>)).not.toHaveProperty("ticketingProvider");
    expect((snap.deal as Record<string, unknown>)).not.toHaveProperty("customField");
    // Defined fields must still be present.
    expect((snap.event as Record<string, unknown>).name).toBe("Draft Event");
    expect((snap.deal as Record<string, unknown>).artistGuarantee).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// fetchPublicShareByToken
// ---------------------------------------------------------------------------

describe("fetchPublicShareByToken", () => {
  it("returns share data when callable resolves", async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        share: {
          kind: "event_snapshot",
          eventId: "EVT-001",
          recipients: ["a@b.com"],
          snapshotData: { event: { name: "Gig" } },
        },
      },
    });

    const result = await fetchPublicShareByToken("some-token");
    expect(mockHttpsCallable).toHaveBeenCalledWith({ __functions: true }, "getPublicShare");
    expect(mockCallable).toHaveBeenCalledWith({ token: "some-token", jwt: undefined });
    expect(result).toBeTruthy();
    expect(result?.kind).toBe("event_snapshot");
    expect(result?.eventId).toBe("EVT-001");
    expect(result?.recipients).toEqual(["a@b.com"]);
  });

  it("returns null when callable throws not-found", async () => {
    mockCallable.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "functions/not-found" }));

    const result = await fetchPublicShareByToken("bad-token");
    expect(result).toBeNull();
  });

  it("throws ShareAuthRequiredError when callable rejects with permission-denied", async () => {
    mockCallable.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "functions/permission-denied" }));

    await expect(fetchPublicShareByToken("locked-token")).rejects.toBeInstanceOf(ShareAuthRequiredError);
  });

  it("propagates other callable errors (e.g. internal)", async () => {
    mockCallable.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "functions/internal" }));

    await expect(fetchPublicShareByToken("broken-token")).rejects.toThrow("boom");
  });

  it("parses wire-serialised Firestore Timestamp into updatedAtMs", async () => {
    mockCallable.mockResolvedValueOnce({
      data: { share: { updatedAt: { _seconds: 1700000000, _nanoseconds: 500_000_000 } } },
    });

    const result = await fetchPublicShareByToken("ts-token");
    expect(result?.updatedAtMs).toBe(1700000000 * 1000 + 500);
  });
});

// ---------------------------------------------------------------------------
// insertShareTokenRow (budget/todo share)
// ---------------------------------------------------------------------------

describe("insertShareTokenRow", () => {
  it("writes to both user subcollection and publicShares", async () => {
    await insertShareTokenRow({
      token: "share-token-123",
      event_id: "EVT-001",
      parties: { type: "budget", data: [] },
    });

    // Should call setDoc twice (user doc + public doc)
    expect(mockSetDoc).toHaveBeenCalledTimes(2);

    // First call: user's share_tokens subcollection
    const [, userData] = mockSetDoc.mock.calls[0];
    expect(userData.token).toBe("share-token-123");
    expect(userData.eventId).toBe("EVT-001");

    // Second call: publicShares collection
    const [, publicData] = mockSetDoc.mock.calls[1];
    expect(publicData.kind).toBe("budget");
    expect(publicData.ownerUid).toBe("test-user-123");
    expect(publicData.eventId).toBe("EVT-001");
  });

  it("includes parties data in both documents", async () => {
    const todoData = {
      type: "todo-schedule",
      eventName: "Festival",
      todos: [{ id: "t1", title: "Sound check", completed: false }],
    };

    await insertShareTokenRow({
      token: "todo-share",
      event_id: "EVT-002",
      parties: todoData,
    });

    const [, userData] = mockSetDoc.mock.calls[0];
    expect(userData.parties).toEqual(todoData);

    const [, publicData] = mockSetDoc.mock.calls[1];
    expect(publicData.parties).toEqual(todoData);
  });

  it("throws when user is not authenticated", async () => {
    const { getAuthClient } = await import("@/lib/firebaseAuth");
    vi.mocked(getAuthClient).mockReturnValueOnce({
      currentUser: null,
    } as any);

    await expect(
      insertShareTokenRow({ token: "t", event_id: "e", parties: {} }),
    ).rejects.toThrow("signed in");
  });

  // Regression: nested undefined values in `parties` were causing Firestore
  // to reject the write, silently breaking /shared/budget share-link
  // generation for events with unset optional fields (e.g. venue/date on a
  // draft).
  it("strips deeply nested undefined values from parties", async () => {
    await insertShareTokenRow({
      token: "share-with-undefined",
      event_id: "EVT-DRAFT",
      parties: {
        eventName: "Draft Event",
        eventVenue: undefined,
        eventDate: undefined,
        revenueFields: [
          { id: "tickets", name: "Tickets", value: 1000, note: undefined },
        ],
        costFields: [],
        resultFields: [],
        generatedAt: "2026-04-29T00:00:00.000Z",
      },
    });

    // Both the user-doc write and the publicShares write must receive
    // scrubbed `parties` data.
    const [, userData] = mockSetDoc.mock.calls[0];
    const [, publicData] = mockSetDoc.mock.calls[1];
    const userParties = userData.parties as Record<string, unknown>;
    const publicParties = publicData.parties as Record<string, unknown>;

    expect(userParties).not.toHaveProperty("eventVenue");
    expect(userParties).not.toHaveProperty("eventDate");
    expect(publicParties).not.toHaveProperty("eventVenue");
    expect(publicParties).not.toHaveProperty("eventDate");
    expect((userParties.revenueFields as Array<Record<string, unknown>>)[0]).not.toHaveProperty("note");
    // Defined fields must still be present.
    expect(userParties.eventName).toBe("Draft Event");
    expect(publicParties.eventName).toBe("Draft Event");
  });
});

// ---------------------------------------------------------------------------
// callPublicShareGet (callable wrapper)
// ---------------------------------------------------------------------------

describe("callPublicShareGet", () => {
  it("invokes the getPublicShare callable with the token and returns its data", async () => {
    mockCallable.mockResolvedValueOnce({ data: { share: { kind: "settlement_review" } } });

    const result = await callPublicShareGet("tok-1");

    expect(mockHttpsCallable).toHaveBeenCalledWith({ __functions: true }, "getPublicShare");
    expect(mockCallable).toHaveBeenCalledWith({ token: "tok-1", jwt: undefined });
    expect(result).toEqual({ share: { kind: "settlement_review" } });
  });

  it("forwards the optional jwt argument", async () => {
    mockCallable.mockResolvedValueOnce({ data: { share: null } });

    await callPublicShareGet("tok-2", "jwt-xyz");

    expect(mockCallable).toHaveBeenCalledWith({ token: "tok-2", jwt: "jwt-xyz" });
  });

  it("auto-attaches a cached JWT from sessionStorage when none is passed", async () => {
    cacheShareJwt("tok-cached", "cached-jwt-value");
    mockCallable.mockResolvedValueOnce({ data: { share: null } });

    await callPublicShareGet("tok-cached");

    expect(mockCallable).toHaveBeenCalledWith({ token: "tok-cached", jwt: "cached-jwt-value" });
  });

  it("explicit jwt argument wins over the cached value", async () => {
    cacheShareJwt("tok-cached-2", "cached-jwt");
    mockCallable.mockResolvedValueOnce({ data: { share: null } });

    await callPublicShareGet("tok-cached-2", "explicit-jwt");

    expect(mockCallable).toHaveBeenCalledWith({ token: "tok-cached-2", jwt: "explicit-jwt" });
  });

  it("clearShareJwt removes the cached JWT so subsequent calls send undefined", async () => {
    cacheShareJwt("tok-clear", "to-be-cleared");
    clearShareJwt("tok-clear");
    mockCallable.mockResolvedValueOnce({ data: { share: null } });

    await callPublicShareGet("tok-clear");

    expect(mockCallable).toHaveBeenCalledWith({ token: "tok-clear", jwt: undefined });
  });
});

// ---------------------------------------------------------------------------
// callRequestShareOtp + callVerifyShareOtp (OTP wrappers)
// ---------------------------------------------------------------------------

describe("callRequestShareOtp", () => {
  it("invokes requestShareOtp with the token + email", async () => {
    mockCallable.mockResolvedValueOnce({ data: { ok: true } });

    await callRequestShareOtp("tok-otp", "alice@test.com");

    expect(mockHttpsCallable).toHaveBeenCalledWith({ __functions: true }, "requestShareOtp");
    expect(mockCallable).toHaveBeenCalledWith({ token: "tok-otp", email: "alice@test.com" });
  });

  it("propagates callable errors (e.g. resource-exhausted)", async () => {
    mockCallable.mockRejectedValueOnce(
      Object.assign(new Error("limit"), { code: "functions/resource-exhausted" }),
    );

    await expect(callRequestShareOtp("tok-otp", "alice@test.com")).rejects.toThrow("limit");
  });
});

describe("callVerifyShareOtp", () => {
  it("invokes verifyShareOtp with token+email+code and returns the JWT", async () => {
    mockCallable.mockResolvedValueOnce({ data: { jwt: "signed.jwt.value" } });

    const result = await callVerifyShareOtp("tok-otp", "bob@test.com", "123456");

    expect(mockHttpsCallable).toHaveBeenCalledWith({ __functions: true }, "verifyShareOtp");
    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-otp",
      email: "bob@test.com",
      code: "123456",
    });
    expect(result).toEqual({ jwt: "signed.jwt.value" });
  });
});

// ---------------------------------------------------------------------------
// callConfirmShareParty (callable wrapper)
// ---------------------------------------------------------------------------

describe("callConfirmShareParty", () => {
  it("invokes confirmShareParty with token+party and returns the verified email", async () => {
    mockCallable.mockResolvedValueOnce({
      data: { ok: true, verifiedEmail: "bob@example.com" },
    });

    const result = await callConfirmShareParty("tok-cp", "Promoter");

    expect(mockHttpsCallable).toHaveBeenCalledWith({ __functions: true }, "confirmShareParty");
    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-cp",
      party: "Promoter",
      jwt: undefined,
    });
    expect(result).toEqual({ verifiedEmail: "bob@example.com" });
  });

  it("forwards the optional jwt argument when supplied", async () => {
    mockCallable.mockResolvedValueOnce({
      data: { ok: true, verifiedEmail: "bob@example.com" },
    });

    await callConfirmShareParty("tok-cp", "Promoter", "explicit-jwt");

    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-cp",
      party: "Promoter",
      jwt: "explicit-jwt",
    });
  });

  it("auto-attaches a cached JWT from sessionStorage when none is passed", async () => {
    cacheShareJwt("tok-cp-cached", "cached-jwt-value");
    mockCallable.mockResolvedValueOnce({
      data: { ok: true, verifiedEmail: "bob@example.com" },
    });

    await callConfirmShareParty("tok-cp-cached", "Performer");

    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-cp-cached",
      party: "Performer",
      jwt: "cached-jwt-value",
    });
  });

  it("explicit jwt argument wins over the cached value", async () => {
    cacheShareJwt("tok-cp-cached-2", "cached-jwt");
    mockCallable.mockResolvedValueOnce({
      data: { ok: true, verifiedEmail: "bob@example.com" },
    });

    await callConfirmShareParty("tok-cp-cached-2", "Performer", "explicit-jwt");

    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-cp-cached-2",
      party: "Performer",
      jwt: "explicit-jwt",
    });
  });

  it("propagates callable errors (e.g. permission-denied)", async () => {
    mockCallable.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "functions/permission-denied" }),
    );

    await expect(callConfirmShareParty("tok-cp", "Promoter")).rejects.toThrow("denied");
  });
});

// ---------------------------------------------------------------------------
// callSubmitPublicShareComment (callable wrapper)
// ---------------------------------------------------------------------------

describe("callSubmitPublicShareComment", () => {
  it("invokes submitPublicShareComment with the args and an undefined jwt by default", async () => {
    mockCallable.mockResolvedValueOnce({ data: { ok: true } });

    await callSubmitPublicShareComment({
      token: "tok-sc",
      message: "Looks good.",
      reviewerName: "Bob",
      date: "2026-05-09",
      party: "Promoter",
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { __functions: true },
      "submitPublicShareComment",
    );
    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-sc",
      message: "Looks good.",
      reviewerName: "Bob",
      date: "2026-05-09",
      party: "Promoter",
      jwt: undefined,
    });
  });

  it("auto-attaches a cached JWT from sessionStorage when none is passed", async () => {
    cacheShareJwt("tok-sc-cached", "cached-jwt-value");
    mockCallable.mockResolvedValueOnce({ data: { ok: true } });

    await callSubmitPublicShareComment({
      token: "tok-sc-cached",
      message: "Hi",
      reviewerName: "Bob",
      date: "2026-05-09",
    });

    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-sc-cached",
      message: "Hi",
      reviewerName: "Bob",
      date: "2026-05-09",
      jwt: "cached-jwt-value",
    });
  });

  it("explicit jwt wins over cached value", async () => {
    cacheShareJwt("tok-sc-cached-2", "cached-jwt");
    mockCallable.mockResolvedValueOnce({ data: { ok: true } });

    await callSubmitPublicShareComment({
      token: "tok-sc-cached-2",
      message: "Hi",
      reviewerName: "Bob",
      date: "2026-05-09",
      jwt: "explicit-jwt",
    });

    expect(mockCallable).toHaveBeenCalledWith({
      token: "tok-sc-cached-2",
      message: "Hi",
      reviewerName: "Bob",
      date: "2026-05-09",
      jwt: "explicit-jwt",
    });
  });
});
