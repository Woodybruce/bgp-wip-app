// Sharing a Letting Tracker unit with a brand (Woody, 2026-11-12: "share the
// leasing tracker info with a tenant or brand from our CRM ... a tick list of
// what is provided and then generate an email with attachments or a single
// PDF"). Routes are registered from server/index.ts. BGP staff only.
//
// What a brand may be given: the unit's plain facts, the QUOTING terms, and
// the plans, brochures, photos and files the sender ticks. What never leaves:
// the fee, the rent floor, ERV, the incentive ceilings, the works budget,
// target operators, offers, viewings, other brands' interest, comments, the
// Targeting Brief and the heads of terms. The lists below are allow-lists, so
// a new internal figure or file type is left out until someone adds it here.
import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { saveFile, getFile } from "./file-storage";
import { getAppToken } from "./shared-mailbox";
import { contentDispositionFor } from "./utils/http-headers";
import { briefAccess } from "./unit-brief-workspace";
import { BRIEF_COMMERCIAL_FIELDS, normaliseCommercials, isPlainObject } from "@shared/unit-brief";
import {
  A4, MARGIN, BORDEAUX, INK, CREAM, BLUSH, STONE, NECTAR, WHITE, MISREP,
  wordmarkBytes, wrapText, appendFileToPdf, fetchLogoBytes, fmtMoney, fmtSqft,
} from "./unit-info-sheet";

type Queryable = { query: (sql: string, params?: any[]) => Promise<any> };
type StaffAccess = NonNullable<Awaited<ReturnType<typeof briefAccess>>>;

// The commercials a brand may be given, in the order they are listed.
const SHARE_COMMERCIAL_KEYS = [
  "quotingRentPa", "serviceChargePa", "ratesPayablePa", "insurancePa",
  "leaseTermYears", "permittedUse", "availableFrom", "otherTerms",
] as const;
type ShareCommercialKey = (typeof SHARE_COMMERCIAL_KEYS)[number];
const commercialLabel = (key: ShareCommercialKey): string => BRIEF_COMMERCIAL_FIELDS.find(f => f.key === key)?.label || key;

// The unit's own files that may be offered: uploads and the info sheets the
// tracker made. The Targeting Brief document and the heads of terms are not.
const SHARE_FILE_TYPES = ["upload", "infosheet"];

type UnitFileGroup = "floorplans" | "brochures" | "photos" | "other";
type FileGroup = UnitFileGroup | "schemePlans" | "schemeBrochures";
const UNIT_FILE_GROUPS: UnitFileGroup[] = ["floorplans", "brochures", "photos", "other"];

interface ShareFact { key: string; label: string; value: string }
interface ShareCommercial extends ShareFact { key: ShareCommercialKey; print: string }
interface SourceFile {
  id: string;
  group: FileGroup;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  storageKey: string;
  url: string;
  canMerge: boolean;
  picked: boolean;
  focalX: number | null;
  focalY: number | null;
}
interface ShareSource {
  unit: any;
  propertyName: string | null;
  landlordLogoUrl: string | null;
  details: ShareFact[];
  commercials: ShareCommercial[];
  files: Record<UnitFileGroup, SourceFile[]>;
  schemePlans: SourceFile[];
  schemeBrochures: SourceFile[];
}
interface PackSelection {
  details: boolean;
  commercials: ShareCommercial[];
  floorplans: SourceFile[];
  schemePlans: SourceFile[];
  brochures: SourceFile[];
  schemeBrochures: SourceFile[];
  photos: SourceFile[];
  other: SourceFile[];
}
interface Skipped { name: string; reason: string }
interface LeftOut extends Skipped { file: SourceFile; attachable: boolean }
interface Sender { name: string; email: string | null; phone: string | null; agents: { name: string; email: string | null; phone: string | null }[] }
type FileReader = (f: SourceFile) => Promise<{ data: Buffer; mime: string } | null>;

const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);
const EMAIL_SHAPE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const extOf = (name: string): string => (name.match(/\.([A-Za-z0-9]{1,6})$/)?.[1] || "").toLowerCase();
function mimeOf(mime: unknown, name: string): string {
  const m = String(mime || "").toLowerCase().trim();
  if (m && m !== "application/octet-stream") return m;
  return EXT_MIME[extOf(name)] || m || "application/octet-stream";
}
const isPdf = (m: string): boolean => m.includes("pdf");
const isImage = (m: string): boolean => /^image\/(png|jpe?g|webp|gif)$/.test(m);
const canMerge = (m: string): boolean => isPdf(m) || isImage(m);
function kindWord(name: string): string {
  const e = extOf(name);
  if (e === "doc" || e === "docx") return "Word files";
  if (e === "xls" || e === "xlsx" || e === "csv") return "Excel files";
  if (e === "ppt" || e === "pptx") return "PowerPoint files";
  return "Files of this kind";
}

// "2026-11-12" → "12 Nov 2026"; anything else ("on completion of works") as written.
function fmtDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// A use class code reads "Class E"; a description ("Restaurant") reads as written.
function useLabel(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/^class\s*/i, "");
  if (!s) return null;
  return /^[A-Za-z]\d?(\([a-z]+\))?$/.test(s) || /^sui generis$/i.test(s) ? (/^sui/i.test(s) ? "Sui generis" : `Class ${s}`) : s;
}

function addressOf(row: any): string | null {
  const a = row.property_address;
  const text = typeof a === "string" ? a
    : a && typeof a === "object" ? String(a.formatted || a.address || [a.street, a.city].filter(Boolean).join(", ") || "") : "";
  const first = text.toLowerCase().split(",")[0].trim();
  const parts = [text && !(first && String(row.property_name || "").toLowerCase().includes(first)) ? text : null, row.property_postcode]
    .filter(Boolean).map(String).filter((v, i, arr) => arr.indexOf(v) === i);
  const line = parts.join(", ");
  return line && !(row.property_postcode && text.includes(row.property_postcode) && parts.length === 2) ? line : (text || row.property_postcode || null);
}

async function loadUnit(unitId: string): Promise<any | null> {
  return (await pool.query(
    `SELECT au.id, au.unit_name, au.property_id, au.floor, au.sqft, au.use_class, au.available_date, au.asking_rent, au.rent_poa,
            au.service_charge_pa, au.rates_pa, au.marketing_status, au.agent_user_ids, au.hots_final_file_id,
            p.name AS property_name, p.address AS property_address, p.postcode AS property_postcode, c.logo_url AS landlord_logo_url
       FROM available_units au
       LEFT JOIN crm_properties p ON p.id = au.property_id
       LEFT JOIN crm_companies c ON c.id = p.landlord_id
      WHERE au.id = $1`, [unitId])).rows[0] || null;
}

// BGP staff only. Answers the refusal itself and returns null when the
// caller may not go on. A login that is not staff hears 403 whether or not
// the unit exists.
async function staffGate(req: Request, res: Response, unitId: unknown): Promise<{ unit: any; access: StaffAccess } | null> {
  const id = typeof unitId === "string" && unitId.length <= 100 ? unitId : "";
  const unit = id ? await loadUnit(id) : null;
  const access = await briefAccess(req, unit?.property_id || null);
  if (!access || !access.isStaff) { res.status(403).json({ message: "Sharing a unit with a brand is for BGP staff" }); return null; }
  if (!unit) { res.status(404).json({ message: "That unit is not on the tracker" }); return null; }
  return { unit, access };
}

