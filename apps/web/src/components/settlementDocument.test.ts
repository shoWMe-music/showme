import { describe, expect, it } from "vitest";
import { formatMoney } from "../lib/format";
import {
  describeBasis,
  entitlementGapSentence,
  entitlementRules,
  matchingSettlements,
  negativeAmount,
  ownFigureLabel,
  payoutAdjustments,
  payoutRows,
  payoutsCaption,
  settlementStatusToDisplay,
  settlementSteps,
  settlementTotals,
  unsignedAgreementsSentence,
  withheldPartyCount,
  withheldPayees,
} from "./settlementDocument";

/**
 * The Settlements screen's whole filtering rule (ClickUp `123qy9rngbp`).
 *
 * Asserted here for the same reason `eventListQuery` is: a wrong answer does not
 * throw, it renders a shorter list — which looks exactly like a correct list
 * belonging to somebody with fewer shows.
 */

const row = (title: string, eventDate: string | null, status = "open") => ({
  status,
  event: { title, eventDate },
});

const ROWS = [
  row("Spring Warmup", "2026-05-08"),
  row("Album Release", "2026-10-02", "finalized"),
  row("Winter Gala", null, "paid"),
];

const titles = (search: string, filter = "all") =>
  matchingSettlements(ROWS, filter, search).map((match) => match.event.title);

describe("matchingSettlements", () => {
  it("matches the event's title, case-insensitively and inside a word", () => {
    expect(titles("warmup")).toEqual(["Spring Warmup"]);
    expect(titles("ALBUM")).toEqual(["Album Release"]);
  });

  it("matches the date AS WRITTEN, not only as stored", () => {
    // Somebody hunting a May show types "May". It does not appear anywhere in
    // `2026-05-08`, which is exactly why the formatted spelling is searched too —
    // otherwise the box only works for people who know the storage format.
    expect(titles("May")).toEqual(["Spring Warmup"]);
    expect(titles("8 May")).toEqual(["Spring Warmup"]);
    expect(titles("2026")).toEqual(["Spring Warmup", "Album Release"]);
    // …and the raw form still works, for anyone who pastes one.
    expect(titles("2026-10-02")).toEqual(["Album Release"]);
  });

  it("survives an event with no date", () => {
    expect(titles("winter")).toEqual(["Winter Gala"]);
  });

  it("searches WITHIN the chip, never instead of it", () => {
    // "finalized" + "a" must not resurrect the open rows that also contain "a".
    expect(titles("a", "finalized")).toEqual(["Album Release"]);
    expect(titles("", "paid")).toEqual(["Winter Gala"]);
  });

  it("an empty or whitespace search is not a filter", () => {
    expect(titles("")).toHaveLength(3);
    expect(titles("   ")).toHaveLength(3);
  });

  it("returns nothing when nothing matches, rather than everything", () => {
    // The failure mode worth pinning: a filter that falls open on a miss shows
    // the whole list and reads as "search does nothing".
    expect(titles("zzzz")).toEqual([]);
  });
});

/**
 * THE COLUMN HAS TO ADD UP TO ITS OWN HEADLINE (QA sweep run 2, corrected by run 8's QA8-5).
 *
 * This described the engine's `entitlement` as *"deal lines + revenue you collected −
 * costs fronted for you"* and added a `collected` row on that basis. `reconcile.ts:348-369`
 * says otherwise, in three lines: `entitlement = owed` — the allocation alone — then
 * `held = collected − paid + prepaid` and `net = owed − held`. Cash never enters the
 * allocation.
 *
 * **And the original measurement was real, which is why this survived two runs.** It
 * verified `entitlement 31,500 = 30,000 + 5,000 − 3,500` against a live breakdown, and that
 * party had collected a NON-POOLED line: `reconcile.ts:255` credits such a collector with
 * what they kept, so their 5,000 is in the allocation AND in `collected`. Generalising from
 * it put the row on operators too, where pooled door cash is money to pay out and sits
 * outside the allocation entirely — SEK 20,700 of entitlement over a row of SEK 78,000.
 *
 * So the rules carry what the allocation carries, and the cash rows moved to
 * `payoutAdjustments`, under the divider QA7-10 opened for the advance.
 */
