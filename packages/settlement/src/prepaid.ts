import type { DealStructure, PaymentTiming } from "./types";

/**
 * WHAT A DEAL ALREADY PAID, BEFORE THE NIGHT.
 *
 * A deal can move money before the event — a rental paid to the venue to hold the
 * room, a guarantee paid to the artist to secure the booking. `docs/money.md` has
 * always described the consequence ("a deductible or **an advance is money
 * genuinely owed back**, and flooring that would invent money"), and the deal
 * composer has always offered it: `payment_timing = 'before_event'` is labelled
 * *"Paid up front, then accounted for in the settlement"*, and `advance_amount`
 * renders on the agreement as *"Paid in advance"*.
 *
 * Nothing accounted for it. A deal stating SEK 10 000 already paid still produced
 * a settlement transferring the full entitlement, so the payer paid twice and
 * `Σ net = 0` balanced a total that was wrong — balancing validates the total,
 * never the distribution.
 *
 * **The entitlement is untouched.** The deal is what drives the transaction, so
 * what a party earned is what the deal says they earned. An advance is not a
 * smaller fee; it is the same fee, part of which has already moved. It therefore
 * settles as CASH HELD (`reconcile()` step 4) — the payee is holding some of what
 * they are owed, the payer has already parted with it — and the transfer that
 * remains is the difference. That is also why a net may legitimately go negative:
 * an advance larger than the night earned is money genuinely owed back.
 *
 * **Two columns, one question.** They are not alternatives:
 *   - `advance_amount` is an explicit figure — "10 000 of it is already paid",
 *     whatever the timing says. It wins when set, because it is the more specific
 *     statement.
 *   - `payment_timing = 'before_event'` without one means the deal's own payment
 *     happened early, and the only part of a deal that CAN be paid before the
 *     doors open is its fixed part: you cannot pre-pay a percentage of a door
 *     nobody has counted yet. So it is the guarantee — which is exactly a rental's
 *     amount and a guarantee's amount, the two cases the rule exists for.
 *
 * A pure `door_split` marked `before_event` with no advance therefore prepays
 * NOTHING, and that is the honest answer rather than a guess: there was no
 * knowable figure to pay. `prepaidUnknowable()` reports that case so a caller can
 * say so on screen instead of silently settling as though no money moved.
 */
export interface PrepaidTerms {
  structure: DealStructure | null;
  paymentTiming?: PaymentTiming;
  /** `deals.guarantee_amount` — a rental's amount, or a guarantee's floor. */
  guaranteeAmount?: bigint;
  /** `deals.advance_amount` — an explicit part-payment already made. */
  advanceAmount?: bigint;
}

export function prepaidAmountOf(terms: PrepaidTerms): bigint {
  if (terms.advanceAmount != null && terms.advanceAmount > 0n) return terms.advanceAmount;
  if (terms.paymentTiming !== "before_event") return 0n;
  // `guarantee_vs_door` is included on purpose: what gets paid up front on one of
  // those is the guarantee, and the door half is reconciled after. If the night
  // beats the guarantee the payee keeps the difference as a smaller transfer; if
  // it does not, the guarantee still stands and nothing moves back.
  return terms.guaranteeAmount ?? 0n;
}

/**
 * True when a deal SAYS it was paid before the event but names no amount that
 * could have been paid — a percentage deal with no guarantee and no advance.
 *
 * Not an error: the terms are legal, they just do not settle anything early. It
 * is surfaced so the settlement can state that plainly, because the alternative
 * is a screen that looks identical to a deal with no prepayment at all.
 */
export function prepaidUnknowable(terms: PrepaidTerms): boolean {
  if (terms.advanceAmount != null && terms.advanceAmount > 0n) return false;
  if (terms.paymentTiming !== "before_event") return false;
  return (terms.guaranteeAmount ?? 0n) === 0n;
}
