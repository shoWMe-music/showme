#!/usr/bin/env node
/**
 * Serves the Claude Design export locally so the prototypes can be opened in a
 * browser and compared pixel-for-pixel against our app. Extracts the export zip
 * (once) into a gitignored `.design-reference/` dir and serves it on a dedicated
 * port — it does NOT touch your `pnpm dev` stack.
 *
 *   pnpm design:ref     # serve, print URLs, stay up until Ctrl-C
 *
 * Note: the prototypes load React from unpkg, so this needs internet to render.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(ROOT, ".design-reference");
const PORT = 8900;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

if (!existsSync(DIR)) {
  // Find the export zip at the repo root (name carries a date).
  const zip = execFileSync("bash", [
    "-c",
    `ls "${ROOT}"/claude-design-export-*.zip 2>/dev/null | head -1`,
  ])
    .toString()
    .trim();
  if (!zip) {
    console.error("No claude-design-export-*.zip found at the repo root.");
    process.exit(1);
  }
  console.log(`Extracting ${zip.split("/").pop()} → .design-reference/ …`);
  execFileSync("unzip", ["-q", zip, "-d", DIR]);
}

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = normalize(join(DIR, path));
    if (!file.startsWith(DIR)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => {
  const base = `http://127.0.0.1:${PORT}`;
  const links = [
    ["Operator (All View)", "Prototype/shoWMe All View.dc.html"],
    ["Operator", "Prototype/shoWMe Prototype.dc.html"],
    ["Performer", "Prototype/shoWMe Performer.dc.html"],
    ["Crew / Team and Crew", "Prototype/shoWMe Crew.dc.html"],
    ["Agent", "Prototype/shoWMe Agent.dc.html"],
    ["Design System", "shoWMe Design System.dc.html"],
    // Note: the UI Handoff doc is newer than this export zip — see docs/ui-handoff.md.
  ];
  console.log(`\n\x1b[36mClaude Design reference\x1b[0m served at ${base}\n`);
  for (const [label, file] of links) {
    console.log(`  ${label.padEnd(22)} ${base}/${encodeURI(file)}`);
  }
  console.log("\n(Needs internet — prototypes load React from unpkg.)  Ctrl-C to stop.\n");
});
