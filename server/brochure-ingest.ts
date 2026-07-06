// Brochure ingestion — single entry point that takes a freshly-uploaded
// property brochure PDF and:
//   1. Extracts embedded images + classifies each one (hero / floor plan
//      / location plan / cover / logo).
//   2. Rasterises the first ~8 pages and runs Claude vision over the lot
//      to pull out the structured property fields the brochure carries
//      (address, tenure, total area, asking price, yield, passing rent,
//      ERV, EPC, tenancy schedule, investment highlights, agent contact).
//   3. Files images into image_studio_images + property_imagery_assets
//      with the vision-detected kind (no keyword fallback needed).
//   4. Geocodes the address and merges fields into crm_properties — only
//      filling blanks unless vision returned high confidence.
//   5. Inserts tenancy schedule rows into tenancy_schedule_units with a
//      [brochure:<id>] marker on the comments so re-ingest can wipe + replace
//      without touching hand-edited rows.
//   6. Upserts the agent into crm_companies (type "Agent") and writes
//      the agency name into crm_properties.agent.
//
// Idempotent: re-running for the same brochureId removes the rows previously
// stamped with that brochure's marker, then re-inserts. Hand-edited rows
// (no marker) are left alone.

import { db } from "./db";
import { pool } from "./db";
import {
  crmProperties,
  crmCompanies,
  imageStudioImages,
  propertyImageryAssets,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { extractImagesFromPdf } from "./pdf-image-extract";
import {
  extractBrochureFields,
  classifyBrochureImage,
  type BrochureExtraction,
  type BrochureImageKind,
  type BrochureImageClassification,
} from "./brochure-vision";
import { storeImageFromBuffer } from "./image-studio";
import { geocodeOne } from "./geocode";

const BROCHURE_TAG_PREFIX = "brochure:";
const COMMENT_MARKER_PREFIX = "[brochure:";

export interface IngestArgs {
  brochureId: string;
  propertyId: string;
  pdfBuffer: Buffer;
  userId?: string | null;
}

export interface IngestResult {
  ok: boolean;
  status: "done" | "skipped" | "error";
  error?: string;
  extraction?: BrochureExtraction;
  applied: {
    propertyFieldsUpdated: string[];
    imagesStored: number;
    imagesByKind: Record<string, number>;
    tenancyRowsInserted: number;
    agentLinked: boolean;
    geocoded: boolean;
    ownershipLinked: {
      freeholder?: string;
      longLeaseholder?: string;
      lender?: string;
    };
  };
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function ingestBrochure(args: IngestArgs): Promise<IngestResult> {
  const applied = {
    propertyFieldsUpdated: [] as string[],
    imagesStored: 0,
    imagesByKind: {} as Record<string, number>,
    tenancyRowsInserted: 0,
    agentLinked: false,
    geocoded: false,
    ownershipLinked: {} as { freeholder?: string; longLeaseholder?: string; lender?: string },
  };

  try {
    // Wipe prior ingest stamped with this brochure id so we don't pile up
    // duplicates on re-runs. Hand-edited rows (no marker) are untouched.
    await wipePriorIngest(args.brochureId);

    // Kick off the slow operations in parallel — vision over rasterised
    // pages and pdfimages extraction are independent.
    const [extraction, embedded] = await Promise.all([
      extractBrochureFields({ pdfBuffer: args.pdfBuffer }),
      extractImagesFromPdf({ pdfBuffer: args.pdfBuffer, maxImages: 40, minBytes: 12_000 }),
    ]);

    // Classify each embedded image in parallel (capped to 6 in-flight so
    // we don't melt Anthropic). Haiku is cheap and fast for this.
    const classifications = await classifyAllImages(embedded, 6);

    // File images first so subsequent property_imagery_assets links work.
    const fileResults = await fileImages({
      brochureId: args.brochureId,
      propertyId: args.propertyId,
      embedded,
      classifications,
    });
    applied.imagesStored = fileResults.stored;
    applied.imagesByKind = fileResults.byKind;

    // Fields-driven side effects: merge property, tenancy, agent. Skip if
    // vision returned nothing — images may have landed without a brochure
    // re-render giving us text.
    if (extraction) {
      const propertyApplied = await mergePropertyFields({
        propertyId: args.propertyId,
        extraction,
      });
      applied.propertyFieldsUpdated = propertyApplied.fieldsUpdated;
      applied.geocoded = propertyApplied.geocoded;

      applied.tenancyRowsInserted = await insertTenancySchedule({
        brochureId: args.brochureId,
        propertyId: args.propertyId,
        rows: extraction.tenancySchedule,
      });

      applied.ownershipLinked = await upsertOwnership({
        propertyId: args.propertyId,
        extraction,
      });

      applied.agentLinked = await upsertAgent({
        propertyId: args.propertyId,
        agent: extraction.agent,
      });
    }

    return {
      ok: true,
      status: "done",
      extraction: extraction || undefined,
      applied,
    };
  } catch (err: any) {
    console.error("[brochure-ingest] failed:", err?.message, err?.stack);
    return {
      ok: false,
      status: "error",
      error: err?.message || String(err),
      applied,
    };
  }
}

// ─── Wipe prior ingest ────────────────────────────────────────────────────

async function wipePriorIngest(brochureId: string): Promise<void> {
  const tag = `${BROCHURE_TAG_PREFIX}${brochureId}`;
  // property_imagery_assets references image_studio_images by imageStudioId.
  // Delete those rows first so we don't leave dangling FKs.
  await pool.query(
    `DELETE FROM property_imagery_assets
      WHERE image_studio_id IN (
        SELECT id FROM image_studio_images WHERE $1 = ANY(tags)
      )`,
    [tag]
  );
  await pool.query(
    `DELETE FROM image_studio_images WHERE $1 = ANY(tags)`,
    [tag]
  );
  // Tenancy schedule rows we created get stamped on the comments column.
  await pool.query(
    `DELETE FROM tenancy_schedule_units WHERE comments LIKE $1`,
    [`%${COMMENT_MARKER_PREFIX}${brochureId}]%`]
  );
}

// ─── Image classification orchestration ──────────────────────────────────

async function classifyAllImages(
  images: Array<{ buffer: Buffer; mimeType: string }>,
  concurrency: number,
): Promise<(BrochureImageClassification | null)[]> {
  const results: (BrochureImageClassification | null)[] = new Array(images.length).fill(null);
  let i = 0;
  const worker = async () => {
    while (i < images.length) {
      const idx = i++;
      results[idx] = await classifyBrochureImage(images[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, () => worker()));
  return results;
}

// ─── Image filing ────────────────────────────────────────────────────────

function imageryKindFor(kind: BrochureImageKind): string | null {
  switch (kind) {
    case "hero":               return "hero";
    case "internal":           return "internal";
    case "secondary_external": return "secondary_external";
    case "cover":              return "secondary_external";
    case "floor_plan":         return "floor_plan";
    case "location_plan":      return "location_plan";
    case "logo":               return "overlay";
    case "other":              return null;
  }
}

function categoryFor(kind: BrochureImageKind): string {
  switch (kind) {
    case "hero":
    case "internal":
    case "secondary_external":
    case "cover":
      return "Properties";
    case "floor_plan":    return "Floor Plans";
    case "location_plan": return "Areas";
    case "logo":          return "Brands";
    case "other":         return "Brochures";
  }
}

async function fileImages(args: {
  brochureId: string;
  propertyId: string;
  embedded: Array<{ buffer: Buffer; mimeType: string; filename: string }>;
  classifications: (BrochureImageClassification | null)[];
}): Promise<{ stored: number; byKind: Record<string, number> }> {
  let stored = 0;
  const byKind: Record<string, number> = {};
  const brochureTag = `${BROCHURE_TAG_PREFIX}${args.brochureId}`;

  // Track hero promotion so only one hero asset wins per ingest. Others get
  // demoted to secondary_external.
  let heroPromoted = false;

  for (let i = 0; i < args.embedded.length; i++) {
    const img = args.embedded[i];
    const cls = args.classifications[i];
    const kind = cls?.kind || "other";
    if (cls && !cls.isUseful) continue;

    const category = categoryFor(kind);
    const tags = ["Brochure", "PDF-extract", brochureTag];
    if (kind !== "other") tags.push(kindTag(kind));

    let storedImage;
    try {
      storedImage = await storeImageFromBuffer({
        buffer: img.buffer,
        fileName: cls?.caption ? `${cls.caption.slice(0, 80)} (brochure)` : `Brochure image — ${img.filename}`,
        category,
        tags,
        description: cls?.caption || `Extracted from brochure ${args.brochureId}`,
        source: "brochure",
        propertyId: args.propertyId,
        mimeType: img.mimeType,
        filenameHint: `brochure-${args.brochureId}-${i}`,
      });
    } catch (err: any) {
      console.warn(`[brochure-ingest] storeImageFromBuffer failed for image ${i}:`, err?.message);
      continue;
    }
    stored++;

    // Link to property_imagery_assets with the vision-detected kind. Avoids
    // discoverImagery's keyword fallback.
    let assetKind = imageryKindFor(kind);
    if (!assetKind) continue;
    if (assetKind === "hero") {
      if (heroPromoted) assetKind = "secondary_external";
      else heroPromoted = true;
    }

    try {
      await db.insert(propertyImageryAssets).values({
        propertyId: args.propertyId,
        kind: assetKind as any,
        source: "brochure",
        imageStudioId: storedImage.id,
        caption: cls?.caption || null,
        score: scoreFor(assetKind, cls?.confidence || "medium"),
      } as any);
    } catch (err: any) {
      console.warn(`[brochure-ingest] property_imagery_assets insert failed:`, err?.message);
    }

    byKind[assetKind] = (byKind[assetKind] || 0) + 1;
  }

  return { stored, byKind };
}

function kindTag(kind: BrochureImageKind): string {
  switch (kind) {
    case "hero":               return "Hero";
    case "internal":           return "Interior";
    case "secondary_external": return "Exterior";
    case "floor_plan":         return "Floor Plan";
    case "location_plan":      return "Location Plan";
    case "cover":              return "Cover";
    case "logo":               return "Logo";
    case "other":              return "Other";
  }
}

function scoreFor(kind: string, confidence: "high" | "medium" | "low"): number {
  // Brochure-extracted assets are usually marketing-quality, so we bias
  // higher than Street View / Places defaults.
  const base = kind === "hero" ? 0.85 :
    kind === "floor_plan" ? 0.8 :
    kind === "location_plan" ? 0.75 :
    kind === "internal" ? 0.7 :
    0.6;
  const conf = confidence === "high" ? 0 : confidence === "low" ? -0.15 : -0.05;
  return Math.max(0.1, Math.min(1, base + conf));
}

// ─── Property field merge ───────────────────────────────────────────────

async function mergePropertyFields(args: {
  propertyId: string;
  extraction: BrochureExtraction;
}): Promise<{ fieldsUpdated: string[]; geocoded: boolean }> {
  const e = args.extraction;
  const [existing] = await db.select().from(crmProperties).where(eq(crmProperties.id, args.propertyId));
  if (!existing) return { fieldsUpdated: [], geocoded: false };

  const highConfidence = e.confidence === "high";
  const updates: Record<string, any> = {};
  const fieldsUpdated: string[] = [];

  const fill = (column: string, currentValue: any, newValue: any) => {
    if (newValue === null || newValue === undefined) return;
    if (typeof newValue === "string" && !newValue.trim()) return;
    const isEmpty = currentValue == null || (typeof currentValue === "string" && !currentValue.trim());
    if (isEmpty || highConfidence) {
      updates[column] = newValue;
      fieldsUpdated.push(column);
    }
  };

  fill("name", existing.name, e.propertyName);
  fill("postcode", existing.postcode, e.postcode);
  fill("tenure", existing.tenure, e.tenure);
  fill("assetClass", existing.assetClass, e.useClass);
  fill("sqft", existing.sqft, e.totalAreaSqFt);

  // Geocode if we have an address line or postcode, and the row doesn't
  // already have lat/lng set.
  let geocoded = false;
  const needsGeo = !existing.latitude || !existing.longitude;
  if (needsGeo) {
    const query = [e.addressLine, e.postcode].filter(Boolean).join(", ");
    if (query) {
      const geo = await geocodeOne(query);
      if (geo.lat !== null && geo.lng !== null) {
        updates.latitude = String(geo.lat);
        updates.longitude = String(geo.lng);
        fieldsUpdated.push("latitude", "longitude");
        geocoded = true;
        if (geo.formattedAddress && (!existing.address || !(existing.address as any)?.formatted)) {
          updates.address = { formatted: geo.formattedAddress, line: e.addressLine || null };
          fieldsUpdated.push("address");
        }
      }
    }
  }

  // Agent name — text column, fill if empty.
  if (e.agent.agencyName) {
    fill("agent", existing.agent, e.agent.agencyName);
  }

  // Investment + narrative side data → notes. We append (don't overwrite)
  // unless notes is empty, so any hand-edited commentary survives.
  const noteBlock = buildNotesBlock(e);
  if (noteBlock) {
    const existingNotes = (existing.notes || "").trim();
    const combined = existingNotes
      ? `${existingNotes}\n\n${noteBlock}`
      : noteBlock;
    updates.notes = combined;
    fieldsUpdated.push("notes");
  }

  if (Object.keys(updates).length === 0) {
    return { fieldsUpdated: [], geocoded };
  }
  (updates as any).updatedAt = new Date();
  await db.update(crmProperties).set(updates as any).where(eq(crmProperties.id, args.propertyId));
  return { fieldsUpdated, geocoded };
}

function buildNotesBlock(e: BrochureExtraction): string | null {
  const lines: string[] = [];
  const fmtGbp = (n: number | null) => n != null ? `£${n.toLocaleString("en-GB")}` : null;
  const fmtPct = (n: number | null) => n != null ? `${(n * 100).toFixed(2)}%` : null;

  if (e.askingPrice || e.netInitialYield || e.reversionaryYield || e.passingRentPa || e.ervPa) {
    lines.push("Investment summary (auto from brochure):");
    if (e.askingPrice) lines.push(`  • Asking price: ${fmtGbp(e.askingPrice)}`);
    if (e.pricePerSqFt) lines.push(`  • Price per sq ft: ${fmtGbp(e.pricePerSqFt)}`);
    if (e.netInitialYield) lines.push(`  • NIY: ${fmtPct(e.netInitialYield)}`);
    if (e.reversionaryYield) lines.push(`  • Reversionary yield: ${fmtPct(e.reversionaryYield)}`);
    if (e.passingRentPa) lines.push(`  • Passing rent pa: ${fmtGbp(e.passingRentPa)}`);
    if (e.ervPa) lines.push(`  • ERV pa: ${fmtGbp(e.ervPa)}`);
    if (e.waultToBreak) lines.push(`  • WAULT to break: ${e.waultToBreak} yrs`);
    if (e.waultToExpiry) lines.push(`  • WAULT to expiry: ${e.waultToExpiry} yrs`);
  }
  if (e.tenure || e.groundRent || e.unexpiredLeaseTerm || e.epcRating || e.listedStatus) {
    lines.push("");
    lines.push("Tenure / building:");
    if (e.tenure) lines.push(`  • Tenure: ${e.tenure}`);
    if (e.unexpiredLeaseTerm) lines.push(`  • Unexpired lease: ${e.unexpiredLeaseTerm}`);
    if (e.groundRent) lines.push(`  • Ground rent: ${e.groundRent}`);
    if (e.epcRating) lines.push(`  • EPC: ${e.epcRating}`);
    if (e.listedStatus) lines.push(`  • Listed: ${e.listedStatus}`);
    if (e.yearBuilt) lines.push(`  • Year built: ${e.yearBuilt}`);
  }
  if (e.investmentHighlights.length) {
    lines.push("");
    lines.push("Investment highlights:");
    for (const h of e.investmentHighlights) lines.push(`  • ${h}`);
  }
  if (e.assetManagementOpportunities.length) {
    lines.push("");
    lines.push("Asset management opportunities:");
    for (const h of e.assetManagementOpportunities) lines.push(`  • ${h}`);
  }
  if (e.microLocation) {
    lines.push("");
    lines.push("Micro-location:");
    lines.push(`  ${e.microLocation}`);
  }
  if (lines.length === 0) return null;
  const date = new Date().toISOString().slice(0, 10);
  return `--- Brochure extract (${date}, vision confidence: ${e.confidence}) ---\n${lines.join("\n")}`;
}

// ─── Tenancy schedule insert ────────────────────────────────────────────

async function insertTenancySchedule(args: {
  brochureId: string;
  propertyId: string;
  rows: BrochureExtraction["tenancySchedule"];
}): Promise<number> {
  if (args.rows.length === 0) return 0;
  const marker = `${COMMENT_MARKER_PREFIX}${args.brochureId}]`;
  let inserted = 0;
  for (let i = 0; i < args.rows.length; i++) {
    const r = args.rows[i];
    const status = r.tenantName && r.tenantName.toLowerCase() !== "vacant" ? "Occupied" : "Vacant";
    const comments = r.comments
      ? `${marker} ${r.comments}`
      : `${marker} Auto-extracted from brochure`;
    try {
      await pool.query(
        `INSERT INTO tenancy_schedule_units (
           property_id, unit_number, premises, tenant_name, trading_name,
           permitted_use, nia_sqft, gia_sqft,
           lease_start, lease_expiry, break_date, next_review_date,
           passing_rent_pa, erv_pa, rateable_value,
           status, sort_order, comments
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11, $12,
           $13, $14, $15,
           $16, $17, $18
         )`,
        [
          args.propertyId,
          r.unitNumber, r.premises, r.tenantName, r.tradingName,
          r.permittedUse, r.niaSqft, r.giaSqft,
          r.leaseStart, r.leaseExpiry, r.breakDate, r.nextReviewDate,
          r.passingRentPa, r.ervPa, r.rateableValue,
          status, i, comments,
        ]
      );
      inserted++;
    } catch (err: any) {
      console.warn(`[brochure-ingest] tenancy row insert failed (i=${i}):`, err?.message);
    }
  }
  return inserted;
}

// ─── Agent upsert ────────────────────────────────────────────────────────

async function upsertAgent(args: {
  propertyId: string;
  agent: BrochureExtraction["agent"];
}): Promise<boolean> {
  const name = args.agent.agencyName?.trim();
  if (!name) return false;

  const existing = await pool.query(
    `SELECT id FROM crm_companies
      WHERE lower(trim(name)) = lower(trim($1))
        AND coalesce(company_type, '') ILIKE 'Agent%'
        AND merged_into_id IS NULL
      LIMIT 1`,
    [name]
  );

  let companyId: string;
  if (existing.rows[0]?.id) {
    companyId = existing.rows[0].id;
    // Top up missing contact info — don't overwrite.
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (args.agent.contactEmail) {
      sets.push(`email = COALESCE(email, $${idx++})`);
      params.push(args.agent.contactEmail);
    }
    if (args.agent.contactPhone) {
      sets.push(`phone = COALESCE(phone, $${idx++})`);
      params.push(args.agent.contactPhone);
    }
    if (sets.length > 0) {
      params.push(companyId);
      await pool.query(
        `UPDATE crm_companies SET ${sets.join(", ")} WHERE id = $${idx}`,
        params
      ).catch(() => {});
    }
  } else {
    const inserted = await db.insert(crmCompanies).values({
      name,
      companyType: "Agent",
      email: args.agent.contactEmail,
      phone: args.agent.contactPhone,
    } as any).returning({ id: crmCompanies.id });
    companyId = inserted[0].id;
  }

  // Stamp the agency name on the property too (text column for legacy).
  await db.update(crmProperties)
    .set({ agent: name } as any)
    .where(and(
      eq(crmProperties.id, args.propertyId),
      sql`(${crmProperties.agent} IS NULL OR ${crmProperties.agent} = '')`,
    ));

  return true;
}

// ─── Ownership stack upsert ─────────────────────────────────────────────

// Match-or-create a crm_companies row for the freeholder / long
// leaseholder / lender named on the brochure, then link the FK on
// crm_properties. Vendor is resolved to whichever ownership role makes
// sense given the tenure — for a freehold sale the vendor IS the
// freeholder, for a long-lease sale the vendor is the long leaseholder.
//
// Match by lowercased trimmed name + company_type prefix. Skip if the
// property already has the FK set (don't overwrite curated linkages).
async function upsertOwnership(args: {
  propertyId: string;
  extraction: BrochureExtraction;
}): Promise<{ freeholder?: string; longLeaseholder?: string; lender?: string }> {
  const e = args.extraction;
  const linked: { freeholder?: string; longLeaseholder?: string; lender?: string } = {};

  // Resolve vendor → freeholder or longLeaseholder based on tenure.
  const tenureLower = (e.tenure || "").toLowerCase();
  const isFreehold = tenureLower.includes("freehold") && !tenureLower.includes("long lease");
  const isLongLease = tenureLower.includes("leasehold") || tenureLower.includes("long lease");

  // Build a deduped role → name map. Explicit fields beat the inferred
  // vendor mapping so we don't lose data when both are present.
  const roleToName: Record<"freeholder" | "longLeaseholder" | "lender", string | null> = {
    freeholder: e.ownership.freeholderName || (isFreehold ? e.ownership.vendorName : null),
    longLeaseholder: e.ownership.longLeaseholderName || (isLongLease ? e.ownership.vendorName : null),
    lender: e.ownership.lenderName,
  };

  // If the vendor name appears on both freeholder + longLeaseholder via
  // the inference, prefer freeholder (more common for investment sales).
  if (roleToName.freeholder && roleToName.longLeaseholder && roleToName.freeholder === roleToName.longLeaseholder) {
    roleToName.longLeaseholder = null;
  }

  // Pull the property once so we don't overwrite curated FKs.
  const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, args.propertyId));
  if (!property) return linked;

  const upsertCompany = async (name: string, companyType: "Landlord" | "Lender"): Promise<string | null> => {
    const norm = name.replace(/\s+/g, " ").trim();
    if (!norm) return null;
    // Match — same company can be tagged differently in old data, so
    // accept any row that matches the name (case insensitive) and isn't
    // a merged ghost.
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM crm_companies
        WHERE lower(regexp_replace(name, '\\s+', ' ', 'g')) = lower($1)
          AND merged_into_id IS NULL
        ORDER BY (coalesce(company_type, '') ILIKE $2) DESC,
                 created_at ASC
        LIMIT 1`,
      [norm, `${companyType}%`],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const inserted = await db.insert(crmCompanies).values({
      name: norm,
      companyType,
    } as any).returning({ id: crmCompanies.id });
    return inserted[0]?.id || null;
  };

  // Freeholder
  if (roleToName.freeholder && !(property as any).freeholderId) {
    const id = await upsertCompany(roleToName.freeholder, "Landlord");
    if (id) {
      await pool.query(`UPDATE crm_properties SET freeholder_id = $1 WHERE id = $2 AND freeholder_id IS NULL`, [id, args.propertyId]);
      linked.freeholder = roleToName.freeholder;
    }
  }

  // Long leaseholder
  if (roleToName.longLeaseholder && !(property as any).longLeaseholderId) {
    const id = await upsertCompany(roleToName.longLeaseholder, "Landlord");
    if (id) {
      await pool.query(`UPDATE crm_properties SET long_leaseholder_id = $1 WHERE id = $2 AND long_leaseholder_id IS NULL`, [id, args.propertyId]);
      linked.longLeaseholder = roleToName.longLeaseholder;
    }
  }

  // Lender → senior lender slot (most brochure-named lenders are senior).
  if (roleToName.lender && !(property as any).seniorLenderId) {
    const id = await upsertCompany(roleToName.lender, "Lender");
    if (id) {
      await pool.query(`UPDATE crm_properties SET senior_lender_id = $1 WHERE id = $2 AND senior_lender_id IS NULL`, [id, args.propertyId]);
      linked.lender = roleToName.lender;
    }
  }

  return linked;
}
