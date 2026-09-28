import { describe, expect, it } from "vitest";
import { confirmsOwnDealLines, eventParticipantRoleLabel, humanizeEnumValue } from "./event-roles";

describe("eventParticipantRoleLabel", () => {
  it("writes the `host` enum value as Operator (decisions.md #16.20)", () => {
    // The product's word for the event-manager. The COLUMN still says `host`
    // everywhere — the permission ceiling, the roster's icon and tone maps, the
    // API's `OPERATOR_EVENT_ROLES` — and this is the only place the word changes.
    expect(eventParticipantRoleLabel("host")).toBe("Operator");
    expect(eventParticipantRoleLabel("co_host")).toBe("Co-operator");
  });

  it("never emits the word 'Host' for any member of the role enum", () => {
    const roles = ["host", "co_host", "performer", "support", "crew_lead", "crew", "agent"];
    for (const role of roles) {
      expect(eventParticipantRoleLabel(role).toLowerCase()).not.toContain("host");
    }
  });

  it("title-cases a role it has no product word for, rather than printing the raw value", () => {
    expect(eventParticipantRoleLabel("performer")).toBe("Performer");
    expect(eventParticipantRoleLabel("crew_lead")).toBe("Crew lead");
    // An invitation carries its role as free text, so an unknown value has to
    // read as a word — this is the fallback the five copied helpers all were.
    expect(eventParticipantRoleLabel("stage_manager")).toBe("Stage manager");
  });
});

describe("humanizeEnumValue", () => {
  it("turns an underscored enum value into a sentence-cased word", () => {
    expect(humanizeEnumValue("team_and_crew")).toBe("Team and crew");
    expect(humanizeEnumValue("technical")).toBe("Technical");
    expect(humanizeEnumValue("")).toBe("");
  });
});

/**
 * WHICH EVENT ROLES SIGN THEIR OWN DEAL LINE (QA sweep run 10, QA10-3).
 *
 * Tested at the definition rather than through its two consumers, because neither can see all of it:
 * the web filters observers out before asking, so its tests cannot fail on the observer clause, and
 * the server's tests reach the rule only through `dealPartyBaselineCapabilities`. Both of those
 * survived a mutation that made every role a signatory.
 *
 * The defect this rule exists to prevent: the web restated the set as `["crew","crew_lead"]` while
 * the server's carried `co_host`, so a co-host named as a deal party was offered no confirm control
 * and `POST /settlement/compute` then refused to run because the agreement was unsigned.
 */
describe("confirmsOwnDealLines", () => {
  it("says yes to the three roles whose confirm authority is deal-scoped", () => {
    for (const role of ["crew", "crew_lead", "co_host"]) {
      expect(confirmsOwnDealLines(role, "payer")).toBe(true);
      expect(confirmsOwnDealLines(role, "payee")).toBe(true);
    }
  });

  it("says no to an OBSERVER, whatever their event role", () => {
    // Being able to read an agreement says nothing about being able to sign it (#4).
    for (const role of ["crew", "crew_lead", "co_host"]) {
      expect(confirmsOwnDealLines(role, "observer")).toBe(false);
    }
  });

  it("says no to the roles that hold event-scoped `agreement.confirm` already", () => {
    /*
     * Not an oversight in either direction. `POST /events` writes the host's row with
     * `operator_full`, and `PERFORMER_FLOOR` carries `agreement.confirm`, so a host, a performer and
     * a support act never reach this rule — and widening it to them would be granting authority on
     * speculation. This test is what stops "make every role a signatory" from passing quietly.
     */
    for (const role of ["host", "performer", "support", "agent"]) {
      expect(confirmsOwnDealLines(role, "payer")).toBe(false);
    }
  });

  it("says no to a role it has never heard of", () => {
    // The safe direction: no button rather than a dead one. Both callers pass strings.
    expect(confirmsOwnDealLines("promoter", "payer")).toBe(false);
    expect(confirmsOwnDealLines("", "payer")).toBe(false);
  });
});
