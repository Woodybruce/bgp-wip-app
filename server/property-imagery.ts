/**
 * Property Imagery — discovery + curation + retrieval.
 *
 * Sits on top of image_studio_images (file/edit layer) and adds the
 * "for-property classification" — which image plays which role for a
 * given property: hero, internal, secondary external, location plan,
 * floor plan, comps chart, ERV walk, covenant card.
 *
 * Used by:
 *   - Pathway Stage 8 + 9 (Studio Time + Why Buy)
 *   - PLA Matter detail page (rent-review reps, dilapidations cover etc)
 *   - Property Intelligence page (Imagery tab)
 *   - Document Studio briefs (Brochure, HoT, Market Report etc)
 *   - ChatBGP get_property_imagery tool
 *
 * Discovery walks every existing source: Stage 8 sweep results (already
 * harvested into image_studio_images), brochure scrape pages, SharePoint
 * property folder, Street View capture, planning portal docs, OS NGD
 * polygon overlays, Google Static maps. Each source produces one or more
 * candidate rows; the picker UI (reusable component) lets a user mark
 * pinned/hidden/edit per kind.
 *
 * Composers (location plan with overlays, comps chart, ERV walk, covenant
 * card) live in pla-workbook-writer style — pure functions that produce a
 * Buffer + persist it as an Image Studio image + a property_imagery_assets
 * row. Lands in a follow-up commit; this module focuses on the discovery
 * + retrieval layer.
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import {
  propertyImageryAssets,
  imageStudioImages,
  crmProperties,
  investmentComps,
  crmComps,
  type PropertyImageryAsset,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { composeLocationPlan, composeCompsChart, composeErvWalk, composeCovenantCard } from "./property-imagery-composers";
import { plaMatters, crmCompanies, brandStores } from "@shared/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImageryKind =
  | "hero"
  | "internal"
  | "secondary_external"
  | "location_plan"
  | "floor_plan"
  | "covenant_card"
  | "comps_chart"
  | "erv_walk"
  | "overlay";

export type ImagerySource =
  | "brochure"
  | "sharepoint"
  | "street_view"
  | "planning_portal"
  | "os_ngd"
  | "google_static"
  | "edozo"
  | "cad_measure"
  | "image_studio"
  | "generated_chart"
  | "manual_upload";

export interface ImageryManifest {
  propertyId: string;
  byKind: Record<ImageryKind, ImageryCandidate[]>;
  generatedAt: number;
}

export interface ImageryCandidate {
  id: string;                          // property_imagery_assets.id
  kind: ImageryKind;
  source: ImagerySource;
  imageStudioId: string | null;
  sourceUrl: string | null;
  thumbnail: string | null;            // base64 from image_studio_images.thumbnailData
  width: number | null;
  height: number | null;
  caption: string | null;
  score: number;
  pinned: boolean;
  hidden: boolean;
  generatedAt: string;
}

const ALL_KINDS: ImageryKind[] = [
  "hero",
  "internal",
  "secondary_external",
  "location_plan",
  "floor_plan",
  "covenant_card",
  "comps_chart",
  "erv_walk",
  "overlay",
];

// ─── Discovery ───────────────────────────────────────────────────────────────

/**
 * Discover imagery for a property. Walks every available source, populates
 * property_imagery_assets, returns the manifest. Idempotent — re-runs
 * upgrade existing rows rather than duplicating.
 */
export async function discoverImagery(args: {
  propertyId: string;
  pathwayRunId?: string;
  matterId?: string;
  sources?: ImagerySource[];           // undefined = all available
  userId?: string;
}): Promise<ImageryManifest> {
  const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, args.propertyId));
  if (!property) {
    throw new Error(`Property ${args.propertyId} not found`);
  }

  const wanted = new Set<ImagerySource>(args.sources || [
    "image_studio",
    "sharepoint",
    // brochure / planning / os_ngd / google_static / edozo land in follow-ups
  ]);

  // 1. Existing image_studio_images for this property — folds in Stage 8
  //    sweep results, manual uploads, prior captures.
  if (wanted.has("image_studio")) {
    await ingestExistingImageStudio(args.propertyId, args.pathwayRunId, args.matterId);
  }

  // 2. SharePoint property folder — if the property has sharepointFolderUrl,
  //    walk it for image files. (Implementation in follow-up commit; needs
  //    Microsoft Graph token from the request context.)
  // if (wanted.has("sharepoint")) await ingestSharePoint(...);

  return await getManifest(args.propertyId);
}

