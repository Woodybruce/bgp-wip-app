// Sort brands into the categories of Landsec's agency brief (Woody,
// 2026-11-16: "go ahead with the catagories"). For brands on a catch-all
// type, a preview of a better type from the rules in shared/brand-retype.ts
// (no AI), then Apply on the rows an admin ticked, and Undo of the last
// apply. Nothing runs at boot or on a timer. A brand is changed only while it
// still holds the type the preview read, and Undo puts back only a brand
// that still holds the type the apply gave it. Admin only:
//   GET  /api/admin/brand-retype          the preview, and the last apply
//   POST /api/admin/brand-retype/apply    { changes: [{ id, from, to }] }
//   POST /api/admin/brand-retype/undo     the last apply, put back
import type { Express, Request } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import { CATCH_ALL_TENANT_TYPES, isCatchAllTenantType, suggestTenantType } from "@shared/brand-retype";
import { TENANT_CATEGORIES } from "@shared/tenant-categories";
import { landsecCategoryLabel, landsecCategoryOf } from "@shared/landsec";

type Query = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
const LAST_KEY = "brand_retype_last";
const MAX_CHANGES = 500;

export interface RetypeRow { id: string; name: string; from: string; to: string; fromCategory: string | null; toCategory: string | null; reason: string }
export interface RetypeChange { id: string; name: string; from: string; to: string }
export interface RetypeLast { at: string; byName: string | null; changes: RetypeChange[]; undoneAt?: string | null; undoneByName?: string | null }

export class RetypeError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function previewRetype(query: Query): Promise<{ rows: RetypeRow[]; catchAll: number }> {
  const brands = (await query(
    `SELECT id, name, company_type, industry, description FROM crm_companies
      WHERE lower(btrim(company_type)) = ANY($1::text[]) AND archived_at IS NULL AND merged_into_id IS NULL
      ORDER BY lower(name)`, [CATCH_ALL_TENANT_TYPES.map(t => t.toLowerCase())])).rows;
  const rows: RetypeRow[] = [];
  for (const b of brands) {
    const hit = suggestTenantType({ name: String(b.name || ""), companyType: b.company_type, industry: b.industry, description: b.description });
    if (!hit) continue;
    rows.push({
      id: String(b.id), name: String(b.name), from: b.company_type, to: hit.type, reason: hit.reason,
      fromCategory: landsecCategoryLabel(landsecCategoryOf(b.company_type)), toCategory: landsecCategoryLabel(landsecCategoryOf(hit.type)),
    });
  }
  return { rows, catchAll: brands.length };
}

export async function lastRetype(query: Query): Promise<RetypeLast | null> {
  const value = (await query(`SELECT value FROM system_settings WHERE key = $1`, [LAST_KEY])).rows[0]?.value;
  return value && typeof value === "object" && Array.isArray(value.changes) ? value as RetypeLast : null;
}

async function saveLast(query: Query, last: RetypeLast): Promise<void> {
  await query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [LAST_KEY, JSON.stringify(last)]);
}

// The ticked rows, checked: a catch-all type to a type on the list, once each.
export function checkRetypeChanges(input: unknown): Array<{ id: string; from: string; to: string }> {
  if (!Array.isArray(input) || input.length === 0) throw new RetypeError(400, "Tick at least one brand");
  if (input.length > MAX_CHANGES) throw new RetypeError(400, `At most ${MAX_CHANGES} brands at a time`);
  const seen = new Set<string>();
  return input.map((raw: any) => {
    const id = String(raw?.id || "").trim(), from = String(raw?.from || "").trim(), to = String(raw?.to || "").trim();
    if (!id || seen.has(id)) throw new RetypeError(400, "Each brand once");
    seen.add(id);
    if (!isCatchAllTenantType(from)) throw new RetypeError(400, `${from || "That type"} is not one this tool changes`);
    if (!(TENANT_CATEGORIES as readonly string[]).includes(to)) throw new RetypeError(400, `${to || "That type"} is not on the type list`);
    return { id, from, to };
  });
}

// One statement: a brand changes only while it holds the type the preview read.
export async function applyRetype(query: Query, input: unknown, byName: string | null, now = new Date()): Promise<{ applied: RetypeChange[]; skipped: number }> {
  const changes = checkRetypeChanges(input);
  const applied = (await query(
    `UPDATE crm_companies c SET company_type = x.to_type, updated_at = now()
       FROM unnest($1::varchar[], $2::text[], $3::text[]) AS x(id, from_type, to_type)
      WHERE c.id = x.id AND c.company_type = x.from_type AND c.archived_at IS NULL AND c.merged_into_id IS NULL
      RETURNING c.id, c.name, x.from_type, x.to_type`,
    [changes.map(c => c.id), changes.map(c => c.from), changes.map(c => c.to)])).rows
    .map((r: any) => ({ id: String(r.id), name: String(r.name || ""), from: String(r.from_type), to: String(r.to_type) }));
  if (applied.length) await saveLast(query, { at: now.toISOString(), byName, changes: applied, undoneAt: null });
  return { applied, skipped: changes.length - applied.length };
}

// The last apply, put back where a brand still holds the type it was given.
export async function undoRetype(query: Query, byName: string | null, now = new Date()): Promise<{ restored: number }> {
  const last = await lastRetype(query);
  if (!last || last.undoneAt || !last.changes.length) throw new RetypeError(409, "There is no apply to undo");
  const restored = (await query(
    `UPDATE crm_companies c SET company_type = x.from_type, updated_at = now()
       FROM unnest($1::varchar[], $2::text[], $3::text[]) AS x(id, from_type, to_type)
      WHERE c.id = x.id AND c.company_type = x.to_type
      RETURNING c.id`,
    [last.changes.map(c => c.id), last.changes.map(c => c.from), last.changes.map(c => c.to)])).rows.length;
  await saveLast(query, { ...last, undoneAt: now.toISOString(), undoneByName: byName });
  return { restored };
}

async function callerName(req: Request): Promise<string | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  return (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]).catch(() => ({ rows: [] as any[] }))).rows[0]?.name || null;
}

export function setupBrandRetypeRoutes(app: Express) {
  const query: Query = (sql, params) => pool.query(sql, params);
  const fail = (res: any, e: any) => res.status(e instanceof RetypeError ? e.status : 500).json({ error: e?.message || "Failed" });
  app.get("/api/admin/brand-retype", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json({ ...(await previewRetype(query)), last: await lastRetype(query) }); }
    catch (e: any) { fail(res, e); }
  });
  app.post("/api/admin/brand-retype/apply", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await applyRetype(query, req.body?.changes, await callerName(req));
      console.log(`[brand-retype] ${result.applied.length} brand type(s) changed, ${result.skipped} skipped`);
      res.json(result);
    } catch (e: any) { fail(res, e); }
  });
  app.post("/api/admin/brand-retype/undo", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await undoRetype(query, await callerName(req));
      console.log(`[brand-retype] undo: ${result.restored} brand type(s) put back`);
      res.json(result);
    } catch (e: any) { fail(res, e); }
  });
}
