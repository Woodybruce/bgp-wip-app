// Brochure ingestion from WhatsApp + Email — detects brochure-shaped
// PDFs, extracts property identity, match-or-creates the property in
// crm_properties, files the brochure under it, and triggers the
// bespoke ingestBrochure pipeline (the same one the dashboard upload
// uses). ChatBGP isn't in the loop — it kept timing out / spiralling
// on multi-megabyte rasterised pages.

import { db, pool } from "./db";
import { crmProperties } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { saveFile } from "./file-storage";
import { extractBrochureFields, type BrochureExtraction } from "./brochure-vision";

const BROCHURE_MIN_PAGES = 3;

export interface BrochurePipelineArgs {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  source: "whatsapp" | "email" | "other";
  userId?: string | null;          // BGP user submitting
  caption?: string;                 // optional context (WhatsApp caption, email subject)
  sendReply: (text: string) => Promise<any>;
}

export interface BrochurePipelineResult {
  handled: boolean;
  reason?: string;                  // why we didn't handle it (when handled=false)
  propertyId?: string;
  propertyAction?: "matched" | "created";
  brochureId?: string;
}

/**
 * Returns true (handled) if the file is brochure-shaped and we kicked
 * off ingestion. Returns false if it's not a brochure — caller should
 * fall through to other handlers (e.g. ChatBGP).
 */
