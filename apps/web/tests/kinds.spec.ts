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

/** For each kind: the exact event titles it should reach on the Events list. */
const VISIBLE_EVENTS: Record<E2eAccountName, string[]> = {
  // Host of every event → reaches all five.
  operator: [...ALL_EVENTS],
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
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(page.getByRole("button", { name: /Dashboard/i }).first()).toBeVisible();
      // Not stranded on the auth screen.
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    });

    test("Events list shows exactly the events this role reaches", async ({ page }) => {
      await page.goto("/", { waitUntil: "networkidle" });
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
