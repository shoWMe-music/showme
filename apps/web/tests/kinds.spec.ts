import { expect, test } from "@playwright/test";
import { E2E_ACCOUNTS, type E2eAccountName } from "@showme/shared";
import { authFile } from "./support/accounts";

/**
 * Per-kind end-to-end coverage, anchored to the deterministic e2e seed
 * (`packages/db/src/seed-e2e.ts`). Two things per kind:
 *   1. smoke — restores its saved session and lands authenticated, and
 *   2. boundary — on the Events list it sees EXACTLY the events its role reaches
 *      (reachability = participation / representation) and none it must not.
 * The event-visibility boundary is the authorization engine observed through the
 * UI: what each kind can and cannot reach, per docs/story.md.
 */
const EVENT = {
  albumRelease: "Marlo Vance — Album Release",
  springWarmup: "Spring Warmup",
  openMic: "Open Mic Wednesdays",
  synthShowcase: "Nordic Synth Showcase",
  winterGala: "Winter Gala",
} as const;

const ALL_EVENTS = Object.values(EVENT);

/**
 * For each kind: the EXACT sidebar, in render order (audit A-25). Stated here
 * rather than imported from `src/shell/navigation.ts` on purpose — a test that
 * re-derives its expectation from the code under test asserts nothing.
 *
 * Hidden ≠ forbidden: every route stays registered and reachable by URL. What
 * this asserts is that the navigation stops offering a venue operator's screens
 * to accounts that can never fill them (see the reasons in `navigation.ts`).
 */
const EVERY_NAV_ITEM = [
  "Dashboard",
  "Calendar",
  "Events",
  "Tasks",
  // The two halves of the setlist module, in `navigation.ts` order and NEVER
  // both: the operator files the performed-works report, the act writes the
  // setlist it is derived from (decisions.md "Setlists"). No kind holds both.
  "Performance Reports",
  "Setlists",
  "Settlements",
  "Financial Projections",
  "Requests",
  "Bills & Invoices",
  "Team",
  "Contacts",
  "Audience",
  "My Profiles",
  "Settings",
] as const;

/** The whole set minus the items that kind has no data or no business for. */
const without = (...hidden: string[]) => EVERY_NAV_ITEM.filter((label) => !hidden.includes(label));

const EXPECTED_NAV: Record<E2eAccountName, string[]> = {
  // The operator files; they never author, so no Setlists.
  operator: without("Setlists"),
  // A co-promoter is an operator and gets the operator's nav — the account kind
  // gates the dashboard, and co-hosting is a role on one event, not a lesser kind.
  coHost: without("Setlists"),
  // The mirror image: the act authors and never files, so it gets Setlists and
  // not Performance Reports. No projections either (only operator profiles host
  // events, and the budget is not theirs).
  performerA: without("Performance Reports", "Financial Projections"),
  performerB: without("Performance Reports", "Financial Projections"),
  // Neither half — "crew are NOT a core consumer" (decisions.md); a shared set is
  // reached on the event itself. …and no fan CRM: an arm's-length service, not talent.
  teamAndCrew: without("Performance Reports", "Setlists", "Financial Projections", "Audience"),
  // Neither half — an agent carries business authority, never the songs. …and no
  // fan CRM: the act's following belongs to the act, not its agency.
  agent: without("Performance Reports", "Setlists", "Financial Projections", "Audience"),
};

/** For each kind: the exact event titles it should reach on the Events list. */
const VISIBLE_EVENTS: Record<E2eAccountName, string[]> = {
  // Host of every event → reaches all five.
  operator: [...ALL_EVENTS],
  // Co-promotes the release only — an operator reaches the events it is ON, not
  // every event on the platform.
  coHost: [EVENT.albumRelease],
  // Headliner on the release + performer on the concluded show.
  performerA: [EVENT.albumRelease, EVENT.springWarmup],
  // Support act on the release only.
  performerB: [EVENT.albumRelease],
  // Booked as crew on the release only (schedule-only).
  teamAndCrew: [EVENT.albumRelease],
  // Represents performerA → reaches the event it acts on (the release) only.
  agent: [EVENT.albumRelease],
};

for (const name of Object.keys(E2E_ACCOUNTS) as E2eAccountName[]) {
  const account = E2E_ACCOUNTS[name];
  const visible = VISIBLE_EVENTS[name];
  const hidden = ALL_EVENTS.filter((title) => !visible.includes(title));

  test.describe(`${name} — ${account.kind}`, () => {
    test.use({ storageState: authFile(name) });

    test("restores its session and lands on the dashboard", async ({ page }) => {
      // Plain `goto` — see tests/support/e2e.ts: the shell holds an SSE connection
      // open, so `networkidle` never fires. Each navigation asserts its own
      // readiness below.
      await page.goto("/");
      await expect(page.getByRole("button", { name: /Dashboard/i }).first()).toBeVisible();
      // Not stranded on the auth screen.
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    });

    test("sidebar shows exactly the destinations this kind can use", async ({ page }) => {
      await page.goto("/");
      // Read the `title` attribute, not the text: the Requests row also renders an
      // unread-count badge inside the button.
      const navigationButtons = page.locator('nav[aria-label="Primary"] button');
      // `evaluateAll` is a one-shot read with no auto-waiting, so the shell has to be
      // rendered BEFORE it runs or it silently returns an empty array.
      await navigationButtons.first().waitFor();
      const labels = await navigationButtons.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("title") ?? ""),
      );
      expect(labels).toEqual(EXPECTED_NAV[name]);
    });

    test("Events list shows exactly the events this role reaches", async ({ page }) => {
      await page.goto("/");
      await page
        .getByRole("button", { name: /Events/i })
        .first()
        .click();

      // Everything it should reach is present…
      for (const title of visible) {
        await expect(page.getByText(title, { exact: false })).toBeVisible();
      }
      // …and nothing it must not reach leaks in (list has rendered by now).
      for (const title of hidden) {
        await expect(page.getByText(title, { exact: false })).toHaveCount(0);
      }
    });
  });
}
