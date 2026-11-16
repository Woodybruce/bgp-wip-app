// Landsec home (docs/landsec-pitch-plan.md, item 1): the 14 schemes grouped
// North / South / Outlets / London, one card per scheme with its units,
// vacancy and live letting pipeline. Out-of-scope Landsec records and
// duplicate scheme records are shown to BGP admins only, with the merge
// control that folds a duplicate into its scheme's keeper. The numbers are
// landsecCounts (server/landsec-counts.ts), the one count for every Landsec
// header, so a screen that needs them reads this feed.
import type { Express } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import {
  LANDSEC_GROUPS, landsecCompanyId, resolveLandsecPortfolio,
  clearLandsecPortfolioCache,
} from "./landsec-schemes";
import { landsecCounts, landsecOutsideSchemes, sumLandsecCounts, trackerAndDealsDiffer } from "./landsec-counts";
import { landsecViewer, viewerCanSeeScheme } from "./landsec-access";
import { unitOccupancy } from "@shared/property-units";
import { BRAND_KEYS_CTE, brandNameKeySql } from "./tenant-brand-resolver";
import { landsecCategoryOf, type LandsecCategoryOrOther } from "@shared/landsec";

// A scheme's trading units by the categories of Landsec's agency brief (Woody,
// 2026-11-16: "go ahead with the catagories"), for pitch question 2. A unit is
// a tenancy schedule row read as occupied by the one rule (unitOccupancy), not
// archived; its category is its brand's, the brand the property page's unit
// feed gives the row (server/property-units.ts): the stored brand, else the
// one brand its trading name, or lease name, matches (BRAND_KEYS_CTE). A
// trading row with neither is counted as having no brand.
export interface LandsecCategoryMix { counts: Partial<Record<LandsecCategoryOrOther, number>>; trading: number; notLinked: number; byName?: number }

export async function categoryMixByProperty(propertyIds: string[]): Promise<Map<string, LandsecCategoryMix>> {
  const out = new Map<string, LandsecCategoryMix>();
  if (!propertyIds.length) return out;
  const rows = (await pool.query(
    `WITH ${BRAND_KEYS_CTE}
     SELECT t.property_id, t.status, t.occupancy_status, t.tenant_name, t.trading_name, t.passing_rent_pa,
            COALESCE(tc_fk.id, tc_soft.id) AS brand_id, COALESCE(tc_fk.company_type, tc_soft.company_type) AS company_type,
            (tc_fk.id IS NULL AND tc_soft.id IS NOT NULL) AS by_name
       FROM tenancy_schedule_units t
       LEFT JOIN crm_companies tc_fk ON tc_fk.id = t.tenant_company_id AND tc_fk.merged_into_id IS NULL
       LEFT JOIN brand_keys bk ON t.tenant_company_id IS NULL
            AND bk.norm_key = ${brandNameKeySql("coalesce(nullif(btrim(t.trading_name), ''), t.tenant_name, '')")}
       LEFT JOIN crm_companies tc_soft ON tc_soft.id = bk.brand_id AND tc_soft.merged_into_id IS NULL
      WHERE t.property_id = ANY($1::varchar[])
        AND lower(btrim(COALESCE(t.status, ''))) <> 'archived'
        AND lower(btrim(COALESCE(t.occupancy_status, ''))) <> 'archived'`,
    [propertyIds])).rows;
  for (const row of rows) {
    if (unitOccupancy(row) !== "occupied") continue;
    const mix = out.get(row.property_id) || { counts: {}, trading: 0, notLinked: 0, byName: 0 };
    mix.trading += 1;
    if (!row.brand_id) mix.notLinked += 1;
    else {
      const key = landsecCategoryOf(row.company_type) ?? "other";
      mix.counts[key] = (mix.counts[key] || 0) + 1;
      if (row.by_name) mix.byName = (mix.byName || 0) + 1;
    }
    out.set(row.property_id, mix);
  }
  return out;
}

export function sumCategoryMixes(mixes: Array<LandsecCategoryMix | undefined>): LandsecCategoryMix {
  const total: LandsecCategoryMix = { counts: {}, trading: 0, notLinked: 0, byName: 0 };
  for (const mix of mixes) {
    if (!mix) continue;
    total.trading += mix.trading;
    total.notLinked += mix.notLinked;
    total.byName = (total.byName || 0) + (mix.byName || 0);
    for (const [key, n] of Object.entries(mix.counts) as Array<[LandsecCategoryOrOther, number]>) total.counts[key] = (total.counts[key] || 0) + n;
  }
  return total;
}

