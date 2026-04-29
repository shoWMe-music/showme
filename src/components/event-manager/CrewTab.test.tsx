import { describe, it, expect } from "vitest";
import { isMemberAlreadyInCrew } from "./CrewTab";

// ────────────────────────────────────────────────────────────────────────────
// Bug: "Add Member" autofill dialog marked OTHER team members as "Added"
// when only one had been selected. Root cause: identity check used name+email
// equality with non-discriminating fallbacks (e.g. "" === "" was true) and
// did not consult the `teamMemberId` link that handleAutofill writes onto
// the crew row. Fix: key on `teamMemberId` first, then a non-empty email
// match for hand-typed crew entries.
// ────────────────────────────────────────────────────────────────────────────

describe("isMemberAlreadyInCrew", () => {
  it("returns true when crew entry shares teamMemberId with member", () => {
    const crew = [{ name: "Alice", email: "", teamMemberId: "TM-1" }];
    expect(isMemberAlreadyInCrew(crew, { id: "TM-1", email: "" })).toBe(true);
  });

  it("returns false for a different team member with the same empty email", () => {
    // The bug-trigger scenario: two members both have email "" and one is in
    // the crew. Without the teamMemberId check, the old name/email matcher
    // could (and in the field DID) flip OTHER rows to "Added".
    const crew = [{ name: "Alice", email: "", teamMemberId: "TM-1" }];
    expect(isMemberAlreadyInCrew(crew, { id: "TM-2", email: "" })).toBe(false);
  });

  it("returns false for an unrelated team member with a different email", () => {
    const crew = [{ name: "Alice", email: "alice@x.com", teamMemberId: "TM-1" }];
    expect(isMemberAlreadyInCrew(crew, { id: "TM-2", email: "bob@x.com" })).toBe(false);
  });

  it("falls back to non-empty email matching when teamMemberId is missing", () => {
    // Manually-added crew rows (not from the team directory) have no
    // teamMemberId. We still want to dedupe by email when both sides have one.
    const crew = [{ name: "Alice", email: "alice@x.com" }];
    expect(isMemberAlreadyInCrew(crew, { id: "TM-1", email: "alice@x.com" })).toBe(true);
  });

  it("does not match on empty email even when names line up", () => {
    const crew = [{ name: "Alice", email: "" }];
    expect(isMemberAlreadyInCrew(crew, { id: "TM-X", email: "" })).toBe(false);
  });

  it("returns false for empty crew", () => {
    expect(isMemberAlreadyInCrew([], { id: "TM-1", email: "x@y.com" })).toBe(false);
  });
});
