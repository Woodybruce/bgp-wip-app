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
import { requireAuth, requireAdmin } from "./auth";
import { db, pool } from "./db";
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

// ─── Selected hero (Investment Tracker image column, 2026-11-09) ─────────────
// The property's selected photo is its PINNED hero asset — one per property,
// so every tracker entry for that property shows the same image (and Pathway
// / Why Buy use the same one), and a tracker reimport or a client / status /
// price edit can't reset it (none of them touch property_imagery_assets).
// The rule (Jack, 2026-11-09):
//   1. a photo pinned by hand always wins;
//   2. otherwise the BROCHURE COVER PHOTO — the main photo embedded on page 1
//      of the brochure PDF (the PDF's own image, so cover text isn't burnt
//      in); if page 1 has none, the best building photo elsewhere in it.
//      Either way it must show the ASSET AS A WHOLE from outside (Jack,
//      2026-11-10) — not one shop unit, an interior or cover artwork;
//   3. no brochure on file → search the investment team's mailboxes for the
//      asset's brochure. EXACT match only (see findBrochureInEmails): whole
//      name / numbered address / full postcode in the file name or subject,
//      then confirmed inside the PDF's own text. Save it to the asset's
//      Files and use its cover;
//   4. anything short of exact → the slot stays empty ("Choose image") for
//      a person to upload or pick (Jack, 2026-11-10: "if the code can't be
//      exact then we should just leave as choose image"). Nobody is emailed.
// Asset files (Image Studio) and web photos NEVER fill the slot on their
// own — only when a person picks one. Every automatic pick is pinned, so it
// can't change later; it never replaces an existing pin.
// generated_from.selection records "auto" / "manual" so a re-run brochure
// ingest may refresh its own auto pick but never a manual one.

export type HeroStatus = "selected" | "ambiguous" | "missing" | "no_brochure";
export interface HeroResolution {
  status: HeroStatus;
  assetId: string | null;
  imageStudioId: string | null;
  source: string | null;
  sourceUrl: string | null;
  caption: string | null;
  attribution: string | null;
  candidates: number;
}

/** One query for many properties — used by the tracker's image column. */
export async function resolveHeroes(propertyIds: string[]): Promise<Record<string, HeroResolution>> {
  const ids = Array.from(new Set(propertyIds.filter(Boolean)));
  const out: Record<string, HeroResolution> = {};
  for (const id of ids) out[id] = { status: "no_brochure", assetId: null, imageStudioId: null, source: null, sourceUrl: null, caption: null, attribution: null, candidates: 0 };
  if (ids.length === 0) return out;
  const [{ rows }, { rows: withBrochure }] = await Promise.all([
    pool.query(
      `SELECT a.id, a.property_id, a.image_studio_id, a.source, a.source_url, a.caption,
              COALESCE(a.pinned, false) AS pinned, a.generated_from
         FROM property_imagery_assets a
         JOIN image_studio_images i ON i.id = a.image_studio_id
        WHERE a.property_id = ANY($1::varchar[]) AND a.kind = 'hero' AND COALESCE(a.hidden, false) = false
          AND (COALESCE(a.pinned, false) OR a.source = 'brochure')
        ORDER BY a.property_id, COALESCE(a.pinned, false) DESC, a.score DESC NULLS LAST, a.generated_at DESC`,
      [ids],
    ),
    pool.query(
      `SELECT property_id FROM property_brochures WHERE property_id = ANY($1::text[]) AND COALESCE(archived, false) = false
       UNION
       SELECT t.property_id FROM investment_marketing_files f JOIN investment_tracker t ON t.id = f.tracker_id
        WHERE t.property_id = ANY($1::varchar[]) AND (f.mime_type = 'application/pdf' OR lower(f.file_name) LIKE '%.pdf')`,
      [ids],
    ),
  ]);
  const hasBrochure = new Set(withBrochure.map((r: any) => r.property_id));
  for (const id of ids) if (hasBrochure.has(id)) out[id].status = "missing";
  const byProp = new Map<string, any[]>();
  for (const r of rows) {
    if (!byProp.has(r.property_id)) byProp.set(r.property_id, []);
    byProp.get(r.property_id)!.push(r);
  }
  for (const [pid, list] of byProp) {
    // Only a pinned photo is shown. Unpinned brochure photos (e.g. from two
    // brochures with no clear winner) are flagged for someone to choose.
    const pinned = list.find((r) => r.pinned);
    if (!pinned) {
      out[pid] = { ...out[pid], status: "ambiguous", candidates: list.length };
      continue;
    }
    out[pid] = {
      status: "selected",
      assetId: pinned.id,
      imageStudioId: pinned.image_studio_id,
      source: pinned.source,
      sourceUrl: pinned.source_url,
      caption: pinned.caption,
      attribution: pinned.generated_from?.attribution ?? null,
      candidates: list.length,
    };
  }
  return out;
}

/** Make an asset (or a bare Image Studio image) the property's pinned hero. */
export async function selectHero(args: {
  propertyId: string;
  assetId?: string | null;
  imageStudioId?: string | null;
  selection: "manual" | "auto";
  userId?: string | null;
}): Promise<PropertyImageryAsset> {
  let asset: PropertyImageryAsset | undefined;
  if (args.assetId) {
    [asset] = await db.select().from(propertyImageryAssets).where(eq(propertyImageryAssets.id, args.assetId));
    if (!asset || asset.propertyId !== args.propertyId) throw new Error("Image not found for this property");
  } else if (args.imageStudioId) {
    const [img] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, args.imageStudioId));
    if (!img) throw new Error("Image not found");
    [asset] = await db.select().from(propertyImageryAssets).where(and(
      eq(propertyImageryAssets.propertyId, args.propertyId),
      eq(propertyImageryAssets.imageStudioId, args.imageStudioId),
    )).limit(1);
    if (!asset) {
      [asset] = await db.insert(propertyImageryAssets).values({
        propertyId: args.propertyId,
        kind: "hero",
        source: mapStudioSource(img.source),
        imageStudioId: img.id,
        width: img.width,
        height: img.height,
        caption: img.description || img.fileName,
        score: 0.9,
        generatedBy: args.userId || null,
      } as any).returning();
    }
  } else {
    throw new Error("assetId or imageStudioId required");
  }
  await db.update(propertyImageryAssets).set({ pinned: false } as any).where(and(
    eq(propertyImageryAssets.propertyId, args.propertyId),
    eq(propertyImageryAssets.kind, "hero"),
  ));
  const generatedFrom = { ...((asset!.generatedFrom as any) || {}), selection: args.selection };
  const [updated] = await db.update(propertyImageryAssets)
    .set({ kind: "hero", pinned: true, hidden: false, generatedFrom } as any)
    .where(eq(propertyImageryAssets.id, asset!.id))
    .returning();
  return updated;
}

