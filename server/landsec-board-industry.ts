// What the app holds about brands across the whole directory, for the Landsec
// market report and the board report's figures (Woody, 2026-11-19: "what abiut
// marklet reports and insigts of the industry generally?", then "The market
// analysis reports need to be surrounding the brands and who's doing what news
// etc including all the info we get each month from the team news propel
// etc"). The rows are read here; what an item is, which story counts once and
// the order are shared/landsec-market-report.ts, and the counts are
// shared/landsec-board-report.ts (industryFigures).
//
//  - dated signals about a brand that are public reports: one with a link, or
//    one read out of a trade publisher's newsletter (Propel, Property Week:
//    the publisher is named as its source). Never a rumour, never a line BGP
//    typed about its own deal (those carry no link), and of a story only its
//    kind, its one-line headline, what it states about space, and its date:
//    never the text of the story, which is the publisher's;
//  - the brands' own website store counts (good snapshots only);
//  - planning applications that name a brand, and job adverts, by the
//    Expansion card's own exclusion (no tree or telecoms application);
//  - leasing requirements added in the period, each worded as every client
//    screen words one (what it is and its own date).
// A hidden brand is left out in the query and a junk brand
// (shared/junk-brand.ts) after it. No star, no hold, no owner at BGP, no
// score of BGP's relationship, and not whether BGP confirmed a requirement.
//
// Four queries, whatever the number of brands. Each may fail on its own: its
// figures then read "not available" and the report is still made.
import { pool } from "./db";
import { landsecCategoryOf, type LandsecCategoryOrOther } from "@shared/landsec";
import { reportDay, type ReportPeriod } from "@shared/landsec-reports";
import { isJunkBrand } from "@shared/junk-brand";
import { NEVER_AN_OCCUPIER_TYPES } from "@shared/brand-pipeline";
import { requirementReason } from "@shared/requirement-live";
import type { IndustryInput } from "@shared/landsec-board-report";
import type { MarketPipelineRow, MarketRequirementRow, MarketSignalRow, MarketStoreRow } from "@shared/landsec-market-report";
import { newsletterPublisherOf } from "./insights-feed";

/** The rows, rich enough for the market report's items and still the board report's counts. */
export interface IndustryRows { signals: MarketSignalRow[] | null; snapshots: MarketStoreRow[] | null; pipeline: MarketPipelineRow[] | null; requirements: MarketRequirementRow[] | null }
/** The same rows as the board report's counting takes them. */
export const industryCountInput = (rows: IndustryRows): IndustryInput => ({
  signals: rows.signals, snapshots: rows.snapshots,
  pipeline: rows.pipeline ? rows.pipeline.map(p => ({ brandId: p.brandId, category: p.category, kind: p.kind, day: p.day })) : null,
  requirements: rows.requirements ? rows.requirements.map(r => ({ brandId: r.brandId, category: r.category, day: r.day })) : null,
});

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };

// A brand on the directory: a tenant brand that is not hidden and not merged away.
const BRAND = `c.company_type ILIKE 'tenant%' AND c.archived_at IS NULL AND c.merged_into_id IS NULL`;

const kept = (row: any): { category: LandsecCategoryOrOther | null } | null =>
  (isJunkBrand({ name: row.name, companyType: row.company_type }) ? null : { category: landsecCategoryOf(row.company_type) });

async function attempt<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch (e: any) { console.warn(`[landsec-board-industry] ${label}: ${e?.message}`); return null; }
}