export function setupLandsecHomeRoutes(app: Express) {
  app.get("/api/landsec/home", requireAuth, async (req, res) => {
    try {
      const viewer = await landsecViewer(req);
      if (!viewer) return res.status(403).json({ error: "Not available for this account" });
      const { companyId, isClient } = viewer;
      const portfolio = await resolveLandsecPortfolio(companyId);
      // One set of numbers (server/landsec-counts.ts): live lettings by
      // stage from the deal, days at stage from the deal clock.
      const counts = await landsecCounts(portfolio.schemes.flatMap(s => s.properties.map(p => p.id)));
      // A failed read leaves the mix out; the cards still load.
      const mixes = await categoryMixByProperty(portfolio.schemes.filter(s => viewerCanSeeScheme(viewer, s.key)).flatMap(s => s.properties.map(p => p.id)))
        .catch((e: any) => { console.warn("[/api/landsec/home] category mix failed:", e?.message); return null; });

      const schemes = portfolio.schemes.filter(s => viewerCanSeeScheme(viewer, s.key)).map(s => {
        const units = s.properties.reduce((n, p) => n + p.units, 0);
        const vacant = s.properties.reduce((n, p) => n + p.vacant, 0);
        const passingRent = s.properties.reduce((n, p) => n + p.passing_rent, 0);
        const rentUnits = s.properties.reduce((n, p) => n + p.rent_units, 0);
        const count = sumLandsecCounts(s.properties.map(p => counts.byProperty[p.id]));
        return {
          key: s.key, name: s.name, town: s.town, group: s.group,
          propertyId: s.canonicalId,
          recordCount: s.properties.length,
          units, vacant, passingRent, rentUnits,
          // "tracker" is the four tracker stages, counted from the deals.
          pipeline: {
            tracker: count.stages, liveLettings: count.liveLettings, liveDeals: count.liveDeals,
            stuck: count.stuck, oldestLiveDays: count.oldestStageDays,
          },
          count,
          categoryMix: mixes ? sumCategoryMixes(s.properties.map(p => mixes.get(p.id))) : null,
          // Every record behind the scheme — admins see these to merge them.
          records: isClient ? undefined : s.properties.map(p => ({ id: p.id, name: p.name, units: p.units, deals: p.deals, files: p.files })),
        };
      });

      // Totals are the schemes this login can see, from the same counts.
      const total = sumLandsecCounts(schemes.map(s => s.count));
      const totals = {
        units: schemes.reduce((n, s) => n + s.units, 0),
        vacant: schemes.reduce((n, s) => n + s.vacant, 0),
        liveLettings: total.liveLettings,
        liveDeals: total.liveDeals,
        stuck: total.stuck,
        tracker: total.stages,
        withRecord: schemes.filter(s => s.recordCount > 0).length,
      };

      // BGP staff only. The report of what the 14-scheme rule would take out
      // of the Landsec view (nothing is removed), and where the Letting
      // Tracker and the deals disagree. A failed report never blanks the page.
      const outsideSchemes = isClient ? undefined
        : await landsecOutsideSchemes(portfolio).catch((e: any) => { console.warn("[/api/landsec/home] outside-schemes report failed:", e?.message); return null; });
      const trackerCheck = isClient ? undefined : {
        differ: trackerAndDealsDiffer(total),
        trackerRows: total.trackerRows,
        liveLettings: total.liveLettings,
        rowsWithoutLetting: total.rowsWithoutLetting,
        lettingsWithoutRow: total.lettingsWithoutRow,
        report: "/api/admin/letting-integrity",
      };

      res.json({
        companyId,
        // The tracker-and-deals gap inside each scheme's count is staff's too.
        groups: LANDSEC_GROUPS.map(group => ({
          group,
          schemes: schemes.filter(s => s.group === group).map(({ count, ...s }) => (isClient ? s : { ...s, trackerCheck: {
            differ: trackerAndDealsDiffer(count), trackerRows: count.trackerRows,
            rowsWithoutLetting: count.rowsWithoutLetting, lettingsWithoutRow: count.lettingsWithoutRow,
          } })),
        })).filter(g => g.schemes.length > 0),
        viewer: { role: viewer.role, restricted: !!viewer.schemes },
        totals,
        outOfScope: isClient ? undefined : portfolio.outOfScope.map(p => ({ id: p.id, name: p.name, units: p.units, deals: p.deals })),
        outsideSchemes,
        trackerCheck,
      });
    } catch (e: any) {
      console.error("[/api/landsec/home]", e?.message);
      res.status(500).json({ error: e?.message || "Failed to load the Landsec home" });
    }
  });

  // Fold duplicate records into the scheme's keeper (admin only). Uses the
  // same merge as ChatBGP's merge_properties tool, one record at a time in
  // its own transaction, so a failure leaves the others untouched.
  app.post("/api/landsec/schemes/:key/merge", requireAuth, requireAdmin, async (req, res) => {
    try {
      const companyId = await landsecCompanyId();
      if (!companyId) return res.status(404).json({ error: "No Landsec company record" });
      const portfolio = await resolveLandsecPortfolio(companyId);
      const scheme = portfolio.schemes.find(s => s.key === req.params.key);
      if (!scheme) return res.status(404).json({ error: "Unknown scheme" });
      const keepId = String(req.body?.keepId || scheme.canonicalId || "");
      const mergeIds: string[] = Array.isArray(req.body?.mergeIds) ? req.body.mergeIds.map(String) : [];
      const inScheme = new Set(scheme.properties.map(p => p.id));
      if (!inScheme.has(keepId)) return res.status(400).json({ error: "Keeper is not a record of this scheme" });
      const bad = mergeIds.find(id => !inScheme.has(id) || id === keepId);
      if (bad) return res.status(400).json({ error: `Record ${bad} is not a duplicate of this scheme` });

      const { mergeProperties } = await import("./property-merge");
      const results: any[] = [];
      for (const mergeId of mergeIds) {
        try {
          results.push({ mergeId, ok: true, result: await mergeProperties(keepId, mergeId) });
        } catch (e: any) {
          results.push({ mergeId, ok: false, error: e?.message });
        }
      }
      clearLandsecPortfolioCache();
      const userId = req.session?.userId || (req as any).tokenUserId;
      console.log(`[landsec-home] scheme ${scheme.key}: merged ${results.filter(r => r.ok).length}/${mergeIds.length} record(s) into ${keepId} by ${userId}`);
      res.json({ keepId, results });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Merge failed" });
    }
  });
}
