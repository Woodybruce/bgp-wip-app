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
import { isValidPolygon, pointInPolygon, interiorPoint } from "@shared/plan-geometry";
import { resolveBrandIdSubquery } from "./tenant-brand-resolver";

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
  const { rows: units } = await pool.query(`SELECT id, unit_ref FROM evidence_plan_units WHERE plan_id = $1`, [planId]);
  const matches = units.filter((unit: any) => normaliseUnitRef(unit.unit_ref) === norm);
  if (matches.length !== 1 || matches[0].id !== unitId) return 0;
  const { rows } = await pool.query(
    `SELECT id, unit_ref FROM evidence_plan_entries WHERE plan_id = $1 AND unit_id IS NULL AND unit_ref IS NOT NULL`, [planId]);
  const ids = rows.filter((r: any) => normaliseUnitRef(r.unit_ref) === norm).map((r: any) => r.id);
  if (!ids.length) return 0;
  const updated = await pool.query(`UPDATE evidence_plan_entries SET unit_id = $1 WHERE id = ANY($2::uuid[]) AND plan_id = $3 AND unit_id IS NULL`, [unitId, ids, planId]);
  return updated.rowCount || 0;
}

// Tenant-name normalisation for evidence↔unit matching: plans often label
// a block with the trading name while TAFs carry the unit ref, so names
// are the join when refs don't meet.
const normTenantName = (s: any) => String(s || "").toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]/g, "");
// Corporate-suffix-stripped variant so plan labels meet the schedule's
// legal entity names: "EE Ltd" → "EE", "Apple Retail UK Ltd" → "APPLE".
const stripCoName = (s: any) => normTenantName(
  String(s || "").replace(/\b(limited|ltd|plc|llp|inc|co|company|group|holdings?|international|europe|uk|gb|retail|stores)\b\.?,?/gi, " ")
);

export class EvidencePlanError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validateEvidenceUnitPatch(body: any): Record<string, any> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new EvidencePlanError(400, "A unit update is required");
  const patch: Record<string, any> = {};
  for (const key of ["unitRef", "tenantName", "notes", "levelId"]) {
    if (!(key in body)) continue;
    if (body[key] !== null && typeof body[key] !== "string") throw new EvidencePlanError(400, `${key} must be text`);
    const value = body[key]?.trim() || null;
    if (key === "unitRef" && !value) throw new EvidencePlanError(400, "Unit ref is required");
    if (key === "levelId" && value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new EvidencePlanError(400, "Choose a valid plan level");
    if (value && value.length > (key === "notes" ? 40000 : key === "unitRef" ? 80 : 500)) throw new EvidencePlanError(400, `${key} is too long`);
    patch[key] = value;
  }
  for (const key of ["leaseExpiry", "breakDate", "reviewDate"]) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === "") { patch[key] = null; continue; }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new EvidencePlanError(400, `${key} must be a valid date`);
    patch[key] = value;
  }
  for (const key of ["erv", "passingRent", "sqft"]) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null || raw === "") { patch[key] = null; continue; }
    if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && !raw.trim())
      || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new EvidencePlanError(400, `${key} must be a non-negative number`);
    patch[key] = Number(raw);
  }
  if ("polygon" in body) {
    if (body.polygon !== null && !isValidPolygon(body.polygon)) throw new EvidencePlanError(400, "Draw a valid, non-crossing outline inside the plan");
    patch.polygon = body.polygon;
  }
  if ("dot" in body) {
    const dot = body.dot;
    if (dot !== null && (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)
      || dot.x < 0 || dot.x > 1 || dot.y < 0 || dot.y > 1)) throw new EvidencePlanError(400, "The marker must be a point inside the plan");
    patch.dot = dot === null ? null : { x: dot.x, y: dot.y };
  }
  return patch;
}

export async function evidenceScheduleRows(propertyId: string | null, db: any = pool): Promise<any[]> {
  if (!propertyId) return [];
  return (await db.query(`SELECT id, property_id, unit_number, trading_name, tenant_name, floor_level,
    lease_expiry, break_date, next_review_date, erv_pa, passing_rent_pa, nia_sqft, gia_sqft,
    permitted_use, premises, updated_at FROM tenancy_schedule_units WHERE property_id = $1 ORDER BY unit_number, id`, [propertyId])).rows;
}

export function matchEvidenceScheduleRow(unit: any, rows: any[]): { row: any | null; method: "ref" | "tenant" | null } {
  const norm = normaliseUnitRef(unit.unit_ref);
  const exact = norm ? rows.filter(row => normaliseUnitRef(row.unit_number) === norm) : [];
  if (exact.length) return { row: exact.length === 1 ? exact[0] : null, method: exact.length === 1 ? "ref" : null };
  // An explicit different unit number is not evidence for another shop held
  // by the same tenant. Name matching is only a fallback for name-only labels.
  if (/\d/.test(String(unit.unit_ref || ""))) return { row: null, method: null };
  const names = new Set([stripCoName(unit.tenant_name), stripCoName(unit.unit_ref)].filter(name => name.length >= 3));
  const candidates = rows.filter(row => names.has(stripCoName(row.trading_name)) || names.has(stripCoName(row.tenant_name)));
  const retail = candidates.filter(row => !/storage|store\s*cage|container|car\s*park|atm|substation|advert|barrow|locker|sprinkler|plant/i
    .test(`${row.permitted_use || ""} ${row.unit_number || ""} ${row.premises || ""}`));
  const unique = retail.length ? retail : candidates;
  return { row: unique.length === 1 ? unique[0] : null, method: unique.length === 1 ? "tenant" : null };
}

