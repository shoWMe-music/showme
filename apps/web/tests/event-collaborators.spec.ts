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
  // `tab`, not `button`: the event tab strip is the design system's `Tabs` now
  // (a real `tablist`), where it used to be a bare row of buttons.
  const tab = page.getByRole("tab", { name: /collaborators/i }).first();
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
  // The `host` ENUM value now renders as "Operator" (decisions.md #16.20 —
  // "'host' collided with the door-person meaning"). The stored role is
  // unchanged; this assertion follows the label deliberately, and it is the
  // regression guard that the roster still prints a role at all.
  await expect(page.getByText("Operator", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Confirmed").first()).toBeVisible();
});

/**
 * The tab used to render read-only cards: an avatar, a name, a role and a
 * Confirmed pill, and no way to change any of it — while
 * `PATCH/DELETE /events/:id/participants/:pid` had been sitting there the whole
 * time (ClickUp 86cbaxuvj).
 *
 * What is asserted here is the REFUSALS as much as the actions, because the two
 * are one feature: the API protects the host's row on both routes, so an Edit or
 * a Remove offered on the host is a button whose click is a 403. Deliberately
 * non-mutating — the writes themselves are proven against Postgres, and a spec
 * that removed a seeded collaborator would move the ground under every other
 * test in the file.
 */
test("edit and remove are offered per collaborator, and refused on the host", async ({ page }) => {
  await openCollaborators(page);

  const editEntry = page.getByRole("menuitem", { name: /^Edit/ });
  const removeEntry = page.getByRole("menuitem", { name: /^Remove/ });

  // The host anchors the event: both entries exist and both say WHY, rather than
  // silently vanishing (which reads as a missing feature) or 403-ing on click.
  await page.getByRole("button", { name: "Actions for The Lantern Hall" }).click();
  await expect(editEntry).toBeDisabled();
  await expect(editEntry).toContainText(/anchors this event/i);
  await expect(removeEntry).toBeDisabled();
  await expect(removeEntry).toContainText(/cannot be removed/i);
  await page.keyboard.press("Escape");

  // A booking agent's row is the projection of a representation (decisions #14),
  // so its role is not an operator's to retype — the API would happily write it.
  await page.getByRole("button", { name: "Actions for Astra Booking Agency" }).click();
  await expect(editEntry).toBeDisabled();
  await expect(editEntry).toContainText(/through the performer they represent/i);
  await page.keyboard.press("Escape");

  // Anyone else: both live, and Edit opens the role/access form.
  await page.getByRole("button", { name: "Actions for Priya Sound" }).click();
  await expect(removeEntry).toBeEnabled();
  await editEntry.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Edit Priya Sound");
  await expect(dialog.getByRole("button", { name: "Role on this event" })).toContainText("Crew");
  // Nothing has been changed, so there is nothing to save.
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
