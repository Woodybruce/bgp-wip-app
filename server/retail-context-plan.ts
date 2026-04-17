// Retail Context Plan — BGP's GOAD-equivalent.
//
// Renders a clean, monochrome Google Static Map centred on a subject property,
// overlaid with colour-coded pins for nearby retail/F&B CRM properties, with
// vacancy flags from the available-units table.
//
// Output: a PNG saved into image_studio_images, tagged "retail-context-plan".

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db, pool } from "./db";
import { crmProperties, availableUnits, imageStudioImages } from "@shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const IMAGE_DIR = path.join(process.cwd(), "uploads", "image-studio");

// Monochrome map style — clean BGP-compatible look
const MONO_STYLE = [
  "feature:all|element:geometry|color:0xf5f5f5",
  "feature:all|element:labels.text.fill|color:0x616161",
  "feature:all|element:labels.text.stroke|color:0xf5f5f5",
  "feature:administrative|element:geometry.stroke|color:0xe0e0e0",
  "feature:poi|element:geometry|color:0xeeeeee",
  "feature:poi|element:labels.text.fill|color:0x9e9e9e",
  "feature:road|element:geometry|color:0xffffff",
  "feature:road|element:labels.text.fill|color:0x9e9e9e",
  "feature:road.arterial|element:geometry|color:0xdddddd",
  "feature:road.highway|element:geometry|color:0xdadada",
  "feature:transit.line|element:geometry|color:0xe0e0e0",
  "feature:water|element:geometry|color:0xd6d6d6",
];

interface Pin {
  lat: number;
  lng: number;
  color: string;
  label?: string;
  size?: "tiny" | "mid" | "small" | "normal";
}

interface RenderArgs {
  address: string;
  postcode: string;
  propertyId?: string | null;
  radius?: number;
}

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&region=uk&components=country:GB`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as any;
    const loc = data.results?.[0]?.geometry?.location;
    if (loc?.lat && loc?.lng) return { lat: loc.lat, lng: loc.lng };
    return null;
  } catch {
    return null;
  }
}

function postcodeOutwardCode(pc: string): string {
  const cleaned = (pc || "").toUpperCase().replace(/\s+/g, "");
  return cleaned.slice(0, cleaned.length - 3);
}

async function findNearbyProperties(outwardCode: string, excludeId?: string | null): Promise<Array<any>> {
  if (!outwardCode) return [];
  // address is jsonb — query by postcode starting with the outward code
  const q = await pool.query(
    `SELECT id, name, address, asset_class
       FROM crm_properties
      WHERE address IS NOT NULL
        AND UPPER(REPLACE(COALESCE(address->>'postcode',''), ' ', '')) LIKE $1
        AND ($2::text IS NULL OR id <> $2)
      LIMIT 80`,
    [`${outwardCode}%`, excludeId || null]
  );
  return q.rows;
}

async function getVacantPropertyIds(propertyIds: string[]): Promise<Set<string>> {
  if (!propertyIds.length) return new Set();
  const q = await pool.query(
    `SELECT DISTINCT property_id FROM available_units
      WHERE property_id = ANY($1::varchar[])
        AND (marketing_status = 'Available' OR marketing_status IS NULL)`,
    [propertyIds]
  );
  return new Set(q.rows.map(r => r.property_id));
}

function classifyProperty(assetClass: string | null): "retail" | "food" | "other" {
  const a = (assetClass || "").toLowerCase();
  if (a.includes("f&b") || a.includes("restaurant") || a.includes("food")) return "food";
  if (a.includes("retail") || a.includes("shop")) return "retail";
  return "other";
}

const PIN_COLORS = {
  subject: "0x1F1F1F",      // BGP Slate
  retail: "0x596264",       // BGP Cool Grey
  food: "0x8B5E3C",         // Warm accent for F&B
  vacant: "0xC0392B",        // Red
  underOffer: "0xE67E22",    // Orange
};

function buildStaticMapUrl(center: { lat: number; lng: number }, pins: Pin[], size: string = "800x640", zoom: number = 17): string {
  const params = new URLSearchParams();
  params.set("center", `${center.lat},${center.lng}`);
  params.set("zoom", String(zoom));
  params.set("size", size);
  params.set("scale", "2");
  params.set("maptype", "roadmap");
  params.set("format", "png");
  if (GOOGLE_API_KEY) params.set("key", GOOGLE_API_KEY);

  const qs = params.toString();
  const styleParams = MONO_STYLE.map(s => `style=${encodeURIComponent(s)}`).join("&");
  const markerGroups: Record<string, Pin[]> = {};
  for (const p of pins) {
    const key = `${p.color}|${p.size || "small"}|${p.label || ""}`;
    (markerGroups[key] ||= []).push(p);
  }
  const markerParams = Object.entries(markerGroups)
    .map(([key, group]) => {
      const [color, size, label] = key.split("|");
      const bits = [`color:${color}`, `size:${size}`];
      if (label) bits.push(`label:${label}`);
      const locs = group.map(p => `${p.lat},${p.lng}`).join("|");
      return `markers=${encodeURIComponent(bits.join("|"))}|${locs}`;
    })
    .join("&");

  return `https://maps.googleapis.com/maps/api/staticmap?${qs}&${styleParams}&${markerParams}`;
}

