// ChatBGP's "add this to the letting tracker" — one call that does what the
// Add Unit form does (Woody, 2026-10-13: two brochures went round in circles
// because the old tool only inserted a bare available_units row — no agents,
// no lease terms, no photo, no website — so nothing could ever be finished).
//
// Goes through POST /api/available-units (duplicate guard, property_units
// master row, leasing schedule row, tenancy spine, backing deal), then files
// the brochure PDF against the unit and renders one page of it as the
// listing photo, resolves the BGP agents named on the brochure to logins,
// and switches the website on when the five website fields are all in.

import type { Request } from "express";
import crypto from "crypto";
import { db, pool } from "./db";
import { storage } from "./storage";
import { getFile, saveFile, findChatMediaByOriginalName } from "./file-storage";
import { samePerson } from "@shared/teams";

export type AddUnitArgs = {
  propertyId: string;
  unitName: string;
  floor?: string;
  sqft?: number;
  askingRent?: number;
  rentPoa?: boolean;
  leaseTerms?: string;
  ratesPa?: number;
  serviceChargePa?: number;
  useClass?: string;
  condition?: string;
  location?: string;
  availableDate?: string;
  marketingStatus?: string;
  epcRating?: string;
  notes?: string;
  fee?: number;
  agentNames?: string[];
  brochureChatMediaFilename?: string;
  photoPage?: number;
  showOnWebsite?: boolean;
};

/** Active BGP logins matching the names on a brochure ("Tracey", "Lizzie
 *  Knights", "T Pollard"): full name, then a unique first name, then a
 *  unique surname. Unmatched names come back so ChatBGP can say so. */
export async function resolveStaffByNames(names: string[]): Promise<{ ids: string[]; matched: Array<{ name: string; user: string }>; unmatched: string[] }> {
  const { rows } = await pool.query(`SELECT id, name FROM users WHERE is_active = true AND lower(email) LIKE '%@brucegillinghampollard.com'`);
  const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  const ids: string[] = [];
  const matched: Array<{ name: string; user: string }> = [];
  const unmatched: string[] = [];
  for (const raw of names || []) {
    const n = norm(raw);
    if (!n) continue;
    let hit = rows.find((u: any) => samePerson(u.name, raw));
    if (!hit) {
      const parts = n.split(" ");
      const byFirst = rows.filter((u: any) => norm(u.name).split(" ")[0] === parts[0]);
      if (byFirst.length === 1) hit = byFirst[0];
      else if (parts.length > 1) {
        const byLast = rows.filter((u: any) => norm(u.name).split(" ").pop() === parts[parts.length - 1]);
        if (byLast.length === 1) hit = byLast[0];
      }
    }
    if (hit) { if (!ids.includes(hit.id)) { ids.push(hit.id); matched.push({ name: raw, user: hit.name }); } }
    else unmatched.push(raw);
  }
  return { ids, matched, unmatched };
}

async function chatMediaBuffer(name: string): Promise<{ data: Buffer; originalName: string; contentType: string } | null> {
  let n = name.trim();
  if (n.startsWith("/api/chat-media/")) n = n.slice("/api/chat-media/".length);
  if (n.startsWith("chat-media/")) n = n.slice("chat-media/".length);
  const exact = await getFile(`chat-media/${n}`);
  if (exact) return { data: exact.data, originalName: exact.originalName || n, contentType: exact.contentType || "application/pdf" };
  const byName = await findChatMediaByOriginalName(n);
  return byName ? { data: byName.data, originalName: byName.originalName || n, contentType: byName.contentType || "application/pdf" } : null;
}

async function addUnitFile(unitId: string, data: Buffer, fileName: string, mimeType: string, category: "brochure" | "photo"): Promise<string> {
  const { unitMarketingFiles } = await import("@shared/schema");
  const ext = (fileName.toLowerCase().match(/\.[a-z0-9]+$/) || [mimeType.startsWith("image/") ? ".jpg" : ".pdf"])[0];
  const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  await saveFile(`marketing-files/${uniqueName}`, data, mimeType, fileName);
  const [row] = await db.insert(unitMarketingFiles).values({
    unitId, fileName, filePath: `/uploads/marketing-files/${uniqueName}`, fileType: "upload", fileSize: data.length, mimeType, category,
  }).returning();
  return row.id;
}

