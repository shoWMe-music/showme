import { type Locator, type Page, expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * What "not responsive" actually means, measured rather than argued about.
 *
 * Four assertions carry almost all of it, and all four are objective:
 *
 *   1. **The page must not scroll sideways.** `scrollWidth <= clientWidth`,
 *      swept across the widths below. A page that scrolls horizontally is the
 *      single most legible symptom of a desktop layout that was never given a
 *      narrow rule — one fixed width, one min-width, one un-wrapping grid, and
 *      the whole screen slides under the reader's thumb.
 *
 *   2. **A modal must fit on the screen too**, and assertion 1 is structurally
 *      blind to it. The scrim is `position: fixed`, so nothing inside a dialog
 *      ever reaches the document's scroll box: a panel can sit 145px past the
 *      right edge of the phone while `documentElement.scrollWidth` reads exactly
 *      the viewport width. Worse, the panel does not scroll when its content
 *      will not fit — it GROWS, because it is a grid item with `min-width: auto`
 *      whose `max-width: 100%` resolves against the very track it is stretching.
 *      So the modal check measures the panel against the VIEWPORT, and every
 *      clipping box inside it against its own content. Every break found in one
 *      so far has been the same shape: `grid-template-columns: 1fr 1fr` is
 *      `minmax(auto, 1fr) minmax(auto, 1fr)`, and a column that will not shrink
 *      below its content's min-content width holds two fields apart inside a
 *      panel that has no room for them.
 *
 *   3. **Nothing may be clipped out of sight.** The other blind spot in
 *      assertion 1, and the one that cost two green audits over real breakage:
 *      `documentElement.scrollWidth` cannot grow past an ancestor that clips,
 *      so a row too wide for its `overflow: hidden` card is not pushed onto the
 *      page — it is amputated at the card's edge, and every width-based check
 *      reads green. `measureClipping` asks every box whose `overflow-x` is not
 *      `visible` whether its own content fits, on the PAGE as well as inside a
 *      dialog. It found the Events list (375px of row in a 330px card) and the
 *      Bills ledger (356 in 330) hiding their last column on a 360px phone, and
 *      the calendar's right rail squeezing the month grid into 108px.
 *
 *   4. **You must be able to get somewhere else.** Below 860px (`app.css`) the
 *      sidebar leaves the layout and becomes an off-canvas drawer, so the test
 *      drives the whole journey — open the menu, pick a destination, land on it
 *      — with the pointer and again with the keyboard alone. It used to be
 *      `display: none` with nothing in its place, which is not a polish problem;
 *      it is the app not working.
 *
 * **Why a sweep and not one width.** 390px alone passed a layout that pushed a
 * 414px phone sideways by 17px and a 430px phone by 9px: a 178px KPI track floor
 * and the available width crossed over between the two. The subtle failures live
 * *between* the breakpoints, where nobody looks — so the sweep includes the two
 * widths that actually broke, both sides of each token breakpoint, and the
 * narrowest width at which the sidebar is back in the layout.
 *
 * **Why it stays fast.** One navigation per screen, then the viewport is resized
 * in place. 16 screens × 9 widths is 144 measurements but still only 16 page
 * loads, and a resize is two animation frames rather than a fetch.
 *
 * Tap targets are reported, not asserted. The 44px floor is Apple's guideline
 * rather than a law, and this app is full of deliberate 26–28px icon buttons —
 * so the count is a work list, not a pass/fail. Failing the build on it would
 * turn a judgement into an obstacle. (It also cannot see the real thing: the
 * project runs `devices["Desktop Chrome"]`, i.e. `pointer: fine`, so the
 * `@media (pointer: coarse)` expansions in `touch.css` never apply here.)
 *
 * Run: `pnpm --filter @showme/web exec playwright test mobile-audit`
 */

const HEIGHT = 844;

/**
 * The sweep. Each width earns its place; none of them is a round number picked
 * for looking like one.
 *
 *  - **360** — the narrowest Android still in real use (Galaxy S/A portrait).
 *  - **390** — iPhone 14/15 portrait. The width this audit used to be, kept so
 *    nothing it already guarded can regress.
 *  - **414** — iPhone 8+/XR/11. Measured breaking by 17px while 390 passed.
 *  - **430** — iPhone 15 Pro Max. Measured breaking by 9px while 390 passed.
 *  - **560** — exactly ON `--breakpoint-phone`: `max-width: 560px` still
 *    matches here, so this is the widest layout the phone rules have to carry.
 *  - **561** — one pixel past it: the narrowest layout with the phone rules
 *    OFF. Every "the compact rule stopped too early" bug lives on this line.
 *  - **768** — iPad portrait, and the middle of the phone→tablet gap.
 *  - **860** — exactly ON `--breakpoint-tablet`: the last width with the
 *    sidebar off-canvas.
 *  - **861** — one pixel past it: the sidebar is back IN the layout, so this is
 *    the tightest content column the desktop shell ever has. It is also what
 *    keeps this suite a desktop guard and not only a phone one.
 *
 * Tokens: `--breakpoint-phone: 560px`, `--breakpoint-tablet: 860px`
 * (`design-system/src/styles/tokens.css`, mirrored in `lib/breakpoints.ts`).
 */
const WIDTHS = [360, 390, 414, 430, 560, 561, 768, 860, 861] as const;

/** The width the drawer/modal journeys run at — a phone, not a tablet. */
const PHONE = { width: 390, height: HEIGHT };

/** Every screen the operator's sidebar can reach, plus the two deep ones. */
const SCREENS: ReadonlyArray<{ readonly path: string; readonly name: string }> = [
  { path: "/", name: "Dashboard" },
  { path: "/calendar", name: "Calendar" },
  { path: "/events", name: "Events" },
  { path: "/tasks", name: "Tasks" },
  { path: "/reports", name: "Setlists" },
  { path: "/settlements", name: "Settlements" },
  { path: "/projections", name: "Financial Projections" },
  { path: "/requests", name: "Requests" },
  { path: "/invoices", name: "Bills & Invoices" },
  { path: "/team", name: "Team" },
  { path: "/contacts", name: "Contacts" },
  { path: "/audience", name: "Audience" },
  { path: "/profiles", name: "My Profiles" },
  { path: "/settings", name: "Settings" },
  { path: "/events/e2e00000-0000-4000-8000-0000000000e1", name: "Event workspace" },
  // The Budget Planner, by name. The line above lands on Event Details, so the
  // densest screen in the app — two editor columns, a money field, a quantity
  // field and three attribution selects per row — was never measured here. It
  // was over at 390px the whole time (482px against a 390px viewport, measured
  // 2026-08-31) and this suite was green. `?tab=` makes the panel addressable,
  // which is what lets it be audited at all.
  { path: "/events/e2e00000-0000-4000-8000-0000000000e1?tab=budget", name: "Budget Planner" },
  { path: "/events/e2e00000-0000-4000-8000-0000000000e2/settlement", name: "Settlement workspace" },
];

test.use({ storageState: authFile("operator"), viewport: PHONE });

/**
 * Wait out the layout that a resize (or a first paint) causes, without a fixed
 * sleep. Two animation frames is the shortest wait that is guaranteed to sit
 * after BOTH the React re-render a `matchMedia` change schedules
 * (`shell/useMobileNavigation.ts` swaps the sidebar for a drawer in JS, not only
 * in CSS) and the style/layout pass that follows it.
 */
async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * The shell is up once `main` exists. Deliberately not `networkidle`: the SSE
 * stream keeps a request in flight forever.
 *
 * `document.fonts.ready` is not decoration. Every measurement here is a text
 * width in disguise, and a page measured against the fallback face gives a
 * different answer than the same page measured against the loaded one — which
 * is how a 3px overflow shows up in two runs out of three. Waiting on the font
 * set is the deterministic form of that wait; a sleep is the guess.
 */
async function waitForShell(page: Page): Promise<void> {
  await page.locator("main").first().waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settleLayout(page);
}

/**
 * Wait for a dialog's ENTER ANIMATION to land before measuring it. Not optional:
 * `useModalMotion` tweens the panel from `scale: .96` to `1`, and
 * `getBoundingClientRect()` reports the TRANSFORMED box — so a panel read a
 * frame after `toBeVisible()` passes measures 501px where the layout is 520px,
 * and the number lands differently on every machine. Every one of those readings
 * is a wrong answer to the question this file exists to ask.
 *
 * Polling for two identical widths in a row is the wait that literally means
 * "the tween stopped moving it". A fixed sleep would be longer AND still wrong
 * on a slow run. The reading sums the dialog and its first child so it settles
 * whichever of the two overlay shapes is animating.
 */
async function waitForStableGeometry(dialog: Locator): Promise<void> {
  let previous = Number.NaN;
  await expect
    .poll(
      async () => {
        const width = await dialog.evaluate(
          (node) =>
            node.getBoundingClientRect().width +
            (node.firstElementChild?.getBoundingClientRect().width ?? 0),
        );
        const settled = Math.abs(width - previous) < 0.5;
        previous = width;
        return settled;
      },
      { timeout: 10_000, intervals: [50, 50, 60, 80, 120] },
    )
    .toBe(true);
}

interface Offender {
  tag: string;
  className: string;
  right: number;
  text: string;
}

interface Reading {
  scrollWidth: number;
  clientWidth: number;
  widest: Offender[];
}

/**
 * `scrollWidth` vs `clientWidth` on one scroll container, plus the elements
 * sticking out furthest — the dump a fixing agent actually starts from. `scope`
 * is `html` for a page and the dialog element for a modal.
 *
 * An element is only named if NO ancestor between it and `scope` clips or
 * scrolls horizontally. A tab strip that side-scrolls on purpose has every one
 * of its tabs past the right edge and none of them is the bug; listing them
 * buries the one element that is, and sent a reader after the wrong thing the
 * first time this dump was read.
 */
function measureOverflow(scope: Locator): Promise<Reading> {
  return scope.evaluate((root) => {
    const box = root.getBoundingClientRect();
    const edge = box.left - root.scrollLeft + root.clientWidth;
    const clippedByAnAncestor = (node: Element) => {
      for (
        let parent = node.parentElement;
        parent && parent !== root;
        parent = parent.parentElement
      ) {
        if (getComputedStyle(parent).overflowX !== "visible") return true;
      }
      return false;
    };
    const widest = [...root.querySelectorAll<HTMLElement>("*")]
      .filter((node) => node.getBoundingClientRect().right > edge + 1)
      .filter((node) => !clippedByAnAncestor(node))
      .slice(0, 5)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        className: typeof node.className === "string" ? node.className.slice(0, 60) : "",
        right: Math.round(node.getBoundingClientRect().right),
        text: (node.textContent ?? "").trim().slice(0, 40),
      }));
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, widest };
  });
}

