import { describe, expect, it } from "vitest";
import {
  type DealDraft,
  createDealPayload,
  dealDraftProblems,
  emptyDealDraft,
  percentToBasisPoints,
  shareBasisPointsOf,
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

  it("refuses a settling deal that pays nobody", () => {
    const draft = guaranteeDraft();
    draft.parties[1] = { key: "b", participantId: "act", roleInDeal: "observer", sharePercent: "" };
    expect(dealDraftProblems(draft)).toContainEqual(expect.stringContaining("Nobody"));
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
