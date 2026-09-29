import { describe, expect, it } from "vitest";
import {
  type InboxView,
  addressedInvitationsInView,
  participationInvitationsInView,
} from "./inboxInvitations";

const UNREAD = "unread";

const incoming: InboxView = { direction: "incoming", filter: "pending", selectedDay: null };

const participation = (
  over: Partial<{ id: string; requestStatus: string; eventDate: string | null }> = {},
) => ({
  id: "p1",
  requestStatus: "pending",
  eventDate: "2026-12-05",
  ...over,
});

const addressed = (over: Partial<{ id: string; eventDate: string | null }> = {}) => ({
  id: "a1",
  eventDate: "2026-12-05",
  ...over,
});

describe("an invitation is always INCOMING", () => {
  it("keeps both lists off the Outgoing tab", () => {
    /*
     * The tab says of itself "Offers and requests you have SENT, and where they stand". A night
     * the Lantern Hall offered Marlo is not one of those — and it was listed there, complete with
     * "Astra Booking Agency answers this for you" (QA sweep run 12).
     */
    const outgoing: InboxView = { ...incoming, direction: "outgoing" };
    expect(participationInvitationsInView([participation()], outgoing)).toEqual([]);
    expect(addressedInvitationsInView([addressed()], outgoing)).toEqual([]);
  });

  it("keeps them on Incoming — THE CONTROL, so the empty above is the direction", () => {
    expect(participationInvitationsInView([participation()], incoming)).toHaveLength(1);
    expect(addressedInvitationsInView([addressed()], incoming)).toHaveLength(1);
  });

  it("answers the same way for BOTH lists on every direction", () => {
    // They feed one card whose heading counts them together, and one empty state that counts them
    // together. A list disagreeing with its sibling puts the screen at odds with itself.
    for (const direction of ["incoming", "outgoing", "", "INCOMING"]) {
      const view: InboxView = { ...incoming, direction };
      const p = participationInvitationsInView([participation()], view).length > 0;
      const a = addressedInvitationsInView([addressed()], view).length > 0;
      expect(p, `direction ${direction}`).toBe(a);
    }
  });
});

describe("the status chips", () => {
  it("matches a participation on its own requestStatus, and passes everything on `all`", () => {
    const rows = [
      participation({ id: "pending", requestStatus: "pending" }),
      participation({ id: "accepted", requestStatus: "accepted" }),
      participation({ id: "expired", requestStatus: "expired" }),
    ];
    expect(
      participationInvitationsInView(rows, { ...incoming, filter: "accepted" }).map(
        (row) => row.id,
      ),
    ).toEqual(["accepted"]);
    expect(participationInvitationsInView(rows, { ...incoming, filter: "all" })).toHaveLength(3);
  });

  it("keeps a participation out of the UNREAD bucket, which it has no state for", () => {
    /*
     * No clause does this and none is needed: unread is a booking-request notion and no
     * `requestStatus` is ever spelled that way, so the status match excludes the whole bucket.
     * There WAS a clause and a mutation deleting it survived — it could never be the deciding
     * test. Asserted over EVERY status the enum has, because "it happens to miss" and "it cannot
     * match" are different claims and only the second is safe to rely on.
     */
    for (const requestStatus of ["pending", "accepted", "declined", "expired", "cancelled"]) {
      expect(
        participationInvitationsInView([participation({ requestStatus })], {
          ...incoming,
          filter: UNREAD,
        }),
        `requestStatus ${requestStatus}`,
      ).toEqual([]);
    }
  });

  it("shows an ADDRESSED invitation under Pending and All only", () => {
    // They are always unanswered, so on Accepted, Declined or Expired they would be the one row in
    // the bucket that does not belong to it.
    expect(
      addressedInvitationsInView([addressed()], { ...incoming, filter: "pending" }),
    ).toHaveLength(1);
    expect(addressedInvitationsInView([addressed()], { ...incoming, filter: "all" })).toHaveLength(
      1,
    );
    for (const filter of ["accepted", "declined", "expired", "cancelled", UNREAD]) {
      expect(
        addressedInvitationsInView([addressed()], { ...incoming, filter }),
        `filter ${filter}`,
      ).toEqual([]);
    }
  });
});

describe("the day rail", () => {
  it("narrows both lists to the picked day", () => {
    const view: InboxView = { ...incoming, selectedDay: "2026-12-05" };
    expect(
      participationInvitationsInView(
        [participation({ id: "same" }), participation({ id: "other", eventDate: "2026-12-06" })],
        view,
      ).map((row) => row.id),
    ).toEqual(["same"]);
    expect(
      addressedInvitationsInView(
        [addressed({ id: "same" }), addressed({ id: "other", eventDate: "2026-12-06" })],
        view,
      ).map((row) => row.id),
    ).toEqual(["same"]);
  });

  it("drops an UNDATED row when a day is picked, and keeps it when none is", () => {
    // The boundary: `eventDate` is nullable on the wire and null is not the picked day.
    const undated = [participation({ eventDate: null })];
    expect(
      participationInvitationsInView(undated, { ...incoming, selectedDay: "2026-12-05" }),
    ).toEqual([]);
    expect(participationInvitationsInView(undated, incoming)).toHaveLength(1);
  });

  it("treats an ABSENT selectedDay the same as null — the UNSET case", () => {
    // The inbox hook's own state is optional, so both spellings reach here.
    const view = { direction: "incoming", filter: "pending" } as InboxView;
    expect(participationInvitationsInView([participation()], view)).toHaveLength(1);
    expect(addressedInvitationsInView([addressed()], view)).toHaveLength(1);
  });
});
