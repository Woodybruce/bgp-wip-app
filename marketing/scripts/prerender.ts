// Prerender every sitemap route to static HTML in dist/ so search engines and
// AI crawlers read the page content without running JavaScript (Dan at
// Benchmark's audit, 2026-10-15: the raw HTML carried no words). Runs after
// `vite build`: builds a server bundle of the app, renders each route into
// the built index.html shell, and writes <route>.html for serve's clean URLs.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");
const ssrDir = resolve(root, "dist-ssr");

execSync("npx vite build --ssr src/entry-prerender.tsx --outDir dist-ssr --logLevel warn", { cwd: root, stdio: "inherit" });

const { render } = await import(pathToFileURL(resolve(ssrDir, "entry-prerender.js")).href);
const shell = readFileSync(resolve(dist, "index.html"), "utf8");
// The empty shell stays as spa.html for routes the browser app renders itself
// (listings, dashboard-added case studies and news); scripts/serve.mjs falls
// back to it, so React never hydrates against the wrong page.
writeFileSync(resolve(dist, "spa.html"), shell);
const sitemap = readFileSync(resolve(root, "public/sitemap.xml"), "utf8");
const routes = Array.from(sitemap.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)?<\/loc>/g)).map((m) => m[1] || "/");

let ok = 0;
for (const route of routes) {
  try {
    const { html, title } = render(route);
    const page = shell
      .replace('<div id="root"></div>', `<div id="root">${html}</div>`)
      .replace(/<title>[^<]*<\/title>/, `<title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>`);
    const out = route === "/" ? resolve(dist, "index.html") : resolve(dist, `${route.replace(/^\//, "")}.html`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, page);
    ok++;
  } catch (err: any) {
    console.warn(`prerender: ${route} skipped — ${err?.message || err}`);
  }
}
if (existsSync(ssrDir)) rmSync(ssrDir, { recursive: true, force: true });
console.log(`prerender: ${ok} of ${routes.length} routes written`);
