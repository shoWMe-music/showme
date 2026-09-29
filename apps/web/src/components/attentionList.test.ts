import { describe, expect, it } from "vitest";
import { type AttentionSources, attentionSentence, buildAttentionList } from "./attentionList";

const empty: AttentionSources = {
  events: [],
  requests: [],
  dealsAwaitingSignature: [],
  eventInvitations: [],
  addressedInvitations: [],
  settlements: [],
};

const invitation = (over: Partial<AttentionSources["eventInvitations"][number]> = {}) => ({
  participantId: "p1",
  eventId: "e1",
  title: "Album Release",
  eventDate: "2026-11-02",
  role: "performer",
  hostName: "Northlight Presents",
  requestStatus: "pending",
  answerableByYou: true,
  ...over,
});

const settlement = (over: Partial<AttentionSources["settlements"][number]> = {}) => ({
  id: "s1",
  status: "pending_review",
  approvedByYou: false,
  signableByYou: true,
  event: { id: "e1", title: "Spring Warmup", eventDate: "2026-10-04" },
  ...over,
});

describe("what qualifies as needing attention", () => {
  it("is empty when nobody is waiting on anything", () => {
    const list = buildAttentionList(empty);
    expect(list.items).toEqual([]);
    expect(list.hidden).toBe(0);
    expect(attentionSentence(0, 0)).toEqual({
      caughtUp: true,
      text: "You're all caught up — nothing needs your attention today.",
    });
  });

  it("takes only the event statuses that await a decision, and names the one it found", () => {
    const list = buildAttentionList({
      ...empty,
      events: [
        { id: "a", title: "On hold night", status: "on_hold", eventDate: "2026-10-01" },
        { id: "b", title: "Confirmed night", status: "confirmed", eventDate: "2026-10-02" },
        { id: "c", title: "Draft night", status: "draft", eventDate: "2026-10-03" },
        { id: "d", title: "Suggested night", status: "suggested", eventDate: "2026-10-04" },
      ],
    });
    expect(list.items.map((item) => item.title)).toEqual([
      "Confirm On hold night",
      "Confirm Suggested night",
    ]);
    // Its OWN status, not a word for the bucket — the defect the detail line records.
    expect(list.items[0]?.detail).toContain("On hold");
    expect(list.items[0]?.detail).not.toContain("Pending");
  });

  it("takes a pending booking request and leaves an answered one", () => {
    const list = buildAttentionList({
      ...empty,
      requests: [
        { id: "r1", status: "pending", wantedDate: "2026-10-01", artistName: "Marlo Vance" },
        { id: "r2", status: "accepted", wantedDate: "2026-10-02", artistName: "Someone Else" },
      ],
    });
    expect(list.items.map((item) => item.title)).toEqual(["Reply to Marlo Vance"]);
  });
});

