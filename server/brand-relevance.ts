// Brand tidy (Woody, 2026-11-11: "we have too many brands — reduce to those
// relevant to BGP and Landsec; ok if we have to re-add"; 2026-11-12: "dont
// archive just delete them or hide"). A brand is kept when anything in the
// app ties it to BGP's or a client's work. The rest are HIDDEN: the
// archived_at flag on crm_companies takes them out of the directory — Brand
// Explorer, the hub, search, the client slice — without touching the row,
// deals or tenancies, and Unhide clears it. A hidden brand that nothing at
// all points at can then be DELETED for good by an admin. Preview first,
// then apply; each signal is its own query, and Hide / Delete refuse to run
// when any signal could not be checked (a missing check would hide more).
import type { Express } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import { storage } from "./storage";

const BRAND = `c.company_type ILIKE 'Tenant%' AND c.merged_into_id IS NULL`;
const SWEEP_REASON = "No BGP or client activity found";
const HAND_REASON = "Hidden by hand";

// Free-text names on schedules, offers and briefs are matched to brands by
// a key with case, spacing, punctuation and company suffixes removed, so
// "Caffè Nero Ltd" on a schedule keeps the brand "Caffe Nero" even when the
// row has no link to it.
export const key = (expr: string) => `regexp_replace(regexp_replace(translate(lower(trim(${expr})), 'àáâãäåèéêëìíîïòóôõöùúûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
  '\\s+(ltd|limited|plc|llp|inc|incorporated|corp|corporation|holdings|group|uk|gb|company|co)\\.?$', '', 'g'), '[^a-z0-9]+', '', 'g')`;
const BRAND_KEYS = `SELECT c.id, ${key("c.name")} AS k FROM crm_companies c WHERE ${BRAND}
    UNION SELECT c.id, ${key("entity->>'name'")} FROM crm_companies c,
      jsonb_array_elements(CASE WHEN jsonb_typeof(c.trading_entities) = 'array' THEN c.trading_entities ELSE '[]'::jsonb END) AS entity
     WHERE ${BRAND} AND entity->>'name' IS NOT NULL`;
const nameMatch = (namesSql: string) => `WITH names AS (${namesSql}), keys AS (SELECT DISTINCT ${key("n")} AS k FROM names WHERE n IS NOT NULL),
    brand_keys AS (${BRAND_KEYS})
    SELECT DISTINCT b.id FROM brand_keys b JOIN keys ON keys.k = b.k WHERE length(b.k) >= 3`;
const listed = (col: string, table: string) => `SELECT regexp_split_to_table(${col}, '[,;/|•\\n\\r]+') AS n FROM ${table} WHERE ${col} IS NOT NULL`;