// Everything that can be ticked for this unit. Both the options route and
// the send route read it, so a send can only name what the screen offered.
async function loadSource(unit: any): Promise<ShareSource> {
  const brief = (await pool.query(
    `SELECT commercials, plan_ids, brochure_ids, source_file_id, document_file_id FROM unit_briefs WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 1`, [unit.id])).rows[0] || null;
  const c = normaliseCommercials(brief?.commercials).value;

  const details: ShareFact[] = [];
  const fact = (key: string, label: string, value: string | null | undefined) => { if (value) details.push({ key, label, value }); };
  fact("property", "Property", unit.property_name);
  fact("address", "Address", addressOf(unit));
  fact("floor", "Floor", unit.floor ? String(unit.floor).trim() : null);
  fact("size", "Size", fmtSqft(unit.sqft));
  fact("use", "Use", useLabel(unit.use_class));
  fact("available", "Available", fmtDate(unit.available_date));

  // The quoting terms. The tracker row holds the quoting rent, service charge
  // and rates (the brief writes them through); the rest are the brief's.
  const commercials: ShareCommercial[] = [];
  const term = (key: ShareCommercialKey, value: string | null | undefined, print?: string) => {
    if (value) commercials.push({ key, label: commercialLabel(key), value, print: print || value });
  };
  const rent = fmtMoney(unit.asking_rent ?? c.quotingRentPa);
  if (unit.rent_poa) term("quotingRentPa", "On application");
  else if (rent) term("quotingRentPa", `${rent} a year`, `${rent} per annum exclusive`);
  const service = fmtMoney(unit.service_charge_pa ?? c.serviceChargePa);
  if (service) term("serviceChargePa", `${service} a year`, `${service} per annum`);
  const rates = fmtMoney(unit.rates_pa ?? c.ratesPayablePa);
  if (rates) term("ratesPayablePa", `${rates} a year`, `${rates} per annum`);
  const insurance = fmtMoney(c.insurancePa);
  if (insurance) term("insurancePa", `${insurance} a year`, `${insurance} per annum`);
  if (c.leaseTermYears && c.leaseTermYears > 0) term("leaseTermYears", `${c.leaseTermYears.toLocaleString("en-GB", { maximumFractionDigits: 1 })} ${c.leaseTermYears === 1 ? "year" : "years"}`);
  term("permittedUse", c.permittedUse);
  term("availableFrom", fmtDate(c.availableFrom));
  term("otherTerms", c.otherTerms);

  const internalIds = new Set<string>([unit.hots_final_file_id, brief?.source_file_id, brief?.document_file_id].filter(Boolean).map(String));
  const fileRows = (await pool.query(
    `SELECT id, file_name, file_path, file_size, mime_type, category, focal_x, focal_y
       FROM unit_marketing_files
      WHERE unit_id = $1 AND COALESCE(file_type, 'upload') = ANY($2::text[])
      ORDER BY sort_order ASC NULLS LAST, created_at, file_name`, [unit.id, SHARE_FILE_TYPES])).rows;
  const files: Record<UnitFileGroup, SourceFile[]> = { floorplans: [], brochures: [], photos: [], other: [] };
  for (const f of fileRows) {
    if (internalIds.has(String(f.id))) continue;
    const mime = mimeOf(f.mime_type, f.file_name || "");
    // An image filed under brochure is a photo (the info sheet reads it the same way).
    const group: UnitFileGroup = f.category === "floorplan" ? "floorplans"
      : f.category === "photo" || ((f.category || "brochure") === "brochure" && mime.startsWith("image/")) ? "photos"
      : f.category === "other" ? "other" : "brochures";
    files[group].push({
      id: String(f.id), group, name: f.file_name || "File", mimeType: mime, sizeBytes: f.file_size ?? null,
      storageKey: String(f.file_path || "").replace(/^\/uploads\//, ""), url: f.file_path, canMerge: canMerge(mime), picked: false,
      focalX: typeof f.focal_x === "number" ? f.focal_x : null, focalY: typeof f.focal_y === "number" ? f.focal_y : null,
    });
  }

  let schemePlans: SourceFile[] = [];
  let schemeBrochures: SourceFile[] = [];
  if (unit.property_id) {
    const planIds = new Set<string>((brief?.plan_ids || []).map(String));
    const brochureIds = new Set<string>((brief?.brochure_ids || []).map(String));
    const [plansQ, brochuresQ] = await Promise.all([
      pool.query(`SELECT id::text AS id, floor, storage_key FROM property_plans WHERE property_id = $1 AND COALESCE(is_geo, false) = false ORDER BY display_order, floor`, [unit.property_id]),
      pool.query(`SELECT id::text AS id, original_name, storage_key, mime_type, size_bytes FROM property_brochures WHERE property_id = $1 AND type = 'leasing' AND COALESCE(archived, false) = false ORDER BY created_at DESC`, [unit.property_id]),
    ]);
    const keys = [...plansQ.rows, ...brochuresQ.rows].map((r: any) => r.storage_key).filter(Boolean);
    const stored = new Map<string, { content_type: string | null; size: number | null }>();
    if (keys.length) {
      for (const r of (await pool.query(`SELECT storage_key, content_type, size FROM file_storage WHERE storage_key = ANY($1::text[])`, [keys])).rows) stored.set(r.storage_key, r);
    }
    schemePlans = plansQ.rows.map((p: any): SourceFile => {
      const s = stored.get(p.storage_key);
      const mime = mimeOf(s?.content_type, p.storage_key || "");
      return {
        id: p.id, group: "schemePlans", name: String(p.floor || "").trim() || "Scheme plan", mimeType: mime, sizeBytes: s?.size ?? null,
        storageKey: p.storage_key, url: `/api/plans/${p.id}/image`, canMerge: !!s && isImage(mime), picked: planIds.has(p.id), focalX: null, focalY: null,
      };
    });
    schemeBrochures = brochuresQ.rows.map((b: any): SourceFile => {
      const s = stored.get(b.storage_key);
      const mime = mimeOf(b.mime_type || s?.content_type, b.original_name || "");
      return {
        id: b.id, group: "schemeBrochures", name: b.original_name || "Brochure", mimeType: mime, sizeBytes: b.size_bytes != null ? Number(b.size_bytes) : s?.size ?? null,
        storageKey: b.storage_key, url: `/api/properties/${unit.property_id}/brochures/${b.id}/file`, canMerge: !!s && canMerge(mime), picked: brochureIds.has(b.id), focalX: null, focalY: null,
      };
    });
  }

  return { unit, propertyName: unit.property_name || null, landlordLogoUrl: unit.landlord_logo_url || null, details, commercials, files, schemePlans, schemeBrochures };
}

const fileJson = (f: SourceFile) => ({ id: f.id, fileName: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, url: f.url, canMerge: f.canMerge });

function historyHow(row: any): string {
  const inc = isPlainObject(row.included) ? row.included : {};
  if (row.mode === "pdf") return "one PDF";
  if (inc.draftFailed) return "PDF made, Outlook draft not made";
  return inc.asSinglePdf === false ? "Outlook draft, separate files" : "Outlook draft, one PDF";
}

async function loadHistory(unitId: string) {
  const rows = (await pool.query(`SELECT * FROM unit_shares WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 100`, [unitId])).rows;
  return rows.map((r: any) => ({
    id: r.id, companyId: r.company_id, companyName: r.company_name, contactName: r.contact_name, contactEmail: r.contact_email,
    mode: r.mode === "email" ? "email" : "pdf",
    summary: (isPlainObject(r.included) && typeof r.included.summary === "string" ? r.included.summary : "") || "",
    how: historyHow(r),
    createdAt: iso(r.created_at), createdByName: r.created_by_name,
    packUrl: r.pack_storage_key ? `/api/unit-share/pack/${r.id}/file` : null, packFileName: r.pack_file_name || null,
    draftUrl: r.email_draft_url || null,
  }));
}

// ── The request ─────────────────────────────────────────────────────────

interface SendRequest {
  company: { id: string; name: string };
  contact: { id: string | null; name: string | null; email: string | null };
  mode: "pdf" | "email";
  asSinglePdf: boolean;
  subject: string | null;
  message: string | null;
  selection: PackSelection;
  ids: { commercialKeys: string[]; fileIds: string[]; schemePlanIds: string[]; schemeBrochureIds: string[] };
}

const shortText = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > max ? undefined : t || null;
};

