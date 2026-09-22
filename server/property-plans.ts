import propertyPlanScanningRouter from "./property-plan-scanning";
// Property plan outlines link to the canonical tenancy schedule by stable ID.
// Original image bytes remain untouched; scanning/tracing only proposes geometry.
import { Router, type Request, type Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { saveFile, getFile } from "./file-storage";
import { clientBlockedForProperty } from "./company-scope";
import { PropertyPlanInputError, validatePropertyPlanPolygon, validatePlanUnitLink,
  queryPickableUnits, queryPropertyPlanUnits, propertyPlanUnitStatus } from "./property-plan-links";

const router = Router();
router.use(propertyPlanScanningRouter);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const STATUS_OVERRIDES = new Set(["occupied", "lease_event", "under_offer", "deal_in_progress", "vacant", "unlinked", "unknown"]);

function inputStatus(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !STATUS_OVERRIDES.has(value)) throw new PropertyPlanInputError("Choose a valid plan status.");
  return value;
}
function inputLabel(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 300) throw new PropertyPlanInputError("Use a unit label of up to 300 characters.");
  return value.trim() || null;
}
function errorResponse(res: Response, err: any, fallback: string) {
  return res.status(err instanceof PropertyPlanInputError ? err.status : 500).json({ error: err?.message || fallback });
}
async function planForRequest(req: Request, res: Response, db: any = pool, lock = false, authorisedPropertyId?: string): Promise<any | null> {
  const { rows } = await db.query(`SELECT * FROM property_plans WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [req.params.planId]);
  if (!rows[0]) { res.status(404).json({ error: "Plan not found." }); return null; }
  if (authorisedPropertyId !== undefined && rows[0].property_id !== authorisedPropertyId) { res.status(409).json({ error: "The plan moved to another property. Reload before editing." }); return null; }
  if (authorisedPropertyId === undefined && await clientBlockedForProperty(req, rows[0].property_id)) { res.status(403).json({ error: "This property is outside your access." }); return null; }
  return rows[0];
}
// Authorise before reserving a transaction connection. Scope checks use the
// shared pool, so invoking them while every writer holds a connection can
// exhaust the pool. The locked write rechecks this owner before using it.
async function unitOwnerForRequest(req: Request, res: Response): Promise<any | null> {
  const { rows } = await pool.query(`SELECT u.plan_id, p.property_id FROM property_plan_units u
    JOIN property_plans p ON p.id = u.plan_id WHERE u.id = $1`, [req.params.id]);
  if (!rows[0]) { res.status(404).json({ error: "Unit outline not found." }); return null; }
  if (await clientBlockedForProperty(req, rows[0].property_id)) { res.status(403).json({ error: "This property is outside your access." }); return null; }
  return rows[0];
}
async function unitForRequest(req: Request, res: Response, db: any, authorisedOwner: { plan_id: string; property_id: string }): Promise<any | null> {
  // Lock parent first, matching scan/apply and plan deletion lock ordering.
  const plan = await db.query("SELECT * FROM property_plans WHERE id = $1 FOR UPDATE", [authorisedOwner.plan_id]);
  if (!plan.rows[0]) { res.status(404).json({ error: "Plan not found." }); return null; }
  if (plan.rows[0].property_id !== authorisedOwner.property_id) { res.status(409).json({ error: "The plan moved to another property. Reload before editing." }); return null; }
  const unit = await db.query("SELECT * FROM property_plan_units WHERE id = $1 AND plan_id = $2 FOR UPDATE", [req.params.id, plan.rows[0].id]);
  if (!unit.rows[0]) { res.status(404).json({ error: "Unit outline not found." }); return null; }
  return { ...unit.rows[0], property_id: plan.rows[0].property_id, storage_key: plan.rows[0].storage_key };
}

router.get("/api/properties/:propertyId/plans", requireAuth, async (req: Request, res: Response) => {
  try {
    if (await clientBlockedForProperty(req, String(req.params.propertyId))) return res.status(403).json({ error: "This property is outside your access." });
    const { rows } = await pool.query(`SELECT id, property_id, floor, display_order, storage_key, width, height, source, notes, created_at, updated_at
      FROM property_plans WHERE property_id = $1 AND COALESCE(is_geo, false) = false ORDER BY display_order, floor`, [req.params.propertyId]);
    res.json({ plans: rows });
  } catch (err) { errorResponse(res, err, "Could not load plans."); }
});

router.post("/api/properties/:propertyId/plans", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.params.propertyId);
    if (await clientBlockedForProperty(req, propertyId)) return res.status(403).json({ error: "This property is outside your access." });
    const property = await pool.query("SELECT id FROM crm_properties WHERE id = $1", [propertyId]);
    if (!property.rows[0]) return res.status(404).json({ error: "Property not found." });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Choose a plan image." });
    let metadata;
    try { metadata = await sharp(file.buffer, { limitInputPixels: 100_000_000, failOn: "error" }).metadata(); }
    catch { return res.status(400).json({ error: "Use a valid PNG, JPEG or WebP image, up to 100 megapixels." }); }
    const formats = { png: { ext: "png", mime: "image/png" }, jpeg: { ext: "jpg", mime: "image/jpeg" }, webp: { ext: "webp", mime: "image/webp" } };
    const format = formats[metadata.format as keyof typeof formats];
    if (!format || !metadata.width || !metadata.height || metadata.width * metadata.height > 100_000_000 || (metadata.pages || 1) > 1) return res.status(400).json({ error: "Use a single PNG, JPEG or WebP plan image, up to 100 megapixels. PDF pages are converted by the upload tool." });
    try { await sharp(file.buffer, { limitInputPixels: 100_000_000, failOn: "error" }).stats(); }
    catch { return res.status(400).json({ error: "This image is incomplete or damaged. Upload the original plan again." }); }
    const rotated = metadata.orientation && metadata.orientation >= 5;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    const floor = String(req.body?.floor || "Ground").trim().slice(0, 100) || "Ground";
    const source = String(req.body?.source || "leasing-plan").trim().slice(0, 100);
    const notes = req.body?.notes ? String(req.body.notes).trim() : null;
    const planId = crypto.randomUUID();
    const storageKey = `property-plans/${propertyId}/${planId}.${format.ext}`;
    await saveFile(storageKey, file.buffer, format.mime, file.originalname);
    const { rows } = await pool.query(`INSERT INTO property_plans (id, property_id, floor, source, notes, storage_key, width, height)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, property_id, floor, display_order, storage_key, width, height, source, notes, created_at, updated_at`,
      [planId, propertyId, floor, source, notes, storageKey, width, height]);
    res.json(rows[0]);
  } catch (err) { errorResponse(res, err, "Could not upload the plan."); }
});

router.patch("/api/plans/:planId", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await planForRequest(req, res)) return;
    const { floor, source, notes, display_order, width, height } = req.body || {};
    if (width !== undefined || height !== undefined) return res.status(400).json({ error: "Image dimensions are read from the original image and cannot be edited." });
    if (floor !== undefined && (typeof floor !== "string" || !floor.trim() || floor.length > 100)) throw new PropertyPlanInputError("Enter a floor name of up to 100 characters.");
    if (display_order !== undefined && (!Number.isInteger(display_order) || Math.abs(display_order) > 10000)) throw new PropertyPlanInputError("Invalid plan order.");
    const sets: string[] = [], vals: any[] = [];
    const set = (name: string, value: any) => { vals.push(value); sets.push(`${name} = $${vals.length}`); };
    if (floor !== undefined) set("floor", floor.trim());
    if (source !== undefined) set("source", String(source).slice(0, 100));
    if (notes !== undefined) set("notes", notes ? String(notes) : null);
    if (display_order !== undefined) set("display_order", display_order);
    if (!sets.length) return res.json({ ok: true, noop: true });
    vals.push(req.params.planId);
    await pool.query(`UPDATE property_plans SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
    res.json({ ok: true });
  } catch (err) { errorResponse(res, err, "Could not update the plan."); }
});

