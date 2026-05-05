/**
 * SQL tools for ChatBGP — consolidates ~50 narrow read/write tools into
 * three general-purpose primitives. Phase 1 of the AI consolidation plan.
 *
 *   sql_query     — read-only Postgres query, blocks dangerous patterns
 *   sql_write     — validated insert/update/delete with deny-list + audit log
 *   describe_schema — table/column introspection for Claude
 *
 * Old tools (search_crm, query_wip, create_deal, update_deal, etc.) remain
 * registered and functional — Claude is nudged via the system prompt to
 * prefer the new ones, but can fall back to specialised tools if needed.
 */

import { pool } from "./db";
import * as schema from "@shared/schema";

// ── Tables Claude is NOT allowed to read or write ─────────────────────────
// Sessions / token caches / file blobs / audit logs are off-limits even via
// sql_query. Anything containing secrets, OAuth tokens, file binaries, or
// internal AI plumbing.
const READ_DENY = new Set<string>([
  "msal_token_cache",       // OAuth tokens
  "sessions",               // session blobs
  "file_storage",           // raw file bytes — too large to ever return
  "ai_write_audit",         // the audit log itself
]);

// Tables Claude can read but NEVER write to. Identity, security, billing.
const WRITE_DENY = new Set<string>([
  ...READ_DENY,
  "users",                  // password hashes, role escalation risk
  "user_sessions",
  "api_keys",
  "deleted_sharepoint_images",
]);

// Read-only query — blocks any keyword that mutates state.
const FORBIDDEN_KEYWORDS = [
  /\binsert\s+into\b/i,
  /\bupdate\s+\w+\s+set\b/i,
  /\bdelete\s+from\b/i,
  /\bdrop\s+(table|database|schema|index|view)\b/i,
  /\balter\s+(table|database|schema)\b/i,
  /\btruncate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bcreate\s+(table|database|schema|user|role)\b/i,
  /\bcopy\s+\w+\s+(to|from)\b/i,
  /;\s*\w/,                 // multi-statement queries blocked
  /\bpg_/i,                 // pg_* system catalog access blocked
];

const MAX_QUERY_ROWS = 500;
const QUERY_TIMEOUT_MS = 15_000;

// ── Schema digest ──────────────────────────────────────────────────────────
// Built once at import time from the Drizzle schema. Returns a compact
// table-of-contents Claude can consult before writing a query.

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

