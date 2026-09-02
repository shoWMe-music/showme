/**
 * Deploy apps/web/dist to Firebase Hosting through the REST API.
 *
 * firebase-tools refuses to run without its own stored login and rejects a
 * non-interactive terminal outright, so this does the same five steps it would:
 * create a version carrying the firebase.json config, declare every file by the
 * SHA256 of its GZIPPED bytes, upload only what the server asks for, finalize,
 * release. Authenticated with the gcloud access token plus the quota-project
 * header the ADC path requires.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Usage:
 *   pnpm --filter @showme/web build
 *   HOSTING_TOKEN=$(gcloud auth print-access-token) node scripts/hosting-deploy.mjs
 *
 * Site and directory can be overridden for the marketing site or a preview:
 *   HOSTING_SITE=music-showme HOSTING_DIR=apps/marketing/dist node scripts/hosting-deploy.mjs
 *
 * The gcloud account must own the project (daniel@showme.music for music-showme).
 */
const SITE = process.env.HOSTING_SITE ?? "showme-app";
const ROOT = process.env.HOSTING_DIR
  ? path.resolve(process.env.HOSTING_DIR)
  : path.resolve(import.meta.dirname, "../apps/web/dist");
const TOKEN = process.env.HOSTING_TOKEN;
const API = "https://firebasehosting.googleapis.com/v1beta1";
// REQUIRED on the ADC path. Without it every call 403s with SERVICE_DISABLED,
// which reads exactly like the Hosting API being off when it is enabled.
const QUOTA_PROJECT = process.env.HOSTING_QUOTA_PROJECT ?? "music-showme";
const headers = {
  authorization: `Bearer ${TOKEN}`,
  "x-goog-user-project": QUOTA_PROJECT,
  "content-type": "application/json",
};

const config = {
  rewrites: [{ glob: "**", path: "/index.html" }],
  headers: [
    {
      glob: "**",
      headers: {
        "Cache-Control": "no-cache",
        "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      },
    },
    { glob: "/assets/**", headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  ],
};

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // firebase.json's ignore: "**/.*"
    const full = path.join(dir, entry.name);
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, full });
  }
  return out;
}

const files = walk(ROOT);
const byHash = new Map();
const manifest = {};
for (const file of files) {
  const gz = gzipSync(fs.readFileSync(file.full), { level: 9 });
  const hash = createHash("sha256").update(gz).digest("hex");
  manifest[file.rel] = hash;
  byHash.set(hash, gz);
}
console.log(`${files.length} files, ${byHash.size} unique`);

const version = await fetch(`${API}/sites/${SITE}/versions`, {
  method: "POST",
  headers,
  body: JSON.stringify({ config }),
}).then((r) => r.json());
if (version.error) throw new Error(`createVersion: ${JSON.stringify(version.error).slice(0, 300)}`);
console.log("version:", version.name);

const populated = await fetch(`${API}/${version.name}:populateFiles`, {
  method: "POST",
  headers,
  body: JSON.stringify({ files: manifest }),
}).then((r) => r.json());
if (populated.error)
  throw new Error(`populateFiles: ${JSON.stringify(populated.error).slice(0, 300)}`);

const required = populated.uploadRequiredHashes ?? [];
console.log(`uploading ${required.length} of ${byHash.size}`);
for (const hash of required) {
  const body = byHash.get(hash);
  if (!body) throw new Error(`server asked for a hash we do not have: ${hash}`);
  const res = await fetch(`${populated.uploadUrl}/${hash}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/octet-stream" },
    body,
  });
  if (!res.ok) throw new Error(`upload ${hash}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const finalized = await fetch(`${API}/${version.name}?update_mask=status`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ status: "FINALIZED" }),
}).then((r) => r.json());
if (finalized.error) throw new Error(`finalize: ${JSON.stringify(finalized.error).slice(0, 300)}`);
console.log("finalized:", finalized.status);

const release = await fetch(`${API}/sites/${SITE}/releases?versionName=${version.name}`, {
  method: "POST",
  headers,
}).then((r) => r.json());
if (release.error) throw new Error(`release: ${JSON.stringify(release.error).slice(0, 300)}`);
console.log("RELEASED:", release.name);