async function hasPinnedHero(propertyId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM property_imagery_assets
      WHERE property_id = $1 AND kind = 'hero' AND COALESCE(pinned, false) AND COALESCE(hidden, false) = false
        AND image_studio_id IS NOT NULL LIMIT 1`,
    [propertyId],
  );
  return rows.length > 0;
}

/**
 * Fill an empty hero slot from photos already filed from brochures. Never
 * touches a property that already has a pin, and never uses asset files or
 * web photos. Picks only a clear winner — one candidate, or a score lead of
 * 0.1+ — otherwise leaves the property "ambiguous" for someone to choose.
 */
async function clearBrochureWinner(propertyId: string): Promise<{ verdict: "selected" | "ambiguous" | "missing"; assetId?: string }> {
  const { rows } = await pool.query(
    `SELECT a.id, a.score FROM property_imagery_assets a
       JOIN image_studio_images i ON i.id = a.image_studio_id
      WHERE a.property_id = $1 AND a.kind = 'hero' AND a.source = 'brochure' AND COALESCE(a.hidden, false) = false
      ORDER BY a.score DESC NULLS LAST, a.generated_at DESC`,
    [propertyId],
  );
  if (rows.length === 0) return { verdict: "missing" };
  const [top, second] = rows;
  if (second && (Number(top.score) || 0) - (Number(second.score) || 0) < 0.1) return { verdict: "ambiguous" };
  return { verdict: "selected", assetId: top.id };
}

export async function autoSelectHeroIfNone(propertyId: string): Promise<"kept" | "selected" | "ambiguous" | "missing"> {
  if (await hasPinnedHero(propertyId)) return "kept";
  const { verdict, assetId } = await clearBrochureWinner(propertyId);
  if (verdict !== "selected") return verdict;
  await selectHero({ propertyId, assetId: assetId!, selection: "auto" });
  return "selected";
}

/**
 * Cheap pre-filter before the vision classifier: plain or textured
 * backgrounds and logos have little tonal range / detail. Calibrated on the
 * Project Demeter PDFs (2026-11-09): a blue cover texture scored stdev 5 /
 * entropy 4.2 and logos entropy ~1, while building photos scored stdev 55+
 * / entropy 7.4+.
 */
async function looksLikePhoto(buffer: Buffer): Promise<boolean> {
  try {
    const sharp = (await import("sharp")).default;
    const st = await sharp(buffer).resize(256, 256, { fit: "inside" }).stats();
    const sd = st.channels.slice(0, 3).reduce((sum, c) => sum + c.stdev, 0) / Math.min(3, st.channels.length);
    if (!(sd >= 20 && st.entropy >= 5)) return false;
    // Too small to show a building once enlarged (the blurry thumbnails).
    const meta = await sharp(buffer).metadata();
    return Math.max(meta.width || 0, meta.height || 0) >= 700;
  } catch {
    return true; // unreadable here — let the classifier decide
  }
}

/**
 * Pin a brochure's cover photo as the property's image. Skips entirely
 * when a photo is already pinned (no vision calls spent, nothing replaced).
 *   1. Cover: the photos embedded on page 1, largest first; the first the
 *      classifier accepts as a photograph of the building (hero / cover /
 *      exterior — not a logo, plan or map) wins.
 *   2. No cover photo: the best "hero" building photo elsewhere in the PDF.
 * The chosen image is pinned straight away (selection "auto").
 */
export async function heroFromBrochurePdf(args: { propertyId: string; pdfBuffer: Buffer; label: string; trace?: string[]; dryRun?: boolean }): Promise<"kept" | "selected" | "missing"> {
  if (await hasPinnedHero(args.propertyId)) return "kept";
  const say = (line: string) => { if (args.trace) args.trace.push(line); };
  const { extractImagesFromPdf } = await import("./pdf-image-extract");
  const { isWholeAssetPhoto } = await import("./brochure-vision");
  const { storeImageFromBuffer } = await import("./image-studio");
  // One judge: does the picture show the asset as a whole from outside — a
  // building shot, a scheme view, an aerial (labelled or outlined is fine)
  // or a photoreal CGI — rather than one shop, an interior or artwork. An
  // unanswered check counts as "no": never pin a guess. (The general
  // brochure classifier used to gate this too and threw out good aerials
  // as "location plans" — Strathkelvin, 2026-11-10.)
  const { rows: named } = await pool.query(`SELECT name FROM crm_properties WHERE id = $1`, [args.propertyId]);
  const judge = async (img: { buffer: Buffer; mimeType: string }, where: string): Promise<string | null> => {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(img.buffer).metadata().catch(() => null);
    const size = meta ? `${meta.width}×${meta.height}` : "unknown size";
    if (!(await looksLikePhoto(img.buffer))) { say(`${where} (${size}): passed over — too small to enlarge, or flat artwork rather than a photograph.`); return null; }
    const v = await isWholeAssetPhoto({ ...img, propertyName: named[0]?.name });
    if (!v) { say(`${where} (${size}): the check gave no answer, so it wasn't used.`); return null; }
    say(`${where} (${size}): ${v.wholeAsset ? "ACCEPTED" : "rejected"} — ${v.shows.replace(/_/g, " ")}. ${v.reason}`);
    return v.wholeAsset ? v.reason : null;
  };

  type Pick = { img: { buffer: Buffer; mimeType: string }; caption: string | null; fromCover: boolean };
  let pick: Pick | null = null;
  say(`Looking through "${args.label}".`);

  const cover = (await extractImagesFromPdf({ pdfBuffer: args.pdfBuffer, firstPage: 1, lastPage: 1, maxImages: 10, minBytes: 30_000 }))
    .sort((a, b) => b.buffer.length - a.buffer.length)
    .slice(0, 4);
  if (cover.length === 0) say("Page 1 has no embedded picture big enough to consider.");
  for (const [i, img] of cover.entries()) {
    const caption = await judge(img, `Page 1, picture ${i + 1}`);
    if (caption) { pick = { img, caption, fromCover: true }; break; }
  }

  if (!pick) {
    const rest = (await extractImagesFromPdf({ pdfBuffer: args.pdfBuffer, firstPage: 2, maxImages: 30, minBytes: 30_000 }))
      .sort((a, b) => b.buffer.length - a.buffer.length)
      .slice(0, 10);
    if (rest.length === 0) say("No embedded pictures on the later pages.");
    for (const [i, img] of rest.entries()) {
      const caption = await judge(img, `Later pages, picture ${i + 1}`);
      if (caption) { pick = { img, caption, fromCover: false }; break; }
    }
  }
  if (!pick) say("No picture in this document was accepted.");
  if (args.dryRun) return pick ? "selected" : "missing";
  if (!pick) return "missing";

  // A pin may have landed while the vision calls ran — never overwrite it.
  if (await hasPinnedHero(args.propertyId)) return "kept";
  const stored = await storeImageFromBuffer({
    buffer: pick.img.buffer,
    fileName: `${pick.fromCover ? "Brochure cover" : "Brochure photo"} — ${pick.caption || args.label}`.slice(0, 120),
    category: "Properties",
    tags: ["Brochure", "PDF-extract", "Hero", ...(pick.fromCover ? ["Cover"] : [])],
    description: pick.caption || `${pick.fromCover ? "Cover photo" : "Photo"} from ${args.label}`,
    source: "brochure",
    propertyId: args.propertyId,
    mimeType: pick.img.mimeType,
    filenameHint: pick.fromCover ? "brochure-cover" : "brochure-hero",
  });
  const [asset] = await db.insert(propertyImageryAssets).values({
    propertyId: args.propertyId,
    kind: "hero",
    source: "brochure",
    imageStudioId: stored.id,
    caption: pick.caption,
    score: pick.fromCover ? 0.95 : 0.85,
    generatedFrom: { brochure: args.label, fromCover: pick.fromCover },
  } as any).returning();
  await selectHero({ propertyId: args.propertyId, assetId: asset.id, selection: "auto" });
  return "selected";
}

