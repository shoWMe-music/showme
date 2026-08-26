import { resolve } from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;

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
