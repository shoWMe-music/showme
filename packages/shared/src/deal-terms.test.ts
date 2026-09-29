import { describe, expect, it } from "vitest";
import {
  DEAL_KIND_OPTIONS,
  DEAL_STRUCTURE_OPTIONS,
  type DealDraft,
  type DealPartyDraft,
  createDealPayload,
  dealDeletability,
  dealDraftFrom,
  dealDraftNotices,
  dealDraftProblems,
  dealKindLabel,
  dealKindOf,
  dealTypeForKind,
  emptyDealDraft,
  percentToBasisPoints,
  readTermsTemplateText,
  sealedTermsReason,
  shareBasisPointsOf,
  structureForKind,
  termsAreSealed,
  termsTemplatePayload,
} from "./deal-terms";

/** A guarantee deal between an operator and one act — the ordinary case. */
function guaranteeDraft(): DealDraft {
  return {
    ...emptyDealDraft("EUR"),
    name: "Headline fee",
    structure: "guarantee",
    guaranteeAmount: "3000",
    parties: [
      { key: "a", participantId: "operator", roleInDeal: "payer", sharePercent: "" },
      { key: "b", participantId: "act", roleInDeal: "payee", sharePercent: "" },
    ],
  };
}

/** A door split with Ran's ladder on it (ClickUp `123qy9rnwud`). */
function ladderDraft(): DealDraft {
  return {
    ...emptyDealDraft("EUR"),
    name: "Door split with escalators",
    structure: "door_split",
    splitPercent: "60",
    escalators: [
      { key: "e1", thresholdSold: "900", splitPercent: "80" },
      { key: "e2", thresholdSold: "300", splitPercent: "70" },
    ],
    parties: [
      { key: "a", participantId: "operator", roleInDeal: "payer", sharePercent: "" },
      { key: "b", participantId: "act", roleInDeal: "payee", sharePercent: "" },
    ],
  };
}

describe("the ladder, as the form holds it", () => {
  it("sends the bands in order, whatever order they were typed in", () => {
    // `deals.terms` is read by people as well as by the engine, and a ladder listed
    // out of order reads as a mistake. The engine sorts either way.
    expect(createDealPayload(ladderDraft()).terms).toEqual({
      escalators: [
        { thresholdSold: 300, splitBasisPoints: 7000 },
        { thresholdSold: 900, splitBasisPoints: 8000 },
      ],
    });
  });

  it("sends no terms at all when the deal states none", () => {
    // An ordinary agreement must not carry an empty object into `deals.terms`.
    expect(createDealPayload(guaranteeDraft()).terms).toBeUndefined();
  });

  it("drops a half-typed band rather than sending a nonsense one", () => {
    const half = {
      ...ladderDraft(),
      escalators: [{ key: "e1", thresholdSold: "300", splitPercent: "" }],
    };
    expect(createDealPayload(half).terms).toBeUndefined();
    expect(dealDraftProblems(half)).toContainEqual(
      "A band's split is a percentage between 0 and 100.",
    );
  });

  it("refuses two bands starting at the same ticket count", () => {
    const clashing = {
      ...ladderDraft(),
      escalators: [
        { key: "e1", thresholdSold: "300", splitPercent: "70" },
        { key: "e2", thresholdSold: "300", splitPercent: "80" },
      ],
    };
    expect(dealDraftProblems(clashing)).toContainEqual(
      "Two bands cannot start at the same number of tickets.",
    );
  });

  it("refuses a ladder on a deal with no split to escalate", () => {
    const onGuarantee = { ...guaranteeDraft(), escalators: ladderDraft().escalators };
    expect(dealDraftProblems(onGuarantee)).toContainEqual(
      "A band changes the SPLIT, so it needs a deal that has one — a guarantee pays the same whatever the night does.",
    );
    // …and nothing is sent, so a refusal the operator overrode in some future UI
    // still cannot write a band onto a guarantee.
    expect(createDealPayload(onGuarantee).terms).toBeUndefined();
  });
});