export async function renderRetailContextPlan(args: RenderArgs): Promise<{ id: string; localPath: string; width: number; height: number }> {
  const { address, postcode, propertyId } = args;
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not configured");

  // 1. Geocode the subject
  const subject = await geocodeAddress([address, postcode].filter(Boolean).join(", "));
  if (!subject) throw new Error("Could not geocode subject address");

  // 2. Find nearby CRM properties
  const outward = postcodeOutwardCode(postcode);
  const neighbours = await findNearbyProperties(outward, propertyId || null);
  const vacantIds = await getVacantPropertyIds(neighbours.map(n => n.id));

  // 3. Geocode each neighbour (sequential — small batch). Cap to 25 to keep API spend down.
  const pins: Pin[] = [];
  pins.push({ lat: subject.lat, lng: subject.lng, color: PIN_COLORS.subject, label: "B", size: "mid" });

  const sample = neighbours.slice(0, 25);
  for (const n of sample) {
    const addr = n.address as any;
    const nAddress = [addr?.street, addr?.city, addr?.postcode].filter(Boolean).join(", ") || n.name;
    const coords = await geocodeAddress(nAddress);
    if (!coords) continue;
    const vacant = vacantIds.has(n.id);
    const cls = classifyProperty(n.asset_class);
    const color = vacant ? PIN_COLORS.vacant : cls === "food" ? PIN_COLORS.food : PIN_COLORS.retail;
    pins.push({ lat: coords.lat, lng: coords.lng, color, size: "small" });
  }

  // 4. Build the static map URL
  const mapUrl = buildStaticMapUrl(subject, pins, "800x640", 17);
  const res = await fetch(mapUrl);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google Static Maps failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // 5. Persist to Image Studio
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const fileName = `retail-context-${crypto.randomUUID()}.png`;
  const localPath = path.join(IMAGE_DIR, fileName);
  await fs.writeFile(localPath, buf);

  const meta = await sharp(buf).metadata();
  const thumb = await sharp(buf).resize(320, 240, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();

  const [row] = await db.insert(imageStudioImages).values({
    fileName: `Retail Context Plan — ${address}`,
    category: "Retail Context Plan",
    tags: ["retail-context-plan", outward || "unknown-outward"],
    description: `BGP retail context plan centred on ${address}. ${pins.length - 1} neighbouring retail/F&B units plotted; ${vacantIds.size} flagged as available.`,
    source: "retail-context-plan",
    propertyId: propertyId || undefined,
    address,
    mimeType: "image/png",
    fileSize: buf.length,
    width: meta.width || 0,
    height: meta.height || 0,
    thumbnailData: thumb.toString("base64"),
    localPath,
  }).returning();

  return { id: row.id, localPath, width: meta.width || 0, height: meta.height || 0 };
}

export function registerRetailContextPlanRoutes(app: Express) {
  app.post("/api/retail-context-plan/render", requireAuth, async (req: Request, res: Response) => {
    try {
      const { address, postcode, propertyId, radius } = req.body as RenderArgs;
      if (!address || typeof address !== "string") {
        return res.status(400).json({ error: "address required" });
      }
      const result = await renderRetailContextPlan({ address, postcode: postcode || "", propertyId: propertyId || null, radius });
      res.json({ success: true, imageId: result.id, width: result.width, height: result.height });
    } catch (err: any) {
      console.error("[retail-context-plan] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to render retail context plan" });
    }
  });
}
