// Brand tidy (Woody, 2026-11-11: "we have too many brands — reduce to those
// relevant to BGP and Landsec; ok if we have to re-add"). A brand is kept
// when anything in the app ties it to BGP's or a client's work; the rest
// are archived (archived_at on crm_companies), which takes them out of the
// directory — Brand Explorer, the hub, search, the client slice — without
// touching their row, deals or tenancies. Restore clears the flag. Preview
// first, then apply; each signal is its own query so a missing table on an
// older database skips that signal instead of failing the sweep.
import type { Express } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";

const BRAND = `c.company_type ILIKE 'Tenant%' AND c.merged_into_id IS NULL`;

// Each signal returns the ids of brands it keeps.
const SIGNALS: Record<string, { label: string; sql: string }> = {
  tenant: { label: "Tenant on a schedule", sql: `SELECT DISTINCT tenant_company_id AS id FROM tenancy_schedule_units WHERE tenant_company_id IS NOT NULL
    UNION SELECT DISTINCT tenant_company_id FROM leasing_schedule_units WHERE tenant_company_id IS NOT NULL` },
  deal: { label: "On a BGP deal", sql: `SELECT DISTINCT tenant_id AS id FROM crm_deals WHERE tenant_id IS NOT NULL
    UNION SELECT DISTINCT company_id FROM crm_company_deals` },
  targeted: { label: "Targeted at a unit", sql: `SELECT DISTINCT unnest(target_company_ids) AS id FROM leasing_schedule_units WHERE target_company_ids IS NOT NULL
    UNION SELECT DISTINCT unnest(target_company_ids) FROM tenancy_schedule_units WHERE target_company_ids IS NOT NULL
    UNION SELECT DISTINCT company_id FROM unit_target_operators WHERE company_id IS NOT NULL AND COALESCE(status, '') NOT IN ('Passed')` },
  targetTenants: { label: "Target tenant on a unit", sql: `SELECT DISTINCT company_id AS id FROM target_tenants WHERE company_id IS NOT NULL AND COALESCE(status, '') <> 'rejected'` },
  requirement: { label: "Requirement on our books (last 2 years)", sql: `SELECT DISTINCT company_id AS id FROM crm_requirements_leasing WHERE company_id IS NOT NULL AND COALESCE(updated_at, created_at) > NOW() - INTERVAL '24 months'
    UNION SELECT DISTINCT company_id FROM tenant_rep_searches WHERE company_id IS NOT NULL` },
  interaction: { label: "Interaction logged (last 2 years)", sql: `SELECT DISTINCT company_id AS id FROM crm_interactions WHERE company_id IS NOT NULL AND COALESCE(interaction_date, created_at) > NOW() - INTERVAL '24 months'` },
  offersViewings: { label: "Offer or viewing", sql: `SELECT DISTINCT company_id AS id FROM unit_offers WHERE company_id IS NOT NULL
    UNION SELECT DISTINCT company_id FROM unit_viewings WHERE company_id IS NOT NULL` },
  flagged: { label: "Hunter flag or pipeline stage", sql: `SELECT id FROM crm_companies c WHERE ${BRAND} AND (COALESCE(c.hunter_flag, false) OR COALESCE(c.letting_hunter_flag, false) OR COALESCE(c.investment_hunter_flag, false)
    OR c.concept_status IN ('watching', 'pitching', 'won_deal'))` },
  clientAdded: { label: "Added by a client to their directory", sql: `SELECT DISTINCT unnest(crm_extra_brand_ids) AS id FROM crm_companies WHERE crm_extra_brand_ids IS NOT NULL` },
  plan: { label: "On a CRM plan", sql: `SELECT DISTINCT company_id AS id FROM crm_strategy_targets
    UNION SELECT DISTINCT company_id FROM crm_event_companies
    UNION SELECT DISTINCT company_id FROM crm_engagement_actions` },
  brandCase: { label: "Landsec brand case", sql: `SELECT DISTINCT company_id AS id FROM landsec_brand_cases` },
  represented: { label: "Represented by an agent (current)", sql: `SELECT DISTINCT brand_company_id AS id FROM brand_agent_representations WHERE end_date IS NULL` },
  recent: { label: "Added in the last 90 days", sql: `SELECT id FROM crm_companies c WHERE ${BRAND} AND c.created_at > NOW() - INTERVAL '90 days'` },
};