describe("the threshold bonus, as the form holds it", () => {
  it("sends both halves in minor units", () => {
    const withBonus = { ...ladderDraft(), bonusThreshold: "50000", bonusAmount: "2500" };
    expect(createDealPayload(withBonus).terms?.bonusThreshold).toBe("5000000");
    expect(createDealPayload(withBonus).terms?.bonusAmount).toBe("250000");
  });

  it("refuses one half without the other", () => {
    const halfBonus = { ...ladderDraft(), bonusAmount: "2500" };
    expect(dealDraftProblems(halfBonus)).toContainEqual(
      "A bonus needs both halves: what the night has to take, and what it then pays.",
    );
    expect(createDealPayload(halfBonus).terms?.bonusAmount).toBeUndefined();
  });
});

describe("deal draft — what it refuses", () => {
  it("accepts an ordinary guarantee between two parties", () => {
    expect(dealDraftProblems(guaranteeDraft())).toEqual([]);
  });

  it("refuses an unnamed agreement", () => {
    expect(dealDraftProblems({ ...guaranteeDraft(), name: "  " })).toContainEqual(
      expect.stringContaining("name"),
    );
  });

  it("refuses a fixed-amount structure with no amount", () => {
    expect(dealDraftProblems({ ...guaranteeDraft(), guaranteeAmount: "" })).toContainEqual(
      expect.stringContaining("fixed amount"),
    );
  });

  it("refuses a door split outside 0–100%", () => {
    const draft: DealDraft = { ...guaranteeDraft(), structure: "door_split", splitPercent: "140" };
    expect(dealDraftProblems(draft)).toContainEqual(expect.stringContaining("between 0 and 100"));
  });

  it("refuses an advance larger than the guarantee it is part of", () => {
    expect(dealDraftProblems({ ...guaranteeDraft(), advanceAmount: "4000" })).toContainEqual(
      expect.stringContaining("cannot exceed"),
    );
  });

  it("refuses the same participant on two lines", () => {
    const draft = guaranteeDraft();
    draft.parties[1] = {
      key: "b",
      participantId: "operator",
      roleInDeal: "payee",
      sharePercent: "",
    };
    expect(dealDraftProblems(draft)).toContainEqual(expect.stringContaining("only one line"));
  });

  /**
   * CHANGED DELIBERATELY, 2026-08-31. This used to assert that a settling deal
   * paying nobody was REFUSED ("Nobody on this agreement is paid by it…"). That
   * rule is what stopped a standalone operator from writing a deal at all —
   * alone on their own event the only party they can name is themselves, and the
   * refusal then demanded they mark themselves "Is paid". The deal is now
   * allowed and says so out loud instead (`dealDraftNotices`); the money is
   * unaffected, which `apps/api/src/settlement.test.ts` proves with Σ net = 0.
   */
  it("allows a settling deal that pays nobody — the standalone operator's record", () => {
    const draft = guaranteeDraft();
    draft.parties[1] = { key: "b", participantId: "act", roleInDeal: "observer", sharePercent: "" };
    expect(dealDraftProblems(draft)).toEqual([]);
  });

  it("says out loud that a deal paying nobody will not be computed", () => {
    const draft = guaranteeDraft();
    draft.parties[1] = { key: "b", participantId: "act", roleInDeal: "observer", sharePercent: "" };
    expect(dealDraftNotices(draft)).toContainEqual(
      expect.stringContaining("shoWMe will not compute it"),
    );
    // And nothing to say about the ordinary two-party case.
    expect(dealDraftNotices(guaranteeDraft())).toEqual([]);
  });

  it("names the manual case in its own words when the shape is paper-only", () => {
    const draft = guaranteeDraft();
    draft.structure = null;
    draft.guaranteeAmount = "";
    draft.parties[1] = { key: "b", participantId: "act", roleInDeal: "observer", sharePercent: "" };
    expect(dealDraftNotices(draft)).toContainEqual(
      expect.stringContaining("no figure from it reaches the settlement"),
    );
  });

  /**
   * The ONE shape the relaxation had to keep refusing. `reconcile()` throws a bare
   * Error on an advance with no payee, so accepting this would trade a sentence
   * for a 500 on every compute of that event from then on.
   */
  it("refuses money declared already paid with nobody it was paid to", () => {
    const draft = guaranteeDraft();
    draft.parties[1] = { key: "b", participantId: "act", roleInDeal: "observer", sharePercent: "" };
    draft.advanceAmount = "1000";
    expect(dealDraftProblems(draft)).toContainEqual(
      expect.stringContaining("names nobody it was paid to"),
    );
  });

  it("refuses the same thing stated as before_event timing rather than an advance", () => {
    const draft = guaranteeDraft();
    draft.parties[1] = { key: "b", participantId: "act", roleInDeal: "observer", sharePercent: "" };
    draft.paymentTiming = "before_event";
    expect(dealDraftProblems(draft)).toContainEqual(
      expect.stringContaining("names nobody it was paid to"),
    );
  });

  it("allows a paper agreement that pays nobody", () => {
    const draft = guaranteeDraft();
    draft.structure = null;
    draft.guaranteeAmount = "";
    draft.parties[1] = { key: "b", participantId: "act", roleInDeal: "observer", sharePercent: "" };
    expect(dealDraftProblems(draft)).toEqual([]);
  });

  it("refuses an agent taking an entitled line (decisions #14)", () => {
    const draft = guaranteeDraft();
    draft.parties.push({ key: "c", participantId: "agent", roleInDeal: "payee", sharePercent: "" });
    expect(dealDraftProblems(draft, ["agent"])).toContainEqual(
      expect.stringContaining("never an entitled party"),
    );
  });

  it("lets an agent observe", () => {
    const draft = guaranteeDraft();
    draft.parties.push({
      key: "c",
      participantId: "agent",
      roleInDeal: "observer",
      sharePercent: "",
    });
    expect(dealDraftProblems(draft, ["agent"])).toEqual([]);
  });
});

