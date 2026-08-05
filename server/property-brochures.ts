// Property brochures — BGP-native file storage for leasing /
// investment / OM PDFs attached to a property. Same architecture as
// property_plans: metadata row + storage_key into the file_storage
// table. No SharePoint dependency — brochures live in our DB and are
// served by us.
//
// On upload, the file is hashed (sha256) for dedupe and then handed
// off to `brochure-ingest` which extracts images, classifies them
// (hero / floor plan / location plan), runs Claude vision over the
// rasterised pages to extract structured property fields + a tenancy
// schedule, and folds the lot back into crm_properties /
// tenancy_schedule_units / image_studio_images.
//
// Endpoints:
//   GET    /api/properties/:id/brochures           list (grouped + archived split)
//   POST   /api/properties/:id/brochures/upload    multipart upload (PDF) + auto-ingest
//   GET    /api/properties/:id/brochures/:bid/file serve bytes for preview/download
//   POST   /api/properties/:id/brochures/:bid/edit pdf-lib edits (delete pages, cover logo)
//   POST   /api/properties/:id/brochures/:bid/reingest  re-run the vision pipeline
//   PATCH  /api/properties/:id/brochures/:bid      toggle archived / change type / rename
//   DELETE /api/properties/:id/brochures/:bid

import type { Express, Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { saveFile, getFile } from "./file-storage";
import { ingestBrochure } from "./brochure-ingest";
import { contentDispositionFor } from "./utils/http-headers";

const upload = multer({
  storage: multer.memoryStorage(),
  // 100MB cap — investment OMs with high-res photography routinely
  // exceed 50MB. PDFs only.
  limits: { fileSize: 100 * 1024 * 1024 },
});

type BrochureRow = {
  id: string;
  property_id: string;
  type: "leasing" | "investment";
  original_name: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number | null;
  page_count: number | null;
  archived: boolean;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  // Ingestion columns added by ensureIngestColumns() — may be undefined on
  // legacy rows until the migration runs.
  file_sha256?: string | null;
  ingest_status?: "pending" | "running" | "done" | "error" | "skipped" | null;
  ingest_started_at?: string | null;
  ingest_completed_at?: string | null;
  ingest_result?: any;
  ingest_error?: string | null;
};

function actorId(req: Request): string | null {
  return (req.session as any)?.userId || (req as any).tokenUserId || null;
}

function rowToJson(r: BrochureRow) {
  return {
    id: r.id,
    name: r.original_name,
    type: r.type,
    size: Number(r.size_bytes) || 0,
    pageCount: r.page_count,
    archived: r.archived,
    notes: r.notes,
    uploadedAt: r.created_at,
    uploadedBy: r.uploaded_by,
    // URL the client uses for both thumbnail-iframe preview and download.
    fileUrl: `/api/properties/${r.property_id}/brochures/${r.id}/file`,
    downloadUrl: `/api/properties/${r.property_id}/brochures/${r.id}/file?download=1`,
    ingestStatus: r.ingest_status || null,
    ingestStartedAt: r.ingest_started_at || null,
    ingestCompletedAt: r.ingest_completed_at || null,
    ingestResult: r.ingest_result || null,
    ingestError: r.ingest_error || null,
  };
}

// Auto-migrate: the original property_brochures table predates the
// ingestion pipeline. Add the columns we need on the fly so deployments
// don't need a manual migration step.
let _columnsEnsured = false;
async function ensureIngestColumns(): Promise<void> {
  if (_columnsEnsured) return;
  try {
    await pool.query(`
      ALTER TABLE property_brochures
        ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
        ADD COLUMN IF NOT EXISTS ingest_status TEXT,
        ADD COLUMN IF NOT EXISTS ingest_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ingest_completed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ingest_result JSONB,
        ADD COLUMN IF NOT EXISTS ingest_error TEXT
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_property_brochures_sha256 ON property_brochures (file_sha256)`);
    _columnsEnsured = true;
  } catch (err: any) {
    // The table may not exist on first deploy — that's fine, the upload
    // route handles "relation does not exist" gracefully below.
    if (err?.code !== "42P01") {
      console.warn("[property-brochures] ensureIngestColumns:", err?.message);
    }
  }
}

// Fire-and-forget background ingest. We don't await this from the upload
// handler so a slow Claude vision pass (10-30s) doesn't block the HTTP
// response or hit Railway's edge timeout.
function runIngestInBackground(brochureId: string, propertyId: string, pdfBuffer: Buffer, userId: string | null): void {
  setImmediate(async () => {
    const startedAt = new Date();
    await pool.query(
      `UPDATE property_brochures SET ingest_status = 'running', ingest_started_at = $1, ingest_error = NULL WHERE id = $2`,
      [startedAt, brochureId]
    ).catch(() => {});
    const result = await ingestBrochure({ brochureId, propertyId, pdfBuffer, userId });
    await pool.query(
      `UPDATE property_brochures
         SET ingest_status = $1,
             ingest_completed_at = NOW(),
             ingest_result = $2,
             ingest_error = $3
       WHERE id = $4`,
      [
        result.status,
        JSON.stringify({ applied: result.applied, extraction: result.extraction || null }),
        result.error || null,
        brochureId,
      ],
    ).catch((e: any) => console.warn("[property-brochures] ingest status update failed:", e?.message));
    console.log(
      `[property-brochures] ingest ${result.status} for ${brochureId}:`,
      JSON.stringify(result.applied),
    );
  });
}

export function registerPropertyBrochureRoutes(app: Express) {
  // Add the ingestion-tracking columns on boot so existing deployments
  // pick them up without a manual migration step.
  ensureIngestColumns().catch(err => console.warn("[property-brochures] init:", err?.message));

  // List brochures attached to a property, grouped by type with the
  // archived rows separated so the UI's accordion shows them only
  // when asked.
  app.get("/api/properties/:id/brochures", requireAuth, async (req: Request, res: Response) => {
    try {
      const { clientBlockedForProperty } = await import("./company-scope");
      if (await clientBlockedForProperty(req, String(req.params.id))) {
        return res.status(403).json({ error: "Read-only access for client accounts" });
      }
      const { rows } = await pool.query<BrochureRow>(
        `SELECT * FROM property_brochures
          WHERE property_id = $1
          ORDER BY created_at DESC`,
        [req.params.id],
      );
      const json = rows.map(rowToJson);
      const active = json.filter(r => !r.archived);
      const archived = json.filter(r => r.archived);
      res.json({
        leasing: active.filter(r => r.type === "leasing"),
        investment: active.filter(r => r.type === "investment"),
        archived: {
          leasing: archived.filter(r => r.type === "leasing"),
          investment: archived.filter(r => r.type === "investment"),
        },
        total: rows.length,
      });
    } catch (e: any) {
      // Production may not have redeployed with the property_brochures
      // migration yet — degrade to empty rather than 500'ing the UI
      // so the panel renders its empty state instead of a red error.
      if (e?.code === "42P01" || /relation .* does not exist/i.test(e?.message || "")) {
        console.warn("[property-brochures list] table not yet created on this DB; returning empty:", e.message);
        return res.json({
          leasing: [], investment: [],
          archived: { leasing: [], investment: [] },
          total: 0, _pending_migration: true,
        });
      }
      console.error("[property-brochures list]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Upload a brochure. Multipart form: file + type ("leasing" | "investment").
  app.post(
    "/api/properties/:id/brochures/upload",
    requireAuth,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        // Clients may upload brochures on their OWN properties (board
        // parity, Woody 2026-08-03); anything out of scope stays blocked.
        const { isClientRequestUser, resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
        if (await isClientRequestUser(req as any)) {
          const scope = await resolveCompanyScope(req as any);
          if (!scope || !(await isPropertyInScope(scope, String(req.params.id)))) {
            return res.status(403).json({ error: "Read-only access for client accounts" });
          }
        }
        await ensureIngestColumns();
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        const rawType = String((req.body?.type || "leasing")).toLowerCase();
        const type: "leasing" | "investment" = rawType === "investment" ? "investment" : "leasing";

        // Quick PDF sniff — the magic header is "%PDF-". Plus suffix
        // check as a fallback when browsers don't set mimetype.
        const sniff = file.buffer.subarray(0, 5).toString("utf8");
        const isPdf = sniff.startsWith("%PDF-") || file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
        if (!isPdf) return res.status(400).json({ error: "Only PDFs are accepted as brochures." });

        // Dedupe: hash the bytes, see if the same brochure already exists
        // on this property. Same PDF arriving twice (resends from agents)
        // returns the existing row rather than creating a duplicate.
        const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
        const dupe = await pool.query<BrochureRow>(
          `SELECT * FROM property_brochures WHERE property_id = $1 AND file_sha256 = $2 LIMIT 1`,
          [req.params.id, sha256],
        );
        if (dupe.rows[0]) {
          return res.json({ ok: true, brochure: rowToJson(dupe.rows[0]), duplicate: true });
        }

        // Try to read the page count via pdf-lib so the UI can show it.
        // Failure is non-fatal — page_count stays NULL.
        let pageCount: number | null = null;
        try {
          const { PDFDocument } = await import("pdf-lib");
          const doc = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
          pageCount = doc.getPageCount();
        } catch (e: any) {
          console.warn("[property-brochures upload] couldn't read page count:", e?.message);
        }

        const storageKey = `property-brochures/${req.params.id}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
        const cleanName = (file.originalname || "Brochure.pdf").replace(/[\/\\:*?"<>|]/g, "-");
        await saveFile(storageKey, file.buffer, "application/pdf", cleanName);

        const { rows } = await pool.query<BrochureRow>(
          `INSERT INTO property_brochures
             (property_id, type, original_name, storage_key, mime_type, size_bytes, page_count, uploaded_by, file_sha256, ingest_status)
           VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8, 'pending')
           RETURNING *`,
          [req.params.id, type, cleanName, storageKey, file.size, pageCount, actorId(req), sha256],
        );
        const brochure = rows[0];

        // Kick the ingestion in the background. The HTTP response returns
        // straight away with ingest_status='pending'; the client polls the
        // list endpoint (or refreshes) to see status become 'running' then
        // 'done' once Claude finishes.
        runIngestInBackground(brochure.id, String(req.params.id), file.buffer, actorId(req));

        res.json({ ok: true, brochure: rowToJson(brochure) });
      } catch (e: any) {
        console.error("[property-brochures upload]", e?.message);
        res.status(500).json({ error: e?.message });
      }
    },
  );

  // Re-run the ingestion pipeline for an existing brochure. Useful when
  // we tune the vision prompt, or when an old upload predates this
  // pipeline. Wipes any rows previously tagged with this brochure's id
  // marker (in image_studio_images.tags and tenancy_schedule_units.comments)
  // before re-inserting, so hand-edited rows are preserved.
  app.post("/api/properties/:id/brochures/:bid/reingest", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureIngestColumns();
      const { rows } = await pool.query<BrochureRow>(
        `SELECT * FROM property_brochures WHERE id = $1 AND property_id = $2`,
        [req.params.bid, req.params.id],
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Brochure not found" });

      const file = await getFile(row.storage_key);
      if (!file) return res.status(404).json({ error: "Brochure file missing from storage" });

      runIngestInBackground(row.id, row.property_id, file.data, actorId(req));
      res.json({ ok: true, brochureId: row.id, status: "running" });
    } catch (e: any) {
      console.error("[property-brochures reingest]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Serve the bytes — used by the preview iframe (no download header)
  // and the download button (download=1 adds Content-Disposition).
  app.get("/api/properties/:id/brochures/:bid/file", requireAuth, async (req: Request, res: Response) => {
    try {
      const { clientBlockedForProperty } = await import("./company-scope");
      if (await clientBlockedForProperty(req, String(req.params.id))) {
        return res.status(403).json({ error: "Read-only access for client accounts" });
      }
      const { rows } = await pool.query<BrochureRow>(
        `SELECT * FROM property_brochures WHERE id = $1 AND property_id = $2`,
        [req.params.bid, req.params.id],
      );
      const r = rows[0];
      if (!r) return res.status(404).json({ error: "Brochure not found" });

      const file = await getFile(r.storage_key);
      if (!file) return res.status(404).json({ error: "Brochure file missing from storage" });

      // getFile() returns { data, contentType, originalName, size } —
      // the bytes live on `.data`, not `.buffer`. Sending file.buffer
      // (undefined) produced an empty response which the browser PDF
      // viewer rendered as "Failed to load PDF document".
      res.setHeader("Content-Type", file.contentType || r.mime_type || "application/pdf");
      res.setHeader("Content-Length", String(file.data.length));
      if (req.query.download) {
        res.setHeader("Content-Disposition", contentDispositionFor(r.original_name, "attachment"));
      } else {
        // Inline preview for the iframe.
        res.setHeader("Content-Disposition", contentDispositionFor(r.original_name, "inline"));
      }
      res.send(file.data);
    } catch (e: any) {
      console.error("[property-brochures file]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // First-page cover as a PNG — the tile/hero previews were iframe PDF
  // embeds, which letterbox with the viewer's black chrome (Woody,
  // 2026-08-05: "still got this brochure issue?"). Rasterised once with
  // pdftoppm (same tool the vision ingest uses) and cached on disk.
  app.get("/api/properties/:id/brochures/:bid/cover", requireAuth, async (req: Request, res: Response) => {
    try {
      const { clientBlockedForProperty } = await import("./company-scope");
      if (await clientBlockedForProperty(req, String(req.params.id))) {
        return res.status(403).json({ error: "Read-only access for client accounts" });
      }
      const { rows } = await pool.query<BrochureRow>(
        `SELECT * FROM property_brochures WHERE id = $1 AND property_id = $2`,
        [req.params.bid, req.params.id],
      );
      const r = rows[0];
      if (!r) return res.status(404).json({ error: "Brochure not found" });

      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");
      const coverDir = path.join(os.tmpdir(), "brochure-covers");
      fs.mkdirSync(coverDir, { recursive: true });
      // JPEG at 80dpi — the first cut used PNG at 100dpi and a single
      // Bluewater cover came out at 10.6MB, which is unusable on 4G.
      const coverPath = path.join(coverDir, `${r.id}.jpg`);

      if (!fs.existsSync(coverPath)) {
        const file = await getFile(r.storage_key);
        if (!file) return res.status(404).json({ error: "Brochure file missing from storage" });
        const pdfPath = path.join(coverDir, `${r.id}.pdf`);
        fs.writeFileSync(pdfPath, file.data);
        const { execFile } = await import("child_process");
        await new Promise<void>((resolve, reject) => {
          execFile("pdftoppm", ["-jpeg", "-jpegopt", "quality=82", "-f", "1", "-l", "1", "-r", "80", "-singlefile", pdfPath, coverPath.replace(/\.jpg$/, "")], { timeout: 30000 }, (err) => err ? reject(err) : resolve());
        });
        try { fs.unlinkSync(pdfPath); } catch {}
        if (!fs.existsSync(coverPath)) return res.status(500).json({ error: "cover render failed" });
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.send(fs.readFileSync(coverPath));
    } catch (e: any) {
      console.error("[property-brochures cover]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // PATCH — rename, retype (leasing/investment), archive toggle.
  app.patch("/api/properties/:id/brochures/:bid", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, type, archived, notes } = req.body || {};
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      if (typeof name === "string") { sets.push(`original_name = $${i++}`); params.push(name.replace(/[\/\\:*?"<>|]/g, "-")); }
      if (type === "leasing" || type === "investment") { sets.push(`type = $${i++}`); params.push(type); }
      if (typeof archived === "boolean") { sets.push(`archived = $${i++}`); params.push(archived); }
      if (typeof notes === "string") { sets.push(`notes = $${i++}`); params.push(notes); }
      if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
      sets.push("updated_at = NOW()");
      params.push(req.params.bid, req.params.id);
      const { rows } = await pool.query<BrochureRow>(
        `UPDATE property_brochures SET ${sets.join(", ")} WHERE id = $${i++} AND property_id = $${i} RETURNING *`,
        params,
      );
      if (!rows[0]) return res.status(404).json({ error: "Brochure not found" });
      res.json({ ok: true, brochure: rowToJson(rows[0]) });
    } catch (e: any) {
      console.error("[property-brochures patch]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // DELETE — removes the metadata row. We leave the file_storage
  // blob in place for now (cheap, easy to undo); a sweep job can
  // garbage-collect orphans later.
  app.delete("/api/properties/:id/brochures/:bid", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(
        `DELETE FROM property_brochures WHERE id = $1 AND property_id = $2`,
        [req.params.bid, req.params.id],
      );
      if ((r.rowCount || 0) === 0) return res.status(404).json({ error: "Brochure not found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[property-brochures delete]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Edit — pdf-lib delete pages / reorder / cover a logo with the
  // BGP wordmark. Saves the result as a new brochure row alongside
  // the original (original stays intact) so version history is
  // preserved.
  app.post("/api/properties/:id/brochures/:bid/edit", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query<BrochureRow>(
        `SELECT * FROM property_brochures WHERE id = $1 AND property_id = $2`,
        [req.params.bid, req.params.id],
      );
      const src = rows[0];
      if (!src) return res.status(404).json({ error: "Brochure not found" });

      const file = await getFile(src.storage_key);
      if (!file) return res.status(404).json({ error: "Brochure file missing from storage" });

      const { deletePages, reorder, overlays } = req.body as {
        deletePages?: number[];
        reorder?: number[];
        overlays?: Array<{ page: number; x: number; y: number; w: number; h: number; addBgpLogo?: boolean }>;
      };

      const { PDFDocument, rgb } = await import("pdf-lib");
      // getFile returns { data, contentType, ... } — bytes are on `.data`.
      const srcPdf = await PDFDocument.load(file.data);
      const out = await PDFDocument.create();

      const total = srcPdf.getPageCount();
      let order = Array.from({ length: total }, (_, i) => i + 1);
      if (deletePages?.length) {
        const drop = new Set(deletePages);
        order = order.filter(p => !drop.has(p));
      }
      if (reorder?.length) {
        if (reorder.length !== order.length) {
          return res.status(400).json({ error: `reorder length (${reorder.length}) must match remaining page count (${order.length})` });
        }
        const setRemaining = new Set(order);
        for (const p of reorder) {
          if (!setRemaining.has(p)) return res.status(400).json({ error: `reorder references page ${p} which isn't in the remaining set` });
        }
        order = reorder;
      }

      const indices = order.map(p => p - 1);
      const copied = await out.copyPages(srcPdf, indices);
      for (const p of copied) out.addPage(p);

      if (overlays?.length) {
        let bgpLogoBytes: Uint8Array | null = null;
        if (overlays.some(o => o.addBgpLogo)) {
          try {
            const fs = await import("fs");
            const path = await import("path");
            const candidates = [
              path.join(process.cwd(), "client", "public", "BGP_BlackHolder.png"),
              path.join(process.cwd(), "client", "src", "assets", "BGP_BlackHolder.png"),
              path.join(process.cwd(), "attached_assets", "BGP_BlackHolder.png"),
            ];
            for (const p of candidates) {
              try { if (fs.existsSync(p)) { bgpLogoBytes = fs.readFileSync(p); break; } } catch {}
            }
          } catch { /* logo optional */ }
        }
        const embeddedLogo = bgpLogoBytes ? await out.embedPng(bgpLogoBytes) : null;
        for (const o of overlays) {
          if (o.page < 1 || o.page > out.getPageCount()) continue;
          const page = out.getPage(o.page - 1);
          page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, color: rgb(1, 1, 1) });
          if (o.addBgpLogo && embeddedLogo) {
            const ratio = embeddedLogo.width / embeddedLogo.height;
            let logoW = o.w * 0.85;
            let logoH = logoW / ratio;
            if (logoH > o.h * 0.85) { logoH = o.h * 0.85; logoW = logoH * ratio; }
            page.drawImage(embeddedLogo, {
              x: o.x + (o.w - logoW) / 2,
              y: o.y + (o.h - logoH) / 2,
              width: logoW, height: logoH,
            });
          }
        }
      }

      const outBytes = await out.save();
      const newStorageKey = `property-brochures/${req.params.id}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
      const newName = `${src.original_name.replace(/\.pdf$/i, "")} (edited ${stamp}).pdf`;
      await saveFile(newStorageKey, Buffer.from(outBytes), "application/pdf", newName);

      const ins = await pool.query<BrochureRow>(
        `INSERT INTO property_brochures
           (property_id, type, original_name, storage_key, mime_type, size_bytes, page_count, uploaded_by, notes)
         VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8)
         RETURNING *`,
        [
          req.params.id, src.type, newName, newStorageKey,
          Buffer.from(outBytes).length, out.getPageCount(), actorId(req),
          `Edited from ${src.original_name}: ${total} → ${out.getPageCount()} pages${overlays?.length ? `, ${overlays.length} overlay(s)` : ""}`,
        ],
      );

      res.json({
        ok: true,
        brochure: rowToJson(ins.rows[0]),
        pagesIn: total,
        pagesOut: out.getPageCount(),
        overlaysApplied: overlays?.length || 0,
      });
    } catch (e: any) {
      console.error("[property-brochures edit]", e?.message, e?.stack?.split("\n")[1]);
      res.status(500).json({ error: e?.message });
    }
  });
}
