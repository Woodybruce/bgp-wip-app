// Property brochures — investment + leasing pitch documents stored
// on SharePoint, surfaced on the property page as a half-size
// thumbnail board with a toggle between the two types and a
// collapsible Archive section for older versions.
//
// Source: the property's SharePoint folder (crm_properties.sharepoint_folder_url
// when set, else BGP share drive/{team}/{propertyName}/Brochures). Files
// are classified by filename + path heuristics: leasing/letting/marketing
// vs investment/info-memo/OM/IM. Archive = sits under /Archive/ or older
// than 18 months.
//
// Thumbnails come from Microsoft Graph's /thumbnails endpoint on the
// driveItem — no need to render PDFs ourselves. The popout uses the
// item's webUrl in an iframe (SharePoint's native preview). Download
// link is the @microsoft.graph.downloadUrl from the driveItem.

import type { Express, Request, Response } from "express";
import multer from "multer";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { getValidMsToken } from "./microsoft";

const upload = multer({
  storage: multer.memoryStorage(),
  // 100MB cap — investment OMs with high-res photography can hit
  // 50-80MB. 25MB would clip them.
  limits: { fileSize: 100 * 1024 * 1024 },
});

const BROCHURE_PATTERNS = [
  "brochure", "pitch", "marketing pack", "marketing-pack",
  "info memo", "info memorandum", "information memorandum",
  "om", "im", "om.pdf", "im.pdf",
  "playbook", "deck", "why buy",
];

const LEASING_HINTS = ["leasing", "letting", "marketing pack", "marketing-pack", "to let", "to-let", "tenant pitch", "letting brochure", "leasing brochure"];
const INVESTMENT_HINTS = ["investment", "info memo", "info memorandum", "information memorandum", "om ", " om.pdf", "om-", "_om", "im ", " im.pdf", "im-", "_im", "for sale", "for-sale", "why buy"];
const ARCHIVE_HINTS = ["archive", "archived", "old", "superseded", "previous", "v1", "v2", "draft"];

const ARCHIVE_AGE_MONTHS = 18;

type BrochureItem = {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
  lastModified: string | null;
  type: "leasing" | "investment" | "unknown";
  archive: boolean;
  pathSegments: string[];
};

function classifyType(filename: string, pathSegments: string[]): "leasing" | "investment" | "unknown" {
  const haystack = (filename + " " + pathSegments.join(" ")).toLowerCase();
  let leasingScore = 0;
  let investmentScore = 0;
  for (const h of LEASING_HINTS) if (haystack.includes(h)) leasingScore++;
  for (const h of INVESTMENT_HINTS) if (haystack.includes(h)) investmentScore++;
  if (leasingScore > investmentScore) return "leasing";
  if (investmentScore > leasingScore) return "investment";
  return "unknown";
}

function isArchive(filename: string, pathSegments: string[], lastModified: string | null): boolean {
  const haystack = (filename + " " + pathSegments.join(" ")).toLowerCase();
  for (const h of ARCHIVE_HINTS) if (haystack.includes(h)) return true;
  if (lastModified) {
    const ms = new Date(lastModified).getTime();
    if (Number.isFinite(ms) && ms < Date.now() - ARCHIVE_AGE_MONTHS * 30 * 24 * 60 * 60 * 1000) {
      return true;
    }
  }
  return false;
}

function isBrochureLike(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  for (const p of BROCHURE_PATTERNS) {
    if (lower.includes(p)) return true;
  }
  // No keyword hit — still allow it through as "unknown" so the UI can
  // show everything when the team's filename convention drifts. We
  // bias toward inclusion; classification handles the rest.
  return true;
}

// Recursively list driveItem children up to maxDepth, accumulating
// PDFs. Each item carries its full path segments so classification
// can use directory names ("Brochures/Leasing/2024/foo.pdf" → leasing).
async function walkFolder(
  token: string,
  driveId: string,
  itemId: string,
  segments: string[],
  acc: BrochureItem[],
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth > maxDepth) return;
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$expand=thumbnails`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return;
  const data: any = await r.json();
  for (const child of data.value || []) {
    if (child.folder) {
      // Skip the wider property folder tree — only walk into folders
      // that look brochure-related to keep latency sensible.
      const folderName = (child.name || "").toLowerCase();
      const inBrochureBranch = depth >= 1
        ? true
        : folderName.includes("brochure") || folderName.includes("marketing") || folderName.includes("pitch") || folderName.includes("why buy") || folderName.includes("om") || folderName.includes("im") || folderName.includes("info memo");
      if (inBrochureBranch) {
        await walkFolder(token, driveId, child.id, [...segments, child.name], acc, depth + 1, maxDepth);
      }
      continue;
    }
    if (!isBrochureLike(child.name)) continue;
    const thumb = child.thumbnails?.[0]?.medium?.url || child.thumbnails?.[0]?.large?.url || child.thumbnails?.[0]?.small?.url || null;
    acc.push({
      id: child.id,
      name: child.name,
      size: child.size || 0,
      webUrl: child.webUrl,
      downloadUrl: child["@microsoft.graph.downloadUrl"] || null,
      thumbnailUrl: thumb,
      lastModified: child.lastModifiedDateTime || null,
      type: classifyType(child.name, segments),
      archive: isArchive(child.name, segments, child.lastModifiedDateTime),
      pathSegments: segments,
    });
  }
}

// Fetch a brochure PDF from SharePoint (via driveId + itemId) into a
// Buffer. Used by the edit endpoint as the input to pdf-lib.
async function fetchSharePointPdf(token: string, driveId: string, itemId: string): Promise<Buffer> {
  const r = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`SharePoint download failed: ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

