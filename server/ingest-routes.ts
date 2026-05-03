/**
 * Universal Ingestion Routes
 * ==========================
 *
 *   POST /api/ingest                — preview a file (multipart/form-data)
 *   POST /api/ingest/:token/commit  — commit a previously-previewed ingest
 *   GET  /api/ingest/targets        — list supported ingest targets
 *
 * The two-phase flow is mandatory: every ingest produces a preview first,
 * the user (or ChatBGP, via the wrapping tool) reviews it, then triggers
 * the commit. Tokens expire after 1h.
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
  type IngestTarget,
} from "./universal-ingest";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function registerIngestRoutes(app: Express) {
  app.get("/api/ingest/targets", requireAuth, (_req: Request, res: Response) => {
    res.json({ targets: listIngestTargets() });
  });

  // Preview an ingest. Multipart upload OR pasted text.
  // Body: target=<IngestTarget>, [file] OR [text]
  app.post("/api/ingest", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const targetRaw = req.body?.target;
      const target = (Array.isArray(targetRaw) ? targetRaw[0] : String(targetRaw || "")) as IngestTarget;
      if (!listIngestTargets().includes(target)) {
        return res.status(400).json({ error: `target must be one of: ${listIngestTargets().join(", ")}` });
      }

      let bytes: Buffer;
      let filename: string;
      const textRaw = req.body?.text;
      const filenameRaw = req.body?.filename;
      const textVal = Array.isArray(textRaw) ? textRaw[0] : textRaw;
      const filenameVal = Array.isArray(filenameRaw) ? filenameRaw[0] : filenameRaw;
      if (req.file) {
        bytes = req.file.buffer;
        filename = req.file.originalname;
      } else if (typeof textVal === "string" && textVal.trim()) {
        bytes = Buffer.from(textVal, "utf-8");
        filename = (typeof filenameVal === "string" && filenameVal) || "pasted.txt";
      } else {
        return res.status(400).json({ error: "Provide either a file or text in the body" });
      }

      const file = readFile({ bytes, filename });
      const { records } = await parseWithClaude({ file, target });
      const preview = await buildDiff({ target, records, filename });
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
