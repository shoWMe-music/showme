import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * THE MOTION'S CORRECTNESS, not its taste.
 *
 * Every assertion here is a thing that can be WRONG rather than merely ugly, and each one has cost
 * something at least once in this codebase:
 *
 *  - **A fold that ends on a measured pixel height** clips its own content the moment the content
 *    grows (a party signs, a line appears). `useCollapseMotion` therefore hands the wrapper back to
 *    `height: auto` the instant the open tween completes, and that handover is invisible on screen —
 *    the only way to see it is to read the inline style, which is what this does.
 *  - **A collapsed card that keeps a strip of empty floor.** Recorded in this repo already: 16px of
 *    nothing under every folded card, because a `gap` survived a height of zero.
 *  - **A transform left behind at rest.** An identity matrix is still a transform, so it makes the
 *    element a containing block and re-anchors anything `position: fixed` inside it. Three separate
 *    motion hooks state this rule in their comments; this is the test that keeps it true.
 *  - **`prefers-reduced-motion` being a promise nobody checks.** The system answers it once, by
 *    collapsing the duration tokens to 0ms, and the JS hooks read `useReducedMotion`. Playwright can
 *    emulate the setting, which is the only way to run that path at all — a live browser session
 *    cannot be asked to change it.
 *
 * WHY THE SAMPLING IS DONE INSIDE THE PAGE. The tween lasts ~200ms. A round trip per sample would
 * miss most of it and make the test flaky on a loaded machine, so a `requestAnimationFrame` loop is
 * installed first, the click goes through Playwright's real input pipeline, and the samples are read
 * afterwards. Using a real click rather than `element.click()` also matters for anything measuring
 * layout shift: a synthetic click is not a TRUSTED input, so CLS does not excuse the movement it
 * causes, and it will manufacture a defect that a real click does not (measured 2026-09-28).
 */

const EVENT_ID = "e2e00000-0000-4000-8000-0000000000e1";

interface FoldSample {
  height: string;
  overflow: string;
  opacity: string;
}