/**
 * Look for the asset's brochure in the investment team's mailboxes (plus the
 * shared inbox and the asset's BGP contacts). EXACT, not fuzzy (Jack,
 * 2026-11-10 — the first version matched on one shared word and pinned a
 * Wimbledon scheme for Halifax and the Grafton Centre for 6 Grafton Street):
 *   1. the PDF's file name or the email subject must carry the asset's WHOLE
 *      name ("6 grafton street", "broad street plaza"), its numbered street
 *      address, or its full postcode — never a single word of it;
 *   2. lettings, reports, leases, schedules… are skipped by file name; a
 *      file that doesn't carry the name itself must be called a brochure;
 *   3. the PDF's own text must then name the asset the same way AND place it
 *      (outward postcode, or the town / area from the asset's name or
 *      address). A PDF with no readable text is confirmed by showing its
 *      opening page to the vision model instead.
 * Returns up to three confirmed PDFs, best first; none → "Choose image".
 * Pass `trace` to collect a plain account of what was searched and why
 * each attachment was taken or rejected (the ?explain=1 route).
 */
const HERO_GENERIC = new Set(["street", "road", "avenue", "lane", "place", "square", "house", "building", "floor", "suite", "unit", "units", "portfolio", "retail", "office", "offices", "london", "centre", "center", "park", "estate", "investment", "limited", "leisure", "shopping", "express", "plaza", "court", "hall", "yard", "block", "village", "commercial", "development", "site", "high", "north", "south", "east", "west", "title", "sale", "sales", "element", "with", "from", "this"]);
const heroNorm = (t: string) => ` ${String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;

async function pdfOpeningText(pdfBuffer: Buffer): Promise<string> {
  const fsp = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hero-pdftext-"));
  try {
    const file = path.join(dir, "b.pdf");
    await fsp.writeFile(file, pdfBuffer);
    return await new Promise<string>((resolve) => {
      execFile("pdftotext", ["-l", "6", file, "-"], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? "" : String(stdout || "")));
    });
  } catch {
    return "";
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export type EmailBrochure = { buffer: Buffer; fileName: string; from: string; date: string };
export async function findBrochureInEmails(propertyId: string, trace?: string[]): Promise<EmailBrochure[]> {
  const say = (line: string) => { if (trace) trace.push(line); };
  const { rows: info } = await pool.query(
    `SELECT p.name AS property_name, p.address, p.postcode, t.asset_name, t.agent_user_ids
       FROM crm_properties p LEFT JOIN investment_tracker t ON t.property_id = p.id
      WHERE p.id = $1`,
    [propertyId],
  );
  if (!info[0]) return [];
  const names = Array.from(new Set(info.flatMap((r: any) => [r.asset_name, r.property_name]).filter(Boolean))) as string[];
  const addr = info[0].address;
  const addrText = typeof addr === "string" ? addr : addr ? Object.values(addr).filter((v) => typeof v === "string").join(", ") : "";
  const pcMatch = (String(info[0].postcode || "") || addrText).toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  const postcode = pcMatch ? `${pcMatch[1]}${pcMatch[2]}`.toLowerCase() : "";
  const outward = pcMatch ? pcMatch[1].toLowerCase() : "";

  // The asset's whole name (the part before the first comma / bracket / dash)
  // and its numbered street address, as exact phrases.
  const headOf = (n: string) => n.split(/[,(–—]| - /)[0];
  const strong = (ph: string) => {
    const toks = ph.split(" ").filter(Boolean);
    const distinctive = toks.filter((w) => /\d/.test(w) || (w.length >= 4 && !HERO_GENERIC.has(w)));
    if (distinctive.length === 0) return false;
    return toks.length >= 2 || toks[0].length >= 7;
  };
  const phrases = Array.from(new Set([
    ...names.map((n) => heroNorm(headOf(n)).trim().replace(/^the /, "")),
    ...[heroNorm(addrText.split(",")[0]).trim()].filter((a) => /^\d/.test(a) && a.split(" ").length >= 2),
  ].filter(strong)));
  if (phrases.length === 0 && !postcode) { say("The asset's name is too general to search on and it has no postcode."); return []; }

  // Where it is: words from the rest of the name and the address.
  const phraseToks = new Set(names.flatMap((n) => heroNorm(headOf(n)).trim().split(" ")));
  const locality = Array.from(new Set([...names.map((n) => n.slice(headOf(n).length)), addrText]
    .flatMap((t) => heroNorm(t).trim().split(" "))
    .filter((w) => w.length >= 4 && !/\d/.test(w) && !HERO_GENERIC.has(w) && !phraseToks.has(w))));

  // Brochure covers are often letter-spaced ("6 G R A F T O N"), so the
  // text is also compared with every space removed — a digit may not sit
  // in front of the match, so "16 Grafton Street" never passes for "6 …".
  const inSquashed = (sq: string, ph: string) => {
    const needle = ph.replace(/ /g, "");
    for (let i = sq.indexOf(needle); i !== -1; i = sq.indexOf(needle, i + 1)) {
      if (i === 0 || !/\d/.test(sq[i - 1]) || !/^\d/.test(needle)) return true;
    }
    return false;
  };
  const namesIt = (t: string) => {
    const n = heroNorm(t);
    const sq = n.replace(/ /g, "");
    return phrases.some((ph) => n.includes(` ${ph} `) || inSquashed(sq, ph)) || (!!postcode && sq.includes(postcode));
  };
  const placesIt = (t: string) => {
    if (!outward && locality.length === 0) return true;
    const n = heroNorm(t);
    const sq = n.replace(/ /g, "");
    return (!!outward && n.includes(` ${outward} `)) || (!!postcode && sq.includes(postcode)) || locality.some((w) => n.includes(` ${w} `) || sq.includes(w));
  };
  say(`Looking for: ${[...phrases.map((ph) => `"${ph}"`), ...(postcode ? [`postcode ${postcode.toUpperCase()}`] : [])].join(" or ")}; placed by: ${[outward.toUpperCase(), ...locality].filter(Boolean).join(", ") || "(nothing to place it by)"}`);

  const searches = [
    ...names.map((n) => headOf(n).trim()).filter((n) => strong(heroNorm(n).trim().replace(/^the /, ""))).slice(0, 2).map((n) => `"${n.replace(/"/g, "")}"`),
    ...(pcMatch ? [`"${pcMatch[1]} ${pcMatch[2]}"`] : []),
  ];
  if (searches.length === 0) return [];

  const agentIds = info.flatMap((r: any) => r.agent_user_ids || []);
  const { rows: users } = await pool.query(
    `SELECT DISTINCT COALESCE(email, username) AS mailbox FROM users
      WHERE is_active = true AND (id = ANY($1::varchar[]) OR team ILIKE '%investment%')`,
    [agentIds],
  );
  const mailboxes = Array.from(new Set(["chatbgp@brucegillinghampollard.com",
    ...users.map((u: any) => String(u.mailbox || "").toLowerCase()).filter((m: string) => /@brucegillinghampollard\.com$/.test(m))]));

  const BROCHURE_RE = /brochure|particulars|teaser|flyer|memorandum|\bim\b|\bom\b|investment (summary|opportunity|sale)|for sale/i;
  const SKIP_RE = /heads|hots|\blease\b|to let|letting|leasing|invoice|valuation|survey|report|research|newsletter|contract|title|epc|accounts|statement|schedule|\birr\b|cash ?flow|analysis|model|appraisal|floor ?plan|\bplans?\b/i;

  const { graphRequest } = await import("./shared-mailbox");
  type Hit = { mailbox: string; id: string; subject: string; from: string; date: string };
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const jobs = mailboxes.flatMap((mb) => searches.map((ph) => async () => {
    try {
      const r: any = await graphRequest(
        // Graph needs the query wrapped in quotes; a phrase needs its own
        // escaped quotes inside those, or it's a loose any-word search that
        // returns the newest vaguely similar mail (missed "6 Grafton Street").
        `/users/${encodeURIComponent(mb)}/messages?$search=${encodeURIComponent(`"${ph.replace(/"/g, '\\"')}"`)}&$top=25&$select=id,subject,from,receivedDateTime,hasAttachments,internetMessageId`,
        { headers: { "X-AnchorMailbox": mb } },
      );
      for (const m of r?.value || []) {
        if (!m.hasAttachments) continue;
        const key = m.internetMessageId || m.id;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ mailbox: mb, id: m.id, subject: m.subject || "", from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "", date: m.receivedDateTime });
      }
    } catch { /* mailbox unavailable — skip */ }
  }));
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => j()));
  // Emails whose subject names the asset first, then newest first.
  hits.sort((a, b) => (Number(namesIt(b.subject)) - Number(namesIt(a.subject))) || (new Date(b.date).getTime() - new Date(a.date).getTime()));
  say(`Searched ${mailboxes.length} mailboxes for ${searches.join(" / ")}: ${hits.length} emails with attachments.`);

  const { rasterisePdfPage } = await import("./pdf-image-extract");
  const { pageNamesProperty } = await import("./brochure-vision");
  const found: EmailBrochure[] = [];
  const tried = new Set<string>();
  let opened = 0;
  for (const h of hits.slice(0, 30)) {
    try {
      const atts: any = await graphRequest(`/users/${encodeURIComponent(h.mailbox)}/messages/${h.id}/attachments?$select=id,name,size,contentType,isInline`);
      for (const a of atts?.value || []) {
        const fileName = String(a.name || "");
        const isPdf = /\.pdf$/i.test(fileName) || /application\/pdf/i.test(a.contentType || "");
        if (!isPdf || a.isInline) continue;
        const sig = `${fileName.toLowerCase()}|${a.size || 0}`;
        if (tried.has(sig)) continue;
        tried.add(sig);
        const where = `"${fileName}" (email "${h.subject}" from ${h.from}, ${String(h.date).slice(0, 10)})`;
        if (SKIP_RE.test(fileName)) { say(`Skipped ${where}: the file name says it isn't a sale brochure.`); continue; }
        if (a.size && a.size > 30 * 1024 * 1024) { say(`Skipped ${where}: over 30MB.`); continue; }
        const ok = namesIt(fileName) || (namesIt(h.subject) && BROCHURE_RE.test(fileName));
        if (!ok) { say(`Skipped ${where}: neither the file name carries the asset's whole name, nor the subject with a file called a brochure.`); continue; }
        if (++opened > 8) { say("Stopped after opening 8 PDFs."); return found; }
        const raw: any = await graphRequest(`/users/${encodeURIComponent(h.mailbox)}/messages/${h.id}/attachments/${a.id}`);
        if (!raw?.contentBytes) continue;
        const buffer = Buffer.from(raw.contentBytes, "base64");
        // The brochure itself must name this asset and place it.
        // Many covers set the name as artwork, not text, so when the text
        // doesn't settle it the opening pages are shown to the vision model.
        const text = await pdfOpeningText(buffer);
        const readable = text.replace(/\s+/g, "").length >= 80;
        if (!(readable && namesIt(text) && placesIt(text))) {
          let seen = false;
          for (const page of [1, 2]) {
            const pageJpeg = await rasterisePdfPage({ pdfBuffer: buffer, page, dpi: 80 });
            if (pageJpeg && (await pageNamesProperty({ pageJpeg, name: names[0], address: addrText })) === true) { seen = true; break; }
          }
          if (!seen) {
            say(`Rejected ${where}: ${!readable ? "no readable text" : !namesIt(text) ? "its text doesn't name the asset" : "its text doesn't place it in the right town or postcode"}, and its first two pages don't clearly show it is this asset.`);
            continue;
          }
        }
        say(`Confirmed ${where}.`);
        found.push({ buffer, fileName, from: h.from, date: h.date });
        if (found.length >= 3) return found;
      }
    } catch { /* attachment fetch failed — try the next email */ }
  }
  if (found.length === 0) say("No attachment passed every check.");
  return found;
}

