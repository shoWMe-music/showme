/**
 * Unit tests for fetchProfiles.
 *
 * The bug this pins: when a user has two profiles that resolve to the same
 * slot (e.g. one with docId `<uid>__performer` and another with docId
 * `<uid>__artist` from a legacy rename), the slot-keyed Record collapses them
 * to a single entry. Access-matching code that walks `slotted` would silently
 * miss one of the user's profiles — the symptom that hid EVT-944554's
 * pendingDateChange confirmation buttons.
 *
 * `all` must include both. `slotted` must contain the first by query order.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDocs = vi.fn();

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn().mockReturnValue({}),
  collectionGroup: vi.fn().mockReturnValue({}),
  setDoc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: vi.fn().mockReturnValue({}),
  where: vi.fn().mockReturnValue({}),
  orderBy: vi.fn().mockReturnValue({}),
  limit: vi.fn().mockReturnValue({}),
  startAfter: vi.fn().mockReturnValue({}),
  serverTimestamp: () => "TIMESTAMP",
  deleteDoc: vi.fn(),
  arrayUnion: vi.fn(),
  deleteField: vi.fn(),
  updateDoc: vi.fn(),
  runTransaction: vi.fn(),
  writeBatch: vi.fn(),
  onSnapshot: vi.fn(),
  addDoc: vi.fn(),
  Timestamp: { now: () => ({ toDate: () => new Date() }) },
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirestoreDb: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/firebaseAuth", () => ({
  getAuthClient: vi.fn().mockReturnValue({
    currentUser: { uid: "uid-A", email: "a@example.com" },
  }),
}));

vi.mock("@/lib/profiles", () => ({
  PROFILE_COLLECTION: "profiles",
  PROFILE_MEMBERS_SUBCOLLECTION: "members",
  PROFILE_ROOT_SCHEMA_VERSION: 2,
  deleteAllProfileMembers: vi.fn(),
  ensureProfileOwnerMember: vi.fn(),
  profileDocumentRef: (id: string) => ({ id, path: `profiles/${id}` }),
  eventPersonalBudgetDocId: (uid: string) => `pb__${uid}`,
}));

import { fetchProfiles } from "./db";

function ownedSnap(profiles: { id: string; data: Record<string, unknown> }[]) {
  return {
    forEach: (cb: (d: { id: string; data: () => Record<string, unknown> }) => void) =>
      profiles.forEach((p) => cb({ id: p.id, data: () => p.data })),
    docs: profiles.map((p) => ({ id: p.id, data: () => p.data })),
  };
}

beforeEach(() => {
  mockGetDocs.mockReset();
});

describe("fetchProfiles", () => {
  it("returns slotted Record + flat array when slots are unique", async () => {
    mockGetDocs
      // owned profiles
      .mockResolvedValueOnce(
        ownedSnap([
          { id: "uid-A__performer", data: { owner_uid: "uid-A", name: "DJ A", role: "performer" } },
          { id: "uid-A__venue", data: { owner_uid: "uid-A", name: "Club A", role: "venue" } },
        ]),
      )
      // member-of (collection group) — none
      .mockResolvedValueOnce({ docs: [], forEach: () => {} });

    const { slotted, all } = await fetchProfiles();
    expect(all).toHaveLength(2);
    expect(slotted.performer?.id).toBe("uid-A__performer");
    expect(slotted.venue?.id).toBe("uid-A__venue");
  });

  it("preserves both profiles in `all` when an owned profile and a member profile share a slot", async () => {
    // Real-world collision (the EVT-944554 bug): user owns one performer profile
    // AND is a member of a second performer profile (e.g. shared/team). Both
    // map to slot "performer". Slot Record can only hold one — but access
    // matching needs to see BOTH so the user is recognized on either profile.
    const ownedPerformer = { id: "uid-A__performer", data: { owner_uid: "uid-A", name: "Solo", role: "performer" } };
    const sharedProfileDoc = {
      id: "PRF-shared",
      exists: () => true,
      data: () => ({ owner_uid: "uid-OTHER", name: "Crew", role: "performer", slot: "performer" }),
    };
    const memberDoc = {
      ref: { parent: { parent: { path: "profiles/PRF-shared" } } },
    };

    const { getDoc } = await import("firebase/firestore");
    vi.mocked(getDoc).mockResolvedValueOnce(sharedProfileDoc as Awaited<ReturnType<typeof getDoc>>);

    mockGetDocs
      // owned: one performer profile
      .mockResolvedValueOnce(ownedSnap([ownedPerformer]))
      // member-of: returns one membership pointing at PRF-shared (a performer profile)
      .mockResolvedValueOnce({
        docs: [memberDoc],
        forEach: (cb: (d: typeof memberDoc) => void) => cb(memberDoc),
      });

    const { slotted, all } = await fetchProfiles();

    // BOTH profiles must appear in `all` — this is what access matching uses.
    expect(all).toHaveLength(2);
    const ids = all.map((p) => p.id).sort();
    expect(ids).toEqual(["PRF-shared", "uid-A__performer"]);

    // `slotted` is first-write-wins; owned is queried first, so it occupies the slot.
    expect(slotted.performer?.id).toBe("uid-A__performer");
  });

  it("dedupes by docId when the same profile appears as both owned and member", async () => {
    const profileDoc = { id: "uid-A__venue", data: () => ({ owner_uid: "uid-A", name: "Club", role: "venue" }) };
    mockGetDocs
      // owned profiles include this venue
      .mockResolvedValueOnce({
        docs: [profileDoc],
        forEach: (cb: (d: typeof profileDoc) => void) => cb(profileDoc),
      })
      // member-of returns the same profile (uid-A is also listed in members subcollection)
      .mockResolvedValueOnce({ docs: [], forEach: () => {} });

    const { all } = await fetchProfiles();
    expect(all).toHaveLength(1);
  });

  it("returns empty result when no user is signed in", async () => {
    const firebaseAuth = await import("@/lib/firebaseAuth");
    vi.mocked(firebaseAuth.getAuthClient).mockReturnValueOnce({
      currentUser: null,
    } as ReturnType<typeof firebaseAuth.getAuthClient>);

    const result = await fetchProfiles();
    expect(result).toEqual({ slotted: {}, all: [] });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});
