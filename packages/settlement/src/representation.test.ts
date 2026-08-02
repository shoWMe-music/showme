import { majorToMinor } from "@showme/shared";
import { describe, expect, it } from "vitest";
import { assertBalanced, reconcile } from "./reconcile";
import { settleRepresentation } from "./representation";
import type { SettlementInput } from "./types";

const eur = (major: string | number) => majorToMinor(major, "EUR");

describe("settleRepresentation", () => {
  it("bills the performer when the performer collected", () => {
    const result = settleRepresentation({
      performerEntitlement: eur(3000),
      commissionBasisPoints: 1500,
      agentCollects: false,
    });
    expect(result.commission).toBe(eur(450));
    expect(result.transfer).toEqual({ from: "performer", to: "agent", amount: eur(450) });
  });

  it("forwards net to the performer when the agent collected", () => {
    const result = settleRepresentation({
      performerEntitlement: eur(3000),
      commissionBasisPoints: 1500,
      agentCollects: true,
    });
    expect(result.commission).toBe(eur(450));
    expect(result.transfer).toEqual({ from: "agent", to: "performer", amount: eur(2550) });
  });
});

describe("split deal: one agented performer, one self-managed", () => {
  const input: SettlementInput = {
    baseCurrency: "EUR",
    participants: [
      { participantId: "OP", isOperator: true },
      { participantId: "A" },
      { participantId: "B" },
    ],
    deals: [
      {
        dealId: "split",
        structure: "door_split",
        payeeParticipantIds: ["A", "B"],
        splitBasisPoints: 6000,
        partyShares: { A: 5000, B: 5000 },
      },
    ],
    budgetLines: [{ kind: "revenue", amount: eur(10000), collectedBy: "OP" }],
  };

  it("keeps the event balanced with both performers at full gross", () => {
    const result = reconcile(input);
    // Pool 10,000, deal pays 60% = 6,000, split 3,000 each; operator keeps 4,000.
    expect(result.breakdowns.find((p) => p.participantId === "A")?.entitlement).toBe(eur(3000));
    expect(result.breakdowns.find((p) => p.participantId === "B")?.entitlement).toBe(eur(3000));
    expect(result.breakdowns.find((p) => p.participantId === "OP")?.net).toBe(eur(-6000));
    assertBalanced(result);
  });

  it("settles A's commission independently, per line", () => {
    const result = reconcile(input);
    const aGross = result.breakdowns.find((p) => p.participantId === "A")?.entitlement ?? 0n;

    const aRepresentation = settleRepresentation({
      performerEntitlement: aGross,
      commissionBasisPoints: 2000,
      agentCollects: true,
    });
    expect(aRepresentation.commission).toBe(eur(600));
    expect(aRepresentation.transfer).toEqual({ from: "agent", to: "performer", amount: eur(2400) });

    // The event settlement is untouched by A's private arrangement.
    assertBalanced(result);
    expect(result.breakdowns.find((p) => p.participantId === "B")?.entitlement).toBe(eur(3000));
  });
});