// Each signal returns the ids of brands it keeps. `pins` marks the signals
// that also block a permanent delete but do not stop a brand being hidden
// (Woody: a brand with contacts and no activity may be hidden).
export const SIGNALS: Record<string, { label: string; sql: string; deleteOnly?: boolean }> = {
  tenant: { label: "Tenant on a schedule", sql: `SELECT DISTINCT tenant_company_id AS id FROM tenancy_schedule_units WHERE tenant_company_id IS NOT NULL
    UNION SELECT DISTINCT tenant_company_id FROM leasing_schedule_units WHERE tenant_company_id IS NOT NULL` },
  namedTenant: { label: "Named as a tenant, offer or viewing (by name)", sql: nameMatch(`SELECT tenant_name AS n FROM tenancy_schedule_units
    UNION SELECT trading_name FROM tenancy_schedule_units
    UNION SELECT tenant_name FROM leasing_schedule_units
    UNION SELECT company_name FROM unit_offers
    UNION SELECT company_name FROM unit_viewings
    UNION SELECT operator_name FROM unit_target_operators`) },
  deal: { label: "On a BGP transaction (any party)", sql: `SELECT DISTINCT unnest(ARRAY[tenant_id, landlord_id, vendor_id, purchaser_id, vendor_agent_id, acquisition_agent_id, purchaser_agent_id, leasing_agent_id, joint_agent_id]) AS id FROM crm_deals
    UNION SELECT DISTINCT company_id FROM crm_company_deals` },
  targeted: { label: "Targeted at a unit", sql: `SELECT DISTINCT unnest(target_company_ids) AS id FROM leasing_schedule_units WHERE target_company_ids IS NOT NULL
    UNION SELECT DISTINCT unnest(target_company_ids) FROM tenancy_schedule_units WHERE target_company_ids IS NOT NULL
    UNION SELECT DISTINCT company_id FROM unit_target_operators WHERE company_id IS NOT NULL AND COALESCE(status, '') NOT IN ('Passed')` },
  namedTarget: { label: "Named in a unit's target list or agreed brief", sql: nameMatch(`${listed("target_brands", "leasing_schedule_units")}
    UNION ${listed("optimum_target", "leasing_schedule_units")}
    UNION ${listed("target_tenants", "tenancy_schedule_units")}
    UNION ${listed("brief_target_brands", "landsec_units")}`) },
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
  // Brand CRM "Wanted" lines: a brand BGP wants at a scheme is kept.
  schemeTarget: { label: "Wanted at a scheme (Brand CRM)", sql: `SELECT DISTINCT company_id AS id FROM brand_scheme_targets WHERE ruled_out_at IS NULL` },
  represented: { label: "Represented by an agent (current)", sql: `SELECT DISTINCT brand_company_id AS id FROM brand_agent_representations WHERE end_date IS NULL` },
  parent: { label: "Parent of another company", sql: `SELECT DISTINCT parent_company_id AS id FROM crm_companies WHERE parent_company_id IS NOT NULL AND merged_into_id IS NULL` },
  kyc: { label: "KYC or AML work on file", sql: `SELECT id FROM crm_companies c WHERE ${BRAND} AND (c.kyc_status IS NOT NULL OR c.aml_checklist IS NOT NULL)
    UNION SELECT DISTINCT company_id FROM kyc_documents WHERE company_id IS NOT NULL
    UNION SELECT DISTINCT crm_company_id FROM kyc_investigations WHERE crm_company_id IS NOT NULL` },
  recent: { label: "Added in the last 90 days", sql: `SELECT id FROM crm_companies c WHERE ${BRAND} AND c.created_at > NOW() - INTERVAL '90 days'` },
  // These do not stop a brand being hidden; they do stop it being deleted.
  contacts: { label: "Has contacts", deleteOnly: true, sql: `SELECT DISTINCT company_id AS id FROM crm_contacts WHERE company_id IS NOT NULL` },
  property: { label: "Linked to a property", deleteOnly: true, sql: `SELECT DISTINCT company_id AS id FROM crm_company_properties
    UNION SELECT DISTINCT company_id FROM crm_property_tenants
    UNION SELECT DISTINCT unnest(ARRAY[landlord_id, freeholder_id, long_leaseholder_id, senior_lender_id, junior_lender_id, asset_manager_id]) FROM crm_properties` },
  // The table cascades on company delete, so a ruled-out line still pins the brand.
  anyWish: { label: "Any Wanted line, live or ruled out", deleteOnly: true, sql: `SELECT DISTINCT company_id AS id FROM brand_scheme_targets` },
  anyHistory: { label: "Any requirement or interaction, at any date", deleteOnly: true, sql: `SELECT DISTINCT company_id AS id FROM crm_requirements_leasing WHERE company_id IS NOT NULL
    UNION SELECT DISTINCT company_id FROM crm_interactions WHERE company_id IS NOT NULL
    UNION SELECT DISTINCT brand_company_id FROM brand_agent_representations` },
  // Duplicates merged into a brand point at it; deleting it would leave them pointing nowhere.
  merged: { label: "Other records merged into it", deleteOnly: true, sql: `SELECT DISTINCT merged_into_id AS id FROM crm_companies WHERE merged_into_id IS NOT NULL` },
};

// Brand Explorer's Select and Delete (Woody, 2026-11-19: "put a select and
// delete button so I can bulk delete them"). Of the brands an admin ticks,
// one that no other record points at is deleted for good; one that something
// does point at (a deal, a schedule, contacts, a requirement, an interaction,
// a property link, a KYC file, a record merged into it, any other check
// above) is hidden instead, as Hide does, and the reply says what it is tied
// to. Being new or flagged (the Super Brand star, a pipeline stage) only ever
// kept a brand from the automatic sweep, never from a person's own choice, so
// neither stops a delete here.
export const HAND_DELETE_IGNORES = new Set(["recent", "flagged"]);
export const BULK_DELETE_MAX = 500;

export type BulkDeletePlan = {
  remove: Array<{ id: string; name: string }>;
  hide: Array<{ id: string; name: string; ties: string[] }>;
  staysHidden: Array<{ id: string; name: string; ties: string[] }>;
  notBrands: string[];
};