// A list of ids from the request: an array of short strings, no repeats.
function idList(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 500) return null;
  if (!v.every(x => typeof x === "string" && x.length > 0 && x.length <= 100)) return null;
  return Array.from(new Set(v as string[]));
}

async function parseSend(body: unknown, src: ShareSource): Promise<{ ok: true; value: SendRequest } | { ok: false; message: string }> {
  const bad = (message: string) => ({ ok: false as const, message });
  if (!isPlainObject(body)) return bad("Nothing was sent. Pick the brand and what to include.");
  const mode = body.mode;
  if (mode !== "pdf" && mode !== "email") return bad("Choose how to send it: one PDF, or an email with attachments.");
  if (body.asSinglePdf !== undefined && typeof body.asSinglePdf !== "boolean") return bad("Attach everything as one PDF is a yes or a no.");
  const asSinglePdf = body.asSinglePdf !== false;

  const r = body.recipient;
  if (!isPlainObject(r)) return bad("Pick the brand this is for.");
  if (typeof r.companyId !== "string" || !r.companyId.trim() || r.companyId.length > 100) return bad("Pick the brand this is for.");
  const company = (await pool.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [r.companyId.trim()])).rows[0];
  if (!company) return bad("That brand is not in the CRM. Pick it again, or create it.");
  const typedName = shortText(r.contactName, 200);
  const typedEmail = shortText(r.contactEmail, 200);
  if (typedName === undefined) return bad("The contact's name is too long.");
  if (typedEmail === undefined || (typedEmail && !EMAIL_SHAPE.test(typedEmail))) return bad("That email address does not look right.");
  let contact: SendRequest["contact"] = { id: null, name: typedName, email: typedEmail };
  if (r.contactId !== undefined && r.contactId !== null && r.contactId !== "") {
    if (typeof r.contactId !== "string" || r.contactId.length > 100) return bad("Pick the contact again.");
    const row = (await pool.query(`SELECT id, name, email FROM crm_contacts WHERE id = $1`, [r.contactId])).rows[0];
    if (!row) return bad("That contact is not in the CRM. Pick the contact again.");
    // The contact's own name and address; a typed address only fills a gap.
    const own = typeof row.email === "string" && EMAIL_SHAPE.test(row.email.trim()) ? row.email.trim() : null;
    contact = { id: row.id, name: row.name || typedName, email: own || typedEmail };
  }
  if (mode === "email" && !contact.email) return bad("An email address is needed to make the draft. Add one for the contact.");

  const subject = shortText(body.subject, 250);
  if (subject === undefined) return bad("The subject is too long. Keep it under 250 characters.");
  const message = shortText(body.message, 10000);
  if (message === undefined) return bad("The message is too long. Keep it under 10,000 characters.");

  const inc = body.include;
  if (!isPlainObject(inc)) return bad("Tick what to include.");
  if (inc.details !== undefined && typeof inc.details !== "boolean") return bad("Unit details is a yes or a no.");
  const commercialKeys = idList(inc.commercialKeys);
  const fileIds = idList(inc.fileIds);
  const schemePlanIds = idList(inc.schemePlanIds);
  const schemeBrochureIds = idList(inc.schemeBrochureIds);
  if (!commercialKeys || !fileIds || !schemePlanIds || !schemeBrochureIds) return bad("The tick list was not understood. Close this and open it again.");

  for (const k of commercialKeys) {
    if (!(SHARE_COMMERCIAL_KEYS as readonly string[]).includes(k)) return bad("One of the figures ticked cannot be shared with a brand.");
    if (!src.commercials.some(c => c.key === k)) return bad(`${commercialLabel(k as ShareCommercialKey)} has no value on this unit, so it cannot be included.`);
  }
  const unitFiles = UNIT_FILE_GROUPS.flatMap(g => src.files[g]);
  if (fileIds.some(id => !unitFiles.some(f => f.id === id))) return bad("One of the files ticked is not one of this unit's files. Close this and open it again.");
  if (schemePlanIds.some(id => !src.schemePlans.some(f => f.id === id))) return bad("One of the plans ticked is not on this unit's property. Close this and open it again.");
  if (schemeBrochureIds.some(id => !src.schemeBrochures.some(f => f.id === id))) return bad("One of the brochures ticked is not on this unit's property. Close this and open it again.");

  const pick = (list: SourceFile[], ids: string[]) => list.filter(f => ids.includes(f.id));
  const selection: PackSelection = {
    details: inc.details === true,
    commercials: src.commercials.filter(c => commercialKeys.includes(c.key)),
    floorplans: pick(src.files.floorplans, fileIds), schemePlans: pick(src.schemePlans, schemePlanIds),
    brochures: pick(src.files.brochures, fileIds), schemeBrochures: pick(src.schemeBrochures, schemeBrochureIds),
    photos: pick(src.files.photos, fileIds), other: pick(src.files.other, fileIds),
  };
  if (!selection.details && !selection.commercials.length && !selectedFiles(selection).length) return bad("Tick at least one thing to share.");
  return { ok: true, value: { company: { id: company.id, name: company.name }, contact, mode, asSinglePdf, subject, message, selection, ids: { commercialKeys, fileIds, schemePlanIds, schemeBrochureIds } } };
}

// The ticked files in the order they go into the pack.
const selectedFiles = (s: PackSelection): SourceFile[] =>
  [...s.floorplans, ...s.schemePlans, ...s.brochures, ...s.schemeBrochures, ...s.photos, ...s.other];