export async function tryIngestBrochure(args: BrochurePipelineArgs): Promise<BrochurePipelineResult> {
  // ── 1. Brochure-shaped? PDF + 3+ pages.
  const isPdf = /pdf/i.test(args.mimeType)
    || (args.bytes.length >= 5 && args.bytes[0] === 0x25 && args.bytes[1] === 0x50 && args.bytes[2] === 0x44 && args.bytes[3] === 0x46);
  if (!isPdf) return { handled: false, reason: "not a PDF" };

  let pageCount = 0;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(args.bytes, { ignoreEncryption: true });
    pageCount = doc.getPageCount();
  } catch {
    return { handled: false, reason: "couldn't read PDF page count" };
  }
  if (pageCount < BROCHURE_MIN_PAGES) return { handled: false, reason: `only ${pageCount} pages — too small for a brochure` };

  await args.sendReply(`📄 Looks like a brochure (${pageCount} pages) — reading the cover…`);

  // ── 2. Extract identity. We hand the whole PDF to extractBrochureFields
  //      so the same extraction feeds both the property match and the
  //      full ingest below.
  let extraction: BrochureExtraction | null = null;
  try {
    extraction = await extractBrochureFields({ pdfBuffer: args.bytes, maxPages: 6 });
  } catch (err: any) {
    console.warn("[wa-brochure] extraction failed:", err?.message);
  }
  if (!extraction || (!extraction.propertyName && !extraction.addressLine && !extraction.postcode)) {
    await args.sendReply(`⚠️ Couldn't read a property name or address off this brochure. Try uploading via the dashboard so you can pick the property manually.`);
    return { handled: true, reason: "no identity extracted" };
  }

  // ── 3. Match or create the property.
  const match = await findExistingProperty(extraction);
  let propertyId: string;
  let action: "matched" | "created";
  if (match) {
    propertyId = match.id;
    action = "matched";
    await args.sendReply(`📍 Matched to existing property: ${match.name}`);
  } else {
    propertyId = await createPropertyFromExtraction(extraction);
    action = "created";
    await args.sendReply(`🆕 New property: ${extraction.propertyName || extraction.addressLine} — filing brochure…`);
  }

  // ── 4. Save the brochure file + row.
  const sha256 = crypto.createHash("sha256").update(args.bytes).digest("hex");
  const dupe = await pool.query<{ id: string }>(
    `SELECT id FROM property_brochures WHERE property_id = $1 AND file_sha256 = $2 LIMIT 1`,
    [propertyId, sha256],
  ).catch(() => ({ rows: [] as { id: string }[] }));

  let brochureId: string;
  if (dupe.rows[0]) {
    brochureId = dupe.rows[0].id;
    await args.sendReply(`👍 Same brochure already filed — re-running extraction.`);
  } else {
    const cleanName = args.filename.replace(/[\/\\:*?"<>|]/g, "-");
    const storageKey = `property-brochures/${propertyId}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
    await saveFile(storageKey, args.bytes, "application/pdf", cleanName);
    const type: "leasing" | "investment" = guessBrochureType(extraction, args.caption);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO property_brochures
         (property_id, type, original_name, storage_key, mime_type, size_bytes, page_count, uploaded_by, file_sha256, ingest_status)
       VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8, 'running')
       RETURNING id`,
      [propertyId, type, cleanName, storageKey, args.bytes.length, pageCount, args.userId || null, sha256],
    );
    brochureId = rows[0].id;
  }

  // ── 5. Run the bespoke ingest in the background. Reply with the
  //      summary when it finishes.
  setImmediate(async () => {
    const { ingestBrochure } = await import("./brochure-ingest");
    const result = await ingestBrochure({
      brochureId,
      propertyId,
      pdfBuffer: args.bytes,
      userId: args.userId || null,
    });
    await pool.query(
      `UPDATE property_brochures
         SET ingest_status = $1, ingest_completed_at = NOW(),
             ingest_result = $2, ingest_error = $3
       WHERE id = $4`,
      [result.status, JSON.stringify({ applied: result.applied, extraction: result.extraction || null }), result.error || null, brochureId],
    ).catch(() => {});

    const a = result.applied;
    if (!result.ok) {
      await args.sendReply(`❌ Brochure ingest failed: ${result.error || "unknown error"}`).catch(() => {});
      return;
    }
    const parts: string[] = [];
    if (a.imagesStored) parts.push(`${a.imagesStored} images`);
    if (a.imagesByKind && Object.keys(a.imagesByKind).length) {
      const kinds = Object.entries(a.imagesByKind).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(", ");
      if (kinds) parts.push(kinds);
    }
    if (a.tenancyRowsInserted) parts.push(`${a.tenancyRowsInserted} tenancy rows`);
    if (a.propertyFieldsUpdated?.length) parts.push(`${a.propertyFieldsUpdated.length} fields filled`);
    if (a.geocoded) parts.push("geocoded");
    if (a.agentLinked) parts.push("agent linked");
    if (a.ownershipLinked?.freeholder) parts.push(`freeholder: ${a.ownershipLinked.freeholder}`);
    if (a.ownershipLinked?.longLeaseholder) parts.push(`long leaseholder: ${a.ownershipLinked.longLeaseholder}`);
    if (a.ownershipLinked?.lender) parts.push(`lender: ${a.ownershipLinked.lender}`);

    const summary = parts.length > 0
      ? `✅ Brochure filed — ${parts.join(" · ")}.`
      : `✅ Brochure filed (no extractions surfaced — check the property page).`;
    await args.sendReply(summary).catch(() => {});
  });

  await args.sendReply(`⏳ Extracting images, plans, tenancy schedule — I'll ping you when it's done.`);
  return { handled: true, propertyId, propertyAction: action, brochureId };
}

// ─── Property matching ──────────────────────────────────────────────────

