import { describe, it, expect } from "vitest";
import {
  PDF_FOOTER_DISCLAIMER_Y_MM,
  PDF_FOOTER_PAGE_COUNTER_Y_MM,
} from "./BudgetExportActions";

// Regression test for the PDF footer overlap bug. The disclaimer text and the
// page counter used to render at y=pageHeight-12 and y=pageHeight-7, which
// caused them to crash into each other on multi-page exports. Both values
// must stay sufficiently far apart on the y-axis (>= 6mm separation) so that
// they never visually collide regardless of font size.
describe("BudgetExportActions PDF footer layout", () => {
  it("places disclaimer and page counter on different y-coordinates", () => {
    expect(PDF_FOOTER_DISCLAIMER_Y_MM).not.toBe(PDF_FOOTER_PAGE_COUNTER_Y_MM);
  });

  it("separates disclaimer and page counter by at least 6mm", () => {
    const separation = Math.abs(
      PDF_FOOTER_DISCLAIMER_Y_MM - PDF_FOOTER_PAGE_COUNTER_Y_MM,
    );
    expect(separation).toBeGreaterThanOrEqual(6);
  });

  it("renders the disclaimer above the page counter (further from the bottom)", () => {
    // Both constants are measured as "mm from page bottom" — the disclaimer
    // should have the larger value so it sits visually above the counter.
    expect(PDF_FOOTER_DISCLAIMER_Y_MM).toBeGreaterThan(PDF_FOOTER_PAGE_COUNTER_Y_MM);
  });
});
