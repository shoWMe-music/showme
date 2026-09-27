import { describe, expect, it } from "vitest";
import { entitlementRules, matchingSettlements, settlementTotals } from "./settlementDocument";

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
