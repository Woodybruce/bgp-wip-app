// Property brochures — BGP-native file storage for leasing /
// investment / OM PDFs attached to a property. Same architecture as
// property_plans: metadata row + storage_key into the file_storage
// table. No SharePoint dependency — brochures live in our DB and are
// served by us.
//
// Surfaces three endpoints:
//   GET  /api/properties/:id/brochures        list (grouped + archived split)
//   POST /api/properties/:id/brochures/upload multipart upload (PDF)
//   GET  /api/properties/:id/brochures/:bid/file  serve bytes for preview/download
//   POST /api/properties/:id/brochures/:bid/edit  pdf-lib edits (delete pages, cover logo)
//   PATCH /api/properties/:id/brochures/:bid       toggle archived / change type / rename
//   DELETE /api/properties/:id/brochures/:bid

import type { Express, Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { saveFile, getFile } from "./file-storage";

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
  };
}

export function registerPropertyBrochureRoutes(app: Express) {
  // List brochures attached to a property, grouped by type with the
  // archived rows separated so the UI's accordion shows them only
  // when asked.
  app.get("/api/properties/:id/brochures", requireAuth, async (req: Request, res: Response) => {
    try {
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
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        const rawType = String((req.body?.type || "leasing")).toLowerCase();
        const type: "leasing" | "investment" = rawType === "investment" ? "investment" : "leasing";

        // Quick PDF sniff — the magic header is "%PDF-". Plus suffix
        // check as a fallback when browsers don't set mimetype.
        const sniff = file.buffer.subarray(0, 5).toString("utf8");
        const isPdf = sniff.startsWith("%PDF-") || file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
        if (!isPdf) return res.status(400).json({ error: "Only PDFs are accepted as brochures." });

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
             (property_id, type, original_name, storage_key, mime_type, size_bytes, page_count, uploaded_by)
           VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7)
           RETURNING *`,
          [req.params.id, type, cleanName, storageKey, file.size, pageCount, actorId(req)],
        );
        res.json({ ok: true, brochure: rowToJson(rows[0]) });
      } catch (e: any) {
        console.error("[property-brochures upload]", e?.message);
        res.status(500).json({ error: e?.message });
      }
    },
  );

  // Serve the bytes — used by the preview iframe (no download header)
  // and the download button (download=1 adds Content-Disposition).
  app.get("/api/properties/:id/brochures/:bid/file", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query<BrochureRow>(
        `SELECT * FROM property_brochures WHERE id = $1 AND property_id = $2`,
        [req.params.bid, req.params.id],
      );
      const r = rows[0];
      if (!r) return res.status(404).json({ error: "Brochure not found" });

      const file = await getFile(r.storage_key);
      if (!file) return res.status(404).json({ error: "Brochure file missing from storage" });

      res.setHeader("Content-Type", r.mime_type || "application/pdf");
      if (req.query.download) {
        res.setHeader("Content-Disposition", `attachment; filename="${r.original_name.replace(/"/g, "")}"`);
      } else {
        // Inline preview for the iframe.
        res.setHeader("Content-Disposition", `inline; filename="${r.original_name.replace(/"/g, "")}"`);
      }
      res.send(file.buffer);
    } catch (e: any) {
      console.error("[property-brochures file]", e?.message);
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
      const srcPdf = await PDFDocument.load(file.buffer);
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