describe("deal draft — shared splits", () => {
  /** Two acts dividing one payout — the case a one-performer screen cannot express. */
  function sharedSplitDraft(firstShare: string, secondShare: string): DealDraft {
    return {
      ...emptyDealDraft("EUR"),
      name: "Door split",
      type: "split",
      structure: "door_split",
      splitPercent: "70",
      parties: [
        { key: "a", participantId: "operator", roleInDeal: "payer", sharePercent: "" },
        { key: "b", participantId: "act-a", roleInDeal: "split_member", sharePercent: firstShare },
        { key: "c", participantId: "act-b", roleInDeal: "split_member", sharePercent: secondShare },
      ],
    };
  }

  it("accepts shares that divide the payout exactly", () => {
    expect(dealDraftProblems(sharedSplitDraft("60", "40"))).toEqual([]);
  });

  it("refuses shares that do not add to 100%", () => {
    expect(dealDraftProblems(sharedSplitDraft("60", "30"))).toContainEqual(
      expect.stringContaining("90.00%"),
    );
  });

  it("refuses one stated share beside one unstated — the 6000-versus-1 trap", () => {
    // The engine defaults an unstated weight to 1, so this settles 6000:1, not 60:40.
    expect(dealDraftProblems(sharedSplitDraft("60", ""))).toContainEqual(
      expect.stringContaining("every one of them has to state its share"),
    );
  });

  it("writes a share on every entitled line, and none on the payer", () => {
    const payload = createDealPayload(sharedSplitDraft("60", "40"));
    expect(payload.parties).toEqual([
      { participantId: "operator", roleInDeal: "payer" },
      { participantId: "act-a", roleInDeal: "split_member", share: { splitBasisPoints: 6000 } },
      { participantId: "act-b", roleInDeal: "split_member", share: { splitBasisPoints: 4000 } },
    ]);
  });

  it("states no share when a single payee takes the whole payout", () => {
    const payload = createDealPayload(guaranteeDraft());
    expect(payload.parties[1]).toEqual({ participantId: "act", roleInDeal: "payee" });
  });
});