// What was included, as lines for the message ("2 floor plans") and as a
// short phrase for the history ("details, 2 plans, 4 photos").
function includedLines(s: PackSelection): string[] {
  const brochures = s.brochures.length + s.schemeBrochures.length;
  return [
    s.details ? "Unit details" : null,
    s.commercials.length ? "Quoting terms" : null,
    s.floorplans.length ? plural(s.floorplans.length, "floor plan") : null,
    s.schemePlans.length ? plural(s.schemePlans.length, "scheme plan") : null,
    brochures ? plural(brochures, "brochure") : null,
    s.photos.length ? plural(s.photos.length, "photo") : null,
    s.other.length ? plural(s.other.length, "other file") : null,
  ].filter((x): x is string => !!x);
}
function includedSummary(s: PackSelection): string {
  const plans = s.floorplans.length + s.schemePlans.length;
  const brochures = s.brochures.length + s.schemeBrochures.length;
  return [
    s.details ? "details" : null,
    s.commercials.length ? "quoting terms" : null,
    plans ? plural(plans, "plan") : null,
    brochures ? plural(brochures, "brochure") : null,
    s.photos.length ? plural(s.photos.length, "photo") : null,
    s.other.length ? plural(s.other.length, "other file") : null,
  ].filter(Boolean).join(", ");
}

const unitTitle = (src: ShareSource): string => String(src.unit.unit_name || "Unit").trim() || "Unit";
const defaultSubject = (src: ShareSource): string => `${unitTitle(src)}${src.propertyName ? `, ${src.propertyName}` : ""}: details`.slice(0, 250);

function defaultMessage(src: ShareSource, v: SendRequest, senderName: string): string {
  const first = (v.contact.name || "").trim().split(/\s+/)[0];
  const where = `${unitTitle(src)}${src.propertyName ? ` at ${src.propertyName}` : ""}`;
  return [
    first ? `Dear ${first},` : "Hello,",
    v.asSinglePdf ? `Please find attached the details of ${where}, in one PDF. It includes:` : `Please find attached the details of ${where}:`,
    includedLines(v.selection).map(l => `- ${l}`).join("\n"),
    "Please let me know if you would like to arrange a viewing.",
    `${senderName}\nBruce Gillingham Pollard`,
  ].join("\n\n");
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Plain text to a simple HTML body: paragraphs, line breaks, and a block of
// "- " lines as a bulleted list. Every character is escaped.
function htmlFromText(text: string): string {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const html = blocks.map(b => {
    const lines = b.split("\n");
    if (lines.every(l => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${esc(l.replace(/^\s*[-•*]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${lines.map(esc).join("<br>")}</p>`;
  }).join("");
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 11pt;">${html}</div>`;
}

function mailtoFor(email: string | null, subject: string, text: string): string {
  const to = email ? encodeURIComponent(email).replace(/%40/g, "@") : "";
  // Mail apps cut very long links, so the body is kept short.
  const body = text.length > 1500 ? `${text.slice(0, 1500)}...` : text;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
}

// "<Unit> <Property> details.pdf", with only characters every system takes.
function packFileName(src: ShareSource): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9 ._&'()-]/g, " ").replace(/\s+/g, " ").trim();
  const base = clean([unitTitle(src), src.propertyName || ""].join(" ")).slice(0, 110).trim();
  return `${base || "Unit"} details.pdf`;
}

// ── The pack ────────────────────────────────────────────────────────────

// Text the standard PDF fonts can draw: anything outside Latin-1 becomes a space.
const pdfSafe = (v: unknown): string =>
  String(v ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, " ");
const oneLine = (v: unknown): string => pdfSafe(v).replace(/\s+/g, " ").trim();

function makeReader(): FileReader {
  const seen = new Map<string, Promise<{ data: Buffer; mime: string } | null>>();
  return (f: SourceFile) => {
    let p = seen.get(f.storageKey);
    if (!p) {
      p = (f.storageKey ? getFile(f.storageKey) : Promise.resolve(null))
        .then(s => (s ? { data: s.data, mime: mimeOf(f.mimeType || s.contentType, f.name) } : null))
        .catch(() => null);
      seen.set(f.storageKey, p);
    }
    return p;
  };
}

// An image as pdf-lib can embed it: turned the right way up, no larger than
// a page needs, PNG kept as PNG (plans are line drawings) and the rest JPEG.
async function prepImage(data: Buffer, mime: string): Promise<{ data: Buffer; mime: "image/png" | "image/jpeg" } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(data, { failOn: "none" }).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true });
    if (mime.includes("png")) return { data: await img.png().toBuffer(), mime: "image/png" };
    return { data: await img.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 84 }).toBuffer(), mime: "image/jpeg" };
  } catch {
    if (mime.includes("png")) return { data, mime: "image/png" };
    if (/jpe?g/.test(mime)) return { data, mime: "image/jpeg" };
    return null;
  }
}

// The photo across the top of page one: cropped to fill, around the focal
// point set on the Files dialog when there is one.
async function heroImage(data: Buffer, f: SourceFile, boxW: number, boxH: number): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    const turned = await sharp(data, { failOn: "none" }).rotate().toBuffer();
    const meta = await sharp(turned).metadata();
    if (!meta.width || !meta.height) return null;
    const cw = Math.round(boxW * 2), ch = Math.round(boxH * 2);
    const scale = Math.max(cw / meta.width, ch / meta.height);
    const rw = Math.max(Math.ceil(meta.width * scale), cw), rh = Math.max(Math.ceil(meta.height * scale), ch);
    const fx = f.focalX ?? 0.5, fy = f.focalY ?? 0.45;
    const left = Math.min(Math.max(Math.round(rw * fx - cw / 2), 0), rw - cw);
    const top = Math.min(Math.max(Math.round(rh * fy - ch / 2), 0), rh - ch);
    return await sharp(turned).resize(rw, rh, { fit: "fill" }).extract({ left, top, width: cw, height: ch })
      .flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}

