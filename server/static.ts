import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
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
