/**
 * Generic CRM Read / Update / Bulk-Update
 * =======================================
 *
 * One pair of functions that lets ChatBGP (and any future caller) read or
 * update any record on a whitelisted CRM table — with field validation
 * against the live schema.
 *
 * Replaces the dozen narrow per-feature ChatBGP tools (`update_deal`,
 * `update_landlord`, `update_contact`, ...) with three:
 *
 *   readRecord(table, id)
 *   updateRecord(table, id, fields)
 *   bulkUpdateRecords(table, filter, fields)
 *
 * Adding a field to the schema = ChatBGP can update it the next minute.
 * No more "the tool doesn't expose that field, please raise a feature
 * request" dead ends.
 *
 * Safety:
 *   - Only whitelisted tables are reachable (ALLOWED_TABLES below).
 *   - Field names are validated against information_schema before any
 *     SQL is built — no field injection possible, no UPDATEs to columns
 *     that don't exist.
 *   - Bulk updates cap at 500 rows per call.
 *   - All writes are audit-logged where the table has a paired audit
 *     table; otherwise we stamp updated_at.
 */
import { pool } from "./db";

export type AllowedTable =
  | "crm_deals"
  | "crm_companies"
  | "crm_contacts"
  | "crm_properties"
  | "leasing_schedule_units"
  | "crm_lease_events"
  | "crm_comps"
  | "crm_requirements_leasing"
  | "lease_events";

export const ALLOWED_TABLES: AllowedTable[] = [
  "crm_deals",
  "crm_companies",
  "crm_contacts",
  "crm_properties",
  "leasing_schedule_units",
  "crm_lease_events",
  "crm_comps",
  "crm_requirements_leasing",
  "lease_events",
];

const AUDIT_TABLES: Partial<Record<AllowedTable, string>> = {
  leasing_schedule_units: "leasing_schedule_audit",
};

const BULK_LIMIT = 500;

interface ColumnInfo { name: string; type: string; nullable: boolean; }
const SCHEMA_CACHE = new Map<string, ColumnInfo[]>();

async function getColumns(table: AllowedTable): Promise<ColumnInfo[]> {
  const cached = SCHEMA_CACHE.get(table);
  if (cached) return cached;
  const r = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const cols = r.rows.map((row) => ({
    name: row.column_name as string,
    type: row.data_type as string,
    nullable: row.is_nullable === "YES",
  }));
  SCHEMA_CACHE.set(table, cols);
  return cols;
}

function assertAllowed(table: string): asserts table is AllowedTable {
  if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
    throw new Error(`Table not allowed: ${table}. Allowed: ${ALLOWED_TABLES.join(", ")}`);
  }
}

async function validateFields(table: AllowedTable, fields: Record<string, any>): Promise<{
  valid: Record<string, any>;
  unknown: string[];
}> {
  const cols = await getColumns(table);
  const colSet = new Set(cols.map((c) => c.name));
  const valid: Record<string, any> = {};
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id" || k === "created_at" || k === "updated_at") continue;
    if (!colSet.has(k)) { unknown.push(k); continue; }
    valid[k] = v;
  }
  return { valid, unknown };
}

// ─── READ ────────────────────────────────────────────────────────────────

export async function readRecord(table: string, id: string): Promise<any | null> {
  assertAllowed(table);
  const r = await pool.query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  return r.rows[0] || null;
}