/** Arm an in-page sampler on the fold, so the tween is caught from its first frame. */
async function armFoldSampler(page: Page, foldId: string): Promise<void> {
  await page.evaluate((id) => {
    const fold = document.getElementById(id);
    if (!fold) throw new Error(`no fold ${id}`);
    const inner = fold.firstElementChild as HTMLElement | null;
    const samples: FoldSample[] = [];
    (window as unknown as { __motionSamples: FoldSample[] }).__motionSamples = samples;
    const tick = () => {
      samples.push({
        height: fold.style.height,
        overflow: fold.style.overflow,
        opacity: inner?.style.opacity ?? "",
      });
      if (samples.length < 120) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, foldId);
}

async function readSamples(page: Page): Promise<FoldSample[]> {
  return page.evaluate(
    () => (window as unknown as { __motionSamples: FoldSample[] }).__motionSamples ?? [],
  );
}

/** How many frames caught the fold at a height strictly between closed and open. */
function intermediateHeights(samples: FoldSample[]): number {
  return samples.map((sample) => Number.parseFloat(sample.height)).filter((value) => value > 0)
    .length;
}

/**
 * The first deal card's disclosure, and the id of the region it folds — with the fold left CLOSED.
 *
 * Normalised rather than asserted: on the seeded Album Release the first card arrives **expanded**,
 * so a test that assumed otherwise measured a CLOSE where it meant to measure an OPEN. Which card
 * starts open is the screen's business and may reasonably change; what these tests need is a known
 * starting point, so they make one.
 */
async function openDealsTab(page: Page): Promise<{ foldId: string }> {
  await page.goto(`/events/${EVENT_ID}?tab=deals`);
  const trigger = page.locator("main button[aria-controls]").first();
  await trigger.waitFor({ timeout: 30_000 });
  const foldId = await trigger.getAttribute("aria-controls");
  if (!foldId) throw new Error("the deal card's disclosure has no aria-controls");
  if ((await trigger.getAttribute("aria-expanded")) === "true") {
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Let the close tween finish, or the next sampler starts mid-flight and reads its tail.
    await page.waitForTimeout(500);
  }
  return { foldId };
}

test.describe("motion — the deal card's fold", () => {
  test.use({ storageState: authFile("operator") });

  test("animates open, then hands the height back to auto", async ({ page }) => {
    const { foldId } = await openDealsTab(page);
    const fold = page.locator(`#${foldId}`);
    await expect(fold).toHaveAttribute("style", /height: 0px/);

    await armFoldSampler(page, foldId);
    await page.locator("main button[aria-controls]").first().click();
    await expect(page.locator("main button[aria-controls]").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // The tween's own length plus room for a slow machine.
    await page.waitForTimeout(600);

    const samples = await readSamples(page);
    expect(samples.length, "the sampler ran").toBeGreaterThan(10);
    expect(
      intermediateHeights(samples),
      "the fold passed through heights between closed and open",
    ).toBeGreaterThan(2);

    /*
     * THE HANDOVER. `height: auto` is a resting state that tracks content forever; a measured pixel
     * height is a number that goes stale the moment anything inside the card grows. `overflow` is
     * released with it so a focus ring or a popover at the card's edge is not shaved off.
     */
    const inlineStyle = (await fold.getAttribute("style")) ?? "";
    expect(inlineStyle).toContain("height: auto");
    expect(inlineStyle).toContain("overflow: visible");
  });

  test("animates closed, and leaves no floor behind", async ({ page }) => {
    const { foldId } = await openDealsTab(page);
    const trigger = page.locator("main button[aria-controls]").first();
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(500);

    await armFoldSampler(page, foldId);
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await page.waitForTimeout(600);

    const samples = await readSamples(page);
    expect(intermediateHeights(samples), "the fold animated shut").toBeGreaterThan(2);

    const fold = page.locator(`#${foldId}`);
    expect((await fold.getAttribute("style")) ?? "").toContain("height: 0px");
    // The recorded trap, measured on the box itself rather than on the style that should cause it.
    expect(await fold.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
    // And nothing left animating it into a containing block.
    expect(await fold.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    // Collapsed content holds no tab stops.
    await expect(fold).toHaveAttribute("inert", "");
  });
});

test.describe("motion — under prefers-reduced-motion", () => {
  test.use({ storageState: authFile("operator") });

  /*
   * `page.emulateMedia` rather than `test.use({ reducedMotion })`: this Playwright's TestOptions
   * type does not carry the option, and emulating the media feature is what it would do anyway.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  /**
   * The same interaction, and the SAME end state, with nothing in between.
   *
   * This is the only place the reduced-motion path runs at all: the setting is the viewer's, so no
   * amount of clicking in a normal browser session reaches it. Zero intermediate frames is a
   * stronger assertion than "fewer" — the hook does not shorten the tween, it does not create one.
   */
  test("opens instantly, with the same resting state", async ({ page }) => {
    const { foldId } = await openDealsTab(page);
    await armFoldSampler(page, foldId);
    await page.locator("main button[aria-controls]").first().click();
    await expect(page.locator("main button[aria-controls]").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.waitForTimeout(600);

    const samples = await readSamples(page);
    expect(samples.length, "the sampler ran").toBeGreaterThan(10);
    expect(intermediateHeights(samples), "no tween at all").toBe(0);

    const inlineStyle = (await page.locator(`#${foldId}`).getAttribute("style")) ?? "";
    expect(inlineStyle).toContain("height: auto");
    expect(inlineStyle).toContain("overflow: visible");
  });
});

test.describe("motion — a dialog leaves nothing behind", () => {
  test.use({ storageState: authFile("operator") });

  /**
   * The New Event wizard, which is the interesting one: it draws its own panel rather than using the
   * shared `Modal` shell, so for a long time it played no motion at all while every other dialog
   * faded and rose. It borrows `useModalMotion` now, and this is what stops that from silently
   * regressing to nothing — plus the transform check, which is the reason the hook clears it.
   */
  test("the wizard rises, and rests with no transform on its panel", async ({ page }) => {
    await page.goto(`/events/${EVENT_ID}`);
    await page.locator("main").first().waitFor({ timeout: 30_000 });

    await page.evaluate(() => {
      const samples: string[] = [];
      (window as unknown as { __panelTransforms: string[] }).__panelTransforms = samples;
      const tick = () => {
        const panel = document.querySelector('[role="dialog"]')?.firstElementChild;
        if (panel) samples.push(getComputedStyle(panel).transform);
        if (samples.length < 120) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.getByRole("button", { name: "New event" }).click();
    const panel = page.locator('[role="dialog"]');
    await panel.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(700);

    const transforms = await page.evaluate(
      () => (window as unknown as { __panelTransforms: string[] }).__panelTransforms ?? [],
    );
    expect(new Set(transforms).size, "the panel moved rather than appearing").toBeGreaterThan(3);

    // At rest: nothing. An identity matrix would still make the panel a containing block and
    // re-anchor any `position: fixed` descendant to it instead of the viewport.
    const resting = await panel.evaluate((element) => {
      const child = element.firstElementChild as HTMLElement;
      return { inline: child.style.transform, computed: getComputedStyle(child).transform };
    });
    expect(resting.inline).toBe("");
    expect(resting.computed).toBe("none");
  });
});
