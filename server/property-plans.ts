// Property plans (Goad / leasing plan / agent PDF) — the visual
// version of the tenancy schedule. One row per FLOOR of a property
// in property_plans; polygons drawn on each plan live in
// property_plan_units and link back to the master property_units row.
//
// At render time we join the polygon → property_units → leasing
// schedule + available units + active deals, so the plan's colour
// + click-through is automatically driven by the live tenancy data.
// No double-entry — update a tenant's lease end in the schedule,
// the plan's marker for that polygon flips colour on next load.
//
// Status precedence (highest first):
//   1. ppu.status_override         — manual ("under_offer" before HoT)
//   2. an active deal exists       — "deal_in_progress"
//   3. lsu.lease_expiry / break    — "lease_event" if within 18 months
//   4. au.marketing_status         — "vacant" / "under_offer"
//   5. lsu.tenant_name present     — "occupied"
//   6. anything else               — "unknown"
import { Router, type Request, type Response } from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { saveFile, getFile } from "./file-storage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const EVENT_HORIZON_MS = 18 * 30 * 24 * 60 * 60 * 1000; // ~18 months

interface PolygonData {
  points: Array<[number, number]>;          // normalised 0-1
}

// ─── Plans CRUD ───────────────────────────────────────────────────────────

router.get("/api/properties/:propertyId/plans", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, property_id, floor, display_order, storage_key, width, height, source, notes, created_at, updated_at
         FROM property_plans
        WHERE property_id = $1
        ORDER BY display_order, floor`,
      [req.params.propertyId]
    );
    res.json({ plans: rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "list failed" });
  }
});

router.post("/api/properties/:propertyId/plans", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: "file required" });
    const floor = String(req.body?.floor || "Ground").trim();
    const source = String(req.body?.source || "leasing-plan").trim();
    const notes = req.body?.notes ? String(req.body.notes).trim() : null;
    const width = Number(req.body?.width) || null;
    const height = Number(req.body?.height) || null;

    const propertyId = req.params.propertyId;
    const planId = crypto.randomUUID();
    const ext = (file.mimetype || "image/png").includes("jpeg") ? "jpg" : "png";
    const storageKey = `property-plans/${propertyId}/${planId}.${ext}`;
    await saveFile(storageKey, file.buffer, file.mimetype || "image/png", file.originalname);

    const { rows } = await pool.query(
      `INSERT INTO property_plans (id, property_id, floor, source, notes, storage_key, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, property_id, floor, display_order, storage_key, width, height, source, notes, created_at, updated_at`,
      [planId, propertyId, floor, source, notes, storageKey, width, height]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "upload failed" });
  }
});

router.patch("/api/plans/:planId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { floor, source, notes, display_order, width, height } = req.body || {};
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (floor !== undefined) { sets.push(`floor = $${i++}`); vals.push(String(floor)); }
    if (source !== undefined) { sets.push(`source = $${i++}`); vals.push(String(source)); }
    if (notes !== undefined) { sets.push(`notes = $${i++}`); vals.push(notes ? String(notes) : null); }
    if (display_order !== undefined) { sets.push(`display_order = $${i++}`); vals.push(Number(display_order) || 0); }
    if (width !== undefined) { sets.push(`width = $${i++}`); vals.push(Number(width) || null); }
    if (height !== undefined) { sets.push(`height = $${i++}`); vals.push(Number(height) || null); }
    if (sets.length === 0) return res.json({ ok: true, noop: true });
    sets.push(`updated_at = NOW()`);
    vals.push(req.params.planId);
    await pool.query(`UPDATE property_plans SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "update failed" });
  }
});

router.delete("/api/plans/:planId", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM property_plan_units WHERE plan_id = $1`, [req.params.planId]);
    await pool.query(`DELETE FROM property_plans WHERE id = $1`, [req.params.planId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "delete failed" });
  }
});

// Stream the plan image. Public-within-app: any authed user can view.
router.get("/api/plans/:planId/image", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM property_plans WHERE id = $1`,
      [req.params.planId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "plan not found" });
    const file = await getFile(rows[0].storage_key);
    if (!file) return res.status(404).json({ error: "image missing" });
    res.setHeader("Content-Type", file.contentType || "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(file.data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "stream failed" });
  }
});