// One PDF: the particulars page (only what was ticked), then, when
// `withFiles`, every ticked file that can go into a PDF, then the notice.
// `left` lists the ticked files that did not go in, and why.
async function buildPack(src: ShareSource, sel: PackSelection, sender: Sender, read: FileReader, withFiles: boolean): Promise<{ bytes: Buffer; pages: number; left: LeftOut[] }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const grey = rgb(0.42, 0.40, 0.38);
  const [pw, ph] = A4;
  const contentW = pw - MARGIN * 2;
  const unitName = oneLine(unitTitle(src));
  const propertyName = oneLine(src.propertyName);
  const detail = (key: string): string | null => (sel.details ? src.details.find(d => d.key === key)?.value || null : null);
  doc.setTitle(`${unitName}${propertyName ? `, ${propertyName}` : ""}`);
  doc.setAuthor("Bruce Gillingham Pollard");
  const left: LeftOut[] = [];

  const markLight = wordmarkBytes("light");
  const markDark = wordmarkBytes("dark");
  const logoLight = markLight ? await doc.embedPng(markLight) : null;
  const logoDark = markDark ? await doc.embedPng(markDark) : null;
  const drawMark = (pg: PDFPage, img: PDFImage | null, x: number, y: number, h: number) => {
    if (img) pg.drawImage(img, { x, y, width: (img.width / img.height) * h, height: h });
  };
  // Letter-spaced capitals, as on the unit info sheet.
  const drawLabel = (pg: PDFPage, text: string, x: number, y: number, size: number, color = grey, align: "left" | "right" = "left") => {
    const t = text.toUpperCase();
    const gap = size * 0.14;
    const width = fontBold.widthOfTextAtSize(t, size) + gap * (t.length - 1);
    let cx = align === "right" ? x - width : x;
    for (const ch of t) {
      pg.drawText(ch, { x: cx, y, size, font: fontBold, color });
      cx += fontBold.widthOfTextAtSize(ch, size) + gap;
    }
    return width;
  };
  const drawFooter = (pg: PDFPage) => {
    pg.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: pw - MARGIN, y: 44 }, thickness: 0.6, color: BLUSH });
    drawMark(pg, logoDark, MARGIN, 22, 17);
    const t = `${unitName}${propertyName ? ` · ${propertyName}` : ""}`;
    pg.drawText(t, { x: pw - MARGIN - font.widthOfTextAtSize(t, 8), y: 27, size: 8, font, color: grey });
  };
  const plainPage = (heading: string): PDFPage => {
    const pg = doc.addPage(A4);
    drawMark(pg, logoDark, MARGIN, ph - 50, 16);
    drawLabel(pg, heading, pw - MARGIN, ph - 46, 7.5, STONE, "right");
    drawFooter(pg);
    return pg;
  };

  // Page one. Bordeaux band: the wordmark, "To let", the landlord's logo.
  let page = doc.addPage(A4);
  const bandH = 92;
  page.drawRectangle({ x: 0, y: ph - bandH, width: pw, height: bandH, color: BORDEAUX });
  drawMark(page, logoLight, MARGIN, ph - bandH + (bandH - 30) / 2, 30);
  const underOffer = /^(sol|solicitors|under offer)$/i.test(String(src.unit.marketing_status || "").trim());
  const toLetW = drawLabel(page, underOffer ? "Under offer" : "To let", pw - MARGIN, ph - bandH / 2 - 4, 10.5, WHITE, "right");
  const landlordLogo = await fetchLogoBytes(src.landlordLogoUrl);
  if (landlordLogo) {
    try {
      const img = landlordLogo.kind === "png" ? await doc.embedPng(landlordLogo.bytes) : await doc.embedJpg(landlordLogo.bytes);
      const lh = 26;
      const lw = Math.min((img.width / img.height) * lh, 120);
      const lx = pw - MARGIN - toLetW - 22 - lw;
      page.drawRectangle({ x: lx - 8, y: ph - bandH + (bandH - lh) / 2 - 6, width: lw + 16, height: lh + 12, color: WHITE, opacity: 0.92 });
      page.drawImage(img, { x: lx, y: ph - bandH + (bandH - lh) / 2, width: lw, height: lh });
    } catch {/* no co-brand */}
  }

  // The first ticked photo that can be read runs across the top.
  let y = ph - bandH;
  let heroId: string | null = null;
  for (const f of sel.photos.slice(0, 3)) {
    const got = await read(f);
    const cropped = got && isImage(got.mime) ? await heroImage(got.data, f, pw, 250) : null;
    if (!cropped) continue;
    try {
      page.drawImage(await doc.embedJpg(cropped), { x: 0, y: y - 250, width: pw, height: 250 });
      y -= 250;
      heroId = f.id;
      break;
    } catch {/* try the next photo */}
  }

  y -= 40;
  const floor = detail("floor");
  const title = `${unitName}${floor && !unitName.toLowerCase().includes(oneLine(floor).toLowerCase()) ? ` · ${oneLine(floor)}` : ""}`;
  for (const l of wrapText(title, serif, 24, contentW).slice(0, 2)) {
    page.drawText(l, { x: MARGIN, y, size: 24, font: serif, color: BORDEAUX });
    y -= 28;
  }
  const addressLine = [propertyName, oneLine(detail("address"))].filter(Boolean).join(", ");
  for (const l of wrapText(addressLine, font, 11.5, contentW).slice(0, 2)) {
    page.drawText(l, { x: MARGIN, y, size: 11.5, font, color: grey });
    y -= 15;
  }

  // The three facts a brand looks for first, from what was ticked.
  const termOf = (key: ShareCommercialKey) => sel.commercials.find(c => c.key === key) || null;
  const rent = termOf("quotingRentPa");
  const stats: Array<[string, string]> = [];
  const shown = new Set<string>();
  if (detail("size")) { stats.push(["Area", oneLine(detail("size"))]); shown.add("size"); }
  if (rent) stats.push(["Quoting rent", /^£/.test(rent.value) ? `${rent.value.replace(/ a year$/, "")} pa` : oneLine(rent.value)]);
  if (detail("use")) { stats.push(["Use", oneLine(detail("use"))]); shown.add("use"); }
  else if (detail("available") && !termOf("availableFrom")) { stats.push(["Available", oneLine(detail("available"))]); shown.add("available"); }
  if (stats.length) {
    y -= 18;
    const colW = contentW / stats.length;
    stats.forEach(([label, value], i) => {
      const x = MARGIN + i * colW;
      if (i > 0) page.drawLine({ start: { x: x - 14, y: y - 30 }, end: { x: x - 14, y: y + 10 }, thickness: 0.6, color: BLUSH });
      drawLabel(page, label, x, y, 7.5, STONE);
      let size = 20;
      while (size > 10 && serif.widthOfTextAtSize(value, size) > colW - 20) size -= 1;
      const fitted = serif.widthOfTextAtSize(value, size) > colW - 20 ? wrapText(value, serif, size, colW - 20)[0] : value;
      page.drawText(fitted, { x, y: y - 26, size, font: serif, color: BORDEAUX });
    });
    y -= 56;
  }

  // The particulars table: the ticked facts, then the ticked quoting terms.
  const rows: Array<[string, string]> = [];
  if (floor) rows.push(["Floor", oneLine(floor)]);
  if (detail("available") && !shown.has("available") && !termOf("availableFrom")) rows.push(["Available", oneLine(detail("available"))]);
  for (const c of sel.commercials) if (c.key !== "otherTerms") rows.push([c.label, oneLine(c.print)]);

  const stripY = 104;
  let bottom = stripY + 24;
  // Anything that runs past the first page carries on over the leaf.
  const room = (need: number) => {
    if (y - need >= bottom) return;
    page = plainPage("Particulars");
    y = ph - 96;
    bottom = 70;
  };
  if (rows.length) {
    y -= 6;
    room(60);
    drawLabel(page, "Particulars", MARGIN, y, 7.5, BORDEAUX);
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 1, color: BORDEAUX });
    y -= 20;
    for (const [label, value] of rows) {
      const lines = wrapText(value, fontBold, 10.5, contentW * 0.62).slice(0, 3);
      room(lines.length * 14 + 10);
      page.drawText(label, { x: MARGIN, y, size: 10.5, font, color: grey });
      let ly = y;
      for (const l of lines) {
        page.drawText(l, { x: pw - MARGIN - fontBold.widthOfTextAtSize(l, 10.5), y: ly, size: 10.5, font: fontBold, color: INK });
        ly -= 14;
      }
      y = ly + 14 - 8;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: pw - MARGIN, y }, thickness: 0.5, color: BLUSH });
      y -= 15;
    }
  }
  const other = termOf("otherTerms");
  if (other) {
    y -= 2;
    room(48);
    drawLabel(page, "Other terms", MARGIN, y, 7.5, BORDEAUX);
    y -= 17;
    for (const para of pdfSafe(other.value).split(/\n+/).map(p => p.trim()).filter(Boolean)) {
      for (const l of wrapText(para, font, 10, contentW)) {
        room(15);
        page.drawText(l, { x: MARGIN, y, size: 10, font, color: INK });
        y -= 14.5;
      }
      y -= 6;
    }
  }

  // Contact strip on page one: who to ring. The sender first, then the unit's agents.
  const first = doc.getPage(0);
  first.drawRectangle({ x: 0, y: 0, width: pw, height: stripY, color: CREAM });
  first.drawLine({ start: { x: 0, y: stripY }, end: { x: pw, y: stripY }, thickness: 1.2, color: NECTAR });
  drawMark(first, logoDark, MARGIN, stripY - 36, 22);
  drawLabel(first, "Viewings & further information", pw - MARGIN, stripY - 28, 7.5, STONE, "right");
  const people = [{ name: sender.name, email: sender.email, phone: sender.phone }, ...sender.agents].slice(0, 3);
  const colW = contentW / people.length;
  people.forEach((a, i) => {
    const cx = MARGIN + i * colW;
    first.drawText(oneLine(a.name), { x: cx, y: stripY - 56, size: 10, font: fontBold, color: INK });
    if (a.email) first.drawText(oneLine(a.email), { x: cx, y: stripY - 70, size: 8.5, font, color: grey });
    if (a.phone) first.drawText(oneLine(a.phone), { x: cx, y: stripY - 82, size: 8.5, font, color: grey });
  });

  if (withFiles) {
    const addPdf = async (data: Buffer): Promise<string | null> => {
      try {
        const from = await PDFDocument.load(data, { ignoreEncryption: true });
        if (from.isEncrypted) return "It is password protected";
        for (const p of await doc.copyPages(from, from.getPageIndices())) doc.addPage(p);
        return null;
      } catch {
        return "It could not be read as a PDF";
      }
    };
    const addOne = async (f: SourceFile, label: string) => {
      const got = await read(f);
      if (!got) { left.push({ file: f, name: f.name, reason: "The file is missing from storage", attachable: false }); return; }
      if (isPdf(got.mime)) {
        const why = await addPdf(got.data);
        if (why) left.push({ file: f, name: f.name, reason: why, attachable: true });
        return;
      }
      if (isImage(got.mime)) {
        const img = await prepImage(got.data, got.mime);
        if (img && await appendFileToPdf(doc, img.data, img.mime, oneLine(label), fontBold)) return;
        left.push({ file: f, name: f.name, reason: "The image could not be read", attachable: true });
        return;
      }
      left.push({ file: f, name: f.name, reason: `${kindWord(f.name)} cannot go into a PDF`, attachable: true });
    };

    for (const f of sel.floorplans) await addOne(f, "Floor plan");
    for (const f of sel.schemePlans) await addOne(f, `Scheme plan · ${f.name}`);
    for (const f of sel.brochures) await addOne(f, "Brochure");
    for (const f of sel.schemeBrochures) await addOne(f, "Brochure");

    // Photographs, four to a page. The one across the top of page one is not repeated.
    let photoPage: PDFPage | null = null;
    let slot = 0;
    for (const f of sel.photos) {
      if (f.id === heroId) continue;
      const got = await read(f);
      if (!got) { left.push({ file: f, name: f.name, reason: "The file is missing from storage", attachable: false }); continue; }
      const prepped = isImage(got.mime) ? await prepImage(got.data, got.mime) : null;
      let img: PDFImage | null = null;
      if (prepped) {
        try { img = prepped.mime === "image/png" ? await doc.embedPng(prepped.data) : await doc.embedJpg(prepped.data); } catch { img = null; }
      }
      if (!img) { left.push({ file: f, name: f.name, reason: isImage(got.mime) ? "The image could not be read" : `${kindWord(f.name)} cannot go into a PDF`, attachable: true }); continue; }
      if (!photoPage || slot === 4) { photoPage = plainPage("Photographs"); slot = 0; }
      const cellW = (pw - MARGIN * 2 - 16) / 2;
      const cellH = (ph - 140) / 2 - 16;
      const col = slot % 2, row = Math.floor(slot / 2);
      const scale = Math.min(cellW / img.width, cellH / img.height, 1);
      const w = img.width * scale, h = img.height * scale;
      photoPage.drawImage(img, { x: MARGIN + col * (cellW + 16) + (cellW - w) / 2, y: ph - 70 - (row + 1) * (cellH + 16) + (cellH - h) / 2, width: w, height: h });
      slot++;
    }

    for (const f of sel.other) await addOne(f, f.name);
  }

  const last = plainPage("Important notice");
  drawLabel(last, "Important notice", MARGIN, ph - 96, 7.5, BORDEAUX);
  last.drawLine({ start: { x: MARGIN, y: ph - 104 }, end: { x: pw - MARGIN, y: ph - 104 }, thickness: 1, color: BORDEAUX });
  let my = ph - 124;
  for (const l of wrapText(MISREP, font, 8.5, contentW)) {
    last.drawText(l, { x: MARGIN, y: my, size: 8.5, font, color: grey });
    my -= 12;
  }
  last.drawText(`Prepared ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · Bruce Gillingham Pollard`, { x: MARGIN, y: my - 12, size: 8.5, font, color: grey });

  return { bytes: Buffer.from(await doc.save()), pages: doc.getPageCount(), left };
}