describe("entitlementRules", () => {
  const money = (minor: string) => `SEK ${(Number(minor) / 100).toLocaleString("en-IE")}`;

  it("keeps CASH out of the rules that sum to the entitlement", () => {
    const computed = {
      entitlement: "3150000",
      collected: "500000",
      paid: "200000",
      deductibles: "350000",
      lines: [],
    } as never;

    const keys = entitlementRules(computed, "SEK", money).map((rule) => rule.key);
    expect(keys).not.toContain("collected");
    expect(keys).not.toContain("paid");
    // The deductions DO belong: `reconcile.ts:263` credits them negatively into the
    // allocation, so they are part of the sum the headline states.
    expect(keys).toContain("deductibles");
  });

  it("puts the cash under the divider instead, with the direction the engine gives it", () => {
    const adjustments = payoutAdjustments(
      { entitlement: "3150000", collected: "500000", paid: "200000", lines: [] } as never,
      "SEK",
      money,
    );

    const collected = adjustments.find((row) => row.key === "collected");
    expect(collected?.value).toBe("SEK 5,000");
    // `net = entitlement − collected + paid`: cash in hand comes OFF what is still owed…
    expect(collected?.reducesPayout).toBe(true);
    // …and money this party laid out is added back to it.
    expect(adjustments.find((row) => row.key === "paid")?.reducesPayout).toBe(false);
  });

  it("carries an advance under the divider too, in whichever direction it went", () => {
    const received = payoutAdjustments(
      { entitlement: "0", prepaid: "500000", lines: [] } as never,
      "SEK",
      money,
      { isYours: true, name: "" },
      "Paid in advance by The Lantern Hall",
    );
    expect(received[0]?.label).toBe("Paid in advance by The Lantern Hall");
    expect(received[0]?.value).toBe("SEK 5,000");
    expect(received[0]?.reducesPayout).toBe(true);

    // The PAYER's side is negative in the engine, and the magnitude is what renders —
    // "− −SEK 5,000" was the shape to avoid.
    const paidOut = payoutAdjustments(
      { entitlement: "0", prepaid: "-500000", lines: [] } as never,
      "SEK",
      money,
      { isYours: true, name: "" },
      "Paid in advance to Marlo Vance",
    );
    expect(paidOut[0]?.value).toBe("SEK 5,000");
    expect(paidOut[0]?.reducesPayout).toBe(false);
  });

  it("says nothing about an advance it cannot name", () => {
    // `prepaidLabel` is null on a settlement snapshotted before the engine recorded the
    // counterparty, and a bare figure with no counterparty is what QA7-10 refused.
    const adjustments = payoutAdjustments(
      { entitlement: "0", prepaid: "500000", lines: [] } as never,
      "SEK",
      money,
    );
    expect(adjustments).toEqual([]);
  });

  it("names the party's OWN percentage on a shared split", () => {
    // QA sweep, 2026-09-27: both acts on a 60/40 read "100% of the adjusted net
    // SEK 50,000 — your share of the deal's SEK 50,000" over payouts of 30,000 and
    // 20,000. Every number in that sentence belonged to the deal.
    const rules = entitlementRules(
      {
        entitlement: "3000000",
        collected: "0",
        deductibles: "0",
        lines: [
          {
            dealId: "door",
            dealTotal: "5000000",
            amount: "3000000",
            basis: { kind: "door_split", basisPoints: 10000, base: "5000000" },
            partyBasisPoints: 6000,
          },
        ],
      } as never,
      "SEK",
      money,
    );

    const deal = rules.find((rule) => rule.key === "deal-door");
    expect(deal?.label).toContain("your 60% of the deal's");
    // The deal's own rule still reads as the deal's.
    expect(deal?.label).toContain("100% of the adjusted net");
  });

  it("falls back to 'your share' on a settlement stored before the split was recorded", () => {
    // A finalized settlement is a legal record and is never rewritten, so the sentence
    // has to stay true when the number is simply not there: vague, not wrong.
    const rules = entitlementRules(
      {
        entitlement: "3000000",
        collected: "0",
        deductibles: "0",
        lines: [
          {
            dealId: "door",
            dealTotal: "5000000",
            amount: "3000000",
            basis: { kind: "door_split", basisPoints: 10000, base: "5000000" },
          },
        ],
      } as never,
      "SEK",
      money,
    );
    expect(rules.find((rule) => rule.key === "deal-door")?.label).toContain(
      "your share of the deal's",
    );
  });

  /**
   * THE RESIDUAL NAMES THE SHARE IT IS (QA9-7, restated as QA10-6).
   *
   * Two operator cards on one screen at 25/75: *"What is left after every other party is
   * paid — SEK 7,875"* and, in the same words, **SEK 23,625**. "What is left" is one
   * quantity and neither card said it was being divided. Asserted on an unequal split for
   * the same reason the engine test is: at 50/50 the old sentence is accidentally true.
   */
  it("names the operator's OWN share of the residual", () => {
    const rules = entitlementRules(
      {
        entitlement: "787500",
        collected: "0",
        deductibles: "0",
        lines: [],
        residual: "787500",
        residualBasisPoints: 2500,
      } as never,
      "SEK",
      money,
    );

    expect(rules.find((rule) => rule.key === "residual")?.label).toBe(
      "Your 25% of what is left after every other party is paid",
    );
  });

  it("falls back to 'your share' when no share was recorded", () => {
    // A solo operator (a share of one is nothing to name) and every settlement finalized
    // before the engine carried the field — a legal record that is never rewritten. Vague
    // and true, which is the ruling `partyBasisPoints` already made.
    const rules = entitlementRules(
      {
        entitlement: "2070000",
        collected: "0",
        deductibles: "0",
        lines: [],
        residual: "2070000",
      } as never,
      "SEK",
      money,
    );

    expect(rules.find((rule) => rule.key === "residual")?.label).toBe(
      "Your share of what is left after every other party is paid",
    );
  });

  it("names the party, not the reader, on somebody else's card", () => {
    // Full settlement access (#24.2) puts the other operator's card in front of a reader,
    // and "Your 75%" under their name is the QA6-9 pronoun bug one caption further along.
    const rules = entitlementRules(
      {
        entitlement: "2362500",
        collected: "0",
        deductibles: "0",
        lines: [],
        residual: "2362500",
        residualBasisPoints: 7500,
      } as never,
      "SEK",
      money,
      { isYours: false, name: "Northlight Presents" },
    );

    expect(rules.find((rule) => rule.key === "residual")?.label).toBe(
      "Northlight Presents' 75% of what is left after every other party is paid",
    );
  });

  it("says nothing about collected cash when there is none", () => {
    const rules = entitlementRules(
      { entitlement: "3000000", collected: "0", deductibles: "0", lines: [] } as never,
      "SEK",
      money,
    );

    expect(rules.find((rule) => rule.key === "collected")).toBeUndefined();
  });
});

/**
 * "TOTAL SETTLED SEK 0" BESIDE "FINALIZED SEK 20,700" (QA sweep run 2, r2:880).
 *
 * Both figures were true and the card still read as broken: "settled" counted `paid`
 * alone, and a finalized settlement is exactly what "settled" means to the person
 * reading it. The same tile row also counted an `open` row — whose own chip said
 * **Open** — under a label reading **Pending review**.
 */
