import { describe, expect, it } from "vitest";
import { invoiceAmountDraft } from "./invoiceDocument";

/**
 * WHAT A NEW BILL IS DENOMINATED IN (QA sweep run 6, QA6-17).
 *
 * The create form defaulted to EUR twice — `useState("EUR")` and a second
 * `|| "EUR"` at the submit — so an operator whose every other figure is SEK typed
 * 2500 and Postgres took `250000 | EUR`. The KPI strip on the same screen had
 * already settled the rule in September: *"zero in the wrong currency is a
 * statement about their money that happens to be false"*. A bill is worse, because
 * it is stored.
 */
describe("invoiceAmountDraft", () => {
  it("parses a decimal amount into minor units for its own currency", () => {
    expect(invoiceAmountDraft("2500", "SEK")).toEqual({
      code: "SEK",
      minor: 250_000n,
      problem: null,
    });
    expect(invoiceAmountDraft("2500.75", "SEK").minor).toBe(250_075n);
  });

  it("asks the CURRENCY how many minor units a major one holds", () => {
    // The whole reason `Math.round(Number(amount) * 100)` had to go: ¥2,500 is
    // 2500 minor units, not 250,000, and KWD has three decimal places.
    expect(invoiceAmountDraft("2500", "JPY").minor).toBe(2_500n);
    expect(invoiceAmountDraft("2.5", "KWD").minor).toBe(2_500n);
  });

  it("refuses when there is no currency rather than inventing one", () => {
    expect(invoiceAmountDraft("2500", "")).toEqual({
      code: "",
      minor: null,
      problem: "no-currency",
    });
    expect(invoiceAmountDraft("2500", "   ").problem).toBe("no-currency");
  });

  it("refuses a code it does not know rather than guessing its exponent", () => {
    // `majorToMinor` would THROW here; the form must never reach that, and must
    // never fall back to two decimal places on a currency it cannot look up.
    expect(invoiceAmountDraft("2500", "XYZ")).toEqual({
      code: "XYZ",
      minor: null,
      problem: "unknown-currency",
    });
  });

  it("normalizes the code the way it will be stored", () => {
    expect(invoiceAmountDraft("10", " sek ")).toEqual({
      code: "SEK",
      minor: 1_000n,
      problem: null,
    });
  });

  it("calls an empty, zero or negative amount no amount", () => {
    // A bill for nothing is not a bill; a negative one is a credit note, and this
    // form does not write those.
    expect(invoiceAmountDraft("", "SEK").problem).toBe("no-amount");
    expect(invoiceAmountDraft("0", "SEK").problem).toBe("no-amount");
    expect(invoiceAmountDraft("0.00", "SEK").problem).toBe("no-amount");
    expect(invoiceAmountDraft("-10", "SEK").problem).toBe("no-amount");
  });

  it("names the missing currency BEFORE the missing amount", () => {
    // Both are wrong on an empty form. The currency is the one the reader cannot
    // fix by typing in this field, so it is the one worth saying first.
    expect(invoiceAmountDraft("", "").problem).toBe("no-currency");
  });
});
