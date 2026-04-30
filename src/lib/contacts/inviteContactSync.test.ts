import { describe, it, expect } from "vitest";
import {
  planInviteContactBackfill,
  isActiveCollaboratorStatus,
} from "./inviteContactSync";
import type { InvitationCode } from "@/lib/db";

function makeCode(overrides: Partial<InvitationCode> = {}): InvitationCode {
  return {
    code: "SHOW-AAAA-BBBB",
    status: "active",
    createdAt: "2026-04-30T00:00:00.000Z",
    createdByUid: "u1",
    source: "team",
    ...overrides,
  };
}

describe("planInviteContactBackfill", () => {
  it("creates a contact for unlinked codes with a recipient", () => {
    const codes = [
      makeCode({ code: "SHOW-1111-2222", recipientName: "Jane Doe", recipientEmail: "jane@example.com" }),
    ];
    const plans = planInviteContactBackfill(codes, [], 1700000000000);
    expect(plans).toHaveLength(1);
    expect(plans[0].contact.name).toBe("Jane Doe");
    expect(plans[0].contact.invitationCode).toBe("SHOW-1111-2222");
    expect(plans[0].contact.invitationStatus).toBe("active");
    expect(plans[0].contact.contacts[0].email).toBe("jane@example.com");
  });

  it("skips codes that already have linkedContactId", () => {
    const codes = [
      makeCode({ code: "SHOW-1111-2222", recipientEmail: "jane@example.com", linkedContactId: "P-existing" }),
    ];
    expect(planInviteContactBackfill(codes, [])).toHaveLength(0);
  });

  it("skips revoked codes", () => {
    const codes = [
      makeCode({ status: "revoked", recipientEmail: "jane@example.com" }),
    ];
    expect(planInviteContactBackfill(codes, [])).toHaveLength(0);
  });

  it("skips codes whose recipientEmail already matches an existing contact (idempotent)", () => {
    const codes = [
      makeCode({ recipientEmail: "Jane@Example.com", recipientName: "Jane" }),
    ];
    const contacts = [
      {
        id: "P-existing",
        name: "Jane Doe",
        contacts: [{ name: "Jane", email: "jane@example.com", phone: "" }],
      },
    ];
    expect(planInviteContactBackfill(codes, contacts)).toHaveLength(0);
  });

  it("skips codes with neither name nor email", () => {
    const codes = [makeCode({ code: "SHOW-1111-2222" })];
    expect(planInviteContactBackfill(codes, [])).toHaveLength(0);
  });

  it("mirrors the code status onto the contact (used → used)", () => {
    const codes = [makeCode({ status: "used", recipientEmail: "x@y.com" })];
    const plans = planInviteContactBackfill(codes, []);
    expect(plans[0].contact.invitationStatus).toBe("used");
  });

  it("mirrors the code status onto the contact (accepted → accepted)", () => {
    const codes = [makeCode({ status: "accepted", recipientEmail: "x@y.com" })];
    const plans = planInviteContactBackfill(codes, []);
    expect(plans[0].contact.invitationStatus).toBe("accepted");
  });

  it("does not create duplicate plans for two codes sharing the same recipient", () => {
    const codes = [
      makeCode({ code: "SHOW-1", recipientEmail: "a@b.com" }),
      makeCode({ code: "SHOW-2", recipientEmail: "a@b.com" }),
    ];
    const plans = planInviteContactBackfill(codes, []);
    expect(plans).toHaveLength(1);
  });

  it("uses the injected timestamp so generated ids are deterministic", () => {
    const codes = [makeCode({ recipientEmail: "a@b.com" })];
    const a = planInviteContactBackfill(codes, [], 1700000000000);
    const b = planInviteContactBackfill(codes, [], 1700000000000);
    expect(a[0].contact.id).toBe(b[0].contact.id);
  });
});

describe("isActiveCollaboratorStatus", () => {
  it("includes active, used and accepted", () => {
    expect(isActiveCollaboratorStatus("active")).toBe(true);
    expect(isActiveCollaboratorStatus("used")).toBe(true);
    expect(isActiveCollaboratorStatus("accepted")).toBe(true);
  });

  it("excludes revoked and undefined", () => {
    expect(isActiveCollaboratorStatus("revoked")).toBe(false);
    expect(isActiveCollaboratorStatus(undefined)).toBe(false);
  });
});
