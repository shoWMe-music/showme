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
import { UNREAD_FILTER, hiddenByFilterOn } from "./useRequestInbox";

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
