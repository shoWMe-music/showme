#!/usr/bin/env node
/**
 * Run the scheduled jobs ONCE against a database, and print the JSON result:
 *
 *   pnpm jobs:run                                  # against the `pnpm dev` stack
 *   DATABASE_URL=postgres://… pnpm jobs:run        # against anything else
 *
 * These are the reapers (expired offers, handoffs, shares, and agreed-future
 * representation terminations) plus the exchange-rate refresh — the jobs that in
 * production are driven by Cloud Scheduler hitting `apps/jobs`. Locally there is
 * no scheduler, so this is how a developer converges the seeded data by hand.
 *
 * Deliberately NOT wired into `pnpm dev`: a reaper mutates rows, and a sweep that
 * fires invisibly at boot would silently change the state a verification run is
 * about to quote (`.claude/skills/verify-e2e` — "Before the sweep": a rule must
 * read correctly with the reaper UNRUN, then converge once it runs). Manual and
 * discoverable beats an invisible cron in a dev script.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// The throwaway Postgres `scripts/stack.mjs` starts for `pnpm dev`. Falling back to
// it is what makes the command work with no arguments during local development.
const DEV_STACK_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:55432/showme";
// tsx is an executable shell wrapper (has a shebang) — run it directly, never via
// `node`. Node's --experimental-strip-types cannot resolve the workspace's
// extensionless TS imports (@showme/db's `./client`), so it is not an option here.
const JOBS_TSX = `${ROOT}/apps/jobs/node_modules/.bin/tsx`;

const databaseUrl = process.env.DATABASE_URL?.trim() || DEV_STACK_DATABASE_URL;
const usingFallback = !process.env.DATABASE_URL?.trim();
const origin = usingFallback ? " (dev-stack default — set $DATABASE_URL to override)" : "";
console.log(`\x1b[36m[jobs]\x1b[0m running scheduled jobs against ${databaseUrl}${origin}`);

// The repo-root `.env` is where the third-party keys live (EXCHANGE_RATE_API for the
// rate refresh), the same file `apps/api` loads. A variable already in the shell
// wins over the file, so an explicit DATABASE_URL above is never overwritten.
const child = spawn(JOBS_TSX, ["--env-file-if-exists=.env", `${ROOT}/apps/jobs/src/index.ts`], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
});
child.on("error", (error) => {
  console.error(`\x1b[31m[jobs] ${error.message}\x1b[0m`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
