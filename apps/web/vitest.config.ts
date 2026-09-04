import { defineConfig } from "vitest/config";

/**
 * The web app's UNIT suite — the thing it went without for months.
 *
 * `package.json`'s `test` script is `playwright test`, so until this existed the
 * app's only tests were browser specs and there was nowhere to assert a pure
 * function. That is not a theoretical gap: `parseDayLocal` shipped with an
 * unanchored regex that also matched the head of a zoned instant, so a timestamp
 * took the date-only branch, threw its clock away and named the UTC day rather
 * than the reader's — inherited by roughly ten call sites within the hour. One
 * unit test would have caught it at the moment of writing (ClickUp 86cbazcf3).
 *
 * Two suites had been exiled into `apps/api` purely because that is where a runner
 * existed. They live here now.
 */
export default defineConfig({
  test: {
    // `node`, not `jsdom`. Everything asserted here is a pure module — formatting,
    // the calendar grid's date arithmetic, the budget planner's derivation, the
    // event list's filter→query translation — and none of it touches the DOM.
    // Reach for jsdom (and @testing-library) the day a test needs to render; do
    // not pay for it before then.
    environment: "node",

    // EXPLICIT, because the default glob would also sweep up `tests/*.spec.ts` —
    // the Playwright specs, which import @playwright/test and cannot run under
    // Vitest. Unit tests sit beside the module they cover, under `src/`.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**", "node_modules/**", "dist/**"],

    /**
     * A FIXED zone for every run. Half of what is asserted here is the difference
     * between "the reader's day" and "the UTC day", and that distinction is
     * invisible in a zone where they coincide — a suite run in UTC cannot fail on
     * the bug this suite exists for. Stockholm is the product's home zone and is
     * ahead of UTC year-round, so a late-evening instant lands on the NEXT local
     * day and the assertions bite.
     *
     * The date tests additionally re-check themselves under other zones by
     * constructing the formatters explicitly, so this pins the default rather than
     * being the only coverage.
     */
    env: { TZ: "Europe/Stockholm" },
  },
});
