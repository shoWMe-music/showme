/**
 * The symbol that labels a money INPUT.
 *
 * Worth its own tests because of what it feeds: `currencySymbol` is the leftIcon
 * on the Budget Planner's money fields, so it tells an operator which currency
 * the number they are typing is in. Getting it wrong means a figure entered as
 * one denomination and settled as another.
 *
 * That is not hypothetical — the event workspace carried a "Display currency"
 * selector whose only effect was to change this symbol, converting nothing
 * (ClickUp 123qy9rnjb8). Picking EUR on a SEK event put a euro sign on every
 * cost field while the values stayed, and settled, in kronor. The selector is
 * gone and the symbol now always comes from the event's own currency.
 */
import { describe, expect, it } from "vitest";
import { currencySymbol } from "./EventDetailsTab";

describe("currencySymbol", () => {
  it("gives each currency its own symbol", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("USD")).toBe("$");
  });

  /**
   * The house currency. SEK has no single-glyph sign — it renders as "SEK" or
   * "kr" depending on locale — so the only thing worth asserting is that it does
   * NOT come out as some other currency's symbol.
   */
  it("never renders one currency under another's sign", () => {
    const swedish = currencySymbol("SEK");
    expect(swedish).toBeTruthy();
    expect(swedish).not.toBe("€");
    expect(swedish).not.toBe("$");
    expect(swedish).not.toBe("£");
  });

  it("distinguishes the Nordic currencies from each other and from the euro", () => {
    const codes = ["SEK", "NOK", "DKK", "EUR"];
    const symbols = codes.map(currencySymbol);
    // Whatever each renders as, none may borrow the euro's sign.
    expect(symbols.filter((symbol) => symbol === "€")).toEqual(["€"]);
  });

  /**
   * An unknown or malformed code must fall back to the code itself rather than
   * throwing — `Intl.NumberFormat` raises on a bad currency, and a money field
   * that crashes the tab is worse than one labelled "XYZ".
   */
  it("falls back to the code rather than throwing", () => {
    expect(currencySymbol("XYZ")).toBe("XYZ");
    expect(currencySymbol("not-a-currency")).toBe("not-a-currency");
    expect(currencySymbol("")).toBe("");
  });

  it("is stable — the same code always gives the same symbol", () => {
    for (const code of ["EUR", "SEK", "GBP", "XYZ"]) {
      expect(currencySymbol(code)).toBe(currencySymbol(code));
    }
  });
});
