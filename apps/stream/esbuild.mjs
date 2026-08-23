// Production bundle for the SSE service (Cloud Run container).
// Mirrors apps/api/esbuild.mjs — the two services deploy the same way, so the
// build shape is deliberately identical rather than abstracted into a shared
// helper (they are separately deployable units and may diverge).
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

console.log("Stream bundled → dist/server.mjs");