export function bulkDeletePlan(ids: string[], brands: Array<{ id: string; name: string; archived_at?: unknown }>, ties: Map<string, string[]>): BulkDeletePlan {
  const byId = new Map(brands.map(b => [String(b.id), b]));
  const plan: BulkDeletePlan = { remove: [], hide: [], staysHidden: [], notBrands: [] };
  for (const id of ids) {
    const brand = byId.get(id);
    if (!brand) { plan.notBrands.push(id); continue; }
    const why = ties.get(id) || [];
    if (!why.length) plan.remove.push({ id, name: brand.name });
    else if (brand.archived_at) plan.staysHidden.push({ id, name: brand.name, ties: why });
    else plan.hide.push({ id, name: brand.name, ties: why });
  }
  return plan;
}

// What each of `ids` is tied to, by the label of every check that finds it.
async function brandTies(ids: string[]): Promise<{ ties: Map<string, string[]>; failed: string[] }> {
  const wanted = new Set(ids);
  const ties = new Map<string, string[]>();
  const failed: string[] = [];
  for (const [name, sig] of Object.entries(SIGNALS)) {
    if (HAND_DELETE_IGNORES.has(name)) continue;
    try {
      for (const row of (await pool.query(sig.sql)).rows) {
        const id = row.id ? String(row.id) : "";
        if (!wanted.has(id)) continue;
        const list = ties.get(id) || [];
        if (!list.includes(sig.label)) list.push(sig.label);
        ties.set(id, list);
      }
    } catch (e: any) {
      failed.push(sig.label);
      console.warn(`[brand-relevance] signal ${name} skipped: ${e?.message}`);
    }
  }
  return { ties, failed };
}

export interface RelevanceReport {
  totalBrands: number;
  alreadyArchived: number;
  keep: number;
  archive: number;
  // Brands the sweep hid earlier that now have a tie to live work; Apply
  // brings them back. Brands hidden by hand are left alone.
  unhide: number;
  // Hidden brands nothing at all points at — the only ones Delete touches.
  deletable: number;
  signals: Record<string, { label: string; count: number; unavailable?: boolean; deleteOnly?: boolean }>;
  failedSignals: string[];
  contactsOnlyArchived: number;
  archiveSample: Array<{ id: string; name: string; companyType: string | null; contacts: number }>;
}

async function computeRelevance(): Promise<{ report: RelevanceReport; archiveIds: string[]; unhideIds: string[]; deletableIds: string[] }> {
  const brands = (await pool.query(
    `SELECT c.id, c.name, c.company_type, c.archived_at, c.archived_reason,
            (SELECT COUNT(*) FROM crm_contacts ct WHERE ct.company_id = c.id)::int AS contacts
       FROM crm_companies c WHERE ${BRAND} ORDER BY c.name`)).rows;
  const brandIds = new Set<string>(brands.map((b: any) => String(b.id)));
  const keep = new Set<string>();
  const pinned = new Set<string>();
  const signals: RelevanceReport["signals"] = {};
  const failedSignals: string[] = [];
  for (const [name, sig] of Object.entries(SIGNALS)) {
    try {
      const r = await pool.query(sig.sql);
      let n = 0;
      // Count brands only: these queries also return landlords and agents.
      for (const row of r.rows) if (row.id && brandIds.has(String(row.id))) { (sig.deleteOnly ? pinned : keep).add(String(row.id)); n++; }
      signals[name] = { label: sig.label, count: n, ...(sig.deleteOnly ? { deleteOnly: true } : {}) };
    } catch (e: any) {
      signals[name] = { label: sig.label, count: 0, unavailable: true, ...(sig.deleteOnly ? { deleteOnly: true } : {}) };
      failedSignals.push(sig.label);
      console.warn(`[brand-relevance] signal ${name} skipped: ${e?.message}`);
    }
  }
  const live = brands.filter((b: any) => !b.archived_at);
  const hidden = brands.filter((b: any) => b.archived_at);
  const toArchive = live.filter((b: any) => !keep.has(b.id));
  const toUnhide = hidden.filter((b: any) => keep.has(b.id) && String(b.archived_reason || "").startsWith(SWEEP_REASON));
  const deletable = hidden.filter((b: any) => !keep.has(b.id) && !pinned.has(b.id));
  return {
    archiveIds: toArchive.map((b: any) => b.id),
    unhideIds: toUnhide.map((b: any) => b.id),
    deletableIds: deletable.map((b: any) => b.id),
    report: {
      totalBrands: brands.length,
      alreadyArchived: hidden.length,
      keep: live.length - toArchive.length,
      archive: toArchive.length,
      unhide: toUnhide.length,
      deletable: deletable.length,
      signals,
      failedSignals,
      contactsOnlyArchived: toArchive.filter((b: any) => b.contacts > 0).length,
      archiveSample: toArchive.slice(0, 300).map((b: any) => ({ id: b.id, name: b.name, companyType: b.company_type, contacts: b.contacts })),
    },
  };
}

