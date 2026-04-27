import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

/** Stub browser-only packages when Vite is rendering on the server (SSR dev + SSR build). */
const ssrBrowserStub: Plugin = {
  name: "ssr-browser-stub",
  enforce: "pre",
  resolveId(id, _, { ssr } = {}) {
    if (ssr && /^(leaflet|react-leaflet)$/.test(id)) {
      return "\0ssr-browser-stub";
    }
  },
  load(id) {
    if (id === "\0ssr-browser-stub") {
      return "export default {}; export const createControlComponent = () => () => null;";
    }
  },
};

export default defineConfig(({ mode }) => ({
  server: { host: "::", port: 8080, hmr: { overlay: false } },
  plugins: [react(), ssrBrowserStub, mode === "development" && componentTagger()].filter(Boolean),
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  ssr: {
    // Force these through Vite's transform pipeline so the ssrBrowserStub plugin can stub them
    noExternal: ["leaflet", "react-leaflet"],
  },
  build: {
    rollupOptions: {
      input: mode === "ssr"
        ? "src/entry-server.tsx"
        : { main: "index.html", "entry-client": "src/entry-client.tsx" },
    },
    ...(mode === "ssr" ? {
      ssr: true,
      ssrEmitAssets: false,
      outDir: "dist/server",
    } : {
      outDir: "dist/client",
    }),
  },
}));
