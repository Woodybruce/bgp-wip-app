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
  // Optional view override. When the user frames the shot on the interactive
  // map and hits "Capture", the client sends the live map center here so the
  // Static Maps render matches exactly what they positioned (rather than
  // always centring on the property pin). The subject pin still drops at the
  // property's own coordinates regardless of where the view is centred.
  centerLat?: number;
  centerLng?: number;
  // Where the generated map shot lands in the imagery — defaults to the
  // location plan, but can be saved as the hero or a gallery shot.
  kind?: "location_plan" | "hero" | "secondary_external";
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

    // The Static Maps view is centred either on the user's framed position
    // (when the interactive widget sends one) or on the subject pin itself.
    const centerLat = input.centerLat ?? lat;
    const centerLng = input.centerLng ?? lng;

    // Build the URL — markers param can be repeated
    const params = new URLSearchParams();
    params.set("center", `${centerLat},${centerLng}`);
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

    const caption = `${input.kind === "hero" ? "Hero" : "Location plan"} — ${property.name}${property.postcode ? `, ${property.postcode}` : ""} (${mapType}, zoom ${zoom})`;
    const result = await persistAsImageryAsset({
      propertyId: input.propertyId,
      kind: input.kind || "location_plan",
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

// ─── ERV walk ────────────────────────────────────────────────────────────────

export interface ErvWalkInput {
  propertyId: string;
  /** Annual rent today (£/year) — what the tenant is paying. */
  passingRentPa: number;
  /** Estimated rental value at next review / reversion. */
  ervPa: number;
  /** Stepped rents along the term — fixed uplifts written into the lease. */
  steppedRents?: Array<{ fromYear: number; rentPa: number; label?: string }>;
  /** Years from today to the next review (rent typically uplifts to ERV here). */
  yearsToReview?: number;
  /** Years from today to lease expiry. */
  yearsToExpiry?: number;
  /** Optional: NIA in sqft so we can show £/sqft alongside £ p.a. */
  areaSqft?: number;
  title?: string;
  generatedBy?: string;
  pathwayRunId?: string;
  matterId?: string;
}

export async function composeErvWalk(input: ErvWalkInput): Promise<ComposerResult> {
  try {
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, input.propertyId));
    if (!property) return { ok: false, error: "property not found" };

    // Build the walk: passing → stepped uplifts (each year) → ERV at review → flat to expiry
    const points: Array<{ year: number; rent: number; label: string }> = [];
    points.push({ year: 0, rent: input.passingRentPa, label: "Passing" });

    const steps = (input.steppedRents || []).slice().sort((a, b) => a.fromYear - b.fromYear);
    for (const s of steps) {
      points.push({ year: s.fromYear, rent: s.rentPa, label: s.label || `Yr ${s.fromYear}` });
    }
    if (input.yearsToReview && input.yearsToReview > 0) {
      points.push({ year: input.yearsToReview, rent: input.ervPa, label: "Review → ERV" });
    }
    if (input.yearsToExpiry && input.yearsToExpiry > (input.yearsToReview || 0)) {
      points.push({ year: input.yearsToExpiry, rent: input.ervPa, label: "Expiry" });
    }

    const W = 1200, H = 480;
    const PAD_L = 110, PAD_R = 60, PAD_T = 80, PAD_B = 80;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = "#0E5BA8"; ctx.font = "bold 22px sans-serif";
    ctx.fillText(input.title || "ERV walk — passing to reversion", PAD_L - 80, 36);
    ctx.fillStyle = "#666666"; ctx.font = "italic 13px sans-serif";
    ctx.fillText(`${property.name}${property.postcode ? ", " + property.postcode : ""}`, PAD_L - 80, 56);

    // Scales
    const maxYear = Math.max(...points.map((p) => p.year), 1);
    const maxRent = Math.max(...points.map((p) => p.rent));
    const minRent = Math.min(...points.map((p) => p.rent));
    const yMin = Math.max(0, minRent * 0.85);
    const yMax = maxRent * 1.1;

    const xAt = (year: number) => PAD_L + ((year / maxYear) * (W - PAD_L - PAD_R));
    const yAt = (rent: number) => H - PAD_B - ((rent - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);

    // Y-axis gridlines + labels
    ctx.strokeStyle = "#EEEEEE"; ctx.fillStyle = "#999999"; ctx.font = "11px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const r = yMin + ((yMax - yMin) * i) / 4;
      const y = yAt(r);
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.fillText(`£${Math.round(r).toLocaleString()}`, 16, y + 4);
    }

    // X-axis labels (years)
    ctx.fillStyle = "#999999"; ctx.font = "11px sans-serif";
    const xTicks = Math.min(maxYear, 10);
    for (let i = 0; i <= xTicks; i++) {
      const y = Math.round((maxYear * i) / xTicks);
      const x = xAt(y);
      ctx.fillText(`Yr ${y}`, x - 12, H - PAD_B + 18);
    }

    // Step line — passing → uplifts → ERV → expiry
    ctx.strokeStyle = "#0E5BA8"; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = xAt(p.year);
      const y = yAt(p.rent);
      if (i === 0) ctx.moveTo(x, y);
      else {
        // Step: hold previous y to current x, then jump to new y
        const prev = points[i - 1];
        const prevX = xAt(prev.year);
        const prevY = yAt(prev.rent);
        ctx.lineTo(prevX, prevY);   // ensure we're at prev
        ctx.lineTo(x, prevY);       // horizontal
        ctx.lineTo(x, y);           // vertical (step)
      }
    }
    ctx.stroke();

    // Markers + labels per point
    for (const p of points) {
      const x = xAt(p.year);
      const y = yAt(p.rent);
      ctx.fillStyle = "#0E5BA8";
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#333333"; ctx.font = "bold 12px sans-serif";
      ctx.fillText(`£${Math.round(p.rent).toLocaleString()}`, x - 30, y - 12);
      ctx.fillStyle = "#666666"; ctx.font = "italic 11px sans-serif";
      ctx.fillText(p.label, x - 24, y + 22);
    }

    // ERV reversion uplift annotation (if present)
    if (input.ervPa > input.passingRentPa) {
      const upliftPct = ((input.ervPa - input.passingRentPa) / input.passingRentPa) * 100;
      ctx.fillStyle = "#0E5BA8";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(`Reversion uplift: +${upliftPct.toFixed(1)}%`, PAD_L, 80);
    }

    // £/sqft if area provided
    if (input.areaSqft && input.areaSqft > 0) {
      const passPsf = input.passingRentPa / input.areaSqft;
      const ervPsf = input.ervPa / input.areaSqft;
      ctx.fillStyle = "#666666"; ctx.font = "11px sans-serif";
      ctx.fillText(`Passing £${passPsf.toFixed(2)}/sqft → ERV £${ervPsf.toFixed(2)}/sqft`, PAD_L, H - 24);
    }

    // Footer
    ctx.fillStyle = "#999999"; ctx.font = "italic 10px sans-serif";
    ctx.fillText(`BGP Lease Advisory · ${new Date().toLocaleDateString("en-GB")}`, 24, H - 8);

    const buffer = canvas.toBuffer("image/png");
    const caption = `ERV walk — ${property.name} · £${input.passingRentPa.toLocaleString()} → £${input.ervPa.toLocaleString()}`;
    return await persistAsImageryAsset({
      propertyId: input.propertyId,
      kind: "erv_walk",
      source: "generated_chart",
      buffer,
      filename: `erv-walk-${slug(property.name)}-${Date.now()}.png`,
      caption,
      generatedFrom: input,
      generatedBy: input.generatedBy,
      pathwayRunId: input.pathwayRunId,
      matterId: input.matterId,
      width: W,
      height: H,
      score: 0.9,
    });
  } catch (err: any) {
    console.error("[property-imagery-composers] erv walk error:", err);
    return { ok: false, error: err?.message || "compose failed" };
  }
}