// ─── Polygons / units ─────────────────────────────────────────────────────

// All polygons for a plan, joined with the live tenancy + deal data so
// the client can render colours, tooltips, and drawers in one round trip.
router.get("/api/plans/:planId/units", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         ppu.id, ppu.plan_id, ppu.unit_id, ppu.label, ppu.polygon, ppu.status_override,
         pu.unit_name, pu.sqft AS unit_sqft, pu.use_class, pu.floor AS unit_floor,
         lsu.tenant_name, lsu.rent_pa, lsu.lease_expiry, lsu.lease_break,
         lsu.rent_review, lsu.status AS lease_status, lsu.id AS leasing_schedule_unit_id,
         au.id AS available_unit_id, au.marketing_status, au.asking_rent,
         (
           SELECT json_agg(json_build_object(
             'id', d.id, 'name', d.name, 'status', d.status,
             'tenant_id', d.tenant_id, 'deal_type', d.deal_type
           ))
             FROM crm_deals d
            WHERE d.unit_id = pu.id
              AND COALESCE(d.status, '') NOT IN ('WIT', 'COM', 'INV')
         ) AS active_deals
       FROM property_plan_units ppu
       LEFT JOIN property_units pu ON pu.id = ppu.unit_id
       LEFT JOIN leasing_schedule_units lsu
              ON lsu.property_id = pu.property_id AND lsu.unit_name = pu.unit_name
       LEFT JOIN available_units au ON au.unit_id = pu.id
      WHERE ppu.plan_id = $1
      ORDER BY ppu.created_at`,
      [req.params.planId]
    );

    // Compute the status the UI should render. Single source of truth
    // for the colour key — clients can trust this without re-running
    // the logic locally.
    const now = Date.now();
    const decorated = rows.map(r => {
      let status: string;
      if (r.status_override) status = r.status_override;
      else if (Array.isArray(r.active_deals) && r.active_deals.length > 0) status = "deal_in_progress";
      else if (r.marketing_status && /under offer/i.test(r.marketing_status)) status = "under_offer";
      else {
        const expiry = r.lease_expiry ? new Date(r.lease_expiry).getTime() : null;
        const brk = r.lease_break ? new Date(r.lease_break).getTime() : null;
        const next = [expiry, brk].filter(Boolean) as number[];
        const upcoming = next.length > 0 ? Math.min(...next) : null;
        if (upcoming && upcoming - now < EVENT_HORIZON_MS && upcoming > now) status = "lease_event";
        else if (r.marketing_status && /available|vacant/i.test(r.marketing_status)) status = "vacant";
        else if (r.tenant_name) status = "occupied";
        else if (!r.unit_id) status = "unlinked";
        else status = "unknown";
      }
      return { ...r, status };
    });

    res.json({ units: decorated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "units list failed" });
  }
});

router.post("/api/plans/:planId/units", requireAuth, async (req: Request, res: Response) => {
  try {
    const { unit_id, label, polygon, status_override } = req.body || {};
    if (!polygon || !Array.isArray((polygon as PolygonData)?.points) || (polygon as PolygonData).points.length < 3) {
      return res.status(400).json({ error: "polygon with at least 3 points required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO property_plan_units (plan_id, unit_id, label, polygon, status_override)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [req.params.planId, unit_id || null, label || null, JSON.stringify(polygon), status_override || null]
    );
    res.json({ id: rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "create failed" });
  }
});

router.patch("/api/plan-units/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { unit_id, label, polygon, status_override } = req.body || {};
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (unit_id !== undefined) { sets.push(`unit_id = $${i++}`); vals.push(unit_id || null); }
    if (label !== undefined) { sets.push(`label = $${i++}`); vals.push(label || null); }
    if (polygon !== undefined) { sets.push(`polygon = $${i++}::jsonb`); vals.push(JSON.stringify(polygon)); }
    if (status_override !== undefined) { sets.push(`status_override = $${i++}`); vals.push(status_override || null); }
    if (sets.length === 0) return res.json({ ok: true, noop: true });
    sets.push(`updated_at = NOW()`);
    vals.push(req.params.id);
    await pool.query(`UPDATE property_plan_units SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "update failed" });
  }
});

