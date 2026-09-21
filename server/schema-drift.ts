/**
 * Schema drift guard.
 *
 * Production has never run drizzle-kit migrations: the deploy build is
 * `npm run build` with no --migrate-only flag, so the SQL-file migrations in
 * migrations/ were only ever applied by hand, and the live schema is really
 * the sum of the hand-maintained MIGRATIONS array in server/index.ts. On
 * 2026-09-21 that bit: migration 0043 (crm_properties.country +
 * geocode_status) was in the Drizzle schema and in a migration file but not
 * in the boot array, so `get_property_planning` died with
 * `column "country" does not exist`.
 *
 * Two safety nets, both idempotent and run at boot:
 *  1. applyIdempotentSqlMigrations — the additive, IF-NOT-EXISTS SQL files
 *     (0041+) are applied from disk if present.
 *  2. healSchemaDrift — every pgTable in shared/schema.ts is compared with
 *     information_schema; any column the code expects but the DB lacks is
 *     added as `ALTER TABLE … ADD COLUMN IF NOT EXISTS <name> <type>`
 *     (nullable, with a literal default when the schema has one). Tables
 *     that don't exist are left alone — CREATE TABLE stays with the
 *     migrations/boot array, which know the constraints.
 *
 * GET /api/admin/schema-drift lists what's missing without changing anything.
 */
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "node:path";
import type { Pool } from "pg";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";

/** Additive, IF-NOT-EXISTS-only SQL migrations that are safe to re-apply on
 *  every boot. Append new files here when they follow that rule. Anything
 *  with data backfills or renames stays out (run those deliberately). */
export const IDEMPOTENT_SQL_MIGRATIONS = [
  "0041_company_property_relationships.sql",
  "0042_entity_graph_indexes.sql",
  "0043_property_country.sql",
  "0044_reconciliation.sql",
  "0045_account_folder_map.sql",
  "0046_entity_kyc.sql",
  "0047_deal_contracting_entities_shadow.sql",
];

export async function applyIdempotentSqlMigrations(pool: Pool, dir = path.join(process.cwd(), "migrations")): Promise<{ applied: string[]; failed: Array<{ file: string; error: string }>; missing: string[] }> {
  const applied: string[] = []; const failed: Array<{ file: string; error: string }> = []; const missing: string[] = [];
  for (const file of IDEMPOTENT_SQL_MIGRATIONS) {
    const full = path.join(dir, file);
    if (!existsSync(full)) { missing.push(file); continue; }
    try {
      await pool.query(await readFile(full, "utf8"));
      applied.push(file);
    } catch (e: any) {
      failed.push({ file, error: e?.message || String(e) });
    }
  }
  return { applied, failed, missing };
}

export interface MissingColumn {
  table: string;
  column: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
  /** SQL literal for the default when it is a plain string/number/boolean. */
  defaultSql: string | null;
}

function literalDefault(col: any): string | null {
  if (!col?.hasDefault) return null;
  const d = col.default;
  if (typeof d === "string") return `'${d.replace(/'/g, "''")}'`;
  if (typeof d === "number" || typeof d === "boolean") return String(d);
  return null; // SQL expressions (defaultRandom, now()) — leave nullable, no default
}

function schemaTables(): PgTable[] {
  return Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable));
}

/** Columns the Drizzle schema expects that the live DB does not have. */
export async function listSchemaDrift(pool: Pool): Promise<{ missing: MissingColumn[]; missingTables: string[] }> {
  const missing: MissingColumn[] = []; const missingTables: string[] = [];
  const { rows: liveCols } = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
  );
  const live = new Map<string, Set<string>>();
  for (const r of liveCols) {
    if (!live.has(r.table_name)) live.set(r.table_name, new Set());
    live.get(r.table_name)!.add(r.column_name);
  }
  for (const table of schemaTables()) {
    const cfg = getTableConfig(table);
    const have = live.get(cfg.name);
    if (!have) { missingTables.push(cfg.name); continue; }
    for (const col of cfg.columns as any[]) {
      if (have.has(col.name)) continue;
      missing.push({
        table: cfg.name,
        column: col.name,
        type: col.getSQLType(),
        notNull: !!col.notNull,
        hasDefault: !!col.hasDefault,
        defaultSql: literalDefault(col),
      });
    }
  }
  return { missing, missingTables };
}

/** Adds every missing column (nullable). Each ALTER runs alone so one bad
 *  type (e.g. an enum that doesn't exist yet) never blocks the rest. */
export async function healSchemaDrift(pool: Pool): Promise<{ added: MissingColumn[]; failed: Array<MissingColumn & { error: string }>; missingTables: string[] }> {
  const { missing, missingTables } = await listSchemaDrift(pool);
  const added: MissingColumn[] = []; const failed: Array<MissingColumn & { error: string }> = [];
  for (const m of missing) {
    const def = m.defaultSql ? ` DEFAULT ${m.defaultSql}` : "";
    const sql = `ALTER TABLE "${m.table}" ADD COLUMN IF NOT EXISTS "${m.column}" ${m.type}${def}`;
    try {
      await pool.query(sql);
      added.push(m);
    } catch (e: any) {
      failed.push({ ...m, error: e?.message || String(e) });
    }
  }
  return { added, failed, missingTables };
}

/** Boot entry point: SQL files, then column heal, with a one-line summary. */
export async function runSchemaDriftGuard(pool: Pool): Promise<void> {
  const files = await applyIdempotentSqlMigrations(pool);
  if (files.applied.length) console.log(`[schema-drift] applied SQL migrations: ${files.applied.join(", ")}`);
  for (const f of files.failed) console.warn(`[schema-drift] SQL migration ${f.file} failed: ${f.error}`);
  if (files.missing.length) console.warn(`[schema-drift] SQL migration files not on disk (skipped): ${files.missing.join(", ")}`);

  const res = await healSchemaDrift(pool);
  for (const a of res.added) console.log(`[schema-drift] added ${a.table}.${a.column} ${a.type}${a.notNull ? " (schema says NOT NULL — added nullable)" : ""}`);
  for (const f of res.failed) console.warn(`[schema-drift] could not add ${f.table}.${f.column} ${f.type}: ${f.error}`);
  if (res.missingTables.length) console.warn(`[schema-drift] tables in shared/schema.ts but not in the DB: ${res.missingTables.join(", ")}`);
  console.log(`[schema-drift] done — ${res.added.length} column(s) added, ${res.failed.length} failed, ${res.missingTables.length} table(s) absent`);
}
