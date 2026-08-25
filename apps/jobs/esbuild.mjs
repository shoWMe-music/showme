// Production bundle for the scheduled jobs (Cloud Run Job container).
// Same shape as apps/api/esbuild.mjs and apps/stream's: workspace packages
// (@showme/*) export TS source, so everything — our TS and all third-party — is
// inlined into one file and the runtime image needs no node_modules at all.
import { build } from "esbuild";

// Anything that cannot be statically bundled (native .node addons, hard dynamic
// requires) would go here and be shipped alongside. Nothing needs it today.
const EXTERNAL = [];

await build({
  external: EXTERNAL,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // ESM output importing CJS third-party: shim require + friends.
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __ftu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      "const require = __cr(import.meta.url);",
      "const __filename = __ftu(import.meta.url);",
      "const __dirname = __dn(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});

console.log("jobs bundled → dist/index.mjs");
