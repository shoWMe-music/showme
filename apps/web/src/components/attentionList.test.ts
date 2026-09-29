import { describe, expect, it } from "vitest";
import { type AttentionSources, attentionSentence, buildAttentionList } from "./attentionList";

const empty: AttentionSources = {
  events: [],
  requests: [],
  dealsAwaitingSignature: [],
  eventInvitations: [],
  addressedInvitations: [],
  settlements: [],
  changeRequests: [],
  disputedSettlements: [],
};

/**
 * An event the reader MAY decide — the operator's own board, which is the majority case.
 *
 * A factory and not an inline literal because `capabilities` is a gate: every fixture that omits it
 * would silently stop qualifying, and a suite that goes green by all its rows disappearing is the
 * shape this file exists to catch.
 */
const decidable = (over: Partial<AttentionSources["events"][number]> = {}) => ({
  id: "a",
  title: "On hold night",
  status: "on_hold",
  eventDate: "2026-10-01",
  capabilities: ["event.view", "event.edit"],
  ...over,
});

const invitation = (over: Partial<AttentionSources["eventInvitations"][number]> = {}) => ({
  participantId: "p1",
  eventId: "e1",
  title: "Album Release",
  eventDate: "2026-11-02",
  role: "performer",
  hostName: "Northlight Presents",
  requestStatus: "pending",
  answerableByYou: true,
  delegateName: null,
  ...over,
});

const settlement = (over: Partial<AttentionSources["settlements"][number]> = {}) => ({
  settlementId: "s1",
  eventId: "e1",
  eventTitle: "Spring Warmup",
  eventDate: "2026-10-04",
  status: "pending_review",
  isYours: true,
  partyName: "Northlight Presents",
  ...over,
});