// Which existing property a brochure is about (feedback #78/#79, 13 Nov
// 2026). The old order — any postcode equal, then any address containing
// the brochure's line — sent every "London W1" brochure to the one record
// whose postcode was stored as plain "W1" (9 Conduit Street collected ten
// brochures that way, Cavendish House among them). Now:
// - a postcode only counts when it is a full one (W1G 9DB, never "W1"),
//   and even then only as a way to find candidates;
// - every candidate must be the same building by street name and number
//   (sameBuilding: "Mayfair", "Marylebone" or "London W1" never decide);
// - two or more different candidates = no match, so a new record is made
//   rather than filing on the wrong one.
const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export async function findExistingProperty(e: Pick<BrochureExtraction, "propertyName" | "addressLine" | "postcode">, q: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> } = pool): Promise<{ id: string; name: string } | null> {
  const { sameBuilding, addressKey } = await import("./investment-sale-evidence");
  const mine = [e.propertyName, e.addressLine].filter((v): v is string => !!v && !!v.trim());
  if (!mine.length) return null;
  const pc = String(e.postcode || "").replace(/\s+/g, "").toUpperCase();
  const words = Array.from(new Set(mine.flatMap((v) => addressKey(v).split(" "))
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !["house", "street", "road", "square", "place", "building"].includes(w))))
    .sort((a, b) => b.length - a.length).slice(0, 3);
  const { rows } = await q.query(
    `SELECT id, name, address, postcode FROM crm_properties
      WHERE ($1::text <> '' AND upper(replace(coalesce(postcode, ''), ' ', '')) = $1)
         OR lower(regexp_replace(name, '\\s+', ' ', 'g')) = ANY($2::text[])
         OR (cardinality($3::text[]) > 0 AND (name ILIKE ANY($3::text[]) OR coalesce(address::text, '') ILIKE ANY($3::text[])))
      LIMIT 200`,
    [FULL_POSTCODE.test(pc) ? pc : "", mine.map((v) => v.replace(/\s+/g, " ").trim().toLowerCase()), words.map((w) => `%${w}%`)],
  ).catch(() => ({ rows: [] as any[] }));
  const describe = (r: { name: string; address: any }): string[] => {
    const a = r.address && typeof r.address === "object" ? r.address : {};
    return [r.name, a.formatted, a.line, a.street, a.line1].filter((v) => typeof v === "string" && v.trim());
  };
  const same = (rows as Array<{ id: string; name: string; address: any }>).filter((r) => sameBuilding(mine, describe(r)));
  if (same.length === 1) return { id: same[0].id, name: same[0].name };
  if (same.length > 1) {
    const exact = same.filter((r) => mine.some((v) => v.trim().toLowerCase() === r.name.trim().toLowerCase()));
    if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };
    console.warn(`[wa-brochure] ${same.length} properties look like "${mine[0]}" — not choosing one`);
  }
  return null;
}

async function createPropertyFromExtraction(e: BrochureExtraction): Promise<string> {
  const name = e.propertyName
    || e.addressLine
    || [e.postcode].filter(Boolean).join(" ")
    || "Untitled brochure property";
  // A unit brochure ("Unit 48 Jubilee Place") belongs on its estate.
  const estateUnit = await (await import("./estate-units")).resolveEstateUnit(pool, name);
  if (estateUnit) return estateUnit.propertyId;
  const [created] = await db.insert(crmProperties).values({
    name,
    postcode: e.postcode || null,
    tenure: e.tenure || null,
    assetClass: e.useClass || null,
    sqft: e.totalAreaSqFt || null,
    address: e.addressLine ? { formatted: e.addressLine, line: e.addressLine } : null,
    notes: `Auto-created from brochure ingest (${new Date().toISOString().slice(0, 10)}).`,
  } as any).returning({ id: crmProperties.id });
  return created.id;
}

// ─── Brochure type heuristic ────────────────────────────────────────────

function guessBrochureType(e: BrochureExtraction, caption?: string): "leasing" | "investment" {
  // Type field on the extraction is authoritative if present.
  if (e.type === "investment") return "investment";
  if (e.type === "leasing") return "leasing";
  // Caption hint.
  const cap = (caption || "").toLowerCase();
  if (/investment|sale|yield|niy/i.test(cap)) return "investment";
  if (/lease|letting|rent|to let/i.test(cap)) return "leasing";
  // Price + yield in the extraction → investment.
  if (e.askingPrice || e.netInitialYield) return "investment";
  return "leasing";
}
