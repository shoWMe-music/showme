import { describe, expect, it } from "vitest";
import { countsAsMoneyOwed, isInvoiceOverdue } from "./invoiceDocument";

/**
 * A DRAFT IS NOT MONEY (QA sweep run 7, QA7-13).
 *
 * The ledger's tiles totalled one, so a bill nobody had issued sat under "Bills you
 * owe" and an invoice nobody had sent under "Invoices you've issued" — while the row
 * beside each was badged Draft with an Issue button still on it.
 *
 * Every date here is RELATIVE to `now`. A fixture pinned to a calendar date inside a
 * now-relative window is a scheduled failure, and this repo has already had one go
 * red at midnight with no code change.
 */
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

describe("countsAsMoneyOwed", () => {
  it("counts an issued invoice", () => {
    expect(countsAsMoneyOwed({ state: "sent" })).toBe(true);
  });

  it("counts one that has gone past its date", () => {
    expect(countsAsMoneyOwed({ state: "overdue" })).toBe(true);
  });

  it("does NOT count a draft — nobody has issued it", () => {
    expect(countsAsMoneyOwed({ state: "draft" })).toBe(false);
  });

  it("does not count money that has landed", () => {
    expect(countsAsMoneyOwed({ state: "paid" })).toBe(false);
  });

  it("does not count an invoice that was called off", () => {
    expect(countsAsMoneyOwed({ state: "void" })).toBe(false);
  });

  it("counts a state it has never met, rather than dropping it from the total", () => {
    // Deliberately a deny-list: money missing from a sum is worse than money shown a
    // state early, because nothing on the screen reveals the omission.
    expect(countsAsMoneyOwed({ state: "part_paid" })).toBe(true);
  });
});

describe("isInvoiceOverdue", () => {
  it("is overdue once an issued invoice's date has passed", () => {
    expect(isInvoiceOverdue({ state: "sent", dueDate: daysFromNow(-1) })).toBe(true);
  });

  it("is not overdue before its date", () => {
    expect(isInvoiceOverdue({ state: "sent", dueDate: daysFromNow(3) })).toBe(false);
  });

  it("is never overdue without a date", () => {
    expect(isInvoiceOverdue({ state: "sent", dueDate: null })).toBe(false);
  });

  it("a DRAFT whose date has slipped is not overdue — it was never issued", () => {
    // The regression: this function excluded only `paid` and `void`, so a draft with
    // a past date was counted as overdue. The sweep missed it because the drafts it
    // typed had no due date at all.
    expect(isInvoiceOverdue({ state: "draft", dueDate: daysFromNow(-30) })).toBe(false);
  });

  it("a paid invoice is not overdue however old", () => {
    expect(isInvoiceOverdue({ state: "paid", dueDate: daysFromNow(-90) })).toBe(false);
  });

  it("is not overdue on an unparseable date", () => {
    expect(isInvoiceOverdue({ state: "sent", dueDate: "not a date" })).toBe(false);
  });
});
