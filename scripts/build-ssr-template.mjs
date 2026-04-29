import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dist = path.join(repoRoot, "dist/client");

const html = fs.readFileSync(path.join(dist, "index.html"), "utf-8");
const assets = fs.readdirSync(path.join(dist, "assets"));
const entryClient = assets.find((f) => f.startsWith("entry-client-") && f.endsWith(".js"));
if (!entryClient) {
  throw new Error("entry-client bundle not found in dist/client/assets — run vite build first");
}

const ssrHtml = html.replace(/\/assets\/main-[^"]+\.js"/, `/assets/${entryClient}"`);
const outPath = path.join(repoRoot, "functions/lib/index.template.html");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, ssrHtml);
console.log(`SSR template written → functions/lib/index.template.html (entry-client: ${entryClient})`);
