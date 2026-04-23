/**
 * Read-only SQLite reader for the VOA rating list.
 *
 * Replaces the Postgres-backed voa_ratings table. The SQLite file is built
 * offline by scripts/build-voa-sqlite.ts and dropped onto a Railway volume
 * (or set via VOA_SQLITE_PATH).
 *
 * Lookup order for the file:
 *   1. process.env.VOA_SQLITE_PATH
 *   2. /data/voa.sqlite          (Railway volume)
 *   3. ./data/voa-2023.sqlite    (dev — repo-local)
 *   4. ./data/voa.sqlite
 *
 * If no file is found at boot, every reader returns empty arrays and logs
 * a single warning. The app keeps working — pathway/property-lookup just
 * get no VOA rows.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type DatabaseType from "better-sqlite3";

let db: DatabaseType.Database | null = null;
let triedOpen = false;
let activePath: string | null = null;

function candidatePaths(): string[] {
  const list: string[] = [];
  if (process.env.VOA_SQLITE_PATH) list.push(process.env.VOA_SQLITE_PATH);
  list.push("/data/voa.sqlite");
  list.push(path.join(process.cwd(), "data", "voa-2023.sqlite"));
  list.push(path.join(process.cwd(), "data", "voa.sqlite"));
  return list;
}

function openIfPresent(): DatabaseType.Database | null {
  if (db) return db;
  if (triedOpen) return null;
  triedOpen = true;
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) {
        // Lazy require so the server can boot even if better-sqlite3 build failed
        const Database = require("better-sqlite3") as typeof DatabaseType;
        const opened = new Database(p, { readonly: true, fileMustExist: true });
        opened.pragma("query_only = ON");
        opened.pragma("cache_size = -50000"); // 50 MB cache for reads
        const meta: any = opened.prepare("SELECT value FROM meta WHERE key = 'row_count'").get();
        const rows = meta?.value || "?";
        console.log(`[voa-sqlite] Opened ${p} (${rows} rows)`);
        db = opened;
        activePath = p;
        return db;
      }
    } catch (err: any) {
      console.warn(`[voa-sqlite] Could not open ${p}: ${err?.message || err}`);
    }
  }
  console.warn("[voa-sqlite] No VOA SQLite file found. Tried: " + candidatePaths().join(", "));
  console.warn("[voa-sqlite] VOA lookups will return empty. Build with: tsx scripts/build-voa-sqlite.ts");
  return null;
}

/** Expose whether the SQLite backend is available. Callers can fall back. */
export function voaSqliteAvailable(): boolean {
  return openIfPresent() !== null;
}

export function voaSqliteInfo(): { available: boolean; path: string | null; rowCount: number; builtAt: string | null; areas: string | null; listYear: string | null } {
  const h = openIfPresent();
  if (!h) return { available: false, path: null, rowCount: 0, builtAt: null, areas: null, listYear: null };
  const meta: any = Object.fromEntries((h.prepare("SELECT key, value FROM meta").all() as any[]).map((r) => [r.key, r.value]));
  return {
    available: true,
    path: activePath,
    rowCount: Number(meta.row_count || 0),
    builtAt: meta.built_at || null,
    areas: meta.areas || null,
    listYear: meta.list_year || null,
  };
}

/** Normalise to the app's display format: "SW1A 2AA". */
function formatPostcode(pc: string): string {
  const n = pc.replace(/\s+/g, "").toUpperCase();
  return n.length > 3 ? n.slice(0, -3) + " " + n.slice(-3) : n;
}

