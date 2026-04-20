/**
 * Extra VOA SQLite queries used by the Goad-style retail plan.
 *
 * `lookupVoaByPostcode` in voa-sqlite.ts is exact-postcode only. For the
 * retail plan we need every rated unit in an outward code (e.g. "N1" or
 * "SW1A") so we can show the neighbours around the subject. Kept in a
 * separate file so voa-sqlite.ts stays a drop-in replacement for the old
 * Postgres-backed lookup.
 */
import { lookupVoaByPostcode, voaSqliteAvailable, type VoaLookupRow } from "./voa-sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

function candidatePath(): string | null {
  if (process.env.VOA_SQLITE_PATH && fs.existsSync(process.env.VOA_SQLITE_PATH)) return process.env.VOA_SQLITE_PATH;
  const candidates = [
    "/data/voa.sqlite",
    path.join(process.cwd(), "data", "voa-2023.sqlite"),
    path.join(process.cwd(), "data", "voa.sqlite"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

let handle: any = null;

function getHandle() {
  if (!voaSqliteAvailable()) return null;
  if (handle) return handle;
  const p = candidatePath();
  if (!p) return null;
  try {
    const Database = require("better-sqlite3");
    const h = new Database(p, { readonly: true, fileMustExist: true });
    h.pragma("query_only = ON");
    handle = h;
    return h;
  } catch {
    return null;
  }
}

/**
 * Query every VOA row whose postcode starts with the given outward code
 * (e.g. "N1", "SW1A"). Returns rows in the same shape as
 * `lookupVoaByPostcode`.
 */
export async function voaSqliteQueryByOutward(outward: string, limit = 600): Promise<VoaLookupRow[]> {
  const h = getHandle();
  if (!h) return [];
  const norm = (outward || "").toUpperCase().replace(/\s+/g, "");
  if (!norm) return [];
  try {
    const rows = h.prepare(
      `SELECT firm_name, number_or_name, street, town, postcode, description_text, rateable_value, effective_date, uarn, ba_ref
         FROM voa_ratings
        WHERE postcode_norm LIKE ?
        ORDER BY rateable_value IS NULL, rateable_value DESC
        LIMIT ?`,
    ).all(norm + "%", Math.min(Math.max(limit, 1), 2000)) as any[];
    return rows.map((r) => ({
      firmName: r.firm_name || null,
      address: [r.number_or_name, r.street, r.town].filter(Boolean).join(", "),
      postcode: r.postcode || "",
      description: r.description_text || null,
      rateableValue: r.rateable_value != null ? Number(r.rateable_value) : null,
      effectiveDate: r.effective_date || null,
      uarn: r.uarn || null,
      baRef: r.ba_ref || null,
    }));
  } catch {
    return [];
  }
}

// Re-export so callers can keep imports tight.
export { lookupVoaByPostcode, voaSqliteAvailable };