router.delete("/api/plans/:planId", requireAuth, async (req: Request, res: Response) => {
  let db: import("pg").PoolClient | undefined;
  try {
    const authorisedPlan = await planForRequest(req, res);
    if (!authorisedPlan) return;
    db = await pool.connect();
    await db.query("BEGIN");
    if (!await planForRequest(req, res, db, true, authorisedPlan.property_id)) { await db.query("ROLLBACK"); return; }
    await db.query("DELETE FROM property_plan_units WHERE plan_id = $1", [req.params.planId]);
    await db.query("DELETE FROM property_plans WHERE id = $1", [req.params.planId]);
    await db.query("COMMIT");
    res.json({ ok: true });
  } catch (err) { if (db) await db.query("ROLLBACK"); errorResponse(res, err, "Could not delete the plan."); }
  finally { db?.release(); }
});

router.get("/api/plans/:planId/image", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await planForRequest(req, res);
    if (!plan) return;
    const file = await getFile(plan.storage_key);
    if (!file) return res.status(404).json({ error: "Plan image missing." });
    if (file.contentType && !/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.contentType)) return res.status(415).json({ error: "This stored file is not a supported plan image. Upload a PNG, JPEG or WebP image." });
    res.setHeader("Content-Type", file.contentType || "image/png");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(file.data);
  } catch (err) { errorResponse(res, err, "Could not load the image."); }
});