describe("settlementTotals", () => {
  // Intl puts a NARROW NO-BREAK SPACE between symbol and figure; the assertions read
  // better with a plain one than with an escape in every expected string.
  const plain = (text: string) => text.replace(/\u00a0|\u202f/g, " ");
  const item = (status: string, entitlement: string, currency = "SEK", wasFinalized = false) => ({
    id: `${status}-${currency}`,
    version: 1,
    participantId: null,
    net: entitlement,
    status,
    entitlement,
    currency,
    approvedByYou: false,
    signableByYou: true,
    wasFinalized,
    event: { id: status, status: "concluded", title: status, eventDate: null },
  });

  /*
   * A FINALIZED NIGHT WHOSE STATUS MOVED IS STILL FINALIZED (QA sweep run 17, QA17-4).
   *
   * The sweep read **FINALIZED SEK 0** beside the reader's only finalized night: that party had
   * disputed it, and `dispute` overwrites the status column the tile was summing.
   *
   * Both directions, because a tile that counted every disputed row would close the defect and start
   * claiming a freeze that never happened — which is the more expensive mistake on a money tile.
   */
  it("counts a finalized night the reader has disputed, and does not count a dispute that was never finalized", () => {
    const frozen = settlementTotals([item("dispute", "2000000", "SEK", true)]);
    expect(plain(frozen.finalized)).toBe("SEK 20,000");

    const open = settlementTotals([item("dispute", "2000000", "SEK", false)]);
    expect(plain(open.finalized)).toBe("SEK 0");
  });

  it("counts paid money as paid and says nothing about it being settled", () => {
    const totals = settlementTotals([item("finalized", "2070000"), item("open", "159000")]);
    expect(plain(totals.paid)).toBe("SEK 0");
    expect(plain(totals.finalized)).toBe("SEK 20,700");
    // Outstanding is everything not paid — the finalized money included, because it
    // has not moved.
    expect(plain(totals.outstanding)).toBe("SEK 22,290");
  });

  it("refuses to name a figure when the rows span CURRENCIES, and says why", () => {
    /*
     * decisions §25.8.1, Daniel's ruling: whenever the rows a tile sums are not all one currency,
     * print `—` and a note saying why.
     *
     * This read `settlements[0]?.currency` and labelled a sum of every row with the FIRST one, so a
     * Swedish operator with one Oslo show read a SEK+NOK total under "SEK" — the minor units added
     * together as though they were the same unit. Not a labelling slip: 2,070,000 öre plus 159,000
     * øre is not a quantity of anything.
     */
    const totals = settlementTotals([
      item("finalized", "2070000", "SEK"),
      item("paid", "159000", "NOK"),
    ]);
    expect(totals.paid).toBe("—");
    expect(totals.inReview).toBe("—");
    expect(totals.outstanding).toBe("—");
    expect(totals.finalized).toBe("—");
    // The note names both, because the reader's next question is which show is the odd one out.
    expect(totals.mixedCurrencyNote).toContain("NOK and SEK");
    expect(totals.mixedCurrencyNote).toContain("do not add up to one figure");
  });

  it("puts the odd currency LAST as well as first, so neither end can be lucky", () => {
    // The three surfaces this ruling closed picked the first row, the last row, and a hardcoded
    // default. An assertion that only tries one order cannot tell a fix from a coincidence.
    for (const rows of [
      [item("paid", "100", "NOK"), item("paid", "100", "SEK"), item("paid", "100", "SEK")],
      [item("paid", "100", "SEK"), item("paid", "100", "SEK"), item("paid", "100", "NOK")],
    ]) {
      expect(settlementTotals(rows).paid, JSON.stringify(rows.map((r) => r.currency))).toBe("—");
    }
  });

  it("still names ONE currency when every row agrees — THE CONTROL", () => {
    // So the dashes above are the mix and not the tiles having stopped working.
    const totals = settlementTotals([item("paid", "100000", "NOK"), item("paid", "50000", "NOK")]);
    expect(plain(totals.paid)).toContain("1,500");
    expect(totals.paid).not.toBe("—");
    expect(totals.mixedCurrencyNote).toBeNull();
  });

  it("says nothing about a mix when the ledger is EMPTY — the UNSET case", () => {
    // An empty ledger already shows dashes, and it has no currencies to disagree about. A note
    // there would explain a refusal that never happened.
    const totals = settlementTotals([]);
    expect(totals.paid).toBe("—");
    expect(totals.mixedCurrencyNote).toBeNull();
  });

  it("does not call an untouched settlement a review", () => {
    // The row's chip says "Open"; the tile must not claim it is under review.
    expect(plain(settlementTotals([item("open", "159000")]).inReview)).toBe("SEK 0");
    expect(plain(settlementTotals([item("pending_review", "100000")]).inReview)).toBe("SEK 1,000");
    expect(plain(settlementTotals([item("comments_received", "100000")]).inReview)).toBe(
      "SEK 1,000",
    );
    expect(plain(settlementTotals([item("revised", "100000")]).inReview)).toBe("SEK 1,000");
    // A dispute is outstanding, not a review.
    const dispute = settlementTotals([item("dispute", "100000")]);
    expect(plain(dispute.inReview)).toBe("SEK 0");
    expect(plain(dispute.outstanding)).toBe("SEK 1,000");
  });

  it("prints an em dash rather than a zero when there is nothing at all", () => {
    const empty = settlementTotals([]);
    expect(plain(empty.paid)).toBe("—");
    expect(plain(empty.outstanding)).toBe("—");
  });
});

/**
 * THE PARTY A TOTAL USED TO DROP (QA sweep run 5, QA5-1).
 *
 * The figures are the sweep's own: a co-promotion where the host owes the act
 * SEK 56,000 and the co-host SEK 7,200, and the co-host's settlement row is
 * withheld from the host because a co-operator is party to no deal.
 */
describe("withheldPayees", () => {
  const HOST = "host-participant";
  const ACT = "act-participant";
  const COHOST = "cohost-participant";

  const transfer = (from: string, to: string, amount: string, representationId?: string) => ({
    fromParticipantId: from,
    toParticipantId: to,
    amount,
    representationId,
  });

  it("names the payee whose settlement is withheld, and nobody else", () => {
    expect(
      withheldPayees([transfer(HOST, ACT, "5600000"), transfer(HOST, COHOST, "720000")], {
        ownParticipantId: HOST,
        visibleParticipantIds: [HOST, ACT],
      }),
    ).toEqual([{ participantId: COHOST, amountMinor: "720000" }]);
  });

  it("sums two legs to one payout", () => {
    // A payout is a party's net; a transfer is one leg of it. Listing the legs
    // separately would double-count the payee in the total above them.
    expect(
      withheldPayees([transfer(HOST, COHOST, "400000"), transfer(HOST, COHOST, "320000")], {
        ownParticipantId: HOST,
        visibleParticipantIds: [HOST],
      }),
    ).toEqual([{ participantId: COHOST, amountMinor: "720000" }]);
  });

  it("leaves out a transfer this reader is not paying", () => {
    // `isMyEnd` serves both ends, so a performer sees the leg that pays THEM.
    // It is money coming in, and it is not theirs to pay out.
    expect(
      withheldPayees([transfer(HOST, ACT, "5600000")], {
        ownParticipantId: ACT,
        visibleParticipantIds: [ACT],
      }),
    ).toEqual([]);
  });

  it("leaves out an agent commission — it belongs to the commission card (#14)", () => {
    expect(
      withheldPayees([transfer(ACT, "agent-participant", "358100", "representation-1")], {
        ownParticipantId: ACT,
        visibleParticipantIds: [ACT],
      }),
    ).toEqual([]);
  });

  it("leaves out a leg between two other parties", () => {
    // Not this reader's money to pay, and the payee is invisible to them too — so
    // only the "is it FROM me" test can refuse it. `isMyEnd` should never serve
    // this leg, and a total that would be wrong if it did is not worth having.
    expect(
      withheldPayees([transfer(HOST, COHOST, "720000")], {
        ownParticipantId: ACT,
        visibleParticipantIds: [ACT],
      }),
    ).toEqual([]);
  });

  it("does not read a nameless payer as a reader who has no participant", () => {
    // `fromParticipantId` is nullable on the payload, and so is the reader's own
    // participant id. Without the guard the two nulls match and an off-platform
    // party's transfer is billed to a reader who is not a party to anything.
    expect(
      withheldPayees([{ fromParticipantId: null, toParticipantId: COHOST, amount: "720000" }], {
        ownParticipantId: null,
        visibleParticipantIds: [],
      }),
    ).toEqual([]);
  });

  it("answers empty for a reader who is not a party at all", () => {
    // Crew reading the document, or an operator before their own line exists:
    // there is no "from me" to test against, so there is nothing withheld to add.
    expect(
      withheldPayees([transfer(HOST, COHOST, "720000")], {
        ownParticipantId: null,
        visibleParticipantIds: [],
      }),
    ).toEqual([]);
  });

  it("orders the largest first, like the payout list it feeds", () => {
    expect(
      withheldPayees([transfer(HOST, "small", "100000"), transfer(HOST, "large", "900000")], {
        ownParticipantId: HOST,
        visibleParticipantIds: [HOST],
      }).map((payee) => payee.participantId),
    ).toEqual(["large", "small"]);
  });
});

