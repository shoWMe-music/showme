/**
 * Regression tests for the Event ↔ Firestore row serialization layer.
 *
 * Bug ref (C4 — ClickUp triage): Performer role tag (Headliner / Support /
 * Special Guest / DJ / Opener) silently reset after editing the field on a
 * child event. Root cause: `eventToFirestoreRow` and `eventRowToEvent` did not
 * include `performerRoleTag`, so any `updateEvent({ performerRoleTag })` call
 * stripped the value before write — and even pre-existing values were lost on
 * subsequent reads.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  collectionGroup: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
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
    currentUser: { uid: "u-1", email: "u@example.com" },
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

import { eventToFirestoreRow, eventRowToEvent } from "./db";
import type { Event } from "@/lib/models";

const baseEvent: Event = {
  id: "EVT-1",
  name: "Test",
  date: "2026-05-01",
  venue: "Acme Hall",
  operator: "Op",
  operatorType: "promoter",
  ticketingProvider: "",
  capacity: 0,
  artist: "Headlining Act",
  eventStatus: "draft",
  status: "draft",
};

describe("Event row serialization", () => {
  it("preserves performerRoleTag through write", () => {
    const evt: Event = { ...baseEvent, performerRoleTag: "headliner" };
    const row = eventToFirestoreRow(evt);
    expect(row.performerRoleTag).toBe("headliner");
  });

  it("preserves performerRoleTag through read", () => {
    const row = { ...eventToFirestoreRow(baseEvent), performerRoleTag: "support" };
    const back = eventRowToEvent(row);
    expect(back.performerRoleTag).toBe("support");
  });

  it("round-trips every supported role tag value", () => {
    const tags: NonNullable<Event["performerRoleTag"]>[] = [
      "headliner", "support", "special_guest", "dj", "opener",
    ];
    for (const tag of tags) {
      const row = eventToFirestoreRow({ ...baseEvent, performerRoleTag: tag });
      const back = eventRowToEvent(row);
      expect(back.performerRoleTag).toBe(tag);
    }
  });

  it("writes null (not undefined) when performerRoleTag is absent so updateDoc clears the field", () => {
    const row = eventToFirestoreRow(baseEvent);
    expect(row.performerRoleTag).toBeNull();
  });

  it("reads missing performerRoleTag back as undefined", () => {
    const row = eventToFirestoreRow(baseEvent);
    const back = eventRowToEvent(row);
    expect(back.performerRoleTag).toBeUndefined();
  });

  it("preserves ticketUrls through write and read", () => {
    const evt: Event = { ...baseEvent, ticketUrls: ["https://tix.example.com/a", "https://tix.example.com/b"] };
    const row = eventToFirestoreRow(evt);
    expect(row.ticketUrls).toEqual(["https://tix.example.com/a", "https://tix.example.com/b"]);
    const back = eventRowToEvent(row);
    expect(back.ticketUrls).toEqual(["https://tix.example.com/a", "https://tix.example.com/b"]);
  });
});