router.delete("/api/plan-units/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(`DELETE FROM property_plan_units WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "delete failed" });
  }
});

// ─── AI vision auto-detect ────────────────────────────────────────────
//
// Two modes:
//   Standard — single pass with claude-opus-4-7 (default). Good for
//     simple plans (≤30 units, big labels, clean SVG-rendered Goad).
//   High-quality — splits the plan into 2×2 = 4 tiles with 10% overlap,
//     runs Opus on each, merges bboxes back to global coords, dedupes
//     by IoU. Much better on dense shopping centres (50+ units, small
//     labels) where a single-pass call misses half the units because
//     labels are too small to read at the input-image resolution
//     Claude downsamples to. ~4× cost / latency.
//
// We use the existing /api/plans/:id/image stream as the input, so
// the AI sees exactly what the user sees. Returns a report so the
// user can audit what was created vs what was skipped.

const VISION_MODEL = "claude-opus-4-7";

const AUTO_DETECT_PROMPT = `You are looking at a shopping centre / retail park floor plan (Goad or leasing plan).

For EVERY shop unit visible on the plan, return:
  - label: the text label or unit number printed on the unit (e.g. "LU14", "WU01", "Zara", "M&S"). If only a tenant name is visible, use that. Read carefully — unit numbers are often tiny.
  - bbox: a rectangle tightly covering the unit, as [x_min, y_min, x_max, y_max] with each value in 0-1 (0 = left/top, 1 = right/bottom of THIS image).

Output ONLY a JSON object of the form:
{"units": [{"label": "...", "bbox": [x_min, y_min, x_max, y_max]}, ...]}

Rules:
1. Skip non-unit elements (walls, walkways, lifts, toilets, parking, decorative shapes, anchor logos like the M&S / John Lewis store-name overlays — those are buildings, but the buildings themselves are units; only skip the floating text labels OF the same building).
2. If a tenant occupies multiple adjacent visible units (an "amalgamation" annotation), output ONE bbox covering the combined area, with the tenant's name as label.
3. Don't make up units that aren't on the plan.
4. Be exhaustive — most plans have 30-150 units. If you're returning fewer than 20, look again.
5. Bboxes should hug the actual unit boundary, not just the label text.

No prose. No markdown. JSON only.`;

interface Detection { label: string; bbox: [number, number, number, number] }

async function callVision(imageBuffer: Buffer, mediaType: string): Promise<Detection[]> {
  const msg = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 12000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType as any, data: imageBuffer.toString("base64") } },
        { type: "text", text: AUTO_DETECT_PROMPT },
      ],
    }],
  });
  const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const items = Array.isArray(parsed?.units) ? parsed.units : [];
    return items
      .map((d: any) => ({ label: String(d?.label || "").trim(), bbox: d?.bbox }))
      .filter((d: Detection) => d.label && Array.isArray(d.bbox) && d.bbox.length === 4) as Detection[];
  } catch {
    return [];
  }
}

// IoU > 0.5 = same unit detected twice (e.g. across overlapping tiles).
// Keep the one with the longer label (more likely to have a unit number
// + the tenant name vs just one of them).
function dedupeDetections(items: Detection[]): Detection[] {
  const sorted = [...items].sort((a, b) => b.label.length - a.label.length);
  const kept: Detection[] = [];
  for (const cand of sorted) {
    const isDup = kept.some(k => iou(cand.bbox, k.bbox) > 0.5);
    if (!isDup) kept.push(cand);
  }
  return kept;
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const interX = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const interY = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = interX * interY;
  const union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter;
  return union > 0 ? inter / union : 0;
}