/**
 * THE SENTENCE THAT HAS BEEN WRONG TWICE (QA5-1, then QA6-4).
 *
 * Both times by asserting a cause unconditionally, and both times on a settlement
 * whose own rows said `deductibles: 0` and nobody collected anything. The branches
 * are asked in the order they explain the gap, and the last one says the difference
 * and stops.
 */
describe("unsignedAgreementsSentence — the refusal names the door it came from", () => {
  const NAMES = "“Band guarantee”";

  it("says the settlement cannot be run before anything has been computed", () => {
    const sentence = unsignedAgreementsSentence({ names: NAMES, alreadyComputed: false });
    expect(sentence).toContain("The settlement cannot be run until every agreement is signed");
    expect(sentence).not.toContain("finalized");
  });

  /*
   * RUN 14: this sentence appeared beside a disabled Finalize on a settlement that had been open
   * and in review for an hour. Both halves asserted — one sentence for both doors passes a test
   * that only checks the door it was written for.
   */
  /*
   * Both disabled buttons named, not one. The panel greys out Recalculate AND Finalize, and
   * "cannot open" was untrue of each of them once the settlement was open.
   */
  it("names both refused actions once the settlement is open", () => {
    const sentence = unsignedAgreementsSentence({ names: NAMES, alreadyComputed: true });
    expect(sentence).toContain(
      "These figures cannot be recomputed or finalized until every agreement is signed",
    );
    expect(sentence).not.toContain("cannot open");
    expect(sentence).not.toContain("cannot be run");
  });

  it("names each agreement rather than counting them, either way", () => {
    for (const alreadyComputed of [true, false]) {
      const sentence = unsignedAgreementsSentence({
        names: "“Band guarantee”, “Support fee”",
        alreadyComputed,
      });
      expect(sentence).toContain("“Band guarantee”, “Support fee”");
      expect(sentence).toContain("cancel one whose booking is off");
      expect(sentence).not.toMatch(/\b2 agreements?\b/);
    }
  });
});

describe("settlementSteps — a tick is a claim that something happened", () => {
  const rail = (status: string, history: string[] = []) =>
    settlementSteps(status, history).map(
      (step) =>
        `${step.state === "done" ? "✓" : step.state === "active" ? "●" : "·"} ${step.label}`,
    );

  it("marks the stop it is on active and everything ahead of it pending", () => {
    expect(rail("open")).toEqual([
      "● Open",
      "· Pending review",
      "· Comments received",
      "· Revised",
      "· Finalized",
      "· Partly paid",
      "· Paid",
    ]);
  });

  /*
   * RUN 14: a settlement finalized straight out of review read "✓ Comments received ✓ Revised"
   * over a Comments tab saying "No comments yet" and a history saying nothing had happened.
   */
  it("does not tick a middle stop the history has no record of", () => {
    expect(rail("finalized", ["settlement.pending_review"])).toEqual([
      "✓ Open",
      "✓ Pending review",
      "· Comments received",
      "· Revised",
      "● Finalized",
      "· Partly paid",
      "· Paid",
    ]);
  });

  it("ticks a middle stop the history does record", () => {
    expect(
      rail("finalized", [
        "settlement.pending_review",
        "settlement.commented",
        "settlement.revised",
      ]),
    ).toEqual([
      "✓ Open",
      "✓ Pending review",
      "✓ Comments received",
      "✓ Revised",
      "● Finalized",
      "· Partly paid",
      "· Paid",
    ]);
  });

  // The comment path sets `comments_received` SILENTLY, so the remark is the evidence — and the
  // status route's own `settlement.comments_received` counts too, for a settlement moved there
  // by hand.
  it("accepts either record of comments having been received", () => {
    expect(rail("revised", ["settlement.commented"])[2]).toBe("✓ Comments received");
    expect(rail("revised", ["settlement.comments_received"])[2]).toBe("✓ Comments received");
    expect(rail("revised", [])[2]).toBe("· Comments received");
  });

  /*
   * THE POSITIONAL STOPS STAY POSITIONAL. `open` is where a settlement is born and the last
   * three fall out of the freeze and the transfers, so arriving IS the evidence — a rail that
   * asked the feed for those would unlight a stop that provably happened.
   */
  it("keeps Open and the derived stops ticked with no history at all", () => {
    expect(rail("paid", [])).toEqual([
      "✓ Open",
      "· Pending review",
      "· Comments received",
      "· Revised",
      "✓ Finalized",
      "✓ Partly paid",
      "● Paid",
    ]);
  });

  /*
   * QA sweep run 16's first MAJOR: a dispute is allowed on frozen figures and overwrites `status`, so
   * `STAGE_OF.dispute = 2` turned Revised and Finalized into unvisited FUTURE stops on a settlement
   * finalized minutes earlier. Inferring a past stage from the current status is the mistake stages
   * 1–3 were fixed on; this is it at stage 4.
   */
  it("keeps Finalized ticked when a dispute has moved the status off it", () => {
    expect(
      rail("dispute", [
        "settlement.pending_review",
        "settlement.commented",
        "settlement.revised",
        "settlement.finalized",
      ]),
    ).toEqual([
      "✓ Open",
      "✓ Pending review",
      "✓ Comments received",
      "✓ Revised",
      "● Finalized",
      "· Partly paid",
      "· Paid",
    ]);
  });

  /*
   * AND IT IS AN OR, NOT A REPLACEMENT. A settlement finalized before that writer existed has no
   * `settlement.finalized` row — the seeded Spring Warmup is one — and must not be un-ticked by
   * asking for one. Understating a finalization is worse than the positional read it would replace.
   */
  it("still ticks Finalized from the status alone, with no history at all", () => {
    expect(rail("finalized", [])[4]).toBe("● Finalized");
    expect(rail("paid", [])[4]).toBe("✓ Finalized");
  });

  it("does not invent Finalized on a settlement that never reached it", () => {
    expect(rail("pending_review", ["settlement.pending_review"])[4]).toBe("· Finalized");
  });

  it("puts an unknown status at the start rather than inventing a stop", () => {
    expect(rail("something_new")[0]).toBe("● Open");
  });

  // A dispute is a flag ON a stage, not a stage — it shares `comments_received`'s position, and
  // the stop it stands at is not claimed as visited on its behalf.
  it("stands a dispute where it is without ticking the stop it shares", () => {
    expect(rail("dispute", ["settlement.pending_review"])).toEqual([
      "✓ Open",
      "✓ Pending review",
      "● Comments received",
      "· Revised",
      "· Finalized",
      "· Partly paid",
      "· Paid",
    ]);
  });
});

