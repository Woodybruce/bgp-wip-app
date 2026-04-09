#!/usr/bin/env tsx

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ROOT = "/home/runner/workspace";

function getNewestMtime(dir: string, extensions: string[]): number {
  let newest = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      if (entry.isDirectory()) {
        newest = Math.max(newest, getNewestMtime(full, extensions));
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        const stat = fs.statSync(full);
        newest = Math.max(newest, stat.mtimeMs);
      }
    }
  } catch {}
  return newest;
}

async function check() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     PRE-DEPLOY BUILD CHECK                   ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  let issues = 0;

  const srcTime = getNewestMtime(path.join(ROOT, "client/src"), [".tsx", ".ts", ".css"]);
  const serverTime = getNewestMtime(path.join(ROOT, "server"), [".ts"]);
  const sharedTime = getNewestMtime(path.join(ROOT, "shared"), [".ts"]);
  const newestSource = Math.max(srcTime, serverTime, sharedTime);

  const distPublic = path.join(ROOT, "dist/public/assets");
  const distServer = path.join(ROOT, "dist/index.cjs");
  let distTime = 0;

  if (fs.existsSync(distPublic)) {
    const distFiles = fs.readdirSync(distPublic).filter(f => f.endsWith(".js"));
    for (const f of distFiles) {
      const stat = fs.statSync(path.join(distPublic, f));
      distTime = Math.max(distTime, stat.mtimeMs);
    }
  }

  let serverDistTime = 0;
  if (fs.existsSync(distServer)) {
    serverDistTime = fs.statSync(distServer).mtimeMs;
  }

  const oldestDist = Math.min(distTime || 0, serverDistTime || 0);

  if (oldestDist === 0) {
    console.log("  FAIL: No build found in dist/ — run 'npm run build' first");
    issues++;
  } else if (newestSource > oldestDist) {
    const staleBy = Math.round((newestSource - oldestDist) / 1000 / 60);
    console.log(`  FAIL: Build is STALE — source code is ${staleBy} minute(s) newer than dist/`);
    console.log(`         Source modified: ${new Date(newestSource).toLocaleString()}`);
    console.log(`         Build created:  ${new Date(oldestDist).toLocaleString()}`);
    issues++;
  } else {
    console.log(`  PASS: Build is up to date`);
    console.log(`         Source modified: ${new Date(newestSource).toLocaleString()}`);
    console.log(`         Build created:  ${new Date(oldestDist).toLocaleString()}`);
  }

  const swSrc = path.join(ROOT, "client/public/sw.js");
  const swDist = path.join(ROOT, "dist/public/sw.js");
  if (fs.existsSync(swSrc) && fs.existsSync(swDist)) {
    const srcContent = fs.readFileSync(swSrc, "utf-8");
    const distContent = fs.readFileSync(swDist, "utf-8");
    const srcVersion = srcContent.match(/CACHE_NAME\s*=\s*'([^']+)'/)?.[1];
    const distVersion = distContent.match(/CACHE_NAME\s*=\s*'([^']+)'/)?.[1];
    if (srcVersion !== distVersion) {
      console.log(`  FAIL: Service worker version mismatch — src=${srcVersion}, dist=${distVersion}`);
      issues++;
    } else {
      console.log(`  PASS: Service worker version matches (${srcVersion})`);
    }
  }

  console.log("");

  if (issues > 0) {
    console.log(`  ${issues} issue(s) found — rebuilding now...\n`);
    try {
      console.log("  Running: npm run build");
      execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
      console.log("\n  Build complete. Safe to deploy.\n");
    } catch (err) {
      console.error("\n  BUILD FAILED — do NOT deploy until this is fixed.\n");
      process.exit(2);
    }
  } else {
    console.log("  All checks passed — safe to deploy.\n");
  }
}

check().catch(err => {
  console.error("Pre-deploy check failed:", err);
  process.exit(2);
});
