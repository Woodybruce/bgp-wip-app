/**
 * Property Imagery Composers — render generated visuals (location plans,
 * comps charts, ERV walks, covenant cards) and persist them as Image
 * Studio images + property_imagery_assets rows.
 *
 * Each composer is pure-ish: takes structured inputs, produces a PNG
 * Buffer, uploads to Image Studio + the curation layer. Re-runnable —
 * generated_from snapshot lets us regenerate with the same inputs.
 *
 * v1 composers:
 *   - composeLocationPlan: Google Static Maps with property pin +
 *     optional layer markers (tube stations, anchor brands).
 *   - composeCompsChart: horizontal bar chart of investment / leasing
 *     comps for the area, drawn with node-canvas.
 *
 * ERV walk + covenant card composers land in a follow-up — same
 * pattern, different inputs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createCanvas } from "canvas";
import { db } from "./db";
import {
  propertyImageryAssets,
  imageStudioImages,
  crmProperties,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ImageryKind, ImagerySource } from "./property-imagery";

const IMAGE_DIR = path.join(process.cwd(), "uploads", "image-studio");
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

// ─── Location Plan ───────────────────────────────────────────────────────────

export interface LocationPlanInput {
  propertyId: string;
  zoom?: number;                  // 14–18 typical; default 16 (street + nearby blocks)
  mapType?: "roadmap" | "satellite" | "hybrid" | "terrain";
  /** Optional layer markers to drop on the map. */
  markers?: Array<{
    lat: number;
    lng: number;
    label?: string;               // single character — Google constraint
    color?: "red" | "blue" | "green" | "yellow" | "purple" | "orange";
    title?: string;               // tooltip-style; ignored by Google but useful for caption
  }>;
  size?: { w: number; h: number }; // default 1200x800
  generatedBy?: string;
  pathwayRunId?: string;
  matterId?: string;
}

export interface ComposerResult {
  ok: boolean;
  imageStudioId?: string;
  assetId?: string;
  error?: string;
}

/**
 * Compose a location plan PNG using Google Static Maps API. The property
 * pin is always added; caller-supplied markers (tube stations, anchor
 * brands, comp transactions) drop on top.
 */
export async function composeLocationPlan(input: LocationPlanInput): Promise<ComposerResult> {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return { ok: false, error: "GOOGLE_API_KEY not configured" };

    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, input.propertyId));
    if (!property) return { ok: false, error: "property not found" };
    const lat = property.latitude ? Number(property.latitude) : null;
    const lng = property.longitude ? Number(property.longitude) : null;
    if (!lat || !lng) return { ok: false, error: "property has no coordinates — resolve via the Property Resolver first" };

    const w = input.size?.w || 1200;
    const h = input.size?.h || 800;
    const zoom = input.zoom ?? 16;
    const mapType = input.mapType || "hybrid";

    // Build the URL — markers param can be repeated
    const params = new URLSearchParams();
    params.set("center", `${lat},${lng}`);
    params.set("zoom", String(zoom));
    params.set("size", `${w}x${h}`);
    params.set("maptype", mapType);
    params.set("scale", "2"); // Retina
    params.set("key", apiKey);

    // Subject pin — always red, large
    const subjectMarker = `color:red|label:S|size:mid|${lat},${lng}`;

    // Other markers from input
    const otherMarkers = (input.markers || []).map((m) => {
      const color = m.color || "blue";
      const label = (m.label || "•").charAt(0).toUpperCase();
      return `color:${color}|label:${label}|${m.lat},${m.lng}`;
    });

    const allMarkers = [subjectMarker, ...otherMarkers];
    // Google Static Maps URL has a length cap — chunk markers if needed
    let url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
    for (const m of allMarkers) {
      url += `&markers=${encodeURIComponent(m)}`;
    }

    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: `Google Static Maps ${resp.status}: ${text.slice(0, 100)}` };
    }
    const buffer = Buffer.from(await resp.arrayBuffer());

    const caption = `Location plan — ${property.name}${property.postcode ? `, ${property.postcode}` : ""} (${mapType}, zoom ${zoom})`;
    const result = await persistAsImageryAsset({
      propertyId: input.propertyId,
      kind: "location_plan",
      source: "google_static",
      buffer,
      filename: `location-plan-${slug(property.name)}-${Date.now()}.png`,
      caption,
      generatedFrom: { lat, lng, zoom, mapType, markers: input.markers || [] },
      generatedBy: input.generatedBy,
      pathwayRunId: input.pathwayRunId,
      matterId: input.matterId,
      width: w * 2,
      height: h * 2,
      score: 0.85,
    });
    return result;
  } catch (err: any) {
    console.error("[property-imagery-composers] location plan error:", err);
    return { ok: false, error: err?.message || "compose failed" };
  }
}

