#!/usr/bin/env node
/**
 * The default local dev command (`pnpm dev`): the app against the Firebase
 * **emulator**, with every seeded test account always available to log in
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * READ FROM THE SOURCE OF TRUTH, not copied from it (QA sweep run 9, QA9-18).
 *
 * This was a hand-copied list that said it was a copy — *"Mirror of
 * packages/shared/src/e2e-accounts.ts"* — and had drifted: `co.host@` was missing, so the
 * "Local dev ready" banner advertised FIVE accounts while the seeder created six and the
 * emulator held six. `api-as.mjs` carried the identical bug and its fix carries the identical
 * note (*"It was missing here while it existed in the seed, so any probe naming it died on
 * INVALID_EMAIL"*).
 *
 * That was not a cosmetic slip. The co-host is the only seat that exercises the residual split,
 * and the reason it kept going undriven is that nothing on screen said it existed — which is how
 * run 9's own **QA9-1** (a host's figure counting the co-host's private book) and **QA9-5** went
 * unfound for nine sweeps.
 *
 * So it parses the TS rather than restating it. No import, no build step, and no way to drift:
 * a seventh account appears here the moment it appears there. It THROWS on an unreadable file
 * rather than printing a short list, because a silently short list is the whole defect — every
 * lesson today about absence being taken for a verdict applies to this banner too.
 */
function seededAccounts() {
  const source = readFileSync(join(ROOT, "packages/shared/src/e2e-accounts.ts"), "utf8");
  const password = /E2E_PASSWORD = "([^"]+)"/.exec(source)?.[1];
  // `\n}` at column zero ends the object; the tail after it (`as const satisfies …`) varies and
  // is not worth matching. Anchoring on the closing brace rather than on a trailing `;` is what
  // makes this survive an edit to that tail.
  const block = /export const E2E_ACCOUNTS = \{([\s\S]*?)\n\}/.exec(source)?.[1];
  if (!password || !block) {
    throw new Error(
      "dev-emulator: could not read packages/shared/src/e2e-accounts.ts — the seeded-account banner would be wrong, so refusing to print one.",
    );
  }
  const emails = [...block.matchAll(/email: "([^"]+)"/g)].map((match) => match[1]);
  const kinds = [...block.matchAll(/kind: "([^"]+)"/g)].map((match) => match[1]);
  const names = [...block.matchAll(/profileName: "([^"]+)"/g)].map((match) => match[1]);
  // Zipped by position, so a missing field in one entry must not silently shift every
  // account's kind onto its neighbour.
  if (emails.length === 0 || emails.length !== kinds.length || emails.length !== names.length) {
    throw new Error(
      `dev-emulator: e2e-accounts.ts parsed to ${emails.length} emails, ${kinds.length} kinds and ${names.length} names — refusing to guess.`,
    );
  }
  return {
    password,
    accounts: emails.map((email, index) => ({ email, kind: kinds[index], name: names[index] })),
  };
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    // Ctrl-C is a normal way to stop the dev server — tear down and exit 0 so
    // pnpm doesn't print an ELIFECYCLE error on every stop.
    await cleanup();
    process.exit(0);
  });
}

function printCredentials() {
  const { password, accounts } = seededAccounts();
  const line = "─".repeat(64);
  console.log(`\n\x1b[32m${line}\x1b[0m`);
  console.log(`\x1b[32m Local dev ready → ${WEB_URL}\x1b[0m`);
  console.log(`\x1b[32m${line}\x1b[0m`);
  console.log(
    ` Seeded accounts (Firebase emulator), ${accounts.length} of them — all share one password:\n`,
  );
  for (const account of accounts) {
    // The PROFILE each one owns, because "operator" twice over says nothing about which is the
    // venue and which the co-promoter — and telling them apart is the whole point of the second.
    console.log(`   ${account.kind.padEnd(13)} ${account.email.padEnd(31)} → ${account.name}`);
  }
  console.log(`\n   password:  ${password}`);
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
