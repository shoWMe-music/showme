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
        product: resolve(here, "product.html"),
        about: resolve(here, "about.html"),
        contact: resolve(here, "contact.html"),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
