/**
 * The event row menu's rule — QA sweep run 4, QA4-9.
 *
 * The leak this pins: a performer on somebody else's show was offered "Cancel show…"
 * and "Delete permanently…". The API refused both, correctly, every time — so nothing
 * was ever damaged — but the refusal a performer gets talks about sharing rather than
 * authority, and an affordance that exists to be refused is a lie about who the reader
 * is. Capability first, then the state of the show.
 */
import { describe, expect, it } from "vitest";
import { eventRowMenuKeys } from "./eventRowMenu";

/**
 * What an operator holds on their own show, trimmed from `operator_full` to the
 * capabilities this rule reads. `settlement.view.own` is in the real preset and is in
 * here for the same reason: a fixture that is missing a capability the preset grants
 * tests a reader who does not exist.
 */
const OPERATOR = [
  "event.view",
  "event.edit",
  "event.delete",
  "event.publish",
  "settlement.view.own",
];
/** What a performer holds on a show they play: the floor, and nothing of the above. */
const PERFORMER = ["event.view", "deal.view.own", "settlement.view.own", "rider.submit"];
/** A crew member on the floor-plus-nothing tier — no money, no publishing. */
const CREW_SCHEDULE_ONLY = ["event.view", "schedule.view"];

describe("eventRowMenuKeys — capability before status", () => {
  it("offers a performer their settlement and Archive, and nothing that changes the show", () => {
    // `settlement.view.own` is a READ every party holds; nothing here touches the event.
    expect(eventRowMenuKeys({ status: "confirmed", capabilities: PERFORMER })).toEqual([
      "settlement",
      "archive",
    ]);
  });

  it("offers a performer no delete on a CANCELLED show they played", () => {
    // The state that used to produce "Delete permanently…" for somebody who has no
    // `event.delete` at all — the exact row the sweep pressed.
    expect(
      eventRowMenuKeys({ status: "cancelled", archived: true, capabilities: PERFORMER }),
    ).toEqual(["settlement", "unarchive"]);
  });

  it("offers nothing at all to a schedule-only crew member but Archive", () => {
    // No money, no publishing, and filing their own copy away needs no capability.
    expect(eventRowMenuKeys({ status: "confirmed", capabilities: CREW_SCHEDULE_ONLY })).toEqual([
      "archive",
    ]);
  });

  it("offers the operator publish, settlement, cancel, archive — and no delete on a live show", () => {
    expect(eventRowMenuKeys({ status: "confirmed", capabilities: OPERATOR })).toEqual([
      "publish",
      "settlement",
      "cancel",
      "archive",
    ]);
  });

  it("adds delete once the show is cancelled, and drops cancel with it", () => {
    // And no publish: a cancelled show that was never public has no page to put up.
    expect(eventRowMenuKeys({ status: "cancelled", capabilities: OPERATOR })).toEqual([
      "settlement",
      "archive",
      "delete",
    ]);
  });

  it("adds delete on an archived show too — the server's own clause 6", () => {
    expect(
      eventRowMenuKeys({ status: "confirmed", archived: true, capabilities: OPERATOR }),
    ).toEqual(["publish", "settlement", "unarchive", "cancel", "delete"]);
  });

  /**
   * PUBLISH follows the API's own preconditions (A-22), so the menu never offers a press
   * it knows will be refused — the QA4-9 lesson applied before the fact this time.
   */
  it("offers publish only on a confirmed show, or one that is already public", () => {
    const keys = (subject: Parameters<typeof eventRowMenuKeys>[0]) =>
      eventRowMenuKeys(subject).includes("publish");
    // Confirmed: publishable.
    expect(keys({ status: "confirmed", capabilities: OPERATOR })).toBe(true);
    // Not confirmed: nothing to put up…
    expect(keys({ status: "pending", capabilities: OPERATOR })).toBe(false);
    expect(keys({ status: "draft", capabilities: OPERATOR })).toBe(false);
    // …unless it is already public, which must always be takeable down.
    expect(keys({ status: "concluded", published: true, capabilities: OPERATOR })).toBe(true);
    expect(keys({ status: "cancelled", published: true, capabilities: OPERATOR })).toBe(true);
    // And never without the capability, whatever the status.
    expect(keys({ status: "confirmed", published: true, capabilities: PERFORMER })).toBe(false);
  });

  it("offers nothing that needs proving when capabilities are unknown", () => {
    // A cached row from an older client carries no `capabilities`. It must fall back
    // to the one entry that needs none, never to offering everything — which now
    // includes publishing and the settlement.
    expect(eventRowMenuKeys({ status: "cancelled" })).toEqual(["archive"]);
    expect(eventRowMenuKeys({ status: "confirmed", archived: true })).toEqual(["unarchive"]);
    expect(eventRowMenuKeys({ status: "confirmed", published: true })).toEqual(["archive"]);
  });

  it("lets a reader who can only VIEW still file the show away", () => {
    // Archiving is written on the caller's own participant row and hides the show from
    // their lists alone, so `event.view` — which they hold to see the row at all — is
    // the whole gate. A crew member filing their own copy must keep working.
    expect(eventRowMenuKeys({ status: "confirmed", capabilities: ["event.view"] })).toEqual([
      "archive",
    ]);
  });

  it("puts the irreversible entry last wherever it appears", () => {
    for (const subject of [
      { status: "cancelled", capabilities: OPERATOR },
      { status: "cancelled", archived: true, capabilities: OPERATOR },
      { status: "confirmed", archived: true, capabilities: OPERATOR },
    ]) {
      const keys = eventRowMenuKeys(subject);
      expect(keys[keys.length - 1]).toBe("delete");
    }
  });
});
