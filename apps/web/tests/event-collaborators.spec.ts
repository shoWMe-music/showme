import { expect, test } from "@playwright/test";
import { authFile } from "./support/accounts";

/**
 * The Collaborators tab is laid out like the Team screen's member grid: each
 * person on their own card, directly on the page background. It used to be rows
 * inside one big surface — a card inside a card, which reads as a container the
 * eye has to discount before it can see the people.
 *
 * The numbers asserted here are Team's (`routes/Team.tsx`: `minmax(260px, 1fr)`,
 * `gap: 14`). Stated literally rather than read from the other screen, because
 * Team renders no grid at all on the seeded data (no members), so a
 * cross-screen comparison would silently assert nothing.
 */
test.use({ storageState: authFile("operator") });

const ALBUM_RELEASE = "e2e00000-0000-4000-8000-0000000000e1";

async function openCollaborators(page: import("@playwright/test").Page) {
  await page.goto(`/events/${ALBUM_RELEASE}`);
  const tab = page.getByRole("button", { name: /collaborators/i }).first();
  await tab.waitFor();
  await tab.click();
  await expect(page.getByText("The Lantern Hall").first()).toBeVisible();
}

test("collaborators are cards on the page, not rows in a container", async ({ page }) => {
  await openCollaborators(page);

  const layout = await page.evaluate(() => {
    const grids = [...document.querySelectorAll("main div")].filter(
      (element) => getComputedStyle(element).display === "grid" && element.children.length > 1,
    );
    const grid = grids[grids.length - 1];
    if (!grid) return null;

    // Walk up to <main>: nothing between the cards and the page may paint a surface.
    let ancestor = grid.parentElement;
    let painted: string | null = null;
    while (ancestor && ancestor.tagName !== "MAIN") {
      const background = getComputedStyle(ancestor).backgroundColor;
      if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") {
        painted = `${ancestor.tagName}: ${background}`;
        break;
      }
      ancestor = ancestor.parentElement;
    }

    const card = grid.firstElementChild as HTMLElement;
    return {
      gap: getComputedStyle(grid).gap,
      trackCount: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      cardPadding: getComputedStyle(card).padding,
      cardIsSurface: getComputedStyle(card).backgroundColor,
      painted,
    };
  });

  expect(layout, "the collaborators should render as a grid of cards").not.toBeNull();
  // No white container behind the cards.
  expect(layout?.painted).toBeNull();
  // Team's gutter, and a multi-column track rather than one card per row.
  expect(layout?.gap).toBe("14px");
  expect(layout?.trackCount).toBeGreaterThan(1);
  // Each person is their own surface.
  expect(layout?.cardPadding).toBe("18px");
  expect(layout?.cardIsSurface).not.toBe("rgba(0, 0, 0, 0)");
});

test("every collaborator on the event is shown, with role and status", async ({ page }) => {
  await openCollaborators(page);

  // The seeded album release: venue, two performers, crew, agent.
  for (const name of ["The Lantern Hall", "Marlo Vance", "Neon Tide", "Priya Sound", "Astra"]) {
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByText("Host", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Confirmed").first()).toBeVisible();
});