export function presentEvidenceUnit(unit: any, scheduleRows: any[]): any {
  const match = matchEvidenceScheduleRow(unit, scheduleRows);
  const schedule = match.row;
  const metadata = { unit_norm: normaliseUnitRef(unit.unit_ref), ts_linked: !!schedule,
    ts_row_id: schedule?.id || null, ts_match_method: match.method, ts_unit_ref: schedule?.unit_number || null };
  if (!schedule) return { ...unit, ...metadata };
  // Canonical blank values stay blank; a deleted schedule fact must not be
  // resurrected from an old local import on the next load.
  return { ...unit, ...metadata, tenant_name: schedule.trading_name || schedule.tenant_name || null,
    lease_expiry: schedule.lease_expiry, break_date: schedule.break_date,
    review_date: schedule.next_review_date, erv: schedule.erv_pa, passing_rent: schedule.passing_rent_pa,
    sqft: schedule.nia_sqft ?? schedule.gia_sqft ?? null };
}

// Plan-wide sweep: link every unlinked entry to a unit by ref, or by
// tenant name when exactly one unit carries that tenant. Idempotent —
// runs after detection/extraction jobs and on plan load.
async function relinkAllEntries(planId: string, db: any = pool): Promise<number> {
  const { rows: units } = await db.query(`SELECT id, unit_ref, tenant_name FROM evidence_plan_units WHERE plan_id = $1`, [planId]);
  const { rows: entries } = await db.query(`SELECT id, unit_ref, tenant FROM evidence_plan_entries WHERE plan_id = $1 AND unit_id IS NULL`, [planId]);
  if (units.length === 0 || entries.length === 0) return 0;
  const { rows: plans } = await db.query(`SELECT property_id FROM evidence_plans WHERE id = $1`, [planId]);
  const schedule = await evidenceScheduleRows(plans[0]?.property_id || null, db);
  const byRef = new Map<string, string | null>();
  const byTenant = new Map<string, string | null>(); // null = ambiguous
  for (const u of units) {
    const r = normaliseUnitRef(u.unit_ref);
    for (const ref of [r, normaliseUnitRef(matchEvidenceScheduleRow(u, schedule).row?.unit_number || "")]) {
      if (ref) byRef.set(ref, byRef.has(ref) && byRef.get(ref) !== u.id ? null : u.id);
    }
    for (const nm of [u.tenant_name, u.unit_ref]) {
      for (const t of [normTenantName(nm), stripCoName(nm)]) {
        if (!t || t.length < 3 || /^\d+$/.test(t)) continue;
        byTenant.set(t, byTenant.has(t) && byTenant.get(t) !== u.id ? null : u.id);
      }
    }
  }
  let linked = 0;
  for (const e of entries) {
    let uid = e.unit_ref ? byRef.get(normaliseUnitRef(e.unit_ref)) : undefined;
    const refIsName = !e.unit_ref || normTenantName(e.unit_ref) === normTenantName(e.tenant);
    if (!uid && refIsName && e.tenant) uid = byTenant.get(normTenantName(e.tenant)) || byTenant.get(stripCoName(e.tenant)) || undefined;
    if (uid) {
      const updated = await db.query(`UPDATE evidence_plan_entries SET unit_id = $1 WHERE id = $2 AND plan_id = $3 AND unit_id IS NULL`, [uid, e.id, planId]);
      linked += updated.rowCount || 0;
    }
  }
  if (linked) console.log(`[evidence-plan] relink sweep on ${planId}: ${linked} entries linked`);
  return linked;
}

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
        if (!isValidPolygon(poly)) continue;
        const frontage = frontageDot(raw, W, H, box);
        const dot = frontage && pointInPolygon(frontage, poly) ? frontage : interiorPoint(poly);
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)) {
    res.status(400).json({ error: "Invalid plan ID" }); return null;
  }
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

