import { describe, expect, it } from "vitest";
import { groupMemberLabel, initials, nameFromEmail } from "./teamLabels";

describe("the avatar's two letters", () => {
  it("ignores a parenthetical, which is an annotation and not part of a name", () => {
    /*
     * QA sweep run 13. These two names are what the seed actually stores in `users.name`, and the
     * old rule took the first letter of the first and LAST words — so the crew member read **PE**,
     * P(riya) + e(ngineer). That is the dangerous kind of wrong: it looks like a correct pair.
     */
    expect(initials("Priya Sound (FOH engineer)")).toBe("PS");
    expect(initials("Northlight Presents (co-promoter)")).toBe("NP");
  });

  it("strips a parenthetical wherever it sits, not only at the end", () => {
    // "Jane (she/her) Doe" is the same shape, and a trailing-only rule would read JD by luck here
    // and fail on the next arrangement.
    expect(initials("Jane (she/her) Doe")).toBe("JD");
    expect(initials("(trading as) Acme Sound")).toBe("AS");
  });

  it("keeps reading an ordinary name exactly as before — THE CONTROL", () => {
    // So the change is the brackets and nothing else. "TH" is what the PEOPLE list beside the group
    // chips already showed, which is the two lists agreeing.
    expect(initials("The Lantern Hall")).toBe("TH");
    expect(initials("Marlo Vance")).toBe("MV");
    expect(initials("Priya")).toBe("PR");
    expect(initials("priya.sound@e2e.showme.test")).toBe("PS");
  });

  it("falls back to the bracketed text when that is the WHOLE label", () => {
    // A member whose only label is a role reads that role's initials, not "?" — stripping must not
    // turn the one name they have into nothing.
    expect(initials("(operator)")).toBe("OP");
    expect(initials("()")).toBe("?");
    expect(initials("")).toBe("?");
  });
});

describe("which label a group member gets", () => {
  it("prefers the stored name, then the address, then the role", () => {
    // The FALLBACK CHAIN, in order. Team once called somebody "Professional" that Contacts called
    // "Priya Sound", because the name was one join away and this read the role (run 11).
    expect(groupMemberLabel({ name: "Priya Sound", email: "p@x.test", roleLabel: "FOH" })).toBe(
      "Priya Sound",
    );
    expect(groupMemberLabel({ name: null, email: "tobias@x.test", roleLabel: "FOH" })).toBe(
      "Tobias",
    );
    expect(groupMemberLabel({ name: "   ", email: null, roleLabel: "Stage Manager" })).toBe(
      "Stage Manager",
    );
    expect(groupMemberLabel({})).toBe("Member");
  });

  it("builds a name out of an email local-part's separators", () => {
    expect(nameFromEmail("priya.sound@e2e.showme.test")).toBe("Priya Sound");
    expect(nameFromEmail("co-host@x.test")).toBe("Co Host");
    expect(nameFromEmail(null)).toBeNull();
    // The UNSET case the address form allows: an address with no local part answers nothing.
    expect(nameFromEmail("@x.test")).toBeNull();
  });
});
