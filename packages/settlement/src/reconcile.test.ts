import { majorToMinor } from "@showme/shared";
import { describe, expect, it } from "vitest";
import { dealEntitlement, splitBasisPointsForSales } from "./entitlement";
import { assertBalanced, reconcile } from "./reconcile";
import type {
  SettlementBudgetLine,
  SettlementDeal,
  SettlementInput,
  SettlementParticipant,
} from "./types";

const eur = (major: string | number) => majorToMinor(major, "EUR");

function netOf(result: ReturnType<typeof reconcile>, participantId: string): bigint {
  return result.breakdowns.find((party) => party.participantId === participantId)?.net ?? -1n;
}

describe("reconcile — the worked example", () => {
  // P operates, rents V €1,000, books B €3,000; tickets €10,000 (collected P),
  // production €1,500 (paid P). Pool 8,500 → P −4,000, V +1,000, B +3,000.
  const input: SettlementInput = {
    baseCurrency: "EUR",
    participants: [
      { participantId: "P", isOperator: true },
      { participantId: "V" },
      { participantId: "B" },
    ],
    deals: [
      {
        dealId: "rental",
        structure: "rental",
        payeeParticipantIds: ["V"],
        guaranteeAmount: eur(1000),
      },
      {
        dealId: "guar",
        structure: "guarantee",
        payeeParticipantIds: ["B"],
        guaranteeAmount: eur(3000),
      },
    ],
    budgetLines: [
      { kind: "revenue", amount: eur(10000), collectedBy: "P" },
      { kind: "cost", amount: eur(1500), paidBy: "P" }, // external supplier → reduces pool
    ],
  };

  it("computes the pool, the residual, and per-party nets (exact minor units)", () => {
    const result = reconcile(input);
    expect(result.pool).toBe(eur(8500));
    expect(netOf(result, "P")).toBe(eur(-4000));
    expect(netOf(result, "V")).toBe(eur(1000));
    expect(netOf(result, "B")).toBe(eur(3000));
    assertBalanced(result);
  });

  it("emits the minimal transfers", () => {
    const { transfers } = reconcile(input);
    expect(transfers).toContainEqual({
      fromParticipantId: "P",
      toParticipantId: "B",
      amount: eur(3000),
    });
    expect(transfers).toContainEqual({
      fromParticipantId: "P",
      toParticipantId: "V",
      amount: eur(1000),
    });
    expect(transfers).toHaveLength(2);
  });
});

describe("reconcile — deductibles", () => {
  it("nets a cost fronted on another party's behalf without touching the pool", () => {
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "P", isOperator: true },
        { participantId: "V" },
        { participantId: "B" },
      ],
      deals: [
        {
          dealId: "rental",
          structure: "rental",
          payeeParticipantIds: ["V"],
          guaranteeAmount: eur(1000),
        },
        {
          dealId: "guar",
          structure: "guarantee",
          payeeParticipantIds: ["B"],
          guaranteeAmount: eur(3000),
        },
      ],
      budgetLines: [
        { kind: "revenue", amount: eur(10000), collectedBy: "P" },
        { kind: "cost", amount: eur(1500), paidBy: "P" },
        { kind: "cost", amount: eur(500), paidBy: "V", payeeParticipantId: "B" }, // deductible
      ],
    });

    expect(result.pool).toBe(eur(8500)); // unchanged — deductible is not external
    expect(netOf(result, "P")).toBe(eur(-4000));
    expect(netOf(result, "B")).toBe(eur(2500)); // band bears its hotel
    expect(netOf(result, "V")).toBe(eur(1500)); // venue recovers what it fronted
    assertBalanced(result);
  });
});