router.get("/api/evidence-plans/:id", requireAuth, async (req: Request, res: Response, next) => {
  // Keep the existing source-file endpoint reachable instead of treating
  // "source" as a plan UUID.
  if (req.params.id === "source") return next();
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const levels = await healLevels(plan);
    await relinkAllEntries(plan.id);
    await healFrontageDots(plan.id).catch(() => {});
    const [unitsQ, entries, scheduleRows, prop, matterRows, running] = await Promise.all([
      pool.query(`SELECT * FROM evidence_plan_units WHERE plan_id = $1 ORDER BY unit_ref`, [plan.id]),
      pool.query(`SELECT * FROM evidence_plan_entries WHERE plan_id = $1 ORDER BY transaction_date DESC NULLS LAST, created_at DESC`, [plan.id]),
      evidenceScheduleRows(plan.property_id),
      plan.property_id ? pool.query(`SELECT name FROM crm_properties WHERE id = $1`, [plan.property_id]) : Promise.resolve({ rows: [] }),
      plan.property_id ? pool.query(`SELECT m.id, m.matter_type, m.status, m.acting_for, pu.unit_name
        FROM pla_matters m LEFT JOIN property_units pu ON pu.id = m.unit_id
        WHERE m.property_id = $1 ORDER BY m.opened_at DESC`, [plan.property_id]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
      pool.query(`SELECT id, kind, level_id, total_docs, done_docs FROM evidence_plan_jobs
        WHERE plan_id = $1 AND status = 'running' AND created_at > now() - interval '2 hours'`, [plan.id]).catch(() => ({ rows: [] })),
    ]);
    // Reading a plan never changes a saved label to a guessed schedule ref.
    // The matched row and alternatives let staff explicitly review the link.
    const units = unitsQ.rows.map(unit => presentEvidenceUnit(unit, scheduleRows));
    const matters = matterRows.rows.map((matter: any) => ({ ...matter,
      unit_norm: matter.unit_name ? normaliseUnitRef(matter.unit_name) : null }));
    res.json({ plan: { ...plan, property_name: prop.rows[0]?.name || null }, levels, units,
      schedule_rows: scheduleRows, entries: entries.rows, matters, jobs: running.rows });
  } catch (e: any) { res.status(e instanceof EvidencePlanError ? e.status : 500).json({ error: e.message }); }
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
      if (req.body.propertyId) {
        const property = await pool.query(`SELECT id FROM crm_properties WHERE id = $1`, [req.body.propertyId]);
        if (!property.rows.length) return res.status(400).json({ error: "Choose an existing CRM property" });
      }
      vals.push(req.body.propertyId || null);
      sets.push(`property_id = $${vals.length}`);
    }
    if ("dotColours" in (req.body || {})) {
      const colours = req.body.dotColours;
      if (colours !== null && (!colours || typeof colours !== "object" || Array.isArray(colours)
        || Object.entries(colours).some(([key, value]) => !["OML", "LR", "RR", "RG", "OTHER"].includes(key)
          || typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)))) {
        return res.status(400).json({ error: "Choose valid colours for the evidence key" });
      }
      vals.push(req.body.dotColours ? JSON.stringify(req.body.dotColours) : null);
      sets.push(colours === null ? `dot_colours = $${vals.length}::jsonb` : `dot_colours = COALESCE(dot_colours, '{}'::jsonb) || $${vals.length}::jsonb`);
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
  let db: any = null;
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
    db = await pool.connect();
    await db.query("BEGIN");
    const current = (await db.query(`SELECT background_key FROM evidence_plan_levels WHERE id = $1 FOR UPDATE`, [levelId])).rows[0];
    if (!current || current.background_key !== level.background_key) throw new EvidencePlanError(409, "The plan image changed while cropping. Reload this level and try again.");
    const { rows: units } = await db.query(`SELECT id, polygon, dot FROM evidence_plan_units WHERE level_id = $1 FOR UPDATE`, [levelId]);
    if (units.some((unit: any) => Array.isArray(unit.polygon) && unit.polygon.some((point: any) =>
      point.x < x0 - 1e-6 || point.x > x1 + 1e-6 || point.y < y0 - 1e-6 || point.y > y1 + 1e-6))) {
      throw new EvidencePlanError(409, "This crop would cut off a saved unit outline. Keep all units inside the crop, or correct those outlines first.");
    }
    await saveFile(key, buf, "image/jpeg", "cropped-plan.jpg");
    await db.query(
      `UPDATE evidence_plan_levels SET background_key=$1, background_width=$2, background_height=$3 WHERE id=$4`,
      [key, region.width, region.height, levelId]);

    // Remap this level's geometry into the cropped frame.
    const map = (p: any) => ({ x: (p.x - x0) / sw, y: (p.y - y0) / sh });
    for (const u of units) {
      const polygon = Array.isArray(u.polygon) ? u.polygon.map(map) : u.polygon;
      const dot = u.dot && typeof u.dot.x === "number" ? map(u.dot) : u.dot;
      await db.query(`UPDATE evidence_plan_units SET polygon = $1, dot = $2 WHERE id = $3`,
        [polygon ? JSON.stringify(polygon) : null, dot ? JSON.stringify(dot) : null, u.id]);
    }
    // Keep the plan-row mirror in sync when this is the first level.
    const levels = (await db.query(`SELECT id FROM evidence_plan_levels WHERE plan_id = $1 ORDER BY sort_order, created_at`, [level.plan_id])).rows;
    if (levels[0]?.id === levelId) {
      await db.query(
        `UPDATE evidence_plans SET background_key=$1, background_width=$2, background_height=$3, updated_at=now() WHERE id=$4`,
        [key, region.width, region.height, level.plan_id]);
    }
    await db.query("COMMIT");
    res.json({ ok: true, width: region.width, height: region.height, remapped: units.length });
  } catch (e: any) {
    if (db) await db.query("ROLLBACK");
    res.status(e instanceof EvidencePlanError ? e.status : 500).json({ error: e.message });
  } finally { db?.release(); }
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
  let db: any = null;
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    const patch = validateEvidenceUnitPatch(req.body);
    const unitRef = patch.unitRef;
    if (!unitRef) return res.status(400).json({ error: "unitRef is required" });
    db = await pool.connect();
    await db.query("BEGIN");
    if (patch.levelId) {
      const level = await db.query(`SELECT id, background_key FROM evidence_plan_levels WHERE id = $1 AND plan_id = $2 FOR UPDATE`, [patch.levelId, plan.id]);
      if (!level.rows.length) throw new EvidencePlanError(400, "Choose a level from this evidence plan");
      if ("expectedBackgroundKey" in req.body && req.body.expectedBackgroundKey !== level.rows[0].background_key) throw new EvidencePlanError(409, "The plan image changed while drawing. Reload the level and draw against the current image.");
    } else if ("expectedBackgroundKey" in req.body) {
      throw new EvidencePlanError(400, "Choose a level before drawing an outline");
    }
    if (patch.dot && (!isValidPolygon(patch.polygon) || !pointInPolygon(patch.dot, patch.polygon))) {
      throw new EvidencePlanError(400, "Keep the marker inside this unit's outline");
    }
    const schedule = await evidenceScheduleRows(plan.property_id, db);
    const matched = matchEvidenceScheduleRow({ unit_ref: unitRef, tenant_name: patch.tenantName }, schedule).row;
    if (matched && ["leaseExpiry", "breakDate", "reviewDate", "erv", "passingRent", "sqft"].some(key => key in patch)) {
      throw new EvidencePlanError(409, "Create the outline first, then review and edit its linked tenancy-schedule facts");
    }
    patch.dot = patch.dot || (isValidPolygon(patch.polygon) ? interiorPoint(patch.polygon) : null);
    const keys = Object.keys(patch);
    const values = [plan.id, ...keys.map(key => key === "polygon" || key === "dot" ? patch[key] === null ? null : JSON.stringify(patch[key]) : patch[key])];
    const { rows } = await db.query(`INSERT INTO evidence_plan_units (plan_id, ${keys.map(key => UNIT_FIELDS[key]).join(", ")}, source)
      VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")}, 'manual') RETURNING *`, values);
    const adopted = await relinkAllEntries(plan.id, db);
    await db.query("COMMIT");
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]);
    res.json({ ...rows[0], adopted });
  } catch (e: any) {
    if (db) await db.query("ROLLBACK");
    res.status(e instanceof EvidencePlanError ? e.status : 500).json({ error: e.message });
  } finally { db?.release(); }
});

