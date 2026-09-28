import { describe, expect, it } from "vitest";
import { type AgreementAuthority, dealActionsFor } from "./useEventAgreements";

/**
 * WHICH CONTROLS ONE AGREEMENT OFFERS — and in particular the two that end it.
 *
 * `dealActionsFor` is the only thing standing between a person and a button the API will refuse.
 * Every case below mirrors a case `apps/api/src/deals.test.ts` proves server-side, which is the
 * whole argument for the rule living in `@showme/shared`: this file and that one ask the same
 * function, so they cannot drift into disagreeing about what is deletable (decisions §25.7.2).
 */

type Deal = Parameters<typeof dealActionsFor>[0];

/** A deal with only the fields these rules read — the rest of the payload is irrelevant here. */
function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    name: "Wrong guarantee",
    agreementStatus: "draft",
    status: "draft",
    version: 1,
    parties: [],
    ...overrides,
  } as Deal;
}

const manager: AgreementAuthority = { canCompose: true, canManage: true, canConfirm: true };
const bystander: AgreementAuthority = { canCompose: false, canManage: false, canConfirm: false };

describe("dealActionsFor — ending an agreement (decisions §25.7.2)", () => {
  it("offers Delete on a draft when the night has no settlement", () => {
    const actions = dealActionsFor(deal(), manager, [], false);
    expect(actions.canDelete).toBe(true);
    expect(actions.deleteBlockedReason).toBeNull();
    // Cancel is offered alongside it: deleting is not the only ending for a draft.
    expect(actions.canCancel).toBe(true);
  });

  it("withholds Delete once the night has a settlement, and says why", () => {
    const actions = dealActionsFor(deal(), manager, [], true);
    expect(actions.canDelete).toBe(false);
    expect(actions.deleteBlockedReason).toContain("settlement");
    expect(actions.canCancel).toBe(true);
  });

  it("withholds Delete once the agreement has left draft", () => {
    for (const agreementStatus of ["sent", "confirmed", "signed"]) {
      const actions = dealActionsFor(deal({ agreementStatus }), manager, [], false);
      expect(actions.canDelete).toBe(false);
      expect(actions.deleteBlockedReason).toContain("Cancel it instead");
    }
  });

  /**
   * THE DEFAULT IS PESSIMISTIC, on purpose.
   *
   * `hasSettlement` defaults to `true`, and the hook passes `true` while the read is still in
   * flight. A caller who forgets the argument — or a card that renders before the deals response
   * lands — therefore offers Cancel, never a Delete that 409s. Getting this backwards would put a
   * destructive control on screen for exactly as long as the request takes.
   */
  it("assumes the night IS settled when nobody says otherwise", () => {
    expect(dealActionsFor(deal(), manager).canDelete).toBe(false);
  });

  it("offers neither ending to somebody who cannot manage agreements", () => {
    const actions = dealActionsFor(deal(), bystander, [], false);
    expect(actions.canDelete).toBe(false);
    expect(actions.canCancel).toBe(false);
    // And no explanation either: the sentence is only useful to somebody who might have deleted it.
    expect(actions.deleteBlockedReason).toBeNull();
  });

  it("stops offering Cancel on an agreement already cancelled, and still allows deleting a draft", () => {
    const actions = dealActionsFor(deal({ status: "cancelled" }), manager, [], false);
    expect(actions.canCancel).toBe(false);
    /*
     * Deletable, and that is deliberate rather than an oversight: the two columns answer different
     * questions. `status: cancelled` says it pays nobody; `agreement_status: draft` says it was
     * never sent, so there is no other party whose record this is. A cancelled DRAFT is the one
     * shape where both endings are reasonable, and offering the tidy-up is the kinder of the two.
     */
    expect(actions.canDelete).toBe(true);
  });
});
