import { describe, expect, it } from "vitest";
import { eventParticipantRoleLabel, humanizeEnumValue } from "./event-roles";

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