const UNIT_FIELDS: Record<string, string> = {
  unitRef: "unit_ref", tenantName: "tenant_name", polygon: "polygon", dot: "dot", levelId: "level_id",
  leaseExpiry: "lease_expiry", breakDate: "break_date", reviewDate: "review_date",
  erv: "erv", passingRent: "passing_rent", sqft: "sqft", notes: "notes",
};

export async function saveEvidenceUnit(
  unitId: string, body: any, canEditProperty: (propertyId: string | null) => Promise<boolean>,
): Promise<any> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unitId)) throw new EvidencePlanError(400, "Invalid unit ID");
  const patch = validateEvidenceUnitPatch(body);
  const linking = "linkScheduleRowId" in body;
  if (!Object.keys(patch).length && !linking) throw new EvidencePlanError(400, "Nothing to update");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const before = (await db.query(`SELECT plan_id, level_id FROM evidence_plan_units WHERE id = $1`, [unitId])).rows[0];
    if (!before) throw new EvidencePlanError(404, "Unit not found");
    // Detection/cropping take the level lock first too, so edits cannot race
    // a background-frame change or be overwritten by an in-flight scan.
    const levelIds = [...new Set([before.level_id, patch.levelId].filter(Boolean))];
    const levels = levelIds.length ? (await db.query(`SELECT id, plan_id, background_key FROM evidence_plan_levels
      WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [levelIds])).rows : [];
    const unit = (await db.query(`SELECT * FROM evidence_plan_units WHERE id = $1 FOR UPDATE`, [unitId])).rows[0];
    if (!unit || unit.level_id !== before.level_id) throw new EvidencePlanError(409, "The unit moved to another level. Reload the plan before saving.");
    if (patch.levelId && !levels.some((level: any) => level.id === patch.levelId && level.plan_id === unit.plan_id)) {
      throw new EvidencePlanError(400, "Choose a level from this evidence plan");
    }
    if ("expectedBackgroundKey" in body) {
      const level = levels.find((row: any) => row.id === (patch.levelId || unit.level_id));
      if (!level || body.expectedBackgroundKey !== level.background_key) throw new EvidencePlanError(409, "The plan image changed while editing. Reload this level before saving the outline or marker.");
    }
    const plan = (await db.query(`SELECT * FROM evidence_plans WHERE id = $1 FOR SHARE`, [unit.plan_id])).rows[0];
    if (!plan) throw new EvidencePlanError(404, "Plan not found");
    if (!(await canEditProperty(plan.property_id))) throw new EvidencePlanError(403, "Not available for this account");
    // Lock this property's schedule before matching, including duplicate refs,
    // then validate the row the editor actually displayed before any updates.
    if (plan.property_id) await db.query(`SELECT id FROM tenancy_schedule_units WHERE property_id = $1 ORDER BY id FOR UPDATE`, [plan.property_id]);
    const schedule = await evidenceScheduleRows(plan.property_id, db);
    const current = matchEvidenceScheduleRow(unit, schedule).row;
    let matched = current;
    if (linking) {
      if (!("expectedScheduleRowId" in body) || (body.expectedScheduleRowId ?? null) !== (current?.id ?? null)) {
        throw new EvidencePlanError(409, "The schedule match has changed. Reload the plan and review the link again.");
      }
      const target = schedule.find((row: any) => row.id === body.linkScheduleRowId);
      if (!target) throw new EvidencePlanError(409, "That schedule row is no longer on this property. Reload the schedule choices.");
      const ref = String(target.unit_number || "").trim();
      const normalised = normaliseUnitRef(ref);
      if (!normalised || schedule.filter((row: any) => normaliseUnitRef(row.unit_number) === normalised).length !== 1) {
        throw new EvidencePlanError(409, "This schedule reference is missing or duplicated. Give the schedule rows distinct references before linking.");
      }
      const siblings = (await db.query(`SELECT id, unit_ref FROM evidence_plan_units WHERE plan_id = $1 AND id <> $2`, [plan.id, unit.id])).rows;
      if (siblings.some((row: any) => normaliseUnitRef(row.unit_ref) === normalised)) {
        throw new EvidencePlanError(409, "Another outline already uses that schedule reference. Review the existing outline before linking.");
      }
      patch.unitRef = ref;
      matched = target;
    }
    if ("scheduleRowId" in body && (body.scheduleRowId ?? null) !== (current?.id ?? null)) {
      throw new EvidencePlanError(409, "The linked schedule row has changed. Reload this unit before editing its facts.");
    }
    const factMap: Record<string, string> = {
      tenantName: "trading_name", leaseExpiry: "lease_expiry", breakDate: "break_date", reviewDate: "next_review_date",
      erv: "erv_pa", passingRent: "passing_rent_pa", sqft: matched?.nia_sqft != null || matched?.gia_sqft == null ? "nia_sqft" : "gia_sqft",
    };
    const factKeys = Object.keys(factMap).filter(key => key in patch);
    if (matched && factKeys.length && (body.scheduleRowId !== matched.id || linking && current?.id !== matched.id)) {
      throw new EvidencePlanError(409, "These facts belong to the linked tenancy schedule. Review the current schedule row before saving.");
    }
    const polygon = "polygon" in patch ? patch.polygon : unit.polygon;
    if ("dot" in patch && patch.dot && (!isValidPolygon(polygon) || !pointInPolygon(patch.dot, polygon))) {
      throw new EvidencePlanError(400, "Keep the marker inside this unit's outline");
    }
    if ("polygon" in patch && isValidPolygon(polygon) && !("dot" in patch)
      && (!unit.dot || !pointInPolygon(unit.dot, polygon))) patch.dot = interiorPoint(polygon);
    if ("polygon" in patch && polygon === null) patch.dot = null;
    if (matched && factKeys.length) {
      const values = factKeys.map(key => patch[key]);
      const assignments = factKeys.map((key, index) => `${factMap[key]} = $${index + 1}`);
      values.push(matched.id);
      await db.query(`UPDATE tenancy_schedule_units SET ${assignments.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
      if ("tenantName" in patch) {
        await db.query(`UPDATE tenancy_schedule_units SET tenant_company_id = ${resolveBrandIdSubquery("coalesce(trading_name, tenant_name, '')")} WHERE id = $1`, [matched.id]);
      }
    }
    const localKeys = Object.keys(patch).filter(key => !matched || !(key in factMap) || key === "tenantName");
    const values = localKeys.map(key => key === "polygon" || key === "dot" ? patch[key] === null ? null : JSON.stringify(patch[key]) : patch[key]);
    const assignments = localKeys.map((key, index) => `${UNIT_FIELDS[key]} = $${index + 1}`);
    assignments.push("source = 'manual'", "updated_at = now()");
    values.push(unit.id);
    const saved = (await db.query(`UPDATE evidence_plan_units SET ${assignments.join(", ")} WHERE id = $${values.length} RETURNING *`, values)).rows[0];
    const refreshedSchedule = await evidenceScheduleRows(plan.property_id, db);
    await relinkAllEntries(plan.id, db);
    await db.query("COMMIT");
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]).catch(error => console.warn("[evidence-plan] plan timestamp update failed:", error.message));
    return presentEvidenceUnit(saved, refreshedSchedule);
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

