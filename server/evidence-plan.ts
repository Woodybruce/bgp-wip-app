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
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
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
  )`).then(() => pool.query(`ALTER TABLE evidence_plans ADD COLUMN IF NOT EXISTS dot_colours JSONB`)).catch(() => {});
pool.query(`
  CREATE TABLE IF NOT EXISTS evidence_plan_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    total_docs INT NOT NULL DEFAULT 0,
    done_docs INT NOT NULL DEFAULT 0,
    pages INT NOT NULL DEFAULT 0,
    extracted INT NOT NULL DEFAULT 0,
    created INT NOT NULL DEFAULT 0,
    linked INT NOT NULL DEFAULT 0,
    error TEXT,
    created_by VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).then(() => pool.query(`ALTER TABLE evidence_plan_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'taf', ADD COLUMN IF NOT EXISTS level_id UUID`)).catch(() => {});
pool.query(`
  CREATE TABLE IF NOT EXISTS evidence_plan_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    name TEXT NOT NULL,
    background_key TEXT,
    background_width INT,
    background_height INT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(() => {});
pool.query(`
  CREATE TABLE IF NOT EXISTS evidence_plan_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL,
    level_id UUID,
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
  )`).then(() => pool.query(`ALTER TABLE evidence_plan_units ADD COLUMN IF NOT EXISTS level_id UUID, ADD COLUMN IF NOT EXISTS source TEXT, ADD COLUMN IF NOT EXISTS dot JSONB`)).catch(() => {});
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

// Adopt unlinked evidence whose ref matches a unit — so TAFs uploaded
// BEFORE the outlines are drawn snap onto each unit as it's drawn (Woody
// hit this on the first Brent Cross run: 55 extracted, 0 linked, no units
// yet). Also used on unit rename.
async function relinkEntriesToUnit(planId: string, unitId: string, unitRef: string): Promise<number> {
  const norm = normaliseUnitRef(unitRef);
  if (!norm) return 0;
  const { rows } = await pool.query(
    `SELECT id, unit_ref FROM evidence_plan_entries WHERE plan_id = $1 AND unit_id IS NULL AND unit_ref IS NOT NULL`, [planId]);
  const ids = rows.filter((r: any) => normaliseUnitRef(r.unit_ref) === norm).map((r: any) => r.id);
  if (ids.length) await pool.query(`UPDATE evidence_plan_entries SET unit_id = $1 WHERE id = ANY($2)`, [unitId, ids]);
  return ids.length;
}

// Tenant-name normalisation for evidence↔unit matching: plans often label
// a block with the trading name while TAFs carry the unit ref, so names
// are the join when refs don't meet.
const normTenantName = (s: any) => String(s || "").toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]/g, "");

// Plan-wide sweep: link every unlinked entry to a unit by ref, or by
// tenant name when exactly one unit carries that tenant. Idempotent —
// runs after detection/extraction jobs and on plan load.
async function relinkAllEntries(planId: string): Promise<number> {
  const { rows: units } = await pool.query(`SELECT id, unit_ref, tenant_name FROM evidence_plan_units WHERE plan_id = $1`, [planId]);
  const { rows: entries } = await pool.query(`SELECT id, unit_ref, tenant FROM evidence_plan_entries WHERE plan_id = $1 AND unit_id IS NULL`, [planId]);
  if (units.length === 0 || entries.length === 0) return 0;
  const byRef = new Map<string, string>();
  const byTenant = new Map<string, string | null>(); // null = ambiguous
  for (const u of units) {
    const r = normaliseUnitRef(u.unit_ref);
    if (r && !byRef.has(r)) byRef.set(r, u.id);
    for (const nm of [u.tenant_name, u.unit_ref]) {
      const t = normTenantName(nm);
      if (!t || t.length < 3 || /^\d+$/.test(t)) continue;
      byTenant.set(t, byTenant.has(t) && byTenant.get(t) !== u.id ? null : u.id);
    }
  }
  let linked = 0;
  for (const e of entries) {
    let uid = e.unit_ref ? byRef.get(normaliseUnitRef(e.unit_ref)) : undefined;
    if (!uid && e.tenant) uid = byTenant.get(normTenantName(e.tenant)) || undefined;
    if (uid) {
      await pool.query(`UPDATE evidence_plan_entries SET unit_id = $1 WHERE id = $2`, [uid, e.id]);
      linked++;
    }
  }
  if (linked) console.log(`[evidence-plan] relink sweep on ${planId}: ${linked} entries linked`);
  return linked;
}

// One-off heal: repeated extractions of the same TAF set stacked exact
// duplicates (three 504-era retries left Brent Cross with 167 entries for
// ~55 sheets). Keep the earliest of each identical unlinked entry.
pool.query(`
  DELETE FROM evidence_plan_entries e USING evidence_plan_entries k
   WHERE e.id <> k.id AND e.plan_id = k.plan_id
     AND e.unit_id IS NULL AND k.unit_id IS NULL
     AND e.unit_ref IS NOT DISTINCT FROM k.unit_ref
     AND e.tenant IS NOT DISTINCT FROM k.tenant
     AND e.transaction_date IS NOT DISTINCT FROM k.transaction_date
     AND e.zone_a IS NOT DISTINCT FROM k.zone_a
     AND e.headline_rent IS NOT DISTINCT FROM k.headline_rent
     AND e.net_effective IS NOT DISTINCT FROM k.net_effective
     AND (e.created_at > k.created_at OR (e.created_at = k.created_at AND e.id > k.id))`)
  .then(r => { if (r.rowCount) console.log(`[evidence-plan] deduped ${r.rowCount} duplicate evidence entries`); })
  .catch(() => {});

// One-time dot heal: units created before frontage dots existed (or drawn
// by hand) get a dot computed from their polygon against the level raster,
// so evidence dots line up without a re-detect (Woody, 2026-09-04). Runs
// at most once per plan per boot; centroid is stored when no clear
// frontage so the heal doesn't re-run forever.
const dotHealRunning = new Set<string>();
async function healFrontageDots(planId: string): Promise<void> {
  if (dotHealRunning.has(planId)) return;
  dotHealRunning.add(planId);
  try {
    const { rows: units } = await pool.query(
      `SELECT id, level_id, polygon FROM evidence_plan_units WHERE plan_id = $1 AND dot IS NULL AND polygon IS NOT NULL`, [planId]);
    if (units.length === 0) return;
    const sharp = (await import("sharp")).default;
    const byLevel = new Map<string, any[]>();
    for (const u of units) {
      if (!u.level_id) continue;
      if (!byLevel.has(u.level_id)) byLevel.set(u.level_id, []);
      byLevel.get(u.level_id)!.push(u);
    }
    let healed = 0;
    for (const [levelId, levelUnits] of byLevel) {
      const { rows: [level] } = await pool.query(`SELECT background_key FROM evidence_plan_levels WHERE id = $1`, [levelId]);
      if (!level?.background_key) continue;
      const file = await getFile(level.background_key);
      if (!file) continue;
      const meta = await sharp(file.data).metadata();
      const W = meta.width || 0, H = meta.height || 0;
      if (!W || !H) continue;
      const raw = await sharp(file.data).removeAlpha().raw().toBuffer();
      for (const u of levelUnits) {
        const poly = Array.isArray(u.polygon) ? u.polygon : null;
        if (!poly || poly.length < 3) continue;
        const xs = poly.map((p: any) => p.x), ys = poly.map((p: any) => p.y);
        const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        const dot = frontageDot(raw, W, H, box)
          || { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
        await pool.query(`UPDATE evidence_plan_units SET dot = $1 WHERE id = $2 AND dot IS NULL`, [JSON.stringify(dot), u.id]);
        healed++;
      }
    }
    if (healed) console.log(`[evidence-plan] frontage-dot heal on ${planId}: ${healed} units`);
  } catch (e: any) {
    console.error(`[evidence-plan] dot heal failed for ${planId}:`, e?.message);
    dotHealRunning.delete(planId); // let a later load retry
  }
}

async function planOr404(planId: string, res: Response): Promise<any | null> {
  const { rows } = await pool.query(`SELECT * FROM evidence_plans WHERE id = $1`, [planId]);
  if (!rows[0]) { res.status(404).json({ error: "Plan not found" }); return null; }
  return rows[0];
}

// ── Backgrounds & levels ─────────────────────────────────────────────────
// A scheme plan PDF is often one page per trading level (Brent Cross:
// Lower / Upper / Restaurant). Every page becomes a level of the plan,
// named from the page's own text where a level name can be found.

async function pdfPageText(pdfBuffer: Buffer, page: number): Promise<string> {
  const tmp = path.join(os.tmpdir(), `epl-${crypto.randomBytes(6).toString("hex")}.pdf`);
  try {
    fs.writeFileSync(tmp, pdfBuffer);
    return await new Promise<string>((resolve) => {
      execFile("pdftotext", ["-f", String(page), "-l", String(page), tmp, "-"], { timeout: 20000 },
        (err, stdout) => resolve(err ? "" : String(stdout)));
    });
  } catch { return ""; } finally { try { fs.unlinkSync(tmp); } catch {} }
}

// Named levels ("Restaurant Level") win over bare "Level N" — plans note
// car-park levels ("Car Parking Level 3") that would otherwise match first.
const NAMED_LEVEL_RE = /\b((?:Lower|Upper|Ground|First|Second|Third|Basement|Mezzanine|Restaurant|Leisure|Terrace)\s+(?:Level|Floor|Mall))\b/i;
const NUMBERED_LEVEL_RE = /(?<!Car\s?Parking\s)\b(Level\s+\d+)\b/i;
function detectLevelName(text: string): string | null {
  const m = text.match(NAMED_LEVEL_RE) || text.match(NUMBERED_LEVEL_RE);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

type RenderedPage = { key: string; width: number; height: number; name: string | null };

// Renders every page of a PDF (or a single image) into file_storage.
async function renderPlanPages(planId: string, file: Express.Multer.File): Promise<RenderedPage[]> {
  const sharp = (await import("sharp")).default;
  const out: RenderedPage[] = [];
  const isPdf = /pdf/i.test(file.mimetype || "") || /\.pdf$/i.test(file.originalname || "");
  if (isPdf) {
    for (let p = 1; p <= 10; p++) {
      const page = await rasterisePdfPage({ pdfBuffer: file.buffer, page: p, dpi: 200 });
      if (!page) break;
      const meta = await sharp(page).metadata();
      if (!meta.width || !meta.height) continue;
      const key = `evidence-plans/${planId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.jpg`;
      await saveFile(key, page, "image/jpeg", file.originalname);
      const text = await pdfPageText(file.buffer, p);
      out.push({ key, width: meta.width, height: meta.height, name: detectLevelName(text) });
    }
    if (out.length === 0) throw new Error("Couldn't render the PDF — is it a valid plan?");
  } else if (/^image\//.test(file.mimetype || "")) {
    const meta = await sharp(file.buffer).metadata();
    if (!meta.width || !meta.height) throw new Error("Couldn't read the plan image dimensions");
    const key = `evidence-plans/${planId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${/png/i.test(file.mimetype || "") ? "png" : "jpg"}`;
    await saveFile(key, file.buffer, file.mimetype, file.originalname);
    out.push({ key, width: meta.width, height: meta.height, name: null });
  } else {
    throw new Error("Background must be a PDF or an image");
  }
  return out;
}

async function planLevels(planId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT * FROM evidence_plan_levels WHERE plan_id = $1 ORDER BY sort_order, created_at`, [planId]);
  return rows;
}

