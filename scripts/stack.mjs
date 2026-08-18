/**
 * Shared local-stack bring-up for the Firebase-emulator workflows. Both the E2E
 * orchestrator (`e2e.mjs`) and the local dev stack (`dev-emulator.mjs`) use this
 * to stand up: Postgres → migrate → deterministic seed → Auth emulator → seeded
 * accounts → API. They differ only in what they put in FRONT of it (Playwright's
 * preview build vs. a live `vite dev` server).
 *
 * Everything here targets the **emulator + a throwaway/local DB** and never a
 * real Firebase project. Call `cleanup()` on exit to kill children + drop docker.
 */
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const AUTH_EMULATOR_HOST = "127.0.0.1:9099";
export const PROJECT_ID = "demo-showme";
export const API_PORT = 8080;
const DB_CONTAINER = "showme-e2e-postgres";
const FIREBASE_BIN = `${ROOT}/node_modules/.bin/firebase`;
// tsx is an executable shell wrapper (has a shebang) — run it directly, never via `node`.
const API_TSX = `${ROOT}/apps/api/node_modules/.bin/tsx`;

/** VITE_* env pointing the web build/dev server at the emulator + local API. Emulator-only, non-secret. */
export function webEmulatorEnv({ apiPort = API_PORT } = {}) {
  return {
    VITE_API_URL: `http://localhost:${apiPort}`,
    VITE_FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
    VITE_FIREBASE_API_KEY: "demo-key",
    VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
    VITE_FIREBASE_APP_ID: "1:000000000000:web:demoe2e",
  };
}

const children = [];
let startedDockerDb = false;

export function log(step, message) {
  console.log(`\x1b[36m[e2e:${step}]\x1b[0m ${message}`);
}

/** Run a one-shot command to completion, inheriting stdio. Rejects on non-zero. */
export function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

/** Start a long-lived background child; tracked for cleanup. */
export function spawnBackground(name, command, args, env = {}, cwd = ROOT) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push({ name, child });
  return child;
}

/** Resolve once a TCP port accepts a connection, or reject after `timeoutMs`. */
export async function waitForPort(host, port, timeoutMs = 60_000, label = `${host}:${port}`) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Resolve once GET url returns 2xx, or reject after `timeoutMs`. */
export async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function cleanup() {
  for (const { name, child } of children) {
    try {
      // Kill the whole process group (detached) so previews/emulators don't leak.
      process.kill(-child.pid, "SIGTERM");
      log("cleanup", `stopped ${name}`);
    } catch {
      // already gone
    }
  }
  children.length = 0;
  if (startedDockerDb) {
    await execFileAsync("docker", ["rm", "-f", DB_CONTAINER]).catch(() => {});
    log("cleanup", "removed docker postgres");
    startedDockerDb = false;
  }
}

/** Kill whatever holds `port` (a leaked prior run of ours). */
export async function freePort(port) {
  await execFileAsync("bash", [
    "-c",
    `lsof -ti tcp:${port} 2>/dev/null | xargs kill -9 2>/dev/null || true`,
  ]).catch(() => {});
}

/** Free the ports we use and drop a stale container, so a leaked prior run can't wedge us. */
async function preflightCleanup() {
  const ports = [9099, 4400, 4401, 4500, 4501, API_PORT];
  await execFileAsync("bash", [
    "-c",
    `lsof -ti tcp:${ports.join(" tcp:")} 2>/dev/null | xargs kill -9 2>/dev/null || true`,
  ]).catch(() => {});
  await execFileAsync("docker", ["rm", "-f", DB_CONTAINER]).catch(() => {});
}

/**
 * Stand up Postgres → migrate → seed → Auth emulator → seeded accounts → API.
 * `corsOrigins` is the browser origin(s) the API should allow (the web app URL).
 * Returns the resolved DATABASE_URL. Does NOT start any web server.
 */
export async function bringUpStack({ corsOrigins }) {
  await preflightCleanup();

  // ── Postgres — reuse $DATABASE_URL, else a throwaway docker container. ──
  let databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    log("db", "using provided $DATABASE_URL");
  } else {
    log("db", "no $DATABASE_URL — starting throwaway docker postgres");
    await execFileAsync("docker", ["rm", "-f", DB_CONTAINER]).catch(() => {});
    await execFileAsync("docker", [
      "run",
      "-d",
      "--name",
      DB_CONTAINER,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=showme",
      "-p",
      "55432:5432",
      "postgres:18-alpine",
    ]);
    startedDockerDb = true;
    databaseUrl = "postgres://postgres:postgres@127.0.0.1:55432/showme";
    await waitForPort("127.0.0.1", 55432, 60_000, "postgres");
    for (let i = 0; i < 60; i++) {
      const ready = await execFileAsync("docker", [
        "exec",
        DB_CONTAINER,
        "pg_isready",
        "-U",
        "postgres",
      ])
        .then(() => true)
        .catch(() => false);
      if (ready) break;
      await sleep(500);
    }
  }
  const dbEnv = { DATABASE_URL: databaseUrl };

  // ── Migrate + seed the deterministic dataset. ──
  log("db", "applying migrations");
  await run("pnpm", ["--filter", "@showme/db", "migrate"], dbEnv);
  log("db", "seeding e2e dataset");
  await run("pnpm", ["--filter", "@showme/db", "seed:e2e"], dbEnv);

  // ── Auth emulator + seeded accounts (pinned uids = Postgres users.id). ──
  log("auth", "starting Firebase Auth emulator");
  spawnBackground("auth-emulator", FIREBASE_BIN, [
    "emulators:start",
    "--only",
    "auth",
    "--project",
    PROJECT_ID,
  ]);
  await waitForPort("127.0.0.1", 9099, 60_000, "auth emulator");
  log("auth", "seeding emulator accounts");
  await run(API_TSX, [`${ROOT}/apps/api/src/seed-emulator-auth.ts`], {
    FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
    FIREBASE_PROJECT_ID: PROJECT_ID,
  });

  // ── API pointed at the emulator + that DB. ──
  log("api", "starting Fastify server");
  spawnBackground("api", API_TSX, [`${ROOT}/apps/api/src/server.ts`], {
    ...dbEnv,
    FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
    FIREBASE_PROJECT_ID: PROJECT_ID,
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    CORS_ALLOWED_ORIGINS: corsOrigins,
  });
  await waitForHttp(`http://127.0.0.1:${API_PORT}/api/v1/health`, 60_000);

  return { databaseUrl };
}
