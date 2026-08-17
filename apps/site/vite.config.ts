import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Public marketing site — TanStack Start, statically prerendered to HTML at
// build time (no live server) so it can ship to a CDN while reusing React
// components from @showme/design-system. GSAP/canvas scenes stay client-only.
export default defineConfig({
  server: { port: 5175, strictPort: true },
  plugins: [
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true },
      pages: [{ path: "/" }, { path: "/about" }],
    }),
    viteReact(),
  ],
});