function buildSchemaDigest(): TableInfo[] {
  const tables: TableInfo[] = [];
  for (const [exportName, value] of Object.entries(schema)) {
    if (!value || typeof value !== "object") continue;
    // Drizzle tables expose a Symbol-keyed name and a `_` introspection slot.
    const sym = Object.getOwnPropertySymbols(value).find(s => s.description?.includes("Name"));
    const tableName = sym ? (value as any)[sym] : null;
    if (!tableName || typeof tableName !== "string") continue;
    const columns = (value as any)[Symbol.for("drizzle:Columns")] as Record<string, any> | undefined;
    if (!columns) continue;
    const cols: ColumnInfo[] = [];
    for (const [colKey, colVal] of Object.entries(columns)) {
      if (!colVal || typeof colVal !== "object") continue;
      const c = colVal as any;
      cols.push({
        name: c.name || colKey,
        type: c.dataType || c.columnType || "unknown",
        nullable: !c.notNull,
      });
    }
    if (cols.length > 0) tables.push({ name: tableName, columns: cols });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

let _digestCache: TableInfo[] | null = null;
export function getSchemaDigest(): TableInfo[] {
  if (!_digestCache) _digestCache = buildSchemaDigest();
  return _digestCache;
}

// Compact one-line-per-table TOC suitable for the system prompt (~80 lines).
export function getSchemaToc(): string {
  const digest = getSchemaDigest();
  return digest
    .filter(t => !READ_DENY.has(t.name))
    .map(t => `- ${t.name} (${t.columns.length} cols)`)
    .join("\n");
}

// ── sql_query ──────────────────────────────────────────────────────────────

export async function executeSqlQuery(query: string): Promise<{
  success: boolean;
  rows?: any[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
}> {
  if (!query || typeof query !== "string") {
    return { success: false, error: "query (string) is required" };
  }

  const trimmed = query.trim().replace(/;$/, "");
  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    return { success: false, error: "Only SELECT and WITH queries are permitted via sql_query." };
  }

  for (const pattern of FORBIDDEN_KEYWORDS) {
    if (pattern.test(trimmed)) {
      return { success: false, error: `Query contains forbidden pattern: ${pattern.source}. Use sql_write for mutations.` };
    }
  }

  // Prevent reading deny-listed tables
  for (const denied of READ_DENY) {
    const pat = new RegExp(`\\b${denied}\\b`, "i");
    if (pat.test(trimmed)) {
      return { success: false, error: `Table "${denied}" is not accessible via sql_query.` };
    }
  }

  const limited = /\blimit\s+\d+/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${MAX_QUERY_ROWS}`;

  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
    await client.query(`SET LOCAL transaction_read_only = true`);
    const result = await client.query(limited);
    const rows = result.rows.slice(0, MAX_QUERY_ROWS);
    return {
      success: true,
      rows,
      rowCount: result.rowCount ?? rows.length,
      truncated: (result.rowCount ?? rows.length) > MAX_QUERY_ROWS,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Query failed" };
  } finally {
    client.release();
  }
}

// ── sql_write ──────────────────────────────────────────────────────────────

interface SqlWriteArgs {
  table: string;
  op: "insert" | "update" | "delete";
  data?: Record<string, any>;
  where?: Record<string, any>;
  returning?: boolean;
}

function isValidIdent(s: string): boolean {
  return typeof s === "string" && /^[a-z_][a-z0-9_]*$/i.test(s);
}

function buildWhereClause(where: Record<string, any>, startIdx: number): { sql: string; params: any[] } {
  const parts: string[] = [];
  const params: any[] = [];
  let idx = startIdx;
  for (const [key, val] of Object.entries(where)) {
    if (!isValidIdent(key)) throw new Error(`Invalid column name: ${key}`);
    if (val === null) {
      parts.push(`${key} IS NULL`);
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        parts.push("FALSE");
      } else {
        const placeholders = val.map(() => `$${idx++}`).join(", ");
        parts.push(`${key} IN (${placeholders})`);
        params.push(...val);
      }
    } else {
      parts.push(`${key} = $${idx++}`);
      params.push(val);
    }
  }
  return { sql: parts.join(" AND "), params };
}

async function ensureAuditTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_write_audit (
      id SERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      op TEXT NOT NULL,
      data JSONB,
      where_clause JSONB,
      affected_rows INTEGER,
      user_id TEXT,
      thread_id TEXT,
      success BOOLEAN NOT NULL,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
let _auditEnsured = false;

async function logAudit(entry: {
  tableName: string;
  op: string;
  data?: any;
  where?: any;
  affectedRows: number;
  userId?: string;
  threadId?: string;
  success: boolean;
  error?: string;
}) {
  try {
    if (!_auditEnsured) {
      await ensureAuditTable();
      _auditEnsured = true;
    }
    await pool.query(
      `INSERT INTO ai_write_audit (table_name, op, data, where_clause, affected_rows, user_id, thread_id, success, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.tableName,
        entry.op,
        entry.data ? JSON.stringify(entry.data) : null,
        entry.where ? JSON.stringify(entry.where) : null,
        entry.affectedRows,
        entry.userId || null,
        entry.threadId || null,
        entry.success,
        entry.error || null,
      ]
    );
  } catch (e: any) {
    console.warn("[sql-tools] audit log failed:", e?.message);
  }
}

