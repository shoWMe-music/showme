import { describe, expect, it } from "vitest";
import { invitationStillNeedsAnAnswer } from "./useEventInvitations";

/**
 * WHICH INVITATIONS THE READER CAN STILL ANSWER — decisions §25.9.9, and the verification sweep of
 * 2026-09-30, which is what found this.
 *
 * §25.9.9 refuses the ACCEPT on a cancelled event and deliberately keeps the DECLINE: *"closing the
 * invitation is the answer a performer most wants on record."* The API did both correctly from the
 * first commit. The SCREEN did not: this list filtered to `pending` alone, and the API crosses the
 * event's status into `requestStatus` (QA5-2), so an invitation to a called-off night never
 * rendered — no row, therefore no Decline anywhere in the app for a participation invitation.
 *
 * **And it made §25.9.9's own guard in `EventInvitationsCard` dead code.** That card withholds
 * Accept on `requestStatus !== "cancelled"`, which could never fire on a row that was filtered out
 * first — so "Accept is gone" was true for the wrong reason, and a test of the card alone would
 * have agreed with it. That is why this predicate is exported and tested here rather than left
 * inside the hook: it is the line the guard depends on being asked.
 */
describe("invitationStillNeedsAnAnswer", () => {
  it("keeps a pending invitation, and a cancelled one the reader can still decline", () => {
    expect(invitationStillNeedsAnAnswer({ requestStatus: "pending" })).toBe(true);
    expect(invitationStillNeedsAnAnswer({ requestStatus: "cancelled" })).toBe(true);
  });

  /*
   * AND DROPS THE ONES ALREADY ANSWERED, which is the half that keeps this a list of questions
   * rather than a history. A predicate that returned true for everything would satisfy the
   * assertion above and turn the card into the "All" tab.
   */
  it("drops an invitation that has been answered or has run out", () => {
    for (const requestStatus of ["accepted", "declined", "expired"]) {
      expect(invitationStillNeedsAnAnswer({ requestStatus })).toBe(false);
    }
  });
});
