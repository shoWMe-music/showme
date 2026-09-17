import { describe, expect, it } from "vitest";
import { type LadderTrigger, nextLadderStatus } from "./lib/event-status-ladder";

/**
 * The booking ladder's RULE, asserted exhaustively and without a database.
 *
 * ClickUp 86cbcehmp: *"Basically let's make sure the status progression,
 * invitation flows and event logic is not broken."*
 *
 * Every one of the seven `event_status` values is driven through every one of
 * the three triggers below — 21 cases, stated as a table. That matters more than
 * it looks: the failure mode for a status machine is not the transition you
 * wrote, it is the one you never thought about, and a suite that only asserts
 * the happy rungs cannot fail on "a cancelled event quietly became confirmed".
 */

/** Every value in the `event_status` enum (packages/db/src/schema/enums.ts). */
const ALL_STATUSES = [
  "draft",
  "suggested",
  "pending",
  "confirmed",
  "on_hold",
  "concluded",
  "cancelled",
] as const;

/**
 * The whole rule as a table: status → trigger → where it goes (`null` = stays).
 * Written out by hand rather than derived, so a change to the implementation
 * cannot quietly rewrite the expectation with it.
 */
const EXPECTED: Record<string, Record<LadderTrigger, string | null>> = {
  draft: {
    performer_invited: "suggested",
    invitation_accepted: "pending",
    deal_confirmed: "confirmed",
  },
  suggested: {
    performer_invited: null, // already suggested — a second act changes nothing
    invitation_accepted: "pending",
    deal_confirmed: "confirmed",
  },
  pending: {
    performer_invited: null, // must NOT drag a live booking back down a rung
    invitation_accepted: null,
    deal_confirmed: "confirmed",
  },
  confirmed: { performer_invited: null, invitation_accepted: null, deal_confirmed: null },
  on_hold: { performer_invited: null, invitation_accepted: null, deal_confirmed: null },
  concluded: { performer_invited: null, invitation_accepted: null, deal_confirmed: null },
  cancelled: { performer_invited: null, invitation_accepted: null, deal_confirmed: null },
};

const TRIGGERS: LadderTrigger[] = ["performer_invited", "invitation_accepted", "deal_confirmed"];

describe("the booking ladder — every status against every trigger", () => {
  for (const status of ALL_STATUSES) {
    for (const trigger of TRIGGERS) {
      const expected = EXPECTED[status]?.[trigger] ?? null;
      it(`${status} + ${trigger} → ${expected ?? "stays put"}`, () => {
        expect(nextLadderStatus(status, trigger)).toBe(expected);
      });
    }
  }
});

describe("the booking ladder — the properties that must hold", () => {
  /** Rung order. A transition may only ever move RIGHT along this. */
  const ORDER = ["draft", "suggested", "pending", "confirmed"];

  it("never moves an event backwards", () => {
    for (const status of ALL_STATUSES) {
      for (const trigger of TRIGGERS) {
        const next = nextLadderStatus(status, trigger);
        if (next === null) continue;
        const from = ORDER.indexOf(status);
        const to = ORDER.indexOf(next);
        expect(to, `${status} + ${trigger} → ${next} went backwards`).toBeGreaterThan(from);
      }
    }
  });

  it("never touches a hold, a finished show, or a cancellation", () => {
    for (const status of ["on_hold", "concluded", "cancelled"]) {
      for (const trigger of TRIGGERS) {
        expect(nextLadderStatus(status, trigger), `${status} was moved by ${trigger}`).toBeNull();
      }
    }
  });

  it("is idempotent — re-firing a trigger on the status it produced does nothing", () => {
    for (const status of ALL_STATUSES) {
      for (const trigger of TRIGGERS) {
        const next = nextLadderStatus(status, trigger);
        if (next === null) continue;
        expect(nextLadderStatus(next, trigger), `${trigger} moved ${next} again`).toBeNull();
      }
    }
  });

  it("leaves a status it does not recognise completely alone", () => {
    // No route can produce one today — but the enum will grow, and a new value
    // must not inherit "and it confirms itself" by default. The first draft of
    // the rule advanced anything non-terminal straight to `confirmed`; this
    // assertion is why it does not.
    for (const trigger of TRIGGERS) {
      expect(nextLadderStatus("not_a_status", trigger)).toBeNull();
      expect(nextLadderStatus("archived", trigger)).toBeNull();
    }
  });
});
