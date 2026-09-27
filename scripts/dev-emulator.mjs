#!/usr/bin/env node
/**
 * The default local dev command (`pnpm dev`): the app against the Firebase
 * **emulator**, with the five seeded test accounts always available to log in
 * with. Same stack the E2E suite uses (stack.mjs), but with a live `vite dev`
 * server (HMR) in front instead of a one-shot preview + Playwright:
 *
 *   pnpm dev            # the app + emulators (this)
 *   pnpm dev:landing    # only the marketing/landing site
 *
 * Then open http://127.0.0.1:5180 and sign in with any account below. Stays up
 * until Ctrl-C, which stops the web/API/emulator and removes the docker DB.
 *
 * The app runs on 5180 (not vite's default 5173) so it can run alongside the
 * landing site, which owns 5173. The seeded emulator accounts don't exist in the
 * real Firebase project (apps/web/.env → music-showme), so this points the app at
 * the emulator instead.
 */
import {
  ROOT,
  bringUpStack,
  cleanup,
  freePort,
  log,
  spawnBackground,
  waitForPort,
  webEmulatorEnv,
} from "./stack.mjs";

// A dedicated port (NOT vite's default 5173) so this can run alongside a normal
// `pnpm dev` without a port clash. Bound to 127.0.0.1 explicitly — vite's default
// `localhost` can resolve to IPv6 (::1), which our IPv4 readiness probe misses.
const WEB_HOST = "127.0.0.1";
const WEB_PORT = 5180;
const WEB_URL = `http://${WEB_HOST}:${WEB_PORT}`;

// Vite's own default port, which is where `pnpm --filter @showme/marketing dev` serves
// the public pages. This stack does not START it — but when somebody does, its browser
// fetches `/public/*` off this API, and an origin that is not on the list is a CORS wall
// rather than an answer. `app.ts`'s DEFAULT_CORS_ALLOWED_ORIGINS has always listed it.
const MARKETING_URL = "http://localhost:5173";

// Mirror of packages/shared/src/e2e-accounts.ts (the source of truth). Kept here
// as plain data so this node script needs no TS import. All share one password.
const E2E_PASSWORD = "Test123!pass";
const E2E_ACCOUNTS = [
  { kind: "operator", email: "operator@e2e.showme.test" },
  { kind: "performer", email: "performer.a@e2e.showme.test" },
  { kind: "performer", email: "performer.b@e2e.showme.test" },
  { kind: "team_and_crew", email: "professional@e2e.showme.test" },
  { kind: "agent", email: "agent@e2e.showme.test" },
];

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    // Ctrl-C is a normal way to stop the dev server — tear down and exit 0 so
    // pnpm doesn't print an ELIFECYCLE error on every stop.
    await cleanup();
    process.exit(0);
  });
}

function printCredentials() {
  const line = "─".repeat(64);
  console.log(`\n\x1b[32m${line}\x1b[0m`);
  console.log(`\x1b[32m Local dev ready → ${WEB_URL}\x1b[0m`);
  console.log(`\x1b[32m${line}\x1b[0m`);
  console.log(" Seeded accounts (Firebase emulator) — all share one password:\n");
  for (const account of E2E_ACCOUNTS) {
    console.log(`   ${account.kind.padEnd(13)} ${account.email}`);
  }
  console.log(`\n   password:  ${E2E_PASSWORD}`);
  console.log(`\x1b[32m${line}\x1b[0m\n`);
}

async function main() {
  // The web app AND the marketing dev server: the public pages (a profile, a show, a
  // shared availability link) fetch `/public/*` from a stranger's browser, so testing one
  // against this stack needs its origin allowed. `app.ts`'s own default list has always
  // had it — this stack narrowed the list to the web app and nothing else, so the first
  // marketing check against a local API was a CORS wall rather than an answer.
  await bringUpStack({ corsOrigins: `${WEB_URL},${MARKETING_URL}` });

  log("web", "starting vite dev server (HMR)");
  await freePort(WEB_PORT); // clear a leaked prior run of ours on this port
  // Run vite's binary directly (in apps/web) rather than via `pnpm exec`: a pnpm
  // wrapper reports the child's shutdown as a scary ERR_PNPM_…_SIGKILL error on
  // every restart. Directly, stopping it is quiet.
  spawnBackground(
    "web",
    `${ROOT}/apps/web/node_modules/.bin/vite`,
    ["--host", WEB_HOST, "--port", String(WEB_PORT), "--strictPort"],
    webEmulatorEnv(),
    `${ROOT}/apps/web`,
  );
  await waitForPort(WEB_HOST, WEB_PORT, 120_000, "web dev server");

  printCredentials();
  // Stay up until interrupted; the SIGINT handler tears everything down.
  await new Promise(() => {});
}

main().catch(async (error) => {
  console.error(`\x1b[31m[e2e] ${error.message}\x1b[0m`);
  await cleanup();
  process.exit(1);
});
