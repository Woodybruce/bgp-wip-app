import type { EvidencePlanShare, EvidencePlanShareSettings, ExpectedEvidencePlanShare, SharedEvidenceEntry, SharedEvidenceUnit, SharedEvidenceUnitFacts } from "../shared/evidence-plan-sharing";
import { resolveEvidenceScheduleMatch } from "./evidence-plan-schedule";

export const EVIDENCE_SHARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EVIDENCE_SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class EvidencePlanShareError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validateEvidencePlanShareSettings(body: unknown): EvidencePlanShareSettings {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new EvidencePlanShareError(400, "Share settings are required");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["label", "entryIds", "documentEntryIds", "includeUnitFacts", "expectedShare"].includes(key))) {
    throw new EvidencePlanShareError(400, "Unknown share setting");
  }
  if (typeof value.label !== "string" || value.label.length > 160) throw new EvidencePlanShareError(400, "Label must be text of at most 160 characters");
  if (typeof value.includeUnitFacts !== "boolean") throw new EvidencePlanShareError(400, "Choose whether to include unit facts");
  const ids = (key: string): string[] => {
    const list = value[key];
    if (!Array.isArray(list) || list.length > 10000 || list.some(id => typeof id !== "string" || !EVIDENCE_SHARE_UUID.test(id))) {
      throw new EvidencePlanShareError(400, `${key} must contain valid evidence IDs`);
    }
    return [...new Set(list.map(id => id.toLowerCase()))];
  };
  const entryIds = ids("entryIds"), documentEntryIds = ids("documentEntryIds");
  if (documentEntryIds.some(id => !entryIds.includes(id))) throw new EvidencePlanShareError(400, "Documents must belong to selected evidence");
  return { label: value.label.trim(), entryIds, documentEntryIds, includeUnitFacts: value.includeUnitFacts };
}

export const shareText = (value: unknown): string | null => typeof value === "string" ? value : null;
export function shareNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function shareDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? value.slice(0, 10) : null;
}
export function shareTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function presentEvidencePlanShare(row: any): EvidencePlanShare {
  return { id: row.id, label: row.label, token: row.token, entryIds: row.entry_ids,
    documentEntryIds: row.document_entry_ids, includeUnitFacts: row.include_unit_facts,
    createdAt: shareTimestamp(row.created_at)!, updatedAt: shareTimestamp(row.updated_at)!, revokedAt: shareTimestamp(row.revoked_at) };
}

export function validateExpectedEvidencePlanShare(body: unknown): ExpectedEvidencePlanShare {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("expectedShare" in body)) {
    throw new EvidencePlanShareError(400, "Reload the current share before changing it");
  }
  const expected = (body as Record<string, unknown>).expectedShare;
  if (expected === null) return null;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw new EvidencePlanShareError(400, "Invalid expected share");
  const value = expected as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "id" && key !== "updatedAt") || typeof value.id !== "string" || !EVIDENCE_SHARE_UUID.test(value.id)
    || typeof value.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt)
    || shareTimestamp(value.updatedAt) !== value.updatedAt) throw new EvidencePlanShareError(400, "Invalid expected share");
  return { id: value.id.toLowerCase(), updatedAt: value.updatedAt };
}

export function assertExpectedEvidencePlanShare(current: any | undefined, expected: ExpectedEvidencePlanShare): void {
  const matches = current ? expected !== null && expected.id === current.id && expected.updatedAt === shareTimestamp(current.updated_at) : expected === null;
  if (!matches) throw new EvidencePlanShareError(409, "Sharing changed in another window. Reload before saving.");
}

function point(value: any) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1
    ? { x: Number(value.x), y: Number(value.y) } : null;
}

export function presentSharedEvidenceUnit(unit: any, includeFacts: boolean, scheduleRows: any[] = [], propertyId?: string | null): SharedEvidenceUnit {
  const matched = resolveEvidenceScheduleMatch(unit, scheduleRows, propertyId ? { propertyId } : {}).row;
  // A matched canonical blank stays blank, and zero stays zero. Do not revive
  // old imported facts after a schedule field has been cleared.
  const source = matched ? { lease_start: matched.lease_start, outside_lt_act: matched.outside_lt_act,
    lease_expiry: matched.lease_expiry, break_date: matched.break_date, review_date: matched.next_review_date,
    erv: matched.erv_pa, passing_rent: matched.passing_rent_pa, sqft: matched.nia_sqft ?? matched.gia_sqft ?? null } : unit;
  const facts: SharedEvidenceUnitFacts = { leaseStart: shareDate(source.lease_start), leaseExpiry: shareDate(source.lease_expiry),
    breakDate: shareDate(source.break_date), reviewDate: shareDate(source.review_date), outsideLtAct: shareText(source.outside_lt_act),
    erv: shareNumber(source.erv), passingRent: shareNumber(source.passing_rent), sqft: shareNumber(source.sqft) };
  const polygon = Array.isArray(unit.polygon) ? unit.polygon.map(point) : null;
  return { id: unit.id, levelId: shareText(unit.level_id), unitRef: shareText(unit.unit_ref) ?? "",
    tenantName: shareText(matched ? matched.trading_name || matched.tenant_name : unit.tenant_name),
    polygon: polygon && polygon.length >= 3 && polygon.every((p: { x: number; y: number } | null): p is { x: number; y: number } => p !== null) ? polygon : null, dot: point(unit.dot),
    ...(includeFacts ? { facts } : {}) };
}

export function presentSharedEvidenceEntry(entry: any, documentUrl?: string): SharedEvidenceEntry {
  return { id: entry.id, unitId: shareText(entry.unit_id), unitRef: shareText(entry.unit_ref), tenant: shareText(entry.tenant),
    transactionType: shareText(entry.transaction_type), transactionDate: shareDate(entry.transaction_date),
    sizeSqft: shareNumber(entry.size_sqft), zoneA: shareNumber(entry.zone_a), netZoneA: shareNumber(entry.net_zone_a),
    itza: shareNumber(entry.itza), headlineRent: shareNumber(entry.headline_rent), netEffective: shareNumber(entry.net_effective),
    term: shareText(entry.term), concession: shareText(entry.concession), ...(documentUrl ? { documentUrl } : {}) };
}

const imageExtensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const documentExtensions: Record<string, string> = { ...imageExtensions, "application/pdf": "pdf",
  "application/msword": "doc", "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "text/plain": "txt", "text/csv": "csv" };

/** Never inline active formats such as HTML/SVG, even if storage has a misleading extension. */
export function sharedFileType(file: { contentType: string; data: Buffer }, imageOnly: boolean): { mime: string; extension: string } | null {
  const mime = file.contentType.split(";", 1)[0].trim().toLowerCase();
  const extension = (imageOnly ? imageExtensions : documentExtensions)[mime];
  if (!extension) return null;
  const data = file.data;
  const signatureValid = mime === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg" ? data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
    : mime === "image/webp" ? data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP"
    : mime === "image/gif" ? /^GIF8[79]a$/.test(data.subarray(0, 6).toString())
    : mime === "application/pdf" ? data.subarray(0, 5).toString() === "%PDF-"
    : mime.includes("openxmlformats") ? data[0] === 80 && data[1] === 75 && data[2] === 3 && data[3] === 4
    : mime === "application/msword" || mime === "application/vnd.ms-excel" ? data.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))
    : true;
  return signatureValid ? { mime, extension } : null;
}
