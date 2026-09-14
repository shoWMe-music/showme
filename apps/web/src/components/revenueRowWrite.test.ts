import { describe, expect, it } from "vitest";
import { revenueRowWrite } from "./useBudgetEditor";

/**
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * The venue capacity has no row of its own — the planner reads it back out of
 * the bar line's `details.quantity`. So a flat row written as `quantity: 1`,
 * which is what it is arithmetically, wiped the capacity to one guest. Every
 * suite stayed green: the basis control worked, the amount was right, and a
 * different field three rows up silently became 1.
 */
describe("what a revenue row stores", () => {
  it("multiplies a per-guest rate by the heads", () => {
    expect(revenueRowWrite({ unitAmount: "4000", heads: 400, perGuest: true })).toEqual({
      amount: "1600000",
      quantity: 400,
    });
  });

  it("takes a flat figure once", () => {
    expect(revenueRowWrite({ unitAmount: "4000000", heads: 400, perGuest: false }).amount).toBe(
      "4000000",
    );
  });

  it("RECORDS THE HEAD COUNT EVEN WHEN IT DOES NOT MULTIPLY", () => {
    // The whole bug. `quantity` is the capacity's only home, so a flat row must
    // still carry it — otherwise switching the bar to flat resets the room.
    expect(revenueRowWrite({ unitAmount: "4000000", heads: 400, perGuest: false }).quantity).toBe(
      400,
    );
  });

  it("survives a half-typed capacity without inventing one", () => {
    // A cleared capacity field is 0 heads, not 1 and not NaN: 0 says "nobody has
    // said how big the room is", which is honest. NaN would reach `BigInt` and
    // throw, taking the whole flush with it.
    expect(revenueRowWrite({ unitAmount: "500", heads: Number.NaN, perGuest: true })).toEqual({
      amount: "0",
      quantity: 0,
    });
    expect(revenueRowWrite({ unitAmount: "500", heads: -20, perGuest: true }).quantity).toBe(0);
  });

  it("keeps a fractional capacity whole", () => {
    expect(revenueRowWrite({ unitAmount: "100", heads: 399.9, perGuest: true })).toEqual({
      amount: "39900",
      quantity: 399,
    });
  });
});
