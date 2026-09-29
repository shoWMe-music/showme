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

/**
 * WHO IS OFFERED *CONFIRM YOUR LINE* (QA sweep run 10, QA10-3).
 *
 * The rule is `confirmsOwnDealLines` in `@showme/shared`, which `@showme/auth` also reads — these
 * tests are the client end of it. The defect they exist for: this file restated the server's set as
 * `["crew","crew_lead"]`, the server's has carried `co_host` all along, and so a co-host named as the
 * payer of a room hire got no button while the confirm route answered 200 to the same account. The
 * settlement then refuses to compute while the agreement is unsigned, which is how a missing button
 * freezes a night.
 */
describe("dealActionsFor — signing your own line (QA10-3)", () => {
  const sent = { agreementStatus: "sent", status: "draft" };
  /** Nobody holding event-scoped `agreement.confirm` — the seat the deal-scoped rule is for. */
  const noEventConfirm: AgreementAuthority = {
    canCompose: false,
    canManage: false,
    canConfirm: false,
  };
  /**
   * A roster of one. Cast through `unknown` because a participant row carries `profileId`, `name`,
   * `avatarUrl`, `genres` and three more fields, and the only two this rule reads are `id` and
   * `role` — spelling out the rest would say that they matter.
   */
  const roster = (id: string, role: string) =>
    [{ id, role }] as unknown as Parameters<typeof dealActionsFor>[2];

  /** One party line of the caller's own, unsigned — the shape the deal-scoped rule reads. */
  const withOwnLine = (participantId: string, roleInDeal = "payer"): Partial<Deal> => ({
    ...sent,
    // `id` and `version` are the generated type's, not this rule's: no branch of `dealActionsFor`
    // reads them, and giving them real values is cheaper than a cast that hides the next field.
    parties: [
      {
        id: `line-${participantId}`,
        version: 1,
        participantId,
        roleInDeal,
        isYours: true,
        confirmedAt: null,
      },
    ],
  });

  it("offers a CO-HOST named as a party the confirm control", () => {
    const actions = dealActionsFor(
      deal(withOwnLine("part-co")),
      noEventConfirm,
      roster("part-co", "co_host"),
      false,
    );
    expect(actions.canConfirm).toBe(true);
  });

  it("still offers it to crew and a crew lead", () => {
    for (const role of ["crew", "crew_lead"]) {
      const actions = dealActionsFor(
        deal(withOwnLine("part-crew")),
        noEventConfirm,
        roster("part-crew", role),
        false,
      );
      expect(actions.canConfirm).toBe(true);
    }
  });

  it("withholds it from an OBSERVER, whatever their event role", () => {
    // Being able to read an agreement says nothing about being able to sign it (#4). The observer
    // clause is inside the shared rule, so both sides apply it.
    const actions = dealActionsFor(
      deal(withOwnLine("part-co", "observer")),
      noEventConfirm,
      roster("part-co", "co_host"),
      false,
    );
    expect(actions.canConfirm).toBe(false);
  });

  it("withholds it on a DRAFT, because the terms have not been put to anybody", () => {
    const actions = dealActionsFor(
      deal({ ...withOwnLine("part-co"), agreementStatus: "draft" }),
      noEventConfirm,
      roster("part-co", "co_host"),
      false,
    );
    expect(actions.canConfirm).toBe(false);
  });

  it("withholds it on a CANCELLED deal, whoever the party is", () => {
    /*
     * QA10-9. A cancelled agreement read *"Sent — awaiting confirmations"* with a live Confirm button
     * in both operators' seats, and the server took the signature: the row ended up
     * `agreement_status = confirmed` on a `cancelled` deal. The server refuses it now; this is the
     * button not being drawn in the first place.
     */
    const actions = dealActionsFor(
      deal({ ...withOwnLine("part-co"), status: "cancelled" }),
      noEventConfirm,
      roster("part-co", "co_host"),
      false,
    );
    expect(actions.canConfirm).toBe(false);
    // And the other endings behave: nothing to cancel twice, and a cancelled draft can still be
    // tidied away (§25.7.2).
    expect(actions.canCancel).toBe(false);
  });

  it("withholds it once that party has already signed", () => {
    const actions = dealActionsFor(
      deal({
        ...sent,
        parties: [
          {
            id: "line-part-co",
            version: 1,
            participantId: "part-co",
            roleInDeal: "payer",
            isYours: true,
            confirmedAt: "2026-09-28T00:00:00Z",
          },
        ],
      }),
      noEventConfirm,
      roster("part-co", "co_host"),
      false,
    );
    expect(actions.canConfirm).toBe(false);
  });
});

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

/**
 * THE TERMS EDITOR, AND THE SEAL IT HAS TO AGREE WITH (QA sweep run 12's only MAJOR).
 *
 * `agreementBodyText` is in `SIGNED_TERM_FIELDS`, so `PATCH /deals/:did` answers 409 the moment any
 * party has signed. `EventAgreementTab` derived this from `agreementStatus` — the rule as it stood
 * BEFORE part 29 moved the seal to the first signature — so for eight days a partly-signed deal
 * offered a live "Write terms" button, a dialog repeating the superseded rule, and a Save that
 * failed. The answer now comes from here, where `sealed` is already computed for Reopen and Delete.
 */