describe("deal draft — the request body", () => {
  it("sends money as minor units and percentages as basis points", () => {
    const draft: DealDraft = {
      ...guaranteeDraft(),
      structure: "guarantee_vs_door",
      guaranteeAmount: "2500.50",
      splitPercent: "70",
      advanceAmount: "500",
    };
    const payload = createDealPayload(draft);
    expect(payload.guaranteeAmount).toBe("250050");
    expect(payload.advanceAmount).toBe("50000");
    expect(payload.splitBasisPoints).toBe(7000);
    expect(payload.structure).toBe("guarantee_vs_door");
  });

  it("omits the structure entirely for a paper agreement", () => {
    const payload = createDealPayload({
      ...guaranteeDraft(),
      structure: null,
      guaranteeAmount: "",
    });
    expect(payload.structure).toBeUndefined();
    expect(payload.guaranteeAmount).toBeUndefined();
  });

  it("drops a fixed amount the chosen structure does not settle against", () => {
    const payload = createDealPayload({
      ...guaranteeDraft(),
      structure: "door_split",
      splitPercent: "70",
      guaranteeAmount: "3000",
    });
    expect(payload.guaranteeAmount).toBeUndefined();
    expect(payload.splitBasisPoints).toBe(7000);
  });
});

describe("percent conversion", () => {
  it("rounds to whole basis points", () => {
    expect(percentToBasisPoints("33.335")).toBe(3334);
    expect(percentToBasisPoints("")).toBeNull();
    expect(percentToBasisPoints("abc")).toBeNull();
  });

  it("reads a stated share off a serialized deal party", () => {
    expect(shareBasisPointsOf({ splitBasisPoints: 4000 })).toBe(4000);
    expect(shareBasisPointsOf({ terms: "net 30" })).toBeNull();
    expect(shareBasisPointsOf(null)).toBeNull();
  });
});

describe("the single deal-kind menu", () => {
  /** Two party lines, as the composer holds them, with the given roles. */
  function lines(...roles: DealPartyDraft["roleInDeal"][]): DealPartyDraft[] {
    return roles.map((roleInDeal, index) => ({
      key: `line-${index}`,
      participantId: `party-${index}`,
      roleInDeal,
      sharePercent: "",
    }));
  }

  it("offers exactly the shapes the product owner named, plus the manual one", () => {
    expect(DEAL_KIND_OPTIONS.map((option) => option.value)).toEqual([
      "guarantee",
      "door_split",
      "guarantee_vs_door",
      "rental",
      "service_fee",
      "paper_only",
    ]);
  });

  it("settles a service fee as a guarantee, and computes nothing for the manual one", () => {
    expect(structureForKind("service_fee")).toBe("guarantee");
    expect(structureForKind("paper_only")).toBeNull();
    expect(structureForKind("guarantee_vs_door")).toBe("guarantee_vs_door");
  });

  it("derives the deal TYPE from the kind, so nobody is asked twice", () => {
    expect(dealTypeForKind("guarantee", lines("payer", "payee"))).toBe("performance");
    expect(dealTypeForKind("rental", lines("payee", "payer"))).toBe("rental");
    expect(dealTypeForKind("service_fee", lines("payer", "payee"))).toBe("fee");
  });

  it("calls a payout divided between two entitled lines a shared split", () => {
    expect(dealTypeForKind("door_split", lines("payer", "split_member", "split_member"))).toBe(
      "split",
    );
    // A rental or a fee keeps its own word — two crew on one invoice is still a fee.
    expect(dealTypeForKind("service_fee", lines("payer", "payee", "payee"))).toBe("fee");
  });

  it("ignores party lines that have not chosen a participant yet", () => {
    const half: DealPartyDraft[] = [
      { key: "a", participantId: "operator", roleInDeal: "payer", sharePercent: "" },
      { key: "b", participantId: "act", roleInDeal: "payee", sharePercent: "" },
      { key: "c", participantId: "", roleInDeal: "payee", sharePercent: "" },
    ];
    expect(dealTypeForKind("guarantee", half)).toBe("performance");
  });

  it("reads a stored deal back into the menu's own words", () => {
    expect(dealKindLabel("fee", "guarantee")).toBe("Fee for a service");
    expect(dealKindLabel("performance", "guarantee")).toBe("Guarantee");
    expect(dealKindLabel("split", "door_split")).toBe("Door split");
    expect(dealKindLabel("performance", null)).toBe("Other — agreed manually");
  });

  it("names the manually-agreed option in the words it was asked for", () => {
    const manual = DEAL_KIND_OPTIONS.find((option) => option.value === "paper_only");
    expect(manual?.label).toBe("Other — agreed manually");
    // It has to SAY that nothing is computed — that is the whole difference
    // between it and a shape the engine settles (decisions #16.2).
    expect(manual?.description).toContain("will not compute");
  });

  it("keeps the settlement-shape list to the kinds that ARE a shape", () => {
    // The Create-Event wizard offers these; a service fee is a guarantee wearing a
    // different word, so offering it there would be the same shape twice.
    expect(DEAL_STRUCTURE_OPTIONS.map((option) => option.value)).toEqual([
      "guarantee",
      "door_split",
      "guarantee_vs_door",
      "rental",
      null,
    ]);
  });
});

