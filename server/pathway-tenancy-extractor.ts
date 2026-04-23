/**
 * Pathway tenancy-schedule extractor.
 *
 * During Stage 1, the SharePoint sweep returns a list of files (name/path/
 * webUrl) found by keyword search against the BGP drive. A subset of those
 * files are real tenancy schedules / rent rolls, usually Excel workbooks
 * from an LL or agent. This module finds them by filename, downloads the
 * bytes via Graph, and parses each sheet with a header-based column
 * mapper so we can cope with the wide variety of column layouts different
 * agents use.
 *
 * Output is merged into `stage1Payload.tenancy.units` so the pathway UI
 * shows every occupier instead of just the one the email extractor picked
 * up.
 *
 * Silent no-op when Microsoft auth is unavailable or no matching files are
 * present — Stage 1 is tolerant of partial results.
 */
import type { Request } from "express";

export interface ExtractedTenancyUnit {
  unitName: string;
  floor?: string;
  sqft?: number;
  tenantName?: string;
  passingRentPa?: number;
  useClass?: string;
  marketingStatus?: string;
  leaseStart?: string;
  leaseExpiry?: string;
}

export function looksLikeTenancySchedule(name: string, path?: string): boolean {
  const haystack = `${name || ""} ${path || ""}`.toLowerCase();
  if (!/\.(xlsx|xls|xlsm)(\?|$)/i.test(name || "")) return false;
  return (
    /tenancy\s*schedule/i.test(haystack) ||
    /rent\s*roll/i.test(haystack) ||
    /rent\s*schedule/i.test(haystack) ||
    /schedule\s*of\s*tenanc/i.test(haystack) ||
    /\bts\b/i.test(name || "") || // e.g. "BGP_Acme_TS.xlsx"
    /income\s*schedule/i.test(haystack)
  );
}

function norm(s: any): string {
  return String(s ?? "").trim();
}

