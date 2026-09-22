import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use("/sw.js", (_req, res, next) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    next();
  });

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Vite content-hashes every filename under /assets, so they can be
        // cached forever — without this they shipped max-age=0 and the
        // browser re-fetched ~1MB of JS/CSS on every app open (Woody,
        // 2026-08-28: "app slow").
        res.set("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.(png|jpg|jpeg|webp|svg|ico|woff2?|ttf)$/i.test(filePath)) {
        // Unhashed icons/fonts: cache a week, revalidate cheaply after.
        res.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
      }
    }
  }));

  // fall through to index.html if the file doesn't exist (GET/HEAD only)
  app.use("/{*path}", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(404).json({ message: "Not found" });
    }
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