/** A box that hides part of its own content, and the elements it is hiding. */
interface ClippedBox {
  selector: string;
  scrollWidth: number;
  clientWidth: number;
  widest: Offender[];
}

/**
 * Every box inside `scope` whose content does not fit and whose `overflow-x` is
 * not `visible` — the third blind spot, and the one `scrollWidth <= clientWidth`
 * on the document can never see.
 *
 * The page-level check asks the DOCUMENT whether it grew. A card with
 * `overflow: hidden` never lets it: the row inside is simply amputated at the
 * card's edge and the document stays exactly viewport-wide, so the last column
 * of a table is gone with nothing anywhere reporting it. Measured at 360px
 * before this scan existed, Events put 375px of row inside a 330px card and
 * Bills & Invoices put 356 into 330 — both green on every other assertion in
 * this file.
 *
 * Originally this ran only inside dialogs. It is the same question everywhere,
 * so it now runs on the page too and `measureDialog` calls the same code rather
 * than keeping a second copy of it.
 *
 * Four exemptions, all deliberate:
 *  - `text-overflow: ellipsis` — content wider than the box is the INTENDED
 *    outcome there, and the ellipsis is the user-visible sign that it happened.
 *  - `<input>` / `<textarea>` / `<select>` — a form control scrolls its own
 *    value by definition. A `type="date"` reports a 4248px `scrollWidth` inside
 *    a 362px box while looking perfectly normal.
 *  - a box no wider than zero — an off-canvas drawer or a collapsed panel is not
 *    hiding anything from anyone while it is not on the screen.
 *  - a SCROLLABLE `role="tablist"`, and nothing else that scrolls. The event
 *    workspace has nine tabs; they do not fit 861px, let alone 360px, and
 *    `Tabs.module.css` says in writing why they scroll rather than wrap — a
 *    wrapped strip breaks the sliding indicator's single-line geometry. The
 *    exemption is narrowed to `auto`/`scroll` on purpose: a tablist that clips
 *    with `hidden` has genuinely lost its last tabs and still fails.
 *
 * Note what is otherwise NOT exempt: `overflow-x: auto`. A region you can drag
 * sideways is still a region whose content did not fit, and on a phone that is a
 * worse product than one that wraps — a side-scrolling table was proposed once
 * for the Events and Bills tables and rejected in favour of reflow. Any further
 * scroller has to earn its exemption here, in writing, the way the tab strip
 * did.
 */
