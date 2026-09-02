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

describe("reconcile — a rental settles OFF THE TOP (analysis §3.3, case 1)", () => {
  /**
   * The reference app reduced the pool by the venue rental BEFORE any percentage
   * split (`../showme-settle-fast` `src/lib/models.ts:368`, `:437`), and we did not.
   * The product owner's answer (2026-08-26) is that it should: a rental is the cost
   * of the room, and "net door" means after it.
   *
   * Pool 10 000, rental 2 000, performer on a 50% door split:
   *   before → V 2 000, B 5 000 (half of the whole pool), P 3 000
   *   after  → V 2 000, B 4 000 (half of 8 000),          P 4 000
   */
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
        guaranteeAmount: eur(2000),
      },
      {
        dealId: "door",
        structure: "door_split",
        payeeParticipantIds: ["B"],
        splitBasisPoints: 5000,
      },
    ],
    budgetLines: [{ kind: "revenue", amount: eur(10000), collectedBy: "P" }],
  };

  it("splits what is left after the rental, not the whole pool", () => {
    const result = reconcile(input);
    const entitlementOf = (id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement;

    expect(result.pool).toBe(eur(10000)); // the pool itself is untouched — only who claims it
    expect(entitlementOf("V")).toBe(eur(2000));
    expect(entitlementOf("B")).toBe(eur(4000)); // 50% of 8 000, NOT of 10 000
    expect(entitlementOf("P")).toBe(eur(4000)); // residual absorbs the difference
    assertBalanced(result);
  });

  it("leaves a fixed guarantee that is NOT a rental dividing the same pool", () => {
    // Same shape with the 2 000 as a plain guarantee: the performer keeps 5 000.
    const result = reconcile({
      ...input,
      deals: [
        {
          dealId: "guar",
          structure: "guarantee",
          payeeParticipantIds: ["V"],
          guaranteeAmount: eur(2000),
        },
        {
          dealId: "door",
          structure: "door_split",
          payeeParticipantIds: ["B"],
          splitBasisPoints: 5000,
        },
      ],
    });
    const entitlementOf = (id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement;
    expect(entitlementOf("B")).toBe(eur(5000));
    expect(entitlementOf("P")).toBe(eur(3000));
    assertBalanced(result);
  });

  it("stacks two rentals off the top before anyone splits", () => {
    const result = reconcile({
      ...input,
      participants: [...input.participants, { participantId: "V2" }],
      deals: [
        ...input.deals,
        {
          dealId: "rental-2",
          structure: "rental",
          payeeParticipantIds: ["V2"],
          guaranteeAmount: eur(1000),
        },
      ],
    });
    const entitlementOf = (id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement;
    expect(entitlementOf("B")).toBe(eur(3500)); // 50% of (10 000 − 2 000 − 1 000)
    expect(entitlementOf("P")).toBe(eur(3500));
    assertBalanced(result);
  });

  it("does not reduce the pool for a rental that pays nobody", () => {
    // A rental deal with no payee claims nothing, so it must not shrink what the
    // door split divides — otherwise money would vanish from the distribution.
    const result = reconcile({
      ...input,
      deals: [
        {
          dealId: "rental",
          structure: "rental",
          payeeParticipantIds: [],
          guaranteeAmount: eur(2000),
        },
        {
          dealId: "door",
          structure: "door_split",
          payeeParticipantIds: ["B"],
          splitBasisPoints: 5000,
        },
      ],
    });
    expect(result.breakdowns.find((party) => party.participantId === "B")?.entitlement).toBe(
      eur(5000),
    );
    assertBalanced(result);
  });
});

describe("reconcile — a percentage entitlement never goes negative (analysis case 5)", () => {
  /**
   * A loss-making event, pure door split: gross 2 000, costs 5 000 → pool −3 000.
   * The reference app pays the performer −1 500 (the performer owes for playing);
   * the product owner's answer (2026-08-26) is "should not be negative no".
   */
  const lossMaking: SettlementInput = {
    baseCurrency: "EUR",
    participants: [{ participantId: "P", isOperator: true }, { participantId: "B" }],
    deals: [
      {
        dealId: "door",
        structure: "door_split",
        payeeParticipantIds: ["B"],
        splitBasisPoints: 5000,
      },
    ],
    budgetLines: [
      { kind: "revenue", amount: eur(2000), collectedBy: "P" },
      { kind: "cost", amount: eur(5000), paidBy: "P" },
    ],
  };

  it("floors the performer at zero and leaves the whole loss with the operator", () => {
    const result = reconcile(lossMaking);
    expect(result.pool).toBe(eur(-3000));
    const band = result.breakdowns.find((party) => party.participantId === "B");
    expect(band?.entitlement).toBe(0n); // was −1 500
    expect(band?.net).toBe(0n);
    expect(netOf(result, "P")).toBe(0n); // the operator holds −3 000 and is owed −3 000
    expect(result.breakdowns.find((party) => party.participantId === "P")?.entitlement).toBe(
      eur(-3000),
    );
    assertBalanced(result);
  });

  it("floors each line of a multi-performer split, not just the total", () => {
    const result = reconcile({
      ...lossMaking,
      participants: [...lossMaking.participants, { participantId: "B2" }],
      deals: [
        {
          dealId: "door",
          structure: "door_split",
          payeeParticipantIds: ["B", "B2"],
          splitBasisPoints: 5000,
          partyShares: { B: 6000, B2: 4000 },
        },
      ],
    });
    for (const id of ["B", "B2"]) {
      expect(result.breakdowns.find((party) => party.participantId === id)?.entitlement).toBe(0n);
    }
    assertBalanced(result);
  });

  it("still lets a NET go negative once a deductible is applied", () => {
    // The scope line: the FLOOR is on the share of the pool. A performer who was
    // advanced more than the night earned genuinely owes it back.
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [{ participantId: "P", isOperator: true }, { participantId: "B" }],
      deals: [
        {
          dealId: "door",
          structure: "door_split",
          payeeParticipantIds: ["B"],
          splitBasisPoints: 5000,
        },
      ],
      budgetLines: [
        { kind: "revenue", amount: eur(2000), collectedBy: "P" },
        { kind: "cost", amount: eur(5000), paidBy: "P" },
        { kind: "cost", amount: eur(800), paidBy: "P", payeeParticipantId: "B" }, // hotel on the band's behalf
      ],
    });
    const band = result.breakdowns.find((party) => party.participantId === "B");
    expect(band?.entitlement).toBe(eur(-800)); // 0 floored share − the hotel it owes back
    expect(band?.net).toBe(eur(-800));
    assertBalanced(result);
  });

  it("leaves a guarantee on a loss-making event exactly as it was (case 4)", () => {
    // guarantee_vs_door with a real guarantee: the guarantee already won every
    // comparison a negative door could enter, so the floor changes nothing.
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [{ participantId: "P", isOperator: true }, { participantId: "B" }],
      deals: [
        {
          dealId: "vs",
          structure: "guarantee_vs_door",
          payeeParticipantIds: ["B"],
          guaranteeAmount: eur(2000),
          splitBasisPoints: 5000,
        },
      ],
      budgetLines: [
        { kind: "revenue", amount: eur(1000), collectedBy: "P" },
        { kind: "cost", amount: eur(4000), paidBy: "P" },
      ],
    });
    expect(result.breakdowns.find((party) => party.participantId === "B")?.entitlement).toBe(
      eur(2000),
    );
    expect(netOf(result, "P")).toBe(eur(-2000)); // the operator eats the loss AND the guarantee
    assertBalanced(result);
  });
});

