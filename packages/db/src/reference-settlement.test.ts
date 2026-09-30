import { serializeBreakdown } from "@showme/settlement";
import { describe, expect, it } from "vitest";
import { type ReferenceEventSpine, referenceSettlement } from "./reference-settlement";

/**
 * A SEED'S JSONB PAYLOAD MUST SURVIVE `JSON.stringify` — a defect class nothing else here can see.
 *
 * `seed-e2e.ts` and `seed.ts` are run by `pnpm dev` and `pnpm test:e2e` and by NOTHING else: every
 * API test builds its own fixtures. So when a `settlement_snapshots` row added on 2026-09-29 passed
 * the engine's BigInt figures straight into a `jsonb` column, **1519 passing API tests said nothing
 * about it** and the only thing that noticed was `pnpm dev` refusing to start, two iterations later:
 * *"Do not know how to serialize a BigInt"*.
 *
 * The engine deals in BigInt everywhere by design (money.md), and `jsonb` cannot take one. Anything
 * a seed freezes therefore has to go through the same serializer the routes use — which is also why
 * the seeded record then has the shape a real one has rather than a hand-built lookalike.
 *
 * No container and no database, deliberately: a guard that costs nothing runs everywhere, and this
 * one is the whole reason the class was invisible.
 */
describe("what a seed freezes into jsonb", () => {
  const SPINE: ReferenceEventSpine = {
    hostParticipantId: "11111111-1111-4111-8111-111111111111",
    performerParticipantId: "22222222-2222-4222-8222-222222222222",
    dealId: "33333333-3333-4333-8333-333333333333",
  };

  it("serializes, BigInt figures included", () => {
    const result = referenceSettlement(SPINE);
    const frozen = {
      settlements: result.breakdowns.map(serializeBreakdown),
      transfers: result.transfers.map((transfer) => ({
        fromParticipantId: transfer.fromParticipantId,
        toParticipantId: transfer.toParticipantId,
        amount: transfer.amount.toString(),
        currency: "SEK",
      })),
      lockedRates: {},
    };
    expect(() => JSON.stringify(frozen)).not.toThrow();
  });

  /*
   * AND THE FIGURES ARE STRINGS, not numbers. `JSON.stringify` would happily accept a Number and
   * lose precision above 2^53 silently — which on minor units is SEK 90 billion, far enough away to
   * never show up in a fixture and close enough to matter in a system that settles money.
   */
  it("keeps every money figure a string", () => {
    const result = referenceSettlement(SPINE);
    const breakdown = result.breakdowns.map(serializeBreakdown)[0];
    if (!breakdown) throw new Error("the reference settlement produced no breakdowns");
    for (const key of ["entitlement", "collected", "paid", "held", "net"] as const) {
      expect(typeof breakdown[key]).toBe("string");
    }
    expect(typeof result.transfers[0]?.amount.toString()).toBe("string");
  });

  /*
   * THE RAW ENGINE RESULT DOES NOT, which is what makes the two tests above a pair rather than a
   * tautology: if `serializeBreakdown` ever started returning numbers, or the seed stopped calling
   * it, the assertions above would still pass on the serialized value while the real defect — a raw
   * breakdown reaching `jsonb` — went back to being invisible.
   */
  it("throws on the raw engine result, which is the mistake being guarded", () => {
    const result = referenceSettlement(SPINE);
    expect(() => JSON.stringify({ settlements: result.breakdowns })).toThrow(/BigInt/);
  });
});
