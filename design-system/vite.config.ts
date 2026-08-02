import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const root = import.meta.dirname;

// Library build: resolves the internal `@/` alias, emits a single ESM bundle +
// one CSS file + bundled type declarations, so apps consume real components.
export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ["src"],
      exclude: ["src/**/*.stories.tsx", "src/**/*.test.*", "src/**/*.test.tsx"],
      insertTypesEntry: true,
    }),
  ],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
      cssFileName: "design-system",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "gsap", "@gsap/react"],
    },
  },
});
