import { describe, expect, it } from "vitest";
import {
  DEAL_KIND_OPTIONS,
  DEAL_STRUCTURE_OPTIONS,
  type DealDraft,
  type DealPartyDraft,
  createDealPayload,
  dealDraftNotices,
  dealDraftProblems,
  dealKindLabel,
  dealTypeForKind,
  emptyDealDraft,
  percentToBasisPoints,
  readTermsTemplateText,
  shareBasisPointsOf,
  structureForKind,
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
