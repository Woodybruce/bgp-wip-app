// Every file on KYC4U's site, kept in the app (Woody, 21 November 2026: "yes
// build it so we keep all documents in the app"). The Send to ChatBGP
// bookmark, clicked on KYC4U's site, lists every file in its Documents
// library with the user's own login; its window (client/src/pages/
// kyc4u-import.tsx) sends the list here (/plan), then fetches each file still
// to copy from KYC4U's site and hands it here (/file), a few at a time. Each
// file is kept in the app's store; one in a request folder whose request is
// matched to a company (kyc4u_requests, a hand-set match first) is also
// filed on that company's KYC record. Nothing is sent to KYC4U and nothing
// there is changed. The rules shared with the window: shared/kyc4u-archive.ts.

import type { Express, Request, Response, RequestHandler } from "express";
import crypto from "crypto";
import multer from "./utils/upload";
import { pool } from "./db";
import { saveFile, getFile } from "./file-storage";
import { contentDispositionFor, uploadShownInline } from "./utils/http-headers";
import { kyc4uPackMime } from "@shared/kyc4u-result-pack";
import {
  KYC4U_ARCHIVE_LIST_MAX, KYC4U_ARCHIVE_MAX_BYTES, KYC4U_ARCHIVE_PARALLEL,
  archiveFileFacts, archiveKey, listedFileProblem, type Kyc4uArchiveTotals, type Kyc4uListedFile,
} from "@shared/kyc4u-archive";

const meOf = (req: Request): string | null => (req as any).session?.userId || (req as any).tokenUserId || null;
const nameOf = async (id: string | null): Promise<string | null> =>
  id ? (await pool.query(`SELECT name FROM users WHERE id = $1`, [id]).catch(() => ({ rows: [] as any[] }))).rows[0]?.name || null : null;
