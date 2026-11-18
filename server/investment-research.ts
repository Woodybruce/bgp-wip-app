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
// The text of a PDF, a Word, PowerPoint or Excel file or a plain text file is
// kept in `content` for that search. Each paper's key points are then read
// by server/investment-research-intel.ts (the feed and ChatBGP's
// get_market_research). BGP staff only: every route refuses a client login
// (search_knowledge_base is on CLIENT_BLOCKED_TOOLS).
import type { Express, Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { saveFile, getFile, deleteFile } from "./file-storage";
import { TRACKER_CLASSES } from "@shared/tracker-class";
import { RESEARCH_AUTO, researchSectorFor } from "@shared/research-sector";

export const RESEARCH_SOURCE = "investment-research";
export const RESEARCH_SECTORS: string[] = ["General", ...TRACKER_CLASSES];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 20 } });

// Jack added his first 59 files oldest-publication-last (10:39 to 10:58 UTC
// on 17 November 2026), so that batch is listed in the order he added it,
// flipped; everything added after it sits above, newest upload first.
const FIRST_BATCH_END = "2026-11-17T10:59:00Z";

const sectorOf = (v: unknown) => {
  const s = String(v || "").trim();
  return RESEARCH_SECTORS.find((k) => k.toLowerCase() === s.toLowerCase()) || "General";
};

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  const { isClientRequestUser } = await import("./company-scope");
  if (await isClientRequestUser(req)) { res.status(403).json({ error: "Not available for client accounts" }); return false; }
  return true;
}

export const isPdf = (name: string, type?: string | null) => type === "application/pdf" || /\.pdf$/i.test(name);

async function pdfText(buffer: Buffer): Promise<string> {
  const fsp = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "research-"));
  try {
    const file = path.join(dir, "f.pdf");
    await fsp.writeFile(file, buffer);
    return await new Promise<string>((resolve) => {
      execFile("pdftotext", ["-l", "60", file, "-"], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out || "")));
    });
  } catch { return ""; } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// The text of a file: pdftotext for a PDF, then the app's own reader
// (server/utils/file-extractor.ts: Word, PowerPoint, Excel, text, and OCR for
// a scanned PDF where OCR is set up). A scanned PDF with no OCR comes back
// empty here and is read from its pages by the research reader.
const READABLE = /\.(pdf|docx?|pptx|xlsx?|txt|csv|md)$/i;
const solid = (s: string) => s.replace(/\s+/g, "").length;
export async function textOf(buffer: Buffer, fileName: string, mimetype?: string | null): Promise<string | null> {
  const name = fileName.toLowerCase();
  let text = "";
  if (isPdf(name, mimetype)) text = await pdfText(buffer);
  else if (/^text\//.test(mimetype || "") || /\.(txt|csv|md)$/.test(name)) text = buffer.toString("utf8");
  if (solid(text) < 200 && READABLE.test(name)) {
    const fsp = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "research-"));
    try {
      const file = path.join(dir, `f${path.extname(name)}`);
      await fsp.writeFile(file, buffer);
      const { extractTextFromFile } = await import("./utils/file-extractor");
      const other = await extractTextFromFile(file, fileName).catch(() => "");
      if (solid(other) > solid(text)) text = other;
    } catch { /* keep what pdftotext gave */ } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  text = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text.slice(0, 400_000) : null;
}

const COLUMNS = `k.id, k.file_name, k.category, k.summary, k.size_bytes, k.indexed_at, k.ai_tags,
  (k.content IS NOT NULL AND k.content <> '') AS has_text,
  r.status AS read_status, r.published AS read_published, r.publisher AS read_publisher, r.headline AS read_headline,
  r.summary AS read_summary, r.outlook AS read_outlook, r.facts AS read_facts, r.error AS read_error`;

const row = (r: any) => ({
  id: r.id, fileName: r.file_name, sector: r.category || "General", note: r.summary || null,
  sizeBytes: r.size_bytes ?? null, addedAt: r.indexed_at, addedBy: (r.ai_tags || [])[0] || null,
  readable: !!r.has_text,
  keyPoints: r.read_status ? {
    status: r.read_status, published: r.read_published || null, publisher: r.read_publisher || null,
    headline: r.read_headline || null, summary: r.read_summary || null, outlook: r.read_outlook || null,
    facts: Array.isArray(r.read_facts) ? r.read_facts : [],
    error: r.read_error || null,
  } : null,
});