router.get("/api/plans/:planId/units", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await planForRequest(req, res)) return;
    const rows = await queryPropertyPlanUnits(pool, String(req.params.planId));
    res.json({ units: rows.map(row => ({ ...row, status: propertyPlanUnitStatus(row) })) });
  } catch (err) { errorResponse(res, err, "Could not load plan units."); }
});

router.post("/api/plans/:planId/units", requireAuth, async (req: Request, res: Response) => {
  let db: import("pg").PoolClient | undefined;
  try {
    const authorisedPlan = await planForRequest(req, res);
    if (!authorisedPlan) return;
    db = await pool.connect();
    await db.query("BEGIN");
    const plan = await planForRequest(req, res, db, true, authorisedPlan.property_id);
    if (!plan) { await db.query("ROLLBACK"); return; }
    const body = req.body || {};
    if (body.imageKey !== undefined && body.imageKey !== plan.storage_key) { await db.query("ROLLBACK"); return res.status(409).json({ error: "The plan image changed. Trace this unit again." }); }
    const polygon = validatePropertyPlanPolygon(body.polygon);
    const link = await validatePlanUnitLink(db, plan.property_id, body);
    const { rows } = await db.query(`INSERT INTO property_plan_units (plan_id, unit_id, tenancy_unit_id, label, polygon, status_override)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [plan.id, link.unit_id, link.tenancy_unit_id, inputLabel(body.label), JSON.stringify(polygon), inputStatus(body.status_override)]);
    await db.query("COMMIT");
    res.json({ id: rows[0].id });
  } catch (err) { if (db) await db.query("ROLLBACK"); errorResponse(res, err, "Could not save the unit outline."); }
  finally { db?.release(); }
});

router.patch("/api/plan-units/:id", requireAuth, async (req: Request, res: Response) => {
  let db: import("pg").PoolClient | undefined;
  try {
    const authorisedOwner = await unitOwnerForRequest(req, res);
    if (!authorisedOwner) return;
    db = await pool.connect();
    await db.query("BEGIN");
    const unit = await unitForRequest(req, res, db, authorisedOwner);
    if (!unit) { await db.query("ROLLBACK"); return; }
    const body = req.body || {};
    if (body.imageKey !== undefined && body.imageKey !== unit.storage_key) { await db.query("ROLLBACK"); return res.status(409).json({ error: "The plan image changed. Trace this unit again." }); }
    const sets: string[] = [], vals: any[] = [];
    const set = (name: string, value: any, cast = "") => { vals.push(value); sets.push(`${name} = $${vals.length}${cast}`); };
    if (body.unit_id !== undefined || body.tenancy_unit_id !== undefined) {
      const link = await validatePlanUnitLink(db, unit.property_id, body);
      set("unit_id", link.unit_id); set("tenancy_unit_id", link.tenancy_unit_id);
    }
    if (body.label !== undefined) set("label", inputLabel(body.label));
    if (body.polygon !== undefined) set("polygon", JSON.stringify(validatePropertyPlanPolygon(body.polygon)), "::jsonb");
    if (body.status_override !== undefined) set("status_override", inputStatus(body.status_override));
    if (sets.length) {
      vals.push(req.params.id);
      await db.query(`UPDATE property_plan_units SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
    }
    await db.query("COMMIT");
    res.json({ ok: true });
  } catch (err) { if (db) await db.query("ROLLBACK"); errorResponse(res, err, "Could not update the unit outline."); }
  finally { db?.release(); }
});

router.delete("/api/plan-units/:id", requireAuth, async (req: Request, res: Response) => {
  let db: import("pg").PoolClient | undefined;
  try {
    const authorisedOwner = await unitOwnerForRequest(req, res);
    if (!authorisedOwner) return;
    db = await pool.connect();
    await db.query("BEGIN");
    if (!await unitForRequest(req, res, db, authorisedOwner)) { await db.query("ROLLBACK"); return; }
    await db.query("DELETE FROM property_plan_units WHERE id = $1", [req.params.id]);
    await db.query("COMMIT");
    res.json({ ok: true });
  } catch (err) { if (db) await db.query("ROLLBACK"); errorResponse(res, err, "Could not delete the unit outline."); }
  finally { db?.release(); }
});

router.get("/api/properties/:propertyId/plan-pickable-units", requireAuth, async (req: Request, res: Response) => {
  try {
    if (await clientBlockedForProperty(req, String(req.params.propertyId))) return res.status(403).json({ error: "This property is outside your access." });
    res.json({ units: await queryPickableUnits(pool, String(req.params.propertyId)) });
  } catch (err) { errorResponse(res, err, "Could not load tenancy choices."); }
});

// ─── Phase 1: Geographic tenancy-plan overlay ─────────────────────────────
// Accept a GeoJSON file for a property — polygons are stored on the plan
// row with bbox so the live Pathway map can fetch them via the viewport
// endpoint and render them as a tenancy-plan layer.

