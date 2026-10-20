// Package only public build output for the isolated design-review service.
// Usage: node scripts/package-concept-preview.mjs /absolute/output/directory
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target || !isAbsolute(target)) throw new Error("Provide an absolute output directory.");
if (existsSync(target)) throw new Error("Use a new output directory to avoid stale preview files.");
if (!existsSync(resolve(root, "dist/index.html"))) throw new Error("Build the marketing app first.");
mkdirSync(resolve(target, "scripts"), { recursive: true });
cpSync(resolve(root, "dist"), resolve(target, "dist"), { recursive: true });
const server = readFileSync(resolve(root, "scripts/serve.mjs"), "utf8")
  .replace('"Content-Type": types[ext]', '"X-Robots-Tag": "noindex, nofollow, noarchive",\n    "Content-Type": types[ext]')
  .replace("bgp.uk.com static server", "BGP concept preview");
writeFileSync(resolve(target, "scripts/serve.mjs"), server);
writeFileSync(resolve(target, "dist/robots.txt"), "User-agent: *\nDisallow: /\n");
writeFileSync(resolve(target, "Dockerfile"), [
  "FROM node:22-alpine",
  "WORKDIR /app",
  "COPY dist ./dist",
  "COPY scripts ./scripts",
  "ENV NODE_ENV=production",
  "ENV PORT=8080",
  "EXPOSE 8080",
  'CMD ["node", "scripts/serve.mjs"]',
  "",
].join("\n"));
console.log(`Public preview packaged at ${target}`);
