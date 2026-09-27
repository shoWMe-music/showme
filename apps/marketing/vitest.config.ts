import { defineConfig } from "vitest/config";

/**
 * The marketing site's UNIT suite — added for the same reason `apps/web`'s was
 * (ClickUp `86cbazcf3`): its only tests were Playwright specs, so there was nowhere to
 * assert a pure function, and this site has two of them that matter. `availability.ts`
 * reads a shared link, and everything it reads is attacker-controlled: a token out of a
 * path, or a snapshot out of a URL fragment somebody typed.
 *
 * The readers live in `availabilitySnapshot.ts` rather than in the page precisely so they
 * can be imported here — the page boots itself at module scope and cannot be.
 */
export default defineConfig({
  test: {
    // `node`: the readers take a `URL` and a plain object and touch no document. The
    // page's rendering half is covered by Playwright, where a DOM is real rather than
    // simulated.
    environment: "node",
    // Explicit, because the default glob would sweep up the Playwright specs under
    // `tests/`, which import @playwright/test and cannot run here.
    include: ["src/**/*.test.ts"],
    exclude: ["tests/**", "node_modules/**", "dist/**"],
  },
});