// ── The Outlook draft (Microsoft Graph, app-only token) ─────────────────
// Makes a DRAFT in the sender's own mailbox and never sends. Needs the
// Mail.ReadWrite application permission on the app registration.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SMALL_ATTACHMENT = 3 * 1024 * 1024;   // Graph takes a file under 3 MB in one request
const UPLOAD_CHUNK = 12 * 320 * 1024;       // 3.75 MB a request, under Graph's 4 MB
export const SHARE_EMAIL_LIMIT = 30 * 1024 * 1024;

export interface DraftAttachment { name: string; contentType: string; data: Buffer }
export interface DraftInput {
  token: string;
  sender: string;
  to: { name: string | null; email: string };
  subject: string;
  html: string;
  attachments: DraftAttachment[];
}

async function graphJson(token: string, method: string, url: string, body?: unknown, timeoutMs = 30000): Promise<any> {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!r.ok) throw new Error(`Microsoft answered ${r.status}${json?.error?.message ? `: ${json.error.message}` : ""}`);
  return json;
}

async function attachSmall(token: string, messageUrl: string, a: DraftAttachment): Promise<void> {
  await graphJson(token, "POST", `${messageUrl}/attachments`, {
    "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.contentType, contentBytes: a.data.toString("base64"),
  }, 120000);
}

