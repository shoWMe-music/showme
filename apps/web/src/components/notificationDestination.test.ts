import { describe, expect, it } from "vitest";
import { notificationDestination } from "./notificationDestination";

/**
 * Where a notification takes you (ClickUp `86cbcgq5f`).
 *
 * Two different things are pinned here and they fail in opposite directions. The
 * ALLOW-LIST is a safety rule — `link` is a stored value, so a hostile one must
 * never become a navigation — and it fails loudly if it ever stops rejecting.
 * The TAB is a usability rule, and it fails silently: the wrong tab still
 * navigates, still marks read, and still looks like a working notification. It is
 * only wrong in the sense that the reader has to go and find the thing they were
 * just told about, which is the complaint the ticket is.
 */
describe("notificationDestination", () => {
  const EVENT = "11111111-2222-3333-4444-555555555555";

  describe("the tab", () => {
    it("sends a deal notification to the Deals panel", () => {
      expect(notificationDestination({ link: `/events/${EVENT}`, type: "deal.sent" })).toEqual({
        to: "/events/$eventId",
        params: { eventId: EVENT },
        search: { tab: "deals" },
      });
    });

    it("sends a new participant to the roster", () => {
      const destination = notificationDestination({
        link: `/events/${EVENT}`,
        type: "event.participant_added",
      });
      expect(destination).toMatchObject({ search: { tab: "crew" } });
    });

    /**
     * The one settlement notification whose stored link is a bare event path, so
     * before the map the message that the money was final landed on the event's
     * description. Its three siblings point at the settlement WORKSPACE instead
     * and are asserted below.
     */
    it("sends settlement.finalized to the settlement panel", () => {
      expect(
        notificationDestination({ link: `/events/${EVENT}`, type: "settlement.finalized" }),
      ).toMatchObject({ search: { tab: "settlement" } });
    });

    it("sends a message to the thread it was posted in", () => {
      /*
       * THE STORED TYPE, and this test used to assert the other one.
       *
       * Its fixture was `event.message_posted` — the realtime SSE FRAME's type — with the comment
       * "two deliveries of one event … carry the same bare link, so the rule that reads the type
       * covers both". Neither half was true: the stored row's type is `message.posted` and its link
       * carried `?tab=messages`. So the test passed over a dead map entry while the only shape the
       * bell can actually receive went uncovered, and the one row in the feed that was broken was the
       * one nobody had written a fixture for (QA sweep run 13).
       *
       * Only `NotificationBell` calls this function and the bell reads stored rows, so the stored
       * type is the whole of what needs keying.
       */
      expect(
        notificationDestination({ link: `/events/${EVENT}`, type: "message.posted" }),
      ).toMatchObject({ search: { tab: "messages" } });
      // And the frame's type is not a destination at all — it never reaches the table.
      expect(
        notificationDestination({ link: `/events/${EVENT}`, type: "event.message_posted" }),
      ).toMatchObject({ search: {} });
    });

    it("sends an answered invitation to Collaborators, not to the crew roster", () => {
      // The two are a real distinction: the roster lists who is standing on the event,
      // Collaborators shows an invited party's standing — which is what just changed.
      for (const type of ["event.invitation_accepted", "event.invitation_declined"]) {
        expect(notificationDestination({ link: `/events/${EVENT}`, type })).toMatchObject({
          search: { tab: "collaborators" },
        });
      }
    });

    /**
     * An unmapped type must land on the workspace with NO tab rather than on a
     * guessed one. Event Details is what the screen opens on anyway, and asking
     * for a panel nobody chose would be worse than asking for none.
     */
    it("asks for no tab at all when the type has no home", () => {
      expect(notificationDestination({ link: `/events/${EVENT}`, type: "hold.confirmed" })).toEqual(
        {
          to: "/events/$eventId",
          params: { eventId: EVENT },
          search: {},
        },
      );
      expect(notificationDestination({ link: `/events/${EVENT}` })).toEqual({
        to: "/events/$eventId",
        params: { eventId: EVENT },
        search: {},
      });
    });

    /**
     * The settlement workspace is a ROUTE, not a tab. A type-derived tab must not
     * be bolted onto it — the three notifications that already point there are
     * the ones that were always right, and this is the regression that would
     * quietly demote them to a tab of the event screen.
     */
    it("leaves the settlement workspace alone", () => {
      expect(
        notificationDestination({
          link: `/events/${EVENT}/settlement`,
          type: "settlement.pending_review",
        }),
      ).toEqual({ to: "/events/$eventId/settlement", params: { eventId: EVENT } });
    });

    it("still accepts a bare link, with no type to read", () => {
      expect(notificationDestination(`/events/${EVENT}`)).toMatchObject({
        to: "/events/$eventId",
        params: { eventId: EVENT },
      });
    });
  });

  describe("the allow-list", () => {
    it("resolves the static routes it knows", () => {
      expect(notificationDestination({ link: "/requests" })).toEqual({ to: "/requests" });
      expect(notificationDestination({ link: "/tasks" })).toEqual({ to: "/tasks" });
    });

    /**
     * `link` is a value out of the database. Every one of these must resolve to
     * `null` — an unclickable row — rather than to a navigation, and a type that
     * WOULD have named a tab must not smuggle one of them through.
     */
    it("refuses anything it does not recognise", () => {
      for (const link of [
        "https://evil.example.com",
        "javascript:alert(1)",
        "//evil.example.com",
        // NB `/events` is deliberately absent: it is a real static route, and the
        // list above is things that are not.
        "/events/",
        "/nope",
        "",
      ]) {
        expect(notificationDestination({ link, type: "deal.sent" })).toBeNull();
      }
      expect(notificationDestination(null)).toBeNull();
      expect(notificationDestination(undefined)).toBeNull();
    });

    /**
     * The event pattern stops at `?` and `#` on purpose, so a link carrying its
     * own query string cannot reach the router. The tab is OURS to decide from
     * the type — a stored one would be a stored value steering navigation, which
     * is the thing this module exists to prevent.
     */
    it("refuses an event link that brought its own query string", () => {
      expect(
        notificationDestination({ link: `/events/${EVENT}?tab=budget`, type: "deal.sent" }),
      ).toBeNull();
      expect(notificationDestination({ link: `/events/${EVENT}#deals` })).toBeNull();
    });
  });
});
