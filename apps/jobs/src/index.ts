import { type Database, createDatabase } from "@showme/db";
import { runExchangeRateRefresh } from "./exchange-rate";
import {
  reapDueRepresentationTerminations,
  reapExpiredHandoffs,
  reapExpiredOffers,
  reapExpiredShares,
  reapUnclaimedStubs,
} from "./reapers";
import { sweepDueTaskReminders } from "./task-reminders";

/**
 * Result of one scheduled-jobs run. Each numeric field is the number of rows the
 * corresponding job changed; `errors` collects a short message per failed job.
 */
export interface JobRunResult {
  offers: number;
  handoffs: number;
  shares: number;
  /** Agreed-future representation terminations whose moment arrived (decisions #14). */
  representationTerminations: number;
  /** Unclaimed stub accounts erased at 90 days (docs/gdpr.md). */
  stubsPurged: number;
  /**
   * Stubs the purge REFUSED to erase, with the record that stopped each one.
   *
   * Reported rather than counted because every entry is a profile still holding a
   * person's email past its retention date — a fact somebody has to act on, and
   * one that a count alone reads as "nothing to do". This is the "no silent caps"
   * rule: work the sweep declined to do is stated, not left to be inferred.
   */
  stubsSkipped: { profileId: string; name: string; reason: string }[];
  /** Tasks whose `remind_at` came due and were rung (`task-reminders.ts`). */
  taskReminders: number;
  exchangeRates: number;
  errors: string[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Orchestrator for the scheduled jobs. Runs all seven, each isolated in its
 * own try/catch so one failure never aborts the others — a failed job leaves its
 * count at 0 and pushes a short message to `errors`.
 */
export async function runScheduledJobs(
  db: Database,
  now: Date = new Date(),
): Promise<JobRunResult> {
  const result: JobRunResult = {
    offers: 0,
    handoffs: 0,
    shares: 0,
    representationTerminations: 0,
    stubsPurged: 0,
    stubsSkipped: [],
    taskReminders: 0,
    exchangeRates: 0,
    errors: [],
  };

  try {
    result.offers = await reapExpiredOffers(db, now);
  } catch (error) {
    result.errors.push(`offers: ${describeError(error)}`);
  }

  try {
    result.handoffs = await reapExpiredHandoffs(db, now);
  } catch (error) {
    result.errors.push(`handoffs: ${describeError(error)}`);
  }

  try {
    result.shares = await reapExpiredShares(db, now);
  } catch (error) {
    result.errors.push(`shares: ${describeError(error)}`);
  }

  try {
    result.representationTerminations = await reapDueRepresentationTerminations(db, now);
  } catch (error) {
    result.errors.push(`representationTerminations: ${describeError(error)}`);
  }

  try {
    const stubs = await reapUnclaimedStubs(db, now);
    result.stubsPurged = stubs.purged;
    result.stubsSkipped = stubs.skipped;
  } catch (error) {
    result.errors.push(`stubs: ${describeError(error)}`);
  }

  try {
    result.taskReminders = await sweepDueTaskReminders(db, now);
  } catch (error) {
    result.errors.push(`taskReminders: ${describeError(error)}`);
  }

  try {
    result.exchangeRates = await runExchangeRateRefresh(db);
  } catch (error) {
    result.errors.push(`exchangeRates: ${describeError(error)}`);
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("DATABASE_URL is not set — cannot run scheduled jobs.");
    process.exit(1);
  }
  const db = createDatabase(connectionString);
  runScheduledJobs(db)
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error(describeError(error));
      process.exit(1);
    });
}
