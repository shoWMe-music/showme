import { describe, expect, it } from "vitest";
import {
  countsAsMoneyOwed,
  invoiceAmountText,
  invoiceReference,
  isInvoiceOverdue,
} from "./invoiceDocument";

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

/**
 * A UUID FRAGMENT IS NOT A REFERENCE (QA sweep run 7, QA7-27).
 *
 * The fallback printed `1ec9843d` — the first segment of the row's primary key — in the
 * EVENT / REFERENCE column and in the document title. It looks like a reference and cannot
 * be quoted to anybody. Two rows legitimately have no number: a received bill, whose
 * reference belongs to the vendor, and an issued invoice before it is issued.
 */
describe("invoiceReference", () => {
  it("is the invoice's number once it has one", () => {
    expect(
      invoiceReference({ number: "LH-2026-014", id: "1ec9843d-0000-4000-8000-000000000001" }),
    ).toBe("LH-2026-014");
  });

  it("does not invent one from the primary key", () => {
    const reference = invoiceReference({
      number: null,
      id: "1ec9843d-0000-4000-8000-000000000001",
    });
    expect(reference).toBe("—");
    expect(reference).not.toContain("1ec9843d");
  });
});

/**
 * `SEK 0` IS A CLAIM; A NULL TOTAL IS A GAP (QA sweep run 9, QA9-12).
 *
 * The ledger read *"— · — · — · 15 Jan 2026 · SEK 0 · Overdue"* — a row asserting an
 * amount of zero three columns to the right of the dash it used for a category it does
 * not have. The same modal already had this rule on the VAT amount and on a line-item
 * total; the invoice's own total was the one field it was missing.
 */
describe("invoiceAmountText", () => {
  /** `Intl.NumberFormat` separates a currency with U+00A0, which no source file types. */
  const plain = (text: string) => text.replace(/\u00a0|\u202f/g, " ");

  it("prints an em dash when nobody has typed an amount yet", () => {
    expect(invoiceAmountText({ total: null, currency: "SEK" })).toBe("—");
  });

  it("prints a genuine zero AS a zero — the distinction is the whole point", () => {
    expect(plain(invoiceAmountText({ total: "0", currency: "SEK" }))).toBe("SEK 0");
  });

  it("formats an amount in the invoice's own currency", () => {
    expect(plain(invoiceAmountText({ total: "777700", currency: "SEK" }))).toBe("SEK 7,777");
  });

  it("falls back to the caller's currency when the row carries none", () => {
    // The ledger passes nothing and gets EUR, which is what it did before this existed.
    expect(plain(invoiceAmountText({ total: "500", currency: null }, "SEK"))).toBe("SEK 5");
    expect(plain(invoiceAmountText({ total: "500", currency: null }))).toBe("€5");
  });
});