export interface RelevanceReport {
  totalBrands: number;
  alreadyArchived: number;
  keep: number;
  archive: number;
  signals: Record<string, { label: string; count: number; unavailable?: boolean }>;
  contactsOnlyArchived: number;
  archiveSample: Array<{ id: string; name: string; companyType: string | null; contacts: number }>;
}

async function computeRelevance(): Promise<{ report: RelevanceReport; archiveIds: string[] }> {
  const brands = (await pool.query(
    `SELECT c.id, c.name, c.company_type, c.archived_at,
            (SELECT COUNT(*) FROM crm_contacts ct WHERE ct.company_id = c.id)::int AS contacts
       FROM crm_companies c WHERE ${BRAND} ORDER BY c.name`)).rows;
  const keep = new Set<string>();
  const signals: RelevanceReport["signals"] = {};
  for (const [key, sig] of Object.entries(SIGNALS)) {
    try {
      const r = await pool.query(sig.sql);
      let n = 0;
      for (const row of r.rows) if (row.id) { keep.add(String(row.id)); n++; }
      signals[key] = { label: sig.label, count: n };
    } catch (e: any) {
      signals[key] = { label: sig.label, count: 0, unavailable: true };
      console.warn(`[brand-relevance] signal ${key} skipped: ${e?.message}`);
    }
  }
  const live = brands.filter((b: any) => !b.archived_at);
  const toArchive = live.filter((b: any) => !keep.has(b.id));
  return {
    archiveIds: toArchive.map((b: any) => b.id),
    report: {
      totalBrands: brands.length,
      alreadyArchived: brands.length - live.length,
      keep: live.length - toArchive.length,
      archive: toArchive.length,
      signals,
      contactsOnlyArchived: toArchive.filter((b: any) => b.contacts > 0).length,
      archiveSample: toArchive.slice(0, 300).map((b: any) => ({ id: b.id, name: b.name, companyType: b.company_type, contacts: b.contacts })),
    },
  };
}

export function setupBrandRelevanceRoutes(app: Express) {
  app.get("/api/admin/brand-relevance", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json((await computeRelevance()).report); }
    catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // Archive every brand with no signal. Recomputed here, never trusted from
  // the client.
  app.post("/api/admin/brand-relevance/apply", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const { archiveIds } = await computeRelevance();
      const userId = req.session?.userId || req.tokenUserId || null;
      const r = archiveIds.length
        ? await pool.query(
            `UPDATE crm_companies SET archived_at = NOW(), archived_reason = $2, archived_by = $3
              WHERE id = ANY($1::text[]) AND archived_at IS NULL AND company_type ILIKE 'Tenant%'`,
            [archiveIds, `No BGP or client activity found (brand tidy, ${new Date().toISOString().slice(0, 10)})`, userId])
        : { rowCount: 0 };
      console.log(`[brand-relevance] archived ${r.rowCount} brands by ${userId}`);
      res.json({ ok: true, archived: r.rowCount });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  app.get("/api/admin/brand-relevance/archived", requireAuth, requireAdmin, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const r = await pool.query(
        `SELECT c.id, c.name, c.company_type, c.domain, c.archived_at, c.archived_reason FROM crm_companies c
          WHERE ${BRAND} AND c.archived_at IS NOT NULL ${q ? "AND c.name ILIKE $1" : ""}
          ORDER BY c.name LIMIT 500`, q ? [`%${q.replace(/[%_\\]/g, "\\$&")}%`] : []);
      res.json({ brands: r.rows.map((b: any) => ({ id: b.id, name: b.name, companyType: b.company_type, domain: b.domain, archivedAt: b.archived_at, reason: b.archived_reason })) });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  app.post("/api/admin/brand-relevance/restore", requireAuth, requireAdmin, async (req, res) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : req.body?.id ? [String(req.body.id)] : [];
      if (!ids.length) return res.status(400).json({ error: "Which brand?" });
      const r = await pool.query(`UPDATE crm_companies SET archived_at = NULL, archived_reason = NULL, archived_by = NULL WHERE id = ANY($1::text[])`, [ids]);
      res.json({ ok: true, restored: r.rowCount });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  app.post("/api/admin/brand-relevance/archive", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const id = String(req.body?.id || "");
      if (!id) return res.status(400).json({ error: "Which brand?" });
      const userId = req.session?.userId || req.tokenUserId || null;
      const r = await pool.query(`UPDATE crm_companies c SET archived_at = NOW(), archived_reason = $2, archived_by = $3 WHERE c.id = $1 AND ${BRAND}`, [id, "Archived by hand", userId]);
      if (!r.rowCount) return res.status(404).json({ error: "Not a brand" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });
}
