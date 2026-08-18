// Production bundle for the API (Cloud Run container).
// Workspace packages (@showme/*) export TS source, so we bundle them (and all
// relative imports) into one file; third-party node_modules are left external and
// shipped in the image's node_modules. This keeps native/dynamic-require deps
// (firebase-admin, pg, drizzle) working while collapsing our own TS into one file.
import { build } from "esbuild";

// Fully self-contained bundle: everything (our workspace TS + all third-party) is
// inlined into one file, so the runtime image needs no node_modules at all. Any
// dependency that can't be statically bundled (native .node addons, hard dynamic
// requires) goes in EXTERNAL and is shipped alongside; keep this list minimal.
const EXTERNAL = [];

await build({
  external: EXTERNAL,
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.mjs",
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

console.log("API bundled → dist/server.mjs");
