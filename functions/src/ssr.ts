import * as fs from "fs";
import * as path from "path";
import { onRequest } from "firebase-functions/v2/https";

// The SSR bundle is built by functions/build-ssr.mjs before deployment
// It exports: render(url: string) => Promise<{ html, head, dehydratedState }>
let renderFn: ((url: string) => Promise<{ html: string; head: string; dehydratedState: unknown }>) | null = null;

async function getRender() {
  if (!renderFn) {
    // Dynamic import so the bundle is only loaded once (cached)
    // @ts-ignore — ssr-bundle.js is generated at build time, not a TS source file
    const mod = await import("./ssr-bundle.js");
    renderFn = mod.render;
  }
  return renderFn!;
}

// Load the HTML template once
let htmlTemplate: string | null = null;
function getHtmlTemplate(): string {
  if (!htmlTemplate) {
    // In production, dist/client is deployed alongside functions
    const templatePath = path.resolve(__dirname, "../../dist/client/index.html");
    htmlTemplate = fs.readFileSync(templatePath, "utf-8");
  }
  return htmlTemplate;
}

function injectIntoTemplate(
  template: string,
  html: string,
  head: string,
  dehydratedState: unknown,
): string {
  return template
    .replace("</head>", `    ${head}\n  </head>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root">${html}</div>\n  <script>window.__DEHYDRATED_STATE__ = ${JSON.stringify(dehydratedState)};</script>`,
    )
    // Swap main.tsx entry for entry-client.tsx so SSR pages hydrate correctly
    .replace(/\/assets\/main-[^"]+\.js"/, (match) => match.replace("main-", "entry-client-"));
}

export const ssrRender = onRequest(
  { region: "europe-west1", memory: "512MiB", timeoutSeconds: 30 },
  async (req, res) => {
    try {
      const render = await getRender();
      const url = req.path + (req.url.includes("?") ? "?" + req.url.split("?")[1] : "");
      const { html, head, dehydratedState } = await render(url);
      const template = getHtmlTemplate();
      const page = injectIntoTemplate(template, html, head, dehydratedState);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // Cache marketing pages aggressively, dynamic pages less so
      const isMarketing = ["/landing", "/about", "/product", "/solutions", "/pricing"].some(
        (p) => req.path === p || req.path.startsWith(p + "/"),
      );
      res.setHeader("Cache-Control", isMarketing ? "public, max-age=3600, s-maxage=86400" : "public, max-age=60, s-maxage=300");
      res.status(200).send(page);
    } catch (err) {
      console.error("SSR render error:", err);
      // Fall back to SPA shell on error
      try {
        const template = getHtmlTemplate();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(template);
      } catch {
        res.status(500).send("Internal Server Error");
      }
    }
  },
);
