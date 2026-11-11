// Landsec home (docs/landsec-pitch-plan.md, item 1): the 14 schemes grouped
// North / South / Outlets / London, one card per scheme with its units,
// vacancy and live letting pipeline. Out-of-scope Landsec records and
// duplicate scheme records are shown to BGP admins only, with the merge
// control that folds a duplicate into its scheme's keeper.
import type { Express } from "express";
import { requireAuth, requireAdmin } from "./auth";
import {
  LANDSEC_GROUPS, landsecCompanyId, resolveLandsecPortfolio,
  schemePipelines, clearLandsecPortfolioCache,
} from "./landsec-schemes";
import { landsecViewer, viewerCanSeeScheme } from "./landsec-access";

export function setupLandsecHomeRoutes(app: Express) {
  app.get("/api/landsec/home", requireAuth, async (req, res) => {
    try {
      const viewer = await landsecViewer(req);
      if (!viewer) return res.status(403).json({ error: "Not available for this account" });
      const { companyId, isClient } = viewer;
      const portfolio = await resolveLandsecPortfolio(companyId);
      const pipelines = await schemePipelines(portfolio);

      const schemes = portfolio.schemes.filter(s => viewerCanSeeScheme(viewer, s.key)).map(s => {
        const units = s.properties.reduce((n, p) => n + p.units, 0);
        const vacant = s.properties.reduce((n, p) => n + p.vacant, 0);
        const passingRent = s.properties.reduce((n, p) => n + p.passing_rent, 0);
        const rentUnits = s.properties.reduce((n, p) => n + p.rent_units, 0);
        return {
          key: s.key, name: s.name, town: s.town, group: s.group,
          propertyId: s.canonicalId,
          recordCount: s.properties.length,
          units, vacant, passingRent, rentUnits,
          pipeline: pipelines[s.key],
          // Every record behind the scheme — admins see these to merge them.
          records: isClient ? undefined : s.properties.map(p => ({ id: p.id, name: p.name, units: p.units, deals: p.deals, files: p.files })),
        };
      });

      const totals = schemes.reduce((t, s) => ({
        units: t.units + s.units,
        vacant: t.vacant + s.vacant,
        liveDeals: t.liveDeals + s.pipeline.liveDeals,
        tracker: {
          AVA: t.tracker.AVA + s.pipeline.tracker.AVA,
          NEG: t.tracker.NEG + s.pipeline.tracker.NEG,
          HOT: t.tracker.HOT + s.pipeline.tracker.HOT,
          SOL: t.tracker.SOL + s.pipeline.tracker.SOL,
        },
        withRecord: t.withRecord + (s.recordCount > 0 ? 1 : 0),
      }), { units: 0, vacant: 0, liveDeals: 0, tracker: { AVA: 0, NEG: 0, HOT: 0, SOL: 0 }, withRecord: 0 });

      res.json({
        companyId,
        groups: LANDSEC_GROUPS.map(group => ({ group, schemes: schemes.filter(s => s.group === group) })).filter(g => g.schemes.length > 0),
        viewer: { role: viewer.role, restricted: !!viewer.schemes },
        totals,
        outOfScope: isClient ? undefined : portfolio.outOfScope.map(p => ({ id: p.id, name: p.name, units: p.units, deals: p.deals })),
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
