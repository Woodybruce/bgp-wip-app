// ─────────────────────────────────────────────────────────────────────────
// Scheme evidence plans (Pete Wood / Brent Cross, 2026-09-02).
//
// An interactive replacement for the annotated-PowerPoint evidence plan:
// a background scheme plan (PDF/image from the landlord's agents) with
// unit outlines drawn once on top. Each unit carries (a) tenancy-schedule
// facts imported from the landlord's TS export (lease expiry, break, next
// review, ERV, passing rent) and (b) rental-evidence entries (Zone A
// analysis) typed in or AI-extracted from TAF PDFs. Swapping in an
// updated background plan keeps every outline and its data (Pete:
// "ability to add new scheme plan when tenants change").
//
// Geometry is stored NORMALISED (0..1 against the background image) so a
// re-uploaded plan at a different resolution keeps outlines in place as
// long as the drawing itself hasn't moved.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import multer from "multer";
import ExcelJS from "exceljs";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { saveFile, getFile } from "./file-storage";
import { rasterisePdfPage } from "./pdf-image-extract";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

pool.query(`
  CREATE TABLE IF NOT EXISTS evidence_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    property_id VARCHAR,
    background_key TEXT,
    background_width INT,
    background_height INT,
    created_by VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(() => {});
pool.query(`
  CREATE TABLE IF NOT EXISTS evidence_plan_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    unit_ref TEXT NOT NULL,
    tenant_name TEXT,
    polygon JSONB,
    lease_expiry DATE,
    break_date DATE,
    review_date DATE,
    erv NUMERIC,
    passing_rent NUMERIC,
    sqft NUMERIC,
    notes TEXT,
    ts_matched_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(() => {});
pool.query(`
  CREATE TABLE IF NOT EXISTS evidence_plan_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    unit_id UUID,
    unit_ref TEXT,
    tenant TEXT,
    transaction_type TEXT,
    transaction_date DATE,
    size_sqft NUMERIC,
    zone_a NUMERIC,
    itza NUMERIC,
    headline_rent NUMERIC,
    net_effective NUMERIC,
    term TEXT,
    concession TEXT,
    notes TEXT,
    source_key TEXT,
    created_by VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(() => {});

// ── Unit-ref normalisation ────────────────────────────────────────────────
// The TS says "Unit A01", the plan says "A1", a TAF says "Unit E7A". One
// canonical form so they all meet: uppercase, strip "unit"/"store" words,
// drop leading zeros inside letter-digit tokens ("A01" → "A1").
export function normaliseUnitRef(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/\b(UNIT|STORE|SHOP)\b/g, " ")
    .replace(/[^A-Z0-9/&-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(tok => tok.replace(/([A-Z]+)0+(\d)/g, "$1$2"))
    .join(" ")
    .trim();
}

async function planOr404(planId: string, res: Response): Promise<any | null> {
  const { rows } = await pool.query(`SELECT * FROM evidence_plans WHERE id = $1`, [planId]);
  if (!rows[0]) { res.status(404).json({ error: "Plan not found" }); return null; }
  return rows[0];
}

// Background upload: accepts a PDF (first page rendered at 200dpi) or an
// image, stores as PNG/JPEG in file_storage with recorded dimensions.
async function storeBackground(planId: string, file: Express.Multer.File): Promise<{ key: string; width: number; height: number }> {
  let buf = file.buffer;
  let mime = file.mimetype || "application/octet-stream";
  if (/pdf/i.test(mime) || /\.pdf$/i.test(file.originalname || "")) {
    const page = await rasterisePdfPage({ pdfBuffer: file.buffer, page: 1, dpi: 200 });
    if (!page) throw new Error("Couldn't render the PDF — is it a valid plan?");
    buf = page;
    mime = "image/jpeg";
  } else if (!/^image\//.test(mime)) {
    throw new Error("Background must be a PDF or an image");
  }
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buf).metadata();
  const width = meta.width || 0, height = meta.height || 0;
  if (!width || !height) throw new Error("Couldn't read the plan image dimensions");
  const key = `evidence-plans/${planId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${mime === "image/jpeg" ? "jpg" : "png"}`;
  await saveFile(key, buf, mime, file.originalname);
  return { key, width, height };
}

// ── Plans ────────────────────────────────────────────────────────────────
router.get("/api/evidence-plans", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*,
             (SELECT count(*)::int FROM evidence_plan_units u WHERE u.plan_id = p.id) AS unit_count,
             (SELECT count(*)::int FROM evidence_plan_entries e WHERE e.plan_id = p.id) AS evidence_count
        FROM evidence_plans p ORDER BY p.updated_at DESC`);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/api/evidence-plans", requireAuth, upload.single("background"), async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    const userId = (req as any).session?.userId || null;
    const { rows } = await pool.query(
      `INSERT INTO evidence_plans (name, property_id, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [name, req.body?.propertyId || null, userId]);
    let plan = rows[0];
    if (req.file) {
      const bg = await storeBackground(plan.id, req.file);
      const upd = await pool.query(
        `UPDATE evidence_plans SET background_key=$1, background_width=$2, background_height=$3, updated_at=now() WHERE id=$4 RETURNING *`,
        [bg.key, bg.width, bg.height, plan.id]);
      plan = upd.rows[0];
    }
    res.json(plan);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/api/evidence-plans/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const [units, entries] = await Promise.all([
      pool.query(`SELECT * FROM evidence_plan_units WHERE plan_id = $1 ORDER BY unit_ref`, [plan.id]),
      pool.query(`SELECT * FROM evidence_plan_entries WHERE plan_id = $1 ORDER BY transaction_date DESC NULLS LAST, created_at DESC`, [plan.id]),
    ]);
    res.json({ plan, units: units.rows, entries: entries.rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Swap the background — outlines and data stay (Pete's "new scheme plan
// when tenants change"). Old image is kept in file_storage for history.
router.post("/api/evidence-plans/:id/background", requireAuth, upload.single("background"), async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const bg = await storeBackground(plan.id, req.file);
    const upd = await pool.query(
      `UPDATE evidence_plans SET background_key=$1, background_width=$2, background_height=$3, updated_at=now() WHERE id=$4 RETURNING *`,
      [bg.key, bg.width, bg.height, plan.id]);
    res.json(upd.rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/api/evidence-plans/:id/background", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan?.background_key) return plan ? res.status(404).json({ error: "No background uploaded" }) : undefined;
    const file = await getFile(plan.background_key);
    if (!file) return res.status(404).json({ error: "Background image missing" });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(file.data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete("/api/evidence-plans/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    await pool.query(`DELETE FROM evidence_plan_entries WHERE plan_id = $1`, [plan.id]);
    await pool.query(`DELETE FROM evidence_plan_units WHERE plan_id = $1`, [plan.id]);
    await pool.query(`DELETE FROM evidence_plans WHERE id = $1`, [plan.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Units ────────────────────────────────────────────────────────────────
router.post("/api/evidence-plans/:id/units", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const unitRef = String(req.body?.unitRef || "").trim();
    if (!unitRef) return res.status(400).json({ error: "unitRef is required" });
    const { rows } = await pool.query(
      `INSERT INTO evidence_plan_units (plan_id, unit_ref, tenant_name, polygon) VALUES ($1, $2, $3, $4) RETURNING *`,
      [plan.id, unitRef, req.body?.tenantName || null, JSON.stringify(req.body?.polygon || null)]);
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]);
    res.json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

const UNIT_FIELDS: Record<string, string> = {
  unitRef: "unit_ref", tenantName: "tenant_name", polygon: "polygon",
  leaseExpiry: "lease_expiry", breakDate: "break_date", reviewDate: "review_date",
  erv: "erv", passingRent: "passing_rent", sqft: "sqft", notes: "notes",
};

router.put("/api/evidence-plans/units/:unitId", requireAuth, async (req: Request, res: Response) => {
  try {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, col] of Object.entries(UNIT_FIELDS)) {
      if (!(k in (req.body || {}))) continue;
      vals.push(k === "polygon" ? JSON.stringify(req.body[k]) : (req.body[k] === "" ? null : req.body[k]));
      sets.push(`${col} = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });
    vals.push(String(req.params.unitId));
    const { rows } = await pool.query(
      `UPDATE evidence_plan_units SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: "Unit not found" });
    res.json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete("/api/evidence-plans/units/:unitId", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`UPDATE evidence_plan_entries SET unit_id = NULL WHERE unit_id = $1`, [String(req.params.unitId)]);
    await pool.query(`DELETE FROM evidence_plan_units WHERE id = $1`, [String(req.params.unitId)]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Evidence entries ─────────────────────────────────────────────────────
const ENTRY_FIELDS: Record<string, string> = {
  unitId: "unit_id", unitRef: "unit_ref", tenant: "tenant",
  transactionType: "transaction_type", transactionDate: "transaction_date",
  sizeSqft: "size_sqft", zoneA: "zone_a", itza: "itza",
  headlineRent: "headline_rent", netEffective: "net_effective",
  term: "term", concession: "concession", notes: "notes",
};

router.post("/api/evidence-plans/:id/entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const cols: string[] = ["plan_id", "created_by"];
    const vals: any[] = [plan.id, (req as any).session?.userId || null];
    for (const [k, col] of Object.entries(ENTRY_FIELDS)) {
      if (!(k in (req.body || {})) || req.body[k] === "") continue;
      cols.push(col);
      vals.push(req.body[k]);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `INSERT INTO evidence_plan_entries (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`, vals);
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]);
    res.json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put("/api/evidence-plans/entries/:entryId", requireAuth, async (req: Request, res: Response) => {
  try {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, col] of Object.entries(ENTRY_FIELDS)) {
      if (!(k in (req.body || {}))) continue;
      vals.push(req.body[k] === "" ? null : req.body[k]);
      sets.push(`${col} = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });
    vals.push(String(req.params.entryId));
    const { rows } = await pool.query(
      `UPDATE evidence_plan_entries SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: "Entry not found" });
    res.json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete("/api/evidence-plans/entries/:entryId", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM evidence_plan_entries WHERE id = $1`, [String(req.params.entryId)]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Tenancy-schedule import ──────────────────────────────────────────────
// Reads the landlord's TS export (xlsx), keeps only real retail demises,
// and fills each matching plan unit's five facts. Creates nothing: units
// come from the plan, the TS only enriches them (Pete: "only for the
// units shown on the plan").
router.post("/api/evidence-plans/:id/import-tenancy", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: "Workbook has no sheets" });

    // Find the header row by looking for the known column names.
    let headerRow = 0;
    const headers: Record<string, number> = {};
    ws.eachRow((row, rowNum) => {
      if (headerRow) return;
      const cells = (row.values as any[]).map(v => String(v?.richText?.map((t: any) => t.text).join("") ?? v ?? "").trim().toLowerCase());
      if (cells.some(c => c.includes("lease expiry")) && cells.some(c => c.includes("demise") || c.includes("unit"))) {
        headerRow = rowNum;
        cells.forEach((c, i) => { if (c) headers[c] = i; });
      }
    });
    if (!headerRow) return res.status(400).json({ error: "Couldn't find the header row (expected columns like 'Lease Expiry Date')" });

    const col = (needle: string): number | null => {
      const hit = Object.keys(headers).find(h => h.includes(needle));
      return hit != null ? headers[hit] : null;
    };
    const cUnit = col("unit description") ?? col("demise reference");
    const cTenant = col("tenant trade name");
    const cTenantName = col("tenant name");
    const cType = col("demise type");
    const cSqft = col("demise area");
    const cExpiry = col("lease expiry");
    const cErv = col("erv");
    const cPassing = col("passing rent");
    const cBreak = col("next effective break");
    const cReview = col("first unsettled review");
    if (cUnit == null || cExpiry == null) return res.status(400).json({ error: "Missing unit / lease-expiry columns" });

    const { rows: units } = await pool.query(`SELECT id, unit_ref FROM evidence_plan_units WHERE plan_id = $1`, [plan.id]);
    const byNorm = new Map<string, any>();
    for (const u of units) byNorm.set(normaliseUnitRef(u.unit_ref), u);

    const toDate = (v: any): string | null => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(String(v));
      if (isNaN(d.getTime()) || d.getFullYear() > 2900) return null; // 2999 = "no expiry" placeholder
      return d.toISOString().slice(0, 10);
    };
    const toNum = (v: any): number | null => {
      const n = Number(String(v ?? "").replace(/[£,\s]/g, ""));
      return Number.isFinite(n) && n !== 0 ? n : null;
    };

    let matched = 0, skipped = 0;
    const unmatched: string[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const val = (i: number | null) => (i == null ? null : (row.values as any[])[i]);
      const unitDesc = String(val(cUnit) ?? "").trim();
      if (!unitDesc) continue;
      const demiseType = String(val(cType) ?? "").toLowerCase();
      // Commercialisation / ATM / storage / substation noise never reaches the plan.
      if (demiseType && !/retail|kiosk|restaurant|leisure|f&b|catering/.test(demiseType)) { skipped++; continue; }
      if (/commercialisation/.test(demiseType)) { skipped++; continue; }

      // A TS row can cover several plan units ("Unit A02-A05", "A09/10"):
      // match on WHOLE tokens only — substring matching made "A1" swallow
      // "A13"/"A15" rows. Ranges expand (A2-A5 → A2 A3 A4 A5) and bare
      // numbers inherit the previous token's letter prefix (A9/10 → A10).
      const norm = normaliseUnitRef(unitDesc);
      const tokens: string[] = [];
      let lastPrefix = "";
      for (const rawTok of norm.split(/[\s/&]+/).filter(Boolean)) {
        const range = rawTok.match(/^([A-Z]+)(\d+)-(?:[A-Z]+)?(\d+)$/);
        if (range) {
          const [, pfx, a, b] = range;
          for (let k = Number(a); k <= Math.min(Number(b), Number(a) + 30); k++) tokens.push(`${pfx}${k}`);
          lastPrefix = range[1];
          continue;
        }
        const pfxMatch = rawTok.match(/^([A-Z]+)\d/);
        if (pfxMatch) lastPrefix = pfxMatch[1];
        tokens.push(rawTok);
        if (/^\d+$/.test(rawTok) && lastPrefix) tokens.push(`${lastPrefix}${Number(rawTok)}`);
      }
      const tokenSet = new Set(tokens);
      const hits = [...byNorm.entries()].filter(([n]) => n && (norm === n || tokenSet.has(n)));
      if (hits.length === 0) { if (unmatched.length < 40) unmatched.push(unitDesc); continue; }

      for (const [, unit] of hits) {
        await pool.query(
          `UPDATE evidence_plan_units SET
             tenant_name = COALESCE($1, tenant_name),
             sqft = COALESCE($2, sqft),
             lease_expiry = $3, break_date = $4, review_date = $5,
             erv = $6, passing_rent = $7,
             ts_matched_at = now(), updated_at = now()
           WHERE id = $8`,
          [String(val(cTenant) ?? val(cTenantName) ?? "").trim() || null,
           toNum(val(cSqft)), toDate(val(cExpiry)), toDate(val(cBreak)), toDate(val(cReview)),
           toNum(val(cErv)), toNum(val(cPassing)), unit.id]);
        matched++;
      }
    }
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]);
    res.json({ matched, skipped, unmatched });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── TAF ingestion (AI vision) ────────────────────────────────────────────