// Upload an edited PDF back to the same SharePoint folder under a
// version-tagged filename so the original brochure stays intact.
// "Pret Brochure.pdf" → "Pret Brochure (edited 2026-05-19 0830).pdf".
async function uploadEditedPdf(
  token: string,
  driveId: string,
  parentItemId: string,
  originalName: string,
  buf: Buffer,
): Promise<{ webUrl: string; id: string }> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
  const base = originalName.replace(/\.pdf$/i, "");
  const newName = `${base} (edited ${stamp}).pdf`;
  const encName = encodeURIComponent(newName);
  // PUT to parent:/{name}:/content for files < 4MB; for larger files
  // an upload session is needed but brochures usually fit.
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentItemId}:/${encName}:/content`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
      body: buf,
    },
  );
  if (!r.ok) throw new Error(`SharePoint upload failed: ${r.status} ${await r.text().catch(() => "")}`);
  const item: any = await r.json();
  return { webUrl: item.webUrl, id: item.id };
}

export function registerPropertyBrochureRoutes(app: Express) {
  app.get("/api/properties/:id/brochures", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = await getValidMsToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Microsoft 365" });

      const propRes = await pool.query<{ name: string; sharepoint_folder_url: string | null; folder_teams: string[] | null }>(
        `SELECT name, sharepoint_folder_url, folder_teams FROM crm_properties WHERE id = $1`,
        [req.params.id],
      );
      const prop = propRes.rows[0];
      if (!prop) return res.status(404).json({ error: "Property not found" });

      const folderUrl = (prop.sharepoint_folder_url || "").trim();
      let driveId: string | null = null;
      let rootItemId: string | null = null;
      let folderName: string | null = null;

      if (folderUrl) {
        const encoded = Buffer.from(folderUrl).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const r = await fetch(`https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const item: any = await r.json();
          driveId = item.parentReference?.driveId || null;
          rootItemId = item.id || null;
          folderName = item.name || null;
        }
      }

      if (!driveId || !rootItemId) {
        return res.json({
          leasing: [], investment: [], unknown: [],
          archived: { leasing: [], investment: [], unknown: [] },
          configured: false,
          message: "No SharePoint folder linked to this property. Set sharepoint_folder_url to enable.",
        });
      }

      const items: BrochureItem[] = [];
      await walkFolder(token, driveId, rootItemId, [folderName || prop.name], items, 0, 3);

      // Group + sort. Newest first within each bucket.
      const bySortKey = (a: BrochureItem, b: BrochureItem) => {
        const ta = a.lastModified ? new Date(a.lastModified).getTime() : 0;
        const tb = b.lastModified ? new Date(b.lastModified).getTime() : 0;
        return tb - ta;
      };
      const active = items.filter(i => !i.archive).sort(bySortKey);
      const archived = items.filter(i => i.archive).sort(bySortKey);

      res.json({
        configured: true,
        driveId,                              // surfaced so the edit dialog can target this brochure's drive
        leasing: active.filter(i => i.type === "leasing"),
        investment: active.filter(i => i.type === "investment"),
        unknown: active.filter(i => i.type === "unknown"),
        archived: {
          leasing: archived.filter(i => i.type === "leasing"),
          investment: archived.filter(i => i.type === "investment"),
          unknown: archived.filter(i => i.type === "unknown"),
        },
        total: items.length,
      });
    } catch (err: any) {
      console.error("[property-brochures]", err?.message, err?.stack?.split("\n")[1]);
      res.status(500).json({ error: err?.message });
    }
  });

  // Edit a brochure PDF in-place — delete pages, reorder pages, or
  // overlay a white rectangle (e.g. cover an old agent's logo) +
  // optionally drop the BGP logo on top. Writes a NEW file alongside
  // the original ("(edited <date>).pdf") so the source brochure
  // stays intact. The caller passes the driveId + itemId from the
  // list endpoint so we don't have to walk the folder again.
  //
  // Body shape:
  //   {
  //     driveId, itemId,
  //     deletePages?: number[],       // 1-indexed
  //     reorder?: number[],           // 1-indexed new order; length must match remaining pages
  //     overlays?: Array<{
  //       page: number,               // 1-indexed
  //       x: number, y: number,       // bottom-left, PDF points (0,0 = bottom-left)
  //       w: number, h: number,       // rectangle to cover with a white box
  //       addBgpLogo?: boolean,       // drop the BGP wordmark on top of the box
  //     }>,
  //   }
  app.post("/api/properties/:id/brochures/edit", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = await getValidMsToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Microsoft 365" });

      const { driveId, itemId, deletePages, reorder, overlays } = req.body as {
        driveId: string;
        itemId: string;
        deletePages?: number[];
        reorder?: number[];
        overlays?: Array<{ page: number; x: number; y: number; w: number; h: number; addBgpLogo?: boolean }>;
      };
      if (!driveId || !itemId) return res.status(400).json({ error: "driveId and itemId required" });

      // Fetch the original to learn its name + buffer + parent id.
      const metaR = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?$select=name,parentReference,size`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!metaR.ok) return res.status(404).json({ error: "Brochure not found" });
      const meta: any = await metaR.json();
      const parentItemId: string = meta.parentReference?.id;
      if (!parentItemId) return res.status(400).json({ error: "Couldn't resolve brochure's parent folder" });

      const srcBuf = await fetchSharePointPdf(token, driveId, itemId);

      const { PDFDocument, rgb } = await import("pdf-lib");
      const srcPdf = await PDFDocument.load(srcBuf);
      const out = await PDFDocument.create();

      // Build the desired page order — start with all source pages,
      // remove any in deletePages, then re-arrange per reorder.
      const total = srcPdf.getPageCount();
      let order = Array.from({ length: total }, (_, i) => i + 1); // 1-indexed
      if (deletePages && deletePages.length) {
        const drop = new Set(deletePages);
        order = order.filter(p => !drop.has(p));
      }
      if (reorder && reorder.length) {
        if (reorder.length !== order.length) {
          return res.status(400).json({ error: `reorder length (${reorder.length}) must match remaining page count (${order.length})` });
        }
        const setRemaining = new Set(order);
        for (const p of reorder) {
          if (!setRemaining.has(p)) return res.status(400).json({ error: `reorder references page ${p} which isn't in the remaining set` });
        }
        order = reorder;
      }

      // Copy pages in the desired order.
      const indices = order.map(p => p - 1);
      const copied = await out.copyPages(srcPdf, indices);
      for (const p of copied) out.addPage(p);

      // Apply overlays AFTER copying so the page indices map 1:1 to
      // the OUTPUT pages (overlay.page is the position in the
      // result document, not the source).
      if (overlays && overlays.length) {
        // Try to load the BGP wordmark once if any overlay wants it.
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
          // White cover rectangle (pdf-lib uses bottom-left origin).
          page.drawRectangle({
            x: o.x, y: o.y, width: o.w, height: o.h,
            color: rgb(1, 1, 1),
          });
          if (o.addBgpLogo && embeddedLogo) {
            // Fit the logo inside the overlay rectangle preserving aspect.
            const ratio = embeddedLogo.width / embeddedLogo.height;
            let logoW = o.w * 0.85;
            let logoH = logoW / ratio;
            if (logoH > o.h * 0.85) { logoH = o.h * 0.85; logoW = logoH * ratio; }
            page.drawImage(embeddedLogo, {
              x: o.x + (o.w - logoW) / 2,
              y: o.y + (o.h - logoH) / 2,
              width: logoW,
              height: logoH,
            });
          }
        }
      }

      const outBytes = await out.save();
      const uploaded = await uploadEditedPdf(token, driveId, parentItemId, meta.name || "Brochure.pdf", Buffer.from(outBytes));
      res.json({
        ok: true,
        editedItemId: uploaded.id,
        editedWebUrl: uploaded.webUrl,
        pagesIn: total,
        pagesOut: out.getPageCount(),
        overlaysApplied: overlays?.length || 0,
      });
    } catch (err: any) {
      console.error("[property-brochures edit]", err?.message, err?.stack?.split("\n")[1]);
      res.status(500).json({ error: err?.message });
    }
  });

  // Upload a brochure to a property's SharePoint folder. Multipart form:
  //   file:  the PDF
  //   type:  "leasing" | "investment" (drives which subfolder)
  // Walks (or creates) `Brochures/{Leasing|Investment}` under the
  // property's root SharePoint folder, then PUTs the file. Returns
  // the new driveItem id + webUrl so the UI can refresh.
  app.post("/api/properties/:id/brochures/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const token = await getValidMsToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Microsoft 365" });

      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const rawType = String((req.body?.type || "leasing")).toLowerCase();
      const type: "leasing" | "investment" = rawType === "investment" ? "investment" : "leasing";
      const subfolderName = type === "investment" ? "Investment" : "Leasing";

      // Resolve the property's root folder.
      const propRes = await pool.query<{ name: string; sharepoint_folder_url: string | null }>(
        `SELECT name, sharepoint_folder_url FROM crm_properties WHERE id = $1`,
        [req.params.id],
      );
      const prop = propRes.rows[0];
      if (!prop) return res.status(404).json({ error: "Property not found" });

      const folderUrl = (prop.sharepoint_folder_url || "").trim();
      if (!folderUrl) {
        return res.status(400).json({
          error: "No SharePoint folder linked to this property. Set sharepoint_folder_url before uploading brochures.",
        });
      }

      // Step 1: resolve folder URL → driveItem (root of property folder).
      const encoded = Buffer.from(folderUrl).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const rootR = await fetch(`https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!rootR.ok) return res.status(500).json({ error: `Couldn't resolve property folder (${rootR.status})` });
      const rootItem: any = await rootR.json();
      const driveId: string = rootItem.parentReference?.driveId;
      const rootItemId: string = rootItem.id;
      if (!driveId || !rootItemId) return res.status(500).json({ error: "Property folder has no drive context" });

      // Step 2: ensure /Brochures and /Brochures/{Leasing|Investment}
      // exist. Uses POST /children with conflictBehavior:fail to keep
      // existing folders. If they already exist, re-GET them.
      const ensureFolder = async (parentId: string, name: string): Promise<string> => {
        // Try to fetch first — cheaper than create-then-409.
        const enc = encodeURIComponent(name);
        const findR = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}:/${enc}?$select=id,folder`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (findR.ok) {
          const f: any = await findR.json();
          if (f.folder) return f.id;
        }
        // Not found — create.
        const createR = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}/children`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
        });
        if (createR.ok) {
          const f: any = await createR.json();
          return f.id;
        }
        // 409 means it appeared in the meantime; re-fetch.
        if (createR.status === 409) {
          const refind = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}:/${enc}?$select=id`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (refind.ok) {
            const f: any = await refind.json();
            return f.id;
          }
        }
        throw new Error(`Couldn't create or find subfolder "${name}" (${createR.status})`);
      };

      const brochuresFolderId = await ensureFolder(rootItemId, "Brochures");
      const typeFolderId = await ensureFolder(brochuresFolderId, subfolderName);

      // Step 3: upload the file. Small uploads (< 4MB) can PUT
      // directly to /content. For larger files create an upload
      // session — brochures routinely exceed 4MB so we always use
      // the session path for safety.
      const cleanName = (file.originalname || "Brochure.pdf").replace(/[\/\\:*?"<>|]/g, "-");
      const encName = encodeURIComponent(cleanName);

      let newItem: any;
      if (file.size < 4 * 1024 * 1024) {
        const putR = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${typeFolderId}:/${encName}:/content`,
          {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": file.mimetype || "application/pdf" },
            body: file.buffer,
          },
        );
        if (!putR.ok) throw new Error(`Upload failed (${putR.status}): ${await putR.text().catch(() => "")}`);
        newItem = await putR.json();
      } else {
        const sessR = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${typeFolderId}:/${encName}:/createUploadSession`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              item: { "@microsoft.graph.conflictBehavior": "rename", name: cleanName },
            }),
          },
        );
        if (!sessR.ok) throw new Error(`Upload session create failed (${sessR.status})`);
        const sess: any = await sessR.json();
        const uploadUrl: string = sess.uploadUrl;
        // 5MB chunks. Graph requires multiples of 320KB; 5MB is well-formed.
        const CHUNK = 5 * 1024 * 1024;
        let offset = 0;
        let last: any = null;
        while (offset < file.size) {
          const end = Math.min(offset + CHUNK, file.size);
          const chunk = file.buffer.slice(offset, end);
          const partR = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Length": String(chunk.length),
              "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
            },
            body: chunk,
          });
          if (!partR.ok && partR.status !== 202) throw new Error(`Chunk upload failed at ${offset} (${partR.status})`);
          if (partR.status === 200 || partR.status === 201) last = await partR.json();
          offset = end;
        }
        if (!last) throw new Error("Upload session completed but no driveItem returned");
        newItem = last;
      }

      res.json({
        ok: true,
        id: newItem.id,
        name: newItem.name,
        webUrl: newItem.webUrl,
        size: newItem.size,
        type,
      });
    } catch (err: any) {
      console.error("[property-brochures upload]", err?.message, err?.stack?.split("\n")[1]);
      res.status(500).json({ error: err?.message });
    }
  });
}
