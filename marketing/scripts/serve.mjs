// Static server for the built site. `serve -s` rewrote every path to
// index.html, which threw away the prerendered pages; this serves, in order:
// the exact file, <path>.html (the prerendered page), then index.html for
// routes the browser app handles itself (listings, dashboard-added case
// studies and news). Hashed assets are cached for a year, pages never.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".pdf": "application/pdf",
  ".zip": "application/zip", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4",
};
const fileAt = (p) => { try { const s = statSync(p); return s.isFile() ? p : null; } catch { return null; } };

createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url || "/", "http://x").pathname); } catch { path = "/"; }
  path = normalize(path).replace(/\\/g, "/");
  if (path.includes("..")) { res.writeHead(400); return res.end(); }
  const clean = path.replace(/\/+$/, "") || "/";
  const candidates = clean === "/"
    ? [join(dist, "index.html")]
    : [join(dist, clean), join(dist, `${clean}.html`), join(dist, clean, "index.html")];
  let file = candidates.map(fileAt).find(Boolean);
  if (!file) file = fileAt(join(dist, "spa.html")) || join(dist, "index.html");
  const ext = extname(file).toLowerCase();
  const immutable = file.includes(`${dist}/assets/`);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`bgp.uk.com static server on :${port}`));
