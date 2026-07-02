// Document Studio v2 — the unified documents hub backend. Ported from the
// Pave platform's Document Studio (pave-platform server/documents.ts) and
// adapted to BGP's engines.
//
// One library for every deliverable (deck / word / pdf / sheet). It orchestrates
// the proven engines rather than replacing them:
//   • decks → deck-assembler (locked cards → Claude-designed PDF)
//   • uploads/imports → stored + previewed
//   • previews → LibreOffice (office → pdf) + pdftoppm (pdf → page images)
//   • storage → file_storage (working copy) + SharePoint (canonical mirror, Graph)
//
// The artifact file is the source; the in-app view is a render of it, so they
// can't drift. SharePoint (via uploadFileToSharePoint) is the canonical record.
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { saveFile, getFile, deleteFile } from "./file-storage";
import { signDownloadToken, verifyDownloadToken } from "./utils/download-token";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile, execSync } from "child_process";
import crypto from "node:crypto";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const OFFICE_EXT = new Set([".pptx", ".docx", ".xlsx", ".ppt", ".doc", ".xls", ".odp", ".odt", ".ods"]);

// ── Preview rendering: any office/pdf file → page PNGs stored in file_storage ──
function sofficeToPdf(buffer: Buffer, ext: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docprev-"));
    const inPath = path.join(tmp, `in${ext}`);
    fs.writeFileSync(inPath, buffer);
    execFile("soffice", [
      "--headless", "--nologo", "--nofirststartwizard", "--norestore",
      `-env:UserInstallation=file://${path.join(tmp, "lo")}`,
      "--convert-to", "pdf", "--outdir", tmp, inPath,
    ], { timeout: 120000, env: { ...process.env, HOME: tmp, XDG_CACHE_HOME: path.join(tmp, ".cache") } }, (err) => {
      try {
        if (err) return reject(err);
        const out = path.join(tmp, `in.pdf`);
        if (!fs.existsSync(out)) return reject(new Error("soffice produced no PDF"));
        const pdf = fs.readFileSync(out);
        resolve(pdf);
      } finally {
        fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
}

// Public origin of this app, so an OnlyOffice server (on its own VM) can fetch
// the source file back over the internet for conversion.
function originPublicUrl(): string {
  return process.env.PUBLIC_APP_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
}

// Convert office → pdf via the OnlyOffice document server's conversion API.
// OnlyOffice fetches the source by URL, so the file must already be in storage
// and reachable. Optional — previews fall back to LibreOffice when it isn't
// configured (ONLYOFFICE_URL + ONLYOFFICE_JWT_SECRET).
async function onlyofficeToPdf(sourceUrl: string, ext: string, key: string): Promise<Buffer> {
  const ooUrl = process.env.ONLYOFFICE_URL, secret = process.env.ONLYOFFICE_JWT_SECRET;
  if (!ooUrl || !secret) throw new Error("OnlyOffice not configured");
  const filetype = ext.replace(/^\./, "");
  const jwtMod: any = await import("jsonwebtoken");
  const sign = (jwtMod.default || jwtMod).sign;
  const endpoint = `${ooUrl.replace(/\/+$/, "")}/ConvertService.ashx`;
  // Big decks (30+ image-heavy slides) can take well over 18s to convert —
  // poll for up to ~90s before giving up and falling back to LibreOffice.
  for (let attempt = 0; attempt < 60; attempt++) {
    const payload: any = { async: true, filetype, outputtype: "pdf", key, title: `src.${filetype}`, url: sourceUrl };
    payload.token = sign(payload, secret);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${payload.token}` },
      body: JSON.stringify(payload),
    });
    const data: any = await res.json();
    if (data.error) throw new Error(`OnlyOffice convert error ${data.error}`);
    if (data.endConvert && data.fileUrl) {
      const pdfRes = await fetch(data.fileUrl);
      if (!pdfRes.ok) throw new Error(`OnlyOffice fileUrl ${pdfRes.status}`);
      return Buffer.from(await pdfRes.arrayBuffer());
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("OnlyOffice convert timed out");
}

function pdfToPngs(pdf: Buffer, maxPages = 60): Buffer[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdfpng-"));
  try {
    const inPath = path.join(tmp, "in.pdf");
    fs.writeFileSync(inPath, pdf);
    execSync(`pdftoppm -png -r 130 -l ${maxPages} "${inPath}" "${path.join(tmp, "p")}"`, { timeout: 180000 });
    return fs.readdirSync(tmp).filter((f) => f.endsWith(".png")).sort()
      .map((f) => fs.readFileSync(path.join(tmp, f)));
  } finally {
    fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Render a document's pages to PNGs, store them, return their storage keys. */
export async function renderPreview(docId: string, buffer: Buffer, fileName: string, storageKey?: string): Promise<string[]> {
  const ext = path.extname(fileName).toLowerCase();
  let pdf: Buffer;
  try {
    if (ext === ".pdf") pdf = buffer;
    else if (OFFICE_EXT.has(ext)) {
      // Prefer OnlyOffice when configured; fall back to LibreOffice on this
      // container if it's unavailable.
      const origin = originPublicUrl();
      const canOO = !!(process.env.ONLYOFFICE_URL && process.env.ONLYOFFICE_JWT_SECRET && storageKey && origin);
      if (canOO) {
        const src = `${origin}/api/documents/_convsrc?key=${encodeURIComponent(storageKey!)}&dl=${signDownloadToken(storageKey!)}`;
        try {
          // Unique key per conversion — OnlyOffice caches results (and errors)
          // by key, so a stable key would pin a stale/failed render.
          pdf = await onlyofficeToPdf(src, ext, `${docId}-${crypto.randomBytes(6).toString("hex")}`);
        } catch (e: any) {
          console.warn(`[documents] OnlyOffice convert failed, using LibreOffice:`, e?.message);
          pdf = await sofficeToPdf(buffer, ext);
        }
      } else {
        pdf = await sofficeToPdf(buffer, ext);
      }
    }
    else return []; // images/other — no page preview for now
  } catch (e: any) {
    console.warn(`[documents] preview convert failed for ${fileName}:`, e?.message);
    return [];
  }
  let pngs: Buffer[];
  try { pngs = pdfToPngs(pdf); } catch (e: any) { console.warn("[documents] pdftoppm failed:", e?.message); return []; }
  const keys: string[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const key = `documents/${docId}/preview/page-${String(i + 1).padStart(2, "0")}.png`;
    await saveFile(key, pngs[i], "image/png", `${docId}-page-${i + 1}.png`);
    keys.push(key);
  }
  return keys;
}

// ── SharePoint mirror ────────────────────────────────────────────────────────
async function mirrorToSharePoint(buffer: Buffer, fileName: string, contentType: string, folderPath: string) {
  const { uploadFileToSharePoint } = await import("./microsoft");
  return uploadFileToSharePoint(buffer, fileName, contentType, folderPath);
}

// List folders (for the folder picker) at a SharePoint path relative to the drive root.
async function listSharePointFolders(relPath: string): Promise<Array<{ name: string; path: string }>> {
  const { SHAREPOINT_HOST, SHAREPOINT_SITE_PATH, getAppGraphToken } = await import("./microsoft");
  const token = await getAppGraphToken();
  if (!token) throw new Error("Could not acquire SharePoint token");
  const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`, { headers: { Authorization: `Bearer ${token}` } });
  const site = await siteRes.json();
  const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${token}` } });
  const drive = (await drivesRes.json()).value?.[0];
  const clean = (relPath || "").replace(/^\/+|\/+$/g, "");
  const select = "name,folder";
  const childrenUrl = clean
    ? `https://graph.microsoft.com/v1.0/drives/${drive.id}/root:/${encodeURIComponent(clean).replace(/%2F/g, "/")}:/children?$select=${select}&$top=400`
    : `https://graph.microsoft.com/v1.0/drives/${drive.id}/root/children?$select=${select}&$top=400`;
  const res = await fetch(childrenUrl, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return (data.value || [])
    .filter((c: any) => !!c.folder)
    .map((c: any) => ({ name: c.name, path: clean ? `${clean}/${c.name}` : c.name }));
}

function publicBase(req: any): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.get ? req.get("host") : req.headers.host) || "";
  return `${proto}://${host}`;
}

// ── Row → API shape (with signed URLs so the client can render previews) ──────
function docToApi(row: any) {
  const dl = signDownloadToken(row.id);
  const previews: string[] = Array.isArray(row.preview_keys) ? row.preview_keys : [];
  return {
    id: row.id, title: row.title, docType: row.doc_type, category: row.category,
    templateKey: row.template_key, deckId: row.deck_id, project: row.project,
    fileName: row.file_name, contentType: row.content_type, size: row.size,
    status: row.status, version: row.version,
    sharepointWebUrl: row.sharepoint_web_url, sharepointPath: row.sharepoint_path,
    createdAt: row.created_at, updatedAt: row.updated_at,
    downloadUrl: `/api/documents/${row.id}/file?dl=${dl}`,
    pageCount: previews.length,
    pageUrls: previews.map((_k, i) => `/api/documents/${row.id}/preview/${i}?dl=${dl}`),
  };
}

/** Upsert a documents-library row for an assembled deck so decks flow into the hub. */
export async function upsertDocumentForDeck(opts: {
  deckId: string; title: string; category?: string; project?: string;
  buffer: Buffer; fileName: string; storageKey: string; contentType?: string;
}): Promise<string> {
  const existing = await pool.query(`SELECT id FROM studio_documents WHERE deck_id = $1 LIMIT 1`, [opts.deckId]);
  const id = existing.rows[0]?.id || crypto.randomUUID();
  const previewKeys = await renderPreview(id, opts.buffer, opts.fileName, opts.storageKey).catch(() => []);
  const ct = opts.contentType || "application/pdf";
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE studio_documents SET title=$2, storage_key=$3, file_name=$4, content_type=$5, size=$6, preview_keys=$7::jsonb, version=version+1, status='ready', updated_at=now() WHERE id=$1`,
      [id, opts.title, opts.storageKey, opts.fileName, ct, opts.buffer.length, JSON.stringify(previewKeys)]
    );
  } else {
    await pool.query(
      `INSERT INTO studio_documents (id, title, doc_type, category, deck_id, project, storage_key, file_name, content_type, size, preview_keys, status)
       VALUES ($1,$2,'deck',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'ready')`,
      [id, opts.title, opts.category || "deck", opts.deckId, opts.project || null, opts.storageKey, opts.fileName, ct, opts.buffer.length, JSON.stringify(previewKeys)]
    );
  }
  return id;
}

/** Index a rendered brief (PDF) into the hub library so briefs sit alongside
 *  decks. Each save is a new dated deliverable, so this inserts a fresh row. */
export async function indexBriefDocument(opts: {
  title: string; project?: string; category?: string;
  buffer: Buffer; fileName: string; contentType?: string;
  sharepointWebUrl?: string; sharepointPath?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const ct = opts.contentType || "application/pdf";
  const storageKey = `documents/brief/${id}/${opts.fileName}`;
  await saveFile(storageKey, opts.buffer, ct, opts.fileName);
  const previewKeys = await renderPreview(id, opts.buffer, opts.fileName, storageKey).catch(() => []);
  await pool.query(
    `INSERT INTO studio_documents (id, title, doc_type, category, project, storage_key, file_name, content_type, size, preview_keys, sharepoint_web_url, sharepoint_path, status)
     VALUES ($1,$2,'brief',$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'ready')`,
    [id, opts.title, opts.category || "brief", opts.project || null, storageKey, opts.fileName, ct, opts.buffer.length,
     JSON.stringify(previewKeys), opts.sharepointWebUrl || null, opts.sharepointPath || null]
  );
  return id;
}

export function setupDocumentRoutes(app: Express) {
  // Signed, no-auth source fetch for OnlyOffice's conversion API. Keyed by the
  // storage key (HMAC-signed) so it works during the first render, before the
  // document row exists. Registered before the `:id` routes so it isn't caught
  // by `/api/documents/:id`. Serves the raw stored file for conversion only.
  app.get("/api/documents/_convsrc", async (req: Request, res: Response) => {
    const key = String(req.query.key || ""), dl = String(req.query.dl || "");
    if (!key || !verifyDownloadToken(key, dl)) return res.status(403).end();
    const file = await getFile(key);
    if (!file) return res.status(404).end();
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(file.data);
  });

  // List
  app.get("/api/documents", requireAuth, async (req: Request, res: Response) => {
    try {
      const where: string[] = []; const params: any[] = [];
      const add = (clause: string, val: any) => { params.push(val); where.push(clause.replace("$$", `$${params.length}`)); };
      if (req.query.category) add(`category = $$`, String(req.query.category));
      if (req.query.project) add(`project = $$`, String(req.query.project));
      if (req.query.docType) add(`doc_type = $$`, String(req.query.docType));
      if (req.query.q) add(`title ILIKE $$`, `%${String(req.query.q)}%`);
      const r = await pool.query(
        `SELECT * FROM studio_documents ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 200`, params);
      res.json(r.rows.map(docToApi));
    } catch (e: any) { console.error("[documents] list:", e?.message); res.status(500).json({ error: e?.message }); }
  });

  // Get one
  app.get("/api/documents/:id", requireAuth, async (req: Request, res: Response) => {
    const r = await pool.query(`SELECT * FROM studio_documents WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(docToApi(r.rows[0]));
  });

  // Generate a new document from a deck template: create the deck + seed its
  // cards, then assemble through the existing deck-assembler (locked cards →
  // Claude-designed PDF). Design runs well past the gateway's request timeout,
  // so it happens in the background: insert a placeholder row, return it
  // immediately, then fill it in when the file is ready.
  app.post("/api/documents/generate", requireAuth, async (req: any, res: Response) => {
    try {
      const { templateKey, title, project, propertyId, dealId } = req.body || {};
      if (!templateKey || !title) return res.status(400).json({ error: "templateKey and title are required" });
      const t = await pool.query(`SELECT key, default_cards FROM deck_templates WHERE key = $1 AND active = true`, [templateKey]);
      if (!t.rows[0]) return res.status(400).json({ error: `Unknown template '${templateKey}'` });
      const userId = req.session?.userId || req.tokenUserId || null;
      // Create the deck + seed its cards from the template (locked, so the
      // assembler picks them all up).
      const deck = await pool.query(
        `INSERT INTO decks (name, template_key, property_id, deal_id, status, created_by) VALUES ($1,$2,$3,$4,'draft',$5) RETURNING id`,
        [title, templateKey, propertyId || null, dealId || null, userId]);
      const deckId = deck.rows[0].id;
      const cards = Array.isArray(t.rows[0].default_cards) ? t.rows[0].default_cards : [];
      for (const c of cards) {
        await pool.query(
          `INSERT INTO deck_cards (deck_id, type, sort_order, state, title, content) VALUES ($1,$2,$3,'locked',$4,$5::jsonb)`,
          [deckId, c.type, c.sortOrder || 0, c.title || null, JSON.stringify(c.content || {})]);
      }
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO studio_documents (id, title, doc_type, category, deck_id, project, status, created_by) VALUES ($1,$2,'deck',$3,$4,$5,'generating',$6)`,
        [id, title, templateKey, deckId, project || null, userId]);
      const r = await pool.query(`SELECT * FROM studio_documents WHERE id=$1`, [id]);
      res.json(docToApi(r.rows[0]));

      (async () => {
        try {
          const { assembleDeck } = await import("./deck-assembler");
          const result: any = await assembleDeck(deckId);
          if (!result?.success || !result.chatMediaFilename) throw new Error(result?.error || "assembly failed");
          const storageKey = `chat-media/${result.chatMediaFilename}`;
          const file = await getFile(storageKey);
          if (!file) throw new Error("assembled file missing from storage");
          const safe = title.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "document";
          const fileName = `${safe}.pdf`;
          const previewKeys = await renderPreview(id, file.data, fileName, storageKey).catch(() => []);
          await pool.query(
            `UPDATE studio_documents SET storage_key=$2, file_name=$3, content_type=$4, size=$5, preview_keys=$6::jsonb, status='ready', updated_at=now() WHERE id=$1`,
            [id, storageKey, fileName, "application/pdf", file.data.length, JSON.stringify(previewKeys)]);
        } catch (e: any) {
          console.error("[documents] generate bg:", e?.message);
          await pool.query(`UPDATE studio_documents SET status='error', updated_at=now() WHERE id=$1`, [id]).catch(() => {});
        }
      })();
    } catch (e: any) { console.error("[documents] generate:", e?.message); res.status(500).json({ error: e?.message }); }
  });

  // Import/upload an existing file into the library.
  app.post("/api/documents/upload", requireAuth, upload.single("file"), async (req: any, res: Response) => {
    try {
      const f = req.file; if (!f) return res.status(400).json({ error: "No file" });
      const ext = path.extname(f.originalname).toLowerCase();
      const docType = ext === ".pdf" ? "pdf" : [".docx", ".doc"].includes(ext) ? "word" : [".xlsx", ".xls"].includes(ext) ? "sheet" : ext === ".pptx" || ext === ".ppt" ? "deck" : "other";
      const id = crypto.randomUUID();
      const storageKey = `documents/${id}/${f.originalname}`;
      const buf = f.buffer, fileName = f.originalname, mime = f.mimetype || "application/octet-stream", size = f.size;
      const userId = (req as any).session?.userId || (req as any).tokenUserId || null;
      // Insert the row first WITHOUT the file bytes and return immediately.
      // Persisting a large deck to Postgres (BYTEA, ~2x on the wire) plus
      // rendering previews can exceed Railway's 45s gateway timeout and 504 the
      // upload. Both are done in the background: status uploading → processing → ready.
      await pool.query(
        `INSERT INTO studio_documents (id, title, doc_type, category, project, storage_key, file_name, content_type, size, preview_keys, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb,'uploading',$10)`,
        [id, req.body?.title || fileName.replace(ext, ""), docType, req.body?.category || "other", req.body?.project || null,
         storageKey, fileName, mime, size, userId]);
      const r = await pool.query(`SELECT * FROM studio_documents WHERE id=$1`, [id]);
      res.json(docToApi(r.rows[0]));
      // Background: persist the bytes, then render page previews.
      (async () => {
        try {
          await saveFile(storageKey, buf, mime, fileName);
          await pool.query(`UPDATE studio_documents SET status='processing', updated_at=now() WHERE id=$1`, [id]);
          const keys = await renderPreview(id, buf, fileName, storageKey);
          await pool.query(`UPDATE studio_documents SET preview_keys=$2::jsonb, status='ready', updated_at=now() WHERE id=$1`, [id, JSON.stringify(keys)]);
        } catch (err: any) {
          console.warn("[documents] background save/preview failed:", err?.message);
          await pool.query(`UPDATE studio_documents SET status='ready', updated_at=now() WHERE id=$1`, [id]).catch(() => {});
        }
      })();
    } catch (e: any) {
      console.error("[documents] upload:", e?.message);
      if (!res.headersSent) res.status(500).json({ error: e?.message });
    }
  });

  // Download the file (auth session OR signed ?dl token for phone/email).
  app.get("/api/documents/:id/file", async (req: Request, res: Response) => {
    const dlOk = req.query.dl ? verifyDownloadToken(String(req.params.id), String(req.query.dl)) : false;
    if (!dlOk && !req.session?.userId && !(req as any).tokenUserId) return res.status(401).json({ error: "Not authenticated" });
    const r = await pool.query(`SELECT storage_key, file_name, content_type FROM studio_documents WHERE id=$1`, [req.params.id]);
    if (!r.rows[0]?.storage_key) return res.status(404).end();
    const file = await getFile(r.rows[0].storage_key);
    if (!file) return res.status(404).end();
    res.setHeader("Content-Type", r.rows[0].content_type || file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${(r.rows[0].file_name || "document").replace(/"/g, "")}"`);
    res.send(file.data);
  });

  // Serve a preview page image.
  app.get("/api/documents/:id/preview/:n", async (req: Request, res: Response) => {
    const dlOk = req.query.dl ? verifyDownloadToken(String(req.params.id), String(req.query.dl)) : false;
    if (!dlOk && !req.session?.userId && !(req as any).tokenUserId) return res.status(401).end();
    const r = await pool.query(`SELECT preview_keys FROM studio_documents WHERE id=$1`, [req.params.id]);
    const keys: string[] = Array.isArray(r.rows[0]?.preview_keys) ? r.rows[0].preview_keys : [];
    const key = keys[parseInt(String(req.params.n), 10)];
    if (!key) return res.status(404).end();
    const file = await getFile(key);
    if (!file) return res.status(404).end();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(file.data);
  });

  // Re-render the preview from the current file.
  app.post("/api/documents/:id/render", requireAuth, async (req: Request, res: Response) => {
    const r = await pool.query(`SELECT storage_key, file_name FROM studio_documents WHERE id=$1`, [req.params.id]);
    if (!r.rows[0]?.storage_key) return res.status(404).json({ error: "No file" });
    const file = await getFile(r.rows[0].storage_key);
    if (!file) return res.status(404).json({ error: "File missing" });
    const keys = await renderPreview(String(req.params.id), file.data, r.rows[0].file_name || "doc.pdf", r.rows[0].storage_key);
    await pool.query(`UPDATE studio_documents SET preview_keys=$2::jsonb, updated_at=now() WHERE id=$1`, [req.params.id, JSON.stringify(keys)]);
    const row = await pool.query(`SELECT * FROM studio_documents WHERE id=$1`, [req.params.id]);
    res.json(docToApi(row.rows[0]));
  });

  // Delete a document from the library (row + its stored file & preview images).
  // Does NOT touch the SharePoint copy — that's the canonical record.
  app.delete("/api/documents/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(`SELECT storage_key, preview_keys FROM studio_documents WHERE id=$1`, [req.params.id]);
      const d = r.rows[0];
      if (!d) return res.status(404).json({ error: "Not found" });
      const keys: string[] = Array.isArray(d.preview_keys) ? d.preview_keys : [];
      for (const k of [d.storage_key, ...keys].filter(Boolean)) await deleteFile(k).catch(() => {});
      await pool.query(`DELETE FROM studio_documents WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { console.error("[documents] delete:", e?.message); res.status(500).json({ error: e?.message }); }
  });

  // Mirror the file into a SharePoint folder.
  app.post("/api/documents/:id/mirror", requireAuth, async (req: Request, res: Response) => {
    try {
      const folderPath = String(req.body?.folderPath || "").trim();
      if (!folderPath) return res.status(400).json({ error: "folderPath required (e.g. 'BGP share drive/Investment')" });
      const r = await pool.query(`SELECT storage_key, file_name, content_type FROM studio_documents WHERE id=$1`, [req.params.id]);
      if (!r.rows[0]?.storage_key) return res.status(404).json({ error: "No file" });
      const file = await getFile(r.rows[0].storage_key);
      if (!file) return res.status(404).json({ error: "File missing" });
      const up = await mirrorToSharePoint(file.data, r.rows[0].file_name, r.rows[0].content_type || file.contentType, folderPath);
      await pool.query(`UPDATE studio_documents SET sharepoint_web_url=$2, sharepoint_item_id=$3, sharepoint_path=$4, updated_at=now() WHERE id=$1`,
        [req.params.id, up.webUrl, up.id, `${folderPath}/${r.rows[0].file_name}`]);
      res.json({ success: true, webUrl: up.webUrl });
    } catch (e: any) { console.error("[documents] mirror:", e?.message); res.status(500).json({ error: e?.message }); }
  });

  // Browse SharePoint folders (for the folder picker). path relative to drive root.
  app.get("/api/documents/sp-folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const folders = await listSharePointFolders(String(req.query.path || ""));
      res.json(folders);
    } catch (e: any) { console.error("[documents] sp-folders:", e?.message); res.status(500).json({ error: e?.message }); }
  });

  // ── OnlyOffice in-app editing ──────────────────────────────────────────────
  // Config for the embedded editor — JWT-signed; OnlyOffice fetches the file via
  // a public signed URL and posts edits back to the callback. Optional: without
  // ONLYOFFICE_URL/ONLYOFFICE_JWT_SECRET the client gets a 503 and shows a message.
  app.get("/api/documents/:id/editor-config", requireAuth, async (req: Request, res: Response) => {
    try {
      const ooUrl = process.env.ONLYOFFICE_URL, secret = process.env.ONLYOFFICE_JWT_SECRET;
      if (!ooUrl || !secret) return res.status(503).json({ error: "In-app editing isn't configured — use Edit in PowerPoint/Word instead" });
      const r = await pool.query(`SELECT * FROM studio_documents WHERE id=$1`, [req.params.id]);
      const d = r.rows[0];
      if (!d?.storage_key) return res.status(404).json({ error: "No file" });
      const ext = (d.file_name || "deck.pptx").split(".").pop()!.toLowerCase();
      const documentType = ["docx", "doc"].includes(ext) ? "word" : ["xlsx", "xls"].includes(ext) ? "cell" : ext === "pdf" ? "pdf" : "slide";
      const base = publicBase(req), dl = signDownloadToken(d.id);
      const config: any = {
        documentType,
        document: { fileType: ext, key: `${d.id}-v${d.version}`, title: d.file_name || `${d.title}.${ext}`,
          url: `${base}/api/documents/${d.id}/file?dl=${dl}`, permissions: { edit: true, download: true } },
        editorConfig: { mode: "edit",
          callbackUrl: `${base}/api/documents/${d.id}/onlyoffice-callback?dl=${dl}`,
          user: { id: String((req as any).session?.userId || "bgp"), name: "BGP" }, lang: "en-GB",
          customization: { autosave: true, forcesave: true, compactHeader: true } },
      };
      const jwtMod: any = await import("jsonwebtoken");
      config.token = (jwtMod.default || jwtMod).sign(config, secret);
      res.json({ ...config, documentServerUrl: ooUrl });
    } catch (e: any) { console.error("[documents] editor-config:", e?.message); res.status(500).json({ error: e?.message }); }
  });

  // OnlyOffice calls this when the doc is saved/closed — pull the edited file
  // back into the library, re-render the preview, bump the version.
  app.post("/api/documents/:id/onlyoffice-callback", async (req: Request, res: Response) => {
    try {
      const secret = process.env.ONLYOFFICE_JWT_SECRET;
      let data: any = req.body || {};
      if (secret && data.token) {
        const jwtMod: any = await import("jsonwebtoken");
        try { data = (jwtMod.default || jwtMod).verify(data.token, secret); } catch { return res.status(403).json({ error: 1 }); }
      }
      if ((data.status === 2 || data.status === 6) && data.url) {
        const resp = await fetch(data.url);
        const buf = Buffer.from(await resp.arrayBuffer());
        const r = await pool.query(`SELECT storage_key, file_name, content_type FROM studio_documents WHERE id=$1`, [req.params.id]);
        const d = r.rows[0];
        if (d?.storage_key) {
          await saveFile(d.storage_key, buf, d.content_type || "application/octet-stream", d.file_name);
          const keys = await renderPreview(String(req.params.id), buf, d.file_name || "doc.pdf", d.storage_key).catch(() => []);
          await pool.query(`UPDATE studio_documents SET preview_keys=$2::jsonb, version=version+1, updated_at=now() WHERE id=$1`, [req.params.id, JSON.stringify(keys)]);
        }
      }
      res.json({ error: 0 });
    } catch (e: any) { console.error("[documents] oo-callback:", e?.message); res.json({ error: 0 }); }
  });
}