describe("terms & conditions templates", () => {
  it("stores the text, trimmed, and reads it back", () => {
    const payload = termsTemplatePayload("  Cancellation: 30 days.  ");
    expect(payload).toEqual({ text: "Cancellation: 30 days." });
    expect(readTermsTemplateText(payload)).toBe("Cancellation: 30 days.");
  });

  it("degrades an unreadable stored payload to an empty box, never a throw", () => {
    expect(readTermsTemplateText(null)).toBe("");
    expect(readTermsTemplateText("just a string")).toBe("");
    expect(readTermsTemplateText({ text: 42 })).toBe("");
  });
});

/**
 * A STORED DEAL, BACK INTO THE FORM IT WAS TYPED IN (QA8-1).
 *
 * `useDealComposer` seeds from `emptyDealDraft`, so editing an existing deal needs the
 * inverse of `createDealPayload`, and the round trip is the test: read a deal into a draft,
 * send that draft, and the figures must come back identical. The units are what make it
 * worth asserting rather than eyeballing — minor on the wire, major as typed, basis points
 * against a typed percent.
 */
describe("reading a stored deal back into a draft", () => {
  const storedGuarantee = {
    type: "performance",
    structure: "guarantee",
    name: "Headline fee",
    currency: "EUR",
    guaranteeAmount: "300000",
    advanceAmount: "50000",
    splitBasisPoints: null,
    paymentTiming: "at_settlement",
    parties: [
      { participantId: "operator", roleInDeal: "payer", share: null },
      { participantId: "act", roleInDeal: "payee", share: null },
    ],
  };

  it("brings the money back in MAJOR units, as somebody would have typed it", () => {
    const draft = dealDraftFrom(storedGuarantee, "EUR");
    expect(draft.guaranteeAmount).toBe("3000.00");
    expect(draft.advanceAmount).toBe("500.00");
    expect(draft.name).toBe("Headline fee");
    expect(draft.currency).toBe("EUR");
  });

  it("reads the exponent rather than dividing by a hundred", () => {
    /*
     * The bug this exists to prevent, and the one `docs/money.md` names: JPY has NO minor
     * unit, so 300000 minor units is ¥300,000 and not ¥3,000. A hard-coded ÷100 is right
     * for the two-decimal currencies and wrong for every other kind — the same mistake run
     * 3 found on the formatters.
     */
    const yen = dealDraftFrom({ ...storedGuarantee, currency: "JPY" }, "JPY");
    expect(yen.guaranteeAmount).toBe("300000");
    expect(yen.advanceAmount).toBe("50000");
  });

  it("leaves an absent amount BLANK rather than stating a zero", () => {
    // "" is absent and "0" is a stated zero, and `amountToMinor` treats them differently —
    // so writing "0" here would turn a deal with no advance into a deal with an advance of
    // nothing, which is a different agreement.
    const draft = dealDraftFrom({ ...storedGuarantee, advanceAmount: null }, "EUR");
    expect(draft.advanceAmount).toBe("");
    expect(createDealPayload(draft).advanceAmount).toBeUndefined();
  });

  it("round-trips a guarantee through the request body unchanged", () => {
    const payload = createDealPayload(dealDraftFrom(storedGuarantee, "EUR"));
    expect(payload.guaranteeAmount).toBe("300000");
    expect(payload.advanceAmount).toBe("50000");
    expect(payload.structure).toBe("guarantee");
    expect(payload.parties.map((party) => party.roleInDeal)).toEqual(["payer", "payee"]);
  });

  it("round-trips a two-act door split, shares and all", () => {
    const stored = {
      ...storedGuarantee,
      type: "split",
      structure: "door_split",
      guaranteeAmount: null,
      advanceAmount: null,
      splitBasisPoints: 7000,
      parties: [
        { participantId: "operator", roleInDeal: "payer", share: null },
        { participantId: "act-a", roleInDeal: "split_member", share: { splitBasisPoints: 6000 } },
        { participantId: "act-b", roleInDeal: "split_member", share: { splitBasisPoints: 4000 } },
      ],
    };

    const draft = dealDraftFrom(stored, "EUR");
    expect(draft.splitPercent).toBe("70");
    expect(draft.parties.map((party) => party.sharePercent)).toEqual(["", "60", "40"]);

    const payload = createDealPayload(draft);
    expect(payload.splitBasisPoints).toBe(7000);
    // The shares have to survive as basis points, because that is what the engine allocates
    // by — and an unstated share defaults to 1, so a lost 60 would settle 1/40.
    /*
     * `share: { splitBasisPoints }` is the wire shape — the same one `shareBasisPointsOf`
     * reads. The shares must survive as basis points because that is what the engine
     * allocates by, and an UNSTATED share defaults to 1: a lost 60 would settle 1/40, not
     * 60/40.
     */
    expect(
      payload.parties.map(
        (party) => (party.share as { splitBasisPoints?: number } | undefined)?.splitBasisPoints,
      ),
    ).toEqual([undefined, 6000, 4000]);
  });

  it("round-trips the ladder and the bonus out of `terms`", () => {
    const stored = {
      ...storedGuarantee,
      structure: "door_split",
      guaranteeAmount: null,
      splitBasisPoints: 6000,
      terms: {
        escalators: [
          { thresholdSold: 300, splitBasisPoints: 7000 },
          { thresholdSold: 900, splitBasisPoints: 8000 },
        ],
        bonusThreshold: "1000000",
        bonusAmount: "250000",
      },
    };

    const draft = dealDraftFrom(stored, "EUR");
    expect(draft.escalators.map((band) => [band.thresholdSold, band.splitPercent])).toEqual([
      ["300", "70"],
      ["900", "80"],
    ]);
    expect(draft.bonusThreshold).toBe("10000.00");
    expect(draft.bonusAmount).toBe("2500.00");

    const payload = createDealPayload(draft);
    expect(payload.terms).toEqual({
      escalators: [
        { thresholdSold: 300, splitBasisPoints: 7000 },
        { thresholdSold: 900, splitBasisPoints: 8000 },
      ],
      bonusThreshold: "1000000",
      bonusAmount: "250000",
    });
  });
});

