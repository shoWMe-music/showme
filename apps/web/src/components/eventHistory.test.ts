import { describe, expect, it } from "vitest";
import { fieldLabel, foldRepeatedActivity, repeatedActivityLabel } from "./eventHistory";

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

/**
 * ONE BUTTON PRESS, ONE LINE — QA sweep run 16's second MAJOR, second half.
 *
 * The status route writes one row per settlement it moves, which is what makes each row readable by
 * the party it belongs to. The operator sees all of them, so one press of "Send for review" on a
 * six-party bill printed the same sentence six times and four actions printed twenty-one lines.
 */
describe("foldRepeatedActivity", () => {
  const row = (type: string, summary: unknown = {}) => ({ type, summary });

  it("folds one press into one line carrying the count", () => {
    const folded = foldRepeatedActivity([
      row("settlement.pending_review"),
      row("settlement.pending_review"),
      row("settlement.pending_review"),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.repeated).toBe(3);
    expect(folded[0]?.entry.type).toBe("settlement.pending_review");
  });

  it("leaves a single act as itself, with a count of one", () => {
    const folded = foldRepeatedActivity([row("settlement.finalized")]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.repeated).toBe(1);
  });

  /*
   * CONSECUTIVE ONLY. Two separate review rounds are two things that happened; folding across the
   * whole list would merge a Tuesday with a Thursday and lose the story the panel exists for.
   */
  it("does not fold two rounds separated by something else", () => {
    const folded = foldRepeatedActivity([
      row("settlement.revised"),
      row("settlement.commented"),
      row("settlement.revised"),
    ]);
    expect(folded.map((entry) => [entry.entry.type, entry.repeated])).toEqual([
      ["settlement.revised", 1],
      ["settlement.commented", 1],
      ["settlement.revised", 1],
    ]);
  });

  /*
   * FOLDED ON THE RENDERED TITLE, not the type: the rule is defined in terms of what a reader can
   * actually tell apart, which is the only place the duplication existed. `settlement.confirmed` and
   * `settlement.approved` are two names for one consent moment and read identically, so they fold.
   */
  it("folds two types that render the same sentence", () => {
    const folded = foldRepeatedActivity([row("settlement.confirmed"), row("settlement.approved")]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.repeated).toBe(2);
  });

  it("keeps two rows that read differently apart", () => {
    const folded = foldRepeatedActivity([row("settlement.revised"), row("settlement.finalized")]);
    expect(folded).toHaveLength(2);
  });

  it("returns nothing for nothing", () => {
    expect(foldRepeatedActivity([])).toEqual([]);
  });
});

/**
 * The browser caught the first version of this claiming "10 parties" for ten remarks by one person.
 */
describe("repeatedActivityLabel", () => {
  it("says nothing for a single act", () => {
    expect(repeatedActivityLabel("settlement.revised", 1)).toBeNull();
    expect(repeatedActivityLabel("settlement.revised", 0)).toBeNull();
  });

  it("counts PARTIES for a status move, because one press moves one row per settlement", () => {
    expect(repeatedActivityLabel("settlement.revised", 6)).toBe("6 parties");
    expect(repeatedActivityLabel("settlement.pending_review", 6)).toBe("6 parties");
  });

  it("counts REMARKS for comments, which are separate acts by whoever wrote them", () => {
    expect(repeatedActivityLabel("settlement.commented", 10)).toBe("10 remarks");
  });

  it("counts PAYMENTS for transfers", () => {
    expect(repeatedActivityLabel("transfer.state_changed", 3)).toBe("3 payments");
  });

  /*
   * A type nobody has considered gets a bare multiplier, not a guessed noun — an absent noun is
   * honest and a wrong one is the defect this function exists to fix.
   */
  it("falls back to a multiplier rather than inventing a noun", () => {
    expect(repeatedActivityLabel("deal.sent", 4)).toBe("\u00d74");
  });
});
