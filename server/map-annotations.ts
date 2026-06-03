// ─── Map annotations ────────────────────────────────────────────────────
// User-drawn pins, text labels, polygons and drive-time lines for the
// Property Intelligence map. Each annotation is one row in
// `map_annotations`; the table was added via boot DDL in server/index.ts.
//
// Also exposes a tiny postcode-boundary endpoint that proxies postcodes.io
// → returns the postcode's bounding box as a GeoJSON polygon so the
// client can draw it as a red boundary on the map.
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { isHmlrPolygonsAvailable } from "./hmlr-direct";

interface AnnotationRow {
  id: string;
  owner_id: string | null;
  kind: string;
  label: string | null;
  color: string | null;
  lat: number | null;
  lng: number | null;
  geometry: any;
  created_at: string;
}

export function registerMapAnnotationsRoutes(app: Express) {
  // ── Layers CRUD ────────────────────────────────────────────────────────
  // List layers the caller can see — their own, plus anything marked
  // shared_with_team. Includes annotation count for the sidebar.
  app.get("/api/map-layers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId || null;
      const r = await pool.query<any>(
        `SELECT l.id, l.name, l.color, l.owner_id, l.shared_with_team, l.created_at,
                (SELECT COUNT(*)::int FROM map_annotations a WHERE a.layer_id = l.id) AS annotation_count
           FROM map_layers l
          WHERE l.owner_id = $1 OR l.shared_with_team = TRUE
          ORDER BY l.created_at DESC`,
        [userId],
      );
      res.json(r.rows.map((row) => ({
        id: row.id, name: row.name, color: row.color, ownerId: row.owner_id,
        sharedWithTeam: row.shared_with_team, annotationCount: row.annotation_count,
        createdAt: row.created_at, mine: row.owner_id === userId,
      })));
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.post("/api/map-layers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId || null;
      const name = String(req.body?.name || "").trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: "Name required" });
      const color = req.body?.color ? String(req.body.color).slice(0, 32) : "#a855f7";
      const sharedWithTeam = !!req.body?.sharedWithTeam;
      const r = await pool.query<{ id: string }>(
        `INSERT INTO map_layers (name, color, owner_id, shared_with_team)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, color, userId, sharedWithTeam],
      );
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.patch("/api/map-layers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId || null;
      const id = String(req.params.id);
      // Only the owner can rename / re-colour / change share status. No
      // admin override yet — simple ownership model.
      const owned = await pool.query<{ owner_id: string }>(`SELECT owner_id FROM map_layers WHERE id = $1`, [id]);
      if (!owned.rows[0]) return res.status(404).json({ error: "Not found" });
      if (owned.rows[0].owner_id !== userId) return res.status(403).json({ error: "Only the layer's owner can edit it" });
      const patches: string[] = [];
      const params: any[] = [];
      if (typeof req.body?.name === "string") { patches.push(`name = $${params.length + 1}`); params.push(String(req.body.name).slice(0, 120)); }
      if (typeof req.body?.color === "string") { patches.push(`color = $${params.length + 1}`); params.push(String(req.body.color).slice(0, 32)); }
      if (typeof req.body?.sharedWithTeam === "boolean") { patches.push(`shared_with_team = $${params.length + 1}`); params.push(req.body.sharedWithTeam); }
      if (patches.length === 0) return res.json({ ok: true });
      params.push(id);
      await pool.query(`UPDATE map_layers SET ${patches.join(", ")} WHERE id = $${params.length}`, params);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.delete("/api/map-layers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId || null;
      const id = String(req.params.id);
      const owned = await pool.query<{ owner_id: string }>(`SELECT owner_id FROM map_layers WHERE id = $1`, [id]);
      if (!owned.rows[0]) return res.status(404).json({ error: "Not found" });
      if (owned.rows[0].owner_id !== userId) return res.status(403).json({ error: "Only the layer's owner can delete it" });
      // Cascade: delete every annotation tied to the layer.
      await pool.query(`DELETE FROM map_annotations WHERE layer_id = $1`, [id]);
      await pool.query(`DELETE FROM map_layers WHERE id = $1`, [id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // List annotations visible to the caller. Returns layer metadata so
  // the client can colour-key by layer and toggle visibility per layer
  // without a second round-trip.
  app.get("/api/map-annotations", requireAuth, async (_req: Request, res: Response) => {
    try {
      const r = await pool.query<AnnotationRow & { layer_id: string | null }>(
        `SELECT id, owner_id, kind, label, color, lat, lng, geometry, created_at, layer_id
         FROM map_annotations
         ORDER BY created_at DESC
         LIMIT 2000`,
      );
      res.json(r.rows.map((row: any) => ({
        id: row.id,
        ownerId: row.owner_id,
        kind: row.kind,
        label: row.label,
        color: row.color,
        lat: row.lat,
        lng: row.lng,
        geometry: row.geometry,
        layerId: row.layer_id,
        createdAt: row.created_at,
      })));
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.post("/api/map-annotations", requireAuth, async (req: Request, res: Response) => {
    try {
      const ownerId = (req.session as any)?.userId || null;
      const kind = String(req.body?.kind || "").trim();
      if (!["pin", "label", "polygon", "drive_time", "postcode"].includes(kind)) {
        return res.status(400).json({ error: "kind must be pin, label, polygon, drive_time, or postcode" });
      }
      const label = req.body?.label ? String(req.body.label).slice(0, 200) : null;
      const color = req.body?.color ? String(req.body.color).slice(0, 32) : null;
      const lat = typeof req.body?.lat === "number" ? req.body.lat : null;
      const lng = typeof req.body?.lng === "number" ? req.body.lng : null;
      const geometry = req.body?.geometry || null;
      const layerId = req.body?.layerId ? String(req.body.layerId) : null;
      const r = await pool.query<{ id: string }>(
        `INSERT INTO map_annotations (owner_id, kind, label, color, lat, lng, geometry, layer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [ownerId, kind, label, color, lat, lng, geometry, layerId],
      );
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.delete("/api/map-annotations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(`DELETE FROM map_annotations WHERE id = $1`, [req.params.id]);
      if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Postcode → bounding-box polygon for the red-line highlight. Uses
  // postcodes.io (free + no key) which returns lat/lng + bbox for both
  // unit postcodes ("SW1Y 4DG") and outcodes ("SW1Y"). We expand the
  // bbox slightly so the box doesn't sit exactly on the centroid for
  // narrow unit postcodes.
  app.get("/api/postcode-boundary/:postcode", requireAuth, async (req: Request, res: Response) => {
    try {
      const raw = String(req.params.postcode || "").trim().toUpperCase();
      const compact = raw.replace(/\s+/g, "");
      if (!compact) return res.status(400).json({ error: "Empty postcode" });
      const isOutcode = /^[A-Z]{1,2}\d{1,2}[A-Z]?$/.test(compact);
      const url = isOutcode
        ? `https://api.postcodes.io/outcodes/${encodeURIComponent(compact)}`
        : `https://api.postcodes.io/postcodes/${encodeURIComponent(raw)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return res.status(404).json({ error: `postcodes.io ${r.status}` });
      const data: any = await r.json();
      const result = data?.result;
      if (!result?.latitude || !result?.longitude) return res.status(404).json({ error: "Postcode not found" });
      // For outcodes postcodes.io returns northings/eastings bbox via
      // {northern,southern,eastern,western} — exact polygon would need
      // OS Boundary-Line. For unit postcodes there's no bbox; we synth
      // a small ~250m box around the centroid.
      const lat = result.latitude;
      const lng = result.longitude;
      let north: number, south: number, east: number, west: number;
      if (isOutcode && typeof result.northern_latitude === "number") {
        north = result.northern_latitude;
        south = result.southern_latitude;
        east = result.eastern_longitude;
        west = result.western_longitude;
      } else {
        const dLat = 0.0015;                              // ~165m
        const dLng = 0.0025;                              // ~165m at UK latitudes
        north = lat + dLat; south = lat - dLat;
        east = lng + dLng; west = lng - dLng;
      }
      const geojson = {
        type: "Feature",
        properties: { postcode: raw },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west, north], [east, north], [east, south], [west, south], [west, north],
          ]],
        },
      };
      res.json({ postcode: raw, lat, lng, north, south, east, west, geojson, isOutcode });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // HMLR title polygons in the current viewport. Returns a GeoJSON
  // FeatureCollection so the map can render freehold / leasehold
  // boundaries as an overlay layer. Capped at 500 polygons to keep
  // rendering snappy when the user is zoomed out.
  app.get("/api/hmlr-polygons-in-bbox", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await isHmlrPolygonsAvailable())) {
        return res.json({ type: "FeatureCollection", features: [], available: false });
      }
      const north = Number(req.query.n);
      const south = Number(req.query.s);
      const east = Number(req.query.e);
      const west = Number(req.query.w);
      if (![north, south, east, west].every(Number.isFinite)) {
        return res.status(400).json({ error: "Need n,s,e,w as numbers" });
      }
      // Bail on huge bboxes — at country level we'd return millions of
      // polygons. Only render at street / area zoom.
      const areaApprox = Math.abs((north - south) * (east - west));
      if (areaApprox > 0.05) {
        return res.json({ type: "FeatureCollection", features: [], reason: "Zoom in further to load title polygons" });
      }
      // Pull polygons + LEFT JOIN proprietors to surface tenure for the
      // freehold/leasehold colour split. Some polygons have no matching
      // proprietor row (especially smaller estates) — those come back
      // with tenure NULL and the client paints them grey.
      const r = await pool.query<any>(
        `SELECT p.title_number,
                p.region,
                ST_AsGeoJSON(p.polygon) AS gj,
                (SELECT lower(pr.tenure)
                   FROM hmlr_proprietors pr
                  WHERE pr.title_number = p.title_number
                  LIMIT 1) AS tenure
           FROM hmlr_title_polygons p
          WHERE p.polygon && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          LIMIT 500`,
        [west, south, east, north],
      );
      const features = r.rows.map((row) => {
        let geom: any = null;
        try { geom = JSON.parse(row.gj); } catch {}
        // Normalise tenure — HMLR uses "Freehold" / "Leasehold" but
        // the casing isn't always consistent. lower() above, then
        // contains-check for safety.
        const t = (row.tenure || "").toLowerCase();
        let tenure: "freehold" | "leasehold" | "unknown" = "unknown";
        if (t.includes("freehold")) tenure = "freehold";
        else if (t.includes("leasehold")) tenure = "leasehold";
        return {
          type: "Feature",
          properties: { titleNumber: row.title_number, region: row.region, tenure },
          geometry: geom,
        };
      }).filter((f) => f.geometry);
      res.json({ type: "FeatureCollection", features });
    } catch (e: any) {
      console.error("[hmlr-polygons-in-bbox]", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Drive-time + distance between two points via Google Directions API.
  // The client draws the returned polyline as a coloured line with the
  // duration label. driving mode is default; mode can be transit/walking.
  app.post("/api/maps/directions", requireAuth, async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "GOOGLE_API_KEY not configured" });
      const origin = req.body?.origin;
      const destination = req.body?.destination;
      if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
        return res.status(400).json({ error: "origin and destination need {lat,lng}" });
      }
      const mode = ["driving", "walking", "bicycling", "transit"].includes(req.body?.mode)
        ? req.body.mode : "driving";
      const url = `https://maps.googleapis.com/maps/api/directions/json`
        + `?origin=${origin.lat},${origin.lng}`
        + `&destination=${destination.lat},${destination.lng}`
        + `&mode=${mode}`
        + `&key=${apiKey}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data: any = await r.json();
      if (data?.status !== "OK" || !data.routes?.[0]) {
        return res.status(400).json({ error: data?.error_message || data?.status || "No route" });
      }
      const route = data.routes[0];
      const leg = route.legs?.[0] || {};
      res.json({
        polyline: route.overview_polyline?.points || "",
        durationText: leg.duration?.text || null,
        durationSeconds: leg.duration?.value || null,
        distanceText: leg.distance?.text || null,
        distanceMeters: leg.distance?.value || null,
        startLabel: leg.start_address || null,
        endLabel: leg.end_address || null,
        bounds: route.bounds || null,
        mode,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });
}