function measureClipping(scope: Locator): Promise<ClippedBox[]> {
  return scope.evaluate((root) => {
    const describe = (node: Element) => {
      const classes =
        typeof node.className === "string" && node.className.trim()
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${classes}`.slice(0, 90);
    };

    const offenders = (node: Element) => {
      const box = node.getBoundingClientRect();
      const edge = box.left - node.scrollLeft + node.clientWidth;
      return [...node.querySelectorAll<HTMLElement>("*")]
        .filter((child) => child.getBoundingClientRect().right > edge + 1)
        .slice(0, 5)
        .map((child) => ({
          tag: child.tagName.toLowerCase(),
          className: typeof child.className === "string" ? child.className.slice(0, 60) : "",
          right: Math.round(child.getBoundingClientRect().right),
          text: (child.textContent ?? "").trim().slice(0, 40),
        }));
    };

    const skipTags = ["input", "textarea", "select"];
    return [root, ...root.querySelectorAll("*")]
      .filter((node) => {
        if (skipTags.includes(node.tagName.toLowerCase())) return false;
        if (node.clientWidth === 0) return false;
        const style = getComputedStyle(node);
        if (style.overflowX === "visible" || style.textOverflow === "ellipsis") return false;
        if (node.getAttribute("role") === "tablist" && ["auto", "scroll"].includes(style.overflowX))
          return false;
        return node.scrollWidth > node.clientWidth + 1;
      })
      .slice(0, 6)
      .map((node) => ({
        selector: describe(node),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        widest: offenders(node),
      }));
  });
}

/** A JSON block, pushed in far enough to read under Playwright's own indent. */
function indent(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

/** One line per failing width, formatted so the fix can start from the message
 * alone rather than from a re-run. */
function describeOverflow(width: number, reading: Reading): string {
  return (
    `  ${width}px — overflows by ${reading.scrollWidth - reading.clientWidth}px ` +
    `(scrollWidth ${reading.scrollWidth} > clientWidth ${reading.clientWidth})\n` +
    `${indent(reading.widest)}`
  );
}

/** One line per clipping box, in the same shape as `describeOverflow` so a
 * failure message reads the same whichever of the two found the break. */
function describeClipping(width: number, box: ClippedBox): string {
  return (
    `  ${width}px — \`${box.selector}\` clips its content: ${box.scrollWidth}px of ` +
    `content in ${box.clientWidth}px, ${box.scrollWidth - box.clientWidth}px unreachable — the ` +
    `document never widens, so the sideways-scroll check cannot see this.\n${indent(box.widest)}`
  );
}

/**
 * Measure `scope` at every width, resizing in place. Returns one entry per
 * failing width — every one of them, not just the first, because "which widths"
 * is the whole question and a loop that throws on the earliest answers it with
 * a single sample.
 *
 * Two questions per width, because they fail in opposite directions: content
 * that will not shrink either PUSHES the document wider (the sideways scroll) or
 * gets CUT OFF by a clipping ancestor (`measureClipping`) — and whichever of the
 * two happens, the other reads perfectly green.
 *
 * A width that reads as broken is measured a second time after another two
 * frames before it is believed. Nothing in this app animates its width on
 * resize, but a re-read costs one `evaluate` on the rare failing path and buys
 * certainty that the number is a layout and not a half-finished one.
 */
async function sweepWidths(page: Page, scope: Locator, body: Locator): Promise<string[]> {
  const failures: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    await settleLayout(page);
    let reading = await measureOverflow(scope);
    let clipped = await measureClipping(body);
    if (reading.scrollWidth > reading.clientWidth || clipped.length > 0) {
      await settleLayout(page);
      reading = await measureOverflow(scope);
      clipped = await measureClipping(body);
    }
    if (reading.scrollWidth > reading.clientWidth) failures.push(describeOverflow(width, reading));
    for (const box of clipped) failures.push(describeClipping(width, box));
  }
  return failures;
}

test.describe(`page layout, swept ${WIDTHS[0]}–${WIDTHS[WIDTHS.length - 1]}px`, () => {
  for (const screen of SCREENS) {
    test(`${screen.name} does not scroll sideways at any width`, async ({ page }) => {
      await page.goto(screen.path);
      await waitForShell(page);

      const failures = await sweepWidths(page, page.locator("html"), page.locator("body"));

      expect(
        failures,
        `${screen.name} (${screen.path}) does not fit — ${failures.length} break(s) across ` +
          `${WIDTHS.length} widths:\n${failures.join("\n")}`,
      ).toEqual([]);
    });
  }
});

/**
 * The modals, and how a user opens each one.
 *
 * Chosen by reading the routes rather than by guessing from file names, and
 * limited to dialogs whose trigger is a header action that is on the screen
 * whatever the seed data happens to hold — a modal opened from a table row is a
 * modal whose coverage silently disappears the day the row does.
 */
const MODALS: ReadonlyArray<{
  readonly name: string;
  readonly path: string;
  /** The trigger's ACCESSIBLE name, which is not always its label — a decorative
   * `<svg role="img" aria-label>` inside a button prepends itself to it. A
   * string matches exactly; a RegExp is for the buttons where it does. */
  readonly trigger: string | RegExp;
  /** Something only this dialog says, so a stray toast or confirm can't pass. */
  readonly contains: RegExp;
}> = [
  { name: "New event wizard", path: "/", trigger: "New event", contains: /Create New Event/i },
  { name: "Add contact", path: "/contacts", trigger: "Add Contact", contains: /IBAN/i },
  { name: "Import contacts CSV", path: "/contacts", trigger: "Import CSV", contains: /CSV/i },
  { name: "New task", path: "/tasks", trigger: "New Task", contains: /Task/i },
  { name: "Create work-group", path: "/tasks", trigger: "Create Group", contains: /group/i },
  { name: "Invite team member", path: "/team", trigger: /Invite Member$/, contains: /email/i },
  { name: "New invoice", path: "/invoices", trigger: "New invoice", contains: /invoice/i },
  { name: "New profile", path: "/profiles", trigger: "New profile", contains: /profile/i },
  {
    name: "Check & share availability",
    path: "/calendar",
    trigger: "Check & Share Availability",
    contains: /availab/i,
  },
  {
    name: "Import calendar (.ics)",
    path: "/calendar",
    trigger: "Import",
    contains: /ics|calendar/i,
  },
];

/** The one control on the screen that opens `modal`. */
function modalTrigger(page: Page, trigger: string | RegExp): Locator {
  return page.getByRole("button", { name: trigger, exact: typeof trigger === "string" }).first();
}

interface DialogGeometry {
  /** The panel's box, and whether the viewport actually contains it. */
  panel: { selector: string; left: number; right: number; top: number; bottom: number };
  fitsHorizontally: boolean;
  /** Elements sticking out past the viewport, outermost first — the chain from
   * the panel down to whatever is holding it open. */
  outside: Array<{
    selector: string;
    width: number;
    right: number;
    display: string;
    /** Resolved track list when the element is a grid. `1fr 1fr` resolving to
     * something like `230px 230px` inside a 342px panel is the signature of
     * `minmax(auto, 1fr)` refusing to go below its content's min-content. */
    columns: string;
  }>;
  /** Every scroll/clip container in the dialog that is wider than it can show,
   * from the same `measureClipping` the page sweep runs. */
  clipped: ClippedBox[];
  /** False when the panel runs off the viewport AND nothing scrolls to reach it. */
  actionsReachable: boolean;
  viewport: { width: number; height: number };
}

/**
 * Everything about a dialog that a phone can get wrong, read in one pass.
 *
 * **The panel's own width is the assertion that matters**, and it is not the one
 * you reach for first. A dialog panel is a grid/flex item with `min-width: auto`
 * inside a `position: fixed` scrim, so when its content refuses to shrink the
 * panel does not scroll — it GROWS, past the scrim's `max-width: 100%` and past
 * the screen. Measured on `AddContactModal` at 390px: the panel is 501px wide
 * and its right edge sits at 534, yet `panel.scrollWidth === panel.clientWidth`
 * and `document.documentElement.scrollWidth` is a contented 390, because a fixed
 * element's overflow never reaches the document scroll box. Both of the obvious
 * checks call that green. Asking "is the panel on the screen" is what sees it.
 *
 * The clip scan is the second half, for content that overflows a panel that did
 * NOT grow. The two overlay shapes clip differently — `Modal` puts
 * `overflow: auto` on the panel that carries `role="dialog"`, while
 * `NewEventWizard` puts it on the scrim and `overflow: hidden` on the panel
 * inside — so asking every box whose `overflow-x` is not `visible` whether its
 * content fits covers both, and names the offending box rather than only
 * reporting that one exists. That half now lives in `measureClipping`, which the
 * page sweep runs too; the exemptions it carries are documented there.
 */
async function measureDialog(dialog: Locator): Promise<DialogGeometry> {
  const [box, clipped] = await Promise.all([measureDialogBox(dialog), measureClipping(dialog)]);
  return { ...box, clipped };
}

function measureDialogBox(dialog: Locator): Promise<Omit<DialogGeometry, "clipped">> {
  return dialog.evaluate((root) => {
    const describe = (node: Element) => {
      const classes =
        typeof node.className === "string" && node.className.trim()
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${classes}`.slice(0, 90);
    };

    // The panel is the dialog itself, unless `role="dialog"` sits on a
    // full-viewport fixed scrim (NewEventWizard's shape) — then it is the box
    // inside. Decided by position and origin, never by width: a panel that has
    // burst past the screen is exactly as wide as a scrim and must not be
    // mistaken for one.
    const rootBox = root.getBoundingClientRect();
    const isScrim =
      getComputedStyle(root).position === "fixed" &&
      Math.abs(rootBox.left) <= 1 &&
      Math.abs(rootBox.top) <= 1 &&
      rootBox.width >= window.innerWidth - 1;
    const panel = isScrim && root.firstElementChild ? root.firstElementChild : root;
    const panelBox = panel.getBoundingClientRect();

    const outside = [panel, ...panel.querySelectorAll("*")]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
      })
      .slice(0, 8)
      .map((node) => {
        const style = getComputedStyle(node);
        return {
          selector: describe(node),
          width: Math.round(node.getBoundingClientRect().width),
          right: Math.round(node.getBoundingClientRect().right),
          display: style.display,
          columns: style.display.includes("grid") ? style.gridTemplateColumns : "",
        };
      });

    const scrollsVertically = [panel, root].some((node) =>
      ["auto", "scroll"].includes(getComputedStyle(node).overflowY),
    );
    const fitsOnScreen = panelBox.top >= -1 && panelBox.bottom <= window.innerHeight + 1;

    return {
      panel: {
        selector: describe(panel),
        left: Math.round(panelBox.left),
        right: Math.round(panelBox.right),
        top: Math.round(panelBox.top),
        bottom: Math.round(panelBox.bottom),
      },
      fitsHorizontally: panelBox.left >= -1 && panelBox.right <= window.innerWidth + 1,
      outside,
      actionsReachable: fitsOnScreen || scrollsVertically,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

/** Every way this dialog is broken at this width, one string each. */
function describeDialog(width: number, geometry: DialogGeometry): string[] {
  const found: string[] = [];
  if (!geometry.fitsHorizontally) {
    found.push(
      `  ${width}px — the PANEL itself is off screen: \`${geometry.panel.selector}\` runs ` +
        `${geometry.panel.left}→${geometry.panel.right} in a ${geometry.viewport.width}px viewport. ` +
        `It grew rather than scrolled, so nothing else reports this.\n${indent(geometry.outside)}`,
    );
  }
  for (const box of geometry.clipped) {
    found.push(
      `  ${width}px — \`${box.selector}\` clips its content: ${box.scrollWidth}px of ` +
        `content in ${box.clientWidth}px, ${box.scrollWidth - box.clientWidth}px unreachable.\n` +
        `${indent(box.widest)}`,
    );
  }
  if (!geometry.actionsReachable) {
    found.push(
      `  ${width}px — the panel runs from ${geometry.panel.top} to ${geometry.panel.bottom} ` +
        `in a ${geometry.viewport.height}px viewport and nothing scrolls, so its actions cannot ` +
        `be reached. ${geometry.panel.selector}`,
    );
  }
  return found;
}

test.describe("modals, the viewport inside the viewport", () => {
  for (const modal of MODALS) {
    test(`${modal.name} fits the screen at every width`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(modal.path);
      await waitForShell(page);

      const trigger = modalTrigger(page, modal.trigger);
      await expect(
        trigger,
        `No enabled "${modal.trigger}" control on ${modal.path}, so "${modal.name}" cannot be ` +
          `opened. Either "${modal.trigger}" was renamed and this MODALS entry needs updating, ` +
          `or ${modal.path} renders it disabled because the seed changed under it.`,
      ).toBeEnabled({ timeout: 15_000 });
      await trigger.click();

      const dialog = page.getByRole("dialog").filter({ hasText: modal.contains }).first();
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await waitForStableGeometry(dialog);

      // Resized with the dialog OPEN rather than reopened per width: both
      // overlays are plain CSS boxes with no width transition, so this measures
      // the same layout for a tenth of the wall clock.
      const failures: string[] = [];
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: HEIGHT });
        await settleLayout(page);
        let geometry = await measureDialog(dialog);
        if (
          !geometry.fitsHorizontally ||
          geometry.clipped.length > 0 ||
          !geometry.actionsReachable
        ) {
          await settleLayout(page);
          geometry = await measureDialog(dialog);
        }
        failures.push(...describeDialog(width, geometry));

        // A page that starts scrolling sideways only when a dialog is open is a
        // dialog bug, and the per-screen sweep above can never see it.
        const behind = await measureOverflow(page.locator("html"));
        if (behind.scrollWidth > behind.clientWidth) {
          failures.push(
            `  ${width}px — the page BEHIND the dialog now scrolls sideways by ` +
              `${behind.scrollWidth - behind.clientWidth}px:\n${indent(behind.widest)}`,
          );
        }
      }

      expect(
        failures,
        `"${modal.name}" (opened from ${modal.path} → "${modal.trigger}") does not fit:\n` +
          `${failures.join("\n")}`,
      ).toEqual([]);
    });

    test(`${modal.name} can be dismissed on a phone`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(modal.path);
      await waitForShell(page);

      await modalTrigger(page, modal.trigger).click();
      const dialog = page.getByRole("dialog").filter({ hasText: modal.contains }).first();
      await expect(dialog).toBeVisible({ timeout: 15_000 });

      // A dialog you cannot leave is worse than one that overflows: on a phone
      // there is no window chrome and no visible scrim to click past.
      await page.keyboard.press("Escape");
      await expect(
        dialog,
        "Escape did not close the dialog, so a phone is stuck inside it.",
      ).toBeHidden({ timeout: 10_000 });
    });
  }
});