const geojsonUpload = multer({
  storage: multer.memoryStorage(),
  // GeoJSON files can be sizable when polygons are dense — allow 50MB.
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post(
  "/api/properties/:propertyId/plans/geojson",
  requireAuth,
  geojsonUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (await clientBlockedForProperty(req, String(req.params.propertyId))) return res.status(403).json({ error: "This property is outside your access." });
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "file required" });

      let parsed: any;
      try {
        parsed = JSON.parse(file.buffer.toString("utf-8"));
      } catch {
        return res.status(400).json({ error: "File is not valid JSON" });
      }

      // Accept either a FeatureCollection or a single Feature.
      let features: any[];
      if (parsed?.type === "FeatureCollection" && Array.isArray(parsed.features)) {
        features = parsed.features;
      } else if (parsed?.type === "Feature") {
        features = [parsed];
      } else {
        return res
          .status(400)
          .json({ error: "Expected a GeoJSON FeatureCollection or single Feature" });
      }
      if (features.length === 0) return res.status(400).json({ error: "No features in file" });

      // Compute bbox so the viewport query can index-filter quickly.
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      const visitCoords = (coords: any) => {
        if (typeof coords?.[0] === "number" && typeof coords?.[1] === "number") {
          const [lng, lat] = coords;
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
          return;
        }
        if (Array.isArray(coords)) coords.forEach(visitCoords);
      };
      for (const f of features) {
        if (f?.geometry?.coordinates) visitCoords(f.geometry.coordinates);
      }
      if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
        return res
          .status(400)
          .json({ error: "Couldn't extract any coordinates — file may be in CAD/local space, not lng/lat. Use Phase 3 georeference flow." });
      }

      const floor = String(req.body?.floor || "Ground").trim();
      const source = String(req.body?.source || "tenancy-plan-geojson").trim();
      const notes = req.body?.notes ? String(req.body.notes).trim() : null;
      const propertyId = req.params.propertyId;
      const planId = crypto.randomUUID();
      // Also persist the raw file in storage so we can re-process it later
      // (e.g. when Phase 4's auto-link runs).
      const storageKey = `property-plans/${propertyId}/${planId}.geojson`;
      await saveFile(storageKey, file.buffer, "application/geo+json", file.originalname);

      const { rows } = await pool.query(
        `INSERT INTO property_plans
           (id, property_id, floor, source, notes, storage_key,
            geojson, is_geo,
            bbox_north, bbox_south, bbox_east, bbox_west)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11)
         RETURNING id, property_id, floor, display_order, storage_key,
                   source, notes, is_geo, bbox_north, bbox_south, bbox_east, bbox_west,
                   created_at, updated_at`,
        [
          planId,
          propertyId,
          floor,
          source,
          notes,
          storageKey,
          JSON.stringify({ type: "FeatureCollection", features }),
          maxLat,
          minLat,
          maxLng,
          minLng,
        ],
      );
      res.json({ ...rows[0], featureCount: features.length });
    } catch (err: any) {
      console.error("[property-plans/geojson] upload error:", err?.message);
      res.status(500).json({ error: err?.message || "upload failed" });
    }
  },
);

// Viewport query — returns every geo-tagged plan whose bbox intersects the
// requested bounding box. Used by the live Pathway map's 'Tenancy Plans'
// layer. Bbox format: 'south,west,north,east' (matches OS layer queries).
router.get(
  "/api/property-plans/in-viewport",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const bbox = String(req.query.bbox || "");
      const parts = bbox.split(",").map((s) => Number(s));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return res.status(400).json({ error: "bbox required as south,west,north,east" });
      }
      const [south, west, north, east] = parts;
      const { rows } = await pool.query(
        `SELECT p.id, p.property_id, p.floor, p.source, p.notes, p.geojson,
                p.bbox_north, p.bbox_south, p.bbox_east, p.bbox_west,
                pr.name AS property_name, pr.status AS property_status
           FROM property_plans p
           LEFT JOIN crm_properties pr ON pr.id = p.property_id
          WHERE p.is_geo = true
            AND p.bbox_west  <= $4
            AND p.bbox_east  >= $2
            AND p.bbox_south <= $3
            AND p.bbox_north >= $1
          LIMIT 200`,
        [south, west, north, east],
      );
      const visible = await Promise.all(rows.map(async row => await clientBlockedForProperty(req, row.property_id) ? null : row));
      res.json({ plans: visible.filter(Boolean) });
    } catch (err: any) {
      console.error("[property-plans/in-viewport] error:", err?.message);
      res.status(500).json({ error: err?.message || "viewport query failed" });
    }
  },
);

export default router;
