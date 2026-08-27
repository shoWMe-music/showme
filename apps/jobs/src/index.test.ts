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
  it("runs every job and isolates failures", async () => {
    // EXCHANGE_RATE_API is blank in test, so the exchange-rate refresh must throw
    // and be caught — proving one job's failure doesn't abort the reapers.
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

    // The exchange-rate refresh failed and was caught in isolation.
    expect(result.exchangeRates).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((message) => message.startsWith("exchangeRates:"))).toBe(true);
  });
});
