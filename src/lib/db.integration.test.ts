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

vi.mock("@/integrations/firebase/app", () => ({
  getFirestoreDb: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/firebaseAuth", () => ({
  getAuthClient: vi.fn().mockReturnValue({
    currentUser: { uid: "test-user-123", email: "test@example.com" },
  }),
}));

// Now import the functions under test
import {
  createPublicEventShare,
  fetchPublicShareByToken,
  insertShareTokenRow,
} from "./db";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createPublicEventShare
// ---------------------------------------------------------------------------

describe("createPublicEventShare", () => {
  it("writes share document with correct structure", async () => {
    await createPublicEventShare("token-abc", {
      eventId: "EVT-001",
      recipients: ["user@test.com"],
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
    expect(data.recipients).toEqual(["user@test.com"]);
    expect(data.creatorName).toBe("Daniel");
    expect(data.ownerUid).toBe("test-user-123");
    expect(data.snapshotData).toEqual({ event: { name: "Test" } });
  });

  it("stores empty recipients array for public links", async () => {
    await createPublicEventShare("token-public", {
      eventId: "EVT-002",
      recipients: [],
      snapshotData: {},
      sections: [],
      tabs: ["details"],
      level: "all",
      creatorName: "Operator",
    });

    const [, data] = mockSetDoc.mock.calls[0];
    expect(data.recipients).toEqual([]);
  });

  // Regression: nested `undefined` values in snapshotData were causing Firestore
  // to reject the write, which silently broke /shared/event/$eventId share-link
  // generation for any event with optional fields unset (e.g. ticketingProvider
  // on a draft). The payload must be deeply scrubbed before writing.
  it("strips deeply nested undefined values from snapshotData", async () => {
    await createPublicEventShare("token-with-undefined", {
      eventId: "EVT-003",
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
  it("returns share data when document exists", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        kind: "event_snapshot",
        eventId: "EVT-001",
        recipients: ["a@b.com"],
        snapshotData: { event: { name: "Gig" } },
      }),
    });

    const result = await fetchPublicShareByToken("some-token");
    expect(result).toBeTruthy();
    expect(result?.kind).toBe("event_snapshot");
    expect(result?.eventId).toBe("EVT-001");
    expect(result?.recipients).toEqual(["a@b.com"]);
  });

  it("returns null when document does not exist", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => false,
    });

    const result = await fetchPublicShareByToken("bad-token");
    expect(result).toBeNull();
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
});
