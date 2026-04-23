// Retail Context Plan — BGP's Goad-equivalent.
//
// Triangulates VOA + OSM buildings + Google Places + CRM + leasing comps
// into a clean, branded retail plan of the streetscape around a subject.
// Output is a PNG saved into image_studio_images, tagged "retail-context-plan".
//
// Data pipeline lives in `goad-plan-data.ts`; rendering in `goad-plan-renderer.ts`.
// This file orchestrates the two and persists the result.

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { imageStudioImages } from "@shared/schema";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { buildMappedUnits } from "./goad-plan-data";
import { renderGoadPlan } from "./goad-plan-renderer";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const IMAGE_DIR = path.join(process.cwd(), "uploads", "image-studio");

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
  return cleaned.slice(0, Math.max(0, cleaned.length - 3));
}

export async function renderRetailContextPlan(args: RenderArgs): Promise<{ id: string; localPath: string; width: number; height: number }> {
  const { address, postcode, propertyId } = args;
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not configured");

  // 1. Geocode the subject.
  const subjectCoord = await geocodeAddress([address, postcode].filter(Boolean).join(", "));
  if (!subjectCoord) throw new Error("Could not geocode subject address");

  // 2. Build the mapped unit list (VOA + Places + CRM + cache).
  const planData = await buildMappedUnits({
    subject: { lat: subjectCoord.lat, lng: subjectCoord.lng, address, postcode },
    propertyId: propertyId || null,
    bboxMeters: 180,
    maxGeocodesPerRun: 30,
    maxPlaceLookupsPerRun: 40,
  });

  // 3. Render.
  const plan = await renderGoadPlan({
    subject: planData.subject,
    units: planData.units,
    bbox: planData.bbox,
    addressLine: address,
    postcodeLine: postcode || undefined,
    stats: planData.stats,
  });

  // 4. Persist.
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const fileName = `retail-context-${crypto.randomUUID()}.png`;
  const localPath = path.join(IMAGE_DIR, fileName);
  await fs.writeFile(localPath, plan.pngBuffer);
  const thumb = await sharp(plan.pngBuffer).resize(320, 240, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
  const outward = postcodeOutwardCode(postcode);

  const [row] = await db.insert(imageStudioImages).values({
    fileName: `Retail Context Plan — ${address}`,
    category: "Retail Context Plan",
    tags: ["retail-context-plan", "goad-style", outward || "unknown-outward"],
    description:
      `BGP retail context plan centred on ${address}. ` +
      `${plan.matchedUnits} unit(s) matched to ${plan.buildingsCount} OSM building(s). ` +
      `VOA rows: ${planData.stats.voaRows}, new geocodes: ${planData.stats.geocoded}, ` +
      `Places lookups: ${planData.stats.placesMatched}, CRM overrides: ${planData.stats.crmOverrides}.`,
    source: "retail-context-plan",
    propertyId: propertyId || undefined,
    address,
    mimeType: "image/png",
    fileSize: plan.pngBuffer.length,
    width: plan.width,
    height: plan.height,
    thumbnailData: thumb.toString("base64"),
    localPath,
  }).returning();

  return { id: row.id, localPath, width: plan.width, height: plan.height };
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
