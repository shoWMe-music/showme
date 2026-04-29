#!/usr/bin/env node
// Hosting predeploy guard: verifies the freshly-built SSR template's asset
// references all exist in dist/client/assets/. Catches a broken build
// pipeline before anything ships.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distAssets = path.join(repoRoot, "dist/client/assets");
const templatePath = path.join(repoRoot, "functions/lib/index.template.html");

if (!fs.existsSync(templatePath)) {
  console.error("✗ functions/lib/index.template.html missing — build pipeline is broken.");
  console.error("  Run `npm run build:all` to regenerate.");
  process.exit(1);
}
if (!fs.existsSync(distAssets)) {
  console.error("✗ dist/client/assets missing — build pipeline is broken.");
  console.error("  Run `npm run build:all` to regenerate.");
  process.exit(1);
}

const template = fs.readFileSync(templatePath, "utf-8");
const referenced = Array.from(
  new Set([...template.matchAll(/\/assets\/([^"'\s)]+)/g)].map((m) => m[1])),
);
const onDisk = new Set(fs.readdirSync(distAssets));
const missing = referenced.filter((f) => !onDisk.has(f));

if (missing.length) {
  console.error("✗ SSR template references asset files that don't exist in dist/client/assets:");
  for (const m of missing) console.error("  -", m);
  console.error("");
  console.error("  The functions bundle and hosting bundle are out of sync. Run");
  console.error("  `npm run build:all` to rebuild both, then redeploy.");
  process.exit(1);
}

console.log(`✓ SSR template: ${referenced.length} asset references resolve in dist/client/assets.`);