async function oneRow(id: string) {
  const { ensureReadsTable } = await import("./investment-research-intel");
  await ensureReadsTable();
  const { rows: [r] } = await pool.query(
    `SELECT ${COLUMNS} FROM knowledge_base k LEFT JOIN investment_research_reads r ON r.research_id = k.id
      WHERE k.id = $1 AND k.source = $2`, [id, RESEARCH_SOURCE]);
  return r ? row(r) : null;
}

export function registerInvestmentResearchRoutes(app: Express) {
  app.get("/api/investment-research", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const intel = await import("./investment-research-intel");
    await intel.ensureReadsTable();
    // Files not yet read (the first batch, or a read that never ran) are read
    // in the background, one at a time, under the reader's daily allowance.
    intel.readPendingResearch().catch((e) => console.warn("[investment-research] reading:", e?.message));
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM knowledge_base k LEFT JOIN investment_research_reads r ON r.research_id = k.id
        WHERE k.source = $1
        ORDER BY (k.indexed_at > $2) DESC,
                 CASE WHEN k.indexed_at > $2 THEN k.indexed_at END DESC,
                 k.indexed_at ASC`, [RESEARCH_SOURCE, FIRST_BATCH_END]);
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
      const content = await textOf(f.buffer, f.originalname, f.mimetype);
      const sector = auto ? researchSectorFor(f.originalname, [note, content].filter(Boolean).join("\n")) : picked;
      const { rows: [r] } = await pool.query(
        `INSERT INTO knowledge_base (file_name, file_path, summary, content, category, ai_tags, size_bytes, last_modified, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
         RETURNING id, file_name, category, summary, size_bytes, indexed_at, ai_tags, (content IS NOT NULL AND content <> '') AS has_text`,
        [f.originalname, key, note, content, sector, u?.name ? [u.name] : null, f.size, RESEARCH_SOURCE]);
      saved.push(row(r));
    }
    import("./investment-research-intel")
      .then((m) => m.readResearchFiles(saved.map((s) => s.id), { fromUpload: true }))
      .catch((e) => console.warn("[investment-research] reading new files:", e?.message));
    res.json({ files: saved });
  });

  // Read a file's key points again (after a failed read, or a re-filed paper).
  app.post("/api/investment-research/:id/read", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const intel = await import("./investment-research-intel");
    const exists = await oneRow(String(req.params.id));
    if (!exists) return res.status(404).json({ error: "Not found" });
    const result = await intel.readResearchFile(String(req.params.id), { force: true });
    if (result === "allowance") return res.status(429).json({ error: "Today's allowance of research reads is used. Try again tomorrow." });
    res.json(await oneRow(String(req.params.id)));
  });

  app.patch("/api/investment-research/:id", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const sets: string[] = []; const vals: any[] = [String(req.params.id), RESEARCH_SOURCE];
    if (req.body?.sector !== undefined) { vals.push(sectorOf(req.body.sector)); sets.push(`category = $${vals.length}`); }
    if (req.body?.note !== undefined) { vals.push(String(req.body.note || "").trim().slice(0, 2000) || null); sets.push(`summary = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to change" });
    const { rowCount } = await pool.query(`UPDATE knowledge_base SET ${sets.join(", ")} WHERE id = $1 AND source = $2`, vals);
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.json(await oneRow(String(req.params.id)));
  });

  app.delete("/api/investment-research/:id", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const { rows: [r] } = await pool.query(`DELETE FROM knowledge_base WHERE id = $1 AND source = $2 RETURNING file_path`, [String(req.params.id), RESEARCH_SOURCE]);
    if (!r) return res.status(404).json({ error: "Not found" });
    await deleteFile(r.file_path).catch(() => {});
    await import("./investment-research-intel").then((m) => m.forgetResearchFile(String(req.params.id))).catch(() => {});
    res.json({ ok: true });
  });

  app.get("/api/investment-research/:id/file", requireAuth, async (req, res) => {
    if (!(await staffOnly(req, res))) return;
    const { rows: [r] } = await pool.query(`SELECT file_name, file_path FROM knowledge_base WHERE id = $1 AND source = $2`, [String(req.params.id), RESEARCH_SOURCE]);
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
