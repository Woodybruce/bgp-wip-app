// The industry in the period, for the board report's market sections (Woody,
// 2026-11-19: "what abiut marklet reports and insigts of the industry
// generally?", then "yes do that as suggested"). The rows behind a page of
// figures per section: counted in shared/landsec-board-report.ts
// (industryFigures), read here.
//
// PUBLIC RECORDS ONLY, across the whole brand directory:
//  - dated signals about a brand that carry a link, never a rumour, and of a
//    signal only its kind, headline, link and date (never its body text:
//    a newsletter's or another firm's words are theirs);
//  - the brands' own website store counts (good snapshots only);
//  - planning applications that name a brand, and job adverts, by the
//    Expansion card's own exclusion (no tree or telecoms application);
//  - leasing requirements added in the period, as a count and nothing more.
// A hidden brand is left out in the query and a junk brand
// (shared/junk-brand.ts) after it. Nothing of BGP's own is read: no remark on
// a brand, no owner, no score of BGP's relationship, no star, and not whether
// BGP confirmed a requirement.
//
// Four queries, whatever the number of brands. Each may fail on its own: its
// figures then read "not available" and the pack is still made.
import { pool } from "./db";
import { landsecCategoryOf, type LandsecCategoryOrOther } from "@shared/landsec";
import { reportDay, type ReportPeriod } from "@shared/landsec-reports";
import { isJunkBrand } from "@shared/junk-brand";
import { NEVER_AN_OCCUPIER_TYPES } from "@shared/brand-pipeline";
import type { IndustryInput, IndustryPipelineItem, IndustryRequirement, IndustrySignal, IndustrySnapshot } from "@shared/landsec-board-report";

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };

// A brand on the directory: a tenant brand that is not hidden and not merged away.
const BRAND = `c.company_type ILIKE 'tenant%' AND c.archived_at IS NULL AND c.merged_into_id IS NULL`;

const kept = (row: any): { category: LandsecCategoryOrOther | null } | null =>
  (isJunkBrand({ name: row.name, companyType: row.company_type }) ? null : { category: landsecCategoryOf(row.company_type) });

async function attempt<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch (e: any) { console.warn(`[landsec-board-industry] ${label}: ${e?.message}`); return null; }
}

export async function industryInput(period: ReportPeriod, db: Queryable = pool): Promise<IndustryInput> {
  // A day either side in the query; the count itself is by London day (industryFigures).
  const span = [period.start, period.end];
  const [signals, snapshots, pipeline, requirements] = await Promise.all([
    attempt("signals", async (): Promise<IndustrySignal[]> => {
      const rows = (await db.query(
        `/* landsec-board-industry:signals */
         SELECT s.brand_company_id, c.name, c.company_type, s.signal_type, s.headline, s.source, s.signal_date, s.magnitude
           FROM brand_signals s JOIN crm_companies c ON c.id = s.brand_company_id
          WHERE ${BRAND} AND s.signal_date >= $1::date - 1 AND s.signal_date < $2::date + 1
            AND s.source ~* '^https?://'
            AND COALESCE(s.signal_type, '') <> 'rumour' AND COALESCE(s.confidence, '') <> 'rumour'
          ORDER BY s.signal_date DESC LIMIT 8000`, span)).rows;
      const out: IndustrySignal[] = [];
      for (const r of rows) {
        const brand = kept(r);
        if (brand) out.push({ brandId: String(r.brand_company_id), brand: String(r.name), category: brand.category, type: String(r.signal_type || "news"), headline: String(r.headline || ""), source: r.source ? String(r.source) : null, date: reportDay(r.signal_date), magnitude: r.magnitude ? String(r.magnitude) : null });
      }
      return out;
    }),
    attempt("store counts", async (): Promise<IndustrySnapshot[]> => {
      const rows = (await db.query(
        `/* landsec-board-industry:store-counts */
         SELECT n.brand_company_id, c.name, c.company_type, n.counted_at, n.method, n.path_prefix, n.uk, n.site_count
           FROM brand_store_counts n JOIN crm_companies c ON c.id = n.brand_company_id
          WHERE ${BRAND} AND n.error IS NULL AND n.site_count IS NOT NULL
            AND n.counted_at >= $1::date - 400 AND n.counted_at < $2::date + 1`, span)).rows;
      const out: IndustrySnapshot[] = [];
      for (const r of rows) {
        const brand = kept(r), day = reportDay(r.counted_at);
        if (brand && day) out.push({ brandId: String(r.brand_company_id), category: brand.category, day, basis: `${r.method || ""}|${r.path_prefix || ""}|${r.uk ?? ""}`, count: Number(r.site_count) });
      }
      return out;
    }),
    attempt("planning and jobs", async (): Promise<IndustryPipelineItem[]> => {
      const rows = (await db.query(
        `/* landsec-board-industry:pipeline */
         SELECT i.brand_company_id, c.name, c.company_type, i.kind, to_char(i.item_date, 'YYYY-MM-DD') AS day
           FROM brand_pipeline_items i JOIN crm_companies c ON c.id = i.brand_company_id
          WHERE ${BRAND} AND i.item_date >= $1::date AND i.item_date < $2::date
            AND (i.kind <> 'planning' OR lower(trim(COALESCE(i.detail->>'type', ''))) NOT IN (${NEVER_AN_OCCUPIER_TYPES.map(t => `'${t}'`).join(", ")}))`, span)).rows;
      const out: IndustryPipelineItem[] = [];
      for (const r of rows) {
        const brand = kept(r);
        if (brand) out.push({ brandId: String(r.brand_company_id), category: brand.category, kind: r.kind === "planning" ? "planning" : "job", day: r.day ? String(r.day) : null });
      }
      return out;
    }),
    attempt("requirements", async (): Promise<IndustryRequirement[]> => {
      const rows = (await db.query(
        `/* landsec-board-industry:requirements */
         SELECT r.company_id, c.id AS brand_id, c.name, c.company_type, r.created_at
           FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON c.id = r.company_id AND ${BRAND}
          WHERE r.created_at >= $1::date - 1 AND r.created_at < $2::date + 1`, span)).rows;
      const out: IndustryRequirement[] = [];
      for (const r of rows) {
        const day = reportDay(r.created_at);
        if (!r.company_id) { out.push({ brandId: null, category: null, day }); continue; }
        // Tied to a record that is hidden, merged, junk or not a tenant brand: not counted.
        const brand = r.brand_id ? kept(r) : null;
        if (brand) out.push({ brandId: String(r.brand_id), category: brand.category, day });
      }
      return out;
    }),
  ]);
  return { signals, snapshots, pipeline, requirements };
}