const failedMessage = (failed: string[]) => `Not run: ${failed.length} check${failed.length === 1 ? "" : "s"} could not be made (${failed.join("; ")}), so brands tied to that work could not be told apart. Nothing was changed.`;

// A hidden brand with the same name as one being added: re-adding brings
// the old record back with its history instead of making a duplicate.
export async function unhideBrandByName(name: string): Promise<any | null> {
  const n = String(name || "").trim();
  if (!n) return null;
  try {
    const r = await pool.query(
      `UPDATE crm_companies SET archived_at = NULL, archived_reason = NULL, archived_by = NULL
        WHERE id = (SELECT c.id FROM crm_companies c WHERE ${BRAND} AND c.archived_at IS NOT NULL AND ${key("c.name")} = ${key("$1::text")} ORDER BY c.created_at LIMIT 1)
        RETURNING id`, [n]);
    return r.rows[0] ? (await storage.getCrmCompany(r.rows[0].id)) || null : null;
  } catch (e: any) {
    console.warn(`[brand-relevance] unhide by name failed: ${e?.message}`);
    return null;
  }
}

export function setupBrandRelevanceRoutes(app: Express) {
  app.get("/api/admin/brand-relevance", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json((await computeRelevance()).report); }
    catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // Hide every brand with no signal, and bring back any the sweep hid that
  // has gained one. Recomputed here, never trusted from the client.
  app.post("/api/admin/brand-relevance/apply", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const { archiveIds, unhideIds, report } = await computeRelevance();
      if (report.failedSignals.length) return res.status(409).json({ error: failedMessage(report.failedSignals) });
      const userId = req.session?.userId || req.tokenUserId || null;
      const r = archiveIds.length
        ? await pool.query(
            `UPDATE crm_companies SET archived_at = NOW(), archived_reason = $2, archived_by = $3
              WHERE id = ANY($1::text[]) AND archived_at IS NULL AND company_type ILIKE 'Tenant%'`,
            [archiveIds, `${SWEEP_REASON} (brand tidy, ${new Date().toISOString().slice(0, 10)})`, userId])
        : { rowCount: 0 };
      const u = unhideIds.length
        ? await pool.query(`UPDATE crm_companies SET archived_at = NULL, archived_reason = NULL, archived_by = NULL WHERE id = ANY($1::text[])`, [unhideIds])
        : { rowCount: 0 };
      console.log(`[brand-relevance] hid ${r.rowCount} brands, unhid ${u.rowCount}, by ${userId}`);
      res.json({ ok: true, archived: r.rowCount, unhidden: u.rowCount });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // The hidden list, each row marked with whether Delete would take it.
  app.get("/api/admin/brand-relevance/archived", requireAuth, requireAdmin, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const [r, rel] = await Promise.all([
        pool.query(
          `SELECT c.id, c.name, c.company_type, c.domain, c.archived_at, c.archived_reason FROM crm_companies c
            WHERE ${BRAND} AND c.archived_at IS NOT NULL ${q ? "AND c.name ILIKE $1" : ""}
            ORDER BY c.name LIMIT 500`, q ? [`%${q.replace(/[%_\\]/g, "\\$&")}%`] : []),
        computeRelevance(),
      ]);
      const canDelete = rel.report.failedSignals.length ? new Set<string>() : new Set(rel.deletableIds);
      res.json({
        total: rel.report.alreadyArchived, deletable: canDelete.size, failedSignals: rel.report.failedSignals,
        brands: r.rows.map((b: any) => ({ id: b.id, name: b.name, companyType: b.company_type, domain: b.domain, archivedAt: b.archived_at, reason: b.archived_reason, deletable: canDelete.has(b.id) })),
      });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  app.post("/api/admin/brand-relevance/restore", requireAuth, requireAdmin, async (req, res) => {
    try {
      const ids: string[] = req.body?.all === true
        ? (await pool.query(`SELECT c.id FROM crm_companies c WHERE ${BRAND} AND c.archived_at IS NOT NULL`)).rows.map((x: any) => x.id)
        : Array.isArray(req.body?.ids) ? req.body.ids.map(String) : req.body?.id ? [String(req.body.id)] : [];
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
      const r = await pool.query(`UPDATE crm_companies c SET archived_at = NOW(), archived_reason = $2, archived_by = $3 WHERE c.id = $1 AND ${BRAND}`, [id, HAND_REASON, userId]);
      if (!r.rowCount) return res.status(404).json({ error: "Not a brand" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // Select and Delete on Brand Explorer: delete for good what nothing points
  // at, hide the rest. Every check is made again here; if any cannot be
  // made, nothing is changed.
  app.post("/api/admin/brand-relevance/bulk-delete", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids) ? [...new Set<string>(req.body.ids.map(String).filter(Boolean))] : [];
      if (!ids.length) return res.status(400).json({ error: "Tick the brands to delete." });
      if (ids.length > BULK_DELETE_MAX) return res.status(400).json({ error: `Delete at most ${BULK_DELETE_MAX} brands at a time.` });
      const { ties, failed } = await brandTies(ids);
      if (failed.length) return res.status(409).json({ error: failedMessage(failed) });
      const brands = (await pool.query(
        `SELECT c.id, c.name, c.archived_at FROM crm_companies c WHERE c.id = ANY($1::text[]) AND ${BRAND} ORDER BY c.name`, [ids])).rows;
      const plan = bulkDeletePlan(ids, brands, ties);
      const userId = req.session?.userId || req.tokenUserId || null;
      const deleted: Array<{ id: string; name: string }> = [];
      const notDeleted: Array<{ id: string; name: string }> = [];
      for (const brand of plan.remove) {
        try { await storage.deleteCrmCompany(brand.id); deleted.push(brand); }
        catch (e: any) { notDeleted.push(brand); console.warn(`[brand-relevance] bulk delete ${brand.id} failed: ${e?.message}`); }
      }
      if (plan.hide.length) {
        await pool.query(
          `UPDATE crm_companies c SET archived_at = NOW(), archived_reason = $2, archived_by = $3 WHERE c.id = ANY($1::text[]) AND c.archived_at IS NULL AND ${BRAND}`,
          [plan.hide.map(b => b.id), HAND_REASON, userId]);
      }
      console.log(`[brand-relevance] bulk delete by ${userId}: ${deleted.length} deleted, ${plan.hide.length} hidden, ${plan.staysHidden.length} already hidden, ${notDeleted.length} failed`);
      res.json({ ok: true, deleted, hidden: plan.hide, staysHidden: plan.staysHidden, notBrands: plan.notBrands.length, failed: notDeleted });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  // Delete hidden brands for good. Only a hidden brand that nothing points
  // at goes: no tie to live work, no contacts, no property link, no KYC or
  // AML file, no requirement or interaction at any date, no name on a
  // schedule or brief. Eligibility is recomputed here; anything else asked
  // for is skipped and reported, never forced.
  app.post("/api/admin/brand-relevance/delete", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const { deletableIds, report } = await computeRelevance();
      if (report.failedSignals.length) return res.status(409).json({ error: failedMessage(report.failedSignals) });
      const asked: string[] | null = req.body?.all === true ? null : Array.isArray(req.body?.ids) ? req.body.ids.map(String) : req.body?.id ? [String(req.body.id)] : [];
      if (asked && !asked.length) return res.status(400).json({ error: "Which brand?" });
      const eligible = new Set(deletableIds);
      const ids = asked ? asked.filter(id => eligible.has(id)) : deletableIds;
      const userId = req.session?.userId || req.tokenUserId || null;
      let deleted = 0; const failed: string[] = [];
      for (const id of ids) {
        try { await storage.deleteCrmCompany(id); deleted++; }
        catch (e: any) { failed.push(id); console.warn(`[brand-relevance] delete ${id} failed: ${e?.message}`); }
      }
      console.log(`[brand-relevance] deleted ${deleted} hidden brands by ${userId}`);
      res.json({ ok: true, deleted, skipped: (asked ? asked.length - ids.length : 0) + failed.length });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });
}