router.put("/api/evidence-plans/units/:unitId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
    const scope = await resolveCompanyScope(req as any);
    res.json(await saveEvidenceUnit(String(req.params.unitId), req.body,
      async propertyId => !scope || !!propertyId && await isPropertyInScope(scope, propertyId)));
  } catch (e: any) { res.status(e instanceof EvidencePlanError ? e.status : 500).json({ error: e.message }); }
});

router.delete("/api/evidence-plans/units/:unitId", requireAuth, async (req: Request, res: Response) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const unitId = String(req.params.unitId);
    const unit = (await db.query(`SELECT id, plan_id FROM evidence_plan_units WHERE id = $1 FOR UPDATE`, [unitId])).rows[0];
    if (!unit) throw new EvidencePlanError(404, "Unit not found");
    await db.query(`UPDATE evidence_plan_entries SET unit_id = NULL WHERE unit_id = $1`, [unitId]);
    await db.query(`DELETE FROM evidence_plan_units WHERE id = $1`, [unitId]);
    await db.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [unit.plan_id]);
    await db.query("COMMIT");
    res.json({ ok: true });
  } catch (e: any) {
    await db.query("ROLLBACK");
    res.status(e instanceof EvidencePlanError ? e.status : 500).json({ error: e.message });
  } finally { db.release(); }
});

// ── Evidence entries ─────────────────────────────────────────────────────
const ENTRY_FIELDS: Record<string, string> = {
  unitId: "unit_id", unitRef: "unit_ref", tenant: "tenant",
  transactionType: "transaction_type", transactionDate: "transaction_date",
  sizeSqft: "size_sqft", zoneA: "zone_a", itza: "itza",
  headlineRent: "headline_rent", netEffective: "net_effective",
  term: "term", concession: "concession", notes: "notes",
};

export function validateEvidenceEntryPatch(body: any): Record<string, any> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new EvidencePlanError(400, "Evidence details are required");
  const patch: Record<string, any> = {};
  for (const key of Object.keys(ENTRY_FIELDS)) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === "" || raw === null) { patch[key] = null; continue; }
    if (["sizeSqft", "zoneA", "itza", "headlineRent", "netEffective"].includes(key)) {
      patch[key] = validateEvidenceUnitPatch({ erv: raw }).erv;
    } else if (key === "transactionDate") {
      patch[key] = validateEvidenceUnitPatch({ leaseExpiry: raw }).leaseExpiry;
    } else {
      if (typeof raw !== "string" || raw.length > (key === "notes" ? 40000 : 4000)) throw new EvidencePlanError(400, `${key} must be text`);
      patch[key] = raw.trim() || null;
      if (key === "unitId" && patch[key] && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patch[key])) throw new EvidencePlanError(400, "Choose a valid plan unit");
    }
  }
  if (!Object.keys(patch).length) throw new EvidencePlanError(400, "Add some evidence details before saving");
  return patch;
}

