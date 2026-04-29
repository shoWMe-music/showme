#!/usr/bin/env node
// Hosting predeploy guard: refuses to deploy hosting without functions.
//
// The SSR template lives inside the functions bundle and references hashed
// asset filenames (router-XXXXXX.js, entry-client-XXXXXX.js) that change on
// every build. Deploying hosting alone replaces those files on the CDN while
// the live ssrRender function keeps embedding the previous build's hashes —
// the browser then fails with "Failed to load module script: Expected a
// JavaScript-or-Wasm module script but the server responded with a MIME type
// of 'text/html'". This regression has hit prod twice; this guard exists so
// it cannot happen a third time.
//
// We detect the deploy targets by inspecting the parent firebase-tools
// process's command line via `ps`. If --only is set and contains hosting
// without a functions target, we abort.

import { execSync } from "node:child_process";

function readArgs(pid) {
  try {
    return execSync(`ps -p ${pid} -o args=`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function readPpid(pid) {
  try {
    return execSync(`ps -p ${pid} -o ppid=`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function findFirebaseInvocation() {
  let pid = String(process.ppid);
  for (let i = 0; i < 6 && pid && pid !== "1"; i++) {
    const args = readArgs(pid);
    if (/firebase(-tools)?\b.*\bdeploy\b/.test(args)) return args;
    pid = readPpid(pid);
  }
  return "";
}

const cmd = findFirebaseInvocation();
if (!cmd) {
  // Couldn't locate the firebase invocation (unusual env). Don't block — the
  // verify-ssr-template guard still runs, and `npm run deploy` is the
  // canonical path.
  console.log("→ (paired-deploy guard skipped: could not inspect parent firebase process)");
  process.exit(0);
}

const onlyMatch = cmd.match(/--only[\s=]+(\S+)/);
const exceptMatch = cmd.match(/--except[\s=]+(\S+)/);

function targetIs(target, kind) {
  return target === kind || target.startsWith(kind + ":");
}

function abort(reason) {
  console.error("");
  console.error("✗ " + reason);
  console.error("");
  console.error("  The SSR template lives in the functions bundle and references hashed");
  console.error("  asset filenames that change on every build. Deploying hosting without");
  console.error("  functions leaves the live ssrRender pointing at deleted asset files —");
  console.error("  public profile/event routes will break with a MIME-type error.");
  console.error("");
  console.error("  Use:");
  console.error("    npm run deploy");
  console.error("");
  console.error("  Or, explicitly:");
  console.error("    firebase deploy --only hosting,functions");
  console.error("");
  process.exit(1);
}

if (onlyMatch) {
  const targets = onlyMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  const hasHosting = targets.some((t) => targetIs(t, "hosting"));
  const hasFunctions = targets.some((t) => targetIs(t, "functions"));
  if (hasHosting && !hasFunctions) {
    abort("Hosting deploy without functions detected (--only " + onlyMatch[1] + ").");
  }
}

if (exceptMatch) {
  const excluded = exceptMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  const dropsFunctions = excluded.some((t) => targetIs(t, "functions"));
  if (dropsFunctions) {
    abort("Functions excluded from deploy (--except " + exceptMatch[1] + ").");
  }
}

console.log("✓ Paired-deploy guard: hosting and functions will deploy together.");
