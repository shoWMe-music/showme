import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

await build({
  entryPoints: [resolve(rootDir, "src/entry-server.tsx")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: resolve(__dirname, "lib/ssr-bundle.js"),
  external: [
    "firebase-admin",
    "firebase-functions",
    // Node built-ins
    "path", "fs", "url", "crypto", "stream", "http", "https", "os", "util",
  ],
  define: {
    "import.meta.env.VITE_FIREBASE_API_KEY": '""',
    "import.meta.env.VITE_FIREBASE_AUTH_DOMAIN": '""',
    "import.meta.env.VITE_FIREBASE_PROJECT_ID": '"showme-settle-fast"',
    "import.meta.env.PROD": "true",
    "import.meta.env.DEV": "false",
    "import.meta.env.SSR": "true",
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [
    // Ignore CSS and image imports — handled by the client bundle
    {
      name: "stub-assets",
      setup(build) {
        build.onLoad({ filter: /\.(css|png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|eot)$/ }, () => ({
          contents: "export default '';",
          loader: "js",
        }));
      },
    },
    // Stub browser-only modules that can't run on server
    {
      name: "stub-browser-modules",
      setup(build) {
        // Leaflet uses browser APIs — stub it for SSR
        build.onResolve({ filter: /^leaflet$|^react-leaflet$/ }, (args) => ({
          path: args.path,
          namespace: "browser-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "browser-stub" }, () => ({
          contents: "module.exports = {};",
          loader: "js",
        }));
      },
    },
  ],
});

console.log("SSR bundle built → functions/lib/ssr-bundle.js");