describe("what qualifies as needing attention", () => {
  it("is empty when nobody is waiting on anything", () => {
    const list = buildAttentionList(empty);
    expect(list.items).toEqual([]);
    expect(list.hidden).toBe(0);
    expect(attentionSentence(0, 0)).toEqual({
      caughtUp: true,
      text: "You're all caught up. Nothing needs your attention today.",
    });
  });

  it("takes only the event statuses that await a decision, and names the one it found", () => {
    const list = buildAttentionList({
      ...empty,
      events: [
        decidable(),
        decidable({ id: "b", title: "Confirmed night", status: "confirmed" }),
        decidable({ id: "c", title: "Draft night", status: "draft" }),
        decidable({
          id: "d",
          title: "Suggested night",
          status: "suggested",
          eventDate: "2026-10-04",
        }),
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

  it("LEAVES a night the reader cannot decide — the operator decides, the bill waits", () => {
    /*
     * QA sweep run 13: a performer's Dashboard read "Confirm Nordic Synth Showcase · On hold ·
     * needs a decision · Review", and the page behind it has no status control — the route answers
     * `403 Missing capability: event.edit`. `NEEDS_DECISION` says "waiting on an OPERATOR decision"
     * and the loop was testing only the status.
     *
     * Over every capability set a non-deciding reader actually holds, because "it happens to miss"
     * and "it cannot match" are different claims: a performer, a crew member, and an AGENT — whose
     * set is the trap, since `deal.edit` and `agreement.manage` (decisions #14) make them look
     * authoritative on a night they may not confirm.
     */
    for (const capabilities of [
      ["event.view"],
      ["event.view", "rider.manage"],
      ["event.view", "deal.edit", "agreement.manage"],
      [],
    ]) {
      const list = buildAttentionList({
        ...empty,
        events: [decidable({ title: "Nordic Synth Showcase", capabilities })],
      });
      expect(list.items, `capabilities ${JSON.stringify(capabilities)}`).toEqual([]);
    }
  });

  it("takes the SAME night for a reader who holds `event.edit` — the control on the clause above", () => {
    // So the empty above is the capability and not the status, the date or the title.
    const list = buildAttentionList({
      ...empty,
      events: [decidable({ title: "Nordic Synth Showcase" })],
    });
    expect(list.items.map((item) => item.title)).toEqual(["Confirm Nordic Synth Showcase"]);
  });

  it("asks both clauses of the guard, so neither alone admits a row", () => {
    // A guard with two clauses needs a test per clause AND the pair: status without capability,
    // capability without status, and both — one call, so the three cannot drift apart.
    const list = buildAttentionList({
      ...empty,
      events: [
        decidable({ id: "status-only", capabilities: ["event.view"] }),
        decidable({ id: "capability-only", status: "confirmed" }),
        decidable({ id: "both" }),
      ],
    });
    expect(list.items.map((item) => item.id)).toEqual(["event-both"]);
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

  it("names WHO was invited when the reader is answering for somebody else", () => {
    /*
     * An AGENCY read "Invited to perform by The Lantern Hall" on its own Dashboard (run 12). An
     * agency does not perform; its act does, and the delegation is the only reason the row is on
     * the agency's card. `delegateName` names the ACT on an agent's row (decisions §25.7.3) and
     * had been on the wire since part 29 with nothing reading it.
     */
    const list = buildAttentionList({
      ...empty,
      eventInvitations: [invitation({ delegateName: "Marlo Vance" })],
    });
    expect(list.items[0]?.detail).toBe(
      "Marlo Vance invited to perform by Northlight Presents · 2 Nov 2026",
    );
    // The title and the action are the reader's either way — they are the one answering.
    expect(list.items[0]?.title).toBe("Answer Album Release");
    expect(list.items[0]?.action).toBe("Answer");
  });

  it("says plain `Invited` when nobody is being answered for", () => {
    // THE CONTROL: most invitations have no agent at all, and that sentence must not gain a subject.
    const list = buildAttentionList({ ...empty, eventInvitations: [invitation()] });
    expect(list.items[0]?.detail).toBe("Invited to perform by Northlight Presents · 2 Nov 2026");
    // Starts with the verb and nothing before it. `not.toContain("invited to perform")` would have
    // passed here on letter case alone, which is a thing this codebase has already paid for once.
    expect(list.items[0]?.detail.startsWith("Invited ")).toBe(true);
  });

  it("LEAVES one the reader may see but not answer — the act sees, the agent acts", () => {
    // decisions §25.7.3. The row exists so the act's screens can show the night;
    // routing them to a button they do not have is the bug QA6-1 forbids.
    const list = buildAttentionList({
      ...empty,
      eventInvitations: [invitation({ answerableByYou: false })],
    });
    expect(list.items).toEqual([]);

    // And with a delegate named on it — the ACT's own row, where `delegateName` is the AGENT.
    // It must stay out, because naming the agent as the invitee would invert the sentence.
    expect(
      buildAttentionList({
        ...empty,
        eventInvitations: [
          invitation({ answerableByYou: false, delegateName: "Astra Booking Agency" }),
        ],
      }).items,
    ).toEqual([]);
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
          eventStatus: "confirmed",
        },
      ],
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.detail).toBe("Invited to co-promote by The Lantern Hall · 1 Dec 2026");
    expect(list.items[0]?.target).toEqual({ to: "requests" });
  });

  /*
   * AND IT SAYS WHEN THE NIGHT IS OFF (QA sweep run 16).
   *
   * Run 15 put this fact on the Requests inbox and the invitation landing page and stopped there, so
   * this card sat a cancelled night directly above a live one in identical styling. Both halves
   * asserted, because a suffix on every row would be the same defect in the other direction.
   */
  it("says the show is off on a cancelled night, and nothing on a live one", () => {
    const cancelled = buildAttentionList({
      ...empty,
      addressedInvitations: [
        {
          id: "i3",
          eventId: "e5",
          eventTitle: "Winter Gala",
          eventDate: "2027-01-08",
          role: "performer",
          hostName: "The Lantern Hall",
          eventStatus: "cancelled",
        },
      ],
    });
    expect(cancelled.items[0]?.detail).toContain("this show is off");

    const live = buildAttentionList({
      ...empty,
      addressedInvitations: [
        {
          id: "i4",
          eventId: "e3",
          eventTitle: "Open Mic Wednesdays",
          eventDate: "2027-01-08",
          role: "performer",
          hostName: "The Lantern Hall",
          eventStatus: "suggested",
        },
      ],
    });
    expect(live.items[0]?.detail).not.toContain("this show is off");
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
          eventStatus: "draft",
        },
      ],
    });
    // No trailing "by undefined", and the date reads as the dash `formatDay` gives it.
    expect(list.items[0]?.detail).toBe("Invited to join · —");
    expect(list.items[0]?.title).toBe("Answer Code night");
  });
});