function toNumber(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const cleaned = String(v).replace(/[,£$€\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned) return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function excelDateToIso(v: any): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    const d = new Date((v - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

// Fuzzy header matcher: returns the column index in `headerRow` whose
// normalised text contains any of the given keywords. Earlier keywords win.
function findCol(headerRow: any[], keywords: string[][]): number {
  const norms = headerRow.map((c) => norm(c).toLowerCase());
  for (const group of keywords) {
    for (let i = 0; i < norms.length; i++) {
      const h = norms[i];
      if (!h) continue;
      if (group.every((kw) => h.includes(kw))) return i;
    }
  }
  return -1;
}

/**
 * Look at the first ~20 rows and pick the row that looks most like a
 * header — it must contain a tenant/lessee/occupier column AND either
 * a unit or area column.
 */
function findHeaderRow(data: any[][]): { idx: number; headers: any[] } | null {
  const scanLimit = Math.min(20, data.length);
  for (let i = 0; i < scanLimit; i++) {
    const row = (data[i] || []).map((c) => norm(c).toLowerCase());
    if (row.length < 3) continue;
    const hasTenant = row.some((c) => /tenant|lessee|occupier/i.test(c));
    const hasAnchor = row.some((c) => /\bunit\b|\barea\b|sq\s*ft|sqft|nia|gia|rent/i.test(c));
    if (hasTenant && hasAnchor) return { idx: i, headers: data[i] };
  }
  return null;
}

export function extractTenancyUnitsFromXlsxBuffer(buffer: Buffer): ExtractedTenancyUnit[] {
  const XLSX = require("xlsx") as typeof import("xlsx");
  let wb: any;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    return [];
  }

  const out: ExtractedTenancyUnit[] = [];
  for (const sheetName of wb.SheetNames as string[]) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, blankrows: false }) as any[][];
    if (!data || data.length < 2) continue;

    const found = findHeaderRow(data);
    if (!found) continue;
    const { idx: hIdx, headers } = found;

    const cUnit = findCol(headers, [["unit", "no"], ["unit", "number"], ["unit"], ["suite"], ["demise"], ["premises"]]);
    const cFloor = findCol(headers, [["floor"], ["level"]]);
    const cTenant = findCol(headers, [["tenant"], ["lessee"], ["occupier"], ["name"]]);
    const cTrading = findCol(headers, [["trading"], ["brand"]]);
    const cSqft = findCol(headers, [["nia"], ["gia"], ["total", "sq"], ["area", "sq"], ["sq", "ft"], ["sqft"], ["area"]]);
    const cRent = findCol(headers, [["passing", "rent"], ["rent", "pa"], ["rent", "p.a"], ["current", "rent"], ["rent"]]);
    const cUse = findCol(headers, [["permitted", "use"], ["use", "class"], ["use"]]);
    const cStart = findCol(headers, [["lease", "start"], ["term", "start"], ["commencement"], ["start"]]);
    const cExpiry = findCol(headers, [["lease", "expiry"], ["expiry"], ["lease", "end"], ["termination"]]);

    if (cTenant === -1 && cUnit === -1) continue; // nothing to hang a row off

    let currentPremises = ""; // for schedules that group rows under premises headers
    for (let r = hIdx + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => c == null || c === "")) continue;

      // "Section header" rows (single text cell, nothing else) set premises context
      const nonEmpty = row.filter((c) => c != null && c !== "");
      if (nonEmpty.length === 1 && typeof nonEmpty[0] === "string") {
        currentPremises = norm(nonEmpty[0]);
        continue;
      }

      const unitRaw = cUnit >= 0 ? norm(row[cUnit]) : "";
      const tenantRaw = cTenant >= 0 ? norm(row[cTenant]) : "";
      const tradingRaw = cTrading >= 0 ? norm(row[cTrading]) : "";
      if (!unitRaw && !tenantRaw) continue;

      // Skip obvious total/footer rows
      if (/^total/i.test(tenantRaw) || /^total/i.test(unitRaw)) continue;
      if (/^sub\s*-?\s*total/i.test(tenantRaw) || /^sub\s*-?\s*total/i.test(unitRaw)) continue;

      const sqft = cSqft >= 0 ? toNumber(row[cSqft]) : undefined;
      const rent = cRent >= 0 ? toNumber(row[cRent]) : undefined;
      const useClass = cUse >= 0 ? norm(row[cUse]) || undefined : undefined;
      const floor = cFloor >= 0 ? norm(row[cFloor]) || undefined : undefined;
      const leaseStart = cStart >= 0 ? excelDateToIso(row[cStart]) : undefined;
      const leaseExpiry = cExpiry >= 0 ? excelDateToIso(row[cExpiry]) : undefined;

      const isVacant = /^vacant$/i.test(tenantRaw);
      const unitName = unitRaw || currentPremises || tenantRaw || `Unit ${out.length + 1}`;
      const tenantName = isVacant ? undefined : (tradingRaw || tenantRaw || undefined);

      out.push({
        unitName,
        floor,
        sqft,
        tenantName,
        passingRentPa: rent,
        useClass,
        marketingStatus: isVacant ? "Vacant" : "Let",
        leaseStart,
        leaseExpiry,
      });
    }

    // If this sheet already produced a usable set, don't merge duplicates from
    // other sheets (most workbooks have one real TS and several summary tabs).
    if (out.length >= 2) break;
  }

  // Dedupe by unitName + tenantName — the same occupier can appear on
  // summary tabs.
  const seen = new Set<string>();
  return out.filter((u) => {
    const key = `${(u.unitName || "").toLowerCase()}|${(u.tenantName || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fetches one SharePoint file's bytes using the BGP shared drive. Uses the
 * path-based Graph endpoint so we don't need the driveItem id.
 */
async function downloadSharePointFileByPath(
  driveId: string,
  fullPath: string,
  token: string,
): Promise<Buffer | null> {
  // Normalise: `/Documents/Islington Square/TS.xlsx` → `Documents/Islington%20Square/TS.xlsx`
  const trimmed = fullPath.replace(/^\/+/, "");
  const encoded = trimmed.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}:/content`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!resp.ok) {
      console.warn(`[pathway-tenancy-extractor] download failed ${resp.status} for ${fullPath}`);
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (err: any) {
    console.warn(`[pathway-tenancy-extractor] download error: ${err?.message}`);
    return null;
  }
}

/**
 * Given the Stage 1 sharepointHits list, find likely tenancy schedules,
 * download them, extract units, and return a merged list capped at 200
 * rows.
 */
export async function extractTenancyUnitsFromSharePointHits(
  hits: Array<{ name: string; path: string; webUrl?: string; type?: string }>,
  req: Request,
): Promise<ExtractedTenancyUnit[]> {
  if (!hits || hits.length === 0) return [];
  const candidates = hits.filter((h) => h.name && looksLikeTenancySchedule(h.name, h.path));
  if (candidates.length === 0) return [];

  const { getValidMsToken } = await import("./microsoft");
  const { getSharePointDriveId } = await import("./utils/sharepoint-operations");
  const token = await getValidMsToken(req);
  if (!token) return [];
  const driveId = await getSharePointDriveId(token);
  if (!driveId) return [];

  // Prefer most recently modified — newer schedules are more accurate.
  // Cap to 5 files per run to keep Stage 1 snappy.
  const ordered = candidates.slice(0, 5);
  const all: ExtractedTenancyUnit[] = [];
  for (const c of ordered) {
    const full = [c.path, c.name].filter(Boolean).join("/").replace(/\/+/g, "/");
    const buffer = await downloadSharePointFileByPath(driveId, full, token);
    if (!buffer) continue;
    try {
      const units = extractTenancyUnitsFromXlsxBuffer(buffer);
      if (units.length > 0) {
        console.log(`[pathway-tenancy-extractor] ${c.name} → ${units.length} unit(s)`);
        all.push(...units);
      }
    } catch (err: any) {
      console.warn(`[pathway-tenancy-extractor] parse failed for ${c.name}: ${err?.message}`);
    }
    if (all.length >= 200) break;
  }

  const seen = new Set<string>();
  return all.filter((u) => {
    const key = `${(u.unitName || "").toLowerCase()}|${(u.tenantName || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
}
