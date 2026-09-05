import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * A KPI FIGURE FITS ITS TILE, ON ONE LINE.
 *
 * `SEK 83,000` used to render as "SEK 83,00 / 0" across the top of the Budget
 * Planner, and the way it broke is the reason this file exists rather than a note
 * in the layout sweep:
 *
 *   - `Intl` joins a spelled-out currency code to its digits with a NON-BREAKING
 *     space (`SEK 83,000`), so the figure is one unbreakable ten-character
 *     word with no legal break point;
 *   - `StatCard`'s `overflow-wrap: anywhere` — added so a long total is not
 *     clipped by its neighbour — then has nowhere legal to break and splits it
 *     BETWEEN DIGITS. "SEK 83,00 / 0" does not read as a wrapped number, it reads
 *     as a different number, which is worse than either clipping or overflowing;
 *   - `€7,163` never trips it: no space, six characters. So the bug is invisible
 *     in the currency the design was drawn in and appears in the one the first
 *     market actually uses.
 *
 * **`mobile-audit.spec.ts` could not have caught it, and that is the point.** It
 * measures `scrollWidth > clientWidth`. A wrap is the browser SUCCEEDING at
 * staying inside the box — there is no overflow to find. Worse, the failure lives
 * at DESKTOP width, in the four-across grid, which a 360–861px sweep never visits.
 * A green sweep meant "nothing overflowed", never "the numbers are legible"
 * (CLAUDE.md: ask what the check is CAPABLE of failing on).
 *
 * So this measures the thing that actually matters: the figure's natural
 * single-line width against the space its tile gives it.
 */
test.use({ storageState: authFile("operator") });

/** Every screen with a KPI band. */
const SCREENS = ["/settlements", "/invoices", "/projections"] as const;

/**
 * A KPI tile, which is also this spec's readiness signal.
 *
 * The first draft waited for text matching the screen's name and measured zero
 * tiles on all three: `/settlements` matched the SIDEBAR's "Settlements" button
 * instantly, so the wait was satisfied before the band had loaded. Waiting for
 * the thing being measured is the honest signal, and the count assertion below
 * still catches a screen that genuinely has none.
 */
const TILE = '[class*="_value_"]';

/** Desktop first — the four-across grid is where tiles are narrowest. Then a
 *  laptop width, because the tile shrinks with the window and the figure has to
 *  keep up. */
const WIDTHS = [1280, 1440, 1024] as const;

interface FigureFit {
  text: string;
  fontSize: number;
  /** What one unwrapped line of this string needs, at its rendered size. */
  needs: number;
  /** What the tile's content box actually offers. */
  has: number;
  lines: number;
}

/**
 * Measure every KPI figure on the page.
 *
 * The width is measured with a hidden `white-space: nowrap` probe carrying the
 * figure's own computed font, rather than by reading the element's box — the
 * element has already wrapped, so its own width is the tile's width and would
 * report a comfortable fit for the exact bug being tested.
 */
async function measureFigures(page: Page): Promise<FigureFit[]> {
  return page.evaluate(() => {
    return [...document.querySelectorAll('[class*="_value_"]')].map((element) => {
      const styles = getComputedStyle(element);
      const card = element.parentElement as HTMLElement;
      const cardStyles = getComputedStyle(card);
      const available =
        card.getBoundingClientRect().width -
        Number.parseFloat(cardStyles.paddingLeft) -
        Number.parseFloat(cardStyles.paddingRight);

      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.whiteSpace = "nowrap";
      probe.style.fontFamily = styles.fontFamily;
      probe.style.fontWeight = styles.fontWeight;
      probe.style.letterSpacing = styles.letterSpacing;
      probe.style.fontSize = styles.fontSize;
      probe.textContent = element.textContent;
      document.body.appendChild(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();

      const fontSize = Number.parseFloat(styles.fontSize);
      return {
        text: (element.textContent ?? "").trim(),
        fontSize,
        needs: Math.round(needed),
        has: Math.round(available),
        lines: Math.round(element.getBoundingClientRect().height / (fontSize * 1.1)),
      };
    });
  });
}

for (const path of SCREENS) {
  test(`KPI figures fit their tiles on ${path}`, async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.locator(TILE).first().waitFor({ timeout: 15_000 });

      const figures = await measureFigures(page);
      // A screen with no tiles proves nothing, and would let this pass forever if
      // the selector ever stopped matching.
      expect(figures.length, `${path} rendered no KPI tiles at ${width}px`).toBeGreaterThan(0);

      const tooWide = figures.filter((figure) => figure.needs > figure.has);
      const tooWideDetail = tooWide
        .map((f) => `  "${f.text}" needs ${f.needs}px at ${f.fontSize}px, tile offers ${f.has}px`)
        .join("\n");
      expect(
        tooWide,
        `at ${width}px these figures do not fit their tile and will wrap mid-number:\n${tooWideDetail}`,
      ).toEqual([]);

      const wrapped = figures.filter((figure) => figure.lines > 1);
      const wrappedDetail = wrapped.map((f) => `  "${f.text}" — ${f.lines} lines`).join("\n");
      expect(
        wrapped,
        `at ${width}px these figures render on more than one line:\n${wrappedDetail}`,
      ).toEqual([]);
    }
  });
}

/**
 * The Budget Planner carries TWO bands — the four headline tiles and the
 * seven-tile Results grid — and the Results grid has the narrowest tiles in the
 * product. It is also the one that was already worked around once, with a fixed
 * `valueFontSize={24}` that a seven-figure total would still have overflowed.
 */
test("both KPI bands on the Budget Planner fit, including the narrow Results grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/events/e2e00000-0000-4000-8000-0000000000e1");
  const tab = page.getByRole("tab", { name: /budget planner/i });
  await tab.waitFor();
  await tab.click();
  await expect(page.getByText("Costs", { exact: true }).first()).toBeVisible();
  await page.locator(TILE).first().waitFor({ timeout: 15_000 });

  const figures = await measureFigures(page);
  // Four headline tiles + seven Results tiles, at minimum.
  expect(figures.length, "expected both KPI bands to render").toBeGreaterThanOrEqual(11);

  const broken = figures.filter((figure) => figure.needs > figure.has || figure.lines > 1);
  const brokenDetail = broken
    .map(
      (f) => `  "${f.text}" needs ${f.needs}px at ${f.fontSize}px in ${f.has}px, ${f.lines} lines`,
    )
    .join("\n");
  expect(broken, `these figures do not fit:\n${brokenDetail}`).toEqual([]);

  // The figure that started this. Asserted by name so a future change that stops
  // rendering it does not quietly turn this spec into a check of nothing.
  const total = figures.find((figure) => /^SEK\s/.test(figure.text));
  expect(total, "expected a SEK-denominated headline figure on this event").toBeTruthy();
});
