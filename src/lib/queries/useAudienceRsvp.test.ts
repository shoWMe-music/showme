/**
 * Unit tests for createAudienceRsvp.
 *
 * Verifies the helper writes to the top-level `audience_rsvps` collection with
 * the expected shape (eventId/name/email + serverTimestamp createdAt) and
 * omits the optional `city` field when blank.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddDoc = vi.fn().mockResolvedValue({ id: "rsvp-generated-id" });
const mockCollection = vi.fn().mockReturnValue({ __collection: "audience_rsvps" });

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  serverTimestamp: () => "SERVER_TIMESTAMP_SENTINEL",
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirestoreDb: vi.fn().mockReturnValue({ __db: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

import { createAudienceRsvp } from "./useAudienceRsvp";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAudienceRsvp", () => {
  it("writes to the audience_rsvps collection with serverTimestamp createdAt", async () => {
    const id = await createAudienceRsvp({
      eventId: "evt-123",
      name: "Jane Doe",
      email: "jane@example.com",
    });

    expect(id).toBe("rsvp-generated-id");
    expect(mockCollection).toHaveBeenCalledWith({ __db: true }, "audience_rsvps");
    expect(mockAddDoc).toHaveBeenCalledTimes(1);

    const [, data] = mockAddDoc.mock.calls[0];
    expect(data.eventId).toBe("evt-123");
    expect(data.name).toBe("Jane Doe");
    expect(data.email).toBe("jane@example.com");
    expect(data.createdAt).toBe("SERVER_TIMESTAMP_SENTINEL");
    // No city was supplied — the field should be omitted, not stored as undefined
    expect("city" in data).toBe(false);
  });

  it("includes the optional city field when provided", async () => {
    await createAudienceRsvp({
      eventId: "evt-456",
      name: "Bob",
      email: "bob@example.com",
      city: "Stockholm",
    });
    const [, data] = mockAddDoc.mock.calls[0];
    expect(data.city).toBe("Stockholm");
  });
});