/**
 * Fold every image_studio_images row tagged to this property into the
 * curation layer. Idempotent — uses (property_id, image_studio_id, kind)
 * as the dedupe key.
 */
async function ingestExistingImageStudio(
  propertyId: string,
  pathwayRunId?: string,
  matterId?: string,
): Promise<void> {
  const studioImages = await db
    .select()
    .from(imageStudioImages)
    .where(eq(imageStudioImages.propertyId, propertyId));

  if (studioImages.length === 0) return;

  const existing = await db
    .select({ imageStudioId: propertyImageryAssets.imageStudioId, kind: propertyImageryAssets.kind })
    .from(propertyImageryAssets)
    .where(eq(propertyImageryAssets.propertyId, propertyId));
  const seen = new Set(existing.filter((e) => e.imageStudioId).map((e) => `${e.imageStudioId}|${e.kind}`));

  const inserts = [];
  for (const img of studioImages) {
    const kind = inferKindFromStudioImage(img);
    const key = `${img.id}|${kind}`;
    if (seen.has(key)) continue;
    inserts.push({
      propertyId,
      kind,
      source: mapStudioSource(img.source),
      imageStudioId: img.id,
      sourceUrl: null,
      width: img.width,
      height: img.height,
      caption: img.description || img.fileName,
      score: scoreStudioImage(img, kind),
      pathwayRunId: pathwayRunId || null,
      matterId: matterId || null,
    });
  }
  if (inserts.length > 0) {
    await db.insert(propertyImageryAssets).values(inserts as any);
  }
}

/**
 * Infer the imagery kind from an Image Studio image's metadata. Heuristics
 * over filename + description + category + tags + dimensions. The picker
 * UI lets users reclassify if we get it wrong.
 *
 * Priority order matters — floor plans are checked before "internal" because
 * "first floor plan" contains both keywords; covenant cards before "card";
 * etc.
 */
function inferKindFromStudioImage(img: typeof imageStudioImages.$inferSelect): ImageryKind {
  const cat = (img.category || "").toLowerCase();
  const tags = (img.tags || []).map((t) => t.toLowerCase());
  const fn = (img.fileName || "").toLowerCase();
  const desc = (img.description || "").toLowerCase();
  const all = [cat, fn, desc, ...tags].join(" ");

  // Generated charts / cards (BGP composers create these)
  if (all.includes("comps chart") || all.includes("comparables chart")) return "comps_chart";
  if (all.includes("erv walk") || all.includes("rent walk")) return "erv_walk";
  if (all.includes("covenant card") || all.includes("covenant")) return "covenant_card";
  if (all.includes("location plan")) return "location_plan";

  // Floor plans — checked early because "first floor plan" / "ground
  // floor plan" contain both "floor plan" and floor names
  if (all.includes("floor plan") || all.includes("floorplan") ||
      all.includes("floorplate") || all.includes("layout") ||
      all.includes("ground floor") || all.includes("first floor") ||
      all.includes("upper floor") || all.includes("basement plan") ||
      /\bplan\b.*\bfloor\b|\bfloor\b.*\bplan\b/i.test(all)) {
    return "floor_plan";
  }

  // Aspect-ratio hint: floor plans tend to be very wide or square — but
  // this alone isn't enough; we also need a plan-ish keyword OR the image
  // be from a brochure (where Stage 8 extracts both photos and plans).
  const fromBrochure = (img.source || "").toLowerCase() === "pathway" || all.includes("brochure");
  if (fromBrochure && img.width && img.height) {
    const ar = img.width / img.height;
    // Very wide / very tall images from brochures are probably plans/maps
    if ((ar > 1.6 || ar < 0.7) && all.includes("plan")) return "floor_plan";
  }

  // Map / location
  if (all.includes("map") || all.includes("street map") || all.includes("aerial")) return "location_plan";

  // Hero / front
  if (all.includes("hero") || all.includes("building front") ||
      all.includes("front view") || all.includes("frontage")) {
    return "hero";
  }

  // Internal / interior — checked AFTER floor_plan to avoid mis-classifying
  // "first floor [plan]" as internal
  if (all.includes("internal") || all.includes("interior") ||
      all.includes("inside") || all.includes("reception") ||
      all.includes("office space") || all.includes("trading space") ||
      all.includes("kitchen") || all.includes("bathroom")) {
    return "internal";
  }

  // External / street view
  if (all.includes("street view") || all.includes("exterior") || all.includes("rear") ||
      all.includes("side view")) {
    return "secondary_external";
  }

  // Brand / logo overlay
  if (all.includes("logo") || all.includes("brand mark")) return "overlay";

  // Default — secondary external (picker lets users promote to hero or
  // reclassify). The Stage 8 sweep tags everything with "pathway" so most
  // unclassified images here are brochure photos.
  return "secondary_external";
}