describe("reconcile — co-operators split the residual", () => {
  it("divides the residual by operator share", () => {
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "P1", isOperator: true, operatorResidualShare: 1 },
        { participantId: "P2", isOperator: true, operatorResidualShare: 1 },
        { participantId: "B" },
      ],
      deals: [
        {
          dealId: "guar",
          structure: "guarantee",
          payeeParticipantIds: ["B"],
          guaranteeAmount: eur(2000),
        },
      ],
      budgetLines: [{ kind: "revenue", amount: eur(6000), collectedBy: "P1" }],
    });
    // Pool 6000, band 2000, residual 4000 split 50/50.
    expect(result.breakdowns.find((p) => p.participantId === "P1")?.entitlement).toBe(eur(2000));
    expect(result.breakdowns.find((p) => p.participantId === "P2")?.entitlement).toBe(eur(2000));
    assertBalanced(result);
  });
});

describe("dealEntitlement — ported math", () => {
  const vsDoor: SettlementDeal = {
    dealId: "d",
    structure: "guarantee_vs_door",
    payeeParticipantIds: ["B"],
    guaranteeAmount: eur(2000),
    splitBasisPoints: 5000,
  };

  it("guarantee_vs_door takes the max of guarantee and door", () => {
    expect(dealEntitlement(vsDoor, eur(6000), 0)).toBe(eur(3000)); // door 50% of 6000 wins
    expect(dealEntitlement(vsDoor, eur(2000), 0)).toBe(eur(2000)); // guarantee wins
  });

  it("selects the escalator tier reached by ticket sales", () => {
    const deal: SettlementDeal = {
      dealId: "d",
      structure: "door_split",
      payeeParticipantIds: ["B"],
      splitBasisPoints: 4000,
      escalators: [
        { thresholdSold: 100, splitBasisPoints: 5000 },
        { thresholdSold: 200, splitBasisPoints: 6000 },
      ],
    };
    expect(splitBasisPointsForSales(deal, 50)).toBe(4000);
    expect(splitBasisPointsForSales(deal, 150)).toBe(5000);
    expect(splitBasisPointsForSales(deal, 250)).toBe(6000);
  });

  it("adds the bonus when the pool clears the threshold", () => {
    const deal: SettlementDeal = {
      dealId: "d",
      structure: "door_split",
      payeeParticipantIds: ["B"],
      splitBasisPoints: 5000,
      bonusThreshold: eur(5000),
      bonusAmount: eur(500),
    };
    expect(dealEntitlement(deal, eur(4000), 0)).toBe(eur(2000)); // 50% of 4000, no bonus
    expect(dealEntitlement(deal, eur(6000), 0)).toBe(eur(3500)); // 50% of 6000 + 500 bonus
  });
});

describe("reconcile — conservation property (Σ net = 0, EXACT)", () => {
  // Deterministic LCG so the property test is reproducible.
  function makeRng(seed: number): () => number {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  }

  it("balances to exactly zero across 300 randomized events", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = makeRng(seed);
      const partyCount = 2 + Math.floor(rng() * 4); // 2–5 non-operators
      const participants: SettlementParticipant[] = [
        { participantId: "OP", isOperator: true },
        ...Array.from({ length: partyCount }, (_, index) => ({ participantId: `party-${index}` })),
      ];
      const others = participants.filter((p) => !p.isOperator).map((p) => p.participantId);

      const deals: SettlementDeal[] = others
        .filter(() => rng() > 0.3)
        .map((payee, index) =>
          rng() > 0.5
            ? {
                dealId: `d-${index}`,
                structure: "guarantee",
                payeeParticipantIds: [payee],
                guaranteeAmount: BigInt(Math.floor(rng() * 400000)),
              }
            : {
                dealId: `d-${index}`,
                structure: "door_split",
                payeeParticipantIds: [payee],
                splitBasisPoints: Math.floor(rng() * 6000),
              },
        );

      const pick = () => participants[Math.floor(rng() * participants.length)]?.participantId;
      const budgetLines: SettlementBudgetLine[] = [
        { kind: "revenue", amount: BigInt(Math.floor(rng() * 2000000)), collectedBy: pick() },
      ];
      if (rng() > 0.4) {
        budgetLines.push({
          kind: "cost",
          amount: BigInt(Math.floor(rng() * 300000)),
          paidBy: pick(),
          payeeParticipantId: rng() > 0.5 ? pick() : undefined, // deductible or external
        });
      }

      const result = reconcile({ baseCurrency: "EUR", participants, deals, budgetLines });
      const netSum = result.breakdowns.reduce((total, party) => total + party.net, 0n);
      expect(netSum).toBe(0n); // EXACT — no tolerance
    }
  });
});

