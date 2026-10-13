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

/** The website's five requirements (server/routes.ts publicMissing). */
export async function websiteMissingFor(unitId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT au.asking_rent, au.rent_poa, au.sqft, au.lease_terms,
            COALESCE(NULLIF(pu.address, ''), NULLIF(p.address::text, '')) AS address_line,
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
        const { rasterisePdfPage } = await import("./pdf-image-extract");
        const page = Math.max(1, Math.floor(args.photoPage || 1));
        const jpeg = await rasterisePdfPage({ pdfBuffer: file.data, page, dpi: 110 }) || (page > 1 ? await rasterisePdfPage({ pdfBuffer: file.data, page: 1, dpi: 110 }) : null);
        if (jpeg) {
          const photoName = `${file.originalName.replace(/\.pdf$/i, "")} - page ${page}.jpg`;
          await addUnitFile(unitId, jpeg, photoName, "image/jpeg", "photo");
          photoAdded = true;
          try {
            const prop = args.propertyId ? await storage.getCrmProperty(args.propertyId) : null;
            const { storeImageFromBuffer } = await import("./image-studio");
            await storeImageFromBuffer({
              buffer: jpeg, fileName: photoName, category: "Properties",
              tags: ["letting-tracker", args.unitName, ...(prop?.name ? [prop.name] : [])],
              description: `Brochure page ${page} — ${args.unitName}${prop?.name ? ` at ${prop.name}` : ""}`,
              source: "letting-tracker", propertyId: args.propertyId || null,
              companyId: (prop as any)?.landlordId || null, address: (prop as any)?.address || undefined, mimeType: "image/jpeg",
            });
          } catch {}
        } else notes.push("Couldn't render a page of the brochure for the photo — add one via Files on the unit's row.");
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