function mapStudioSource(s: string | null | undefined): ImagerySource {
  switch (s) {
    case "streetview": return "street_view";
    case "stock":      return "image_studio";
    case "ai":         return "image_studio";
    case "upload":     return "manual_upload";
    case "pathway":    return "brochure";
    default:           return "image_studio";
  }
}

/**
 * Heuristic ranking — Street View captures are good for secondary external,
 * brochure pages tend to be hero-quality, larger dimensions outrank smaller.
 */
function scoreStudioImage(img: typeof imageStudioImages.$inferSelect, kind: ImageryKind): number {
  let base = 0.5;
  // Source preference per kind
  const src = img.source || "";
  if (kind === "hero") {
    if (src === "upload") base = 0.9;        // hand-picked beats auto
    else if (src === "pathway") base = 0.8;  // brochure scrape
    else if (src === "streetview") base = 0.4;
  } else if (kind === "secondary_external") {
    if (src === "streetview") base = 0.7;
    else base = 0.5;
  } else if (kind === "internal") {
    if (src === "pathway") base = 0.8;
    else if (src === "upload") base = 0.7;
    else base = 0.3;
  } else if (kind === "floor_plan") {
    base = src === "pathway" ? 0.6 : 0.3;
  }
  // Resolution bonus for large images
  if (img.width && img.height) {
    const px = img.width * img.height;
    if (px > 1920 * 1080) base += 0.1;
    else if (px < 640 * 480) base -= 0.1;
  }
  return Math.max(0, Math.min(1, base));
}

// ─── Retrieval ───────────────────────────────────────────────────────────────

export async function getManifest(propertyId: string): Promise<ImageryManifest> {
  const rows = await db
    .select({
      asset: propertyImageryAssets,
      thumbnail: imageStudioImages.thumbnailData,
    })
    .from(propertyImageryAssets)
    .leftJoin(imageStudioImages, eq(propertyImageryAssets.imageStudioId, imageStudioImages.id))
    .where(
      and(
        eq(propertyImageryAssets.propertyId, propertyId),
        eq(propertyImageryAssets.hidden, false),
      ),
    )
    .orderBy(desc(propertyImageryAssets.pinned), desc(propertyImageryAssets.score), desc(propertyImageryAssets.generatedAt));

  const byKind: Record<ImageryKind, ImageryCandidate[]> = {
    hero: [], internal: [], secondary_external: [],
    location_plan: [], floor_plan: [], covenant_card: [],
    comps_chart: [], erv_walk: [], overlay: [],
  };

  for (const row of rows) {
    const asset = row.asset;
    const kind = asset.kind as ImageryKind;
    if (!byKind[kind]) continue;
    byKind[kind].push({
      id: asset.id,
      kind,
      source: asset.source as ImagerySource,
      imageStudioId: asset.imageStudioId,
      sourceUrl: asset.sourceUrl,
      thumbnail: row.thumbnail || null,
      width: asset.width,
      height: asset.height,
      caption: asset.caption,
      score: asset.score ?? 0.5,
      pinned: asset.pinned ?? false,
      hidden: asset.hidden ?? false,
      generatedAt: asset.generatedAt?.toISOString() || new Date().toISOString(),
    });
  }

  return { propertyId, byKind, generatedAt: Date.now() };
}

// ─── HTTP routes ─────────────────────────────────────────────────────────────

