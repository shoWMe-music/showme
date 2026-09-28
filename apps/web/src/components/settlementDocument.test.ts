import { describe, expect, it } from "vitest";
import {
  entitlementGapSentence,
  entitlementRules,
  matchingSettlements,
  ownFigureLabel,
  settlementTotals,
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
 * THE COLUMN HAS TO ADD UP TO ITS OWN HEADLINE (QA sweep run 2, 2026-09-26).
 *
 * The engine's `entitlement` is `deal lines + revenue you collected − costs fronted
 * for you`. The card printed the first and the last, so a party who collected
 * anything read a headline its rows could not reach: a SEK 33,600 headline over rows
 * of 32,100 and −3,500, with the SEK 5,000 sponsorship they took at the door
 * appearing nowhere. Verified against a live breakdown of the same shape:
 * entitlement 31,500 = 30,000 + 5,000 − 3,500.
 */
describe("entitlementRules", () => {
  const money = (minor: string) => `SEK ${(Number(minor) / 100).toLocaleString("en-IE")}`;

  it("shows the money the party collected, so the rows reach the headline", () => {
    const rules = entitlementRules(
      {
        entitlement: "3150000",
        collected: "500000",
        deductibles: "350000",
        lines: [],
      } as never,
      "SEK",
      money,
    );

    const collected = rules.find((rule) => rule.key === "collected");
    expect(collected).toBeDefined();
    expect(collected?.value).toBe("SEK 5,000");
    expect(collected?.negative).toBeFalsy();

    // Reads in the engine's own order: what you collected before what came off you.
    const keys = rules.map((rule) => rule.key);
    expect(keys.indexOf("collected")).toBeLessThan(keys.indexOf("deductibles"));
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
  const item = (status: string, entitlement: string) => ({
    id: status,
    version: 1,
    participantId: null,
    net: entitlement,
    status,
    entitlement,
    currency: "SEK",
    event: { id: status, status: "concluded", title: status, eventDate: null },
  });

  it("counts paid money as paid and says nothing about it being settled", () => {
    const totals = settlementTotals([item("finalized", "2070000"), item("open", "159000")]);
    expect(plain(totals.paid)).toBe("SEK 0");
    expect(plain(totals.finalized)).toBe("SEK 20,700");
    // Outstanding is everything not paid — the finalized money included, because it
    // has not moved.
    expect(plain(totals.outstanding)).toBe("SEK 22,290");
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
describe("entitlementGapSentence", () => {
  const format = (minor: string) => `SEK ${(Number(minor) / 100).toLocaleString("en-US")}`;
  const base = {
    withheldMinor: 0n,
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

  it("says 'you' on the reader's own card", () => {
    const labels = entitlementRules(computed, "SEK").map((rule) => rule.label);
    expect(labels).toContain("Plus the money you collected on the night");
    expect(labels).toContain("Less costs somebody else fronted on your behalf");
  });

  it("names the party on anybody else's", () => {
    const labels = entitlementRules(computed, "SEK", undefined, {
      isYours: false,
      name: "The Lantern Hall",
    }).map((rule) => rule.label);
    expect(labels).toContain("Plus the money The Lantern Hall collected on the night");
    expect(labels).toContain("Less costs somebody else fronted on The Lantern Hall's behalf");
    // And never the reader.
    expect(labels.join(" ")).not.toMatch(/\byou\b/);
  });

  it("falls back to a phrase rather than an empty possessive", () => {
    // A party whose name this reader may not see still gets a readable sentence.
    const labels = entitlementRules(computed, "SEK", undefined, {
      isYours: false,
      name: "",
    }).map((rule) => rule.label);
    expect(labels).toContain("Plus the money that party collected on the night");
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