function normalisePostcode(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

// ---------------------------------------------------------------------------
// Pathway / property-lookup entry point
// ---------------------------------------------------------------------------

export interface VoaLookupRow {
  firmName: string | null;
  address: string;
  postcode: string;
  description: string | null;
  rateableValue: number | null;
  effectiveDate: string | null;
  uarn: string | null;
  baRef: string | null;
}

/**
 * Shape-compatible with what property-lookup.ts's lookupVOA() used to return.
 * Looks up by postcode (normalised equality) and optionally filters by street
 * substring. Ordered by rateable value desc so the most interesting units
 * surface first.
 */
export function lookupVoaByPostcode(postcode: string, street?: string, limit = 30): VoaLookupRow[] {
  const h = openIfPresent();
  if (!h) return [];
  const norm = normalisePostcode(postcode);
  if (!norm) return [];
  let sql = `
    SELECT firm_name, number_or_name, street, town, postcode, description_text, rateable_value, effective_date, uarn, ba_ref
      FROM voa_ratings
     WHERE postcode_norm = ?
  `;
  const params: any[] = [norm];
  if (street && street.trim()) {
    sql += ` AND LOWER(street) LIKE ?`;
    params.push(`%${street.toLowerCase().trim()}%`);
  }
  sql += ` ORDER BY rateable_value IS NULL, rateable_value DESC LIMIT ?`;
  params.push(Math.min(Math.max(limit, 1), 200));
  try {
    const rows = h.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      firmName: r.firm_name || null,
      address: [r.number_or_name, r.street, r.town].filter(Boolean).join(", "),
      postcode: r.postcode || formatPostcode(norm),
      description: r.description_text || null,
      rateableValue: r.rateable_value != null ? Number(r.rateable_value) : null,
      effectiveDate: r.effective_date || null,
      uarn: r.uarn || null,
      baRef: r.ba_ref || null,
    }));
  } catch (err: any) {
    console.error("[voa-sqlite] lookupVoaByPostcode error:", err?.message || err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Routes: status / ratings search / stats / description codes
// ---------------------------------------------------------------------------

export function voaStatus(): { totalRows: number; byBaCode: Array<{ baCode: string; listYear: string; rows: number }> } {
  const h = openIfPresent();
  if (!h) return { totalRows: 0, byBaCode: [] };
  const total = (h.prepare("SELECT COUNT(*) AS c FROM voa_ratings").get() as any).c as number;
  const rows = h.prepare(
    "SELECT ba_code AS baCode, list_year AS listYear, COUNT(*) AS rows FROM voa_ratings GROUP BY ba_code, list_year ORDER BY rows DESC"
  ).all() as any[];
  return {
    totalRows: Number(total || 0),
    byBaCode: rows.map((r) => ({ baCode: String(r.baCode), listYear: String(r.listYear || ""), rows: Number(r.rows) })),
  };
}

export interface VoaSearchFilters {
  search?: string;
  baCode?: string;
  descriptionCode?: string;
  postcode?: string;
  minRv?: number;
  maxRv?: number;
  sortBy?: "rateable_value" | "postcode" | "street" | "firm_name";
  sortDir?: "asc" | "desc";
  page?: number;
  limit?: number;
}

const SORT_COLS: Record<string, string> = {
  rateable_value: "rateable_value",
  postcode: "postcode",
  street: "street",
  firm_name: "firm_name",
};

export function searchVoaRatings(f: VoaSearchFilters): { items: any[]; total: number; page: number; limit: number } {
  const h = openIfPresent();
  if (!h) return { items: [], total: 0, page: 1, limit: 50 };
  const where: string[] = [];
  const params: any[] = [];
  if (f.search?.trim()) {
    // Normalise "18 - 22 haymarket" → "18-22 haymarket", split into tokens, and
    // require every token to match somewhere. This handles the fact that
    // number_or_name ("18-22") and street ("HAYMARKET") are stored in separate
    // columns — a single LIKE would miss it.
    const normalised = f.search
      .trim()
      .toLowerCase()
      .replace(/\s*-\s*/g, "-")
      .replace(/,/g, " ");
    const tokens = normalised.split(/\s+/).filter(t => t.length >= 2);
    for (const tok of tokens) {
      const p = `%${tok}%`;
      where.push(`(LOWER(firm_name) LIKE ? OR LOWER(street) LIKE ? OR LOWER(number_or_name) LIKE ? OR LOWER(town) LIKE ? OR LOWER(postcode) LIKE ?)`);
      params.push(p, p, p, p, p);
    }
  }
  if (f.baCode?.trim()) {
    where.push("ba_code = ?");
    params.push(f.baCode.trim());
  }
  if (f.descriptionCode?.trim()) {
    where.push("description_code = ?");
    params.push(f.descriptionCode.trim());
  }
  if (f.postcode?.trim()) {
    where.push("postcode_norm = ?");
    params.push(normalisePostcode(f.postcode));
  }
  if (typeof f.minRv === "number") {
    where.push("rateable_value >= ?");
    params.push(f.minRv);
  }
  if (typeof f.maxRv === "number") {
    where.push("rateable_value <= ?");
    params.push(f.maxRv);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol = SORT_COLS[f.sortBy || "rateable_value"] || "rateable_value";
  const sortDir = f.sortDir === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, f.page || 1);
  const limit = Math.min(Math.max(f.limit || 50, 1), 500);
  const offset = (page - 1) * limit;

  const totalRow = h.prepare(`SELECT COUNT(*) AS c FROM voa_ratings ${whereSql}`).get(...params) as any;
  const items = h.prepare(
    `SELECT uarn, ba_code AS baCode, ba_ref AS baRef, description_code AS descriptionCode, description_text AS descriptionText,
            firm_name AS firmName, number_or_name AS numberOrName, street, town, locality, county,
            postcode, rateable_value AS rateableValue, effective_date AS effectiveDate, list_year AS listYear
       FROM voa_ratings
       ${whereSql}
       ORDER BY ${sortCol} ${sortDir === "DESC" ? "IS NULL, " + sortCol + " DESC" : "ASC"}
       LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];
  return { items, total: Number(totalRow?.c || 0), page, limit };
}

export function voaStats(): { byAuthority: any[]; byType: any[] } {
  const h = openIfPresent();
  if (!h) return { byAuthority: [], byType: [] };
  const byAuthority = h.prepare(
    `SELECT ba_code AS baCode, COUNT(*) AS count, AVG(rateable_value) AS avgRv, SUM(rateable_value) AS totalRv,
            MIN(rateable_value) AS minRv, MAX(rateable_value) AS maxRv
       FROM voa_ratings
      GROUP BY ba_code
      ORDER BY count DESC`
  ).all() as any[];
  const byType = h.prepare(
    `SELECT description_code AS descriptionCode, description_text AS descriptionText, COUNT(*) AS count, AVG(rateable_value) AS avgRv
       FROM voa_ratings
      WHERE description_code IS NOT NULL AND description_code <> ''
      GROUP BY description_code, description_text
      ORDER BY count DESC`
  ).all() as any[];
  return { byAuthority, byType };
}

export function voaDescriptionCodes(): Array<{ code: string; text: string; count: number }> {
  const h = openIfPresent();
  if (!h) return [];
  return (h.prepare(
    `SELECT description_code AS code, description_text AS text, COUNT(*) AS count
       FROM voa_ratings
      WHERE description_code IS NOT NULL AND description_code <> ''
      GROUP BY description_code, description_text
      ORDER BY count DESC`
  ).all() as any[]).map((r) => ({ code: String(r.code), text: String(r.text || ""), count: Number(r.count) }));
}
