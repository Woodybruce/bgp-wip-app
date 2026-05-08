/**
 * Universal Ingestion Routes
 * ==========================
 *
 *   POST /api/ingest                — preview a file (multipart/form-data)
 *   POST /api/ingest/:token/commit  — commit a previously-previewed ingest
 *   GET  /api/ingest/targets        — list supported ingest targets
 *   POST /api/ingest/folder         — ingest all data files in a SharePoint folder
 *
 * The two-phase flow is mandatory: every ingest produces a preview first,
 * the user (or ChatBGP, via the wrapping tool) reviews it, then triggers
 * the commit. Tokens expire after 1h.
 *
 * Exception: folder ingestion auto-commits each child (the act of sharing
 * the folder link is the confirmation). Returns a multi-file summary.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireAuth } from "./auth";
import {
  readFile,
  parseWithClaude,
  buildDiff,
  commitDiff,
  getPendingPreview,
  listIngestTargets,
  classifyTarget,
  summariseDiff,
  ingestBytes,
  type IngestTarget,
} from "./universal-ingest";
import { resolveSharePointShareLink, downloadFolderChild } from "./sharepoint-resolver";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const DATA_EXTS = new Set(["xlsx", "xls", "csv", "pdf", "txt", "ods"]);
function isDataFilename(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return DATA_EXTS.has(ext);
}

export function registerIngestRoutes(app: Express) {
  app.get("/api/ingest/targets", requireAuth, (_req: Request, res: Response) => {
    res.json({ targets: listIngestTargets() });
  });

  // Preview an ingest. Multipart upload OR pasted text.
  // Body: target=<IngestTarget>, [file] OR [text]
  app.post("/api/ingest", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const targetRaw = req.body?.target;
      const targetVal = (Array.isArray(targetRaw) ? targetRaw[0] : String(targetRaw || "auto")) as string;
      // "auto" triggers AI classification — UI default, so users can just drop a file.
      const targetIsAuto = targetVal === "auto" || !targetVal;
      if (!targetIsAuto && !listIngestTargets().includes(targetVal as IngestTarget)) {
        return res.status(400).json({ error: `target must be one of: auto | ${listIngestTargets().join(", ")}` });
      }

      let bytes: Buffer;
      let filename: string;
      const textRaw = req.body?.text;
      const filenameRaw = req.body?.filename;
      const shareUrlRaw = req.body?.shareUrl;
      const textVal = Array.isArray(textRaw) ? textRaw[0] : textRaw;
      const filenameVal = Array.isArray(filenameRaw) ? filenameRaw[0] : filenameRaw;
      const shareUrl = Array.isArray(shareUrlRaw) ? shareUrlRaw[0] : shareUrlRaw;
      if (req.file) {
        bytes = req.file.buffer;
        filename = req.file.originalname;
      } else if (typeof shareUrl === "string" && /sharepoint\.com|onedrive/i.test(shareUrl)) {
        const resolved = await resolveSharePointShareLink(shareUrl);
        if (resolved.isFolder) {
          // Folder link → auto-ingest all data files, return multi-file summary.
          const dataFiles = (resolved.folderChildren || []).filter(c => isDataFilename(c.filename));
          if (dataFiles.length === 0) {
            return res.status(400).json({
              error: "Folder share link — no importable data files found. Files: " +
                (resolved.folderChildren?.map(c => c.filename).join(", ") || "none"),
            });
          }
          const userId = (req as any).user?.id || "system";
          const results: Array<{ filename: string; written: number; skipped: number; target: string; narrative: string; error?: string }> = [];
          for (const child of dataFiles.slice(0, 10)) { // cap at 10 files
            try {
              const childBytes = await downloadFolderChild(child.downloadUrl);
              const r = await ingestBytes({ bytes: childBytes, filename: child.filename, userId });
              results.push({ filename: child.filename, written: r.written, skipped: r.skipped, target: r.target, narrative: r.narrative });
            } catch (err: any) {
              results.push({ filename: child.filename, written: 0, skipped: 0, target: "unknown", narrative: "", error: err?.message });
            }
          }
          return res.json({ folderIngest: true, folderName: resolved.filename, files: results });
        }
        bytes = resolved.bytes;
        filename = resolved.filename;
      } else if (typeof textVal === "string" && textVal.trim()) {
        bytes = Buffer.from(textVal, "utf-8");
        filename = (typeof filenameVal === "string" && filenameVal) || "pasted.txt";
      } else {
        return res.status(400).json({ error: "Provide a file, a SharePoint share link, or pasted text" });
      }

      const file = readFile({ bytes, filename });
      let target: IngestTarget;
      let autoClassified: { confidence: "high" | "medium" | "low"; reasoning: string } | undefined;
      if (targetIsAuto) {
        const cls = await classifyTarget(file);
        target = cls.target;
        autoClassified = { confidence: cls.confidence, reasoning: cls.reasoning };
      } else {
        target = targetVal as IngestTarget;
      }
      const { records } = await parseWithClaude({ file, target });
      const preview = await buildDiff({ target, records, filename });
      preview.autoClassified = autoClassified;
      // Narrative is best-effort — never block the preview if it fails.
      try { preview.narrative = await summariseDiff({ preview }); } catch { /* skip */ }
      res.json(preview);
    } catch (err: any) {
      console.error("[ingest preview]", err?.message);
      res.status(500).json({ error: err?.message || "ingest failed" });
    }
  });

  // Inspect a pending preview by token (mainly for ChatBGP — useful when
  // the chat surface wants to re-render the diff before confirming).
  app.get("/api/ingest/:token", requireAuth, (req: Request, res: Response) => {
    const preview = getPendingPreview(String(req.params.token));
    if (!preview) return res.status(404).json({ error: "token expired or not found" });
    res.json(preview);
  });

  app.post("/api/ingest/:token/commit", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || "system";
      const result = await commitDiff({ commitToken: String(req.params.token), userId });
      res.json(result);
    } catch (err: any) {
      console.error("[ingest commit]", err?.message);
      res.status(500).json({ error: err?.message || "commit failed" });
    }
  });
}