/**
 * THE KIND A DEAL WAS COMPOSED AS, recovered from what was stored (QA8-1).
 *
 * The inverse has to match on the PAIR: `guarantee` is *Guarantee* under `performance` and
 * *Fee for a service* under `fee`, so the shape alone cannot name it.
 */
describe("dealKindOf", () => {
  it("is the inverse of structureForKind + dealTypeForKind, for every kind", () => {
    /*
     * Stated as a property rather than as five examples, because that is the actual
     * requirement: whatever the composer writes, opening it again must land on the same tab.
     * Two entitled parties are passed so `dealTypeForKind`'s split UPGRADE is exercised — a
     * two-act door split stores `split` + `door_split` and must still read back `door_split`.
     */
    const twoEntitled: DealPartyDraft[] = [
      { key: "a", participantId: "act-a", roleInDeal: "split_member", sharePercent: "60" },
      { key: "b", participantId: "act-b", roleInDeal: "split_member", sharePercent: "40" },
    ];
    for (const option of DEAL_KIND_OPTIONS) {
      const structure = structureForKind(option.value);
      expect(dealKindOf(dealTypeForKind(option.value, []), structure)).toBe(option.value);
      expect(dealKindOf(dealTypeForKind(option.value, twoEntitled), structure)).toBe(option.value);
    }
  });

  it("tells a service fee from a guarantee by its type", () => {
    expect(dealKindOf("fee", "guarantee")).toBe("service_fee");
    expect(dealKindOf("performance", "guarantee")).toBe("guarantee");
  });

  it("reads a shapeless deal as the manually-agreed kind", () => {
    expect(dealKindOf("performance", null)).toBe("paper_only");
    // And an unreadable pair amounts to the same thing: no shape this app computes.
    expect(dealKindOf("performance", "something_else")).toBe("paper_only");
  });
});

