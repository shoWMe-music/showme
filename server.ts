/**
 * Dev server — mirrors the Firebase Hosting + SSR Function setup so that
 * local development behaves identically to production.
 *
 * SSR routes  → rendered by vite.ssrLoadModule("src/entry-server.tsx")
 * SPA routes  → served as the Vite-transformed index.html shell
 * Assets      → handled by Vite's own middleware (HMR, transforms, etc.)
 */
import express from "express";
import { createServer as createViteServer } from "vite";
import { readFileSync } from "fs";
import { resolve } from "path";

// Keep in sync with firebase.json hosting.rewrites
const SSR_EXACT = new Set([
  "/landing",
  "/about",
  "/product",
  "/solutions",
  // "/pricing",
  "/login",
  "/signup",
]);

const SSR_PREFIXES = [
  "/p/",
  "/review/",
  "/shared/",
  "/availability/",
  "/event/",
  "/collaborate/",
];

function isSSRRoute(pathname: string): boolean {
  if (SSR_EXACT.has(pathname)) return true;
  return SSR_PREFIXES.some((p) => pathname.startsWith(p));
}

async function main() {
  const app = express();

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "custom",
    // Don't override host/port here — express controls that
  });

  // Let Vite handle asset requests, HMR, etc.
  app.use(vite.middlewares);

  app.use(async (req, res, next) => {
    const url = req.originalUrl;
    const pathname = url.split("?")[0];

    try {
      // Load and transform the HTML template fresh each request (respects Vite plugins)
      const rawTemplate = readFileSync(resolve("index.html"), "utf-8");
      const template = await vite.transformIndexHtml(url, rawTemplate);

      if (isSSRRoute(pathname)) {
        // Server-render the page
        const { render } = (await vite.ssrLoadModule("/src/entry-server.tsx")) as {
          render: (url: string) => Promise<{ html: string; head: string; dehydratedState: unknown }>;
        };

        const { html, head, dehydratedState } = await render(url);

        const page = template
          .replace("</head>", `    ${head}\n  </head>`)
          .replace(
            '<div id="root"></div>',
            `<div id="root">${html}</div>\n  <script>window.__DEHYDRATED_STATE__ = ${JSON.stringify(dehydratedState)};</script>`,
          );

        res.status(200).set("Content-Type", "text/html").send(page);
      } else {
        // SPA shell — let the client-side router handle the route
        res.status(200).set("Content-Type", "text/html").send(template);
      }
    } catch (e) {
      try { vite.ssrFixStacktrace(e as Error); } catch {}
      console.error("[SSR error]", e);
      next(e);
    }
  });

  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, "0.0.0.0", () => {
    console.log(`  Dev server: http://localhost:${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