/**
 * The crop dialog, which the MODALS table above structurally cannot reach.
 *
 * Every entry there is opened by a header BUTTON. This one is opened by picking
 * a file, so it needs its own journey — and it is exactly the dialog most likely
 * to break the rule the table exists to enforce, because its whole body is a
 * fixed-aspect picture frame. A square frame in a 520px dialog is 520px tall
 * before the guidance line, the zoom row and the footer, and its width is the
 * one thing that must never exceed the phone.
 *
 * A 1×1 PNG is enough: the frame is sized by CSS (`width: 100%` +
 * `aspect-ratio`) and the picture inside it is absolutely positioned in an
 * `overflow: hidden` box, so the source's own dimensions cannot influence the
 * layout being measured. What is being tested is the frame, not the photograph.
 */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("the crop dialog, opened by a file rather than a button", () => {
  for (const field of ["Profile picture", "Cover banner"] as const) {
    test(`cropping a ${field.toLowerCase()} fits the screen at every width`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto("/profiles");
      await waitForShell(page);

      const picker = page.locator(`input[type="file"][aria-label="${field}"]`).first();
      await expect(
        picker,
        `No "${field}" file input on /profiles, so its crop dialog cannot be opened. Either the field was renamed or the profile editor no longer renders it.`,
      ).toBeAttached({ timeout: 15_000 });
      await picker.setInputFiles({
        name: "test.png",
        mimeType: "image/png",
        buffer: ONE_PIXEL_PNG,
      });

      // The dialog titles itself "Crop profile picture" / "Crop cover banner",
      // so the field's own name is what distinguishes it from any other dialog.
      const dialog = page
        .getByRole("dialog")
        .filter({ hasText: new RegExp(`Crop ${field}`, "i") })
        .first();
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await waitForStableGeometry(dialog);

      const failures: string[] = [];
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: HEIGHT });
        await settleLayout(page);
        let geometry = await measureDialog(dialog);
        if (
          !geometry.fitsHorizontally ||
          geometry.clipped.length > 0 ||
          !geometry.actionsReachable
        ) {
          await settleLayout(page);
          geometry = await measureDialog(dialog);
        }
        failures.push(...describeDialog(width, geometry));

        const behind = await measureOverflow(page.locator("html"));
        if (behind.scrollWidth > behind.clientWidth) {
          failures.push(
            `  ${width}px — the page BEHIND the crop dialog now scrolls sideways by ` +
              `${behind.scrollWidth - behind.clientWidth}px:\n${indent(behind.widest)}`,
          );
        }
      }

      expect(failures, `The "${field}" crop dialog does not fit:\n${failures.join("\n")}`).toEqual(
        [],
      );
    });
  }
});