describe("reconcile — disclosed commissions (analysis case 8)", () => {
  /** A 1 000 guarantee with a 20% and a 10% commission — the case the analysis ran. */
  const withCommissions = (
    commissions: { participantId: string; basisPoints: number }[],
    commissionMode?: "parallel" | "cascading",
  ) =>
    reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "P", isOperator: true },
        { participantId: "B" },
        { participantId: "AGENCY" },
        { participantId: "MGMT" },
      ],
      deals: [
        {
          dealId: "guar",
          structure: "guarantee",
          payeeParticipantIds: ["B"],
          guaranteeAmount: eur(1000),
          commissions,
          commissionMode,
        },
      ],
      budgetLines: [{ kind: "revenue", amount: eur(5000), collectedBy: "P" }],
    });

  it("pays each commission party in PARALLEL off the payee's line (ClickUp 86cba8wmb)", () => {
    const result = withCommissions([
      { participantId: "AGENCY", basisPoints: 2000 },
      { participantId: "MGMT", basisPoints: 1000 },
    ]);
    const entitlementOf = (id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement;
    expect(entitlementOf("AGENCY")).toBe(eur(200));
    expect(entitlementOf("MGMT")).toBe(eur(100)); // cascading would be 80 — see 86cba8wmb
    expect(entitlementOf("B")).toBe(eur(700));
    // The operator's residual is untouched: a commission moves money WITHIN the deal.
    expect(entitlementOf("P")).toBe(eur(4000));
    assertBalanced(result);
  });

  /**
   * BOTH RULES WORK, AND THE DEAL PICKS (ClickUp `86cba8wmb`).
   *
   * The product owner's answer was that it depends on the shape of the deal, so
   * neither rule is "the" rule. `deals.commission_mode` carries it; these pin the
   * two answers against the same 1 000 line so the difference is visible in one
   * place rather than inferred from an enum name.
   */
  it("CASCADES when the deal says so — the second cut comes off what the first left", () => {
    const result = withCommissions(
      [
        { participantId: "AGENCY", basisPoints: 2000 },
        { participantId: "MGMT", basisPoints: 1000 },
      ],
      "cascading",
    );
    const entitlementOf = (id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement;
    expect(entitlementOf("AGENCY")).toBe(eur(200)); // 20% of 1 000, same either way
    expect(entitlementOf("MGMT")).toBe(eur(80)); // 10% of the 800 that was left
    expect(entitlementOf("B")).toBe(eur(720)); // 20 more than parallel leaves
    expect(entitlementOf("P")).toBe(eur(4000)); // the operator is untouched by the choice
    assertBalanced(result);
  });

  it("settles identically under both rules when there is only one commission", () => {
    const one = [{ participantId: "AGENCY", basisPoints: 2000 }];
    const entitlementOf = (result: ReturnType<typeof reconcile>, id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement;
    const parallel = withCommissions(one, "parallel");
    const cascading = withCommissions(one, "cascading");
    // Which matters, because it is why the column default is safe: every deal
    // that exists today has one commission or none, so nothing was restated.
    expect(entitlementOf(cascading, "AGENCY")).toBe(entitlementOf(parallel, "AGENCY"));
    expect(entitlementOf(cascading, "B")).toBe(entitlementOf(parallel, "B"));
  });

  it("treats an unset mode as parallel, so a deal written before the column is unchanged", () => {
    const commissions = [
      { participantId: "AGENCY", basisPoints: 2000 },
      { participantId: "MGMT", basisPoints: 1000 },
    ];
    const entitlementOf = (result: ReturnType<typeof reconcile>, id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement;
    expect(entitlementOf(withCommissions(commissions), "MGMT")).toBe(
      entitlementOf(withCommissions(commissions, "parallel"), "MGMT"),
    );
  });

  it("commissions each split line separately, and loses no minor unit", () => {
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "P", isOperator: true },
        { participantId: "B" },
        { participantId: "B2" },
        { participantId: "AGENCY" },
      ],
      deals: [
        {
          dealId: "split",
          structure: "door_split",
          payeeParticipantIds: ["B", "B2"],
          splitBasisPoints: 10000,
          partyShares: { B: 6000, B2: 4000 },
          commissions: [{ participantId: "AGENCY", basisPoints: 1000 }],
        },
      ],
      budgetLines: [{ kind: "revenue", amount: 3333n, collectedBy: "P" }],
    });
    const entitlementOf = (id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.entitlement ?? 0n;
    // 3333 → 2000/1333; 10% of each is 200 and 133, and the payees keep the rest exactly.
    expect(entitlementOf("AGENCY")).toBe(333n);
    expect(entitlementOf("B")).toBe(1800n);
    expect(entitlementOf("B2")).toBe(1200n);
    expect(entitlementOf("B") + entitlementOf("B2") + entitlementOf("AGENCY")).toBe(3333n);
    assertBalanced(result);
  });

  it("refuses a commission credited to somebody who is not on the event", () => {
    expect(() => withCommissions([{ participantId: "GHOST", basisPoints: 2000 }])).toThrow(
      /not a participant on this event/,
    );
  });
});