// ─── Covenant card ───────────────────────────────────────────────────────────

export interface CovenantCardInput {
  propertyId: string;
  tenantName: string;
  companiesHouseNumber?: string | null;
  latestAccountsYear?: number | null;
  revenuePa?: number | null;
  ebitda?: number | null;
  netIncome?: number | null;
  netCash?: number | null;
  numEmployees?: number | null;
  parentName?: string | null;
  sanctionsClean?: boolean | null;
  pepClean?: boolean | null;
  riskLevel?: "low" | "medium" | "high" | null;
  dunbradstreetRating?: string | null;
  notes?: string | null;
  title?: string;
  generatedBy?: string;
  pathwayRunId?: string;
  matterId?: string;
}

export async function composeCovenantCard(input: CovenantCardInput): Promise<ComposerResult> {
  try {
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, input.propertyId));
    if (!property) return { ok: false, error: "property not found" };

    const W = 1200, H = 600;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);

    // Top blue header band
    ctx.fillStyle = "#0E5BA8"; ctx.fillRect(0, 0, W, 80);
    ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 24px sans-serif";
    ctx.fillText(input.title || "Tenant Covenant", 32, 38);
    ctx.font = "italic 14px sans-serif";
    ctx.fillText(`${property.name}${property.postcode ? ", " + property.postcode : ""}`, 32, 62);

    // Tenant block
    ctx.fillStyle = "#333333"; ctx.font = "bold 26px sans-serif";
    ctx.fillText(input.tenantName, 32, 130);
    if (input.companiesHouseNumber) {
      ctx.fillStyle = "#666666"; ctx.font = "13px sans-serif";
      ctx.fillText(`Companies House ${input.companiesHouseNumber}`, 32, 154);
    }
    if (input.parentName) {
      ctx.fillStyle = "#666666"; ctx.font = "italic 13px sans-serif";
      ctx.fillText(`Parent: ${input.parentName}`, 32, 174);
    }

    // Risk badges row (top-right)
    let badgeX = W - 32;
    const drawBadge = (label: string, color: string, textColor: string = "#FFFFFF") => {
      ctx.font = "bold 12px sans-serif";
      const w = ctx.measureText(label).width + 24;
      badgeX -= w + 8;
      ctx.fillStyle = color; ctx.fillRect(badgeX, 110, w, 24);
      ctx.fillStyle = textColor; ctx.fillText(label, badgeX + 12, 126);
    };
    if (input.riskLevel) {
      const colour = input.riskLevel === "low" ? "#16A34A" : input.riskLevel === "medium" ? "#D97706" : "#DC2626";
      drawBadge(`Risk: ${input.riskLevel.toUpperCase()}`, colour);
    }
    if (input.pepClean === true) drawBadge("PEP clean", "#16A34A");
    if (input.pepClean === false) drawBadge("PEP flag", "#DC2626");
    if (input.sanctionsClean === true) drawBadge("Sanctions clean", "#16A34A");
    if (input.sanctionsClean === false) drawBadge("Sanctions hit", "#DC2626");

    // Financial grid (4 stat cells)
    const grid = [
      { label: "Revenue (latest)", value: fmtMoney(input.revenuePa) },
      { label: "EBITDA", value: fmtMoney(input.ebitda) },
      { label: "Net income", value: fmtMoney(input.netIncome) },
      { label: "Net cash", value: fmtMoney(input.netCash) },
    ];
    const cellW = (W - 64 - 36) / 4;
    grid.forEach((cell, i) => {
      const x = 32 + i * (cellW + 12);
      const y = 220;
      ctx.fillStyle = "#F4F6FA"; ctx.fillRect(x, y, cellW, 90);
      ctx.fillStyle = "#666666"; ctx.font = "11px sans-serif";
      ctx.fillText(cell.label, x + 12, y + 22);
      ctx.fillStyle = "#0E5BA8"; ctx.font = "bold 22px sans-serif";
      ctx.fillText(cell.value, x + 12, y + 60);
    });

    // Lower row — accounts age, employees, D&B
    const lowerY = 340;
    let lowerX = 32;
    const drawLower = (label: string, value: string) => {
      ctx.fillStyle = "#666666"; ctx.font = "11px sans-serif";
      ctx.fillText(label, lowerX, lowerY);
      ctx.fillStyle = "#333333"; ctx.font = "bold 16px sans-serif";
      ctx.fillText(value, lowerX, lowerY + 22);
      lowerX += 220;
    };
    if (input.latestAccountsYear) drawLower("Latest accounts", String(input.latestAccountsYear));
    if (input.numEmployees) drawLower("Employees", input.numEmployees.toLocaleString());
    if (input.dunbradstreetRating) drawLower("D&B rating", input.dunbradstreetRating);

    // Notes block
    if (input.notes) {
      ctx.fillStyle = "#666666"; ctx.font = "11px sans-serif";
      ctx.fillText("Notes", 32, 420);
      ctx.fillStyle = "#333333"; ctx.font = "13px sans-serif";
      // Word wrap
      const maxWidth = W - 64;
      const words = input.notes.split(/\s+/);
      let line = "";
      let y = 442;
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, 32, y);
          line = w;
          y += 18;
          if (y > H - 60) break;
        } else {
          line = test;
        }
      }
      if (line && y <= H - 60) ctx.fillText(line, 32, y);
    }

    // Footer
    ctx.fillStyle = "#999999"; ctx.font = "italic 10px sans-serif";
    ctx.fillText(`BGP Lease Advisory · ${new Date().toLocaleDateString("en-GB")} · sources: Companies House, Comply Advantage`, 32, H - 16);

    const buffer = canvas.toBuffer("image/png");
    const caption = `Covenant card — ${input.tenantName}${input.companiesHouseNumber ? ` (${input.companiesHouseNumber})` : ""}`;
    return await persistAsImageryAsset({
      propertyId: input.propertyId,
      kind: "covenant_card",
      source: "generated_chart",
      buffer,
      filename: `covenant-${slug(input.tenantName)}-${Date.now()}.png`,
      caption,
      generatedFrom: input,
      generatedBy: input.generatedBy,
      pathwayRunId: input.pathwayRunId,
      matterId: input.matterId,
      width: W,
      height: H,
      score: 0.9,
    });
  } catch (err: any) {
    console.error("[property-imagery-composers] covenant card error:", err);
    return { ok: false, error: err?.message || "compose failed" };
  }
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}m`;
  if (Math.abs(v) >= 1_000) return `£${(v / 1_000).toFixed(0)}k`;
  return `£${v.toLocaleString()}`;
}