describe("cost bearing — the meeting's 'either a cost split or a single payer'", () => {
  /**
   * The operator fronts a €1,000 marketing bill that the contract says the venue
   * and the operator share 50/50 (01:02:58–01:06:31). Half must land on the
   * venue's entitlement; the other half stays a pool cost the operator absorbs
   * through its residual — and the books must still close to zero.
   */
  const splitInput: SettlementInput = {
    baseCurrency: "EUR",
    participants: [{ participantId: "P", isOperator: true }, { participantId: "V" }],
    deals: [
      {
        dealId: "rental",
        structure: "rental",
        payeeParticipantIds: ["V"],
        guaranteeAmount: eur(2000),
      },
    ],
    budgetLines: [
      { kind: "revenue", amount: eur(10000), collectedBy: "P" },
      {
        kind: "cost",
        amount: eur(1000),
        paidBy: "P",
        costSplit: { P: 5000, V: 5000 },
      },
    ],
  };

  it("charges each named party its stated share and balances", () => {
    const result = reconcile(splitInput);
    // Only the unallocated remainder lowers the pool; here nothing is unallocated.
    expect(result.pool).toBe(eur(10000));
    const venue = result.breakdowns.find((party) => party.participantId === "V");
    // 2,000 rental − 500 (half the marketing bill it agreed to carry).
    expect(venue?.entitlement).toBe(eur(1500));
    expect(venue?.net).toBe(eur(1500));
    // The operator fronted the whole 1,000 and carries its own half.
    expect(netOf(result, "P")).toBe(eur(-1500));
    assertBalanced(result);
  });

  it("keeps an unallocated remainder as a pool cost", () => {
    const result = reconcile({
      ...splitInput,
      budgetLines: [
        { kind: "revenue", amount: eur(10000), collectedBy: "P" },
        { kind: "cost", amount: eur(1000), paidBy: "P", costSplit: { V: 6000 } },
      ],
    });
    // 60% is the venue's; the remaining 40% nobody was charged for lowers the pool.
    expect(result.pool).toBe(eur(9600));
    const venue = result.breakdowns.find((party) => party.participantId === "V");
    expect(venue?.entitlement).toBe(eur(1400));
    assertBalanced(result);
  });

  it("splits an odd amount exactly — no minor unit created or lost", () => {
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "P", isOperator: true },
        { participantId: "A" },
        { participantId: "B" },
        { participantId: "C" },
      ],
      deals: [],
      budgetLines: [
        { kind: "revenue", amount: eur(10000), collectedBy: "P" },
        {
          kind: "cost",
          amount: 100n, // €1.00 across three parties
          paidBy: "P",
          costSplit: { A: 3333, B: 3333, C: 3334 },
        },
      ],
    });
    const borne = ["A", "B", "C"].map(
      (id) => result.breakdowns.find((party) => party.participantId === id)?.entitlement ?? 0n,
    );
    expect(borne.reduce((running, value) => running + value, 0n)).toBe(-100n);
    assertBalanced(result);
  });

  it("treats a single payee as a 100% split — the old deductible, unchanged", () => {
    const asPayee = reconcile({
      ...splitInput,
      budgetLines: [
        { kind: "revenue", amount: eur(10000), collectedBy: "P" },
        { kind: "cost", amount: eur(1000), paidBy: "P", payeeParticipantId: "V" },
      ],
    });
    const asSplit = reconcile({
      ...splitInput,
      budgetLines: [
        { kind: "revenue", amount: eur(10000), collectedBy: "P" },
        { kind: "cost", amount: eur(1000), paidBy: "P", costSplit: { V: 10000 } },
      ],
    });
    expect(netOf(asSplit, "V")).toBe(netOf(asPayee, "V"));
    expect(netOf(asSplit, "P")).toBe(netOf(asPayee, "P"));
    assertBalanced(asSplit);
  });
});