const safeName = (n: string) => String(n || "file").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-100) || "file";
const validDate = (v: unknown): string | null => { const d = v ? new Date(String(v)) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

// ── Filing on a company ─────────────────────────────────────────────────────

interface ArchiveRow {
  id: number; file_key: string; file_name: string; req_ref: string | null; req_entity: string | null;
  section: string | null; doc_type: string | null; storage_key: string | null; stored_size: number | null;
  mime_type: string | null; company_id: string | null; trading_entity_id: string | null;
  kyc_document_id: string | null; filed_new: boolean | null; copied_by: string | null;
}

// The company a request folder's files belong to: the KYC4U request with that
// reference (its own row, or a KYC4U result recorded in the app under that
// reference), matched by hand first, then the one read from KYC4U's library.
const REQUEST_COMPANY_SQL = `
  SELECT COALESCE(q.company_id_manual, q.company_id) AS company_id, q.trading_entity_id
    FROM kyc4u_requests q
   WHERE (upper(q.item_id) = upper($1) OR upper(q.fields->>'Reference') = upper($1))
     AND COALESCE(q.company_id_manual, q.company_id) IS NOT NULL
   ORDER BY (q.company_id_manual IS NOT NULL) DESC, (q.list_id LIKE '%:requests') DESC, q.synced_at DESC NULLS LAST
   LIMIT 1`;

async function requestCompany(reqRef: string | null): Promise<{ companyId: string; entityId: string | null } | null> {
  if (!reqRef) return null;
  const r = (await pool.query(REQUEST_COMPANY_SQL, [reqRef])).rows[0];
  return r?.company_id ? { companyId: String(r.company_id), entityId: r.trading_entity_id ? String(r.trading_entity_id) : null } : null;
}

async function dealFor(reqRef: string | null): Promise<string | null> {
  if (!reqRef) return null;
  return (await pool.query(
    `SELECT deal_id FROM kyc4u_drafts WHERE (request_item_id = $1 OR upper(submitted_ref) = upper($1)) AND deal_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [reqRef]).catch(() => ({ rows: [] as any[] }))).rows[0]?.deal_id || null;
}

/**
 * Files one kept file on a company's KYC record. A document the company
 * already has (the same name and size: KYC4U's pack added by hand, or the
 * automatic sync's copy) is linked rather than filed twice.
 */
async function fileOnCompany(row: ArchiveRow, target: { companyId: string; entityId: string | null }): Promise<"filed" | "linked"> {
  const size = Number(row.stored_size || 0);
  const dup = (await pool.query(
    `SELECT id FROM kyc_documents WHERE company_id = $1 AND file_name = $2 AND file_size = $3 AND deleted_at IS NULL ORDER BY uploaded_at LIMIT 1`,
    [target.companyId, row.file_name, size])).rows[0];
  const dealId = await dealFor(row.req_ref);
  if (dup) {
    await pool.query(
      `UPDATE kyc4u_archive_files SET company_id = $2, trading_entity_id = $3, deal_id = $4, kyc_document_id = $5, filed_new = false, filed_at = NOW() WHERE id = $1`,
      [row.id, target.companyId, target.entityId, dealId, dup.id]);
    return "linked";
  }
  const by = await nameOf(row.copied_by);
  const notes = `From KYC4U ${row.req_ref}${row.req_entity ? ` (${row.req_entity})` : ""}${row.section ? `, ${row.section}` : ""}: copied from KYC4U's site${by ? ` by ${by}` : ""}`;
  const doc = (await pool.query(
    `INSERT INTO kyc_documents (company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [target.companyId, target.entityId, dealId, row.doc_type || "kyc4u_document", `/api/${row.storage_key}`, row.file_name, size,
      row.mime_type, notes.slice(0, 1000), row.copied_by])).rows[0];
  await pool.query(
    `UPDATE kyc4u_archive_files SET company_id = $2, trading_entity_id = $3, deal_id = $4, kyc_document_id = $5, filed_new = true, filed_at = NOW() WHERE id = $1`,
    [row.id, target.companyId, target.entityId, dealId, doc.id]);
  return "filed";
}

/**
 * Files the kept files whose request is now matched to a company (after the
 * bookmark brings the requests in again, or someone matches one by hand), and
 * moves the ones filed on a company the request is no longer matched to.
 */
export async function refileKyc4uArchive(opts: { reqRef?: string | null } = {}): Promise<{ filed: number; moved: number }> {
  const out = { filed: 0, moved: 0 };
  const rows = (await pool.query(
    `SELECT a.*, r.company_id AS r_company, r.trading_entity_id AS r_entity
       FROM kyc4u_archive_files a
       JOIN LATERAL (
         SELECT COALESCE(q.company_id_manual, q.company_id) AS company_id, q.trading_entity_id
           FROM kyc4u_requests q
          WHERE (upper(q.item_id) = upper(a.req_ref) OR upper(q.fields->>'Reference') = upper(a.req_ref))
            AND COALESCE(q.company_id_manual, q.company_id) IS NOT NULL
          ORDER BY (q.company_id_manual IS NOT NULL) DESC, (q.list_id LIKE '%:requests') DESC, q.synced_at DESC NULLS LAST
          LIMIT 1) r ON true
      WHERE a.status = 'copied' AND a.req_ref IS NOT NULL
        AND ($1::text IS NULL OR upper(a.req_ref) = upper($1))
        AND (a.company_id IS DISTINCT FROM r.company_id OR a.trading_entity_id IS DISTINCT FROM r.trading_entity_id)
      ORDER BY a.id LIMIT 20000`, [opts.reqRef || null])).rows;
  for (const row of rows) {
    const target = { companyId: String(row.r_company), entityId: row.r_entity ? String(row.r_entity) : null };
    try {
      if (row.company_id && row.kyc_document_id && row.filed_new) {
        // Filed by this copy: the document follows the request to its company.
        await pool.query(`UPDATE kyc_documents SET company_id = $2, trading_entity_id = $3 WHERE id = $1`, [row.kyc_document_id, target.companyId, target.entityId]);
        await pool.query(`UPDATE kyc4u_archive_files SET company_id = $2, trading_entity_id = $3, filed_at = NOW() WHERE id = $1`, [row.id, target.companyId, target.entityId]);
        out.moved++;
      } else {
        await fileOnCompany(row, target);
        out.filed++;
      }
    } catch (e: any) {
      console.warn(`[kyc4u-archive] filing ${row.file_key} failed:`, e?.message);
    }
  }
  if (out.filed || out.moved) console.log(`[kyc4u-archive] filed ${out.filed}, moved ${out.moved}${opts.reqRef ? ` (${opts.reqRef})` : ""}`);
  return out;
}

// ── Summary ─────────────────────────────────────────────────────────────────

export async function archiveTotals(): Promise<Kyc4uArchiveTotals & { lastCopiedAt: string | null; lastCopiedBy: string | null }> {
  const r = (await pool.query(
    `SELECT COUNT(*)::int AS listed,
            COUNT(*) FILTER (WHERE status = 'copied')::int AS copied,
            COUNT(*) FILTER (WHERE status IN ('listed','failed'))::int AS to_go,
            COUNT(*) FILTER (WHERE status = 'too_large')::int AS too_large,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE status = 'copied' AND company_id IS NOT NULL)::int AS filed,
            COUNT(*) FILTER (WHERE status = 'copied' AND company_id IS NULL AND req_ref IS NOT NULL)::int AS not_matched,
            COUNT(*) FILTER (WHERE status = 'copied' AND req_ref IS NULL)::int AS no_request,
            COALESCE(SUM(stored_size) FILTER (WHERE status = 'copied'), 0)::bigint AS bytes,
            MAX(copied_at) AS last_at
       FROM kyc4u_archive_files`)).rows[0] || {};
  const last = r.last_at ? (await pool.query(
    `SELECT u.name FROM kyc4u_archive_files a LEFT JOIN users u ON u.id = a.copied_by WHERE a.copied_at IS NOT NULL ORDER BY a.copied_at DESC LIMIT 1`)).rows[0] : null;
  return {
    listed: r.listed || 0, copied: r.copied || 0, toGo: r.to_go || 0, tooLarge: r.too_large || 0, failed: r.failed || 0,
    filed: r.filed || 0, notMatched: r.not_matched || 0, noRequest: r.no_request || 0, bytes: Number(r.bytes || 0),
    lastCopiedAt: r.last_at ? new Date(r.last_at).toISOString() : null, lastCopiedBy: last?.name || null,
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerKyc4uArchiveRoutes(app: Express, requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  // The bookmark's list of every file on KYC4U's site. Keeps each new file
  // version on the list and answers which still need copying.
  app.post("/api/kyc4u/archive/plan", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const given: Kyc4uListedFile[] = Array.isArray(req.body?.files) ? req.body.files.slice(0, KYC4U_ARCHIVE_LIST_MAX) : [];
      const seen = new Set<string>();
      const rows: Array<{ key: string; f: Kyc4uListedFile; facts: ReturnType<typeof archiveFileFacts> }> = [];
      let refused = 0;
      for (const f of given) {
        if (!f || typeof f !== "object" || listedFileProblem(f)) { refused++; continue; }
        const key = archiveKey(f);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ key, f, facts: archiveFileFacts(f.path) });
      }
      for (let i = 0; i < rows.length; i += 1000) {
        const part = rows.slice(i, i + 1000);
        const col = <T,>(fn: (r: (typeof part)[number]) => T) => part.map(fn);
        await pool.query(
          `INSERT INTO kyc4u_archive_files (file_key, unique_id, web_url, file_ref, file_name, req_ref, req_entity, section, doc_type, size, modified_at, created_at_source)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::bigint[], $11::timestamptz[], $12::timestamptz[])
           ON CONFLICT (file_key) DO UPDATE SET listed_at = NOW(), web_url = COALESCE(EXCLUDED.web_url, kyc4u_archive_files.web_url),
             file_ref = EXCLUDED.file_ref, file_name = EXCLUDED.file_name, size = COALESCE(EXCLUDED.size, kyc4u_archive_files.size)`,
          [col(r => r.key), col(r => r.f.uniqueId ? String(r.f.uniqueId).slice(0, 80) : null), col(r => r.f.web ? String(r.f.web).slice(0, 500) : null),
            col(r => String(r.f.path)), col(r => String(r.f.name || r.f.path.split("/").pop() || "file").slice(0, 300)),
            col(r => r.facts.reqRef), col(r => r.facts.entity ? r.facts.entity.slice(0, 300) : null), col(r => r.facts.place.heading.slice(0, 300)),
            col(r => r.facts.place.docType), col(r => (Number.isFinite(Number(r.f.size)) && r.f.size != null ? Math.max(0, Math.round(Number(r.f.size))) : null)),
            col(r => validDate(r.f.modified)), col(r => validDate(r.f.created))]);
      }
      const keys = rows.map(r => r.key);
      await pool.query(
        `UPDATE kyc4u_archive_files SET status = 'too_large', error = 'Over 25 MB: download it from KYC4U''s site by hand'
          WHERE file_key = ANY($1::text[]) AND status IN ('listed','failed') AND size > $2`, [keys, KYC4U_ARCHIVE_MAX_BYTES]);
      const todo = (await pool.query(
        `SELECT file_key AS key, file_ref AS path, web_url AS web, file_name AS name, size FROM kyc4u_archive_files
          WHERE file_key = ANY($1::text[]) AND status IN ('listed','failed') ORDER BY req_ref NULLS LAST, file_ref`, [keys])).rows;
      const counts = (await pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'copied')::int AS held, COUNT(*) FILTER (WHERE status = 'too_large')::int AS too_large
           FROM kyc4u_archive_files WHERE file_key = ANY($1::text[])`, [keys])).rows[0];
      res.json({ listed: rows.length, refused, held: counts.held, tooLarge: counts.too_large, toCopy: todo, max: KYC4U_ARCHIVE_MAX_BYTES, parallel: KYC4U_ARCHIVE_PARALLEL });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // One file from KYC4U's site, fetched by the bookmark and handed over by its window.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: KYC4U_ARCHIVE_MAX_BYTES, files: 1 } });
  const takeFile: RequestHandler = (req, res, next) => upload.single("file")(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Over 25 MB", tooLarge: true });
    return res.status(400).json({ message: err?.message || "That file could not be read" });
  });
  app.post("/api/kyc4u/archive/file", requireAuth, requireAdmin, takeFile, async (req: Request, res: Response) => {
    try {
      const key = String(req.body?.key || "");
      const row: ArchiveRow & { status: string } | undefined = (await pool.query(`SELECT * FROM kyc4u_archive_files WHERE file_key = $1`, [key])).rows[0];
      if (!row) return res.status(404).json({ message: "That file is not on the list from KYC4U's site: click the bookmark on their site again" });
      if (row.status === "copied") return res.json({ already: true, filed: !!row.company_id });
      const file = (req as any).file as { buffer: Buffer; mimetype?: string } | undefined;
      if (!file?.buffer?.length) return res.status(400).json({ message: "The file came through empty" });
      const me = meOf(req);
      const stored = `chat-media/kyc4u-arc-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 20)}-${safeName(row.file_name)}`;
      const given = String(file.mimetype || "").split(";")[0].trim().toLowerCase();
      const mime = kyc4uPackMime(row.file_name) || (given && given !== "application/octet-stream" ? given : null) || "application/octet-stream";
      await saveFile(stored, file.buffer, mime, row.file_name);
      const saved: ArchiveRow = (await pool.query(
        `UPDATE kyc4u_archive_files SET status = 'copied', error = NULL, storage_key = $2, stored_size = $3, mime_type = $4, copied_at = NOW(), copied_by = $5
          WHERE id = $1 RETURNING *`, [row.id, stored, file.buffer.length, mime, me])).rows[0];
      const target = await requestCompany(saved.req_ref);
      const filed = target ? await fileOnCompany(saved, target) : null;
      res.json({ copied: true, filed: !!filed });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // A file the bookmark could not hand over: too large, or KYC4U's site refused it.
  app.post("/api/kyc4u/archive/missed", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const key = String(req.body?.key || "");
      const tooLarge = req.body?.reason === "too_large";
      const size = Number(req.body?.size);
      const r = await pool.query(
        `UPDATE kyc4u_archive_files SET status = $2, error = $3, size = COALESCE($4, size) WHERE file_key = $1 AND status <> 'copied'`,
        [key, tooLarge ? "too_large" : "failed", tooLarge ? "Over 25 MB: download it from KYC4U's site by hand" : String(req.body?.reason || "KYC4U's site did not send it").slice(0, 300),
          Number.isFinite(size) && size > 0 ? Math.round(size) : null]);
      res.json({ ok: !!r.rowCount });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // The KYC4U page's card: how much is kept, the request folders not matched
  // yet, and the files that could not be copied.
  app.get("/api/kyc4u/archive", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const totals = await archiveTotals();
      const folders = (await pool.query(
        `SELECT a.req_ref AS "ref", MAX(a.req_entity) AS entity, COUNT(*)::int AS files, COALESCE(SUM(a.stored_size), 0)::bigint AS bytes,
                (SELECT q.list_id FROM kyc4u_requests q WHERE upper(q.item_id) = upper(a.req_ref)
                  ORDER BY (q.list_id LIKE '%:requests') DESC, q.synced_at DESC NULLS LAST LIMIT 1) AS "listId"
           FROM kyc4u_archive_files a WHERE a.status = 'copied' AND a.company_id IS NULL AND a.req_ref IS NOT NULL
          GROUP BY a.req_ref ORDER BY a.req_ref DESC LIMIT 1000`)).rows.map((f: any) => ({ ...f, bytes: Number(f.bytes) }));
      const problems = (await pool.query(
        `SELECT id, file_name AS name, file_ref AS path, req_ref AS "ref", size, status, error FROM kyc4u_archive_files
          WHERE status IN ('too_large','failed') ORDER BY status DESC, file_ref LIMIT 300`)).rows;
      const outside = (await pool.query(
        `SELECT id, file_name AS name, file_ref AS path, stored_size AS size FROM kyc4u_archive_files
          WHERE status = 'copied' AND req_ref IS NULL ORDER BY file_ref LIMIT 300`)).rows;
      res.json({ totals, folders, problems, outside, max: KYC4U_ARCHIVE_MAX_BYTES });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // The files kept from one request folder.
  app.get("/api/kyc4u/archive/folder/:ref", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const rows = (await pool.query(
        `SELECT a.id, a.file_name AS name, a.section, a.status, a.stored_size AS size, a.modified_at AS "modifiedAt", a.company_id AS "companyId", c.name AS "companyName"
           FROM kyc4u_archive_files a LEFT JOIN crm_companies c ON c.id = a.company_id
          WHERE upper(a.req_ref) = upper($1) ORDER BY a.section NULLS FIRST, a.file_name LIMIT 2000`, [String(req.params.ref)])).rows;
      res.json({ ref: String(req.params.ref).toUpperCase(), files: rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // One kept file, to open. Never shown as a page.
  app.get("/api/kyc4u/archive/files/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const row = (await pool.query(`SELECT storage_key, file_name, mime_type FROM kyc4u_archive_files WHERE id = $1 AND status = 'copied'`, [Number(req.params.id) || 0])).rows[0];
      const file = row?.storage_key ? await getFile(row.storage_key) : null;
      if (!file) return res.status(404).json({ message: "Not kept in the app" });
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "private, no-store");
      res.set("Content-Type", file.contentType || "application/octet-stream");
      if (!uploadShownInline(file.contentType)) {
        res.set("Content-Security-Policy", "sandbox; default-src 'none'");
        res.set("Content-Disposition", contentDispositionFor(row.file_name || "file"));
      }
      res.send(file.data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // File again by hand (after matching requests to companies).
  app.post("/api/kyc4u/archive/refile", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try { res.json(await refileKyc4uArchive()); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