describe("reconcile — the ladder and the rule behind each figure", () => {
  // The shape the design prototype's settlement screen renders: gross revenue,
  // deductions, a venue rental off the top, and the ADJUSTED NET every percentage
  // below it is a share of. Without those four the parties see a set of figures
  // with nothing to check them against.
  const input: SettlementInput = {
    baseCurrency: "EUR",
    participants: [
      { participantId: "operator", isOperator: true },
      { participantId: "venue" },
      { participantId: "performer" },
    ],
    deals: [
      {
        dealId: "room",
        structure: "rental",
        payeeParticipantIds: ["venue"],
        guaranteeAmount: eur(4000),
      },
      {
        dealId: "booking",
        structure: "guarantee_vs_door",
        payeeParticipantIds: ["performer"],
        guaranteeAmount: eur(50000),
        splitBasisPoints: 7000,
      },
    ],
    budgetLines: [
      { kind: "revenue", amount: eur(100200), collectedBy: "operator" },
      { kind: "cost", amount: eur(23700), paidBy: "operator" },
    ],
  };

  it("reports revenue, costs, the rental off the top, and the adjusted net", () => {
    const { ladder } = reconcile(input);
    expect(ladder.revenue).toBe(eur(100200));
    expect(ladder.costs).toBe(eur(23700));
    expect(ladder.pool).toBe(eur(76500));
    expect(ladder.offTheTop).toBe(eur(4000));
    // The prototype's "Adjusted net": revenue − deductions − venue rental.
    expect(ladder.splitPool).toBe(eur(72500));
  });

  it("says WHICH side of a guarantee-vs-door comparison won, and what it beat", () => {
    const result = reconcile(input);
    const performer = result.breakdowns.find((party) => party.participantId === "performer");
    expect(performer?.lines).toHaveLength(1);
    const [line] = performer?.lines ?? [];
    expect(line?.basis).toEqual({
      kind: "guarantee_vs_door",
      won: "door",
      guarantee: eur(50000),
      // 70% of the ADJUSTED net (72,500), not of the pool.
      door: eur(50750),
      basisPoints: 7000,
      pool: eur(72500),
    });
    expect(line?.amount).toBe(eur(50750));
  });

  it("gives the venue its rental as its own line, priced off the top", () => {
    const result = reconcile(input);
    const venue = result.breakdowns.find((party) => party.participantId === "venue");
    expect(venue?.lines).toEqual([
      {
        dealId: "room",
        dealTotal: eur(4000),
        amount: eur(4000),
        basis: { kind: "rental", rental: eur(4000) },
      },
    ]);
  });

  it("names the operator's share as a residual rather than an unexplained figure", () => {
    const result = reconcile(input);
    const operator = result.breakdowns.find((party) => party.participantId === "operator");
    expect(operator?.lines).toEqual([]);
    expect(operator?.residual).toBe(eur(76500) - eur(4000) - eur(50750));
    expect(operator?.entitlement).toBe(operator?.residual);
  });

  it("adds up: entitlement = Σ lines + commission earned + residual − deductibles", () => {
    const withDeductible = reconcile({
      ...input,
      budgetLines: [
        ...input.budgetLines,
        // The operator fronts the performer's hotel — a deductible on the performer.
        { kind: "cost", amount: eur(900), paidBy: "operator", payeeParticipantId: "performer" },
      ],
    });
    for (const party of withDeductible.breakdowns) {
      const fromLines = party.lines.reduce((total, line) => total + line.amount, 0n);
      expect(party.entitlement).toBe(
        fromLines + party.commissionEarned + party.residual - party.deductibles,
      );
    }
    expect(
      withDeductible.breakdowns.find((party) => party.participantId === "performer")?.deductibles,
    ).toBe(eur(900));
    assertBalanced(withDeductible);
  });

  it("shows each split member the whole deal AND its own portion of it", () => {
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "operator", isOperator: true },
        { participantId: "headliner" },
        { participantId: "support" },
      ],
      deals: [
        {
          dealId: "shared",
          structure: "door_split",
          payeeParticipantIds: ["headliner", "support"],
          splitBasisPoints: 5000,
          partyShares: { headliner: 6000, support: 4000 },
        },
      ],
      budgetLines: [{ kind: "revenue", amount: eur(10000), collectedBy: "operator" }],
    });
    const headliner = result.breakdowns.find((party) => party.participantId === "headliner");
    const support = result.breakdowns.find((party) => party.participantId === "support");
    expect(headliner?.lines[0]?.dealTotal).toBe(eur(5000));
    expect(headliner?.lines[0]?.amount).toBe(eur(3000));
    expect(support?.lines[0]?.dealTotal).toBe(eur(5000));
    expect(support?.lines[0]?.amount).toBe(eur(2000));
    expect(headliner?.lines[0]?.basis).toEqual({
      kind: "door_split",
      basisPoints: 5000,
      pool: eur(10000),
    });
  });

  it("records the commission charged against a payee's own line", () => {
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "operator", isOperator: true },
        { participantId: "performer" },
        { participantId: "broker" },
      ],
      deals: [
        {
          dealId: "booking",
          structure: "guarantee",
          payeeParticipantIds: ["performer"],
          guaranteeAmount: eur(1000),
          commissions: [{ participantId: "broker", basisPoints: 2000 }],
        },
      ],
      budgetLines: [{ kind: "revenue", amount: eur(5000), collectedBy: "operator" }],
    });
    const performer = result.breakdowns.find((party) => party.participantId === "performer");
    expect(performer?.lines[0]?.commissionCharged).toBe(eur(200));
    expect(performer?.lines[0]?.amount).toBe(eur(800));
    const broker = result.breakdowns.find((party) => party.participantId === "broker");
    expect(broker?.commissionEarned).toBe(eur(200));
  });
});

