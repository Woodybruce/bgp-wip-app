// Weekly UK trading-entity re-scrape.
//
// After the one-shot bulk scrape catches the easy wins, this re-tries any
// brand that's still missing uk_entity_name. Some brands fail the first
// time because:
//   - Their T&Cs page was rate-limited by Cloudflare
//   - The site was mid-deploy and 5xx'd
//   - They've since added /pages/terms (e.g. Shopify migration)
//
// Brands that already have uk_entity_name set — by the scraper OR by a
// human in the Compliance board — are left untouched. The cron in
// server/index.ts fires this every Sunday at 02:00.
//
// Throttled to 1.2s/brand (~3000/hour ceiling) so we don't trip the same
// rate limits that caused the first miss.
import { pool } from "./db";

// Imported lazily inside the function so this module stays cheap to load.
// (companies-house.ts is hefty and pulls in lots of CH-related deps.)

interface RescrapeResult {
  total: number;
  processed: number;
  found: number;
  notFound: number;
  errored: number;
}

const DELAY_MS = 1200;

export async function runWeeklyUkEntityRescrape(opts: { limit?: number } = {}): Promise<RescrapeResult> {
  const limit = opts.limit ?? 5000;
  const result: RescrapeResult = { total: 0, processed: 0, found: 0, notFound: 0, errored: 0 };

  const { rows } = await pool.query<{
    id: string; name: string; domain: string | null; domain_url: string | null; backers: string | null;
  }>(
    `SELECT id, name, domain, domain_url, backers
       FROM crm_companies
      WHERE merged_into_id IS NULL
        AND (uk_entity_name IS NULL OR uk_entity_name = '')
        AND (domain IS NOT NULL OR domain_url IS NOT NULL)
      ORDER BY (company_type ILIKE 'tenant%') DESC, name
      LIMIT $1`,
    [limit]
  );
  result.total = rows.length;
  if (rows.length === 0) {
    console.log("[uk-entity-rescrape] nothing to do — all brands have a trading entity");
    return result;
  }

  // Imported lazily to keep module bootstrap cheap.
  const { scrapeUkEntityFromWebsite } = await import("./companies-house");

  for (const row of rows) {
    const domain = row.domain || row.domain_url;
    if (!domain) { result.processed++; continue; }
    try {
      const scraped = await scrapeUkEntityFromWebsite(domain, { name: row.name, parentGroup: row.backers });
      if (scraped.entityName) {
        // Guard with WHERE uk_entity_name IS NULL so we never clobber a
        // value set between SELECT and UPDATE (e.g. by a human edit).
        await pool.query(
          `UPDATE crm_companies SET uk_entity_name = $1
             WHERE id = $2 AND (uk_entity_name IS NULL OR uk_entity_name = '')`,
          [scraped.entityName, row.id]
        );
        result.found++;
      } else {
        result.notFound++;
      }
    } catch (err: any) {
      result.errored++;
      console.warn(`[uk-entity-rescrape] ${row.name}: ${err?.message || err}`);
    }
    result.processed++;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return result;
}
