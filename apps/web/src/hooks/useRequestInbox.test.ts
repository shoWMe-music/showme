/**
 * WHY A DAY THE RAIL JUST OFFERED IS EMPTY (QA sweep run 2, r2:758).
 *
 * The "Requests by date" rail describes the WHOLE inbox on purpose — it must not move
 * when a status chip is clicked — so it legitimately offers a day whose only request
 * the chip hides. Measured: clicking 3 Oct 2026 / DJ Frostbite printed *"No requests
 * match this view."*, because that request is `Declined` and the chip was **Pending**.
 * The rail was right; the empty state was a dead end.
 *
 * `useRequestInbox` needs React and TanStack Query; the rule worth asserting does not.
 */
import { describe, expect, it } from "vitest";
import { UNREAD_FILTER, clashVenueFor, hiddenByFilterOn } from "./useRequestInbox";

type Row = Parameters<typeof hiddenByFilterOn>[0][number];

const request = (status: string, wantedDate: string | null, readAt: string | null = "now"): Row =>
  ({ status, wantedDate, readAt }) as unknown as Row;

const INBOX = [
  request("declined", "2026-10-03T00:00:00.000Z"),
  request("pending", "2026-10-05T00:00:00.000Z"),
  request("archived", "2026-10-03T00:00:00.000Z"),
  request("pending", null),
];

describe("hiddenByFilterOn", () => {
  it("counts what the chip hides on the day the reader picked", () => {
    expect(hiddenByFilterOn(INBOX, "pending", "2026-10-03")).toBe(2);
    expect(hiddenByFilterOn(INBOX, "declined", "2026-10-03")).toBe(1);
  });

  it("counts nothing on a day whose requests the chip already shows", () => {
    expect(hiddenByFilterOn(INBOX, "pending", "2026-10-05")).toBe(0);
  });

  it("has nothing to reveal when no day is selected, or when the chip is 'all'", () => {
    expect(hiddenByFilterOn(INBOX, "pending", undefined)).toBe(0);
    expect(hiddenByFilterOn(INBOX, "all", "2026-10-03")).toBe(0);
  });

  it("understands the unread bucket, which is not a status", () => {
    const unread = [request("pending", "2026-10-09T00:00:00.000Z", null)];
    expect(hiddenByFilterOn(unread, UNREAD_FILTER, "2026-10-09")).toBe(0);
    const read = [request("pending", "2026-10-09T00:00:00.000Z", "2026-09-01T00:00:00.000Z")];
    expect(hiddenByFilterOn(read, UNREAD_FILTER, "2026-10-09")).toBe(1);
  });
});

/**
 * THE CLASH QUESTION THAT WAS NEVER ASKED (QA sweep run 7, QA7-4).
 *
 * The inbox asked only when `venueProfileId` was set, and every row in the table had it
 * NULL — every seeded one and every one the ordinary public form made. So the rule, the
 * `GET /events/date-conflicts` route, the message and migration `0047`'s column were all
 * built and correct, and the operator was offered **Create Draft** on a night already
 * sold twice.
 */
describe("clashVenueFor", () => {
  const VENUE = "e2e00000-0000-4000-8000-0000000000a1";
  const OTHER = "e2e00000-0000-4000-8000-0000000000a6";
  const row = (over: Record<string, unknown> = {}) =>
    ({
      status: "pending",
      wantedDate: "2026-10-29",
      venueProfileId: null,
      targetProfileId: VENUE,
      ...over,
    }) as Parameters<typeof clashVenueFor>[0];

  it("falls back to the venue the request was SENT to", () => {
    // The whole finding: this row is what the public form writes, and it used to ask
    // nothing at all.
    expect(clashVenueFor(row(), true)).toBe(VENUE);
  });

  it("prefers the venue the request names, when it names one", () => {
    // The API refuses a `venueProfileId` that is not the target, so these can only ever
    // agree — the preference is for the explicit value rather than a derived one.
    expect(clashVenueFor(row({ venueProfileId: VENUE }), true)).toBe(VENUE);
  });

  it("asks nothing when the target is not a venue", () => {
    // A request addressed to a PERFORMER has no venue, and its target is that performer.
    // Asking the conflicts route about it would be asking a performer which of their
    // rooms is busy.
    expect(clashVenueFor(row({ targetProfileId: OTHER }), false)).toBeNull();
    // …and not even when it is the reader's own outgoing view of a venue-bound request.
    expect(clashVenueFor(row(), false)).toBeNull();
  });

  it("asks nothing about a request nobody is about to act on", () => {
    // A decided request is not a booking in flight, and a warning on one is noise over a
    // decision already taken.
    for (const status of ["declined", "archived", "flagged", "accepted"]) {
      expect(clashVenueFor(row({ status }), true)).toBeNull();
    }
  });

  it("asks nothing without a date — there is nothing to compare", () => {
    expect(clashVenueFor(row({ wantedDate: null }), true)).toBeNull();
    expect(clashVenueFor(row({ wantedDate: "" }), true)).toBeNull();
  });
});