describe("payoutRows — the rows and the figure under them", () => {
  const HOST = "host-participant";
  const ACT = "act-participant";
  const OTHER_ACT = "other-act-participant";
  const CREW = "crew-participant";

  // Minor units in, format("125000") out — the same formatter the screen hands in.
  const format = (minor: string) => formatMoney(minor, "SEK");

  const party = (participantId: string, name: string, netMinor: string | null) => ({
    settlementId: `settlement-${participantId}`,
    participantId,
    name,
    netMinor,
  });

  const call = (input: Partial<Parameters<typeof payoutRows>[0]>) =>
    payoutRows({ payable: [], withheld: [], ownCommissions: [], format, ...input });

  it("labels a visible party's positive net as their payout, and totals it", () => {
    const { rows, totalMinor } = call({ payable: [party(ACT, "Marlo Vance", "3000000")] });
    expect(rows).toEqual([
      { key: `settlement-${ACT}`, label: "Marlo Vance payout", value: format("3000000") },
    ]);
    expect(totalMinor).toBe(3_000_000n);
  });

  /*
   * RUN 14: "Priya Sound payout — SEK 1,250" over Priya's own "SEK 2,500".
   *
   * `withheldPayees` returns what THIS READER pays a party whose settlement is withheld, so on a
   * co-promoted night the figure is one leg. The label must not claim the payout — and must not
   * claim it on a night with one payer either, because the row is a leg either way and the reader
   * cannot tell from here how many there are.
   */
  it("names a withheld transfer as the reader's own leg, never as the payee's payout", () => {
    const { rows, totalMinor } = call({
      withheld: [{ participantId: CREW, name: "Priya Sound", amountMinor: "125000" }],
    });
    expect(rows).toEqual([
      { key: `withheld-${CREW}`, label: "Paid by you to Priya Sound", value: format("125000") },
    ]);
    expect(rows[0]?.label).not.toContain("payout");
    // Still in the total: QA5-1 is the finding that put it there.
    expect(totalMinor).toBe(125_000n);
  });

  /*
   * RUN 14: the agent read SEK 30,000 + SEK 3,000 = SEK 33,000 under a caption saying what the
   * event pays out. The commission is a transfer OUT of the 30,000 already listed.
   */
  it("does not add a commission to a payout that already contains it", () => {
    const { rows, totalMinor } = call({
      payable: [party(ACT, "Marlo Vance", "3000000")],
      ownCommissions: [{ performerParticipantId: ACT, commissionMinor: "300000" }],
    });
    expect(totalMinor).toBe(3_000_000n);
    expect(rows.map((visible) => visible.label)).toEqual([
      "Marlo Vance payout",
      "Your commission, paid out of the payouts above",
    ]);
    // Visible, because an agent reading a panel with none of their own money on it is the defect
    // QA7-28 and QA9-8 were both filed for.
    expect(rows[1]?.value).toBe(format("300000"));
  });

  /*
   * THE HALF THE OBVIOUS FIX WOULD HAVE BROKEN — QA9-8, an agent owed SEK 3,581 reading SEK 0.
   * An agent who cannot read their client's settlement has NOTHING in `payable`, so the
   * commission is the only thing this panel can say about their money and must be added.
   */
  it("adds a commission whose payer is not counted here", () => {
    const { rows, totalMinor } = call({
      ownCommissions: [{ performerParticipantId: ACT, commissionMinor: "358100" }],
    });
    expect(totalMinor).toBe(358_100n);
    expect(rows).toEqual([
      { key: "own-commission", label: "Your commission", value: format("358100") },
    ]);
  });

  /*
   * A VISIBLE PARTY IS NOT THE SAME AS A COUNTED ONE. The act's settlement is readable but its net
   * is zero, so nothing of theirs is in this total and the commission out of them is genuinely new.
   * "Is the payer visible" would have swallowed it.
   */
  it("adds a commission whose payer is visible but contributes nothing to the total", () => {
    const { totalMinor } = call({
      payable: [party(HOST, "The Lantern Hall", "500000")],
      ownCommissions: [{ performerParticipantId: ACT, commissionMinor: "300000" }],
    });
    expect(totalMinor).toBe(800_000n);
  });

  it("counts a withheld payee as the payer of a commission, so it is not added twice", () => {
    // The agency pays its client directly and cannot read their settlement: the leg IS in the
    // total, so the commission inside it is not additional.
    const { rows, totalMinor } = call({
      withheld: [{ participantId: ACT, name: "Marlo Vance", amountMinor: "3000000" }],
      ownCommissions: [{ performerParticipantId: ACT, commissionMinor: "300000" }],
    });
    expect(totalMinor).toBe(3_000_000n);
    expect(rows[1]?.label).toBe("Your commission, paid out of the payouts above");
  });

  it("splits two commissions when one payer is counted and the other is not", () => {
    const { rows, totalMinor } = call({
      payable: [party(ACT, "Marlo Vance", "3000000")],
      ownCommissions: [
        { performerParticipantId: ACT, commissionMinor: "300000" },
        { performerParticipantId: OTHER_ACT, commissionMinor: "200000" },
      ],
    });
    expect(totalMinor).toBe(3_200_000n);
    expect(rows.map((visible) => [visible.label, visible.value])).toEqual([
      ["Marlo Vance payout", format("3000000")],
      ["Your commission", format("200000")],
      ["Your commission, paid out of the payouts above", format("300000")],
    ]);
  });

  it("emits no commission row when there is none, rather than a zero", () => {
    expect(call({ payable: [party(ACT, "Marlo Vance", "3000000")] }).rows).toHaveLength(1);
  });

  /*
   * THE INVARIANT BOTH RUN 14 FINDINGS BROKE: the figure under the rows is the rows added up,
   * minus exactly the ones whose label says they are already inside another.
   */
  it("totals the rows it shows, minus the ones that say they are already inside", () => {
    const { rows, totalMinor } = call({
      payable: [party(ACT, "Marlo Vance", "3000000"), party(OTHER_ACT, "Neon Tide", "2000000")],
      withheld: [{ participantId: CREW, name: "Priya Sound", amountMinor: "125000" }],
      ownCommissions: [{ performerParticipantId: ACT, commissionMinor: "300000" }],
    });
    expect(totalMinor).toBe(5_125_000n);
    expect(rows).toHaveLength(4);
  });
});