/**
 * Run the whole rule for one property: keep a pin; else use a brochure on
 * file (investment brochures first, newest first); else find one in email,
 * save it to the asset's Files and use its cover. Returns what happened.
 */
export async function ensureTrackerHero(propertyId: string, opts: { searchEmail: boolean }): Promise<"kept" | "selected" | "ambiguous" | "missing" | "no_brochure"> {
  if (await hasPinnedHero(propertyId)) return "kept";
  const fromFiled = await autoSelectHeroIfNone(propertyId);
  if (fromFiled === "selected" || fromFiled === "ambiguous") return fromFiled;

  const { getFile, saveFile } = await import("./file-storage");
  const { rows: pdfs } = await pool.query(
    `SELECT original_name AS file_name, storage_key AS file_path, 0 AS pri, created_at FROM property_brochures
      WHERE property_id = $1 AND COALESCE(archived, false) = false AND type = 'investment'
     UNION ALL
     SELECT f.file_name, f.file_path, 1 AS pri, f.created_at FROM investment_marketing_files f
       JOIN investment_tracker t ON t.id = f.tracker_id
      WHERE t.property_id = $1 AND (f.mime_type = 'application/pdf' OR lower(f.file_name) LIKE '%.pdf')
     UNION ALL
     SELECT original_name, storage_key, 2 AS pri, created_at FROM property_brochures
      WHERE property_id = $1 AND COALESCE(archived, false) = false AND type <> 'investment'
     ORDER BY pri, created_at DESC LIMIT 4`,
    [propertyId],
  );
  for (const f of pdfs) {
    const file = await getFile(f.file_path).catch(() => null);
    if (!file?.data) continue;
    const r = await heroFromBrochurePdf({ propertyId, pdfBuffer: file.data, label: f.file_name });
    if (r !== "missing") return r;
  }
  if (pdfs.length > 0) return "missing";
  if (!opts.searchEmail) return "no_brochure";

  const found = await findBrochureInEmails(propertyId);
  if (found.length === 0) return "no_brochure";
  // Keep a found brochure on the asset's Files (newest tracker entry for
  // this property) — not the property-page ingest, which also rewrites
  // property fields and the tenancy schedule from whatever PDF it's given.
  const keep = async (b: EmailBrochure) => {
    const { rows: tr } = await pool.query(
      `SELECT id FROM investment_tracker WHERE property_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [propertyId],
    );
    if (!tr[0]) return;
    const crypto = await import("node:crypto");
    const safeName = b.fileName.replace(/[\/\\:*?"<>|]/g, "-");
    const key = `investment-marketing/${tr[0].id}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
    await saveFile(key, b.buffer, "application/pdf", safeName);
    await pool.query(
      `INSERT INTO investment_marketing_files (tracker_id, file_name, file_path, file_type, file_size, mime_type)
       VALUES ($1, $2, $3, 'email', $4, 'application/pdf')`,
      [tr[0].id, `${safeName}`, key, b.buffer.length],
    );
  };
  // The first confirmed PDF that yields a whole-asset photo is filed and used.
  for (const b of found) {
    const r = await heroFromBrochurePdf({ propertyId, pdfBuffer: b.buffer, label: `${b.fileName} (email from ${b.from})` });
    if (r === "missing") continue;
    await keep(b);
    return r;
  }
  await keep(found[0]);
  return "missing";
}

// ─── HTTP routes ─────────────────────────────────────────────────────────────

export function registerPropertyImageryRoutes(app: Express): void {
  /** Selected hero for every property on the Investment Tracker, in one call. */
  app.get("/api/investment-tracker/hero-images", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await (await import("./company-scope")).isClientRequestUser(req)) return res.status(403).json({ error: "Not available for client accounts" });
      const { rows } = await pool.query(`SELECT DISTINCT property_id FROM investment_tracker WHERE property_id IS NOT NULL`);
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.json(await resolveHeroes(rows.map((r: any) => r.property_id)));
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "hero lookup failed" });
    }
  });

  /** Choose / Replace: pin an existing asset or Image Studio image as the hero. */
  app.post("/api/property-imagery/:propertyId/select-hero", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await (await import("./company-scope")).isClientRequestUser(req)) return res.status(403).json({ error: "Not available for client accounts" });
      const userId = (req as any).session?.userId || (req as any).tokenUserId || null;
      const asset = await selectHero({
        propertyId: String(req.params.propertyId),
        assetId: req.body?.assetId || null,
        imageStudioId: req.body?.imageStudioId || null,
        selection: "manual",
        userId,
      });
      return res.json(asset);
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "select failed" });
    }
  });

  /**
   * Web photo of the exact asset. The person adding it confirms the usage
   * is permitted and gives the page it came from + the credit line; both are
   * kept on the asset (source_url, generated_from.attribution) and shown in
   * the preview. Fetched through the SSRF-safe fetcher, images only, 15MB cap.
   */
  app.post("/api/property-imagery/:propertyId/hero-from-url", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await (await import("./company-scope")).isClientRequestUser(req)) return res.status(403).json({ error: "Not available for client accounts" });
      const propertyId = String(req.params.propertyId);
      const imageUrl = String(req.body?.imageUrl || "").trim();
      const sourcePage = String(req.body?.sourcePage || "").trim() || imageUrl;
      const attribution = String(req.body?.attribution || "").trim();
      if (!/^https:\/\//i.test(imageUrl)) return res.status(400).json({ error: "Give the image's https:// address" });
      if (!attribution) return res.status(400).json({ error: "Give the source / credit for the photo" });
      if (req.body?.usageConfirmed !== true) return res.status(400).json({ error: "Confirm the photo may be used" });
      const [property] = await db.select({ id: crmProperties.id }).from(crmProperties).where(eq(crmProperties.id, propertyId));
      if (!property) return res.status(404).json({ error: "Property not found" });
      const { safePublicFetch, readBodyCapped } = await import("./safe-fetch");
      const r = await safePublicFetch(imageUrl, { headers: { "User-Agent": "BGP-Dashboard/1.0" } });
      if (!r.ok) return res.status(400).json({ error: `Couldn't fetch the image (HTTP ${r.status})` });
      const mimeType = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return res.status(400).json({ error: "That address isn't a JPEG, PNG or WebP image" });
      const buffer = await readBodyCapped(r, 15 * 1024 * 1024);
      const userId = (req as any).session?.userId || (req as any).tokenUserId || null;
      const { storeImageFromBuffer } = await import("./image-studio");
      const stored = await storeImageFromBuffer({
        buffer,
        fileName: `Web photo — ${attribution}`.slice(0, 120),
        category: "Properties",
        tags: ["Web", "Hero"],
        description: `${attribution} — ${sourcePage}`,
        source: "upload",
        propertyId,
        mimeType,
        filenameHint: "web-hero",
      });
      const [asset] = await db.insert(propertyImageryAssets).values({
        propertyId,
        kind: "hero",
        source: "manual_upload",
        imageStudioId: stored.id,
        sourceUrl: sourcePage,
        caption: attribution,
        score: 0.9,
        generatedFrom: { imageUrl, sourcePage, attribution, usageConfirmedBy: userId, usageConfirmedAt: new Date().toISOString() },
        generatedBy: userId,
      } as any).returning();
      return res.json(await selectHero({ propertyId, assetId: asset.id, selection: "manual", userId }));
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "web photo failed" });
    }
  });

  /** Run the image rule for one asset now — brochures on file, then email. */
  app.post("/api/property-imagery/:propertyId/find-brochure-hero", requireAuth, async (req: Request, res: Response) => {
    try {
      if (await (await import("./company-scope")).isClientRequestUser(req)) return res.status(403).json({ error: "Not available for client accounts" });
      // ?explain=1 — say what the email search finds for this asset and
      // why each attachment is taken or rejected. Reads only; pins nothing.
      if (String(req.query.explain || "") === "1") {
        const propertyId = String(req.params.propertyId);
        const trace: string[] = [];
        if (await hasPinnedHero(propertyId)) return res.json({ confirmed: [], trace: ["This property already has a pinned photo, so nothing is searched."] });
        // Documents already on the asset's Files are judged first, as the rule does.
        const { getFile } = await import("./file-storage");
        const { rows: onFile } = await pool.query(
          `SELECT original_name AS file_name, storage_key AS file_path, created_at FROM property_brochures
            WHERE property_id = $1 AND COALESCE(archived, false) = false
           UNION ALL
           SELECT f.file_name, f.file_path, f.created_at FROM investment_marketing_files f
             JOIN investment_tracker t ON t.id = f.tracker_id
            WHERE t.property_id = $1 AND (f.mime_type = 'application/pdf' OR lower(f.file_name) LIKE '%.pdf')
           ORDER BY created_at DESC LIMIT 4`,
          [propertyId],
        );
        for (const f of onFile) {
          const file = await getFile(f.file_path).catch(() => null);
          if (!file?.data) { trace.push(`"${f.file_name}" is on the asset's Files but couldn't be opened.`); continue; }
          await heroFromBrochurePdf({ propertyId, pdfBuffer: file.data, label: f.file_name, trace, dryRun: true });
        }
        if (onFile.length > 0) return res.json({ onFile: onFile.map((f: any) => f.file_name), trace });
        const found = await findBrochureInEmails(propertyId, trace);
        for (const b of found.slice(0, 1)) await heroFromBrochurePdf({ propertyId, pdfBuffer: b.buffer, label: b.fileName, trace, dryRun: true });
        return res.json({ confirmed: found.map((b) => ({ fileName: b.fileName, from: b.from, date: b.date })), trace });
      }
      const outcome = await ensureTrackerHero(String(req.params.propertyId), { searchEmail: true });
      return res.json({ outcome });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "brochure search failed" });
    }
  });

  /**
   * Backfill the tracker's images. Preview (default) is read-only and spends
   * nothing: it lists properties by their current state and does not search
   * email. ?apply=1 runs the rule for every property without a pinned image
   * — cover photo from a brochure on file, else a brochure found in email
   * by exact match (saved to the asset's Files) — and lists what's still
   * ambiguous, missing a usable photo, or has no brochure (left as "Choose
   * image"). Never guesses, never replaces a pin, never uses asset files or
   * web photos.
   */
  app.post("/api/admin/investment-tracker/hero-backfill", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const apply = String(req.query.apply || "") === "1";
      // ?recheck=1 — re-judge the photos the rule pinned by itself against
      // "shows the asset as a whole". Preview lists the failures; with
      // apply=1 they are hidden, leaving the slot for someone to upload or
      // choose. Hand-picked photos are never touched.
      // ?undoEmail=1 — take back what the email search did on 2026-11-10:
      // hide every photo it pinned and remove the brochures it filed on the
      // assets (file_type 'email'), so they can't be re-used as "on file".
      if (String(req.query.undoEmail || "") === "1") {
        const { rows: pins } = await pool.query(
          `SELECT a.id, a.property_id, p.name, a.generated_from->>'brochure' AS brochure
             FROM property_imagery_assets a JOIN crm_properties p ON p.id = a.property_id
            WHERE a.kind = 'hero' AND a.source = 'brochure' AND COALESCE(a.hidden, false) = false
              AND a.generated_from->>'selection' = 'auto' AND a.generated_from->>'brochure' LIKE '%(email from %'`,
        );
        const { rows: files } = await pool.query(
          `SELECT f.id, f.file_name, f.file_path, t.asset_name FROM investment_marketing_files f
             JOIN investment_tracker t ON t.id = f.tracker_id WHERE f.file_type = 'email'`,
        );
        if (apply) {
          await pool.query(`UPDATE property_imagery_assets SET hidden = true, pinned = false WHERE id = ANY($1::varchar[])`, [pins.map((r: any) => r.id)]);
          await pool.query(`DELETE FROM investment_marketing_files WHERE id = ANY($1::varchar[])`, [files.map((r: any) => r.id)]);
        }
        return res.json({
          apply, undoEmail: true,
          photos: pins.map((r: any) => ({ propertyId: r.property_id, name: r.name, brochure: r.brochure })),
          files: files.map((r: any) => ({ asset: r.asset_name, fileName: r.file_name })),
        });
      }
      if (String(req.query.recheck || "") === "1") {
        const { rows: autos } = await pool.query(
          `SELECT a.id, a.property_id, p.name, i.local_path, i.mime_type
             FROM property_imagery_assets a
             JOIN image_studio_images i ON i.id = a.image_studio_id
             JOIN crm_properties p ON p.id = a.property_id
            WHERE a.kind = 'hero' AND COALESCE(a.pinned, false) AND COALESCE(a.hidden, false) = false
              AND a.source = 'brochure' AND a.generated_from->>'selection' = 'auto'
              AND a.property_id IN (SELECT property_id FROM investment_tracker)`,
        );
        const { readPersistedImage } = await import("./image-studio");
        const { isWholeAssetPhoto } = await import("./brochure-vision");
        const out = { apply, recheck: true, checked: autos.length, ok: 0, removed: [] as any[], unchecked: [] as any[] };
        const one = async (a: any) => {
          const entry = { propertyId: a.property_id, name: a.name };
          const buffer = await readPersistedImage(a.local_path).catch(() => null);
          const verdict = buffer && (await looksLikePhoto(buffer))
            ? await isWholeAssetPhoto({ buffer, mimeType: a.mime_type || "image/jpeg", propertyName: a.name })
            : buffer ? { wholeAsset: false, shows: "other", reason: "too small or not a photograph" } : null;
          if (!verdict) { out.unchecked.push(entry); return; }
          if (verdict.wholeAsset) { out.ok++; return; }
          if (apply) await pool.query(`UPDATE property_imagery_assets SET hidden = true, pinned = false WHERE id = $1`, [a.id]);
          out.removed.push({ ...entry, shows: verdict.shows, reason: verdict.reason });
        };
        for (let i = 0; i < autos.length; i += 6) await Promise.all(autos.slice(i, i + 6).map(one));
        return res.json(out);
      }
      const { rows: props } = await pool.query(
        `SELECT DISTINCT t.property_id, p.name
           FROM investment_tracker t JOIN crm_properties p ON p.id = t.property_id`,
      );
      const before = await resolveHeroes(props.map((p: any) => p.property_id));
      const report = {
        apply, alreadySet: 0,
        selected: [] as any[], ambiguous: [] as any[], noPhotoInBrochure: [] as any[], noBrochure: [] as any[], errors: [] as any[],
      };
      for (const p of props) {
        const pid = p.property_id;
        const entry = { propertyId: pid, name: p.name };
        if (before[pid]?.status === "selected") { report.alreadySet++; continue; }
        try {
          // Preview predicts apply without writing: a lone or clearly
          // top-scoring brochure photo would be picked, not left to choose.
          const status = before[pid]?.status || "no_brochure";
          const outcome = apply ? await ensureTrackerHero(pid, { searchEmail: true })
            : status === "ambiguous" ? (await clearBrochureWinner(pid)).verdict : status;
          if (outcome === "selected" || outcome === "kept") report.selected.push(entry);
          else if (outcome === "ambiguous") report.ambiguous.push(entry);
          else if (outcome === "missing") report.noPhotoInBrochure.push(entry);
          else report.noBrochure.push(entry);
        } catch (e: any) {
          report.errors.push({ ...entry, error: e?.message });
        }
      }
      return res.json(report);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "backfill failed" });
    }
  });

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
          // A hand pin is a manual selection — brochure re-ingest keeps it.
          (updates as any).generatedFrom = { ...((asset.generatedFrom as any) || {}), selection: "manual" };
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
      let [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
      if (!property) return res.status(404).json({ error: "property not found" });

      // Auto-geocode when the property has no coordinates. composeLocationPlan
      // bails out otherwise (it needs lat/lng to drop the Google Static map
      // pin) and the user just sees a 400 toast — exactly the silent-failure
      // path Barrbridge Road was hitting. Best-effort: tries postcode first
      // (most reliable for UK lookups), then address line, then property name.
      // Caches via geocodeOne, so re-runs against the same address are free.
      if (!property.latitude || !property.longitude) {
        const addr = (property.address as any)?.address || (property.address as any)?.formattedAddress || null;
        const candidates = [property.postcode, addr, property.name].filter(Boolean) as string[];
        for (const q of candidates) {
          try {
            const { geocodeOne } = await import("./geocode");
            const geo = await geocodeOne(q);
            if (geo.lat && geo.lng) {
              await pool.query(
                `UPDATE crm_properties SET latitude = $1, longitude = $2 WHERE id = $3 AND (latitude IS NULL OR longitude IS NULL)`,
                [String(geo.lat), String(geo.lng), propertyId]
              );
              [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
              break;
            }
          } catch (e: any) {
            console.warn("[location-plan auto-geocode]", e?.message);
          }
        }
      }

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
        centerLat: typeof req.body?.centerLat === "number" ? req.body.centerLat : undefined,
        centerLng: typeof req.body?.centerLng === "number" ? req.body.centerLng : undefined,
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

// Parse a formatted accounts figure ("£84.2m", "462k", "1.2bn", "84,200,000")
// into a plain number for the covenant card composer.
function parseMoneyish(s?: string | null): number | null {
  if (s == null) return null;
  const m = String(s).replace(/[£$,\s]/g, "").match(/(-?\d+(?:\.\d+)?)\s*(bn|b|m|k)?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const mult = (m[2] || "").toLowerCase();
  if (mult === "bn" || mult === "b") n *= 1e9;
  else if (mult === "m") n *= 1e6;
  else if (mult === "k") n *= 1e3;
  return Math.round(n);
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

      // Auto-fill the latest filed accounts from Companies House when we have a
      // CH number and the caller didn't pass figures. Uses the crm company's
      // already-extracted accounts if present; otherwise warms the cache in the
      // background (download + AI-extract) so the next generate has them.
      let autoAcc: { latestAccountsYear?: number | null; revenuePa?: number | null; netIncome?: number | null; netCash?: number | null; numEmployees?: number | null } = {};
      const effectiveCh = String(req.body?.companiesHouseNumber ?? chNumber ?? "").trim();
      if (effectiveCh && req.body?.revenuePa == null) {
        try {
          const [crmCo] = await db.select().from(crmCompanies).where(eq(crmCompanies.companiesHouseNumber, effectiveCh)).limit(1);
          if (crmCo) {
            const { extractAccountsFigures, fetchLatestAccountsForCompany } = await import("./ch-accounts");
            const figs = await extractAccountsFigures(crmCo.id).catch(() => null);
            if (figs) {
              autoAcc = {
                latestAccountsYear: figs.period ? (Number(String(figs.period).slice(0, 4)) || null) : null,
                revenuePa: parseMoneyish(figs.turnover),
                netIncome: parseMoneyish(figs.profitBeforeTax),
                netCash: parseMoneyish(figs.cash),
                numEmployees: figs.employees ? parseMoneyish(figs.employees) : null,
              };
            } else {
              // Not fetched yet — warm it for next time without blocking now.
              fetchLatestAccountsForCompany(crmCo.id).then(() => extractAccountsFigures(crmCo.id)).catch(() => {});
            }
          }
        } catch (accErr: any) {
          console.warn("[covenant-card-auto] accounts enrichment failed:", accErr?.message);
        }
      }

      const result = await composeCovenantCard({
        propertyId,
        tenantName,
        companiesHouseNumber: req.body?.companiesHouseNumber ?? chNumber,
        latestAccountsYear: req.body?.latestAccountsYear ?? autoAcc.latestAccountsYear ?? latestAccountsYear,
        revenuePa: req.body?.revenuePa ?? autoAcc.revenuePa ?? revenuePa,
        ebitda: req.body?.ebitda,
        netIncome: req.body?.netIncome ?? autoAcc.netIncome ?? netIncome,
        netCash: req.body?.netCash ?? autoAcc.netCash ?? netCash,
        numEmployees: req.body?.numEmployees ?? autoAcc.numEmployees ?? numEmployees,
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