export async function listRecords(args: {
  table: string;
  filters?: Record<string, any>;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  assertAllowed(args.table);
  const cols = await getColumns(args.table);
  const colSet = new Set(cols.map((c) => c.name));
  const where: string[] = [];
  const values: any[] = [];
  if (args.filters) {
    for (const [k, v] of Object.entries(args.filters)) {
      if (!colSet.has(k)) continue;
      values.push(v);
      where.push(`${k} = $${values.length}`);
    }
  }
  const limit = Math.min(args.limit || 50, 500);
  const offset = args.offset || 0;
  const sql = `SELECT * FROM ${args.table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} LIMIT ${limit} OFFSET ${offset}`;
  const r = await pool.query(sql, values);
  return r.rows;
}

// ─── UPDATE ──────────────────────────────────────────────────────────────

export interface UpdateResult {
  updated: boolean;
  changedFields: string[];
  unknownFields: string[];
}

export async function updateRecord(args: {
  table: string;
  id: string;
  fields: Record<string, any>;
  userId?: string;
  userName?: string;
}): Promise<UpdateResult> {
  assertAllowed(args.table);
  const { valid, unknown } = await validateFields(args.table as AllowedTable, args.fields);
  const fieldNames = Object.keys(valid);
  if (fieldNames.length === 0) {
    return { updated: false, changedFields: [], unknownFields: unknown };
  }

  // Read existing for audit + change detection
  const existing = await pool.query(`SELECT * FROM ${args.table} WHERE id = $1 LIMIT 1`, [args.id]);
  if (!existing.rows[0]) throw new Error(`Record not found: ${args.table}/${args.id}`);
  const existingRow = existing.rows[0];

  const changed: string[] = [];
  for (const k of fieldNames) {
    const oldVal = existingRow[k];
    const newVal = valid[k];
    if (normalise(oldVal) !== normalise(newVal)) changed.push(k);
  }
  if (changed.length === 0) {
    return { updated: false, changedFields: [], unknownFields: unknown };
  }

  const setClause = changed.map((c, i) => `${c} = $${i + 1}`).join(", ");
  const values = changed.map((c) => valid[c]);
  values.push(args.id);
  await pool.query(
    `UPDATE ${args.table} SET ${setClause}, updated_at = NOW() WHERE id = $${values.length}`,
    values
  );

  // Audit
  const auditTable = AUDIT_TABLES[args.table as AllowedTable];
  if (auditTable && auditTable === "leasing_schedule_audit") {
    for (const field of changed) {
      try {
        await pool.query(
          `INSERT INTO leasing_schedule_audit (unit_id, property_id, user_id, user_name, action, field_name, old_value, new_value)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            args.id,
            existingRow.property_id || "",
            args.userId || "chatbgp",
            args.userName || "ChatBGP",
            "field_update",
            field,
            String(existingRow[field] ?? ""),
            String(valid[field] ?? ""),
          ]
        );
      } catch (err: any) {
        console.warn(`[generic-crm audit] ${err?.message}`);
      }
    }
  }

  return { updated: true, changedFields: changed, unknownFields: unknown };
}

// ─── BULK UPDATE ─────────────────────────────────────────────────────────

export interface BulkUpdateResult {
  matched: number;
  updated: number;
  unknownFields: string[];
}

export async function bulkUpdateRecords(args: {
  table: string;
  filter: Record<string, any>;
  fields: Record<string, any>;
  userId?: string;
  userName?: string;
}): Promise<BulkUpdateResult> {
  assertAllowed(args.table);
  const { valid: validFields, unknown: unknownFields } = await validateFields(args.table as AllowedTable, args.fields);
  if (Object.keys(validFields).length === 0) {
    return { matched: 0, updated: 0, unknownFields };
  }

  const cols = await getColumns(args.table as AllowedTable);
  const colSet = new Set(cols.map((c) => c.name));
  const filterEntries = Object.entries(args.filter).filter(([k]) => colSet.has(k));
  if (filterEntries.length === 0) {
    throw new Error("Bulk update requires at least one valid filter field — refusing to update entire table");
  }

  // First, count matches and cap.
  const whereClauses = filterEntries.map(([k], i) => `${k} = $${i + 1}`).join(" AND ");
  const filterValues = filterEntries.map(([, v]) => v);
  const matchRes = await pool.query(`SELECT id FROM ${args.table} WHERE ${whereClauses} LIMIT ${BULK_LIMIT + 1}`, filterValues);
  const matchedIds: string[] = matchRes.rows.map((r) => r.id);
  if (matchedIds.length > BULK_LIMIT) {
    throw new Error(`Bulk update would affect more than ${BULK_LIMIT} records (got ${matchedIds.length}). Narrow the filter.`);
  }

  // Apply per-record so audit + change detection works uniformly.
  let updated = 0;
  for (const id of matchedIds) {
    const r = await updateRecord({
      table: args.table,
      id,
      fields: validFields,
      userId: args.userId,
      userName: args.userName,
    });
    if (r.updated) updated++;
  }
  return { matched: matchedIds.length, updated, unknownFields };
}

function normalise(v: any): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalise).join(",");
  return String(v).trim();
}

export function listAllowedTables(): AllowedTable[] {
  return [...ALLOWED_TABLES];
}
