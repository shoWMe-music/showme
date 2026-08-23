import { type Database, createDatabase } from "@showme/db";
import { runExchangeRateRefresh } from "./exchange-rate";
import {
  reapDueRepresentationTerminations,
  reapExpiredHandoffs,
  reapExpiredOffers,
  reapExpiredShares,
} from "./reapers";

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
  exchangeRates: number;
  errors: string[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Orchestrator for the scheduled jobs. Runs all five jobs, each isolated in its
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