export async function industryInput(period: ReportPeriod, db: Queryable = pool, today: Date = new Date()): Promise<IndustryRows> {
  // A day either side in the query; the count itself is by London day (industryFigures).
  const span = [period.start, period.end];
  const [signals, snapshots, pipeline, requirements] = await Promise.all([
    attempt("signals", async (): Promise<MarketSignalRow[]> => {
      const rows = (await db.query(
        `/* landsec-board-industry:signals */
         SELECT s.brand_company_id, c.name, c.company_type, s.signal_type, s.headline, s.detail, s.source, s.signal_date, s.magnitude
           FROM brand_signals s JOIN crm_companies c ON c.id = s.brand_company_id
          WHERE ${BRAND} AND s.signal_date >= $1::date - 1 AND s.signal_date < $2::date + 1
            AND (s.source ~* '^https?://' OR s.source ILIKE 'newsletter:%')
            AND COALESCE(s.signal_type, '') <> 'rumour' AND COALESCE(s.confidence, '') <> 'rumour'
          ORDER BY s.signal_date DESC LIMIT 12000`, span)).rows;
      const out: MarketSignalRow[] = [];
      for (const r of rows) {
        const brand = kept(r);
        if (!brand) continue;
        const source = r.source ? String(r.source) : null;
        const letter = /^newsletter:/i.test(source || "");
        // A newsletter is a public report only when a trade publisher sent it: an agent firm's is not read here.
        const publisher = letter ? newsletterPublisherOf(r.detail) : null;
        if (letter && !publisher) continue;
        // Of the stored detail only what the story states about space is kept ("Stated: ..."); the rest is never handed on.
        const stated = /^Stated: /.test(String(r.detail || "")) ? String(r.detail).split(/\s+Via newsletter:/)[0] : null;
        out.push({ brandId: String(r.brand_company_id), brand: String(r.name), category: brand.category, type: String(r.signal_type || "news"), headline: String(r.headline || ""), detail: stated, source, publisher, date: reportDay(r.signal_date), magnitude: r.magnitude ? String(r.magnitude) : null });
      }
      return out;
    }),
    attempt("store counts", async (): Promise<MarketStoreRow[]> => {
      const rows = (await db.query(
        `/* landsec-board-industry:store-counts */
         SELECT n.brand_company_id, c.name, c.company_type, n.counted_at, n.method, n.path_prefix, n.uk, n.site_count
           FROM brand_store_counts n JOIN crm_companies c ON c.id = n.brand_company_id
          WHERE ${BRAND} AND n.error IS NULL AND n.site_count IS NOT NULL
            AND n.counted_at >= $1::date - 400 AND n.counted_at < $2::date + 1`, span)).rows;
      const out: MarketStoreRow[] = [];
      for (const r of rows) {
        const brand = kept(r), day = reportDay(r.counted_at);
        if (brand && day) out.push({ brandId: String(r.brand_company_id), brand: String(r.name), category: brand.category, day, basis: `${r.method || ""}|${r.path_prefix || ""}|${r.uk ?? ""}`, count: Number(r.site_count) });
      }
      return out;
    }),
    attempt("planning and jobs", async (): Promise<MarketPipelineRow[]> => {
      const rows = (await db.query(
        `/* landsec-board-industry:pipeline */
         SELECT i.brand_company_id, c.name, c.company_type, i.kind, i.title, i.town, i.authority, to_char(i.item_date, 'YYYY-MM-DD') AS day
           FROM brand_pipeline_items i JOIN crm_companies c ON c.id = i.brand_company_id
          WHERE ${BRAND} AND i.item_date >= $1::date AND i.item_date < $2::date
            AND (i.kind <> 'planning' OR lower(trim(COALESCE(i.detail->>'type', ''))) NOT IN (${NEVER_AN_OCCUPIER_TYPES.map(t => `'${t}'`).join(", ")}))`, span)).rows;
      const out: MarketPipelineRow[] = [];
      for (const r of rows) {
        const brand = kept(r);
        if (brand) out.push({ brandId: String(r.brand_company_id), brand: String(r.name), category: brand.category, kind: r.kind === "planning" ? "planning" : "job", day: r.day ? String(r.day) : null, title: r.title ? String(r.title) : null, town: r.town ? String(r.town) : null, authority: r.authority ? String(r.authority) : null });
      }
      return out;
    }),
    attempt("requirements", async (): Promise<MarketRequirementRow[]> => {
      // What a requirement is and its own date, as every client screen words it: never its state, who holds it at BGP, or a confirmation.
      const rows = (await db.query(
        `/* landsec-board-industry:requirements */
         SELECT r.company_id, c.id AS brand_id, c.name, c.company_type, r.created_at,
                r.status, r.origin, r.sources, r.last_listed_at, r.last_listed_source, r.requirement_date, r.use, r.size, r.requirement_locations
           FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON c.id = r.company_id AND ${BRAND}
          WHERE r.created_at >= $1::date - 1 AND r.created_at < $2::date + 1`, span)).rows;
      const out: MarketRequirementRow[] = [];
      const words = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : String(v ?? "")).replace(/\s+/g, " ").trim();
      for (const r of rows) {
        const day = reportDay(r.created_at);
        if (!r.company_id) { out.push({ brandId: null, brand: "", category: null, day, wants: "", record: "" }); continue; }
        // Tied to a record that is hidden, merged, junk or not a tenant brand: not counted.
        const brand = r.brand_id ? kept(r) : null;
        if (!brand) continue;
        const wants = [words(r.use), words(r.size), words(r.requirement_locations)].filter(Boolean).join("; ");
        out.push({ brandId: String(r.brand_id), brand: String(r.name), category: brand.category, day, wants: wants ? `Wants ${wants}` : "", record: requirementReason(r, today).clientText });
      }
      return out;
    }),
  ]);
  return { signals, snapshots, pipeline, requirements };
}