/** The brochure's own photographs → the unit's listing photos (Woody,
 *  2026-10-13: "take the photo from the brochure rather than a screenshot").
 *  pdfimages pulls the embedded images; sharp drops anything small, thin or
 *  logo-shaped; the brochure vision classifier (Haiku) keeps exteriors /
 *  interiors and drops plans, maps and logos; the hero goes in first so the
 *  website leads with it. Replaces earlier page-render photos. */
export const EXTRACTED_PHOTO_PATTERN = "% — %.jpg"; // "<unit> — hero 1.jpg", "… — internal 2.jpg"
export async function photosFromBrochure(unitId: string, pdf: Buffer, opts: { max?: number; replacePageRenders?: boolean; replaceExtracted?: boolean; label?: string } = {}): Promise<{ added: number; removedPageRenders: number; kinds: string[] }> {
  const max = opts.max ?? 6;
  const { extractImagesFromPdf } = await import("./pdf-image-extract");
  const raw = await extractImagesFromPdf({ pdfBuffer: pdf, maxImages: 40, minBytes: 20_000 });
  type Cand = { buffer: Buffer; w: number; h: number; kind: string; rank: number };
  const cands: Cand[] = [];
  let sharp: any = null;
  try { sharp = (await import("sharp")).default; } catch {}
  for (const img of raw) {
    try {
      let buffer = img.buffer, w = 0, h = 0;
      if (sharp) {
        const meta = await sharp(img.buffer).metadata();
        w = meta.width || 0; h = meta.height || 0;
        if (w < 640 || h < 420) continue;                 // icons, logos, thumbnails
        const ar = w / h;
        if (ar < 0.55 || ar > 2.6) continue;              // strips, banners
        if (cands.some(c => c.w === w && c.h === h && Math.abs(c.buffer.length - img.buffer.length) < 2048)) continue; // same image twice
        // Flat colour / texture backgrounds (the biggest images in many
        // brochures) have almost no tonal spread — not photographs.
        const st = await sharp(img.buffer).stats();
        const spread = st.channels.slice(0, 3).reduce((a: number, c: any) => a + (c.stdev || 0), 0) / Math.min(3, st.channels.length);
        if (spread < 14) continue;
        buffer = await sharp(img.buffer).rotate().jpeg({ quality: 86 }).toBuffer();
      }
      cands.push({ buffer, w, h, kind: "unknown", rank: 5 });
    } catch {}
  }
  // Classify (vision) — kept kinds and their order on the listing.
  const order: Record<string, number> = { hero: 0, cover: 1, secondary_external: 2, internal: 3 };
  try {
    const { classifyBrochureImage } = await import("./brochure-vision");
    let i = 0;
    const worker = async () => {
      while (i < cands.length) {
        const c = cands[i++];
        const r = await classifyBrochureImage({ buffer: c.buffer, mimeType: "image/jpeg" }).catch(() => null);
        if (!r) continue;                                  // classifier unavailable → keep by size
        c.kind = r.kind;
        c.rank = r.isUseful && r.kind in order ? order[r.kind] : 9;
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, cands.length) }, worker));
  } catch {}
  const keep = cands.filter(c => c.rank < 9).sort((a, b) => a.rank - b.rank || (b.w * b.h) - (a.w * a.h)).slice(0, max);
  if (!keep.length) return { added: 0, removedPageRenders: 0, kinds: [] };

  const { unitMarketingFiles } = await import("@shared/schema");
  const { eq, and, like } = await import("drizzle-orm");
  let removedPageRenders = 0;
  if (opts.replacePageRenders !== false) {
    const { or } = await import("drizzle-orm");
    const stale = opts.replaceExtracted
      ? or(like(unitMarketingFiles.fileName, "% - page %.jpg"), like(unitMarketingFiles.fileName, EXTRACTED_PHOTO_PATTERN))
      : like(unitMarketingFiles.fileName, "% - page %.jpg");
    const old = await db.select().from(unitMarketingFiles).where(and(eq(unitMarketingFiles.unitId, unitId), eq(unitMarketingFiles.category, "photo"), stale));
    for (const f of old) {
      const key = (f.filePath || "").replace(/^\/uploads\//, "");
      try { const { deleteFile } = await import("./file-storage"); if (key) await deleteFile(key); } catch {}
      await db.delete(unitMarketingFiles).where(eq(unitMarketingFiles.id, f.id));
      removedPageRenders++;
    }
  }
  const unit: any = await storage.getAvailableUnit(unitId);
  const prop: any = unit?.propertyId ? await storage.getCrmProperty(unit.propertyId).catch(() => null) : null;
  const base = (opts.label || unit?.unitName || "unit").replace(/[\\/:*?"<>|]+/g, " ").trim();
  let n = 0;
  for (const c of keep) {
    n++;
    const name = `${base} — ${c.kind === "unknown" ? "photo" : c.kind.replace(/_/g, " ")} ${n}.jpg`;
    await addUnitFile(unitId, c.buffer, name, "image/jpeg", "photo");
    try {
      const { storeImageFromBuffer } = await import("./image-studio");
      await storeImageFromBuffer({
        buffer: c.buffer, fileName: name, category: "Properties",
        tags: ["letting-tracker", "brochure", ...(unit?.unitName ? [unit.unitName] : []), ...(prop?.name ? [prop.name] : [])],
        description: `From the brochure — ${unit?.unitName || ""}${prop?.name ? ` at ${prop.name}` : ""}`,
        source: "letting-tracker", propertyId: unit?.propertyId || null,
        companyId: prop?.landlordId || null, address: prop?.address || undefined, mimeType: "image/jpeg",
      });
    } catch {}
  }
  return { added: keep.length, removedPageRenders, kinds: keep.map(c => c.kind) };
}

/** Re-pull the listing photos from the brochure PDFs already filed under a unit. */
export async function refreshUnitPhotosFromBrochures(unitId: string, opts: { replaceExtracted?: boolean } = {}): Promise<{ added: number; removedPageRenders: number; kinds: string[]; brochures: number }> {
  const { unitMarketingFiles } = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const files = await db.select().from(unitMarketingFiles).where(and(eq(unitMarketingFiles.unitId, unitId), eq(unitMarketingFiles.category, "brochure")));
  const pdfs = files.filter(f => (f.mimeType || "").includes("pdf") && (f.fileType || "") !== "infosheet");
  let total = { added: 0, removedPageRenders: 0, kinds: [] as string[] };
  for (const f of pdfs) {
    const key = (f.filePath || "").replace(/^\/uploads\//, "");
    const stored = key ? await getFile(key) : null;
    if (!stored) continue;
    const r = await photosFromBrochure(unitId, stored.data, { replacePageRenders: total.added === 0, replaceExtracted: opts.replaceExtracted && total.added === 0, max: 6 - total.added });
    total = { added: total.added + r.added, removedPageRenders: total.removedPageRenders + r.removedPageRenders, kinds: [...total.kinds, ...r.kinds] };
    if (total.added >= 6) break;
  }
  return { ...total, brochures: pdfs.length };
}

/** The website's five requirements (server/routes.ts publicMissing). */
export async function websiteMissingFor(unitId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT au.asking_rent, au.rent_poa, au.sqft, au.lease_terms,
            COALESCE(NULLIF(pu.unit_address, ''), NULLIF(p.address::text, '')) AS address_line,
            (SELECT COUNT(*) FROM unit_marketing_files f WHERE f.unit_id = au.id AND (f.category = 'photo' OR f.mime_type LIKE 'image/%'))::int AS photos
       FROM available_units au
       LEFT JOIN crm_properties p ON p.id = au.property_id
       LEFT JOIN property_units pu ON pu.id = au.unit_id
      WHERE au.id = $1`, [unitId]);
  const r = rows[0];
  if (!r) return ["unit not found"];
  const missing: string[] = [];
  if (!r.address_line || r.address_line === "null" || r.address_line === "{}") missing.push("address (set it on the property)");
  if (r.asking_rent == null && !r.rent_poa) missing.push("rent or POA");
  if (r.sqft == null) missing.push("size (sq ft)");
  if (!r.photos) missing.push("photo");
  if (!String(r.lease_terms || "").trim()) missing.push("lease terms");
  return missing;
}

export async function addUnitToLettingTracker(req: Request, args: AddUnitArgs) {
  const notes: string[] = [];
  const agents = await resolveStaffByNames(args.agentNames || []);
  if (agents.unmatched.length) notes.push(`Not BGP logins, so not set as agents: ${agents.unmatched.join(", ")}`);

  // Same route the Add Unit form posts to, with the caller's own login.
  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req.headers.cookie) headers.Cookie = String(req.headers.cookie);
  if (req.headers.authorization) headers.Authorization = String(req.headers.authorization);
  const body: Record<string, unknown> = {
    propertyId: args.propertyId, unitName: args.unitName, floor: args.floor, sqft: args.sqft,
    askingRent: args.askingRent, rentPoa: !!args.rentPoa, leaseTerms: args.leaseTerms,
    ratesPa: args.ratesPa, serviceChargePa: args.serviceChargePa, useClass: args.useClass, condition: args.condition,
    location: args.location, availableDate: args.availableDate, marketingStatus: args.marketingStatus || "Available",
    epcRating: args.epcRating, notes: args.notes, fee: args.fee,
    agentUserIds: agents.ids.length ? agents.ids : undefined,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === null) delete body[k];
  const res = await fetch(`${protocol}://${host}/api/available-units`, { method: "POST", headers, body: JSON.stringify(body) });
  const unit: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(unit?.message || `Couldn't add the unit (${res.status})`);
  const unitId: string = unit.id;
  const alreadyListed = !!unit.alreadyListed;
  if (alreadyListed) {
    // The tracker already had it — bring the listing up to date rather than
    // leaving the brochure facts behind.
    const patch: Record<string, unknown> = {};
    for (const k of ["sqft", "askingRent", "leaseTerms", "useClass", "condition", "epcRating", "floor", "availableDate", "notes"] as const) {
      if (args[k] != null && unit[k] == null) patch[k] = args[k];
    }
    if (args.rentPoa && !unit.rentPoa) patch.rentPoa = true;
    if (agents.ids.length && !(unit.agentUserIds || []).length) patch.agentUserIds = agents.ids;
    if (Object.keys(patch).length) await storage.updateAvailableUnit(unitId, patch as any);
    notes.push("This unit was already on the tracker — blanks were filled from the brochure, nothing overwritten.");
  }

  // Brochure PDF → Files (brochure), and one page of it → the listing photo.
  let brochureFiled = false;
  let photoAdded = false;
  if (args.brochureChatMediaFilename) {
    const file = await chatMediaBuffer(args.brochureChatMediaFilename);
    if (!file) notes.push(`Brochure "${args.brochureChatMediaFilename}" wasn't found in chat uploads — ask for it to be re-attached.`);
    else {
      const isPdf = file.contentType.includes("pdf") || /\.pdf$/i.test(file.originalName);
      if (isPdf) {
        await addUnitFile(unitId, file.data, file.originalName, "application/pdf", "brochure");
        brochureFiled = true;
        // The brochure's own photographs first; a rendered page only if it
        // has none we can use (vector-only layouts).
        let got = 0;
        try {
          const r = await photosFromBrochure(unitId, file.data, { label: args.unitName, replacePageRenders: true });
          got = r.added;
          if (got) { photoAdded = true; notes.push(`${got} photo${got === 1 ? "" : "s"} taken from the brochure (${r.kinds.join(", ")}).`); }
        } catch (e: any) { notes.push(`Couldn't pull photos out of the brochure: ${e?.message || e}`); }
        if (!got) {
          const { rasterisePdfPage } = await import("./pdf-image-extract");
          const page = Math.max(1, Math.floor(args.photoPage || 1));
          const jpeg = await rasterisePdfPage({ pdfBuffer: file.data, page, dpi: 110 }) || (page > 1 ? await rasterisePdfPage({ pdfBuffer: file.data, page: 1, dpi: 110 }) : null);
          if (jpeg) {
            await addUnitFile(unitId, jpeg, `${file.originalName.replace(/\.pdf$/i, "")} - page ${page}.jpg`, "image/jpeg", "photo");
            photoAdded = true;
            notes.push("The brochure had no usable photographs, so page " + page + " is the listing photo for now — swap it via Files on the unit's row.");
          } else notes.push("Couldn't get a photo from the brochure — add one via Files on the unit's row.");
        }
      } else if (file.contentType.startsWith("image/")) {
        await addUnitFile(unitId, file.data, file.originalName, file.contentType, "photo");
        photoAdded = true;
      }
    }
  }

  const missing = await websiteMissingFor(unitId);
  let websiteOn = false;
  if (args.showOnWebsite !== false && missing.length === 0) {
    await storage.updateAvailableUnit(unitId, { showOnWebsite: true } as any);
    websiteOn = true;
  }
  return {
    success: true,
    unitId, alreadyListed, dealId: unit.dealId || null, dealRef: unit.dealRef || null,
    unitName: unit.unitName || args.unitName,
    agents: agents.matched.map(m => m.user), agentsNotMatched: agents.unmatched,
    brochureFiled, photoAdded,
    websiteLive: websiteOn,
    websiteMissing: missing,
    trackerUrl: "/available",
    notes,
  };
}
