// Investment Research (Jack, 2026-11-17): "a research tab alongside tracker,
// requirements, comps ... I usually save down relevant documents ... file it
// by sector, retail parks, London office, London retail etc ... just simple
// file down system", and "hopefully it can help feed the app with market
// intel".
//
// Each file is a row in knowledge_base (source 'investment-research',
// category = the sector: a tracker class, or "General"), the store
// ChatBGP's search_knowledge_base already reads, so a saved report is
// market intel ChatBGP can quote. The file itself sits in file_storage.
// The text of a PDF or a plain text file is kept in `content` for that
// search; other files are filed by name only. BGP staff only: every route
// refuses a client login (search_knowledge_base is on CLIENT_BLOCKED_TOOLS).
import type { Express, Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { saveFile, getFile, deleteFile } from "./file-storage";
import { TRACKER_CLASSES } from "@shared/tracker-class";
import { RESEARCH_AUTO, researchSectorFor } from "@shared/research-sector";
import { researchPublishedOn, pdfInfoDate } from "@shared/research-date";

export const RESEARCH_SOURCE = "investment-research";
export const RESEARCH_SECTORS: string[] = ["General", ...TRACKER_CLASSES];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 20 } });

const sectorOf = (v: unknown) => {
  const s = String(v || "").trim();
  return RESEARCH_SECTORS.find((k) => k.toLowerCase() === s.toLowerCase()) || "General";
};

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  const { isClientRequestUser } = await import("./company-scope");
  if (await isClientRequestUser(req)) { res.status(403).json({ error: "Not available for client accounts" }); return false; }
  return true;
}

async function runOnPdf(buffer: Buffer, cmd: string, args: string[]): Promise<string> {
  const fsp = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "research-"));
  try {
    const file = path.join(dir, "f.pdf");
    await fsp.writeFile(file, buffer);
    return await new Promise<string>((resolve) => {
      execFile(cmd, [...args, file, ...(cmd === "pdftotext" ? ["-"] : [])], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out || "")));
    });
  } catch { return ""; } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const pdfText = (buffer: Buffer) => runOnPdf(buffer, "pdftotext", ["-l", "60"]);
const isPdf = (name: string, type?: string | null) => type === "application/pdf" || /\.pdf$/i.test(name);

// The date the report was published (shared/research-date.ts), kept in
// last_modified; ai_tags[1] = "dated" marks a row whose date has been worked
// out ("undated": nothing found, so the upload date stands).
async function publishedOn(fileName: string, buffer: Buffer | null, type: string | null, text: string | null): Promise<Date | null> {
  const pdfDate = buffer && isPdf(fileName, type) ? pdfInfoDate(await runOnPdf(buffer, "pdfinfo", [])) : null;
  return researchPublishedOn(fileName, text, pdfDate);
}
const tagsFor = (addedBy: string | null, published: Date | null) => [addedBy || "", published ? "dated" : "undated"];