// ─── Comps Chart ─────────────────────────────────────────────────────────────

export interface CompsChartInput {
  propertyId: string;
  /** Pre-resolved comps to plot. Each one becomes a horizontal bar. */
  comps: Array<{
    label: string;                // e.g. "12 Hanover Sq — Q3 2025"
    psf: number;                  // £ psf for the bar value
    isSubject?: boolean;          // highlight the subject deal differently
    note?: string;                // small caption under the bar
  }>;
  unit?: string;                  // default "£/sqft ITZA"
  title?: string;                 // default "Comparable Evidence"
  generatedBy?: string;
  pathwayRunId?: string;
  matterId?: string;
}

export async function composeCompsChart(input: CompsChartInput): Promise<ComposerResult> {
  try {
    if (!input.comps || input.comps.length === 0) {
      return { ok: false, error: "no comps provided" };
    }
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, input.propertyId));
    if (!property) return { ok: false, error: "property not found" };

    // Layout — sized to look good in a memo at A4 width
    const W = 1200;
    const H = Math.max(400, 120 + input.comps.length * 56);
    const PAD_LEFT = 320;          // label column width
    const PAD_RIGHT = 80;
    const PAD_TOP = 80;
    const PAD_BOTTOM = 60;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = "#0E5BA8";    // BGP blue
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(input.title || "Comparable Evidence", PAD_LEFT - 40, 36);

    // Subtitle — property name
    ctx.fillStyle = "#666666";
    ctx.font = "italic 14px sans-serif";
    ctx.fillText(`Subject: ${property.name}${property.postcode ? `, ${property.postcode}` : ""}`, PAD_LEFT - 40, 58);

    // Compute scale
    const maxPsf = Math.max(...input.comps.map((c) => c.psf || 0));
    if (maxPsf <= 0) return { ok: false, error: "all comps have zero psf" };
    const barAreaWidth = W - PAD_LEFT - PAD_RIGHT;

    // Axis line
    ctx.strokeStyle = "#CCCCCC";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP - 8);
    ctx.lineTo(PAD_LEFT, H - PAD_BOTTOM);
    ctx.stroke();

    // Gridlines + axis labels at 0, 25%, 50%, 75%, 100%
    ctx.strokeStyle = "#EEEEEE";
    ctx.fillStyle = "#999999";
    ctx.font = "11px sans-serif";
    for (let i = 1; i <= 4; i++) {
      const x = PAD_LEFT + (barAreaWidth * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP - 8);
      ctx.lineTo(x, H - PAD_BOTTOM);
      ctx.stroke();
      const value = (maxPsf * i) / 4;
      ctx.fillText(`£${Math.round(value).toLocaleString()}`, x - 18, H - PAD_BOTTOM + 18);
    }
    ctx.fillStyle = "#999999";
    ctx.fillText("£0", PAD_LEFT - 12, H - PAD_BOTTOM + 18);
    ctx.fillText(input.unit || "£/sqft ITZA", PAD_LEFT + barAreaWidth - 80, H - PAD_BOTTOM + 36);

    // Bars
    const rowH = (H - PAD_TOP - PAD_BOTTOM) / input.comps.length;
    const barH = Math.min(28, rowH - 18);
    input.comps.forEach((comp, i) => {
      const y = PAD_TOP + i * rowH;
      const barW = (comp.psf / maxPsf) * barAreaWidth;
      // Label — left column
      ctx.fillStyle = comp.isSubject ? "#0E5BA8" : "#333333";
      ctx.font = comp.isSubject ? "bold 13px sans-serif" : "13px sans-serif";
      const truncated = comp.label.length > 40 ? comp.label.slice(0, 38) + "…" : comp.label;
      ctx.fillText(truncated, 24, y + barH * 0.7);
      // Bar
      ctx.fillStyle = comp.isSubject ? "#0E5BA8" : "#5C8FCC";
      ctx.fillRect(PAD_LEFT, y, barW, barH);
      // Value at end of bar
      ctx.fillStyle = "#333333";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(`£${Math.round(comp.psf).toLocaleString()}`, PAD_LEFT + barW + 8, y + barH * 0.7);
      // Note under bar
      if (comp.note) {
        ctx.fillStyle = "#999999";
        ctx.font = "italic 11px sans-serif";
        ctx.fillText(comp.note.slice(0, 60), PAD_LEFT, y + barH + 14);
      }
    });

    // Footer
    ctx.fillStyle = "#999999";
    ctx.font = "italic 10px sans-serif";
    ctx.fillText(`Generated by BGP Lease Advisory · ${new Date().toLocaleDateString("en-GB")}`, 24, H - 8);

    const buffer = canvas.toBuffer("image/png");

    const caption = `Comps chart — ${property.name} · ${input.comps.length} comparables`;
    return await persistAsImageryAsset({
      propertyId: input.propertyId,
      kind: "comps_chart",
      source: "generated_chart",
      buffer,
      filename: `comps-chart-${slug(property.name)}-${Date.now()}.png`,
      caption,
      generatedFrom: { comps: input.comps, unit: input.unit, title: input.title },
      generatedBy: input.generatedBy,
      pathwayRunId: input.pathwayRunId,
      matterId: input.matterId,
      width: W,
      height: H,
      score: 0.9,
    });
  } catch (err: any) {
    console.error("[property-imagery-composers] comps chart error:", err);
    return { ok: false, error: err?.message || "compose failed" };
  }
}

