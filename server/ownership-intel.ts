// Who owns the brand: the weekly read of the London Food Money Matrix
// (Woody, 2026-11-15; the rules are in shared/ownership-intel.ts). The page
// is fetched, its names are matched to the brand directory, and for a brand
// matched to exactly one record the page's reading is saved on the brand
// (ai_generated_fields.ownership_intel: owner, kind, since, the source link,
// the date read). Backers is filled only when blank, and only with a private
// equity or venture owner. Nothing is created, and
// a read that fails or looks cut short changes nothing. No AI is used.
//
// Routes (admin only):
//   GET  /api/admin/ownership-intel        — the last read's report
//   POST /api/admin/ownership-intel/read   — read the page now
import type { Express } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { pool } from "./db";
import {
  OWNERSHIP_INTEL_KEY, OWNERSHIP_SOURCE_URL, readOwnershipPage, planOwnership, ownershipReadCutShort, ownershipKindFits,
  type OwnershipBrand, type OwnershipReport, type OwnershipWrite,
} from "@shared/ownership-intel";

const REPORT_KEY = "ownership_intel_report";
const USER_AGENT = "BGP-Dashboard/1.0 (ownership read)";
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

type Query = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
export type OwnershipDeps = { fetchPage?: (url: string) => Promise<string | null>; query?: Query; now?: () => Date };

// OWNERSHIP_INTEL_URL moves the read to another address; "off" stops it.
export function ownershipSourceUrl(): string | null {
  const set = String(process.env.OWNERSHIP_INTEL_URL || "").trim();
  if (/^off$/i.test(set)) return null;
  return /^https:\/\//i.test(set) ? set : OWNERSHIP_SOURCE_URL;
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: controller.signal, redirect: "follow" });
    if (!res.ok) return null;
    const body = await res.text();
    return body.length > MAX_BYTES ? null : body;
  } catch { return null; } finally { clearTimeout(timer); }
}

export type OwnershipReadResult =
  | { ok: true; report: OwnershipReport; written: number }
  | { ok: false; reason: string };

export async function lastOwnershipReport(deps: OwnershipDeps = {}): Promise<OwnershipReport | null> {
  const query: Query = deps.query || ((sql, params) => pool.query(sql, params));
  const r = await query(`SELECT value FROM system_settings WHERE key = $1`, [REPORT_KEY]);
  const value = r.rows[0]?.value;
  return value && typeof value === "object" && typeof value.readAt === "string" ? value as OwnershipReport : null;
}

export async function runOwnershipRead(deps: OwnershipDeps = {}): Promise<OwnershipReadResult> {
  const query: Query = deps.query || ((sql, params) => pool.query(sql, params));
  const url = ownershipSourceUrl();
  if (!url) return { ok: false, reason: "The ownership read is switched off (OWNERSHIP_INTEL_URL)." };
  const html = await (deps.fetchPage || fetchPage)(url);
  if (!html) return { ok: false, reason: "The page could not be fetched." };
  const now = (deps.now || (() => new Date()))();
  const places = readOwnershipPage(html, now);
  if (!places) return { ok: false, reason: "The page no longer holds its list in the form this reads." };
  const last = await lastOwnershipReport(deps).catch(() => null);
  if (ownershipReadCutShort(places.length, last?.places ?? null)) {
    return { ok: false, reason: `The page listed ${places.length} places${last ? `, against ${last.places} at the last read` : ""}: treated as cut short, nothing changed.` };
  }
  // Tenant brands only, merged records left out; a hidden brand is loaded so
  // a name that fits one is skipped, not reported as missing.
  const rows = (await query(
    `SELECT id, name, backers, company_type, industry, archived_at IS NOT NULL AS hidden, ai_generated_fields->'${OWNERSHIP_INTEL_KEY}' AS intel
       FROM crm_companies
      WHERE company_type ILIKE 'tenant%' AND merged_at IS NULL AND merged_into_id IS NULL`)).rows;
  const brands: OwnershipBrand[] = rows.map(row => ({
    id: String(row.id), name: String(row.name || ""), backers: row.backers ?? null, hidden: !!row.hidden,
    fits: ownershipKindFits(row.company_type, row.industry), recordedAs: [row.company_type, row.industry].filter(Boolean).join(", ") || undefined,
    intel: row.intel && typeof row.intel === "object" && typeof row.intel.owner === "string" ? row.intel : null,
  }));
  const readAt = now.toISOString();
  const { writes, report } = planOwnership(places, brands, readAt, url);
  let written = 0;
  for (const write of writes) written += await saveOwnership(query, write, readAt);
  await query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [REPORT_KEY, JSON.stringify(report)]);
  return { ok: true, report, written };
}

// One brand. Backers is set only while it still holds what the plan saw (a
// person may have typed one since the brands were loaded); filled, it is
// marked as an automated fact, as the profile's own readers mark theirs.
async function saveOwnership(query: Query, write: OwnershipWrite, readAt: string): Promise<number> {
  const intel = JSON.stringify(write.intel);
  if (write.setBackers) {
    const filled = await query(
      `UPDATE crm_companies
          SET backers = $2,
              ai_generated_fields = coalesce(ai_generated_fields, '{}'::jsonb) || jsonb_build_object('${OWNERSHIP_INTEL_KEY}', $3::jsonb, 'backers', $4::text)
        WHERE id = $1 AND coalesce(btrim(backers), '') = $5
        RETURNING id`, [write.id, write.setBackers, intel, readAt, write.backersWas]);
    if (filled.rows.length) return 1;
    // Backers changed under the read: keep the reading, leave Backers alone.
    const { filledBackers: _dropped, ...kept } = write.intel;
    const r = await query(
      `UPDATE crm_companies SET ai_generated_fields = jsonb_set(coalesce(ai_generated_fields, '{}'::jsonb), '{${OWNERSHIP_INTEL_KEY}}', $2::jsonb) WHERE id = $1 RETURNING id`,
      [write.id, JSON.stringify(kept)]);
    return r.rows.length;
  }
  const r = await query(
    `UPDATE crm_companies SET ai_generated_fields = jsonb_set(coalesce(ai_generated_fields, '{}'::jsonb), '{${OWNERSHIP_INTEL_KEY}}', $2::jsonb) WHERE id = $1 RETURNING id`,
    [write.id, intel]);
  return r.rows.length;
}

// The weekly job (Monday 03:00). A failed read is one log line.
export async function weeklyOwnershipRead(): Promise<void> {
  const result = await runOwnershipRead();
  if (!result.ok) { console.warn(`[ownership-intel] ${result.reason}`); return; }
  const r = result.report;
  console.log(`[ownership-intel] ${r.places} places read, ${r.matched} matched, ${result.written} brand(s) updated, ${r.filledBackers} backers filled, ${r.differs.length} differ, ${r.ownerChanges.length} owner change(s)`);
}

export function setupOwnershipIntelRoutes(app: Express) {
  app.get("/api/admin/ownership-intel", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json({ sourceUrl: ownershipSourceUrl(), report: await lastOwnershipReport() }); }
    catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });
  app.post("/api/admin/ownership-intel/read", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await runOwnershipRead();
      if (!result.ok) return res.status(409).json({ error: result.reason });
      res.json({ report: result.report, written: result.written });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });
}