describe("entitlementGapSentence", () => {
  const format = (minor: string) => `SEK ${(Number(minor) / 100).toLocaleString("en-US")}`;
  const base = {
    withheldMinor: 0n,
    withheldPartyCount: 0,
    offTheTopMinor: 0n,
    collectedMinor: 0n,
    deductiblesMinor: 0n,
    format,
  };

  it("says nothing when the two agree", () => {
    expect(
      entitlementGapSentence({
        ...base,
        entitlementsMinor: 8_000_000n,
        adjustedNetMinor: 8_000_000n,
      }),
    ).toBeNull();
  });

  it("names a withheld party first — it is the most specific cause", () => {
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 4_400_000n,
      adjustedNetMinor: 5_000_000n,
      withheldMinor: 600_000n,
      // Even with money off the top AND collections in play, the withheld line is
      // the one this reader cannot see and therefore the one to name.
      offTheTopMinor: 500_000n,
      collectedMinor: 8_300_000n,
    });
    expect(sentence).toContain("At least SEK 6,000");
    expect(sentence).toContain("not shared with you");
  });

  it("names money settled OFF THE TOP when the entitlements exceed the pool (QA6-4)", () => {
    // The sweep's figures: gross 100,000 − 15,000 deductions − 5,000 rental off the
    // top = 80,000 adjusted net, against entitlements of 85,000.
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 8_500_000n,
      adjustedNetMinor: 8_000_000n,
      offTheTopMinor: 500_000n,
    });
    expect(sentence).toContain("SEK 5,000 was settled off the top");
    expect(sentence).not.toContain("the cash that party collected");
  });

  it("does not blame the off-the-top when the entitlements are BELOW the net", () => {
    // Money taken off the top can only push the entitlements up. A shortfall has a
    // different cause, and naming this one would be as wrong as the clause it replaced.
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 7_000_000n,
      adjustedNetMinor: 8_000_000n,
      offTheTopMinor: 500_000n,
    });
    expect(sentence).not.toContain("off the top");
  });

  it("keeps the original clause where the rows actually carry it", () => {
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 5_500_000n,
      adjustedNetMinor: 5_350_000n,
      collectedMinor: 150_000n,
    });
    expect(sentence).toContain("each line also carries the cash that party collected");
  });

  /**
   * A MISSING PARTY EXPLAINS THE GAP BETTER THAN ARITHMETIC DOES (QA sweep run 11, QA11-2).
   *
   * The host of a co-promotion read *"…come to SEK 85,000, more than the adjusted net: each line
   * also carries the cash that party collected and the deductions taken off them"* while the
   * co-operator's −SEK 15,000 was nowhere on the page. Branch 1 could not catch it: it fires on
   * `withheldPayees`, which is parties this reader PAYS, and a co-operator with a negative net
   * pays IN. The rule was right and its trigger covered one direction.
   */
  it("names a withheld PARTY when the list is structurally short, not the cash and deductions", () => {
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 8_500_000n,
      adjustedNetMinor: 7_000_000n,
      withheldPartyCount: 1,
      // Both non-zero, so the old branch would happily have fired and did.
      collectedMinor: 9_000_000n,
      deductiblesMinor: 500_000n,
    });
    expect(sentence).toContain("one party on this night whose settlement is not shared with you");
    expect(sentence).toContain("does not sum to the pool");
    // And NOT the cause it used to claim.
    expect(sentence).not.toContain("the cash that party collected");
  });

  it("counts more than one, and says so in the plural", () => {
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 8_500_000n,
      adjustedNetMinor: 7_000_000n,
      withheldPartyCount: 3,
    });
    expect(sentence).toContain("3 parties on this night whose settlements are not shared with you");
  });

  it("still lets a withheld PAYEE speak first — it names an amount, this only names a count", () => {
    // Both true at once is the ordinary co-promotion: a party owed money and unreadable. The
    // more specific sentence wins, which is the order the branches were already in.
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 4_400_000n,
      adjustedNetMinor: 5_000_000n,
      withheldMinor: 600_000n,
      withheldPartyCount: 2,
    });
    expect(sentence).toContain("At least SEK 6,000");
    expect(sentence).not.toContain("does not sum to the pool");
  });

  it("claims NO cause when the figures support none — the whole lesson", () => {
    const sentence = entitlementGapSentence({
      ...base,
      entitlementsMinor: 8_500_000n,
      adjustedNetMinor: 8_000_000n,
    });
    expect(sentence).toBe(
      "The entitlements below come to SEK 85,000, more than the adjusted net. The percentages are shares of the entitlements shown.",
    );
  });

  it("says which way the difference runs", () => {
    expect(
      entitlementGapSentence({ ...base, entitlementsMinor: 100n, adjustedNetMinor: 200n }),
    ).toContain("less than the adjusted net");
    expect(
      entitlementGapSentence({ ...base, entitlementsMinor: 200n, adjustedNetMinor: 100n }),
    ).toContain("more than the adjusted net");
  });
});

/**
 * A CAPTION ON SOMEBODY ELSE'S CARD (QA sweep run 6, QA6-9).
 *
 * These sentences were written for the reader's own card and were not person-aware.
 * Full settlement access (#24.2) puts another party's card in front of a reader, and
 * *"Plus the money you collected on the night — SEK 100,000"* then appeared on a
 * performer's screen under the OPERATOR's name.
 */
describe("entitlementRules — whose card is it", () => {
  const computed = {
    entitlement: "2500000",
    collected: "10000000",
    deductibles: "350000",
    net: "2500000",
    lines: [],
  } as unknown as Parameters<typeof entitlementRules>[0];

  /*
   * The cash sentence moved to `payoutAdjustments` with the row (QA8-5), so the
   * person-awareness is asserted on BOTH builders — the finding is about the pronoun, and
   * it applies wherever the sentence lives.
   */
  it("says 'you' on the reader's own card", () => {
    const labels = entitlementRules(computed, "SEK").map((rule) => rule.label);
    expect(labels).toContain("Less costs somebody else fronted on your behalf");
    const cash = payoutAdjustments(computed, "SEK").map((row) => row.label);
    expect(cash).toContain("Less the money you collected on the night");
  });

  it("names the party on anybody else's", () => {
    const other = { isYours: false, name: "The Lantern Hall" };
    const labels = entitlementRules(computed, "SEK", undefined, other).map((rule) => rule.label);
    expect(labels).toContain("Less costs somebody else fronted on The Lantern Hall's behalf");
    const cash = payoutAdjustments(computed, "SEK", undefined, other).map((row) => row.label);
    expect(cash).toContain("Less the money The Lantern Hall collected on the night");
    // And never the reader, on either half of the card.
    expect([...labels, ...cash].join(" ")).not.toMatch(/\byou\b/);
  });

  it("falls back to a phrase rather than an empty possessive", () => {
    // A party whose name this reader may not see still gets a readable sentence.
    const nameless = { isYours: false, name: "" };
    const cash = payoutAdjustments(computed, "SEK", undefined, nameless).map((row) => row.label);
    expect(cash).toContain("Less the money that party collected on the night");
    const labels = entitlementRules(computed, "SEK", undefined, nameless).map((rule) => rule.label);
    expect(labels).toContain("Less costs somebody else fronted on that party's behalf");
  });
});

/**
 * A NEGATIVE NET IS A DEBT, NOT A PAYOUT (QA7-28).
 *
 * The Settlement tab's headline used to be the reader's entitlement under a fixed
 * "Your payout". An operator owing SEK 45,000 across two transfers read "SEK 0 ·
 * Your payout"; an act entitled to 30,000 against a 3,000 advance read 30,000 while
 * 27,000 moved. The figure is now the net, so the label has to follow its sign.
 */
describe("ownFigureLabel", () => {
  it("calls money coming to the reader their payout", () => {
    expect(ownFigureLabel("positive")).toBe("Your payout");
  });

  it("says a party with a negative net OWES, rather than calling it a payout", () => {
    expect(ownFigureLabel("negative")).toBe("You owe");
  });

  it("leaves a settled zero labelled as a payout", () => {
    // Nothing moves either way, and a labelled zero says that without a sentence of
    // its own. "You owe SEK 0" would invent a debt.
    expect(ownFigureLabel("neutral")).toBe("Your payout");
  });
});

