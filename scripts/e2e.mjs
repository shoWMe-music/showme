#!/usr/bin/env node
/**
 * E2E orchestrator — brings up the whole stack the multi-account Playwright suite
 * needs (see stack.mjs), runs the tests, and tears everything down. Hands-free:
 *
 *   pnpm test:e2e                        # full run
 *   pnpm test:e2e --ui                   # extra args pass through to `playwright test`
 *   pnpm test:e2e tests/two-users.spec.ts
 *
 * Playwright owns the web preview (its config's webServer builds + previews with
 * the emulator env inherited from here). Every child + the docker DB is cleaned
 * up on pass, fail, or interrupt.
 */
import { bringUpStack, cleanup, log, run, webEmulatorEnv } from "./stack.mjs";

const WEB_URL = "http://localhost:4174";

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await cleanup();
    process.exit(130);
  });
}

async function main() {
  const passthrough = process.argv.slice(2);
  await bringUpStack({ corsOrigins: WEB_URL });

  log("test", `running playwright test ${passthrough.join(" ")}`.trim());
  await run(
    "pnpm",
    ["--filter", "@showme/web", "exec", "playwright", "test", ...passthrough],
    webEmulatorEnv(),
  );
}

main()
  .then(async () => {
    await cleanup();
    log("done", "passed");
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`\x1b[31m[e2e] ${error.message}\x1b[0m`);
    await cleanup();
    process.exit(1);
  });
