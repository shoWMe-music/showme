/**
 * Unit tests for `resolveNotificationTarget`.
 *
 * The resolver is pure — given an `AppNotification` it returns a TanStack
 * Router navigation descriptor. These cases pin the resolution priority
 * order documented at the top of `notificationLinks.ts`.
 */
import { describe, it, expect } from "vitest";

import { resolveNotificationTarget } from "./notificationLinks";
import type { AppNotification } from "@/lib/models";

function makeNotif(overrides: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    type: "event_status_changed",
    title: "Test",
    body: "Test body",
    actorName: "Alice",
    actorUid: "uid-actor",
    read: false,
    createdAt: "2026-04-29T10:00:00Z",
    ...overrides,
  };
}

describe("resolveNotificationTarget", () => {
  it("routes event-scoped notifications to /events/$id with the event id as a param", () => {
    const target = resolveNotificationTarget(makeNotif({ eventId: "evt-123" }));
    expect(target).toEqual({
      kind: "event",
      to: "/events/$id",
      params: { id: "evt-123" },
    });
  });

  it("forwards metadata.tab into the search params for event notifications", () => {
    const target = resolveNotificationTarget(
      makeNotif({ eventId: "evt-9", metadata: { tab: "settlement" } }),
    );
    expect(target).toEqual({
      kind: "event",
      to: "/events/$id",
      params: { id: "evt-9" },
      search: { tab: "settlement" },
    });
  });

  it("treats metadata.section as a hash (sub-section within a tab)", () => {
    const target = resolveNotificationTarget(
      makeNotif({ eventId: "evt-9", metadata: { tab: "agreement", section: "confirmations" } }),
    );
    expect(target).toEqual({
      kind: "event",
      to: "/events/$id",
      params: { id: "evt-9" },
      search: { tab: "agreement" },
      hash: "confirmations",
    });
  });

  it("omits hash when metadata.section is unset", () => {
    const target = resolveNotificationTarget(
      makeNotif({ eventId: "evt-9", metadata: { tab: "agreement" } }),
    );
    expect(target).toEqual({
      kind: "event",
      to: "/events/$id",
      params: { id: "evt-9" },
      search: { tab: "agreement" },
    });
  });

  it("routes settlement_status_changed to /settlements/$id (not the event tab)", () => {
    const target = resolveNotificationTarget(
      makeNotif({ type: "settlement_status_changed", eventId: "evt-1" }),
    );
    expect(target).toEqual({
      kind: "settlement",
      to: "/settlements/$id",
      params: { id: "evt-1" },
    });
  });

  it("routes settlement_comment_added to /settlements/$id?tab=settlement#comments", () => {
    const target = resolveNotificationTarget(
      makeNotif({
        type: "settlement_comment_added",
        eventId: "evt-1",
        metadata: { tab: "settlement", section: "comments" },
      }),
    );
    expect(target).toEqual({
      kind: "settlement",
      to: "/settlements/$id",
      params: { id: "evt-1" },
      search: { tab: "settlement" },
      hash: "comments",
    });
  });

  it("routes settlement_revision_added to the changelog tab", () => {
    const target = resolveNotificationTarget(
      makeNotif({
        type: "settlement_revision_added",
        eventId: "evt-1",
        metadata: { tab: "changelog" },
      }),
    );
    expect(target).toEqual({
      kind: "settlement",
      to: "/settlements/$id",
      params: { id: "evt-1" },
      search: { tab: "changelog" },
    });
  });

  it("non-settlement event notifications still route to /events/$id", () => {
    const target = resolveNotificationTarget(
      makeNotif({ type: "deal_updated", eventId: "evt-1", metadata: { tab: "budget" } }),
    );
    expect(target).toEqual({
      kind: "event",
      to: "/events/$id",
      params: { id: "evt-1" },
      search: { tab: "budget" },
    });
  });

  it("routes contact-scoped notifications to /contacts/$id", () => {
    const target = resolveNotificationTarget(
      makeNotif({ metadata: { contactId: "c-42" } }),
    );
    expect(target).toEqual({
      kind: "contact",
      to: "/contacts/$id",
      params: { id: "c-42" },
    });
  });

  it("routes profile-scoped notifications to the public profile when a slug is provided", () => {
    const target = resolveNotificationTarget(
      makeNotif({ metadata: { profileSlug: "neon-castle" } }),
    );
    expect(target).toEqual({
      kind: "profile-public",
      to: "/p/$slug",
      params: { slug: "neon-castle" },
    });
  });

  it("falls back to /profiles when only profileId is known (no per-id route exists)", () => {
    const target = resolveNotificationTarget(
      makeNotif({ metadata: { profileId: "p-7" } }),
    );
    expect(target).toEqual({ kind: "profile-list", to: "/profiles" });
  });

  it("passes through preset link strings on the allowlist", () => {
    const target = resolveNotificationTarget(
      makeNotif({ link: "/requests" }),
    );
    expect(target).toEqual({ kind: "static", to: "/requests" });
  });

  it("ignores arbitrary link strings (untrusted) and falls back to /", () => {
    const target = resolveNotificationTarget(
      makeNotif({ link: "https://evil.example.com" }),
    );
    expect(target).toEqual({ kind: "static", to: "/" });
  });

  it("prefers eventId over a generic preset link string", () => {
    const target = resolveNotificationTarget(
      makeNotif({ eventId: "evt-1", link: "/requests" }),
    );
    expect(target.kind).toBe("event");
  });
});
