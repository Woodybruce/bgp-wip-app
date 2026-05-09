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
  type PropertyImageryAsset,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { captureStreetViewForAddress } from "./image-studio";

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
    "street_view",
    // brochure / planning / os_ngd / google_static / edozo land in follow-ups
  ]);

  // 1. Existing image_studio_images for this property — folds in Stage 8
  //    sweep results, manual uploads, prior captures.
  if (wanted.has("image_studio")) {
    await ingestExistingImageStudio(args.propertyId, args.pathwayRunId, args.matterId);
  }

  // 2. Street View — capture if we have an address and don't already have one.
  if (wanted.has("street_view")) {
    await ingestStreetView(property, args.pathwayRunId, args.matterId, args.userId);
  }

  // 3. SharePoint property folder — if the property has sharepointFolderUrl,
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
 * Infer the imagery kind from an Image Studio image's category/tags.
 * Heuristic — the picker UI lets users reclassify.
 */
function inferKindFromStudioImage(img: typeof imageStudioImages.$inferSelect): ImageryKind {
  const cat = (img.category || "").toLowerCase();
  const tags = (img.tags || []).map((t) => t.toLowerCase());
  const all = [cat, ...tags].join(" ");

  if (all.includes("street view") || all.includes("exterior")) return "secondary_external";
  if (all.includes("hero") || all.includes("building front") || all.includes("front")) return "hero";
  if (all.includes("internal") || all.includes("interior") || all.includes("inside")) return "internal";
  if (all.includes("floor plan") || all.includes("floorplan")) return "floor_plan";
  if (all.includes("location plan") || all.includes("map")) return "location_plan";
  if (all.includes("logo") || all.includes("brand")) return "overlay";
  // Default: secondary external (least invasive — the picker lets users
  // promote it to hero or reclassify).
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

/**
 * Ensure we have at least one Street View image for this property.
 */
async function ingestStreetView(
  property: typeof crmProperties.$inferSelect,
  pathwayRunId?: string,
  matterId?: string,
  userId?: string,
): Promise<void> {
  if (!process.env.GOOGLE_API_KEY) return;
  // Skip if we already have a Street View asset for this property
  const existing = await db
    .select()
    .from(propertyImageryAssets)
    .where(
      and(
        eq(propertyImageryAssets.propertyId, property.id),
        eq(propertyImageryAssets.source, "street_view"),
        eq(propertyImageryAssets.hidden, false),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  // Build address string from whatever we have
  const addressLine = formatAddressForStreetView(property);
  if (!addressLine) return;

  try {
    const captured = await captureStreetViewForAddress({
      address: addressLine,
      propertyId: property.id,
    });
    // captureStreetViewForAddress already wrote to image_studio_images;
    // create the curation row pointing at it.
    await db.insert(propertyImageryAssets).values({
      propertyId: property.id,
      kind: "secondary_external",       // hero promotion is a manual decision
      source: "street_view",
      imageStudioId: captured.id,
      caption: `Google Street View — ${addressLine}`,
      score: 0.6,
      pathwayRunId: pathwayRunId || null,
      matterId: matterId || null,
      generatedBy: userId || null,
    });
  } catch (err: any) {
    console.warn(`[property-imagery] Street View capture failed for ${property.id}:`, err?.message);
  }
}

function formatAddressForStreetView(property: typeof crmProperties.$inferSelect): string | null {
  // Prefer structured address.formatted, fall back to name + postcode
  const addr = property.address as any;
  if (addr && typeof addr === "object" && addr.formatted) {
    return addr.formatted;
  }
  if (addr && typeof addr === "string") return addr;
  const parts = [property.name, property.postcode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
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
      const propertyId = req.params.propertyId;
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
      const manifest = await getManifest(req.params.propertyId);
      return res.json(manifest);
    } catch (err: any) {
      console.error("[property-imagery] manifest error:", err);
      return res.status(500).json({ error: err?.message || "manifest failed" });
    }
  });

  /** Pin / unpin / reclassify / hide / unhide an asset. */
  app.patch("/api/property-imagery/asset/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
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
      await db.delete(propertyImageryAssets).where(eq(propertyImageryAssets.id, req.params.id));
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "delete failed" });
    }
  });
}