/**
 * WHEN A DEAL MAY BE DELETED (decisions §25.7.2, Daniel 2026-09-28).
 *
 * The rule lives here rather than in the route because both the API and the screen ask it — the
 * ruling says the UI must not offer a delete the API will refuse. These tests are what make the
 * two agree: each case below is a case the route has an integration test for, checked against the
 * same function the front end calls to decide whether to draw the control.
 */
describe("dealDeletability", () => {
  const draft = { agreementStatus: "draft", name: "Wrong guarantee" };

  it("allows a draft on a night with no settlement", () => {
    expect(dealDeletability(draft, { hasSettlement: false })).toEqual({
      deletable: true,
      reason: null,
    });
  });

  it("refuses anything past draft, whatever the night's state", () => {
    for (const agreementStatus of ["sent", "confirmed", "signed"]) {
      const verdict = dealDeletability({ ...draft, agreementStatus }, { hasSettlement: false });
      expect(verdict.deletable).toBe(false);
      // The sentence names the deal and the alternative, because it is read by a person who has
      // just pressed a button and needs to know what to do instead.
      expect(verdict.reason).toContain("Wrong guarantee");
      expect(verdict.reason).toContain("Cancel it instead");
    }
  });

  it("refuses a draft once the night has a settlement — money outranks status", () => {
    const verdict = dealDeletability(draft, { hasSettlement: true });
    expect(verdict.deletable).toBe(false);
    expect(verdict.reason).toContain("settlement");
    expect(verdict.reason).toContain("Cancel it instead");
  });

  it("leads with the settlement when BOTH lines are crossed", () => {
    /*
     * Not a preference about wording: it is the ordering `assertEventIsDeletable` had to be fixed
     * to get right (QA4-1). A refusal that names the status first invites "so cancel it and try
     * again", and the second attempt is refused by the money anyway — advice that costs an
     * irreversible act and buys nothing. The absolute clause goes first.
     */
    const verdict = dealDeletability(
      { agreementStatus: "signed", name: "Headline fee" },
      { hasSettlement: true },
    );
    expect(verdict.reason).toContain("settlement");
    expect(verdict.reason).not.toContain("left draft");
  });

  it("does not advise cancelling something already cancelled", () => {
    /*
     * QA10-9, and it was my own sentence: the card printed *"Cancel it instead"* on a withdrawn deal.
     * Advice for a thing already done is the sixth instance of a sentence untrue of its reader.
     */
    const verdict = dealDeletability(
      { agreementStatus: "sent", status: "cancelled", name: "Withdrawn offer" },
      { hasSettlement: false },
    );
    expect(verdict.deletable).toBe(false);
    expect(verdict.reason).toContain("is cancelled");
    expect(verdict.reason).not.toContain("Cancel it instead");
    // It says why the row is still there, which is the whole argument for cancelling over deleting.
    expect(verdict.reason).toContain("record that it was offered");
  });

  it("still lets a cancelled DRAFT be tidied away", () => {
    // Both columns say different things: never sent, so nobody else's record — §25.7.2's own case.
    expect(
      dealDeletability(
        { agreementStatus: "draft", status: "cancelled", name: "Never sent" },
        { hasSettlement: false },
      ).deletable,
    ).toBe(true);
  });

  it("speaks in general terms about an unnamed agreement", () => {
    const verdict = dealDeletability({ agreementStatus: "sent" }, { hasSettlement: false });
    expect(verdict.reason).toContain("This agreement");
  });
});

