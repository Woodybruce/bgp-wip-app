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
  // List all annotations visible to the caller. For now everyone sees
  // everything — keeps the demo simple. Layer-per-user comes later.
  app.get("/api/map-annotations", requireAuth, async (_req: Request, res: Response) => {
    try {
      const r = await pool.query<AnnotationRow>(
        `SELECT id, owner_id, kind, label, color, lat, lng, geometry, created_at
         FROM map_annotations
         ORDER BY created_at DESC
         LIMIT 1000`,
      );
      res.json(r.rows.map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        kind: row.kind,
        label: row.label,
        color: row.color,
        lat: row.lat,
        lng: row.lng,
        geometry: row.geometry,
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
      const r = await pool.query<{ id: string }>(
        `INSERT INTO map_annotations (owner_id, kind, label, color, lat, lng, geometry)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [ownerId, kind, label, color, lat, lng, geometry],
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
}