export function registerPropertyImageryRoutes(app: Express): void {
  /** Run discovery for a property and return the manifest. */
  app.post("/api/property-imagery/:propertyId/discover", requireAuth, async (req: Request, res: Response) => {
    try {
      const propertyId = String(req.params.propertyId);
      const userId = (req as any).user?.id;
      const sources = Array.isArray(req.body?.sources) ? req.body.sources as ImagerySource[] : undefined;
      const manifest = await discoverImagery({
        propertyId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId: req.body?.matterId,
        sources,
        userId,
      });
      return res.json(manifest);
    } catch (err: any) {
      console.error("[property-imagery] discover error:", err);
      return res.status(500).json({ error: err?.message || "discover failed" });
    }
  });

  /** Get the existing manifest without re-running discovery. */
  app.get("/api/property-imagery/:propertyId/manifest", requireAuth, async (req: Request, res: Response) => {
    try {
      const manifest = await getManifest(String(req.params.propertyId));
      return res.json(manifest);
    } catch (err: any) {
      console.error("[property-imagery] manifest error:", err);
      return res.status(500).json({ error: err?.message || "manifest failed" });
    }
  });

  /** Pin / unpin / reclassify / hide / unhide an asset. */
  app.patch("/api/property-imagery/asset/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const updates: Partial<PropertyImageryAsset> = {};
      if ("pinned" in req.body) (updates as any).pinned = !!req.body.pinned;
      if ("hidden" in req.body) (updates as any).hidden = !!req.body.hidden;
      if (typeof req.body?.kind === "string" && ALL_KINDS.includes(req.body.kind)) {
        (updates as any).kind = req.body.kind;
      }
      if (typeof req.body?.caption === "string") (updates as any).caption = req.body.caption;
      if (typeof req.body?.score === "number") (updates as any).score = req.body.score;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "no valid updates" });
      // Pinning is exclusive per (property, kind) — only one pinned per role.
      if ((updates as any).pinned === true) {
        const [asset] = await db.select().from(propertyImageryAssets).where(eq(propertyImageryAssets.id, id));
        if (asset) {
          await db
            .update(propertyImageryAssets)
            .set({ pinned: false } as any)
            .where(
              and(
                eq(propertyImageryAssets.propertyId, asset.propertyId),
                eq(propertyImageryAssets.kind, asset.kind),
              ),
            );
        }
      }
      const [updated] = await db.update(propertyImageryAssets).set(updates as any).where(eq(propertyImageryAssets.id, id)).returning();
      return res.json(updated);
    } catch (err: any) {
      console.error("[property-imagery] patch error:", err);
      return res.status(500).json({ error: err?.message || "patch failed" });
    }
  });

  /** Delete (hard) — for clearing genuinely bad rows. */
  app.delete("/api/property-imagery/asset/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await db.delete(propertyImageryAssets).where(eq(propertyImageryAssets.id, String(req.params.id)));
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "delete failed" });
    }
  });

  // ── Composers ────────────────────────────────────────────────────────────
  /** Generate a location plan PNG (Google Static + property pin + optional markers). */
  app.post("/api/property-imagery/:propertyId/compose/location-plan", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const propertyId = String(req.params.propertyId);
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
      if (!property) return res.status(404).json({ error: "property not found" });

      // Caller can request layer auto-population — we resolve the markers
      // server-side rather than making the client ferry coordinates.
      const layers = Array.isArray(req.body?.layers) ? req.body.layers as string[] : [];
      let markers = Array.isArray(req.body?.markers) ? [...req.body.markers] : [];
      if (layers.length > 0 && property.latitude && property.longitude) {
        const lat = Number(property.latitude);
        const lng = Number(property.longitude);
        if (layers.includes("tube")) {
          markers.push(...await fetchTubeMarkers(lat, lng));
        }
        if (layers.includes("comps")) {
          markers.push(...await fetchCompMarkers(property.postcode));
        }
        if (layers.includes("anchors")) {
          markers.push(...await fetchAnchorBrandMarkers(lat, lng, 600));
        }
        if (layers.includes("restaurants")) {
          markers.push(...await fetchRestaurantMarkers(lat, lng, 500));
        }
      }

      const result = await composeLocationPlan({
        propertyId,
        zoom: req.body?.zoom,
        mapType: req.body?.mapType,
        kind: req.body?.kind,
        markers,
        size: req.body?.size,
        generatedBy: userId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId: req.body?.matterId,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json({ ...result, markersUsed: markers.length });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "compose failed" });
    }
  });

  /** Generate a comps chart PNG (horizontal bars, BGP-styled). */
  app.post("/api/property-imagery/:propertyId/compose/comps-chart", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!Array.isArray(req.body?.comps) || req.body.comps.length === 0) {
        return res.status(400).json({ error: "comps array required" });
      }
      const result = await composeCompsChart({
        propertyId: String(req.params.propertyId),
        comps: req.body.comps,
        unit: req.body?.unit,
        title: req.body?.title,
        generatedBy: userId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId: req.body?.matterId,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "compose failed" });
    }
  });

  // Wire ERV walk + covenant card composer routes
  registerComposerExtras(app);

  /**
   * Auto-pull comps from investment_comps + crm_comps based on locality
   * (postcode prefix) and render the chart in one click. The most useful
   * variant for Tom + Pete + Nick — they don't want to construct the
   * comps array by hand.
   */
  app.post("/api/property-imagery/:propertyId/compose/comps-chart-auto", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const propertyId = String(req.params.propertyId);
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
      if (!property) return res.status(404).json({ error: "property not found" });

      // Use the supplied scope, or fall back to postcode-prefix matching
      // (e.g. "W1" matches "W1A 1AB", "W1B 5DG" etc).
      const scope = (req.body?.scope || "investment") as "investment" | "leasing" | "both";
      const limit = Math.min(Number(req.body?.limit) || 8, 12);
      const monthsBack = Number(req.body?.monthsBack) || 36;
      const postcode = (property.postcode || "").trim().toUpperCase();
      const pcPrefix = pcArea(postcode);
      if (!pcPrefix) {
        return res.status(400).json({ error: "property has no postcode — set one or supply explicit comps" });
      }

      const comps: Array<{ label: string; psf: number; isSubject?: boolean; note?: string; date?: string | null }> = [];

      // Investment comps: pricePsf (capital values, not rent)
      if (scope === "investment" || scope === "both") {
        const rows = await db
          .select()
          .from(investmentComps)
          .where(sql`${investmentComps.postalCode} ILIKE ${pcPrefix + "%"}`)
          .limit(50);
        const recent = rows
          .filter((r) => (r.pricePsf ?? 0) > 0)
          .filter((r) => withinMonths(r.transactionDate, monthsBack))
          .sort((a, b) => (txDate(b.transactionDate)?.getTime() || 0) - (txDate(a.transactionDate)?.getTime() || 0))
          .slice(0, limit);
        for (const r of recent) {
          comps.push({
            label: r.propertyName || r.address || `Investment comp`,
            psf: r.pricePsf!,
            note: [r.transactionDate, r.capRate ? `${(r.capRate * 100).toFixed(2)}% cap` : null, r.buyer ? `→ ${r.buyer}` : null]
              .filter(Boolean)
              .join(" · "),
            date: r.transactionDate,
          });
        }
      }

      // Leasing comps: rentPsfNia / rentPsfOverall — only if asked, and only
      // if we don't already have investment comps (different psf basis).
      if ((scope === "leasing" || (scope === "both" && comps.length === 0))) {
        const rows = await db
          .select()
          .from(crmComps)
          .where(sql`UPPER(REPLACE(COALESCE(${crmComps.postcode}, ''), ' ', '')) ILIKE ${pcPrefix.replace(/\s/g, "") + "%"}`)
          .limit(50);
        for (const r of rows.slice(0, limit)) {
          const psfStr = r.rentPsfNia || r.rentPsfOverall || r.zoneARatePsf || "";
          const psf = parseFloat(String(psfStr).replace(/[£,]/g, ""));
          if (!isFinite(psf) || psf <= 0) continue;
          comps.push({
            label: r.name || r.tenant || "Leasing comp",
            psf,
            note: [r.completionDate, r.term, r.tenant].filter(Boolean).join(" · ").slice(0, 70),
            date: r.completionDate || null,
          });
        }
      }

      if (comps.length === 0) {
        return res.status(404).json({
          error: `No comps found in postcode area "${pcPrefix}" within last ${monthsBack} months. Try expanding the search or supply explicit comps.`,
        });
      }

      const result = await composeCompsChart({
        propertyId,
        comps,
        unit: scope === "leasing" ? "£/sqft (rent)" : "£/sqft (capital)",
        title: scope === "leasing"
          ? `Leasing comparables — ${pcPrefix}`
          : `Investment comparables — ${pcPrefix}`,
        generatedBy: userId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId: req.body?.matterId,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json({ ...result, compsCount: comps.length, postcodePrefix: pcPrefix });
    } catch (err: any) {
      console.error("[property-imagery] comps-chart-auto error:", err);
      return res.status(500).json({ error: err?.message || "auto-comps failed" });
    }
  });
}