describe("reconcile — money paid BEFORE the event", () => {
  /**
   * A deal can move money before the night: a rental paid to hold the room, a
   * guarantee paid to secure the booking. `prepaid.ts` reads it off the terms;
   * this is what it must do to the settlement.
   *
   * The rule, from the product owner (2026-08-27): *"the advance should be
   * included in the final settlement, since it is something that is included in
   * the deal, and the deal is what drives the transaction."* So the ENTITLEMENT
   * is whatever the deal says it is — an advance is not a smaller fee — and the
   * advance settles as cash already in the payee's hands, shrinking only the
   * transfer that remains.
   *
   * Pool 10 000, performer on a 50% door split, 2 000 already paid:
   *   entitlement 5 000, of which 2 000 is held → 3 000 still to come.
   */
  const base: SettlementInput = {
    baseCurrency: "EUR",
    participants: [{ participantId: "P", isOperator: true }, { participantId: "B" }],
    deals: [
      {
        dealId: "door",
        structure: "door_split",
        payeeParticipantIds: ["B"],
        splitBasisPoints: 5000,
        prepaidAmount: eur(2000),
        payerParticipantId: "P",
      },
    ],
    budgetLines: [{ kind: "revenue", amount: eur(10000), collectedBy: "P" }],
  };

  it("leaves the entitlement whole and shrinks only the transfer", () => {
    const result = reconcile(base);
    const band = result.breakdowns.find((party) => party.participantId === "B");

    expect(band?.entitlement).toBe(eur(5000)); // the deal is what drives it
    expect(band?.prepaid).toBe(eur(2000));
    expect(band?.net).toBe(eur(3000)); // only what is still owed
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]?.amount).toBe(eur(3000));
    assertBalanced(result);
  });

  it("books the payer's side too, so the operator is not out of pocket twice", () => {
    const result = reconcile(base);
    const operator = result.breakdowns.find((party) => party.participantId === "P");
    // It already handed over 2 000, so it owes 2 000 less than its 5 000 shortfall.
    expect(operator?.prepaid).toBe(-eur(2000));
    expect(operator?.net).toBe(-eur(3000));
  });

  it("lets a net go NEGATIVE when the advance beat the night (money.md:41)", () => {
    // A 6 000 advance against a night that only earned the band 5 000: the 1 000
    // is genuinely owed back, and flooring it would invent money.
    const result = reconcile({
      ...base,
      deals: [{ ...base.deals[0], prepaidAmount: eur(6000) } as (typeof base.deals)[number]],
    });
    const band = result.breakdowns.find((party) => party.participantId === "B");

    expect(band?.entitlement).toBe(eur(5000));
    expect(band?.net).toBe(-eur(1000)); // owes the operator back
    expect(result.transfers[0]).toEqual({
      fromParticipantId: "B",
      toParticipantId: "P",
      amount: eur(1000),
    });
    assertBalanced(result);
  });

  it("never lets an advance touch the pool the percentages divide", () => {
    // The band's 50% is of the whole 10 000 pool whether 2 000 moved early or
    // not. An advance booked as a cost would have shrunk it to 4 000.
    const withAdvance = reconcile(base);
    const without = reconcile({
      ...base,
      deals: [
        {
          ...base.deals[0],
          prepaidAmount: undefined,
          payerParticipantId: undefined,
        } as (typeof base.deals)[number],
      ],
    });
    expect(withAdvance.pool).toBe(without.pool);
    const entitlementOf = (result: typeof withAdvance) =>
      result.breakdowns.find((party) => party.participantId === "B")?.entitlement;
    expect(entitlementOf(withAdvance)).toBe(entitlementOf(without));
  });

  it("divides a shared advance by the same weights as the fee it is part of", () => {
    const result = reconcile({
      baseCurrency: "EUR",
      participants: [
        { participantId: "P", isOperator: true },
        { participantId: "A" },
        { participantId: "B" },
      ],
      deals: [
        {
          dealId: "split",
          structure: "door_split",
          payeeParticipantIds: ["A", "B"],
          splitBasisPoints: 10000,
          partyShares: { A: 6000, B: 4000 },
          prepaidAmount: eur(1000),
          payerParticipantId: "P",
        },
      ],
      budgetLines: [{ kind: "revenue", amount: eur(10000), collectedBy: "P" }],
    });
    const prepaidOf = (id: string) =>
      result.breakdowns.find((party) => party.participantId === id)?.prepaid;

    expect(prepaidOf("A")).toBe(eur(600)); // 60% of the advance, as of the fee
    expect(prepaidOf("B")).toBe(eur(400));
    assertBalanced(result);
  });

  it("refuses a one-ended advance rather than conjuring money", () => {
    expect(() =>
      reconcile({
        ...base,
        deals: [{ ...base.deals[0], payerParticipantId: undefined } as (typeof base.deals)[number]],
      }),
    ).toThrow(/names no payer/);
  });
});
