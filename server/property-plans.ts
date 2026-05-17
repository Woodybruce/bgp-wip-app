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
// Send the plan image to Claude vision and ask for every unit's label
// + bounding box in normalised 0-1 coords. We then match labels to
// property_units.unit_name (case-insensitive trim-equal) for the
// property and create polygons for each detection. Unmatched
// detections still get a polygon — they show grey ('unlinked') and
// the user can pick a unit manually from the drawer.
//
// We use the existing /api/plans/:id/image stream as the input, so
// the AI sees exactly what the user sees. Returns a report so the
// user can audit what was created vs what was skipped.

const AUTO_DETECT_PROMPT = `You are looking at a shopping centre / retail park floor plan (Goad or leasing plan).

For EVERY shop unit visible on the plan, return:
  - label: the text label or unit number printed on the unit (e.g. "LU14", "WU01", "Zara", "M&S"). If only a tenant name is visible, use that.
  - bbox: a rectangle covering the unit, as [x_min, y_min, x_max, y_max] with each value in 0-1 (0 = left/top, 1 = right/bottom of the image).

Output ONLY a JSON object of the form:
{"units": [{"label": "...", "bbox": [x_min, y_min, x_max, y_max]}, ...]}

Rules:
1. Skip non-unit elements (walls, walkways, lifts, toilets, parking, decorative shapes).
2. If a tenant occupies multiple adjacent visible units (an "amalgamation" annotation), output ONE bbox covering the combined area, with the tenant's name as label.
3. Don't make up units that aren't on the plan.
4. Don't worry about being pixel-perfect — a slightly loose bbox is fine.
5. Aim for completeness — better to over-include than miss units.

No prose. No markdown. JSON only.`;

router.post("/api/plans/:planId/auto-detect", requireAuth, async (req: Request, res: Response) => {
  try {
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

    // Fire vision call. Sonnet is the sweet spot for spatial reasoning
    // on plans; Haiku misses too many tiny units.
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: file.data.toString("base64") } },
          { type: "text", text: AUTO_DETECT_PROMPT },
        ],
      }],
    });

    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: "vision returned no JSON", raw: text.slice(0, 400) });
    const parsed = JSON.parse(jsonMatch[0]);
    const detections = Array.isArray(parsed?.units) ? parsed.units : [];

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
      const label = String(det?.label || "").trim();
      const bbox = det?.bbox;
      if (!label || !Array.isArray(bbox) || bbox.length !== 4) continue;
      const [x1, y1, x2, y2] = bbox.map((n: any) => Math.max(0, Math.min(1, Number(n))));
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

// Property units list — used by the polygon-edit dropdown to pick
// which physical unit a polygon represents. Falls back to leasing
// schedule unit names so the picker covers centres where the master
// property_units table isn't fully seeded.
router.get("/api/properties/:propertyId/plan-pickable-units", requireAuth, async (req: Request, res: Response) => {
  try {
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