export async function saveEvidenceEntry(planId: string | null, entryId: string | null, body: any, userId: string | null): Promise<any> {
  const patch = validateEvidenceEntryPatch(body);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const before = entryId ? (await db.query(`SELECT * FROM evidence_plan_entries WHERE id = $1`, [entryId])).rows[0] : null;
    const unitIds = [...new Set([before?.unit_id, patch.unitId].filter(Boolean))];
    if (unitIds.length) await db.query(`SELECT id FROM evidence_plan_units WHERE id = ANY($1::uuid[]) ORDER BY id FOR KEY SHARE`, [unitIds]);
    const existing = entryId ? (await db.query(`SELECT * FROM evidence_plan_entries WHERE id = $1 FOR UPDATE`, [entryId])).rows[0] : null;
    if (entryId && !existing) throw new EvidencePlanError(404, "Entry not found");
    if (existing && existing.unit_id !== before?.unit_id) throw new EvidencePlanError(409, "This evidence was moved to another unit. Reload it before saving.");
    const targetPlan = existing?.plan_id || planId;
    const plan = (await db.query(`SELECT id FROM evidence_plans WHERE id = $1 FOR SHARE`, [targetPlan])).rows[0];
    if (!plan) throw new EvidencePlanError(404, "Plan not found");
    if (patch.unitId) {
      const unit = (await db.query(`SELECT id, unit_ref FROM evidence_plan_units WHERE id = $1 AND plan_id = $2 FOR KEY SHARE`, [patch.unitId, plan.id])).rows[0];
      if (!unit) throw new EvidencePlanError(400, "Choose a unit from this evidence plan");
      if (!("unitRef" in patch) && !existing) patch.unitRef = unit.unit_ref;
    }
    const keys = Object.keys(patch);
    const values = keys.map(key => patch[key]);
    let result;
    if (entryId) {
      values.push(entryId);
      result = await db.query(`UPDATE evidence_plan_entries SET ${keys.map((key, index) => `${ENTRY_FIELDS[key]} = $${index + 1}`).join(", ")}
        WHERE id = $${values.length} RETURNING *`, values);
    } else {
      values.push(plan.id, userId);
      result = await db.query(`INSERT INTO evidence_plan_entries (${keys.map(key => ENTRY_FIELDS[key]).join(", ")}, plan_id, created_by)
        VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`, values);
    }
    await db.query("COMMIT");
    await pool.query(`UPDATE evidence_plans SET updated_at = now() WHERE id = $1`, [plan.id]).catch(error => console.warn("[evidence-plan] plan timestamp update failed:", error.message));
    return result.rows[0];
  } catch (error) {
    await db.query("ROLLBACK"); throw error;
  } finally { db.release(); }
}

router.post("/api/evidence-plans/:id/entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planOr404(String(req.params.id), res);
    if (!plan) return;
    res.json(await saveEvidenceEntry(plan.id, null, req.body, (req as any).session?.userId || (req as any).tokenUserId || null));
  } catch (e: any) { res.status(e instanceof EvidencePlanError ? e.status : 500).json({ error: e.message }); }
});

router.put("/api/evidence-plans/entries/:entryId", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await saveEvidenceEntry(null, String(req.params.entryId), req.body, (req as any).session?.userId || (req as any).tokenUserId || null));
  } catch (e: any) { res.status(e instanceof EvidencePlanError ? e.status : 500).json({ error: e.message }); }
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
// and returns interior seeds and printed labels. The actual enclosed pixels
// supply each outline, which adopts its waiting evidence. Grounded with unit
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

const DETECT_PROMPT = (known: string[], overview = false) => `This is ${overview ? "the whole level" : "part of one level"} of a UK shopping centre letting plan. Magenta grid lines mark 0.1 intervals of THIS image.

Find lettable shops, restaurants and kiosks, including white/pale units and large anchor stores. Give an interior seed on the unit's filled floor area, away from text, walls and the mall. The seed will be used to trace the actual enclosed pixels. ${overview ? "Include large units and units crossing the middle of the plan. Return seeds only; this pass covers units that may be cut across close-up tiles." : "A unit may cross the tile edge: report it if its label and a reliable interior seed are visible. Add a polygon following its visible walls ONLY if its complete outline is visible. Never substitute an approximate rectangle for an irregular outline."}

Ignore page borders, legends, title/contact panels, text-only kiosk lists, malls, toilets, stairs, lifts, car parks, arrows and annotation boxes. Do not assign known refs to shapes by guesswork. Read the printed label; use null for a ref when only the tenant is visible.

Return JSON only:
{"units":[{"unitRef":"E7A","tenant":"Example tenant","seed":{"x":0.35,"y":0.47}${overview ? "" : ',"polygon":[{"x":0.31,"y":0.42},{"x":0.38,"y":0.42},{"x":0.38,"y":0.51},{"x":0.31,"y":0.51}]'}}]}

All x/y fractions are 0..1 in THIS image, x rightwards, y downwards. ${known.length ? `Known scheme refs (use only when the printed label matches): ${known.join(", ")}` : ""}`;

async function detectTile(sharp: any, planImage: Buffer, W: number, H: number, ox: number, oy: number, fw: number, fh: number, known: string[], overview = false): Promise<import("./plan-unit-detection").DetectedPlanUnit[]> {
  const { mapDetectedPlanUnits } = await import("./plan-unit-detection");
  const left = Math.round(ox * W), top = Math.round(oy * H);
  const width = Math.min(W - left, Math.round(fw * W)), height = Math.min(H - top, Math.round(fh * H));
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * scale)), th = Math.max(1, Math.round(height * scale));
  const lines: string[] = [];
  for (let i = 1; i < 10; i++) {
    lines.push(`<line x1="${i / 10 * tw}" y1="0" x2="${i / 10 * tw}" y2="${th}" stroke="magenta" stroke-width="1" opacity="0.5"/>`);
    lines.push(`<line x1="0" y1="${i / 10 * th}" x2="${tw}" y2="${i / 10 * th}" stroke="magenta" stroke-width="1" opacity="0.5"/>`);
    lines.push(`<text x="${i / 10 * tw + 2}" y="12" font-size="11" fill="magenta">${(i / 10).toFixed(1)}</text>`);
    lines.push(`<text x="2" y="${i / 10 * th - 2}" font-size="11" fill="magenta">${(i / 10).toFixed(1)}</text>`);
  }
  const grid = Buffer.from(`<svg width="${tw}" height="${th}" xmlns="http://www.w3.org/2000/svg">${lines.join("")}</svg>`);
  const tile = await sharp(planImage).extract({ left, top, width, height })
    .resize({ width: tw, height: th }).composite([{ input: grid, top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 16000,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: tile.toString("base64") } },
      { type: "text", text: DETECT_PROMPT(known, overview) },
    ] }],
  });
  if (msg.stop_reason === "max_tokens") throw new Error("Detection reply was incomplete");
  const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const parsed = extractJsonObject(text);
  if (!parsed) throw new Error("Detection reply was not valid JSON");
  return mapDetectedPlanUnits(parsed, { x: left / W, y: top / H, width: width / W, height: height / H });
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