/**
 * ONE SENTENCE, ONE BASIS FOR COMPARISON (QA sweep run 7, QA7-24).
 *
 * Previewed in another currency, every amount on the card converts and carries `≈`, while
 * this sentence rendered the contract's figures in the deal's own payout currency — so a
 * card read *"The 70% door share beats the SEK 18,000 guarantee"* beside `≈ €6,731`,
 * inviting a comparison across two currencies. A contract figure now carries both, payout
 * currency first, because that is the number in the agreement and a live rate is cosmetic
 * (`docs/money.md`).
 */
describe("describeBasis — a contract figure in a converted card", () => {
  /*
   * `Intl.NumberFormat` puts a NON-BREAKING space (U+00A0) between a currency code and its
   * number, so `formatMoney` returns "SEK\u00a018,000" and a naive string comparison
   * against a typed "SEK 18,000" fails while printing two identical-looking values. Worth
   * one line in every test that compares formatted money, and worth knowing before chasing
   * a difference that renders as nothing.
   */
  const plain = (text: string) => text.replace(/\u00a0/g, " ");
  const basis = {
    kind: "guarantee_vs_door",
    won: "door",
    basisPoints: 7000,
    guarantee: "1800000",
  } as unknown as Parameters<typeof describeBasis>[0];

  /**
   * TWO SENTENCES FOR A RENTAL (decisions §25.7.1, Daniel 2026-09-28).
   *
   * Before the ruling there was one, and it asserted the waterfall: *"settled off the top"*. A
   * rental whose deal names a payer does not touch the pool at all, and that sentence was printed
   * on the PAYER's card beside a negative figure — telling a party that money it was paying had
   * come off a net the rental never reduced.
   *
   * `borneByPayer` rides on the basis rather than being worked out by each screen, which is the
   * only reason this is one assertion and not one per caller.
   */
  it("distinguishes a rental the pool paid from one its parties settled", () => {
    const pooled = { kind: "rental", rental: "500000" } as unknown as Parameters<
      typeof describeBasis
    >[0];
    const betweenParties = {
      kind: "rental",
      rental: "500000",
      borneByPayer: true,
    } as unknown as Parameters<typeof describeBasis>[0];
    expect(plain(describeBasis(pooled, "SEK"))).toBe("Rental of SEK 5,000, settled off the top");
    expect(plain(describeBasis(betweenParties, "SEK"))).toBe(
      "Rental of SEK 5,000, settled between its parties",
    );
    // The figure itself is the deal's either way, and converts the same.
    expect(plain(describeBasis(betweenParties, "SEK", () => "≈ €440"))).toContain("(≈ €440)");
  });

  /*
   * AND EVERY OTHER KIND SAYS IT TOO (decisions §25.9.6).
   *
   * `borneByPayer` was askable only of a `rental` while a rental was the only deal a payer could
   * bear. §25.9.6 makes any deal with a named payer borne by them, so a guarantee, a door split and
   * a guarantee-vs-door can all carry it — and this is the lock that says the suffix reaches them
   * rather than just the branch it was written in.
   *
   * The pooled forms are asserted beside each borne one, because a suffix appended unconditionally
   * would pass every assertion above and be wrong on every ordinary deal in the app.
   */
  it("says who bore it on a guarantee, a door split and a guarantee-vs-door", () => {
    const as = (value: object) => value as unknown as Parameters<typeof describeBasis>[0];
    const borne = (kind: object) =>
      plain(describeBasis(as({ ...kind, borneByPayer: true }), "SEK"));
    const pooled = (kind: object) => plain(describeBasis(as(kind), "SEK"));

    const guarantee = { kind: "guarantee", guarantee: "400000" };
    expect(pooled(guarantee)).toBe("Guaranteed SEK 4,000");
    expect(borne(guarantee)).toBe("Guaranteed SEK 4,000, settled between its parties");

    const doorSplit = { kind: "door_split", basisPoints: 7000, base: "10500000" };
    expect(pooled(doorSplit)).toBe("70% of the adjusted net SEK 105,000");
    expect(borne(doorSplit)).toBe(
      "70% of the adjusted net SEK 105,000, settled between its parties",
    );

    const versus = {
      kind: "guarantee_vs_door",
      won: "guarantee",
      guarantee: "1800000",
      door: "1000000",
      basisPoints: 7000,
      base: "10500000",
    };
    expect(borne(versus)).toBe(
      "The SEK 18,000 guarantee beats the 70% door share, settled between its parties",
    );
    expect(pooled(versus)).toBe("The SEK 18,000 guarantee beats the 70% door share");
  });

  it("names only the payout currency when nothing is being converted", () => {
    // Every caller on a card in its own currency, which is the ordinary case.
    expect(plain(describeBasis(basis, "SEK"))).toBe(
      "The 70% door share beats the SEK 18,000 guarantee",
    );
  });

  it("is unchanged when the converting formatter agrees with the payout rendering", () => {
    /*
     * THE REAL DEFAULT, not a lookalike. `formatAmount` defaults to
     * `(minor) => formatMoney(minor, currency)`, and a card previewing its OWN currency
     * must not sprout a parenthetical repeating itself.
     *
     * A hand-rolled formatter here passed a plain space where `Intl` emits U+00A0, so the
     * two renderings differed by an invisible character and the parenthetical appeared —
     * a test failing over the thing it was written to prove absent. Comparing against the
     * function the caller actually passes is the only version of this that means anything.
     */
    const same = (minor: string) => formatMoney(minor, "SEK");
    expect(plain(describeBasis(basis, "SEK", same))).toBe(
      "The 70% door share beats the SEK 18,000 guarantee",
    );
  });

  it("carries both figures when the card is previewed in another currency", () => {
    const toEuros = () => "≈ €1,554";
    expect(plain(describeBasis(basis, "SEK", toEuros))).toBe(
      "The 70% door share beats the SEK 18,000 (≈ €1,554) guarantee",
    );
  });

  it("does the same on the guarantee arm and on a named base", () => {
    const toEuros = () => "≈ €4,315";
    const guaranteeWon = { ...basis, won: "guarantee" } as typeof basis;
    expect(plain(describeBasis(guaranteeWon, "SEK", toEuros))).toContain("SEK 18,000 (≈ €4,315)");

    const doorSplit = {
      kind: "door_split",
      basisPoints: 2000,
      base: "5000000",
    } as unknown as Parameters<typeof describeBasis>[0];
    expect(plain(describeBasis(doorSplit, "SEK", toEuros))).toBe(
      "20% of the adjusted net SEK 50,000 (≈ €4,315)",
    );
  });

  it("leaves a redacted base alone — there is no figure to convert", () => {
    // story.md:44 — a party who may not read the event's takings gets the rule and no
    // figure, and adding a parenthetical to a missing number is the obvious wrong turn.
    const redacted = {
      kind: "door_split",
      basisPoints: 2000,
      base: null,
    } as unknown as Parameters<typeof describeBasis>[0];
    expect(plain(describeBasis(redacted, "SEK", () => "≈ €1"))).toBe("20% of the adjusted net");
  });
});

