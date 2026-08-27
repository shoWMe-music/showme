import { majorToMinor } from "@showme/shared";
import { describe, expect, it } from "vitest";
import { prepaidAmountOf, prepaidUnknowable } from "./prepaid";

const eur = (major: string | number) => majorToMinor(major, "EUR");

/**
 * WHICH FIGURE MOVED BEFORE THE NIGHT — the reading of `payment_timing` and
 * `advance_amount` that `reconcile()` then settles as cash held.
 *
 * The two cases the rule exists for are the product owner's own (2026-08-27):
 * *"before event means I pay someone before the event. So it could be a rent for
 * the venue or a guarantee for the artist to play."*
 */
describe("prepaidAmountOf", () => {
  it("pays a rental before the event", () => {
    expect(
      prepaidAmountOf({
        structure: "rental",
        paymentTiming: "before_event",
        guaranteeAmount: eur(2000),
      }),
    ).toBe(eur(2000));
  });

  it("pays a guarantee before the event", () => {
    expect(
      prepaidAmountOf({
        structure: "guarantee",
        paymentTiming: "before_event",
        guaranteeAmount: eur(1800),
      }),
    ).toBe(eur(1800));
  });

  it("prepays the GUARANTEE half of a guarantee-vs-door, not the door half", () => {
    // You cannot pre-pay a percentage of a door nobody has counted. The floor is
    // the knowable part, and the rest reconciles after.
    expect(
      prepaidAmountOf({
        structure: "guarantee_vs_door",
        paymentTiming: "before_event",
        guaranteeAmount: eur(1800),
      }),
    ).toBe(eur(1800));
  });

  it("takes an explicit advance over the timing, as the more specific statement", () => {
    expect(
      prepaidAmountOf({
        structure: "guarantee_vs_door",
        paymentTiming: "before_event",
        guaranteeAmount: eur(1800),
        advanceAmount: eur(1000),
      }),
    ).toBe(eur(1000));
  });

  it("honours an advance on a deal that otherwise settles after the show", () => {
    expect(
      prepaidAmountOf({
        structure: "door_split",
        paymentTiming: "at_settlement",
        advanceAmount: eur(500),
      }),
    ).toBe(eur(500));
  });

  it("prepays nothing on an ordinary at-settlement deal", () => {
    expect(
      prepaidAmountOf({
        structure: "door_split",
        paymentTiming: "at_settlement",
        splitBasisPoints: 5000,
      } as Parameters<typeof prepaidAmountOf>[0]),
    ).toBe(0n);
  });

  it("prepays nothing on a due-date deal — that date is still ahead", () => {
    expect(
      prepaidAmountOf({
        structure: "guarantee",
        paymentTiming: "due_date",
        guaranteeAmount: eur(1800),
      }),
    ).toBe(0n);
  });

  it("prepays nothing for a percentage deal with no knowable figure", () => {
    const terms = { structure: "door_split", paymentTiming: "before_event" } as const;
    expect(prepaidAmountOf(terms)).toBe(0n);
    // …and says so, rather than reading identically to a deal with no prepayment.
    expect(prepaidUnknowable(terms)).toBe(true);
  });

  it("is not unknowable once any figure is named", () => {
    expect(
      prepaidUnknowable({
        structure: "door_split",
        paymentTiming: "before_event",
        advanceAmount: eur(500),
      }),
    ).toBe(false);
    expect(prepaidUnknowable({ structure: "door_split", paymentTiming: "at_settlement" })).toBe(
      false,
    );
  });
});