/**
 * THE FIRST SIGNATURE SEALS THE FIGURES (QA sweep run 11).
 *
 * The rule was written down in three places — the route's own comment, the hook's docstring,
 * and commit `547f044`'s title (*"while nobody has signed"*) — and the predicate under all of
 * them asked `agreement_status === "confirmed"`, which is every signatory stamped. Measured:
 * the operator signed SEK 60,000, the act's agent edited it to SEK 90,000 and signed, and the
 * agreement froze carrying the new figure beside the operator's original signature.
 */
describe("termsAreSealed", () => {
  const sent = { agreementStatus: "sent" };

  it("is open while nobody has signed — which is what editing a sent deal is FOR", () => {
    expect(termsAreSealed(sent, [{ confirmedAt: null }, { confirmedAt: null }])).toBe(false);
    expect(sealedTermsReason(sent, [{ confirmedAt: null }])).toBeNull();
  });

  it("seals on ONE signature, with the agreement still `sent`", () => {
    const parties = [{ confirmedAt: "2026-09-28T23:57:56.361Z" }, { confirmedAt: null }];
    expect(termsAreSealed(sent, parties)).toBe(true);
    // And the reason says which state it is, because "on a confirmed agreement" would be
    // untrue of this deal.
    expect(sealedTermsReason(sent, parties)).toBe("partly-signed");
  });

  it("seals a confirmed agreement whatever the party rows say", () => {
    // The status is the stronger claim: `signed` is the same agreement countersigned
    // off-platform, where the party rows may carry nothing at all.
    expect(termsAreSealed({ agreementStatus: "confirmed" }, [])).toBe(true);
    expect(termsAreSealed({ agreementStatus: "signed" }, [{ confirmedAt: null }])).toBe(true);
    expect(sealedTermsReason({ agreementStatus: "confirmed" }, [])).toBe("confirmed");
  });

  it("reads a Date as a signature, not only a string", () => {
    // The API hands it a `timestamptz` column and the web hands it JSON. Both are signatures.
    expect(termsAreSealed(sent, [{ confirmedAt: new Date("2026-09-28T23:57:56.361Z") }])).toBe(
      true,
    );
  });

  it("treats a party row with no `confirmedAt` key as unsigned", () => {
    // An observer's row, and any caller selecting a narrower shape.
    expect(termsAreSealed(sent, [{}, {}])).toBe(false);
  });

  it("is open on a draft nobody has touched", () => {
    expect(termsAreSealed({ agreementStatus: "draft" }, [{ confirmedAt: null }])).toBe(false);
  });
});