/**
 * ONE SHAPE FOR A NEGATIVE FIGURE (QA sweep run 9, QA9-14).
 *
 * Five call sites drew their own — four `− ${value}` and one `−${value}` — so one card printed
 * `−SEK 12,000` in its line items and `− SEK 33,000` in its summary rows beneath. QA8-12 had
 * unified the GLYPH and left the spacing, and the comment beside the odd one out claimed the
 * two already agreed.
 */
describe("negativeAmount", () => {
  it("uses the MINUS SIGN and a space, not a hyphen", () => {
    const rendered = negativeAmount("SEK 12,000");
    expect(rendered).toBe("− SEK 12,000");
    // U+2212, asserted by codepoint because the two glyphs are a pixel apart on screen and
    // identical in a diff.
    expect(rendered.codePointAt(0)).toBe(0x2212);
    expect(rendered.codePointAt(1)).toBe(0x20);
    expect(rendered).not.toContain("-");
  });

  it("does not care what the amount looks like", () => {
    // It is handed already-formatted money by every caller, including a converted "≈ €1,554".
    expect(negativeAmount("≈ €1,554")).toBe("− ≈ €1,554");
  });
});

/**
 * THE COUNT ITSELF — `approvals` minus the settlements this reader was served.
 *
 * The answer was in the payload all along: `approvals` is built from every party with a
 * settlement row, because the route decided that addressing somebody is not reading their money.
 * No screen asked it until QA11-2.
 */
describe("withheldPartyCount", () => {
  const approvals = [
    { participantId: "host" },
    { participantId: "cohost" },
    { participantId: "act" },
    { participantId: "crew" },
  ];

  it("counts the parties on the night this reader has no settlement for", () => {
    expect(withheldPartyCount(approvals, ["host", "act"])).toBe(2);
  });

  it("is zero when the reader can read them all", () => {
    expect(withheldPartyCount(approvals, ["host", "cohost", "act", "crew"])).toBe(0);
  });

  it("ignores a settlement row with no participant — a representation is not a party", () => {
    // The agent's private commission row is representation-scoped and carries no
    // `participantId`; counting it as "visible" would hide a genuinely withheld party.
    expect(withheldPartyCount(approvals, ["host", null, undefined, "act"])).toBe(2);
  });

  it("answers zero for an empty roster rather than guessing", () => {
    expect(withheldPartyCount([], ["host"])).toBe(0);
  });
});

/**
 * THE PANEL'S ONE SENTENCE, and the two readers it was wrong about (QA sweep run 11).
 *
 * `co.host@` with Full settlement access read *"As operator your share is retained; below are the
 * amounts payable to the other parties"* while collecting SEK 0, holding nothing, owing SEK 12,000
 * IN, and paying nobody. The predicate was `isYours && net < 0` — a converse error, with the rule
 * stated correctly in the comment right above it: holding implies a negative net, and a negative
 * net does not imply holding.
 *
 * Fixing that exposed the second: with `retained` false, the same reader got *"What this event pays
 * out, including your own share"*, and their share is not in the list at all.
 */
describe("payoutsCaption", () => {
  const base = {
    readerCollected: false,
    readerOwesOut: false,
    includesOthers: false,
    includesYours: false,
  };

  it("says the share is retained only to the party actually holding the money", () => {
    expect(
      payoutsCaption({ ...base, readerCollected: true, readerOwesOut: true, includesOthers: true }),
    ).toContain("your share is retained");
  });

  it("does NOT say it to a co-operator who owes money in and collected nothing", () => {
    // The sweep's exact reader: net −12,000, collected 0, Marlo's 90,000 the only row listed.
    const caption = payoutsCaption({
      ...base,
      readerCollected: false,
      readerOwesOut: true,
      includesOthers: true,
    });
    expect(caption).not.toContain("retained");
    // …and not the other wrong one either: their share is not in that list.
    expect(caption).not.toContain("including your own share");
    expect(caption).toBe(
      "What this event pays out to the other parties. Your own settlement is separate.",
    );
  });

  it("names both when the list carries the reader's money and somebody else's", () => {
    // An agent reading their client's payout beside their own commission — the case that put
    // this branch here.
    expect(payoutsCaption({ ...base, includesOthers: true, includesYours: true })).toBe(
      "What this event pays out, including your own share.",
    );
  });

  it("calls it the reader's when the list is only theirs", () => {
    expect(payoutsCaption({ ...base, includesYours: true })).toBe(
      "What is payable to you on this event.",
    );
  });

  it("does not call an operator who FRONTED the costs a retainer of anything", () => {
    // Collected nothing, paid everything, net negative: out of pocket rather than holding, and
    // `collected > 0` is what keeps them out of a sentence that would be wrong about them.
    const caption = payoutsCaption({
      ...base,
      readerCollected: false,
      readerOwesOut: true,
      includesOthers: true,
    });
    expect(caption).not.toContain("retained");
  });
});

/*
 * THE BADGE READS THE FREEZE, NOT ONLY THE STATUS — QA sweep run 17, QA17-3.
 *
 * Run 16 taught the rail, the caption and the signature button that a finalized night stays
 * finalized when a party disputes it; the one-word badge was the last surface still reading `status`
 * alone, so a red **Dispute** pill sat in the same viewport as the green *"Finalized — figures and
 * rates locked, with an objection on record"* caption.
 */
describe("settlementStatusToDisplay", () => {
  it("badges a disputed night that was finalized as Finalized", () => {
    expect(settlementStatusToDisplay("dispute", true)).toEqual({
      status: "confirmed",
      label: "Finalized",
    });
  });

  /*
   * AND IT IS NOT NEW-FOUND CERTAINTY. A dispute on a night nobody ever finalized still reads as a
   * dispute — the half a test that only asserted the fix would have missed, and the same shape that
   * has caught this file twice before.
   */
  it("still badges a dispute that was never finalized as a dispute", () => {
    expect(settlementStatusToDisplay("dispute")).toEqual({
      status: "cancelled",
      label: "Disputed",
    });
    expect(settlementStatusToDisplay("dispute", false).label).toBe("Disputed");
  });

  /*
   * AND A STATUS THAT COMES AFTER THE FREEZE KEEPS ITS OWN WORD. `paid` and `partly_paid` are only
   * reachable through a finalize, so "Finalized" would read as a step backwards on money that has
   * already moved — the clause that makes this a precedence rule rather than an override.
   */
  it("does not overwrite a status that comes after the finalize", () => {
    expect(settlementStatusToDisplay("paid", true).label).toBe("Paid");
    expect(settlementStatusToDisplay("partly_paid", true).label).toBe("Partly paid");
    expect(settlementStatusToDisplay("finalized", true).label).toBe("Finalized");
  });
});