export async function executeSqlWrite(
  args: SqlWriteArgs,
  ctx: { userId?: string; threadId?: string } = {}
): Promise<{ success: boolean; affected?: number; rows?: any[]; error?: string }> {
  const { table, op, data, where, returning = true } = args;

  if (!table || !isValidIdent(table)) {
    return { success: false, error: "Invalid or missing table name" };
  }
  if (WRITE_DENY.has(table)) {
    return { success: false, error: `Table "${table}" is not writable via sql_write.` };
  }
  if (!["insert", "update", "delete"].includes(op)) {
    return { success: false, error: 'op must be one of "insert", "update", "delete"' };
  }

  // Verify table exists in our Drizzle schema (prevents typos / SQL injection)
  const digest = getSchemaDigest();
  const tableInfo = digest.find(t => t.name === table);
  if (!tableInfo) {
    return { success: false, error: `Unknown table "${table}". Call describe_schema to see available tables.` };
  }
  const validCols = new Set(tableInfo.columns.map(c => c.name));

  try {
    let sql = "";
    let params: any[] = [];
    let affected = 0;
    let rows: any[] = [];

    if (op === "insert") {
      if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
        return { success: false, error: "insert requires `data`" };
      }
      const cols: string[] = [];
      const placeholders: string[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(data)) {
        if (!isValidIdent(key)) return { success: false, error: `Invalid column: ${key}` };
        if (!validCols.has(key)) return { success: false, error: `Column "${key}" does not exist in ${table}` };
        cols.push(key);
        placeholders.push(`$${idx++}`);
        params.push(val);
      }
      sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})${returning ? " RETURNING *" : ""}`;
    } else if (op === "update") {
      if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
        return { success: false, error: "update requires `data`" };
      }
      if (!where || typeof where !== "object" || Object.keys(where).length === 0) {
        return { success: false, error: "update requires `where` (refusing to update all rows)" };
      }
      const sets: string[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(data)) {
        if (!isValidIdent(key)) return { success: false, error: `Invalid column: ${key}` };
        if (!validCols.has(key)) return { success: false, error: `Column "${key}" does not exist in ${table}` };
        sets.push(`${key} = $${idx++}`);
        params.push(val);
      }
      const whereClause = buildWhereClause(where, idx);
      params.push(...whereClause.params);
      sql = `UPDATE ${table} SET ${sets.join(", ")} WHERE ${whereClause.sql}${returning ? " RETURNING *" : ""}`;
    } else {
      // delete
      if (!where || typeof where !== "object" || Object.keys(where).length === 0) {
        return { success: false, error: "delete requires `where` (refusing to delete all rows)" };
      }
      const whereClause = buildWhereClause(where, 1);
      params = whereClause.params;
      sql = `DELETE FROM ${table} WHERE ${whereClause.sql}${returning ? " RETURNING *" : ""}`;
    }

    const result = await pool.query(sql, params);
    affected = result.rowCount ?? 0;
    rows = returning ? result.rows : [];

    await logAudit({
      tableName: table,
      op,
      data,
      where,
      affectedRows: affected,
      userId: ctx.userId,
      threadId: ctx.threadId,
      success: true,
    });

    return { success: true, affected, rows };
  } catch (err: any) {
    await logAudit({
      tableName: table,
      op,
      data,
      where,
      affectedRows: 0,
      userId: ctx.userId,
      threadId: ctx.threadId,
      success: false,
      error: err?.message,
    });
    return { success: false, error: err?.message || "Write failed" };
  }
}

// ── describe_schema ────────────────────────────────────────────────────────

export function executeDescribeSchema(table?: string): {
  success: boolean;
  tables?: string[];
  table?: { name: string; columns: ColumnInfo[] };
  error?: string;
} {
  const digest = getSchemaDigest().filter(t => !READ_DENY.has(t.name));
  if (!table) {
    return { success: true, tables: digest.map(t => t.name) };
  }
  const found = digest.find(t => t.name === table);
  if (!found) return { success: false, error: `Table "${table}" not found.` };
  return { success: true, table: found };
}