// Maps rendered pages onto the plan's levels in order — updating images in
// place, creating levels for extra pages — or, for a single page with an
// explicit target, replaces just that level's image. Custom level names are
// kept; auto "Level N" names adopt a name detected on the new page.
async function applyBackgroundPages(planId: string, pages: RenderedPage[], targetLevelId: string | null): Promise<void> {
  const levels = await planLevels(planId);
  if (pages.length === 1 && targetLevelId && levels.some(l => l.id === targetLevelId)) {
    const pg = pages[0];
    await pool.query(
      `UPDATE evidence_plan_levels SET background_key=$1, background_width=$2, background_height=$3 WHERE id=$4`,
      [pg.key, pg.width, pg.height, targetLevelId]);
  } else {
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      const existing = levels[i];
      if (existing) {
        const keepName = existing.name && !/^Level \d+$/i.test(existing.name);
        const name = keepName ? existing.name : (pg.name || existing.name || `Level ${i + 1}`);
        await pool.query(
          `UPDATE evidence_plan_levels SET background_key=$1, background_width=$2, background_height=$3, name=$4 WHERE id=$5`,
          [pg.key, pg.width, pg.height, name, existing.id]);
      } else {
        await pool.query(
          `INSERT INTO evidence_plan_levels (plan_id, name, background_key, background_width, background_height, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [planId, pg.name || `Level ${i + 1}`, pg.key, pg.width, pg.height, i]);
      }
    }
  }
  // Mirror the first level onto the plan row — the list page and older
  // clients read background_* from there.
  const after = await planLevels(planId);
  const first = after[0];
  if (first?.background_key) {
    await pool.query(
      `UPDATE evidence_plans SET background_key=$1, background_width=$2, background_height=$3, updated_at=now() WHERE id=$4`,
      [first.background_key, first.background_width, first.background_height, planId]);
  }
}

// Plans made before levels existed carry their background on the plan row;
// give them a level, and adopt any units that predate levels.
async function healLevels(plan: any): Promise<any[]> {
  let levels = await planLevels(plan.id);
  if (levels.length === 0 && plan.background_key) {
    await pool.query(
      `INSERT INTO evidence_plan_levels (plan_id, name, background_key, background_width, background_height, sort_order)
       VALUES ($1,'Level 1',$2,$3,$4,0)`,
      [plan.id, plan.background_key, plan.background_width, plan.background_height]);
    levels = await planLevels(plan.id);
  }
  if (levels.length > 0) {
    await pool.query(`UPDATE evidence_plan_units SET level_id = $1 WHERE plan_id = $2 AND level_id IS NULL`, [levels[0].id, plan.id]);
  }
  return levels;
}

// ── Plans ────────────────────────────────────────────────────────────────
router.get("/api/evidence-plans", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, cp.name AS property_name,
             (SELECT count(*)::int FROM evidence_plan_units u WHERE u.plan_id = p.id) AS unit_count,
             (SELECT count(*)::int FROM evidence_plan_entries e WHERE e.plan_id = p.id) AS evidence_count
        FROM evidence_plans p LEFT JOIN crm_properties cp ON cp.id = p.property_id
       ORDER BY p.updated_at DESC`);
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
      const pages = await renderPlanPages(plan.id, req.file);
      await applyBackgroundPages(plan.id, pages, null);
      const upd = await pool.query(`SELECT * FROM evidence_plans WHERE id = $1`, [plan.id]);
      plan = upd.rows[0];
      void autoDetectEmptyLevels(plan.id);
    }
    res.json(plan);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/api/evidence-plans/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const levels = await healLevels(plan);
    // Heal linking on load: entries that arrived before their unit existed
    // (or match by tenant name) get attached here.
    await relinkAllEntries(plan.id).catch(() => {});
    await healFrontageDots(plan.id).catch(() => {});
    const [unitsQ, entries] = await Promise.all([
      pool.query(`SELECT * FROM evidence_plan_units WHERE plan_id = $1 ORDER BY unit_ref`, [plan.id]),
      pool.query(`SELECT * FROM evidence_plan_entries WHERE plan_id = $1 ORDER BY transaction_date DESC NULLS LAST, created_at DESC`, [plan.id]),
    ]);

    // Linked to a CRM property → the property's tenancy schedule is the
    // single source of truth: unit facts overlay live from
    // tenancy_schedule_units (matched on normalised unit ref), and lease
    // advisory jobs (pla_matters) ride along for the unit panel.
    let propertyName: string | null = null;
    let matters: any[] = [];
    const tsByNorm = new Map<string, any>();
    if (plan.property_id) {
      const [prop, ts, m] = await Promise.all([
        pool.query(`SELECT name FROM crm_properties WHERE id = $1`, [plan.property_id]),
        pool.query(
          `SELECT unit_number, trading_name, tenant_name, lease_expiry, break_date, next_review_date,
                  erv_pa, passing_rent_pa, nia_sqft, gia_sqft
             FROM tenancy_schedule_units WHERE property_id = $1`, [plan.property_id]),
        pool.query(
          `SELECT m.id, m.matter_type, m.status, m.acting_for, pu.unit_name
             FROM pla_matters m LEFT JOIN property_units pu ON pu.id = m.unit_id
            WHERE m.property_id = $1 ORDER BY m.opened_at DESC`, [plan.property_id]).catch(() => ({ rows: [] as any[] })),
      ]);
      propertyName = prop.rows[0]?.name || null;
      for (const r of ts.rows) {
        const n = normaliseUnitRef(r.unit_number || "");
        if (n && !tsByNorm.has(n)) tsByNorm.set(n, r);
      }
      matters = m.rows.map((r: any) => ({ ...r, unit_norm: r.unit_name ? normaliseUnitRef(r.unit_name) : null }));
    }
    const units = unitsQ.rows.map((u: any) => {
      const norm = normaliseUnitRef(u.unit_ref);
      const t = tsByNorm.get(norm);
      if (!t) return { ...u, unit_norm: norm, ts_linked: false };
      return {
        ...u,
        unit_norm: norm,
        ts_linked: true,
        tenant_name: t.trading_name || t.tenant_name || u.tenant_name,
        lease_expiry: t.lease_expiry ?? u.lease_expiry,
        break_date: t.break_date ?? u.break_date,
        review_date: t.next_review_date ?? u.review_date,
        erv: t.erv_pa ?? u.erv,
        passing_rent: t.passing_rent_pa ?? u.passing_rent,
        sqft: t.nia_sqft ?? t.gia_sqft ?? u.sqft,
      };
    });
    const running = await pool.query(
      `SELECT id, kind, level_id, total_docs, done_docs FROM evidence_plan_jobs WHERE plan_id = $1 AND status = 'running' AND created_at > now() - interval '2 hours'`,
      [plan.id]).catch(() => ({ rows: [] as any[] }));
    res.json({ plan: { ...plan, property_name: propertyName }, levels, units, entries: entries.rows, matters, jobs: running.rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Rename the plan or link/unlink its CRM property. Linking makes that
// property's tenancy schedule the plan's source of truth for unit facts.
router.put("/api/evidence-plans/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const sets: string[] = [];
    const vals: any[] = [];
    if (typeof req.body?.name === "string" && req.body.name.trim()) {
      vals.push(req.body.name.trim());
      sets.push(`name = $${vals.length}`);
    }
    if ("propertyId" in (req.body || {})) {
      vals.push(req.body.propertyId || null);
      sets.push(`property_id = $${vals.length}`);
    }
    if ("dotColours" in (req.body || {})) {
      vals.push(req.body.dotColours ? JSON.stringify(req.body.dotColours) : null);
      sets.push(`dot_colours = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });
    vals.push(plan.id);
    const { rows } = await pool.query(
      `UPDATE evidence_plans SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
    res.json(rows[0]);
    // Linking a property brings the tenancy schedule's unit refs — the best
    // grounding for detection — so empty levels get read now.
    if (req.body?.propertyId) void autoDetectEmptyLevels(plan.id);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Swap the background — outlines and data stay (Pete's "new scheme plan
// when tenants change"). Old images are kept in file_storage for history.
// A single image (or 1-page PDF) with levelId replaces just that level's
// plan; a multi-page PDF refreshes every level in page order.
router.post("/api/evidence-plans/:id/background", requireAuth, upload.single("background"), async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    await healLevels(plan);
    const pages = await renderPlanPages(plan.id, req.file);
    await applyBackgroundPages(plan.id, pages, req.body?.levelId ? String(req.body.levelId) : null);
    const levels = await planLevels(plan.id);
    const upd = await pool.query(`SELECT * FROM evidence_plans WHERE id = $1`, [plan.id]);
    res.json({ ...upd.rows[0], levels });
    void autoDetectEmptyLevels(plan.id);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Level background image, rename, and delete (only an empty level).
router.get("/api/evidence-plans/levels/:levelId/background", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM evidence_plan_levels WHERE id = $1`, [String(req.params.levelId)]);
    const level = rows[0];
    if (!level?.background_key) return res.status(404).json({ error: "No plan image for this level" });
    const file = await getFile(level.background_key);
    if (!file) return res.status(404).json({ error: "Plan image missing" });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(file.data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put("/api/evidence-plans/levels/:levelId", requireAuth, async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    const { rows } = await pool.query(
      `UPDATE evidence_plan_levels SET name = $1 WHERE id = $2 RETURNING *`, [name.slice(0, 60), String(req.params.levelId)]);
    if (!rows[0]) return res.status(404).json({ error: "Level not found" });
    res.json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete("/api/evidence-plans/levels/:levelId", requireAuth, async (req: Request, res: Response) => {
  try {
    const levelId = String(req.params.levelId);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM evidence_plan_units WHERE level_id = $1`, [levelId]);
    if (rows[0]?.n > 0) return res.status(400).json({ error: `That level has ${rows[0].n} unit${rows[0].n === 1 ? "" : "s"} drawn on it — delete or move them first` });
    await pool.query(`DELETE FROM evidence_plan_levels WHERE id = $1`, [levelId]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Crop a level's plan to just the drawing (drop the page border, sidebar,
// contact footer — Woody, 2026-09-04). Geometry is stored normalised, so
// every unit polygon and dot on the level is remapped into the new frame;
// the original image stays in file_storage.
router.post("/api/evidence-plans/levels/:levelId/crop", requireAuth, async (req: Request, res: Response) => {
  try {
    const levelId = String(req.params.levelId);
    const { rows: [level] } = await pool.query(`SELECT * FROM evidence_plan_levels WHERE id = $1`, [levelId]);
    if (!level?.background_key) return res.status(404).json({ error: "No plan image on this level" });
    const clamp = (v: any) => Math.min(1, Math.max(0, Number(v) || 0));
    const x0 = clamp(req.body?.x0), y0 = clamp(req.body?.y0);
    const x1 = clamp(req.body?.x1), y1 = clamp(req.body?.y1);
    const sw = x1 - x0, sh = y1 - y0;
    if (sw < 0.05 || sh < 0.05) return res.status(400).json({ error: "Crop area is too small" });
    const file = await getFile(level.background_key);
    if (!file) return res.status(404).json({ error: "Plan image missing" });
    const sharp = (await import("sharp")).default;
    const meta = await sharp(file.data).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    if (!W || !H) return res.status(400).json({ error: "Couldn't read the plan image" });
    const region = {
      left: Math.round(x0 * W), top: Math.round(y0 * H),
      width: Math.max(1, Math.round(sw * W)), height: Math.max(1, Math.round(sh * H)),
    };
    const buf = await sharp(file.data).extract(region).jpeg({ quality: 90 }).toBuffer();
    const key = `evidence-plans/${level.plan_id}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.jpg`;
    await saveFile(key, buf, "image/jpeg", "cropped-plan.jpg");
    await pool.query(
      `UPDATE evidence_plan_levels SET background_key=$1, background_width=$2, background_height=$3 WHERE id=$4`,
      [key, region.width, region.height, levelId]);

    // Remap this level's geometry into the cropped frame.
    const { rows: units } = await pool.query(`SELECT id, polygon, dot FROM evidence_plan_units WHERE level_id = $1`, [levelId]);
    const map = (p: any) => ({ x: (p.x - x0) / sw, y: (p.y - y0) / sh });
    for (const u of units) {
      const polygon = Array.isArray(u.polygon) ? u.polygon.map(map) : u.polygon;
      const dot = u.dot && typeof u.dot.x === "number" ? map(u.dot) : u.dot;
      await pool.query(`UPDATE evidence_plan_units SET polygon = $1, dot = $2 WHERE id = $3`,
        [polygon ? JSON.stringify(polygon) : null, dot ? JSON.stringify(dot) : null, u.id]);
    }
    // Keep the plan-row mirror in sync when this is the first level.
    const levels = await planLevels(level.plan_id);
    if (levels[0]?.id === levelId) {
      await pool.query(
        `UPDATE evidence_plans SET background_key=$1, background_width=$2, background_height=$3, updated_at=now() WHERE id=$4`,
        [key, region.width, region.height, level.plan_id]);
    }
    res.json({ ok: true, width: region.width, height: region.height, remapped: units.length });
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
    await pool.query(`DELETE FROM evidence_plan_levels WHERE plan_id = $1`, [plan.id]);
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
      `INSERT INTO evidence_plan_units (plan_id, level_id, unit_ref, tenant_name, polygon, source) VALUES ($1, $2, $3, $4, $5, 'manual') RETURNING *`,
      [plan.id, req.body?.levelId || null, unitRef, req.body?.tenantName || null, JSON.stringify(req.body?.polygon || null)]);
    const adopted = await relinkEntriesToUnit(plan.id, rows[0].id, unitRef);
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]);
    res.json({ ...rows[0], adopted });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

const UNIT_FIELDS: Record<string, string> = {
  unitRef: "unit_ref", tenantName: "tenant_name", polygon: "polygon", dot: "dot",
  leaseExpiry: "lease_expiry", breakDate: "break_date", reviewDate: "review_date",
  erv: "erv", passingRent: "passing_rent", sqft: "sqft", notes: "notes",
};

router.put("/api/evidence-plans/units/:unitId", requireAuth, async (req: Request, res: Response) => {
  try {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, col] of Object.entries(UNIT_FIELDS)) {
      if (!(k in (req.body || {}))) continue;
      vals.push(k === "polygon" || k === "dot" ? JSON.stringify(req.body[k]) : (req.body[k] === "" ? null : req.body[k]));
      sets.push(`${col} = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });
    vals.push(String(req.params.unitId));
    const { rows } = await pool.query(
      `UPDATE evidence_plan_units SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: "Unit not found" });
    if (typeof req.body?.unitRef === "string" && req.body.unitRef.trim()) {
      await relinkEntriesToUnit(rows[0].plan_id, rows[0].id, req.body.unitRef.trim());
    }
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
    if (plan.property_id) {
      return res.status(400).json({
        error: "This plan is linked to a property — its tenancy schedule is the source of truth. Import there and the plan updates itself.",
      });
    }
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

// Extraction runs as a BACKGROUND JOB: a tranche set takes minutes of
// vision reading and Railway's edge kills any request at ~45s (Woody hit
// 504s on the first real upload, 2026-09-02). The POST returns a job id
// as soon as the files are received; the client polls the job for
// progress and evidence entries appear per document as they finish.
const uploadLarge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } });

async function runTafJob(planId: string, jobId: string, pdfs: { name: string; get: () => Buffer }[], userId: string | null): Promise<void> {
  const bump = (sets: string, vals: any[]) =>
    pool.query(`UPDATE evidence_plan_jobs SET ${sets}, updated_at = now() WHERE id = $${vals.length + 1}`, [...vals, jobId]).catch(() => {});
  try {
    const { rows: units } = await pool.query(`SELECT id, unit_ref FROM evidence_plan_units WHERE plan_id = $1`, [planId]);
    const byNorm = new Map<string, any>();
    for (const u of units) byNorm.set(normaliseUnitRef(u.unit_ref), u);
    const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const date = (v: any) => { const d = new Date(String(v || "")); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };

    let pages = 0, extracted = 0, created = 0, linked = 0;
    // One document at a time keeps memory bounded and lets evidence land
    // progressively — each doc's entries are visible before the next starts.
    for (let i = 0; i < pdfs.length; i++) {
      const pdf = pdfs[i];
      const pdfBuffer = pdf.get();
      const sourceKey = `evidence-plans/${planId}/taf-${Date.now()}-${i}-${pdf.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60)}`;
      await saveFile(sourceKey, pdfBuffer, "application/pdf", pdf.name);
      const docPages: Buffer[] = [];
      for (let p = 1; p <= 40; p++) {
        const buf = await rasterisePdfPage({ pdfBuffer, page: p, dpi: 150 });
        if (!buf) break;
        docPages.push(buf);
      }
      pages += docPages.length;

      const tafs: any[] = [];
      for (let b = 0; b < docPages.length; b += 8) {
        const batch = docPages.slice(b, b + 8);
        const content: any[] = batch.map(buf => ({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
        }));
        content.push({ type: "text", text: TAF_PROMPT });
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          messages: [{ role: "user", content }],
        });
        const text = msg.content.filter((blk: any) => blk.type === "text").map((blk: any) => blk.text).join("");
        {
          try {
            const parsed = extractJsonObject(text);
            if (!parsed) throw new Error("unparseable");
            if (Array.isArray(parsed.tafs)) tafs.push(...parsed.tafs);
          } catch { /* batch unparseable — carry on with the rest */ }
        }
      }

      for (const t of tafs) {
        if (!t || (!t.unitRef && !t.tenant)) continue;
        // Re-running the same tranche must not stack duplicates (the 504-era
        // retries tripled Brent Cross's entries).
        const dup = await pool.query(
          `SELECT 1 FROM evidence_plan_entries
            WHERE plan_id = $1 AND unit_ref IS NOT DISTINCT FROM $2 AND tenant IS NOT DISTINCT FROM $3
              AND transaction_date IS NOT DISTINCT FROM $4 AND zone_a IS NOT DISTINCT FROM $5
              AND headline_rent IS NOT DISTINCT FROM $6 LIMIT 1`,
          [planId, t.unitRef ? String(t.unitRef).slice(0, 40) : null, t.tenant || null,
           date(t.transactionDate), num(t.zoneA), num(t.headlineRent)]);
        if (dup.rows[0]) continue;
        const unit = t.unitRef ? byNorm.get(normaliseUnitRef(String(t.unitRef))) : null;
        await pool.query(
          `INSERT INTO evidence_plan_entries
             (plan_id, unit_id, unit_ref, tenant, transaction_type, transaction_date, size_sqft, zone_a, itza,
              headline_rent, net_effective, term, concession, notes, source_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [planId, unit?.id || null, t.unitRef ? String(t.unitRef).slice(0, 40) : null,
           t.tenant || null, t.transactionType || null, date(t.transactionDate),
           num(t.sizeSqft), num(t.zoneA), num(t.itza), num(t.headlineRent), num(t.netEffective),
           t.term || null, t.concession || null, t.notes || null, sourceKey, userId]);
        created++;
        if (unit) linked++;
      }
      extracted += tafs.length;
      await bump(`done_docs = $1, pages = $2, extracted = $3, created = $4, linked = $5`, [i + 1, pages, extracted, created, linked]);
    }
    linked += await relinkAllEntries(planId);
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [planId]);
    await bump(`status = 'done'`, []);
    console.log(`[evidence-plan] TAF job ${jobId}: ${pdfs.length} docs, ${pages} pages, ${extracted} TAFs, ${linked} linked`);
    // Fresh evidence refs are grounding for detection — outline any levels
    // that still have no units so the new entries link straight away.
    void autoDetectEmptyLevels(planId);
  } catch (e: any) {
    console.error(`[evidence-plan] TAF job ${jobId} failed:`, e?.message);
    await bump(`status = 'error', error = $1`, [String(e?.message || e).slice(0, 500)]);
  }
}

router.post("/api/evidence-plans/:id/ingest-taf", requireAuth, uploadLarge.array("file", 200), async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ error: "No file uploaded" });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI extraction is not configured" });

    // Multiple files per upload (a whole folder of TAFs), and any of them
    // can be a zip (how the tranches arrive from Hammerson) — every PDF
    // found is processed as if uploaded individually. Buffers are pulled
    // lazily (one document in memory at a time inside the job), so the cap
    // is about job length, not memory. Woody's first real zip held 60+
    // TAFs and hit the old cap of 60.
    const pdfs: { name: string; get: () => Buffer }[] = [];
    for (const file of files) {
      if (pdfs.length >= 150) break;
      const isZip = /zip/i.test(file.mimetype || "") || /\.zip$/i.test(file.originalname || "");
      if (isZip) {
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(file.buffer);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory || !/\.pdf$/i.test(entry.entryName) || /__MACOSX|^\./.test(entry.entryName)) continue;
          pdfs.push({ name: entry.entryName.split("/").pop() || entry.entryName, get: () => entry.getData() });
          if (pdfs.length >= 150) break;
        }
      } else if (/\.pdf$/i.test(file.originalname || "") || /pdf/i.test(file.mimetype || "")) {
        pdfs.push({ name: file.originalname || "taf.pdf", get: () => file.buffer });
      }
    }
    if (pdfs.length === 0) return res.status(400).json({ error: "No PDFs found in that upload" });

    const { rows } = await pool.query(
      `INSERT INTO evidence_plan_jobs (plan_id, status, total_docs, created_by) VALUES ($1, 'running', $2, $3) RETURNING id`,
      [plan.id, pdfs.length, (req as any).session?.userId || null]);
    const jobId = rows[0].id;
    res.json({ jobId, docs: pdfs.length });
    // Detached — the extraction outlives this request on purpose.
    void runTafJob(plan.id, jobId, pdfs, (req as any).session?.userId || null);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Auto-detect units (AI vision) ────────────────────────────────────────
// Drawing ~100 outlines by hand doesn't scale ("i cant draw units for
// every plan" — Woody, 2026-09-02). Vision reads the level's plan image
// and returns a labelled box per unit block; each becomes a unit outline
// that immediately adopts its waiting evidence. Grounded with the unit
// refs we already know (tenancy schedule + unlinked evidence) so labels
// are read, not guessed.
// Brace-balanced extraction of the first complete JSON object in a model
// response — a trailing remark or a second object after the JSON killed
// whole detect jobs via bare JSON.parse (prod, 2026-09-04).
function extractJsonObject(text: string): any | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const DETECT_PROMPT = (known: string[]) => `This image is PART of one level of a UK shopping centre letting plan. Thin magenta grid lines are drawn at EXACTLY 0.1 intervals of this image in both directions — use them to calibrate every coordinate you give.

Identify every lettable unit whose block is FULLY visible in this image — shops, restaurants, kiosks — including blocks labelled only with a tenant name. A unit is a closed shape drawn on the floor-plan geometry (usually colour-filled).

STRICTLY IGNORE: the page border and title, sidebar panels, legends and colour keys, text-only lists of kiosks/units (e.g. a column of lines like "K10 …"), mall/walkway areas, toilets, lifts, stairs, service corridors, car parks, arrows and note annotations, and any block cut off by the image edge.

Return JSON only:
{"units":[{"unitRef":"E7A","tenant":"Nando's","x0":0.31,"y0":0.42,"x1":0.38,"y1":0.51}]}

x/y are fractions of THIS image (0..1, x rightward, y downward); the box must sit tightly on the unit's block — check it against the magenta grid before answering. unitRef is the unit reference where visible ("E1Y", "K21", "D11/12" — strip the word "Unit"); if only a tenant name is shown, unitRef null and give the tenant. tenant null when not shown.${known.length ? `\n\nUnit references known to exist at this scheme (use these spellings when the plan matches them): ${known.join(", ")}` : ""}`;

// Read one tile of the plan (grid-overlaid) and return boxes in FULL-image
// fractions. Tiling + the drawn grid is what makes the coordinates land —
// a single whole-page pass put boxes in the wrong places (2026-09-02).
async function detectTile(sharp: any, planImage: Buffer, W: number, H: number, ox: number, oy: number, fw: number, fh: number, known: string[]): Promise<any[]> {
  const left = Math.round(ox * W), top = Math.round(oy * H);
  const width = Math.min(W - left, Math.round(fw * W)), height = Math.min(H - top, Math.round(fh * H));
  const targetW = 1400;
  const scale = Math.min(1, targetW / width);
  const tw = Math.round(width * scale), th = Math.round(height * scale);
  const lines: string[] = [];
  for (let i = 1; i < 10; i++) {
    lines.push(`<line x1="${(i / 10) * tw}" y1="0" x2="${(i / 10) * tw}" y2="${th}" stroke="magenta" stroke-width="1" opacity="0.6"/>`);
    lines.push(`<line x1="0" y1="${(i / 10) * th}" x2="${tw}" y2="${(i / 10) * th}" stroke="magenta" stroke-width="1" opacity="0.6"/>`);
    lines.push(`<text x="${(i / 10) * tw + 2}" y="12" font-size="11" fill="magenta">${(i / 10).toFixed(1)}</text>`);
    lines.push(`<text x="2" y="${(i / 10) * th - 2}" font-size="11" fill="magenta">${(i / 10).toFixed(1)}</text>`);
  }
  const grid = Buffer.from(`<svg width="${tw}" height="${th}" xmlns="http://www.w3.org/2000/svg">${lines.join("")}</svg>`);
  const tile = await sharp(planImage)
    .extract({ left, top, width, height })
    .resize({ width: tw })
    .composite([{ input: grid, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: tile.toString("base64") } },
        { type: "text", text: DETECT_PROMPT(known) },
      ],
    }],
  });
  const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const parsed = extractJsonObject(text);
  const found: any[] = Array.isArray(parsed?.units) ? parsed.units : [];
  const clamp = (v: any) => Math.min(1, Math.max(0, Number(v) || 0));
  const sx = width / W, sy = height / H;
  return found.map(u => ({
    unitRef: u.unitRef, tenant: u.tenant,
    x0: ox + clamp(u.x0) * sx, y0: oy + clamp(u.y0) * sy,
    x1: ox + clamp(u.x1) * sx, y1: oy + clamp(u.y1) * sy,
  }));
}

// Snap an AI-proposed box to the coloured block underneath it: within the
// box (plus margin) find the saturated fill pixels and take their bounding
// box. AI coordinates are "close but offset"; the pixels are exact. Blocks
// with no colour fill (white anchor stores) keep the AI box.
function snapBoxToBlock(raw: Buffer, W: number, H: number, box: { x0: number; y0: number; x1: number; y1: number }): { x0: number; y0: number; x1: number; y1: number; fillFrac: number } {
  const m = 0.15; // window margin as a fraction of the box size
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const wx0 = Math.max(0, Math.floor((box.x0 - bw * m) * W)), wx1 = Math.min(W - 1, Math.ceil((box.x1 + bw * m) * W));
  const wy0 = Math.max(0, Math.floor((box.y0 - bh * m) * H)), wy1 = Math.min(H - 1, Math.ceil((box.y1 + bh * m) * H));
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, hits = 0, total = 0;
  for (let y = wy0; y <= wy1; y += 2) {
    for (let x = wx0; x <= wx1; x += 2) {
      total++;
      const i = (y * W + x) * 3;
      const r = raw[i], g = raw[i + 1], b = raw[i + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const bright = Math.max(r, g, b);
      if (sat > 30 && bright > 90) { // coloured block fill (teal/orange/etc), not white mall or dark linework
        hits++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const fillFrac = total ? hits / total : 0;
  if (!total || fillFrac < 0.05 || maxX < 0) return { ...box, fillFrac }; // no meaningful fill — keep AI box
  const snapped = { x0: minX / W, y0: minY / H, x1: (maxX + 2) / W, y1: (maxY + 2) / H };
  // A snap adjusts edges, it doesn't leap: each edge may move at most half
  // a box-dimension from where the AI put it.
  return {
    x0: Math.max(snapped.x0, box.x0 - bw * 0.5), y0: Math.max(snapped.y0, box.y0 - bh * 0.5),
    x1: Math.min(snapped.x1, box.x1 + bw * 0.5), y1: Math.min(snapped.y1, box.y1 + bh * 0.5),
    fillFrac,
  };
}

// Place a unit's evidence dot at its FRONTAGE: sample thin strips just
// outside each edge of the box — the mall/walkway side is the whitest —
// and put the dot just inside that edge (Woody, 2026-09-03: "dots should
// be fixed to the frontage"). Null = no clear frontage → centroid.
function frontageDot(raw: Buffer, W: number, H: number, box: { x0: number; y0: number; x1: number; y1: number }): { x: number; y: number } | null {
  const whiteness = (x0: number, y0: number, x1: number, y1: number) => {
    let white = 0, total = 0;
    for (let y = Math.max(0, Math.floor(y0 * H)); y < Math.min(H, Math.ceil(y1 * H)); y += 2) {
      for (let x = Math.max(0, Math.floor(x0 * W)); x < Math.min(W, Math.ceil(x1 * W)); x += 2) {
        total++;
        const i = (y * W + x) * 3;
        const r = raw[i], g = raw[i + 1], b = raw[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) < 25 && Math.min(r, g, b) > 195) white++;
      }
    }
    return total ? white / total : 0;
  };
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const t = Math.min(bw, bh) * 0.4;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const sides = [
    { w: whiteness(box.x0, box.y0 - t, box.x1, box.y0), dot: { x: cx, y: box.y0 + bh * 0.15 } },
    { w: whiteness(box.x0, box.y1, box.x1, box.y1 + t), dot: { x: cx, y: box.y1 - bh * 0.15 } },
    { w: whiteness(box.x0 - t, box.y0, box.x0, box.y1), dot: { x: box.x0 + bw * 0.15, y: cy } },
    { w: whiteness(box.x1, box.y0, box.x1 + t, box.y1), dot: { x: box.x1 - bw * 0.15, y: cy } },
  ].sort((a, b) => b.w - a.w);
  return sides[0].w > 0.3 ? sides[0].dot : null;
}

async function runDetectJob(planId: string, jobId: string, level: any, propertyId: string | null, clearAiFirst = false): Promise<void> {
  const bump = (sets: string, vals: any[]) =>
    pool.query(`UPDATE evidence_plan_jobs SET ${sets}, updated_at = now() WHERE id = $${vals.length + 1}`, [...vals, jobId]).catch(() => {});
  try {
    const file = await getFile(level.background_key);
    if (!file) throw new Error("Level has no plan image");
    const sharp = (await import("sharp")).default;
    const meta = await sharp(file.data).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    if (!W || !H) throw new Error("Couldn't read the plan image");
    const raw = await sharp(file.data).removeAlpha().raw().toBuffer();

    const known = new Set<string>();
    const tenantToRef = new Map<string, string>();
    if (propertyId) {
      const ts = await pool.query(`SELECT unit_number, trading_name, tenant_name FROM tenancy_schedule_units WHERE property_id = $1`, [propertyId]);
      for (const r of ts.rows) {
        const ref = r.unit_number ? String(r.unit_number).replace(/^unit\s+/i, "").trim() : null;
        if (!ref) continue;
        known.add(ref);
        for (const nm of [r.trading_name, r.tenant_name]) {
          const key = normTenantName(nm);
          if (key && key.length >= 3 && !tenantToRef.has(key)) tenantToRef.set(key, ref);
        }
      }
    }
    const ev = await pool.query(`SELECT DISTINCT unit_ref FROM evidence_plan_entries WHERE plan_id = $1 AND unit_ref IS NOT NULL`, [planId]);
    for (const r of ev.rows) known.add(String(r.unit_ref));
    const knownList = [...known].slice(0, 200);

    // 3×3 tiles with 25% overlap — the closer the zoom, the better both
    // recall (small kiosks) and box precision. One bad tile (unparseable
    // model output, transient API error) costs that tile after one retry,
    // never the job — a thrown tile used to kill the whole run.
    const found: any[] = [];
    let failedTiles = 0;
    for (const oy of [0, 0.3, 0.6]) {
      for (const ox of [0, 0.3, 0.6]) {
        let got: any[] | null = null;
        for (let attempt = 0; attempt < 2 && got === null; attempt++) {
          try { got = await detectTile(sharp, file.data, W, H, ox, oy, 0.4, 0.4, knownList); }
          catch (e: any) { if (attempt === 1) { failedTiles++; console.error(`[evidence-plan] detect tile (${ox},${oy}) failed twice:`, e?.message); } }
        }
        if (got) found.push(...got);
      }
    }
    if (found.length === 0) {
      throw new Error(failedTiles === 9 ? "AI detection failed on every tile — existing outlines left untouched" : "No units found on this level's plan image — existing outlines left untouched");
    }

    // Replace-mode (Re-detect): clear the level's AI outlines only now that
    // a successful read exists — a failed run must never wipe the level.
    if (clearAiFirst) {
      const { rows: old } = await pool.query(
        `SELECT id FROM evidence_plan_units WHERE plan_id = $1 AND level_id = $2 AND source IS DISTINCT FROM 'manual'`,
        [planId, level.id]);
      if (old.length) {
        const ids = old.map((r: any) => r.id);
        await pool.query(`UPDATE evidence_plan_entries SET unit_id = NULL WHERE unit_id = ANY($1)`, [ids]);
        await pool.query(`DELETE FROM evidence_plan_units WHERE id = ANY($1)`, [ids]);
      }
    }

    const { rows: existing } = await pool.query(`SELECT unit_ref FROM evidence_plan_units WHERE plan_id = $1 AND level_id = $2`, [planId, level.id]);
    const have = new Set(existing.map((u: any) => normaliseUnitRef(u.unit_ref)));
    const accepted: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const overlaps = (b: any) => accepted.some(a => {
      const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
      const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
      const inter = ix * iy;
      const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
      return union > 0 && inter / union > 0.55;
    });

    let created = 0, adopted = 0;
    for (const u of found) {
      let ref = String(u.unitRef || "").trim().slice(0, 40);
      const tenant = u.tenant ? String(u.tenant).slice(0, 80) : null;
      // Canonicalise a name-only label to its tenancy-schedule unit ref.
      if (!ref && tenant) ref = tenantToRef.get(normTenantName(tenant)) || tenant.slice(0, 40);
      else if (ref && !/\d/.test(ref)) ref = tenantToRef.get(normTenantName(ref)) || ref;
      if (!ref) continue;
      const norm = normaliseUnitRef(ref);
      if (!norm || have.has(norm)) continue;
      const w = u.x1 - u.x0, h = u.y1 - u.y0;
      if (w < 0.004 || h < 0.004 || w * h > 0.12 || w / h > 10 || h / w > 10) continue; // junk boxes
      if (overlaps(u)) continue; // same block seen from two tiles under different labels
      const { x0, y0, x1, y1, fillFrac } = snapBoxToBlock(raw, W, H, u);
      // A tiny box on plain white isn't a unit — it's a line from a key
      // list or a stray label (the "random ZA over nothing" bug). Big white
      // blocks (anchor stores) are fine.
      if (fillFrac < 0.05 && w * h < 0.004) continue;
      const polygon = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      const dot = frontageDot(raw, W, H, { x0, y0, x1, y1 });
      const ins = await pool.query(
        `INSERT INTO evidence_plan_units (plan_id, level_id, unit_ref, tenant_name, polygon, source, dot) VALUES ($1,$2,$3,$4,$5,'ai',$6) RETURNING id`,
        [planId, level.id, ref, tenant, JSON.stringify(polygon), dot ? JSON.stringify(dot) : null]);
      have.add(norm);
      accepted.push({ x0, y0, x1, y1 });
      created++;
      adopted += await relinkEntriesToUnit(planId, ins.rows[0].id, ref);
      await bump(`created = $1, linked = $2`, [created, adopted]);
    }
    adopted += await relinkAllEntries(planId);
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [planId]);
    await bump(`status = 'done', done_docs = 1, extracted = $1, linked = $2`, [found.length, adopted]);
    console.log(`[evidence-plan] detect job ${jobId}: ${found.length} boxes, ${created} units created, ${adopted} entries adopted`);
  } catch (e: any) {
    console.error(`[evidence-plan] detect job ${jobId} failed:`, e?.message);
    await bump(`status = 'error', error = $1`, [String(e?.message || e).slice(0, 500)]);
  }
}

// Detection runs AUTOMATICALLY — on plan upload, on property link, and
// after TAF extraction — for every level that has an image but no units
// yet ("thats the whole point? dont need a button" — Woody, 2026-09-02).
// Hand-drawing stays for correcting outlines; it's never overwritten.
async function autoDetectEmptyLevels(planId: string): Promise<void> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const { rows: [plan] } = await pool.query(`SELECT * FROM evidence_plans WHERE id = $1`, [planId]);
    if (!plan) return;
    const levels = await planLevels(planId);
    for (const level of levels) {
      if (!level.background_key) continue;
      const { rows: [{ n }] } = await pool.query(
        `SELECT count(*)::int AS n FROM evidence_plan_units WHERE plan_id = $1 AND level_id = $2`, [planId, level.id]);
      if (n > 0) continue;
      const { rows: dupJob } = await pool.query(
        `SELECT 1 FROM evidence_plan_jobs WHERE plan_id = $1 AND level_id = $2 AND kind = 'detect' AND status = 'running' LIMIT 1`,
        [planId, level.id]);
      if (dupJob[0]) continue;
      const { rows } = await pool.query(
        `INSERT INTO evidence_plan_jobs (plan_id, status, total_docs, kind, level_id) VALUES ($1, 'running', 1, 'detect', $2) RETURNING id`,
        [planId, level.id]);
      await runDetectJob(planId, rows[0].id, level, plan.property_id || null);
    }
  } catch (e: any) {
    console.error(`[evidence-plan] auto-detect for plan ${planId} failed:`, e?.message);
  }
}

// Re-detect one level: AI-created outlines are replaced (their evidence
// goes back to unlinked and re-adopts on the new outlines); hand-drawn
// units are never touched.
router.post("/api/evidence-plans/:id/detect-units", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI detection is not configured" });
    const levels = await healLevels(plan);
    const level = levels.find((l: any) => l.id === String(req.body?.levelId || "")) || levels[0];
    if (!level?.background_key) return res.status(400).json({ error: "No plan image on this level yet" });
    const { rows } = await pool.query(
      `INSERT INTO evidence_plan_jobs (plan_id, status, total_docs, kind, level_id, created_by) VALUES ($1, 'running', 1, 'detect', $2, $3) RETURNING id`,
      [plan.id, level.id, (req as any).session?.userId || null]);
    res.json({ jobId: rows[0].id });
    void runDetectJob(plan.id, rows[0].id, level, plan.property_id || null, true);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/api/evidence-plans/jobs/:jobId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM evidence_plan_jobs WHERE id = $1`, [String(req.params.jobId)]);
    if (!rows[0]) return res.status(404).json({ error: "Job not found" });
    res.json(rows[0]);
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