/**
 * Fetch nearby tube/rail/Overground stations via TfL StopPoint API.
 * No auth needed for the public endpoint; rate-limited but fine for
 * occasional location-plan composes.
 */
async function fetchTubeMarkers(lat: number, lng: number, radiusMeters = 600): Promise<Array<{ lat: number; lng: number; label: string; color: "blue"; title: string }>> {
  try {
    const stopTypes = ["NaptanMetroStation", "NaptanRailStation"].join(",");
    const url = `https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lng}&radius=${radiusMeters}&stopTypes=${stopTypes}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    const stops = (data?.stopPoints || []).slice(0, 6);
    return stops.map((s: any) => ({
      lat: s.lat,
      lng: s.lon,
      label: "T",
      color: "blue" as const,
      title: s.commonName || "Station",
    }));
  } catch (err: any) {
    console.warn("[property-imagery] tube markers failed:", err?.message);
    return [];
  }
}

/**
 * Anchor brand markers — pull brand_stores within a lat/lng bounding box
 * (radius in metres). Anchor brands are what makes a pitch make sense:
 * "M&S 30m away, Pret next door" is the income story.
 */
async function fetchAnchorBrandMarkers(lat: number, lng: number, radiusMeters = 600): Promise<Array<{ lat: number; lng: number; label: string; color: "purple"; title: string }>> {
  try {
    // Convert radius to degrees — 1 deg lat ≈ 111km, lng varies by latitude
    const latDelta = radiusMeters / 111_000;
    const lngDelta = radiusMeters / (111_000 * Math.cos((lat * Math.PI) / 180));
    const stores = await db
      .select({
        name: brandStores.name,
        lat: brandStores.lat,
        lng: brandStores.lng,
      })
      .from(brandStores)
      .where(sql`
        ${brandStores.lat} IS NOT NULL
        AND ${brandStores.lng} IS NOT NULL
        AND ${brandStores.lat} BETWEEN ${lat - latDelta} AND ${lat + latDelta}
        AND ${brandStores.lng} BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}
        AND ${brandStores.status} != 'closed'
      `)
      .limit(8);
    return stores.map((s) => ({
      lat: s.lat as number,
      lng: s.lng as number,
      label: "A",
      color: "purple" as const,
      title: s.name,
    }));
  } catch (err: any) {
    console.warn("[property-imagery] anchor markers failed:", err?.message);
    return [];
  }
}

/**
 * Competitor restaurant markers — Google Places nearbysearch type=restaurant
 * within a radius. Surfaces the competitive density / brand calibre of the
 * area for both BD prospecting and investment memos ("F&B-rich, lots of
 * brand activity nearby").
 */
async function fetchRestaurantMarkers(lat: number, lng: number, radiusMeters = 500): Promise<Array<{ lat: number; lng: number; label: string; color: "orange"; title: string }>> {
  try {
    if (!process.env.GOOGLE_API_KEY) return [];
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=restaurant&key=${process.env.GOOGLE_API_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    const places = (data?.results || []).slice(0, 8);
    return places
      .filter((p: any) => p.geometry?.location?.lat && p.geometry?.location?.lng)
      .map((p: any) => ({
        lat: p.geometry.location.lat,
        lng: p.geometry.location.lng,
        label: "R",
        color: "orange" as const,
        title: p.name || "Restaurant",
      }));
  } catch (err: any) {
    console.warn("[property-imagery] restaurant markers failed:", err?.message);
    return [];
  }
}

/**
 * Drop markers for nearby investment comps in the same postcode area
 * (uses the same prefix-match as the comps-chart auto-pull).
 */
async function fetchCompMarkers(postcode: string | null | undefined): Promise<Array<{ lat: number; lng: number; label: string; color: "green"; title: string }>> {
  try {
    if (!postcode) return [];
    const pc = postcode.trim().toUpperCase();
    const m = pc.match(/^([A-Z]{1,2}\d{1,2})/);
    if (!m) return [];
    const prefix = m[1];
    const rows = await db
      .select()
      .from(investmentComps)
      .where(sql`${investmentComps.postalCode} ILIKE ${prefix + "%"} AND ${investmentComps.latitude} IS NOT NULL AND ${investmentComps.longitude} IS NOT NULL`)
      .limit(8);
    return rows.map((r) => ({
      lat: r.latitude as number,
      lng: r.longitude as number,
      label: "C",
      color: "green" as const,
      title: r.propertyName || r.address || "Comp",
    }));
  } catch (err: any) {
    console.warn("[property-imagery] comp markers failed:", err?.message);
    return [];
  }
}

function registerComposerExtras(app: Express): void {
  /**
   * Auto ERV walk: reads passingRent / quotingRent / agreedRent + key dates
   * off the matter (or the property's current state) and composes the chart.
   * One-click from a matter detail page.
   */
  app.post("/api/property-imagery/:propertyId/compose/erv-walk-auto", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const propertyId = String(req.params.propertyId);
      const matterId = req.body?.matterId;
      let passing = 0;
      let erv = 0;
      let yearsToReview: number | undefined;
      let yearsToExpiry: number | undefined;
      let areaSqft: number | undefined;
      let title: string | undefined;

      if (matterId) {
        const [m] = await db.select().from(plaMatters).where(eq(plaMatters.id, matterId));
        if (!m) return res.status(404).json({ error: "matter not found" });
        passing = Number(m.currentRent) || 0;
        erv = Number(m.quotingRent || m.agreedRent || m.counterQuotingRent || 0);
        if (m.currentRentReviewDate) {
          yearsToReview = yearsBetween(new Date(), new Date(m.currentRentReviewDate as any));
        }
        if (m.expiryDate) {
          yearsToExpiry = yearsBetween(new Date(), new Date(m.expiryDate as any));
        }
        title = `ERV walk — ${m.matterType.replace(/_/g, " ")}`;
      } else {
        const [p] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
        if (!p) return res.status(404).json({ error: "property not found" });
        // Bare-property ERV walk relies on caller-supplied numbers
        passing = Number(req.body?.passingRentPa) || 0;
        erv = Number(req.body?.ervPa) || 0;
        yearsToReview = req.body?.yearsToReview;
        yearsToExpiry = req.body?.yearsToExpiry;
        areaSqft = p.sqft || undefined;
      }

      if (passing <= 0 || erv <= 0) {
        return res.status(400).json({
          error: "couldn't infer passing rent + ERV from matter — set currentRent + quotingRent on the matter first, or pass them in the body",
        });
      }

      const result = await composeErvWalk({
        propertyId,
        passingRentPa: passing,
        ervPa: erv,
        yearsToReview,
        yearsToExpiry,
        areaSqft,
        title,
        generatedBy: userId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json({ ...result, source: matterId ? "matter" : "property" });
    } catch (err: any) {
      console.error("[property-imagery] erv-walk-auto error:", err);
      return res.status(500).json({ error: err?.message || "compose failed" });
    }
  });

  /**
   * Auto Covenant card: tenant CH number → fetch headline financials +
   * AML risk → render the card. One click from a matter or pathway run.
   */
  app.post("/api/property-imagery/:propertyId/compose/covenant-card-auto", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const propertyId = String(req.params.propertyId);
      const matterId = req.body?.matterId;

      let tenantName = "";
      let chNumber: string | null = null;
      let parentName: string | null = null;
      let revenuePa: number | null = null;
      let netIncome: number | null = null;
      let netCash: number | null = null;
      let numEmployees: number | null = null;
      let latestAccountsYear: number | null = null;
      let riskLevel: "low" | "medium" | "high" | null = null;
      let pepClean: boolean | null = null;
      let sanctionsClean: boolean | null = null;

      // Resolve tenant: matter.clientCompanyId → crm_companies, OR caller can pass tenantName explicitly
      if (matterId) {
        const [m] = await db.select().from(plaMatters).where(eq(plaMatters.id, matterId));
        if (m && m.clientCompanyId) {
          const [co] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, m.clientCompanyId));
          if (co) {
            tenantName = co.name || "";
            chNumber = co.companiesHouseNumber || null;
            // crm_companies doesn't carry detailed financials yet — leave null
            // and let the covenant card composer render "n/a" for missing.
            revenuePa = co.annualRevenue ? Number(co.annualRevenue) : null;
            // AML status if populated by the AML sweep
            riskLevel = (co.amlRiskLevel as any) || null;
            pepClean = co.amlPepStatus === "clear" ? true : (co.amlPepStatus && co.amlPepStatus.startsWith("pep_")) ? false : null;
          }
        }
      }
      // Fallback / overrides from body
      tenantName = String(req.body?.tenantName || tenantName).trim();
      if (!tenantName) {
        return res.status(400).json({
          error: "no tenant identified — link a clientCompanyId on the matter or pass tenantName",
        });
      }

      const result = await composeCovenantCard({
        propertyId,
        tenantName,
        companiesHouseNumber: req.body?.companiesHouseNumber ?? chNumber,
        latestAccountsYear: req.body?.latestAccountsYear ?? latestAccountsYear,
        revenuePa: req.body?.revenuePa ?? revenuePa,
        ebitda: req.body?.ebitda,
        netIncome: req.body?.netIncome ?? netIncome,
        netCash: req.body?.netCash ?? netCash,
        numEmployees: req.body?.numEmployees ?? numEmployees,
        parentName: req.body?.parentName ?? parentName,
        sanctionsClean: req.body?.sanctionsClean ?? sanctionsClean,
        pepClean: req.body?.pepClean ?? pepClean,
        riskLevel: req.body?.riskLevel ?? riskLevel,
        dunbradstreetRating: req.body?.dunbradstreetRating,
        notes: req.body?.notes,
        title: req.body?.title,
        generatedBy: userId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json({ ...result, autoFilled: !!matterId });
    } catch (err: any) {
      console.error("[property-imagery] covenant-card-auto error:", err);
      return res.status(500).json({ error: err?.message || "compose failed" });
    }
  });

  /** Generate an ERV walk chart. */
  app.post("/api/property-imagery/:propertyId/compose/erv-walk", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const passing = Number(req.body?.passingRentPa);
      const erv = Number(req.body?.ervPa);
      if (!isFinite(passing) || !isFinite(erv) || passing <= 0 || erv <= 0) {
        return res.status(400).json({ error: "passingRentPa and ervPa required (positive numbers)" });
      }
      const result = await composeErvWalk({
        propertyId: String(req.params.propertyId),
        passingRentPa: passing,
        ervPa: erv,
        steppedRents: Array.isArray(req.body?.steppedRents) ? req.body.steppedRents : undefined,
        yearsToReview: req.body?.yearsToReview,
        yearsToExpiry: req.body?.yearsToExpiry,
        areaSqft: req.body?.areaSqft,
        title: req.body?.title,
        generatedBy: userId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId: req.body?.matterId,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "compose failed" });
    }
  });

  /** Generate a covenant card from explicit inputs (for now). Future: auto-pull Companies House data via tenantName / companyNumber. */
  app.post("/api/property-imagery/:propertyId/compose/covenant-card", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const tenantName = String(req.body?.tenantName || "").trim();
      if (!tenantName) return res.status(400).json({ error: "tenantName required" });
      const result = await composeCovenantCard({
        propertyId: String(req.params.propertyId),
        tenantName,
        companiesHouseNumber: req.body?.companiesHouseNumber,
        latestAccountsYear: req.body?.latestAccountsYear,
        revenuePa: req.body?.revenuePa,
        ebitda: req.body?.ebitda,
        netIncome: req.body?.netIncome,
        netCash: req.body?.netCash,
        numEmployees: req.body?.numEmployees,
        parentName: req.body?.parentName,
        sanctionsClean: req.body?.sanctionsClean,
        pepClean: req.body?.pepClean,
        riskLevel: req.body?.riskLevel,
        dunbradstreetRating: req.body?.dunbradstreetRating,
        notes: req.body?.notes,
        title: req.body?.title,
        generatedBy: userId,
        pathwayRunId: req.body?.pathwayRunId,
        matterId: req.body?.matterId,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "compose failed" });
    }
  });
}

function yearsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, ms / (365.25 * 24 * 60 * 60 * 1000));
}

function pcArea(pc: string): string | null {
  // Take the outward code (e.g. "W1A 1AB" → "W1A", "SW1A 0AA" → "SW1A")
  // and broaden to district level (e.g. "W1A" → "W1", "SW1A" → "SW1") so
  // we catch enough comps. The query uses ILIKE prefix so this is fine.
  if (!pc) return null;
  const m = pc.match(/^([A-Z]{1,2}\d{1,2})/);
  return m ? m[1] : null;
}

function txDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function withinMonths(s: string | null | undefined, months: number): boolean {
  const d = txDate(s);
  if (!d) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return d.getTime() >= cutoff.getTime();
}