router.post("/api/plans/:planId/auto-detect", requireAuth, async (req: Request, res: Response) => {
  try {
    const highQuality = req.body?.highQuality === true || req.query?.hq === "1";
    const planRows = await pool.query<{ storage_key: string; property_id: string }>(
      `SELECT storage_key, property_id FROM property_plans WHERE id = $1`,
      [req.params.planId]
    );
    if (planRows.rows.length === 0) return res.status(404).json({ error: "plan not found" });
    const { storage_key, property_id } = planRows.rows[0];

    const file = await getFile(storage_key);
    if (!file) return res.status(404).json({ error: "image missing" });

    const mediaType = (file.contentType || "image/png").startsWith("image/")
      ? (file.contentType as "image/jpeg" | "image/png" | "image/webp" | "image/gif")
      : "image/png";

    let detections: Detection[] = [];

    if (!highQuality) {
      // Single-pass vision call.
      detections = await callVision(file.data, mediaType);
    } else {
      // Tile mode: 2×2 grid with 10% overlap so units straddling the
      // edge of a tile still get caught by an adjacent tile.
      const sharp = (await import("sharp")).default;
      const meta = await sharp(file.data).metadata();
      const W = meta.width || 0;
      const H = meta.height || 0;
      if (!W || !H) return res.status(500).json({ error: "couldn't read image dimensions" });

      const overlap = 0.10;
      const tiles: Array<{ x0: number; y0: number; w: number; h: number; buffer: Buffer }> = [];
      for (const row of [0, 1]) {
        for (const col of [0, 1]) {
          const x0Frac = col === 0 ? 0 : 0.5 - overlap / 2;
          const y0Frac = row === 0 ? 0 : 0.5 - overlap / 2;
          const wFrac = col === 0 ? 0.5 + overlap / 2 : 0.5 + overlap / 2;
          const hFrac = row === 0 ? 0.5 + overlap / 2 : 0.5 + overlap / 2;
          const x0 = Math.floor(x0Frac * W);
          const y0 = Math.floor(y0Frac * H);
          const w = Math.floor(wFrac * W);
          const h = Math.floor(hFrac * H);
          // Sharp extract — pixel-level crop.
          const buf = await sharp(file.data).extract({ left: x0, top: y0, width: Math.min(w, W - x0), height: Math.min(h, H - y0) }).png().toBuffer();
          tiles.push({ x0: x0Frac, y0: y0Frac, w: wFrac, h: hFrac, buffer: buf });
        }
      }
      // Run all 4 tile detections in parallel.
      const tileResults = await Promise.all(tiles.map(t => callVision(t.buffer, "image/png").then(items => ({ tile: t, items }))));
      // Project each tile's local bboxes back into global 0-1 coords.
      for (const { tile, items } of tileResults) {
        for (const d of items) {
          const [lx1, ly1, lx2, ly2] = d.bbox;
          detections.push({
            label: d.label,
            bbox: [
              tile.x0 + lx1 * tile.w,
              tile.y0 + ly1 * tile.h,
              tile.x0 + lx2 * tile.w,
              tile.y0 + ly2 * tile.h,
            ],
          });
        }
      }
      detections = dedupeDetections(detections);
    }

    // Make sure tenancy-schedule units exist in property_units so the
    // label matcher can find them. Idempotent; no-op once seeded.
    await ensurePropertyUnitsFromSchedule(property_id);

    // Pull all property_units once so we can match labels in-memory.
    const pickable = await pool.query<{ id: string; unit_name: string }>(
      `SELECT id, unit_name FROM property_units WHERE property_id = $1`,
      [property_id]
    );
    const byName = new Map<string, string>();
    for (const row of pickable.rows) {
      const key = (row.unit_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key) byName.set(key, row.id);
    }

    let created = 0;
    let matched = 0;
    let skippedExisting = 0;
    const report: Array<{ label: string; matched_unit_id: string | null; bbox: number[] }> = [];

    for (const det of detections) {
      const label = det.label;
      const [x1, y1, x2, y2] = det.bbox.map(n => Math.max(0, Math.min(1, Number(n))));
      if (!(x2 > x1 && y2 > y1)) continue;

      // Skip if there's already a polygon for this label on this plan
      // (idempotent re-run).
      const existing = await pool.query(
        `SELECT 1 FROM property_plan_units WHERE plan_id = $1 AND LOWER(label) = LOWER($2)`,
        [req.params.planId, label]
      );
      if (existing.rows.length > 0) { skippedExisting++; continue; }

      const matchKey = label.toLowerCase().replace(/[^a-z0-9]/g, "");
      const matchedUnitId = byName.get(matchKey) || null;
      if (matchedUnitId) matched++;

      const polygon = {
        points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] as Array<[number, number]>,
      };

      await pool.query(
        `INSERT INTO property_plan_units (plan_id, unit_id, label, polygon)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [req.params.planId, matchedUnitId, label, JSON.stringify(polygon)]
      );
      created++;
      report.push({ label, matched_unit_id: matchedUnitId, bbox: [x1, y1, x2, y2] });
    }

    res.json({
      ok: true,
      mode: highQuality ? "high-quality (4 tiles, Opus)" : "standard (single pass, Opus)",
      model: VISION_MODEL,
      detected: detections.length,
      created,
      matched,
      skipped_existing: skippedExisting,
      report,
    });
  } catch (err: any) {
    console.error("[plan auto-detect]", err?.message || err);
    res.status(500).json({ error: err?.message || "auto-detect failed" });
  }
});

// Ensure every leasing_schedule_unit has a corresponding property_units
// row. Polygons FK to property_units, but leasing schedules are often
// loaded WITHOUT pre-seeding property_units — so when the user wants
// to link a polygon to "LU14" that exists in the tenancy schedule
// but not in property_units, the pick would silently fail. This
// closes that gap by promoting every schedule row into property_units
// (idempotent — uses NOT EXISTS, so re-running is free).
async function ensurePropertyUnitsFromSchedule(propertyId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO property_units (property_id, unit_name, sqft)
     SELECT lsu.property_id, lsu.unit_name, lsu.sqft
       FROM leasing_schedule_units lsu
      WHERE lsu.property_id = $1
        AND lsu.unit_name IS NOT NULL
        AND lsu.unit_name <> ''
        AND NOT EXISTS (
          SELECT 1 FROM property_units pu
           WHERE pu.property_id = lsu.property_id
             AND LOWER(TRIM(pu.unit_name)) = LOWER(TRIM(lsu.unit_name))
        )`,
    [propertyId]
  );
  return rowCount ?? 0;
}

// Property units list — used by the polygon-edit dropdown to pick
// which physical unit a polygon represents. Falls back to leasing
// schedule unit names so the picker covers centres where the master
// property_units table isn't fully seeded.
router.get("/api/properties/:propertyId/plan-pickable-units", requireAuth, async (req: Request, res: Response) => {
  try {
    // Auto-promote every tenancy-schedule unit into property_units
    // before listing. Bluewater + most other shopping centres have
    // their schedule loaded but property_units empty/sparse — without
    // this the polygon picker would return nothing useful.
    await ensurePropertyUnitsFromSchedule(req.params.propertyId);

    const { rows } = await pool.query(
      `SELECT pu.id, pu.unit_name, pu.floor, pu.sqft, lsu.tenant_name, lsu.status AS lease_status
         FROM property_units pu
         LEFT JOIN leasing_schedule_units lsu
                ON lsu.property_id = pu.property_id AND lsu.unit_name = pu.unit_name
        WHERE pu.property_id = $1
        ORDER BY pu.unit_name`,
      [req.params.propertyId]
    );
    res.json({ units: rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "pickable units failed" });
  }
});

export default router;
