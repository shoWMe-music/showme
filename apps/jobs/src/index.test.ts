import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScheduledJobs } from "./index";

let harness: TestDatabase;

const NOW = new Date("2026-07-20T12:00:00.000Z");

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

describe("runScheduledJobs", () => {
  it("runs every job, and an UNCONFIGURED one is skipped rather than failed", async () => {
    // No key in test. The exchange-rate refresh is the only job with an external
    // dependency, and the only one that can legitimately be unconfigured.
    process.env.EXCHANGE_RATE_API = "";

    const result = await runScheduledJobs(harness.db, NOW);

    expect(typeof result.offers).toBe("number");
    expect(typeof result.handoffs).toBe("number");
    expect(typeof result.shares).toBe("number");
    expect(typeof result.representationTerminations).toBe("number");
    expect(typeof result.taskReminders).toBe("number");
    expect(typeof result.exchangeRates).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);

    // Reapers ran cleanly against an empty DB → 0 rows, no errors from them.
    expect(result.offers).toBe(0);
    expect(result.handoffs).toBe(0);
    expect(result.shares).toBe(0);
    expect(result.representationTerminations).toBe(0);
    expect(result.taskReminders).toBe(0);
    expect(result.exchangeRates).toBe(0);

    /*
     * THE POINT OF THIS ASSERTION. Production has no `EXCHANGE_RATE_API` secret,
     * and under the previous contract that made the run exit NON-ZERO every single
     * time — which would have shown the reapers, the task reminders and the GDPR
     * purge as a failing job forever, indistinguishable from a real outage.
     *
     * A missing key here costs a stale DISPLAY rate and nothing else: money.md is
     * explicit that a display currency never touches a settled amount. So it is
     * declined, said out loud, and the run still succeeds.
     */
    expect(result.errors).toEqual([]);
    expect(result.skipped.some((message) => message.startsWith("exchangeRates:"))).toBe(true);
  });

  it("still reports a CONFIGURED job that fails as an error, not a skip", async () => {
    // A key that exists but cannot work. This is the other half of the contract:
    // "not configured" and "configured and broken" must stay distinguishable, or
    // the skip above would just be a way of hiding real failures.
    process.env.EXCHANGE_RATE_API = "definitely-not-a-valid-key";

    const result = await runScheduledJobs(harness.db, NOW);

    expect(result.exchangeRates).toBe(0);
    expect(result.errors.some((message) => message.startsWith("exchangeRates:"))).toBe(true);
    expect(result.skipped.some((message) => message.startsWith("exchangeRates:"))).toBe(false);

    // And the reapers still ran — one job's failure never aborts the others.
    expect(result.offers).toBe(0);
    expect(result.taskReminders).toBe(0);

    process.env.EXCHANGE_RATE_API = "";
  });
});