describe("a settlement waiting on your signature", () => {
  /*
   * THE FILTERING MOVED TO THE SERVER, and its assertions moved with it — they are in
   * `apps/api/src/settlement-own-read.test.ts` against `GET /settlements/awaiting-signature`: the
   * review statuses, a signature already given, a reader who holds no `settlement.confirm`, and the
   * delegated line an agent signs. This card now renders what that route returns, so what is left
   * to decide here is the SENTENCE.
   */
  it("says whose figures they are when the reader is signing for somebody else", () => {
    // An agency signs for its act (#14) and needs to know which act before it does. The global
    // money list never carried that line at all, which is the defect this route exists for.
    const list = buildAttentionList({
      ...empty,
      settlements: [settlement({ isYours: false, partyName: "Marlo Vance" })],
    });
    expect(list.items[0]?.title).toBe("Sign off Marlo Vance's figures on Spring Warmup");
  });

  it("says `your figures` on the reader's own line", () => {
    // THE CONTROL: the other branch, so the sentence above is `isYours` and not the party name.
    expect(buildAttentionList({ ...empty, settlements: [settlement()] }).items[0]?.title).toBe(
      "Check your figures on Spring Warmup",
    );
  });

  it("possessives a name ending in s without doubling it", () => {
    // `possessiveOf` is case-insensitive on the trailing s — a lesson this codebase paid for once.
    expect(
      buildAttentionList({
        ...empty,
        settlements: [settlement({ isYours: false, partyName: "NORTHLIGHT PRESENTS" })],
      }).items[0]?.title,
    ).toBe("Sign off NORTHLIGHT PRESENTS' figures on Spring Warmup");
  });

  it("still names the night when the party has no profile name — the UNSET case", () => {
    // An off-platform party has a settlement line and no profile, so the join comes back null.
    const list = buildAttentionList({
      ...empty,
      settlements: [settlement({ isYours: false, partyName: null })],
    });
    expect(list.items[0]?.title).toBe("Sign off their act's figures on Spring Warmup");
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

  it("goes to that night's settlement", () => {
    expect(buildAttentionList({ ...empty, settlements: [settlement()] }).items[0]?.target).toEqual({
      to: "eventSettlement",
      eventId: "e1",
    });
  });
});

describe("the rank and the cut", () => {
  const spread: AttentionSources = {
    ...empty,
    events: [decidable({ id: "e", title: "Far night", eventDate: "2026-12-24" })],
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
    settlements: [settlement({ eventId: "e3", eventTitle: "Soonest", eventDate: "2026-09-30" })],
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
        decidable({ id: "undated", title: "No date yet", status: "pending", eventDate: null }),
        decidable({ id: "dated", title: "Dated", status: "pending" }),
      ],
    });
    expect(list.items.map((item) => item.title)).toEqual(["Confirm Dated", "Confirm No date yet"]);
  });

  it("breaks a date tie on the id, so the order is total", () => {
    const same = "2026-10-01";
    const list = buildAttentionList({
      ...empty,
      events: [
        decidable({ id: "zz", title: "Zed", status: "pending", eventDate: same }),
        decidable({ id: "aa", title: "Ay", status: "pending", eventDate: same }),
      ],
    });
    expect(list.items.map((item) => item.id)).toEqual(["event-aa", "event-zz"]);
  });

  it("counts everything and shows the limit — the count is the TOTAL", () => {
    const events = Array.from({ length: 7 }, (_, index) =>
      decidable({
        id: `e${index}`,
        title: `Night ${index}`,
        status: "pending",
        eventDate: `2026-10-0${index + 1}`,
      }),
    );
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

/**
 * A CHANGE PROPOSAL WAITING ON THIS READER (QA sweep run 16).
 *
 * The Dashboard promised "Events awaiting a decision" and a pending move of a confirmed, published,
 * settled night was on the bell and nowhere else — an agent with it in their bell read "You're all
 * caught up. Nothing needs your attention today."
 */
describe("the change proposals waiting on an answer", () => {
  const proposal = (over: Partial<AttentionSources["changeRequests"][number]> = {}) => ({
    id: "cr1",
    eventId: "e1",
    eventTitle: "Album Release",
    eventDate: "2026-10-16",
    proposedByName: "Northlight Presents",
    changes: { eventDate: "2026-10-24" },
    ...over,
  });

  it("names who asked and what is moving, and opens the event", () => {
    const list = buildAttentionList({ ...empty, changeRequests: [proposal()] });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toBe("Answer the change to Album Release");
    expect(list.items[0]?.detail).toContain("Northlight Presents asked to change the date");
    expect(list.items[0]?.action).toBe("Answer");
    expect(list.items[0]?.target).toEqual({ to: "event", eventId: "e1" });
  });

  // The route serves only what the reader owes an answer on, so an empty list is an empty card —
  // asserted because a card that fired on every event with an open proposal would be the defect in
  // the other direction.
  it("adds nothing when there is nothing to answer", () => {
    expect(buildAttentionList({ ...empty, changeRequests: [] }).items).toHaveLength(0);
  });

  it("names the venue and the room when those are what is moving", () => {
    expect(
      buildAttentionList({
        ...empty,
        changeRequests: [proposal({ changes: { venueProfileId: "v2" } })],
      }).items[0]?.detail,
    ).toContain("change the venue");
    expect(
      buildAttentionList({
        ...empty,
        changeRequests: [proposal({ changes: { stageId: "s2" } })],
      }).items[0]?.detail,
    ).toContain("change the room");
  });

  // A proposer who acted without an acting profile has no name to print, and "Somebody" is the same
  // word the notification falls back to — one vocabulary for one absence.
  it("falls back to Somebody when the proposer has no profile name", () => {
    expect(
      buildAttentionList({
        ...empty,
        changeRequests: [proposal({ proposedByName: null })],
      }).items[0]?.detail,
    ).toContain("Somebody asked to change the date");
  });
});

/*
 * AN OBJECTION IS A THING NEEDING ATTENTION — QA sweep run 17's MAJOR.
 *
 * Two disputes were raised on two events and this card went on reading *"You have 4 things that need
 * attention today"*, because nothing fed it disputes at all. The notification is the other half; this
 * is the surface the operator actually reads in the morning.
 */
describe("a disputed settlement", () => {
  const disputed = (wasFinalized: boolean) => ({
    settlementId: `s-${wasFinalized}`,
    eventId: "e1",
    eventTitle: "Album Release",
    eventDate: "2026-10-16",
    partyName: "Neon Tide",
    wasFinalized,
  });

  it("names who objected and which night", () => {
    const list = buildAttentionList({ ...empty, disputedSettlements: [disputed(false)] });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toBe("Neon Tide disputed their figures on Album Release");
  });

  /*
   * AND THE DETAIL SAYS WHAT THE OPERATOR CAN DO ABOUT IT, which is the whole difference the freeze
   * makes: before it they can revise the figures, after it they can only talk. A single wording for
   * both would be untrue of one of its two readers — the shape this repo has now hit sixteen times.
   */
  it("says whether the figures can still be revised", () => {
    const open = buildAttentionList({ ...empty, disputedSettlements: [disputed(false)] });
    expect(open.items[0]?.detail).toContain("can still be revised");

    const frozen = buildAttentionList({ ...empty, disputedSettlements: [disputed(true)] });
    expect(frozen.items[0]?.detail).toContain("on record against finalized figures");
    expect(frozen.items[0]?.detail).not.toContain("can still be revised");
  });

  it("routes to the settlement workspace, where the objection is", () => {
    const list = buildAttentionList({ ...empty, disputedSettlements: [disputed(true)] });
    expect(list.items[0]?.target).toEqual({ to: "eventSettlement", eventId: "e1" });
  });
});