// A file of 3 MB or more goes up through an upload session, a piece at a
// time. The upload address carries its own authority: no token is sent to it.
async function attachLarge(token: string, messageUrl: string, a: DraftAttachment): Promise<void> {
  const session = await graphJson(token, "POST", `${messageUrl}/attachments/createUploadSession`, {
    AttachmentItem: { attachmentType: "file", name: a.name, size: a.data.length, contentType: a.contentType },
  });
  const uploadUrl: unknown = session?.uploadUrl;
  if (typeof uploadUrl !== "string" || !uploadUrl) throw new Error("Microsoft did not open an upload for a large attachment");
  const size = a.data.length;
  for (let start = 0; start < size; start += UPLOAD_CHUNK) {
    const end = Math.min(start + UPLOAD_CHUNK, size) - 1;
    const r = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${end}/${size}` },
      body: a.data.subarray(start, end + 1),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) throw new Error(`Microsoft answered ${r.status} while uploading ${a.name}`);
  }
}

export async function createOutlookDraft(input: DraftInput, graphBase: string = GRAPH_BASE): Promise<{ id: string; webLink: string | null }> {
  const mailbox = `${graphBase}/users/${encodeURIComponent(input.sender)}`;
  const draft = await graphJson(input.token, "POST", `${mailbox}/messages`, {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients: [{ emailAddress: { address: input.to.email, ...(input.to.name ? { name: input.to.name } : {}) } }],
  });
  if (!draft?.id) throw new Error("Microsoft did not return the draft");
  const messageUrl = `${mailbox}/messages/${encodeURIComponent(String(draft.id))}`;
  try {
    for (const a of input.attachments) {
      if (a.data.length < SMALL_ATTACHMENT) await attachSmall(input.token, messageUrl, a);
      else await attachLarge(input.token, messageUrl, a);
    }
  } catch (e) {
    // A draft with half its attachments is worse than none.
    await graphJson(input.token, "DELETE", messageUrl).catch(() => undefined);
    throw e;
  }
  return { id: String(draft.id), webLink: typeof draft.webLink === "string" ? draft.webLink : null };
}

// Attachment names a mail client takes, with no two the same.
function attachmentNames(list: DraftAttachment[]): DraftAttachment[] {
  const used = new Set<string>();
  return list.map(a => {
    const clean = a.name.replace(/[\\/:*?"<>|\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "Attachment";
    const dot = clean.lastIndexOf(".");
    const stem = dot > 0 ? clean.slice(0, dot) : clean, ext = dot > 0 ? clean.slice(dot) : "";
    let name = clean;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    used.add(name.toLowerCase());
    return { ...a, name };
  });
}

const megabytes = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MB`;

// ── Storing and running a share ─────────────────────────────────────────

const packKey = (shareId: string): string => `unit-share/${shareId}.pdf`;
const packUrl = (shareId: string): string => `/api/unit-share/pack/${shareId}/file`;

async function loadSender(access: StaffAccess, unit: any): Promise<Sender> {
  const me = (await pool.query(`SELECT phone FROM users WHERE id = $1`, [access.userId])).rows[0];
  const ids: string[] = Array.isArray(unit.agent_user_ids) ? unit.agent_user_ids.filter((x: any) => typeof x === "string" && x !== access.userId) : [];
  const agents = ids.length ? (await pool.query(`SELECT name, email, phone FROM users WHERE id = ANY($1::text[]) AND COALESCE(is_active, true) ORDER BY name`, [ids])).rows : [];
  return {
    name: access.name || "Bruce Gillingham Pollard", email: access.email, phone: me?.phone || null,
    agents: agents.map((a: any) => ({ name: a.name || a.email || "BGP", email: a.email || null, phone: a.phone || null })),
  };
}

async function insertShare(shareId: string, unitId: string, v: SendRequest, access: StaffAccess, extra: {
  subject: string | null; message: string | null; packFileName: string | null; hasPack: boolean; draftUrl: string | null; skipped: Skipped[]; draftFailed?: boolean;
}): Promise<void> {
  const s = v.selection;
  const names = (list: SourceFile[]) => list.map(f => f.name);
  const included = {
    details: s.details, commercialKeys: v.ids.commercialKeys, fileIds: v.ids.fileIds, schemePlanIds: v.ids.schemePlanIds, schemeBrochureIds: v.ids.schemeBrochureIds,
    ...(v.mode === "email" ? { asSinglePdf: v.asSinglePdf } : {}),
    ...(extra.draftFailed ? { draftFailed: true } : {}),
    names: {
      commercials: s.commercials.map(c => c.label), floorplans: names(s.floorplans), schemePlans: names(s.schemePlans),
      brochures: names(s.brochures), schemeBrochures: names(s.schemeBrochures), photos: names(s.photos), other: names(s.other),
    },
    summary: includedSummary(s),
    skipped: extra.skipped,
  };
  await pool.query(
    `INSERT INTO unit_shares (id, unit_id, company_id, company_name, contact_id, contact_name, contact_email, included, mode, subject, message,
                              pack_storage_key, pack_file_name, email_draft_url, created_by_user_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [shareId, unitId, v.company.id, v.company.name, v.contact.id, v.contact.name, v.contact.email, JSON.stringify(included), v.mode, extra.subject, extra.message,
      extra.hasPack ? packKey(shareId) : null, extra.hasPack ? extra.packFileName : null, extra.draftUrl, access.userId, access.name]);
}

const skippedOf = (left: LeftOut[], emailed: boolean): Skipped[] =>
  left.map(l => ({ name: l.name, reason: emailed && l.attachable ? `${l.reason}, so it is attached separately` : `${l.reason}, so it was left out` }));

async function runShare(src: ShareSource, v: SendRequest, access: StaffAccess): Promise<{ status: number; body: Record<string, any> }> {
  const shareId = crypto.randomUUID();
  const read = makeReader();
  const fileName = packFileName(src);
  const sender = await loadSender(access, src.unit);
  const storePack = (bytes: Buffer) => saveFile(packKey(shareId), bytes, "application/pdf", fileName);

  if (v.mode === "pdf") {
    const pack = await buildPack(src, v.selection, sender, read, true);
    const skipped = skippedOf(pack.left, false);
    await storePack(pack.bytes);
    await insertShare(shareId, src.unit.id, v, access, { subject: null, message: null, packFileName: fileName, hasPack: true, draftUrl: null, skipped });
    return { status: 200, body: { shareId, fileName, url: packUrl(shareId), pages: pack.pages, skipped } };
  }

  // An email: the attachments first, then the draft.
  const subject = v.subject || defaultSubject(src);
  const text = v.message || defaultMessage(src, v, sender.name);
  let pack: Awaited<ReturnType<typeof buildPack>> | null = null;
  let attachments: DraftAttachment[] = [];
  let skipped: Skipped[] = [];
  const attachRaw = async (f: SourceFile): Promise<boolean> => {
    const got = await read(f);
    if (!got) return false;
    // A scheme plan is named by its floor: give the file its extension.
    const ext = extOf(f.name) ? "" : `.${Object.keys(EXT_MIME).find(k => EXT_MIME[k] === got.mime) || "bin"}`;
    attachments.push({ name: `${f.name}${ext}`, contentType: got.mime, data: got.data });
    return true;
  };
  if (v.asSinglePdf) {
    pack = await buildPack(src, v.selection, sender, read, true);
    attachments.push({ name: fileName, contentType: "application/pdf", data: pack.bytes });
    for (const l of pack.left) if (l.attachable) await attachRaw(l.file);
    skipped = skippedOf(pack.left, true);
  } else {
    if (v.selection.details || v.selection.commercials.length) {
      const sheet = await buildPack(src, v.selection, sender, read, false);
      attachments.push({ name: fileName, contentType: "application/pdf", data: sheet.bytes });
    }
    for (const f of selectedFiles(v.selection)) {
      if (!(await attachRaw(f))) skipped.push({ name: f.name, reason: "The file is missing from storage, so it was left out" });
    }
  }
  attachments = attachmentNames(attachments);
  const total = attachments.reduce((n, a) => n + a.data.length, 0);
  if (total > SHARE_EMAIL_LIMIT) {
    return { status: 400, body: {
      code: "TOO_LARGE", totalBytes: total,
      message: `These attachments come to ${megabytes(total)} and an email takes up to ${megabytes(SHARE_EMAIL_LIMIT)}. Tick fewer photos or files, or ${v.asSinglePdf ? "download the PDF and share it another way" : "attach everything as one PDF"}.`,
    } };
  }

  let draft: { id: string; webLink: string | null } | null = null;
  let failure = "";
  try {
    if (!access.email) throw new Error("Your login has no email address");
    const token = await getAppToken();
    draft = await createOutlookDraft({ token, sender: access.email, to: { name: v.contact.name, email: v.contact.email! }, subject, html: htmlFromText(text), attachments });
  } catch (e: any) {
    failure = e?.message || "The draft could not be made";
    console.warn("[unit-share] Outlook draft failed:", failure);
  }

  if (!draft) {
    // No draft: the single PDF is still made and kept, so the sender can
    // download it and write the email by hand.
    if (!pack) pack = await buildPack(src, v.selection, sender, read, true);
    const packSkipped = skippedOf(pack.left, false);
    await storePack(pack.bytes);
    await insertShare(shareId, src.unit.id, v, access, { subject, message: text, packFileName: fileName, hasPack: true, draftUrl: null, skipped: packSkipped, draftFailed: true });
    return { status: 502, body: {
      code: "DRAFT_FAILED", message: "The Outlook draft could not be made. Download the PDF and open an email instead.", detail: failure,
      shareId, skipped: packSkipped,
      fallback: { url: packUrl(shareId), fileName, mailto: mailtoFor(v.contact.email, subject, text) },
    } };
  }

  if (pack) await storePack(pack.bytes);
  await insertShare(shareId, src.unit.id, v, access, { subject, message: text, packFileName: pack ? fileName : null, hasPack: !!pack, draftUrl: draft.webLink, skipped });
  return { status: 200, body: { shareId, draftWebLink: draft.webLink, attachments: attachments.map(a => ({ name: a.name, sizeBytes: a.data.length })), skipped } };
}

// For the unit delete: the unit's shares and their stored packs. Pass the
// transaction's client so both go with the unit or neither does.
export async function deleteUnitShares(unitId: string, db: Queryable = pool): Promise<number> {
  const r = await db.query(`DELETE FROM unit_shares WHERE unit_id = $1 RETURNING pack_storage_key`, [unitId]);
  const keys: string[] = r.rows.map((x: any) => x.pack_storage_key).filter(Boolean);
  if (keys.length) await db.query(`DELETE FROM file_storage WHERE storage_key = ANY($1::text[])`, [keys]);
  return r.rows.length;
}

export function setupUnitShareRoutes(app: Express) {
  // What can be ticked for this unit, who is sending, and what was shared before.
  app.get("/api/unit-share/:unitId/options", requireAuth, async (req, res) => {
    try {
      const gate = await staffGate(req, res, req.params.unitId);
      if (!gate) return;
      const { unit, access } = gate;
      const src = await loadSource(unit);
      res.json({
        unit: { id: unit.id, unitName: unitTitle(src), propertyName: src.propertyName, floor: unit.floor || null, sqft: unit.sqft ?? null, useClass: unit.use_class || null, availableDate: unit.available_date || null },
        details: src.details,
        commercials: src.commercials.map(c => ({ key: c.key, label: c.label, value: c.value })),
        files: {
          floorplans: src.files.floorplans.map(fileJson), brochures: src.files.brochures.map(fileJson),
          photos: src.files.photos.map(fileJson), other: src.files.other.map(fileJson),
        },
        schemePlans: src.schemePlans.map(p => ({ id: p.id, label: p.name, canMerge: p.canMerge, picked: p.picked, url: p.url, sizeBytes: p.sizeBytes })),
        schemeBrochures: src.schemeBrochures.map(b => ({ id: b.id, name: b.name, canMerge: b.canMerge, picked: b.picked, url: b.url, sizeBytes: b.sizeBytes })),
        history: await loadHistory(unit.id),
        sender: { name: access.name, email: access.email },
        emailLimitBytes: SHARE_EMAIL_LIMIT,
      });
    } catch (e: any) {
      console.error("[unit-share options]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to load what can be shared" });
    }
  });

  app.get("/api/unit-share/:unitId/history", requireAuth, async (req, res) => {
    try {
      const gate = await staffGate(req, res, req.params.unitId);
      if (!gate) return;
      res.json(await loadHistory(gate.unit.id));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load the sharing history" });
    }
  });

  // Make the pack, or the Outlook draft. One at a time for each person on a
  // unit, so a double press does not make two drafts.
  app.post("/api/unit-share/:unitId/send", requireAuth, async (req, res) => {
    let lock: PoolClient | null = null;
    let lockKey: string | null = null;
    try {
      const gate = await staffGate(req, res, req.params.unitId);
      if (!gate) return;
      const { unit, access } = gate;
      const src = await loadSource(unit);
      const parsed = await parseSend(req.body, src);
      if (!parsed.ok) return void res.status(400).json({ message: parsed.message });

      lock = await pool.connect();
      const key = `unit_share:${unit.id}:${access.userId}`;
      const got = (await lock.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [key])).rows[0]?.ok;
      if (!got) return void res.status(409).json({ message: "This is already being made. Give it a moment." });
      lockKey = key;

      const out = await runShare(src, parsed.value, access);
      res.status(out.status).json(out.body);
    } catch (e: any) {
      console.error("[unit-share send]", e?.message);
      if (!res.headersSent) res.status(500).json({ message: e?.message || "Failed to share the unit" });
    } finally {
      if (lock) {
        if (lockKey) await lock.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]).catch(() => undefined);
        lock.release();
      }
    }
  });

  // The stored pack, to download again.
  app.get("/api/unit-share/pack/:shareId/file", requireAuth, async (req, res) => {
    try {
      const shareId = String(req.params.shareId || "");
      const share = shareId.length <= 100 ? (await pool.query(`SELECT id, unit_id, pack_storage_key, pack_file_name FROM unit_shares WHERE id = $1`, [shareId])).rows[0] : null;
      const propertyId = share ? (await pool.query(`SELECT property_id FROM available_units WHERE id = $1`, [share.unit_id])).rows[0]?.property_id || null : null;
      const access = await briefAccess(req, propertyId);
      if (!access || !access.isStaff) return void res.status(403).json({ message: "Sharing a unit with a brand is for BGP staff" });
      const file = share?.pack_storage_key ? await getFile(share.pack_storage_key) : null;
      if (!file) return void res.status(404).json({ message: "That PDF is no longer stored. Make it again from the unit." });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(file.data.length));
      res.setHeader("Content-Disposition", contentDispositionFor(share.pack_file_name || "Unit details.pdf", req.query.view === "1" ? "inline" : "attachment"));
      res.setHeader("Cache-Control", "private, no-store");
      res.end(file.data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to open the PDF" });
    }
  });
}