describe("the invitation inboxes — both of them", () => {
  it("takes a pending invitation this reader can answer", () => {
    const list = buildAttentionList({ ...empty, eventInvitations: [invitation()] });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toBe("Answer Album Release");
    expect(list.items[0]?.detail).toBe("Invited to perform by Northlight Presents · 2 Nov 2026");
  });

  it("LEAVES one the reader may see but not answer — the act sees, the agent acts", () => {
    // decisions §25.7.3. The row exists so the act's screens can show the night;
    // routing them to a button they do not have is the bug QA6-1 forbids.
    const list = buildAttentionList({
      ...empty,
      eventInvitations: [invitation({ answerableByYou: false })],
    });
    expect(list.items).toEqual([]);
  });

  it("leaves an invitation that has already been answered, or whose night has passed", () => {
    for (const requestStatus of ["accepted", "declined", "expired", "cancelled"]) {
      const list = buildAttentionList({
        ...empty,
        eventInvitations: [invitation({ requestStatus })],
      });
      expect(list.items, `requestStatus ${requestStatus}`).toEqual([]);
    }
  });

  it("reads the ADDRESSED inbox too, which is the only one a co-promoter appears in", () => {
    // `/me/event-invitations` is scoped to INVITABLE_ROLES and `co_host` is not in
    // it, so a card reading that route alone told a co-promoter they were caught up.
    const list = buildAttentionList({
      ...empty,
      addressedInvitations: [
        {
          id: "i1",
          eventId: "e9",
          eventTitle: "Co-promoted night",
          eventDate: "2026-12-01",
          role: "co_host",
          hostName: "The Lantern Hall",
        },
      ],
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.detail).toBe("Invited to co-promote by The Lantern Hall · 1 Dec 2026");
    expect(list.items[0]?.target).toEqual({ to: "requests" });
  });

  it("reads with no host and no date on it — the UNSET case", () => {
    const list = buildAttentionList({
      ...empty,
      addressedInvitations: [
        {
          id: "i2",
          eventId: "e9",
          eventTitle: "Code night",
          eventDate: null,
          role: null,
          hostName: null,
        },
      ],
    });
    // No trailing "by undefined", and the date reads as the dash `formatDay` gives it.
    expect(list.items[0]?.detail).toBe("Invited to join · —");
    expect(list.items[0]?.title).toBe("Answer Code night");
  });
});

describe("a settlement waiting on your signature", () => {
  it("takes the review statuses and leaves the ones outside the conversation", () => {
    for (const status of ["pending_review", "revised", "comments_received"]) {
      expect(
        buildAttentionList({ ...empty, settlements: [settlement({ status })] }).items,
        `in: ${status}`,
      ).toHaveLength(1);
    }
    for (const status of ["open", "finalized", "partly_paid", "paid", "dispute"]) {
      expect(
        buildAttentionList({ ...empty, settlements: [settlement({ status })] }).items,
        `out: ${status}`,
      ).toEqual([]);
    }
  });

  it("LEAVES one the reader cannot sign — the crew case, found in the browser", () => {
    // `CREW_FLOOR` carries `settlement.view.own` and deliberately not
    // `settlement.confirm`, so a crew member's figures go to `pending_review` and
    // their settlement screen has no control on it. Measured as `professional@`:
    // POST …/confirm answered 403 "Missing capability: settlement.confirm" while
    // this card was telling them to sign off.
    const list = buildAttentionList({
      ...empty,
      settlements: [settlement({ signableByYou: false })],
    });
    expect(list.items).toEqual([]);
  });

  it("STOPS ASKING once the reader has signed", () => {
    // The whole reason `approvedByYou` had to be served: `pending_review` moves for
    // every party when figures go out, the sender included, so the status alone
    // would ask the operator to review its own figures — and would keep asking
    // everyone who had already answered.
    const list = buildAttentionList({
      ...empty,
      settlements: [settlement({ approvedByYou: true })],
    });
    expect(list.items).toEqual([]);
  });

  it("says which of the two it is", () => {
    expect(
      buildAttentionList({ ...empty, settlements: [settlement()] }).items[0]?.detail,
    ).toContain("Settlement sent for review");
    expect(
      buildAttentionList({ ...empty, settlements: [settlement({ status: "revised" })] }).items[0]
        ?.detail,
    ).toContain("Settlement re-issued");
  });
});

describe("the rank and the cut", () => {
  const spread: AttentionSources = {
    ...empty,
    events: [{ id: "e", title: "Far night", status: "on_hold", eventDate: "2026-12-24" }],
    requests: [{ id: "r", status: "pending", wantedDate: "2026-10-05", contactName: "A promoter" }],
    dealsAwaitingSignature: [
      {
        dealId: "d",
        dealName: "Fee",
        eventId: "e2",
        eventTitle: "Middle night",
        eventDate: "2026-11-11",
        signedCount: 1,
        signatoryCount: 2,
      },
    ],
    eventInvitations: [invitation({ eventDate: "2026-10-31" })],
    settlements: [settlement({ event: { id: "e3", title: "Soonest", eventDate: "2026-09-30" } })],
  };

  it("ranks the soonest night first, whatever KIND of answer it is", () => {
    const list = buildAttentionList(spread);
    expect(list.items.map((item) => item.kind)).toEqual([
      "settlement",
      "request",
      "invitation",
      "deal",
      "event",
    ]);
  });

  it("a LATE source inserts by date and reshuffles nothing — the instability itself", () => {
    /*
     * THE ACTUAL BUG, reproduced as the two paints that produced it.
     *
     * `awaiting-signature` resolves after the events do, so the first paint has
     * four items and the second has five. Under arrival order the late arrival went
     * on the END, which moved whichever item the cut was about to fall on — the
     * sweep saw "Sign your line on Album Release" on the first load and "Spring
     * Warmup" on every one after. Re-spreading the same arrays would prove nothing
     * here; the two inputs have to actually differ.
     */
    const firstPaint = buildAttentionList({ ...spread, dealsAwaitingSignature: [] });
    const afterItLands = buildAttentionList(spread);

    expect(firstPaint.items.map((item) => item.id)).not.toContain("deal-d");
    expect(afterItLands.items.map((item) => item.id)).toContain("deal-d");

    // Every item present on the first paint keeps its relative order on the second.
    const survivors = afterItLands.items
      .map((item) => item.id)
      .filter((id) => firstPaint.items.some((item) => item.id === id));
    expect(survivors).toEqual(firstPaint.items.map((item) => item.id));

    // And it landed where its DATE puts it, not at the end.
    expect(afterItLands.items.map((item) => item.id).indexOf("deal-d")).toBe(3);
    expect(afterItLands.items).toHaveLength(5);
  });

  it("sorts an undated item LAST rather than dropping it", () => {
    const list = buildAttentionList({
      ...empty,
      events: [
        { id: "undated", title: "No date yet", status: "pending", eventDate: null },
        { id: "dated", title: "Dated", status: "pending", eventDate: "2026-10-01" },
      ],
    });
    expect(list.items.map((item) => item.title)).toEqual(["Confirm Dated", "Confirm No date yet"]);
  });

  it("breaks a date tie on the id, so the order is total", () => {
    const same = "2026-10-01";
    const list = buildAttentionList({
      ...empty,
      events: [
        { id: "zz", title: "Zed", status: "pending", eventDate: same },
        { id: "aa", title: "Ay", status: "pending", eventDate: same },
      ],
    });
    expect(list.items.map((item) => item.id)).toEqual(["event-aa", "event-zz"]);
  });

  it("counts everything and shows the limit — the count is the TOTAL", () => {
    const events = Array.from({ length: 7 }, (_, index) => ({
      id: `e${index}`,
      title: `Night ${index}`,
      status: "pending",
      eventDate: `2026-10-0${index + 1}`,
    }));
    const list = buildAttentionList({ ...empty, events });
    expect(list.items).toHaveLength(7);
    expect(list.shown).toHaveLength(5);
    expect(list.hidden).toBe(2);
    expect(attentionSentence(list.items.length, list.hidden)).toEqual({
      caughtUp: false,
      before: "You have ",
      count: "7 things",
      after: " that need attention today. The 5 closest are below.",
    });
  });

  it("says nothing about a cut when nothing was cut", () => {
    const sentence = attentionSentence(4, 0);
    expect(sentence).toEqual({
      caughtUp: false,
      before: "You have ",
      count: "4 things",
      after: " that need attention today.",
    });
  });

  it("agrees with itself in the singular, noun and verb both", () => {
    expect(attentionSentence(1, 0)).toEqual({
      caughtUp: false,
      before: "You have ",
      count: "1 thing",
      after: " that needs attention today.",
    });
  });

  it("shows everything when the limit is above the count", () => {
    const list = buildAttentionList({ ...empty, settlements: [settlement()] });
    expect(list.shown).toEqual(list.items);
    expect(list.hidden).toBe(0);
  });
});
