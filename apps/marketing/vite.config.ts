import { resolve } from "node:path";
import { type Plugin, defineConfig } from "vite";

const here = import.meta.dirname;

/**
 * `/profile/<slug>` → profile.html, `/event/<id>` → event.html, in dev and in `vite
 * preview`. The page itself reads the last path segment, so nothing is passed
 * through here — the rewrite only decides which HTML document is served.
 *
 * Kept to two prefixes rather than a catch-all: this is a multi-page site, and a
 * greedy rewrite would swallow a genuine 404 and answer it with a profile page.
 */
function prettyPublicPaths(): Plugin {
  const routes: Array<[RegExp, string]> = [
    [/^\/profile\/[^/?#]+\/?(?:[?#].*)?$/, "/profile.html"],
    [/^\/event\/[^/?#]+\/?(?:[?#].*)?$/, "/event.html"],
  ];
  const rewrite = (request: { url?: string }) => {
    const url = request.url;
    if (!url) return;
    for (const [pattern, file] of routes) {
      if (!pattern.test(url)) continue;
      // The QUERY is carried over and the PATH is replaced: the page reads its
      // slug from the path in production, and from `?slug=` when someone follows
      // an older link — both have to keep working here.
      const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
      request.url = `${file}${query}`;
      return;
    }
  };
  return {
    name: "showme-pretty-public-paths",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        rewrite(request);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        rewrite(request);
        next();
      });
    },
  };
}

// Multi-page static marketing site. Each page is a real HTML entry so the
// build output is fully pre-rendered (SEO-ideal): no client-only shell.
export default defineConfig({
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(here, "index.html"),
        about: resolve(here, "about.html"),
        contact: resolve(here, "contact.html"),
        terms: resolve(here, "terms.html"),
        cookies: resolve(here, "cookies.html"),
        privacy: resolve(here, "privacy.html"),
        availability: resolve(here, "availability.html"),
        profile: resolve(here, "profile.html"),
        event: resolve(here, "event.html"),
      },
    },
  },
  // The same two pretty paths Firebase Hosting serves in production
  // (`firebase.json`: /profile/** and /event/** → the page files). Vite's MPA dev server
  // only knows about real files, so without this a link that works on the
  // deployed site 404s on a laptop — and the address a developer tests is not
  // the address the world gets.
  plugins: [prettyPublicPaths()],
  server: {
    port: 5173,
    strictPort: true,
    // Dev only. The availability page reads the API's public routes, and the local
    // API's CORS allow-list is set by scripts/stack.mjs to the app's origin alone —
    // so in dev the page calls a same-origin `/api/...` and CORS never enters it.
    // Production needs no proxy: the deployed API already allows the marketing
    // origins (see VITE_PUBLIC_API_URL in .env.production).
    proxy: { "/api": { target: "http://127.0.0.1:8080", changeOrigin: false } },
  },
  preview: { port: 4173, strictPort: true },
});