describe("dealActionsFor — the terms editor tracks the seal, not the status", () => {
  const unsigned = { confirmedAt: null, roleInDeal: "payer" };
  const signed = { confirmedAt: "2026-09-29T12:00:00.000Z", roleInDeal: "payee" };
  const parties = (...rows: object[]) => rows as unknown as Deal["parties"];

  it("offers it on a draft nobody has signed", () => {
    const actions = dealActionsFor(
      deal({ agreementStatus: "draft", parties: parties(unsigned, unsigned) }),
      manager,
    );
    expect(actions.canEditTerms).toBe(true);
  });

  it("offers it on a SENT deal that is still out for signature", () => {
    // The case the spec is about: parties are looking at terms nobody has committed to.
    const actions = dealActionsFor(
      deal({ agreementStatus: "sent", parties: parties(unsigned, unsigned) }),
      manager,
    );
    expect(actions.canEditTerms).toBe(true);
  });

  it("WITHDRAWS it at the FIRST signature, while the status is still `sent`", () => {
    // The defect, exactly. Status `sent`, one of two signed — the API refuses, so the screen must.
    const actions = dealActionsFor(
      deal({ agreementStatus: "sent", parties: parties(signed, unsigned) }),
      manager,
    );
    expect(actions.canEditTerms).toBe(false);
    // And the control that IS correct here is offered in its place, which is what turns the 409's
    // own instruction ("reopen it first") into something the reader can press.
    expect(actions.canReopen).toBe(true);
  });

  it("withdraws it on a confirmed deal", () => {
    const actions = dealActionsFor(
      deal({ agreementStatus: "confirmed", status: "confirmed", parties: parties(signed, signed) }),
      manager,
    );
    expect(actions.canEditTerms).toBe(false);
  });

  it("withdraws it on a cancelled deal, which pays nobody and is nobody's to word", () => {
    const actions = dealActionsFor(
      deal({ agreementStatus: "sent", status: "cancelled", parties: parties(unsigned, unsigned) }),
      manager,
    );
    expect(actions.canEditTerms).toBe(false);
  });

  it("asks canCompose, not canManage — writing the words is the composing capability", () => {
    const composerOnly: AgreementAuthority = {
      canCompose: true,
      canManage: false,
      canConfirm: false,
    };
    const managerOnly: AgreementAuthority = {
      canCompose: false,
      canManage: true,
      canConfirm: false,
    };
    const unsignedSent = deal({ agreementStatus: "sent", parties: parties(unsigned, unsigned) });
    expect(dealActionsFor(unsignedSent, composerOnly).canEditTerms).toBe(true);
    expect(dealActionsFor(unsignedSent, managerOnly).canEditTerms).toBe(false);
    // The control beside it moves the other way, which is what makes these two capabilities and
    // not one: revising the FIGURES is the managing act.
    expect(dealActionsFor(unsignedSent, managerOnly).canReviseTerms).toBe(true);
    expect(dealActionsFor(unsignedSent, composerOnly).canReviseTerms).toBe(false);
  });

  it("offers nothing to a bystander", () => {
    expect(
      dealActionsFor(deal({ agreementStatus: "sent", parties: parties(unsigned) }), bystander)
        .canEditTerms,
    ).toBe(false);
  });

  it("an OBSERVER's timestamp does not seal the terms", () => {
    /*
     * FOUND WHILE WRITING THIS TEST, and the first version of it did not test its own name: it
     * gave the observer `confirmedAt: null`, so it passed on a `termsAreSealed` that counted
     * observers. With a real timestamp it failed, which is the defect.
     *
     * `POST /deals/:did/confirm` stamps every line the caller stands behind and does not filter
     * observers, so an observer who pressed confirm sealed the figures for every party while
     * `allSignatoriesConfirmed` ignored the same row and left the agreement `sent`. Everything
     * else that counts signatures says `roleInDeal !== "observer"`; `termsAreSealed` now does too.
     */
    const observerStamped = { confirmedAt: "2026-09-29T12:00:00.000Z", roleInDeal: "observer" };
    const actions = dealActionsFor(
      deal({ agreementStatus: "sent", parties: parties(unsigned, observerStamped) }),
      manager,
    );
    expect(actions.canEditTerms).toBe(true);
    // Nothing is sealed, so there is nothing to reopen either.
    expect(actions.canReopen).toBe(false);

    // The control: the same timestamp on a SIGNATORY does seal it.
    const signatoryStamped = dealActionsFor(
      deal({
        agreementStatus: "sent",
        parties: parties(unsigned, { ...observerStamped, roleInDeal: "payee" }),
      }),
      manager,
    );
    expect(signatoryStamped.canEditTerms).toBe(false);
    expect(signatoryStamped.canReopen).toBe(true);
  });
});
