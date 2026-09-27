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

/** What an operator holds on their own show, as the list row serves it. */
const OPERATOR = ["event.view", "event.edit", "event.delete", "event.publish"];
/** What a performer holds on a show they play: the floor, and nothing of the above. */
const PERFORMER = ["event.view", "deal.view.own", "settlement.view.own", "rider.submit"];

describe("eventRowMenuKeys — capability before status", () => {
  it("offers a performer nothing but Archive on a live show they merely play", () => {
    expect(eventRowMenuKeys({ status: "confirmed", capabilities: PERFORMER })).toEqual(["archive"]);
  });

  it("offers a performer nothing but Unarchive on a CANCELLED show they played", () => {
    // The state that used to produce "Delete permanently…" for somebody who has no
    // `event.delete` at all — the exact row the sweep pressed.
    expect(
      eventRowMenuKeys({ status: "cancelled", archived: true, capabilities: PERFORMER }),
    ).toEqual(["unarchive"]);
  });

  it("offers the operator cancel, archive — and no delete on a live show", () => {
    expect(eventRowMenuKeys({ status: "confirmed", capabilities: OPERATOR })).toEqual([
      "cancel",
      "archive",
    ]);
  });

  it("adds delete once the show is cancelled, and drops cancel with it", () => {
    expect(eventRowMenuKeys({ status: "cancelled", capabilities: OPERATOR })).toEqual([
      "archive",
      "delete",
    ]);
  });

  it("adds delete on an archived show too — the server's own clause 6", () => {
    expect(
      eventRowMenuKeys({ status: "confirmed", archived: true, capabilities: OPERATOR }),
    ).toEqual(["unarchive", "cancel", "delete"]);
  });

  it("offers nothing that needs proving when capabilities are unknown", () => {
    // A cached row from an older client carries no `capabilities`. It must fall back
    // to the one entry that needs none, never to offering everything.
    expect(eventRowMenuKeys({ status: "cancelled" })).toEqual(["archive"]);
    expect(eventRowMenuKeys({ status: "confirmed", archived: true })).toEqual(["unarchive"]);
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
