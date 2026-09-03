import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * THE SETTLEMENT OVERVIEW ANSWERS THE THREE QUESTIONS IT WAS MISSING.
 *
 * ClickUp `86cbcn1ue`, three unchecked lines on the ticket:
 *   - "Performer/Promoter or any other collaborator details must appear in the
 *      Overview section of the settlement."
 *   - "Ticketing info must appear in the Overview section of the settlement."
 *   - "Deal type and Fee must appear in the Overview section of the settlement."
 *
 * All three were data the product already had and the tab did not show. So the
 * assertions here are deliberately about CONTENT rather than about cards
 * existing: a heading called "Agreements" over an empty box would satisfy a
 * looser test and none of the three requests.
 */
test.use({ storageState: authFile("operator") });

/*
 * SERIAL, because these three read one event's settlement and the first thing
 * each of them does is reconcile it.
 *
 * Run in parallel they raced each other through "Run the settlement" against a
 * shared database — which is how the duplicate-copy bug in
 * `ensureSettlementLines` was found (the Overview reported 960 tickets sold on a
 * night that sold 320). That is now fixed with a per-event advisory lock, so the
 * data would survive a parallel run; the tests would still be reading a settlement
 * another test was recomputing underneath them, which is a different kind of
 * flake and not one worth having.
 */
test.describe.configure({ mode: "serial" });

const ALBUM_RELEASE = "e2e00000-0000-4000-8000-0000000000e1";

/**
 * RECONCILE FIRST, then read the Overview — which is the real order of events and
 * not a convenience.
 *
 * Two of the three things asserted below only exist after a settlement has been
 * run at all. The rule sentences come from `settlements.computed.lines`, and the
 * ticket rows come from the settlement's OWN COPY of the budget, which
 * `ensureSettlementLines` takes on the first compute and never again. Before that
 * the tab is correctly near-empty.
 *
 * The first draft of this spec skipped the compute and failed with "element not
 * found" — a real signal that had nothing to do with the feature, and the sort of
 * failure that gets "fixed" by weakening an assertion if it is not chased.
 */
async function openOverview(page: import("@playwright/test").Page) {
  await page.goto(`/events/${ALBUM_RELEASE}/settlement`);
  await expect(page.getByRole("tab", { name: "Financials" })).toBeVisible();
  await page.getByRole("tab", { name: "Financials" }).click();

  // "Run the settlement" the first time, "Recalculate the settlement" after —
  // the button says which, so the spec accepts either rather than assuming the
  // seed's state. Its label is also the tell that the compute is DONE: the
  // primary "Run" becomes the secondary "Recalculate" once there are figures.
  const run = page.getByRole("button", { name: /the settlement$/ });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole("button", { name: /^Recalculate the settlement$/ })).toBeVisible();

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Event Details")).toBeVisible();
}

test("the Overview states each agreement's kind and what it pays", async ({ page }) => {
  await openOverview(page);

  await expect(page.getByText("Agreements", { exact: true })).toBeVisible();
  await expect(page.getByText("Album Release — Door Split")).toBeVisible();
  // The composer's own vocabulary, not the stored enum: a deal written as a door
  // split must not read back as "door_split".
  await expect(page.getByText("Door split", { exact: true })).toBeVisible();
  await expect(page.getByText("100% of the pool")).toBeVisible();
});

test("the Overview shows what the tickets did, counted and priced", async ({ page }) => {
  await openOverview(page);

  await expect(page.getByText("Ticketing", { exact: true })).toBeVisible();
  // Count x price, and the money formatted as money. Rendering the editor's raw
  // major-unit strings put "65000.00" beside "SEK 83,000" in the card above and
  // made one night look like two ledgers.
  // `\s` rather than a literal space between the parts: `formatMoney` puts a
  // NON-BREAKING space inside "SEK 250" (Intl does, and it is correct — a currency
  // and its amount should never be split across a line), and a regex matches the
  // text as it actually is. A literal-space regex found nothing here while the
  // words were plainly on screen, which is a fine way to spend twenty minutes
  // doubting a feature that works.
  await expect(page.getByText(/260\s*x\s*SEK\s*250/)).toBeVisible();
  await expect(page.getByText(/60\s*x\s*SEK\s*300/)).toBeVisible();
  await expect(page.getByText(/SEK\s*65,000/).first()).toBeVisible();
  await expect(page.getByText("Tickets sold")).toBeVisible();
  await expect(page.getByText("320", { exact: true })).toBeVisible();
});

/**
 * The collaborator details were already built — `SettlementPartyCard` draws the
 * party, their role, their entitlement and the RULE behind it. The Overview was
 * drawing a hand-rolled card beside it that dropped the explanation.
 *
 * So the assertion that matters is the rule sentence: a name and a number were
 * always there, and a test checking only those would have passed before the fix.
 */
test("the Overview names each collaborator, their role and the rule behind their figure", async ({
  page,
}) => {
  await openOverview(page);

  await expect(page.getByText("Marlo Vance").first()).toBeVisible();
  await expect(page.getByText("Performer").first()).toBeVisible();
  await expect(page.getByText(/your share of/).first()).toBeVisible();
});

/**
 * THE FIRST HOP OF THE TICKETING CHAIN — event details → Budget Planner.
 *
 * ClickUp `86cbcn1ue`: *"Ticketing info still missing and does not migrate from
 * the event ticketing details - it should first go to budget planner from event
 * details and then to settlement."*
 *
 * The last hop always worked: the settlement takes its copy of the budget on the
 * first compute, `details` and all. The FIRST hop did not exist. An event has had
 * a Ticketing card since `extras.ticketTiers` was typed, and the planner ignored
 * it and opened on one invented "General Admission" row at 80% of the room — so an
 * operator who had already listed their tiers was asked to type them again, and
 * the two lists then disagreed with nothing to say which was right.
 *
 * "Open Mic Wednesdays" is the seed's one event with NO budget, which is what
 * makes it the only place this is visible: a stored budget line correctly wins
 * over a suggestion, so on any other event the hop is invisible whether it works
 * or not.
 */
test("the Budget Planner opens on the tiers the event already lists", async ({ page }) => {
  const OPEN_MIC = "e2e00000-0000-4000-8000-0000000000e3";
  await page.goto(`/events/${OPEN_MIC}`);
  await page.getByRole("tab", { name: /budget planner/i }).click();

  const types = page.locator('main input[placeholder="Ticket type"]');
  await expect(types).toHaveCount(2);
  await expect(types.nth(0)).toHaveValue("Door entry");
  await expect(types.nth(1)).toHaveValue("Advance");

  // Priced and counted from the event, not invented. `est` and not `max`: a budget
  // forecasts what will SELL, and the cap is how many exist.
  await expect(page.locator('main [aria-label="Door entry price"]')).toHaveValue("80");
  const quantities = page.locator('main input[placeholder="Qty"]');
  await expect(quantities.nth(0)).toHaveValue("60");
  await expect(quantities.nth(1)).toHaveValue("25");

  // And the invented row is gone — its presence would mean the seed won anyway.
  await expect(page.locator('main input[value="General Admission"]')).toHaveCount(0);
  await expect(types.filter({ hasText: "General Admission" })).toHaveCount(0);
});