// Accepts a Transaction Analysis PDF — a single TAF or a multi-TAF tranche
// compilation (the tranches are scans with no text layer, so every page
// goes through vision). Each extracted analysis becomes an evidence entry,
// auto-linked to its plan unit when the unit ref matches.
const TAF_PROMPT = `These pages are "Transaction Analysis" sheets (TAFs) for retail units at a UK shopping centre. Each sheet covers ONE transaction: unit reference, tenant, transaction type (OML / lease renewal / rent review / re-gear), term, rent, concessions, and a Zone A / ITZA rental analysis.

Extract EVERY analysis sheet visible across these pages as JSON:
{"tafs": [{
  "unitRef": "E7A",                     // the unit reference only, e.g. "E7A", "N10" — strip the word "Unit"
  "tenant": "Hasty Tasty Pizza",
  "transactionType": "Lease Renewal",   // as written: OML / Lease Renewal / Rent Review / Re-gear etc.
  "transactionDate": "2021-11-04",      // ISO; term start or transaction date; 1st of month if day absent; null if absent
  "term": "5 years",
  "sizeSqft": 221,                      // Total Area (NIA sq ft)
  "itza": 221,                          // Zone A area (ITZA) where stated
  "zoneA": 294.12,                      // headline £ Zone A rate psf where stated (or headline rate psf overall)
  "headlineRent": 65000,                // headline rent £pa
  "netEffective": 61750,                // net rent £pa after concessions where stated; null if absent
  "concession": "3 months rent free",
  "notes": "one-line remarks worth keeping"
}]}

Rules: numbers stripped of £/commas; null for anything not stated; one object per sheet even when a page holds several; skip cover pages. Respond with ONLY the JSON object.`;