test.describe("navigation at 390px", () => {
  test("a phone can navigate somewhere other than where it landed", async ({ page }) => {
    await page.goto("/");
    await waitForShell(page);

    // The sidebar is off-canvas at this width, so the whole question is whether
    // something brings it back. Asking only "is a nav control in the DOM" is not
    // enough — an off-canvas panel still has a bounding box — so this drives the
    // real journey: open the menu, pick a destination, land on it.
    await page.getByTestId("menu-toggle").click();

    const drawer = page.locator("#app-navigation");
    await expect(
      drawer,
      "The navigation drawer did not open. Below 860px the sidebar leaves the " +
        "layout (app.css), so the menu trigger is the only way back to it.",
    ).toBeVisible();

    await drawer.getByRole("button", { name: "Events", exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
    // Arriving closes the menu: a drawer left over the screen you just asked for
    // is the classic way a mobile menu feels broken.
    await expect(drawer).toBeHidden();
  });

  test("the drawer opens, closes and gives focus back, keyboard only", async ({ page }) => {
    await page.goto("/");
    await waitForShell(page);

    const trigger = page.getByTestId("menu-toggle");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const drawer = page.locator("#app-navigation");
    await expect(drawer).toBeVisible();
    expect(
      await drawer.evaluate((node) => node.contains(document.activeElement)),
      "Opening the drawer must move focus into it, or a keyboard has to tab " +
        "through the whole page to reach the menu it just opened.",
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(
      trigger,
      "Closing the drawer must hand focus back to the button that opened it.",
    ).toBeFocused();
  });

  test("reports tap targets below 44px (informational, never fails)", async ({ page }) => {
    const rows: string[] = [];
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await page.locator("main").first().waitFor({ timeout: 30_000 });
      const small = await page.evaluate(() => {
        return [...document.querySelectorAll<HTMLElement>("button, a[href], [role='tab']")]
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .filter((rect) => rect.height < 44 || rect.width < 44).length;
      });
      rows.push(`${screen.name}: ${small}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\nTap targets under 44px per screen:\n  ${rows.join("\n  ")}\n`);
    expect(rows.length).toBe(SCREENS.length);
  });
});