async function runDetectJob(planId: string, jobId: string, level: any, propertyId: string | null, _refresh = false): Promise<void> {
  const bump = (sets: string, vals: any[]) =>
    pool.query(`UPDATE evidence_plan_jobs SET ${sets}, updated_at = now() WHERE id = $${vals.length + 1}`, [...vals, jobId]).catch(() => {});
  try {
    const { tracePlanUnit } = await import("./plan-unit-detection");
    const { isValidPolygon, pointInPolygon, polygonArea, boundaryDistance } = await import("@shared/plan-geometry");
    const file = await getFile(level.background_key);
    if (!file) throw new Error("Level has no plan image");
    const sharp = (await import("sharp")).default;
    const meta = await sharp(file.data).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    if (!W || !H) throw new Error("Couldn't read the plan image");
    const raster = await sharp(file.data).resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const raw = { data: raster.data, width: raster.info.width, height: raster.info.height };
    const known = new Set<string>();
    const tenantToRef = new Map<string, string | null>();
    if (propertyId) {
      const ts = await pool.query(`SELECT unit_number, trading_name, tenant_name FROM tenancy_schedule_units WHERE property_id = $1`, [propertyId]);
      for (const r of ts.rows) {
        const ref = r.unit_number ? String(r.unit_number).replace(/^unit\s+/i, "").trim() : null;
        if (!ref) continue;
        known.add(ref);
        for (const nm of [r.trading_name, r.tenant_name]) {
          const key = normTenantName(nm);
          if (!key || key.length < 3) continue;
          if (!tenantToRef.has(key)) tenantToRef.set(key, ref);
          else if (tenantToRef.get(key) !== ref) tenantToRef.set(key, null);
        }
      }
    }
    const ev = await pool.query(`SELECT DISTINCT unit_ref FROM evidence_plan_entries WHERE plan_id = $1 AND unit_ref IS NOT NULL`, [planId]);
    for (const r of ev.rows) known.add(String(r.unit_ref));
    const knownList = [...known].slice(0, 500);
    const frames = [{ ox: 0, oy: 0, fw: 1, fh: 1, overview: true },
      ...[0, .3, .6].flatMap(oy => [0, .3, .6].map(ox => ({ ox, oy, fw: .4, fh: .4, overview: false })))];
    const found: import("./plan-unit-detection").DetectedPlanUnit[] = [];
    let failedTiles = 0;
    for (const frame of frames) {
      let got: import("./plan-unit-detection").DetectedPlanUnit[] | null = null;
      for (let attempt = 0; attempt < 2 && got === null; attempt++) {
        try { got = await detectTile(sharp, file.data, W, H, frame.ox, frame.oy, frame.fw, frame.fh, knownList, frame.overview); }
        catch (error: any) {
          if (attempt === 1) { failedTiles++; console.error(`[evidence-plan] tile failed twice:`, error?.message); }
        }
      }
      if (got) found.push(...got);
    }
    if (!found.length) throw new Error("No units could be read on this level. Existing outlines and information are unchanged.");
    const candidates: { ref: string; printedRef: boolean; conflictingLabel: boolean; tenant: string | null; polygon: { x: number; y: number }[]; dot: { x: number; y: number } }[] = [];
    let untraced = 0;
    for (const candidate of found) {
      let ref = candidate.unitRef || "";
      if (!ref && candidate.tenant) ref = tenantToRef.get(normTenantName(candidate.tenant)) || candidate.tenant;
      else if (ref && !/\d/.test(ref)) ref = tenantToRef.get(normTenantName(ref)) || ref;
      if (!normaliseUnitRef(ref)) continue;
      const traced = tracePlanUnit(raw, candidate.seed, candidate.polygon);
      if (!traced) { untraced++; continue; }
      const duplicate = candidates.find(existing => pointInPolygon(traced.dot, existing.polygon)
        && pointInPolygon(existing.dot, traced.polygon));
      if (duplicate) {
        // A tenant-only overview can be refined by a printed close-up ref.
        // Conflicting printed refs on one shape need human review.
        if (candidate.unitRef && duplicate.printedRef && normaliseUnitRef(duplicate.ref) !== normaliseUnitRef(ref)) duplicate.conflictingLabel = true;
        else if (candidate.unitRef && !duplicate.printedRef) {
          duplicate.ref = ref.slice(0, 80); duplicate.printedRef = true;
        }
        continue;
      }
      candidates.push({ ref: ref.slice(0, 80), printedRef: Boolean(candidate.unitRef), conflictingLabel: false, tenant: candidate.tenant, polygon: traced.polygon, dot: traced.dot });
    }
    if (!candidates.length) throw new Error("Labels were found but no reliable closed unit outlines could be traced. Existing units are unchanged; click inside a unit or draw its outline.");
    const refCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const key = normaliseUnitRef(candidate.ref);
      refCounts.set(key, (refCounts.get(key) || 0) + 1);
    }
    const ambiguous = new Set([...refCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
    for (const candidate of candidates) if (candidate.conflictingLabel) ambiguous.add(normaliseUnitRef(candidate.ref));
    const connection = await pool.connect();
    let created = 0, refined = 0, preserved = 0;
    try {
      await connection.query("BEGIN");
      const liveLevel = (await connection.query("SELECT background_key FROM evidence_plan_levels WHERE id = $1 AND plan_id = $2 FOR UPDATE", [level.id, planId])).rows[0];
      if (!liveLevel || liveLevel.background_key !== level.background_key) throw new Error("The plan image changed during scanning. Existing units are unchanged; scan the current image again.");
      const existing = (await connection.query("SELECT id, unit_ref, polygon, source FROM evidence_plan_units WHERE plan_id = $1 AND level_id = $2 FOR UPDATE", [planId, level.id])).rows;
      for (const candidate of candidates) {
        if (ambiguous.has(normaliseUnitRef(candidate.ref))) { preserved++; continue; }
        const sameRef = existing.filter(row => normaliseUnitRef(row.unit_ref) === normaliseUnitRef(candidate.ref));
        const overlaps = (row: any) => isValidPolygon(row.polygon) && (
          boundaryDistance(candidate.dot, row.polygon) > 1e-6
          || candidate.polygon.some(point => boundaryDistance(point, row.polygon) > 1e-6)
          || row.polygon.some((point: { x: number; y: number }) => boundaryDistance(point, candidate.polygon) > 1e-6)
        );
        if (sameRef.length) {
          const saved = sameRef.length === 1 ? sameRef[0] : null;
          const ratio = saved && isValidPolygon(saved.polygon) ? polygonArea(candidate.polygon) / polygonArea(saved.polygon) : 0;
          // Improve an earlier AI box only with one matching identity in
          // the same place. Preserve the row, saved marker and every fact /
          // evidence link. Explicit edits are source='manual' and protected.
          const canRefine = saved?.source === "ai" && ratio >= .2 && ratio <= 2.5
            && boundaryDistance(candidate.dot, saved.polygon) > 1e-6
            && !existing.some(row => row.id !== saved.id && overlaps(row));
          if (canRefine && JSON.stringify(saved.polygon) !== JSON.stringify(candidate.polygon)) {
            await connection.query("UPDATE evidence_plan_units SET polygon = $1 WHERE id = $2 AND source = 'ai'", [JSON.stringify(candidate.polygon), saved.id]);
            saved.polygon = candidate.polygon; refined++;
          } else preserved++;
          continue;
        }
        if (existing.some(overlaps)) { preserved++; continue; }
        if (polygonArea(candidate.polygon) <= 0) continue;
        const inserted = (await connection.query(`INSERT INTO evidence_plan_units
          (plan_id, level_id, unit_ref, tenant_name, polygon, source, dot)
          VALUES ($1,$2,$3,$4,$5,'ai',$6) RETURNING id, unit_ref, polygon, source`,
        [planId, level.id, candidate.ref, candidate.tenant, JSON.stringify(candidate.polygon), JSON.stringify(candidate.dot)])).rows[0];
        existing.push(inserted); created++;
      }
      await connection.query("UPDATE evidence_plans SET updated_at = now() WHERE id = $1", [planId]);
      await connection.query("COMMIT");
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
    const linked = await relinkAllEntries(planId);
    const details = [refined ? `${refined} existing AI outlines refined; saved information and marker positions kept` : "",
      failedTiles ? `${failedTiles} image sections could not be read` : "",
      untraced ? `${untraced} candidates lacked a reliable closed boundary` : "",
      ambiguous.size ? `${ambiguous.size} conflicting or repeated unit labels need review` : ""].filter(Boolean).join("; ");
    await bump("status = 'done', done_docs = 1, extracted = $1, created = $2, linked = $3, error = $4", [found.length, created, linked, details || null]);
    console.log(`[evidence-plan] scan ${jobId}: ${created} added, ${refined} AI outlines refined, ${preserved} saved units preserved, ${linked} evidence links`);
  } catch (e: any) {
    console.error(`[evidence-plan] detect job ${jobId} failed:`, e?.message);
    await bump(`status = 'error', error = $1`, [String(e?.message || e).slice(0, 500)]);
  }
}

// Click-to-trace is a preview only. The user supplies the unit reference
// and saves it through the existing unit editor after inspecting the shape.
router.post("/api/evidence-plans/levels/:levelId/trace-unit", requireAuth, async (req: Request, res: Response) => {
  try {
    const { tracePlanUnit } = await import("./plan-unit-detection");
    const x = req.body?.x, y = req.body?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return res.status(400).json({ error: "Click inside a unit on the plan." });
    const level = (await pool.query("SELECT background_key FROM evidence_plan_levels WHERE id = $1", [String(req.params.levelId)])).rows[0];
    if (!level?.background_key) return res.status(404).json({ error: "No plan image on this level." });
    const file = await getFile(level.background_key);
    if (!file) return res.status(404).json({ error: "Plan image missing." });
    const sharp = (await import("sharp")).default;
    const raster = await sharp(file.data).resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const traced = tracePlanUnit({ data: raster.data, width: raster.info.width, height: raster.info.height }, { x, y });
    if (!traced) return res.status(422).json({ error: "A reliable closed outline could not be traced here. Click a clear area inside the unit, or draw its outline." });
    res.json({ polygon: traced.polygon, dot: traced.dot, backgroundKey: level.background_key });
  } catch (error: any) { res.status(500).json({ error: error?.message || "Unit outline could not be traced." }); }
});

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

// Scan for missing units and improve uniquely matched AI outlines. Manual
// outlines, labels, marker positions, facts and evidence links are preserved.
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
