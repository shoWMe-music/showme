import { describe, expect, it } from "vitest";
import { fieldLabel } from "./eventHistory";

describe("the field names the timeline prints", () => {
  it("gives a reader's word to every name the log has actually held", () => {
    /*
     * QA sweep run 13: "Deal terms changed · Status: Draft · Changed: agreementBodyText" at a venue
     * operator. These six are not invented — they are
     * `select distinct jsonb_array_elements_text(summary->'fields') from activity_log`, so the
     * assertion covers what the app has really written rather than what it might.
     */
    expect(fieldLabel("agreementBodyText")).toBe("terms");
    expect(fieldLabel("assigneeParticipantId")).toBe("assignee");
    expect(fieldLabel("extras")).toBe("amenities, ticket tiers or guest list");
    expect(fieldLabel("dueDate")).toBe("due date");
    expect(fieldLabel("notes")).toBe("notes");
    expect(fieldLabel("splitBasisPoints")).toBe("split");
  });

  it("never leaves a camelCase identifier at the reader, mapped or not", () => {
    // The point of the rules over a bare map: the writers build `fields` from a Partial of a whole
    // table, so the set is open and an unmapped name must still read as English.
    for (const field of [
      "agreementBodyText",
      "assigneeParticipantId",
      "splitBasisPoints",
      "paymentTiming",
      "guaranteeAmount",
      "venueProfileId",
      "imageFileId",
      "holdAutoPromote",
    ]) {
      expect(fieldLabel(field), `field ${field}`).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it("strips Id and BasisPoints as plumbing, and only at the END", () => {
    /*
     * THE BOUNDARY, and the first version of this test could not see it. It used `identityCheck`
     * and `basisPointsCap`, whose suffixes are lower-cased — so an UNANCHORED `replace(/Id/, "")`
     * matched neither and the mutation dropping the `$` survived. No column in the schema carries a
     * mid-string `Id` today (checked), which is exactly why the fixture has to supply one: a
     * predicate with one kind of input cannot be tested.
     *
     * `taxIdNumber` is the shape that makes it observable and is not hypothetical for long — a tax
     * or VAT identifier on a profile is an ordinary column to add, and the rule has to stay right
     * when somebody adds it rather than by luck.
     */
    expect(fieldLabel("venueProfileId")).toBe("venue profile");
    expect(fieldLabel("splitBasisPoints")).toBe("split");
    expect(fieldLabel("taxIdNumber")).toBe("tax id number");
    expect(fieldLabel("splitBasisPointsCap")).toBe("split basis points cap");
    expect(fieldLabel("identityCheck")).toBe("identity check");
    expect(fieldLabel("basisPointsCap")).toBe("basis points cap");
  });

  it("falls back to the identifier rather than printing nothing", () => {
    // A name that is ONLY a stripped suffix would otherwise read as a change to no field at all.
    expect(fieldLabel("Id")).toBe("Id");
    expect(fieldLabel("BasisPoints")).toBe("BasisPoints");
  });

  it("keeps the snake_case shape `humanize` already handled", () => {
    // `fields` has carried both spellings; this must not regress the one that worked.
    expect(fieldLabel("due_date")).toBe("due date");
  });
});
