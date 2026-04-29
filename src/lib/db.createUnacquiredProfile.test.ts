/**
 * Unit tests for createUnacquiredProfile.
 *
 * Verifies the helper writes a profile document with the right shape so it
 * (a) gets surfaced in the user's profile list as a placeholder, and
 * (b) is claimable later (owner_uid stays empty, acquired=false, isPublic=false).
 *
 * Bug ref: ClickUp triage — "Un-acquired profile" creation in event flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Firebase modules before importing db
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ id: "new-profile-id-xyz" });
const mockCollection = vi.fn().mockReturnValue({});

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: vi.fn().mockResolvedValue({ docs: [], forEach: () => {}, size: 0 }),
  query: vi.fn().mockReturnValue({}),
  where: vi.fn().mockReturnValue({}),
  orderBy: vi.fn().mockReturnValue({}),
  collectionGroup: vi.fn().mockReturnValue({}),
  limit: vi.fn().mockReturnValue({}),
  startAfter: vi.fn().mockReturnValue({}),
  serverTimestamp: () => "TIMESTAMP",
  deleteDoc: vi.fn().mockResolvedValue(undefined),
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
    currentUser: { uid: "creator-uid-1", email: "creator@example.com" },
  }),
}));

vi.mock("@/lib/profiles", () => ({
  PROFILE_COLLECTION: "profiles",
  PROFILE_MEMBERS_SUBCOLLECTION: "members",
  PROFILE_ROOT_SCHEMA_VERSION: 2,
  deleteAllProfileMembers: vi.fn(),
  ensureProfileOwnerMember: vi.fn(),
  profileDocumentRef: (id: string) => ({ id, path: `profiles/${id}` }),
}));

import { createUnacquiredProfile } from "./db";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createUnacquiredProfile", () => {
  it("creates a placeholder profile with empty owner_uid so it can be claimed later", async () => {
    const id = await createUnacquiredProfile({ name: "Future Headliner", role: "performer" });
    expect(id).toBe("new-profile-id-xyz");
    expect(mockSetDoc).toHaveBeenCalledTimes(1);

    const [, data] = mockSetDoc.mock.calls[0];
    expect(data.name).toBe("Future Headliner");
    expect(data.role).toBe("performer");
    expect(data.type).toBe("performer");
    // Owner stays empty so a future account can claim ownership.
    expect(data.owner_uid).toBe("");
    // The creator is recorded so they can manage/delete the placeholder.
    expect(data.created_by_uid).toBe("creator-uid-1");
    expect(data.acquired).toBe(false);
    // Don't leak un-acquired placeholders into public profile search.
    expect(data.isPublic).toBe(false);
  });

  it("trims whitespace from the name", async () => {
    await createUnacquiredProfile({ name: "  Padded Venue  ", role: "venue" });
    const [, data] = mockSetDoc.mock.calls[0];
    expect(data.name).toBe("Padded Venue");
    expect(data.role).toBe("venue");
  });

  it("rejects empty names", async () => {
    await expect(
      createUnacquiredProfile({ name: "   ", role: "performer" }),
    ).rejects.toThrow(/name is required/i);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