let dating: Promise<void> | null = null;
// Files saved before the date was read (the first batch of 17 November) are
// dated once, on the first read of the list after this shipped.
async function dateOlderFiles(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, file_name, file_path, left(content, 1500) AS cover, ai_tags, indexed_at FROM knowledge_base
      WHERE source = $1 AND NOT (coalesce(ai_tags, '{}') && ARRAY['dated','undated'])`, [RESEARCH_SOURCE]);
  for (const r of rows) {
    try {
      const f = isPdf(r.file_name) ? await getFile(r.file_path) : null;
      const published = await publishedOn(r.file_name, f?.data || null, f?.contentType || null, r.cover);
      await pool.query(`UPDATE knowledge_base SET last_modified = $2, ai_tags = $3 WHERE id = $1`,
        [r.id, published || r.indexed_at, tagsFor((r.ai_tags || [])[0] || null, published)]);
    } catch (e: any) { console.warn("[investment-research] dating failed:", r.file_name, e?.message); }
  }
}

async function readText(file: Express.Multer.File): Promise<string | null> {
  const name = file.originalname.toLowerCase();
  let text = "";
  if (isPdf(name, file.mimetype)) text = await pdfText(file.buffer);
  else if (/^text\//.test(file.mimetype) || /\.(txt|csv|md)$/.test(name)) text = file.buffer.toString("utf8");
  text = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text.slice(0, 400_000) : null;
}

const row = (r: any) => ({
  id: r.id, fileName: r.file_name, sector: r.category || "General", note: r.summary || null,
  sizeBytes: r.size_bytes ?? null, addedAt: r.indexed_at, addedBy: (r.ai_tags || [])[0] || null,
  publishedAt: (r.ai_tags || []).includes("dated") ? r.last_modified : null,
  readable: !!r.has_text,
});

export function registerInvestmentResearchRoutes(app: Express) {
  app.get("/api/investment-research", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    if (!dating) dating = dateOlderFiles().catch((e) => { console.warn("[investment-research] dating:", e?.message); });
    await dating;
    const { rows } = await pool.query(
      `SELECT id, file_name, category, summary, size_bytes, indexed_at, last_modified, ai_tags, (content IS NOT NULL AND content <> '') AS has_text
         FROM knowledge_base WHERE source = $1 ORDER BY last_modified DESC NULLS LAST, indexed_at DESC`, [RESEARCH_SOURCE]);
    res.json({ sectors: RESEARCH_SECTORS, files: rows.map(row) });
  });

  app.post("/api/investment-research", requireAuth, upload.array("files", 20), async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: "Choose at least one file" });
    // "auto" (Choose for me, the default) files each document by its name and
    // text (shared/research-sector.ts); a sector the person picked is kept.
    const auto = !req.body?.sector || String(req.body.sector).toLowerCase() === RESEARCH_AUTO;
    const picked = sectorOf(req.body?.sector);
    const note = String(req.body?.note || "").trim().slice(0, 2000) || null;
    const userId = (req as any).session?.userId || (req as any).tokenUserId || null;
    const { rows: [u] } = userId ? await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]) : { rows: [] as any[] };
    const saved: any[] = [];
    for (const f of files) {
      const key = `${RESEARCH_SOURCE}/${randomUUID()}-${f.originalname.replace(/[^\w.\- ]+/g, "_")}`;
      await saveFile(key, f.buffer, f.mimetype || "application/octet-stream", f.originalname);
      const content = await readText(f);
      const published = await publishedOn(f.originalname, f.buffer, f.mimetype, content);
      const sector = auto ? researchSectorFor(f.originalname, [note, content].filter(Boolean).join("\n")) : picked;
      const { rows: [r] } = await pool.query(
        `INSERT INTO knowledge_base (file_name, file_path, summary, content, category, ai_tags, size_bytes, last_modified, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($9, now()), $8)
         RETURNING id, file_name, category, summary, size_bytes, indexed_at, last_modified, ai_tags, (content IS NOT NULL AND content <> '') AS has_text`,
        [f.originalname, key, note, content, sector, tagsFor(u?.name || null, published), f.size, RESEARCH_SOURCE, published]);
      saved.push(row(r));
    }
    res.json({ files: saved });
  });

  app.patch("/api/investment-research/:id", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const sets: string[] = []; const vals: any[] = [req.params.id, RESEARCH_SOURCE];
    if (req.body?.sector !== undefined) { vals.push(sectorOf(req.body.sector)); sets.push(`category = $${vals.length}`); }
    if (req.body?.note !== undefined) { vals.push(String(req.body.note || "").trim().slice(0, 2000) || null); sets.push(`summary = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to change" });
    const { rows: [r] } = await pool.query(
      `UPDATE knowledge_base SET ${sets.join(", ")} WHERE id = $1 AND source = $2
       RETURNING id, file_name, category, summary, size_bytes, indexed_at, last_modified, ai_tags, (content IS NOT NULL AND content <> '') AS has_text`, vals);
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(row(r));
  });

  app.delete("/api/investment-research/:id", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const { rows: [r] } = await pool.query(`DELETE FROM knowledge_base WHERE id = $1 AND source = $2 RETURNING file_path`, [req.params.id, RESEARCH_SOURCE]);
    if (!r) return res.status(404).json({ error: "Not found" });
    await deleteFile(r.file_path).catch(() => {});
    res.json({ ok: true });
  });

  app.get("/api/investment-research/:id/file", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const { rows: [r] } = await pool.query(`SELECT file_name, file_path FROM knowledge_base WHERE id = $1 AND source = $2`, [req.params.id, RESEARCH_SOURCE]);
    if (!r) return res.status(404).json({ error: "Not found" });
    const f = await getFile(r.file_path);
    if (!f) return res.status(404).json({ error: "File missing" });
    const inline = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/.test(f.contentType);
    res.setHeader("Content-Type", inline ? f.contentType : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(r.file_name)}`);
    res.send(f.data);
  });
}
