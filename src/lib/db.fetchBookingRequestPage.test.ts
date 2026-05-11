/**
 * Pins the access-filter contract for `fetchBookingRequestPage` and friends:
 *
 * The Firestore rule allows reads via two paths — `uid == owner_uid` (legacy /
 * owner) and `target_profile_id in token.profileIds` (admin/member). For a
 * list query, Firestore validates the rule **statically** against the query
 * shape, so the query must include the matching filter on EACH disjunct.
 *
 * The query is therefore `or(owner_uid == uid, target_profile_id in [...])`.
 * When the caller has no profile-id list yet (claim still loading), the query
 * degrades to just `owner_uid == uid` so the owner still sees their own docs.
 *
 * Regressions to watch for:
 *   • Dropping the `owner_uid` disjunct → owners can't see docs when the claim
 *     hasn't been populated yet (cold-start + new-user races).
 *   • Dropping the `target_profile_id` disjunct → venue admins lose access
 *     (the original Wave 8 bug we're fixing).
 *   • Sending more than 29 profile ids to the inner `in` → Firestore caps `or`
 *     subqueries at 30 disjuncts in total; the `owner_uid ==` clause uses 1, so
 *     the `in` array can carry at most 29.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDocs = vi.fn();
const mockWhere = vi.fn().mockImplementation((field: string, op: string, value: unknown) => ({
  _where: { field, op, value },
}));
const mockOr = vi.fn().mockImplementation((...clauses: unknown[]) => ({ _or: clauses }));
const mockOrderBy = vi.fn().mockReturnValue({});
const mockQuery = vi.fn().mockImplementation((..._args: unknown[]) => ({}));
const mockCollection = vi.fn().mockReturnValue({});
const mockLimit = vi.fn().mockReturnValue({});
const mockStartAfter = vi.fn().mockReturnValue({});

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: vi.fn().mockReturnValue({ id: "mock-doc" }),
  collection: (...args: unknown[]) => mockCollection(...args),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: vi.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  or: (...args: unknown[]) => mockOr(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  startAfter: (...args: unknown[]) => mockStartAfter(...args),
  serverTimestamp: vi.fn(),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  Timestamp: { now: () => ({ toDate: () => new Date() }) },
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(),
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirestoreDb: vi.fn().mockReturnValue({}),
  getFirebaseFunctions: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/firebaseAuth", () => ({
  getAuthClient: vi.fn().mockReturnValue({
    currentUser: { uid: "test-user-123" },
  }),
}));

import { fetchBookingRequestPage, fetchBookingRequests, fetchBookingRequestByEventId } from "./db";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchBookingRequestPage — access filter", () => {
  it("uses just owner_uid when profileIds is empty (owner-only fallback during claim load)", async () => {
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] });
    await fetchBookingRequestPage(10, null, undefined, []);
    expect(mockWhere).toHaveBeenCalledWith("owner_uid", "==", "test-user-123");
    expect(mockOr).not.toHaveBeenCalled();
  });

  it("wraps owner_uid + target_profile_id in an OR for the admin/member path", async () => {
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] });
    await fetchBookingRequestPage(10, null, undefined, ["venue-A", "venue-B"]);
    expect(mockWhere).toHaveBeenCalledWith("owner_uid", "==", "test-user-123");
    expect(mockWhere).toHaveBeenCalledWith("target_profile_id", "in", ["venue-A", "venue-B"]);
    expect(mockOr).toHaveBeenCalled();
  });

  it("composes the status filter alongside the access filter", async () => {
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] });
    await fetchBookingRequestPage(10, null, { status: "pending" }, ["venue-A"]);
    expect(mockWhere).toHaveBeenCalledWith("status", "==", "pending");
    expect(mockWhere).toHaveBeenCalledWith("target_profile_id", "in", ["venue-A"]);
  });

  it("clamps the inner `in` array to FIRESTORE_IN_LIMIT − 1 (owner_uid consumes one slot)", async () => {
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] });
    const overflow = Array.from({ length: 42 }, (_, i) => `pid-${i}`);
    await fetchBookingRequestPage(10, null, undefined, overflow);
    const inCall = mockWhere.mock.calls.find(([, op]) => op === "in")!;
    expect((inCall[2] as string[]).length).toBe(29);
  });

  it("filters out empty/falsy profile ids before sending to Firestore", async () => {
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] });
    await fetchBookingRequestPage(10, null, undefined, ["venue-A", "", "venue-B"]);
    const inCall = mockWhere.mock.calls.find(([, op]) => op === "in")!;
    expect(inCall[2]).toEqual(["venue-A", "venue-B"]);
  });

  it("returns empty without querying when there is no signed-in user", async () => {
    const auth = await import("@/lib/firebaseAuth");
    vi.mocked(auth.getAuthClient).mockReturnValueOnce({ currentUser: null } as ReturnType<typeof auth.getAuthClient>);
    const result = await fetchBookingRequestPage(10, null, undefined, ["venue-A"]);
    expect(result).toEqual({ requests: [], lastDoc: null, hasMore: false });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("maps firestore docs to {id, ...data} for the returned page", async () => {
    mockGetDocs.mockResolvedValue({
      size: 2,
      docs: [
        { id: "req-1", data: () => ({ name: "Alice", target_profile_id: "venue-A" }) },
        { id: "req-2", data: () => ({ name: "Bob", target_profile_id: "venue-A" }) },
      ],
    });
    const result = await fetchBookingRequestPage(10, null, undefined, ["venue-A"]);
    expect(result.requests).toEqual([
      { id: "req-1", name: "Alice", target_profile_id: "venue-A" },
      { id: "req-2", name: "Bob", target_profile_id: "venue-A" },
    ]);
  });
});

describe("fetchBookingRequests — access filter", () => {
  it("uses just owner_uid when profileIds is empty", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await fetchBookingRequests([]);
    expect(mockWhere).toHaveBeenCalledWith("owner_uid", "==", "test-user-123");
    expect(mockOr).not.toHaveBeenCalled();
  });

  it("wraps owner_uid + target_profile_id in OR with non-empty profileIds", async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await fetchBookingRequests(["venue-A", "venue-B"]);
    expect(mockWhere).toHaveBeenCalledWith("target_profile_id", "in", ["venue-A", "venue-B"]);
    expect(mockOr).toHaveBeenCalled();
  });
});

describe("fetchBookingRequestByEventId — access filter", () => {
  it("returns null without querying when there is no signed-in user", async () => {
    const auth = await import("@/lib/firebaseAuth");
    vi.mocked(auth.getAuthClient).mockReturnValueOnce({ currentUser: null } as ReturnType<typeof auth.getAuthClient>);
    const result = await fetchBookingRequestByEventId("evt-1", ["venue-A"]);
    expect(result).toBeNull();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("uses owner_uid + target_profile_id OR alongside the event_id filter", async () => {
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    await fetchBookingRequestByEventId("evt-1", ["venue-A"]);
    expect(mockWhere).toHaveBeenCalledWith("target_profile_id", "in", ["venue-A"]);
    expect(mockWhere).toHaveBeenCalledWith("event_id", "==", "evt-1");
    expect(mockOr).toHaveBeenCalled();
  });
});