router.post("/api/evidence-plans/:id/ingest-taf", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI extraction is not configured" });

    // A zip of TAFs (how the tranches arrive from Hammerson) works too —
    // every PDF inside is processed as if uploaded individually.
    const pdfs: { name: string; buffer: Buffer }[] = [];
    const isZip = /zip/i.test(req.file.mimetype || "") || /\.zip$/i.test(req.file.originalname || "");
    if (isZip) {
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(req.file.buffer);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !/\.pdf$/i.test(entry.entryName) || /__MACOSX|^\./.test(entry.entryName)) continue;
        pdfs.push({ name: entry.entryName.split("/").pop() || entry.entryName, buffer: entry.getData() });
        if (pdfs.length >= 60) break;
      }
      if (pdfs.length === 0) return res.status(400).json({ error: "No PDFs found inside that zip" });
    } else {
      pdfs.push({ name: req.file.originalname || "taf.pdf", buffer: req.file.buffer });
    }

    // Rasterise up to 40 pages per PDF, tagged with their source file so
    // each extracted entry links back to the right document.
    const pages: { buf: Buffer; sourceKey: string }[] = [];
    const sourceKeys = new Map<string, string>();
    for (const pdf of pdfs) {
      const sourceKey = `evidence-plans/${plan.id}/taf-${Date.now()}-${pdf.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60)}`;
      sourceKeys.set(pdf.name, sourceKey);
      await saveFile(sourceKey, pdf.buffer, "application/pdf", pdf.name);
      for (let p = 1; p <= 40; p++) {
        const buf = await rasterisePdfPage({ pdfBuffer: pdf.buffer, page: p, dpi: 150 });
        if (!buf) break;
        pages.push({ buf, sourceKey });
      }
    }
    const sourceKey = pdfs.length === 1 ? sourceKeys.get(pdfs[0].name)! : null;
    if (pages.length === 0) return res.status(400).json({ error: "Couldn't read any pages from that PDF" });

    // Batch within one source document at a time so every extracted entry
    // links back to the right PDF.
    const tafs: any[] = [];
    const byDoc = new Map<string, Buffer[]>();
    for (const p of pages) {
      if (!byDoc.has(p.sourceKey)) byDoc.set(p.sourceKey, []);
      byDoc.get(p.sourceKey)!.push(p.buf);
    }
    for (const [docKey, docPages] of byDoc) {
      for (let i = 0; i < docPages.length; i += 8) {
        const batch = docPages.slice(i, i + 8);
        const content: any[] = batch.map(b => ({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") },
        }));
        content.push({ type: "text", text: TAF_PROMPT });
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          messages: [{ role: "user", content }],
        });
        const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed.tafs)) tafs.push(...parsed.tafs.map((t: any) => ({ ...t, __sourceKey: docKey })));
          } catch { /* batch unparseable — carry on with the rest */ }
        }
      }
    }

    const { rows: units } = await pool.query(`SELECT id, unit_ref FROM evidence_plan_units WHERE plan_id = $1`, [plan.id]);
    const byNorm = new Map<string, any>();
    for (const u of units) byNorm.set(normaliseUnitRef(u.unit_ref), u);

    let created = 0;
    const userId = (req as any).session?.userId || null;
    for (const t of tafs) {
      if (!t || (!t.unitRef && !t.tenant)) continue;
      const unit = t.unitRef ? byNorm.get(normaliseUnitRef(String(t.unitRef))) : null;
      const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
      const date = (v: any) => { const d = new Date(String(v || "")); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
      await pool.query(
        `INSERT INTO evidence_plan_entries
           (plan_id, unit_id, unit_ref, tenant, transaction_type, transaction_date, size_sqft, zone_a, itza,
            headline_rent, net_effective, term, concession, notes, source_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [plan.id, unit?.id || null, t.unitRef ? String(t.unitRef).slice(0, 40) : null,
         t.tenant || null, t.transactionType || null, date(t.transactionDate),
         num(t.sizeSqft), num(t.zoneA), num(t.itza), num(t.headlineRent), num(t.netEffective),
         t.term || null, t.concession || null, t.notes || null, t.__sourceKey || sourceKey, userId]);
      created++;
    }
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]);
    res.json({ pages: pages.length, extracted: tafs.length, created, linked: tafs.filter(t => t.unitRef && byNorm.get(normaliseUnitRef(String(t.unitRef)))).length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Serve a stored TAF source PDF so an entry's analysis is one click from
// the original sheet.
router.get("/api/evidence-plans/source", requireAuth, async (req: Request, res: Response) => {
  try {
    const key = String(req.query.key || "");
    if (!key.startsWith("evidence-plans/")) return res.status(400).json({ error: "Bad key" });
    const file = await getFile(key);
    if (!file) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${(file.originalName || "taf.pdf").replace(/"/g, "")}"`);
    res.send(file.data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