// ─── Persistence helper ──────────────────────────────────────────────────────

async function persistAsImageryAsset(args: {
  propertyId: string;
  kind: ImageryKind;
  source: ImagerySource;
  buffer: Buffer;
  filename: string;
  caption: string;
  generatedFrom?: any;
  generatedBy?: string;
  pathwayRunId?: string;
  matterId?: string;
  width: number;
  height: number;
  score: number;
}): Promise<ComposerResult> {
  const filePath = path.join(IMAGE_DIR, args.filename);
  fs.writeFileSync(filePath, args.buffer);

  // Generate a small thumbnail via sharp (loaded lazily to avoid the whole
  // module pulling sharp on import paths that don't need it).
  let thumbnailBase64: string | undefined;
  try {
    const sharp = (await import("sharp")).default;
    const thumb = await sharp(args.buffer).resize(320, 240, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    thumbnailBase64 = thumb.toString("base64");
  } catch (err: any) {
    console.warn("[property-imagery-composers] thumbnail failed:", err?.message);
  }

  // Insert into image_studio_images first so we have a stable id
  const [studio] = await db.insert(imageStudioImages).values({
    fileName: args.caption,
    category: args.kind === "comps_chart" || args.kind === "erv_walk" || args.kind === "covenant_card"
      ? "Generated Charts"
      : "Generated Plans",
    tags: ["auto-generated", args.kind, args.source],
    description: args.caption,
    source: args.source === "google_static" ? "ai" : "ai",
    propertyId: args.propertyId,
    mimeType: "image/png",
    fileSize: args.buffer.length,
    width: args.width,
    height: args.height,
    thumbnailData: thumbnailBase64 || null,
    localPath: filePath,
    uploadedBy: args.generatedBy || null,
  }).returning();

  // Then the curation row
  const [asset] = await db.insert(propertyImageryAssets).values({
    propertyId: args.propertyId,
    kind: args.kind,
    source: args.source,
    imageStudioId: studio.id,
    width: args.width,
    height: args.height,
    caption: args.caption,
    score: args.score,
    generatedFrom: args.generatedFrom || null,
    generatedBy: args.generatedBy || null,
    pathwayRunId: args.pathwayRunId || null,
    matterId: args.matterId || null,
  }).returning();

  return { ok: true, imageStudioId: studio.id, assetId: asset.id };
}

function slug(s: string): string {
  return (s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
