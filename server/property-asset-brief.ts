// Property Asset Brief — the client-facing operational dashboard for
// a property. Everything except the weekly focus and asset-lead
// commentary is derived live so the leasing team don't have to
// retype anything the CRM already knows.
//
// Sections returned:
//   header           — client logo / asset lead / last updated
//   weekly_focus     — the 3-5 things being pushed this week
//                      (lives in crm_properties.weekly_focus jsonb)
//   active_deals     — derived from crm_deals on units in this
//                      property, status NOT IN (WIT, COM, INV)
//   pipeline         — counts by stage for the funnel widget
//   activity         — last 14 days of crm_interactions tied to
//                      deals on this property; SUMMARIES only
//                      (no email body / preview content), matching
//                      the client-friendly access rule
//   risks            — auto-flagged from the leasing schedule:
//                      long-vacant units, expiry without renewal,
//                      tenants in admin, arrears balances
//   performance      — vacancy rate + WAULT + top/bottom MAT psqft
//   commentary       — the existing crm_properties.notes text
//                      lives on under this name in the new shape
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

interface FocusItem {
  id: string;
  text: string;
  owner_user_id?: string | null;
  deal_id?: string | null;
}

export function briefOccupancy(status: unknown): "occupied" | "vacant" | "unknown" {
  const value = String(status || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (["vacant", "available", "void", "ava"].includes(value)) return "vacant";
  if (["occupied", "trading", "let", "not vacant", "holding over", "taw", "lease event", "lease event pending"].includes(value)) return "occupied";
  // Marketing/deal stages alone cannot establish whether the occupier has left.
  return "unknown";
}

export function summariseBriefSchedule(rows: any[], failed = false, now = Date.now()) {
  const occupied = rows.filter(row => briefOccupancy(row.status) === "occupied");
  const vacant = rows.filter(row => briefOccupancy(row.status) === "vacant");
  const unknown = rows.length - occupied.length - vacant.length;
  const legacy = rows.some(row => row.schedule_source !== "tenancy");
  const missingExpiry = occupied.some(row => !row.lease_expiry || !Number.isFinite(new Date(row.lease_expiry).getTime()));
  const status: "ready" | "partial" | "missing" | "error" = failed ? "error" : !rows.length ? "missing" : legacy || unknown > 0 ? "partial" : "ready";
  const risksStatus = status === "ready" && missingExpiry ? "partial" : status;
  const message = failed ? null : !rows.length ? "No tenancy schedule is recorded. Vacancy and lease risk checks are unavailable."
    : legacy ? "Only a legacy leasing schedule is recorded. Confirm the full tenancy schedule before relying on property totals."
      : unknown ? `${unknown} unit${unknown === 1 ? " has" : "s have"} no confirmed occupancy status. Vacancy is unavailable.`
        : missingExpiry ? "Some occupied units have no valid lease expiry. Lease risk checks are incomplete." : null;
  const rentComplete = occupied.length > 0 && occupied.every(row => row.rent_pa != null && Number.isFinite(Number(row.rent_pa)) && Number(row.rent_pa) > 0);
  const totalRent = rentComplete ? occupied.reduce((sum, row) => sum + Number(row.rent_pa), 0) : 0;
  const weightedTerm = status === "ready" && !missingExpiry && totalRent > 0
    ? occupied.reduce((sum, row) => sum + Number(row.rent_pa) * Math.max(0, new Date(row.lease_expiry).getTime() - now) / 31557600000, 0) / totalRent
    : null;
  return {
    status, risksStatus, message,
    performance: {
      total_units: failed ? null : rows.length,
      occupied_units: failed ? null : occupied.length,
      vacant_units: failed ? null : vacant.length,
      unknown_units: failed ? null : unknown,
      vacancy_rate: status === "ready" ? vacant.length / rows.length : null,
      wault_years: weightedTerm,
      source: failed || !rows.length ? null : legacy ? "leasing" : "tenancy",
    },
  };
}

router.get("/api/properties/:id/asset-brief", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const dataQuality: Record<string, "ready" | "partial" | "missing" | "error"> = {
      deals: "ready", lettings: "ready", activity: "ready", schedule: "ready", risks: "ready", trading: "ready",
    };
    const dataWarnings: Array<{ section: string; message: string }> = [];
    const unavailable = (section: string, message: string) => (error: any) => {
      console.error(`[asset-brief] ${section} query failed:`, error?.message);
      if (dataQuality[section] !== "error") dataWarnings.push({ section, message });
      dataQuality[section] = "error";
      return { rows: [] as any[] };
    };

    // Clients only read briefs for their own properties, and never BGP's
    // fee figures. (Landsec audit.)
    const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
    const briefScope = await resolveCompanyScope(req as any);
    if (briefScope && !(await isPropertyInScope(briefScope, String(propertyId)))) {
      return res.status(403).json({ error: "Not available for this account" });
    }

    // 1. Property + linked landlord / freeholder (whichever wins) so
    //    we can resolve the client logo + asset lead.
    const propRow = await pool.query<{
      id: string; name: string; address: any; postcode: string | null;
      landlord_id: string | null; freeholder_id: string | null; long_leaseholder_id: string | null;
      bgp_contact_user_ids: string[] | null;
      weekly_focus: FocusItem[] | null;
      notes: string | null;
      updated_at: string;
    }>(
      `SELECT id, name, address, postcode,
              landlord_id, freeholder_id, long_leaseholder_id,
              bgp_contact_user_ids, weekly_focus, notes, updated_at
         FROM crm_properties WHERE id = $1`,
      [propertyId]
    );
    if (propRow.rows.length === 0) return res.status(404).json({ error: "Property not found" });
    const p = propRow.rows[0];
    const ownerCompanyId = p.freeholder_id || p.long_leaseholder_id || p.landlord_id || null;

    // Owner company → logo + name. We expose the brand-logo route
    // URL rather than a binary blob so the client renders it through
    // its existing img pipeline.
    let owner: { id: string; name: string; logo_url: string; domain: string | null } | null = null;
    if (ownerCompanyId) {
      const r = await pool.query<{ name: string; domain: string | null }>(
        `SELECT name, domain FROM crm_companies WHERE id = $1`,
        [ownerCompanyId]
      );
      if (r.rows[0]) {
        const cleanDomain = (r.rows[0].domain || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
        owner = {
          id: ownerCompanyId,
          name: r.rows[0].name,
          logo_url: `/api/brand-logo/${encodeURIComponent(r.rows[0].name)}${cleanDomain ? `?domain=${encodeURIComponent(cleanDomain)}` : ""}`,
          domain: cleanDomain || null,
        };
      }
    }

    // Asset lead — first id on bgp_contact_user_ids[] wins.
    let assetLead: { id: string; name: string; email: string | null; avatar_url: string | null } | null = null;
    if (Array.isArray(p.bgp_contact_user_ids) && p.bgp_contact_user_ids.length > 0) {
      const r = await pool.query<{ id: string; name: string; email: string; profile_pic_url: string | null }>(
        `SELECT id, COALESCE(name, username, email) AS name, email, profile_pic_url
           FROM users WHERE id = $1`,
        [p.bgp_contact_user_ids[0]]
      );
      if (r.rows[0]) {
        assetLead = { id: r.rows[0].id, name: r.rows[0].name, email: r.rows[0].email, avatar_url: r.rows[0].profile_pic_url };
      }
    }

    // 2. Active deals — anything not in a terminal state, joined to
    //    the unit's name + tenant company for logos + the BGP owner.
    const dealsQ = await pool.query<any>(
      // Agents live on crm_deals.internal_agent_ids (a varchar[]); fee is
      // the deal-level `fee` column in pounds. The old query read a
      // non-existent deal_fee_allocations.amount_pence column (the real
      // columns are percentage / fixed_amount) — that threw, the error
      // was swallowed by the .catch, and the panel showed 0 active deals
      // even though deals were correctly linked to the property. (It also
      // array_agg'd from crm_deal_agents, which exists but is empty in
      // practice — internal_agent_ids is the populated source.)
      `SELECT d.id, d.name, d.status, d.deal_type, d.updated_at,
              d.unit_id, d.tenant_id, d.tenancy_unit_id,
              COALESCE(ts.unit_number, pu.unit_name) AS unit_name,
              tc.name AS tenant_name, tc.domain AS tenant_domain,
              d.internal_agent_ids AS bgp_user_ids,
              ROUND(COALESCE(d.fee, 0) * 100)::bigint AS fee_pence
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
         LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
        WHERE (d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1)
          AND COALESCE(d.status, '') NOT IN ('WIT', 'COM', 'INV')
        ORDER BY d.updated_at DESC NULLS LAST`,
      [propertyId]
    ).catch(unavailable("deals", "Active deals could not be loaded. Pipeline counts are unavailable."));
    const activeDeals = dealsQ.rows.map(d => ({
      id: d.id,
      name: d.name,
      status: d.status,
      deal_type: d.deal_type,
      stage_label: stageLabel(d.status),
      stage_bucket: stageBucket(d.status),
      unit_id: d.unit_id,
      tenancy_unit_id: d.tenancy_unit_id,
      unit_name: d.unit_name,
      tenant_id: d.tenant_id,
      tenant_name: d.tenant_name,
      tenant_logo_url: d.tenant_name
        ? `/api/brand-logo/${encodeURIComponent(d.tenant_name)}${d.tenant_domain ? `?domain=${encodeURIComponent(d.tenant_domain)}` : ""}`
        : null,
      fee_pence: d.fee_pence,
      bgp_user_ids: d.bgp_user_ids || [],
      last_touch_at: d.updated_at,
    }));

    // 2b. Letting Tracker state — live lettings are worked in
    //     available_units and often have NO crm_deals row, so the brief
    //     (and the commentary generated from it) claimed "nothing
    //     transacting" while the tracker was busy (Woody, Bluewater,
    //     2026-08-03). Surface every unit not yet completed/invoiced.
    const lettingsQ = await pool.query<any>(
      `SELECT au.id, au.unit_name, au.marketing_status, au.sqft, au.asking_rent,
              au.deal_id, au.viewings_count, au.last_viewing_date, tc.name AS operator_name
         FROM available_units au
         LEFT JOIN crm_companies tc ON tc.id = au.tenant_company_id
        WHERE au.property_id = $1
          -- status vocab is mixed word/code case ('Negotiating', 'AVA', 'COM')
          AND lower(COALESCE(au.marketing_status, '')) NOT IN ('completed', 'invoiced', 'withdrawn', 'com', 'inv', 'wit')
        ORDER BY CASE lower(au.marketing_status)
                   WHEN 'exchanged' THEN 0 WHEN 'exc' THEN 0
                   WHEN 'solicitors' THEN 1 WHEN 'sol' THEN 1
                   WHEN 'negotiating' THEN 2 WHEN 'neg' THEN 2
                   WHEN 'under_offer' THEN 3 ELSE 4 END,
                 au.unit_name`,
      [propertyId]
    ).catch(unavailable("lettings", "Letting Tracker could not be loaded. Pipeline counts are unavailable."));
    const lettings = lettingsQ.rows.map(u => ({
      id: u.id,
      unit_name: u.unit_name,
      marketing_status: u.marketing_status,
      sqft: u.sqft,
      asking_rent: u.asking_rent,
      viewings_count: u.viewings_count,
      last_viewing_date: u.last_viewing_date,
      operator_name: u.operator_name,
    }));

    // 3. Pipeline counts — group active deals into the six client-
    //    friendly buckets the funnel renders. Members ride along so the
    //    lozenges can drill down (Woody, 2026-08-05: "what look like
    //    filters but don't actually work").
    const pipeline = {
      engaged: 0, viewed: 0, pitch_out: 0, hots: 0, legals: 0, signed: 0,
    } as Record<string, number>;
    const pipelineItems: Record<string, Array<{ label: string; sub: string | null }>> = {
      engaged: [], viewed: [], pitch_out: [], hots: [], legals: [], signed: [],
    };
    for (const d of activeDeals) {
      const bucket = d.stage_bucket;
      if (pipeline[bucket] !== undefined) {
        pipeline[bucket]++;
        pipelineItems[bucket].push({ label: d.tenant_name || d.name || "Deal", sub: d.unit_name || d.stage_label || null });
      }
    }
    // Letting Tracker units progressing WITHOUT a crm_deals row were
    // invisible here — the funnel said "0 in legals" while seven units sat
    // with solicitors (Woody, 2026-08-04: "are these pipeline lozenges
    // working?"). Fold un-dealed units in by marketing status; units with
    // a linked deal are already counted above.
    for (const u of lettingsQ.rows as any[]) {
      if (u.deal_id) continue;
      const s = (u.marketing_status || "").toLowerCase();
      if (s === "hot" || s === "hots" || s === "neg" || s === "negotiating" || s === "under_offer" || s === "und") {
        pipeline.hots++;
        pipelineItems.hots.push({ label: u.operator_name || u.unit_name, sub: u.operator_name ? u.unit_name : u.marketing_status });
      } else if (s === "sol" || s === "solicitors" || s === "exc" || s === "exchanged") {
        pipeline.legals++;
        pipelineItems.legals.push({ label: u.operator_name || u.unit_name, sub: u.operator_name ? u.unit_name : u.marketing_status });
      }
    }

    // 4. Activity feed — interactions on deals scoped to this property.
    //    SUMMARY only (kind / contact name / direction / date) — we
    //    deliberately don't return the email body / preview so the
    //    client view stays at headline level without leaking content.
    // Two legs: interactions on a DEAL at this property, plus interactions
    // with contacts at the property's client/landlord company. The hourly
    // M365 sync links emails/meetings to CONTACTS (never deals), so the
    // deal leg alone rendered "no activity" on accounts with daily traffic
    // (the Landsec case). The company leg is limited to the property's
    // assigned BGP agents so a busy landlord's every touchpoint firm-wide
    // doesn't flood each of their properties; when nobody is assigned yet,
    // any BGP user counts.
    const activityQ = await pool.query<any>(
      `SELECT i.id, i.type, i.direction, i.interaction_date,
              COALESCE(bu.name, i.bgp_user) AS bgp_user,
              c.name AS contact_name,
              co.name AS company_name,
              d.id AS deal_id, d.name AS deal_name
         FROM crm_interactions i
         LEFT JOIN users bu ON lower(bu.email) = lower(i.bgp_user)
         LEFT JOIN crm_contacts c ON c.id = i.contact_id
         LEFT JOIN crm_companies co ON co.id = c.company_id
         LEFT JOIN crm_deals d ON d.id = i.deal_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
        WHERE i.interaction_date > NOW() - INTERVAL '14 days'
          AND (
            (d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1)
            OR (
              c.company_id IN (
                SELECT p2.landlord_id FROM crm_properties p2 WHERE p2.id = $1 AND p2.landlord_id IS NOT NULL
                UNION
                SELECT cp.company_id FROM crm_company_properties cp WHERE cp.property_id = $1
              )
              AND (
                NOT EXISTS (SELECT 1 FROM crm_property_agents pa WHERE pa.property_id = $1)
                OR lower(coalesce(i.bgp_user, '')) IN (
                  SELECT lower(u2.email) FROM crm_property_agents pa
                    JOIN users u2 ON u2.id = pa.user_id
                   WHERE pa.property_id = $1 AND u2.email IS NOT NULL
                )
              )
            )
          )
        ORDER BY i.interaction_date DESC
        LIMIT 30`,
      [propertyId]
    ).catch(unavailable("activity", "Recent activity could not be loaded."));
    const activity = activityQ.rows.map(a => ({
      id: a.id,
      kind: a.type,                                  // email / call / meeting / note
      direction: a.direction,                        // inbound / outbound
      date: a.interaction_date,
      bgp_user: a.bgp_user,
      contact_name: a.contact_name,
      company_name: a.company_name,
      deal_id: a.deal_id,
      deal_name: a.deal_name,
      // Sanitised summary line — no email body / preview. The client
      // sees that the touch happened; not what was said.
      summary: buildActivitySummary(a),
    }));

    // 5. Risk register. Three sources today:
    //    a) Vacancies that have been on the schedule a while
    //       (leasing_schedule_units status flagged vacant).
    //    b) Lease expiries < 18 months from now with no active deal
    //       on the same unit.
    //    c) Tenants whose covenants flag admin / arrears.
    const risks: Array<{ kind: string; severity: "high" | "med"; message: string; unit_id?: string; unit_name?: string; deal_id?: string }> = [];

    // Read the same master rent roll as the visible tenancy board. Some
    // older properties only have a leasing projection; retain it explicitly
    // as partial coverage rather than presenting it as the full rent roll.
    const lsuQ = await pool.query<any>(
      `WITH schedule_source AS (
         SELECT id, COALESCE(unit_number, premises) AS unit_name, tenant_name,
                COALESCE(NULLIF(trim(occupancy_status), ''), status) AS status,
                lease_expiry, break_date AS lease_break, tenant_company_id,
                id AS tenancy_unit_id, passing_rent_pa AS rent_pa, 'tenancy' AS schedule_source
           FROM tenancy_schedule_units WHERE property_id = $1
             AND lower(COALESCE(NULLIF(trim(occupancy_status), ''), status, '')) <> 'archived'
         UNION ALL
         SELECT id, unit_name, tenant_name, status, lease_expiry, lease_break,
                tenant_company_id, tenancy_unit_id, rent_pa, 'leasing' AS schedule_source
           FROM leasing_schedule_units WHERE property_id = $1
             AND lower(COALESCE(status, '')) <> 'archived'
             AND NOT EXISTS (SELECT 1 FROM tenancy_schedule_units WHERE property_id = $1)
       )
       SELECT u.*, c.aml_pep_status, c.kyc_status,
              (EXISTS (
                SELECT 1 FROM crm_deals d2
                 LEFT JOIN property_units pu2 ON pu2.id = d2.unit_id
                 LEFT JOIN tenancy_schedule_units ts2 ON ts2.id = d2.tenancy_unit_id
                 WHERE (d2.property_id = $1 OR pu2.property_id = $1 OR ts2.property_id = $1)
                   AND COALESCE(d2.status, '') NOT IN ('WIT', 'COM', 'INV')
                   AND (
                     (u.tenancy_unit_id IS NOT NULL AND d2.tenancy_unit_id = u.tenancy_unit_id)
                     OR (d2.tenancy_unit_id IS NULL AND pu2.unit_name = u.unit_name)
                   )
              ) OR EXISTS (
                SELECT 1 FROM available_units au2
                 JOIN crm_deals d3 ON d3.id = au2.deal_id
                 WHERE au2.property_id = $1
                   AND COALESCE(d3.status, '') NOT IN ('WIT', 'COM', 'INV')
                   AND (
                     (u.tenancy_unit_id IS NOT NULL AND au2.tenancy_unit_id = u.tenancy_unit_id)
                     OR (au2.tenancy_unit_id IS NULL AND
                       lower(trim(au2.unit_name)) = lower(trim(coalesce(u.unit_name, ''))))
                   )
              )) AS has_live_deal
         FROM schedule_source u
         LEFT JOIN crm_companies c ON c.id = u.tenant_company_id AND c.merged_into_id IS NULL`,
      [propertyId]
    ).catch(unavailable("schedule", "The tenancy schedule could not be loaded. Vacancy and lease risk checks are unavailable."));
    const scheduleSummary = summariseBriefSchedule(lsuQ.rows, dataQuality.schedule === "error");
    dataQuality.schedule = scheduleSummary.status;
    dataQuality.risks = scheduleSummary.risksStatus;
    if (scheduleSummary.message) dataWarnings.push({ section: "schedule", message: scheduleSummary.message });
    const horizonMs = 18 * 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Vacancies: one summary row, not one per unit — 20 identical amber
    // rows drown the genuine expiry/covenant risks. Only units with NO
    // live deal count as at-risk; vacant-but-under-offer is progress.
    const vacantRows = lsuQ.rows.filter((u: any) => briefOccupancy(u.status) === "vacant");
    const vacantNoDeal = vacantRows.filter((u: any) => !u.has_live_deal);
    if (vacantNoDeal.length > 0) {
      const names = vacantNoDeal.slice(0, 5).map((u: any) => u.unit_name || "Unit").join(", ");
      const more = vacantNoDeal.length > 5 ? ` +${vacantNoDeal.length - 5} more` : "";
      const withDeal = vacantRows.length - vacantNoDeal.length;
      risks.push({
        kind: "vacant",
        severity: "med",
        message: `${vacantNoDeal.length} unit${vacantNoDeal.length === 1 ? "" : "s"} vacant with no active deal (${names}${more})${withDeal > 0 ? ` — a further ${withDeal} vacant with live deals in play` : ""}`,
      });
    }
    for (const u of lsuQ.rows) {
      const expiry = u.lease_expiry ? new Date(u.lease_expiry).getTime() : null;
      if (expiry && !u.has_live_deal && expiry > now && expiry - now < horizonMs) {
        const months = Math.round((expiry - now) / (30 * 86400000));
        risks.push({ kind: "expiry_no_renewal", severity: months < 6 ? "high" : "med", message: `${u.tenant_name || u.unit_name} expires in ${months} months with no live deal`, unit_id: u.id, unit_name: u.unit_name });
      }
      // Tenant in admin / sanctioned — pulled from the linked
      // crm_companies row's KYC fields.
      if (u.kyc_status && /admin|sanctioned/.test(String(u.kyc_status).toLowerCase())) {
        risks.push({ kind: "tenant_admin", severity: "high", message: `${u.tenant_name} flagged ${u.kyc_status} in KYC`, unit_id: u.id, unit_name: u.unit_name });
      }
    }

    // Trading performance remains an optional leasing-schedule measure.
    // Occupancy and lease term come from the master schedule above.
    const topPsqftQ = await pool.query<any>(
      `SELECT unit_name, tenant_name, mat_psqft, lfl_percent
         FROM leasing_schedule_units
        WHERE property_id = $1 AND mat_psqft IS NOT NULL
        ORDER BY mat_psqft DESC NULLS LAST LIMIT 5`,
      [propertyId]
    ).catch(unavailable("trading", "Trading performance could not be loaded."));
    const bottomPsqftQ = await pool.query<any>(
      `SELECT unit_name, tenant_name, mat_psqft, lfl_percent
         FROM leasing_schedule_units
        WHERE property_id = $1 AND mat_psqft IS NOT NULL
        ORDER BY mat_psqft ASC NULLS LAST LIMIT 5`,
      [propertyId]
    ).catch(unavailable("trading", "Trading performance could not be loaded."));
    const performance = {
      ...scheduleSummary.performance,
      top_psqft: topPsqftQ.rows,
      bottom_psqft: bottomPsqftQ.rows,
    };

    // 7. Last-updated heuristic — newest of property update,
    //    latest active-deal touch, latest interaction. Tells the
    //    client how fresh the dashboard is.
    const allDates = [
      p.updated_at,
      ...activeDeals.map(d => d.last_touch_at),
      ...activity.map(a => a.date),
    ].filter(Boolean).map(d => new Date(d as any).getTime()).filter(Number.isFinite);
    const lastUpdatedAt = allDates.length > 0 ? new Date(Math.max(...allDates)).toISOString() : p.updated_at;

    // BGP Commentary — Claude-generated narrative paragraph,
    // persisted on crm_properties.bgp_commentary. Surfaced raw
    // here; regenerated via POST .../bgp-commentary/regenerate.
    const commentaryRow = await pool.query<{ bgp_commentary: string | null; bgp_commentary_at: string | null }>(
      `SELECT bgp_commentary, bgp_commentary_at FROM crm_properties WHERE id = $1`,
      [propertyId]
    );
    const commentaryText = commentaryRow.rows[0]?.bgp_commentary || null;
    const commentaryAt = commentaryRow.rows[0]?.bgp_commentary_at || null;

    res.json({
      property: {
        id: p.id,
        name: p.name,
        address: p.address,
        postcode: p.postcode,
        last_updated_at: lastUpdatedAt,
      },
      owner,
      asset_lead: assetLead,
      weekly_focus: Array.isArray(p.weekly_focus) ? p.weekly_focus : [],
      active_deals: briefScope ? activeDeals.map((d: any) => ({ ...d, fee_pence: null })) : activeDeals,
      lettings,
      pipeline,
      pipeline_items: pipelineItems,
      activity,
      risks,
      performance,
      data_quality: dataQuality,
      data_warnings: dataWarnings,
      commentary: briefScope ? "" : (p.notes || ""),
      bgp_commentary: commentaryText,
      bgp_commentary_at: commentaryAt,
    });
  } catch (err: any) {
    console.error("[asset-brief]", err?.message, err?.stack);
    res.status(500).json({ error: err?.message || "asset brief failed" });
  }
});

// PATCH the weekly focus list. Replaces wholesale — the client sends
// the full ordered array, we save it. Simpler than CRUD-per-item and
// the list is small (3-5 entries typical).
router.patch("/api/properties/:id/weekly-focus", requireAuth, async (req: Request, res: Response) => {
  try {
    if (await (await import("./company-scope")).isClientRequestUser(req as any)) {
      return res.status(403).json({ error: "Read-only access for client accounts" });
    }
    const focus = Array.isArray(req.body?.focus) ? req.body.focus : null;
    if (!focus) return res.status(400).json({ error: "focus must be an array" });
    const cleaned: FocusItem[] = focus
      .filter((x: any) => x && typeof x.text === "string" && x.text.trim())
      .map((x: any) => ({
        id: String(x.id || `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        text: String(x.text).trim().slice(0, 500),
        owner_user_id: x.owner_user_id || null,
        deal_id: x.deal_id || null,
      }))
      .slice(0, 10);
    await pool.query(
      `UPDATE crm_properties SET weekly_focus = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(cleaned), req.params.id]
    );
    res.json({ ok: true, focus: cleaned });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "save failed" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────

// BGP's leasing deal codes (REP / PIT / NEG / AGT / EXC / COM / WIT / INV)
// rolled up into the six client-friendly buckets the funnel widget
// uses. Anything we don't recognise lands in 'engaged' so it's at
// least visible somewhere.
function stageBucket(status: string | null | undefined): string {
  const s = String(status || "").toUpperCase();
  if (s === "EXC") return "legals";
  if (s === "SOL") return "legals";
  if (s === "AGT") return "hots";
  if (s === "HOT") return "hots";
  if (s === "NEG") return "hots";
  if (s === "PIT") return "pitch_out";
  if (s === "REP") return "engaged";
  if (s === "VWD" || s === "VW") return "viewed";
  if (s === "SIG") return "signed";
  return "engaged";
}

function stageLabel(status: string | null | undefined): string {
  const s = String(status || "").toUpperCase();
  const map: Record<string, string> = {
    REP: "Engaged",
    VWD: "Viewed",
    VW: "Viewed",
    PIT: "Pitch out",
    NEG: "Negotiating",
    AGT: "HoTs agreed",
    HOT: "HoTs agreed",
    SOL: "In legals",
    EXC: "In legals",
    SIG: "Signed",
  };
  return map[s] || s || "Engaged";
}

function buildActivitySummary(a: any): string {
  const who = a.contact_name || a.company_name || "contact";
  const by = a.bgp_user ? `${a.bgp_user.split(" ")[0]} ` : "";
  const verb = a.type === "email"
    ? (a.direction === "outbound" ? "emailed" : "got an email from")
    : a.type === "call"
    ? "called"
    : a.type === "meeting"
    ? "met with"
    : "logged a touch with";
  const dealRef = a.deal_name ? ` re ${a.deal_name}` : "";
  return `${by}${verb} ${who}${dealRef}`.trim();
}

// Regenerate the BGP Commentary — pulls the same data the brief
// renders (asset lead, owner, active deals, recent activity, risks,
// performance) and asks Claude Sonnet to write a 3-5 sentence
// operational narrative. Persisted on crm_properties so the panel
// always has a value even when offline.
router.post("/api/properties/:id/bgp-commentary/regenerate", requireAuth, async (req: Request, res: Response) => {
  try {
    // Clients may regenerate commentary on their OWN properties (Woody,
    // 2026-08-03 — Mark Warne hit the read-only 403 on Liverpool ONE).
    // Safe because the brief below is re-fetched with the requester's own
    // cookie, so the prompt only ever sees client-visible data, and the
    // prompt already bans fee figures from the stored prose.
    const { isClientRequestUser, resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
    if (await isClientRequestUser(req as any)) {
      const scope = await resolveCompanyScope(req as any);
      if (!scope || !(await isPropertyInScope(scope, String(req.params.id)))) {
        return res.status(403).json({ error: "Read-only access for client accounts" });
      }
    }
    const propertyId = req.params.id;
    // Re-hit our own asset-brief route so we re-use all the join
    // logic (active deals / activity / risks / performance). Easier
    // than re-doing the SQL here and keeps the narrative in sync
    // with what the user actually sees on the panel.
    const baseUrl = `http://127.0.0.1:${process.env.PORT || "5000"}`;
    const cookie = (req.headers?.cookie as string) || "";
    const auth = (req.headers?.authorization as string) || "";
    const briefRes = await fetch(`${baseUrl}/api/properties/${propertyId}/asset-brief`, {
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(auth ? { Authorization: auth } : {}),
      },
    });
    if (!briefRes.ok) return res.status(briefRes.status).json({ error: "Couldn't load asset brief" });
    const brief = await briefRes.json();
    const required = ["deals", "lettings", "activity", "schedule", "risks"];
    if (required.some(section => brief.data_quality?.[section] !== "ready")) {
      return res.status(409).json({ error: "Commentary was kept unchanged. Complete or reload the property data before regenerating it.", data_warnings: brief.data_warnings || [] });
    }

    // The property board's focus now comes from My Tasks, not the old
    // weekly_focus JSON. Read the same scoped list the user can see.
    const tasksRes = await fetch(`${baseUrl}/api/properties/${propertyId}/tasks?status=active`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(auth ? { Authorization: auth } : {}) },
    });
    if (!tasksRes.ok) return res.status(409).json({ error: "Commentary was kept unchanged because this week's tasks could not be loaded." });
    const currentTasks = (await tasksRes.json()).tasks;
    if (!Array.isArray(currentTasks)) return res.status(409).json({ error: "Commentary was kept unchanged because the task response was incomplete." });

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const fmtMoney = (p: number | null | undefined) => p == null ? "—" : `£${Math.round(Number(p) / 100).toLocaleString()}`;
    // No fee figures in the prompt: the generated prose is stored on the
    // property and served to client logins, so BGP fee amounts must never
    // appear in it. Deal stage/tenant context is enough for commentary.
    const dealLines = (brief.active_deals as any[]).slice(0, 15).map(d => `- ${d.tenant_name || d.name}${d.unit_name ? ` @ ${d.unit_name}` : ""} — ${d.stage_label}`).join("\n") || "(none)";
    // Letting Tracker rows are the live lettings pulse — many never have a
    // crm_deals row, and skipping them made the commentary declare "nothing
    // actively transacting" on busy schemes (Bluewater).
    const lettingLines = ((brief.lettings || []) as any[]).slice(0, 20).map((u: any) =>
      `- ${u.unit_name} — ${(u.marketing_status || "available").replace(/_/g, " ")}${u.operator_name ? ` with ${u.operator_name}` : ""}${u.viewings_count ? ` · ${u.viewings_count} viewing${u.viewings_count === 1 ? "" : "s"}` : ""}`
    ).join("\n") || "(none on the tracker)";
    const activityLines = (brief.activity as any[]).slice(0, 12).map(a => `- ${a.summary} (${new Date(a.date).toLocaleDateString("en-GB")})`).join("\n") || "(none in last 14 days)";
    const riskLines = (brief.risks as any[]).map(r => `- ${r.severity.toUpperCase()}: ${r.message}`).join("\n") || "(none flagged)";
    const focusLines = currentTasks.slice(0, 15).map((task: any) => `- ${task.title}${task.owner_name ? ` (${task.owner_name})` : ""}${task.due_date ? ` — due ${new Date(task.due_date).toLocaleDateString("en-GB")}` : ""}`).join("\n") || "(no open property tasks recorded)";
    const ownerName = brief.owner?.name || "the asset owner";
    const propertyName = brief.property?.name || "this property";

    const prompt = `You are a BGP analyst writing the commentary section of a client-facing operational brief on ${propertyName}, owned by ${ownerName}.

Active deals on the property:
${dealLines}

Letting Tracker — live lettings by unit (marketing / negotiating / with solicitors):
${lettingLines}

Recent activity — emails, calls and meetings (last 14 days):
${activityLines}

Risks flagged:
${riskLines}

Asset lead's stated focus this week:
${focusLines}

Performance: ${brief.performance.vacancy_rate == null ? "Vacancy unavailable" : `${(brief.performance.vacancy_rate * 100).toFixed(1)}% recorded vacancy`}${brief.performance.wault_years != null ? `, rent-weighted lease term ${brief.performance.wault_years.toFixed(1)} yrs` : "; weighted lease term unavailable"}.

Write the operational commentary for the asset owner reading this, as FOUR SHORT paragraphs separated by blank lines, each opening with a bold lead-in exactly like this: **Live activity.** / **Momentum.** / **Risks.** / **BGP focus.** Cover in order:
1. What's actively moving right now — live deals AND Letting Tracker units in play; only say nothing is transacting if BOTH lists are empty.
2. What the recent email/meeting activity shows about momentum.
3. The risks worth flagging (vacancies / expiries / covenant). No flagged risks only means none were found in the recorded data; it is not a complete covenant or lease review.
4. Where BGP's focus is this week + a forward-looking line.

Rules: British English, partner-tone, no hype, no "I'm pleased to". Keep each paragraph to 1-3 sentences. Bold the key tenant and unit names with **double asterisks**. Reference the actual tenants / units / figures above — don't generalise. Never state BGP fees or commissions. No headings beyond the bold lead-ins, no lists. No preamble or "here is".`;

    let msg: any;
    try {
      msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (aiErr: any) {
      if (/api ?key|authentication|authToken/i.test(aiErr?.message || "")) {
        return res.status(503).json({ error: "Commentary unavailable — AI service is not configured" });
      }
      return res.status(502).json({ error: "Couldn't regenerate commentary" });
    }
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Claude returned empty commentary" });

    await pool.query(
      `UPDATE crm_properties SET bgp_commentary = $1, bgp_commentary_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [text, propertyId]
    );
    res.json({ ok: true, bgp_commentary: text, bgp_commentary_at: new Date().toISOString() });
  } catch (err: any) {
    console.error("[bgp-commentary]", err?.message, err?.stack);
    res.status(500).json({ error: err?.message || "regenerate failed" });
  }
});

// Linkage audit — diagnostic counts so the user can see what's
// connected to a property and what isn't. Lots of CRM tables hang
// off the property in different ways (deals by property_id /
// unit_id / landlord_id; tasks by linked_property_id; interactions
// via deal participants; leasing schedule rows; available units;
// tenants in the schedule that should match crm_companies). This
// endpoint walks each path and returns honest counts so you can
// spot 'Bluewater has 47 schedule rows but 0 deals' and fix the
// data (usually means deals weren't tagged with property_id).
router.get("/api/properties/:id/linkage-audit", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    // Property header — name + landlord for the report.
    const propQ = await pool.query<{ name: string; landlord_id: string | null }>(
      `SELECT name, landlord_id FROM crm_properties WHERE id = $1`,
      [propertyId]
    );
    if (propQ.rows.length === 0) return res.status(404).json({ error: "Property not found" });
    const { name: propertyName, landlord_id: landlordId } = propQ.rows[0];

    // Deals — three paths into a property.
    const dealsByPropertyId = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM crm_deals WHERE property_id = $1`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);
    const dealsByUnitId = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM crm_deals d
         JOIN property_units pu ON pu.id = d.unit_id
        WHERE pu.property_id = $1 AND (d.property_id IS NULL OR d.property_id <> $1)`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);
    // Deals on this landlord that don't yet have a property_id /
    // unit_id at all — most likely on this property but never tagged.
    const dealsLandlordOrphans = landlordId
      ? await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM crm_deals
            WHERE landlord_id = $1
              AND property_id IS NULL
              AND unit_id IS NULL`,
          [landlordId]
        ).then(r => r.rows[0]?.n || 0)
      : 0;
    const activeDealsLinked = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM crm_deals d
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
        WHERE (d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1)
          AND COALESCE(d.status, '') NOT IN ('WIT', 'COM', 'INV')`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);

    // Tasks — direct property link vs via a deal that's linked here.
    const tasksDirect = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM user_tasks WHERE linked_property_id = $1 AND status <> 'done'`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);
    const tasksViaDeal = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM user_tasks t
         JOIN crm_deals d ON d.id = t.linked_deal_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
        WHERE (d.property_id = $1 OR pu.property_id = $1)
          AND (t.linked_property_id IS NULL OR t.linked_property_id <> $1)
          AND t.status <> 'done'`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);

    // Interactions in the last 30 / 90d on this property's deals.
    const interactions30 = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM crm_interactions i
         JOIN crm_deals d ON d.id = i.deal_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
        WHERE (d.property_id = $1 OR pu.property_id = $1)
          AND i.interaction_date > NOW() - INTERVAL '30 days'`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);
    const interactions90 = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM crm_interactions i
         JOIN crm_deals d ON d.id = i.deal_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
        WHERE (d.property_id = $1 OR pu.property_id = $1)
          AND i.interaction_date > NOW() - INTERVAL '90 days'`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);

    // Units across the three sources we maintain.
    const propertyUnits = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM property_units WHERE property_id = $1`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);
    const leasingScheduleUnits = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM leasing_schedule_units WHERE property_id = $1`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);
    const availableUnits = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM available_units WHERE property_id = $1`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);
    // Schedule rows that aren't yet in property_units — usually
    // means deals on those units won't auto-link via unit_id.
    const scheduleUnitsMissingFromPropertyUnits = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM leasing_schedule_units lsu
        WHERE lsu.property_id = $1
          AND lsu.unit_name IS NOT NULL AND lsu.unit_name <> ''
          AND NOT EXISTS (
            SELECT 1 FROM property_units pu
             WHERE pu.property_id = lsu.property_id
               AND LOWER(TRIM(pu.unit_name)) = LOWER(TRIM(lsu.unit_name))
          )`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);

    // Tenants that appear in the leasing schedule but aren't tied
    // to a crm_companies row — usually mean the deal/KYC links
    // won't fire on those tenants.
    const tenantsInScheduleUnlinked = await pool.query<{ n: number }>(
      `SELECT COUNT(DISTINCT lsu.tenant_name)::int AS n
         FROM leasing_schedule_units lsu
        WHERE lsu.property_id = $1
          AND lsu.tenant_name IS NOT NULL AND lsu.tenant_name <> ''
          AND NOT EXISTS (
            SELECT 1 FROM crm_companies c
             WHERE c.merged_into_id IS NULL
               AND LOWER(TRIM(c.name)) = LOWER(TRIM(lsu.tenant_name))
          )`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);

    // Canonical resolution status on the tenancy schedule (the spine).
    // The tenancy schedule is meant to be the source of truth — every
    // row should resolve to a brand via tenant_company_id. Count what's
    // resolved vs still NULL so the linkage card can show "X / Y
    // tenants resolved" and offer a one-click backfill.
    const tenancyResolution = await pool.query<{ total: number; resolved: number; unresolved: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE coalesce(NULLIF(trim(trading_name), ''), trim(tenant_name), '') <> ''
                            AND lower(coalesce(NULLIF(trim(trading_name), ''), trim(tenant_name), '')) NOT IN ('vacant', 'void', '—', '-'))::int AS total,
         COUNT(*) FILTER (WHERE tenant_company_id IS NOT NULL)::int AS resolved,
         COUNT(*) FILTER (WHERE tenant_company_id IS NULL
                            AND coalesce(NULLIF(trim(trading_name), ''), trim(tenant_name), '') <> ''
                            AND lower(coalesce(NULLIF(trim(trading_name), ''), trim(tenant_name), '')) NOT IN ('vacant', 'void', '—', '-'))::int AS unresolved
         FROM tenancy_schedule_units
        WHERE property_id = $1`,
      [propertyId]
    ).then(r => r.rows[0] || { total: 0, resolved: 0, unresolved: 0 });

    // Integrity gaps — things the audit was previously blind to.
    //
    // 1. Duplicate unit_numbers on the tenancy schedule for this
    //    property. Soft-matched joins downstream collide on these so
    //    deals + available_units can end up pointing at the wrong
    //    row. We don't enforce uniqueness yet (might break existing
    //    data) but we surface the duplicates so the team can rename.
    //
    // 2. Tenancy rows where tenant_company_id points at a brand that
    //    has been merged into another brand. The FK is technically
    //    set but the row no longer rolls up to the right brand board.
    //    Easy to miss because the brand still has a name.
    //
    // 3. Deals whose unit_id sits on a different property than their
    //    declared property_id. Either the unit moved or the property
    //    was edited — either way the deal is now ambiguous.
    //
    // 4. available_units rows whose deal_id points at a deal on
    //    another property. Same shape as #3 but for the leasing
    //    tracker side.
    //
    // 5. Schedule rows that still don't have a tenancy_unit_id FK on
    //    the leasing schedule / available_units / deals — the unit
    //    spine is incomplete.
    const integrity = await pool.query(
      `WITH dups AS (
         SELECT lower(trim(unit_number)) AS key, COUNT(*) AS n
           FROM tenancy_schedule_units
          WHERE property_id = $1 AND coalesce(trim(unit_number), '') <> ''
          GROUP BY 1 HAVING COUNT(*) > 1
       )
       SELECT
         (SELECT COUNT(*)::int FROM dups) AS duplicate_unit_numbers,
         (SELECT COUNT(*)::int FROM tenancy_schedule_units t
            JOIN crm_companies c ON c.id = t.tenant_company_id
           WHERE t.property_id = $1 AND c.merged_into_id IS NOT NULL) AS tenants_pointing_at_merged_brand,
         (SELECT COUNT(*)::int FROM crm_deals d
            JOIN property_units pu ON pu.id = d.unit_id
           WHERE d.property_id IS NOT NULL
             AND d.unit_id IS NOT NULL
             AND pu.property_id <> d.property_id
             AND (d.property_id = $1 OR pu.property_id = $1)) AS deals_with_property_unit_mismatch,
         (SELECT COUNT(*)::int FROM available_units au
            JOIN crm_deals d ON d.id = au.deal_id
           WHERE au.property_id = $1
             AND d.property_id IS NOT NULL
             AND d.property_id <> au.property_id) AS available_units_deal_on_other_property,
         (SELECT COUNT(*)::int FROM available_units WHERE property_id = $1 AND tenancy_unit_id IS NULL) AS available_units_no_unit_fk,
         (SELECT COUNT(*)::int FROM leasing_schedule_units WHERE property_id = $1 AND tenancy_unit_id IS NULL) AS leasing_units_no_unit_fk,
         (SELECT COUNT(*)::int FROM crm_deals
           WHERE (property_id = $1 OR EXISTS (SELECT 1 FROM property_units pu WHERE pu.id = unit_id AND pu.property_id = $1))
             AND COALESCE(status, '') NOT IN ('WIT', 'COM', 'INV')
             AND tenancy_unit_id IS NULL) AS active_deals_no_unit_fk`,
      [propertyId]
    ).then(r => r.rows[0] || {});

    // Contacts surfaced via deals on this property.
    const contactsViaDeals = await pool.query<{ n: number }>(
      `SELECT COUNT(DISTINCT contact_id)::int AS n FROM (
         SELECT d.tenant_contact_id AS contact_id FROM crm_deals d
            LEFT JOIN property_units pu ON pu.id = d.unit_id
           WHERE (d.property_id = $1 OR pu.property_id = $1) AND d.tenant_contact_id IS NOT NULL
         UNION
         SELECT d.client_contact_id FROM crm_deals d
            LEFT JOIN property_units pu ON pu.id = d.unit_id
           WHERE (d.property_id = $1 OR pu.property_id = $1) AND d.client_contact_id IS NOT NULL
         UNION
         SELECT d.landlord_contact_id FROM crm_deals d
            LEFT JOIN property_units pu ON pu.id = d.unit_id
           WHERE (d.property_id = $1 OR pu.property_id = $1) AND d.landlord_contact_id IS NOT NULL
       ) c`,
      [propertyId]
    ).then(r => r.rows[0]?.n || 0);

    res.json({
      property: { id: propertyId, name: propertyName, landlord_id: landlordId },
      deals: {
        active_correctly_linked: activeDealsLinked,
        by_property_id: dealsByPropertyId,
        by_unit_id_only: dealsByUnitId,
        landlord_orphans: dealsLandlordOrphans,
      },
      tasks: { linked_direct: tasksDirect, linked_via_deal: tasksViaDeal },
      interactions: { last_30d: interactions30, last_90d: interactions90 },
      contacts: { via_deals: contactsViaDeals },
      units: {
        property_units: propertyUnits,
        leasing_schedule_units: leasingScheduleUnits,
        available_units: availableUnits,
        schedule_units_missing_from_property_units: scheduleUnitsMissingFromPropertyUnits,
      },
      tenants_unlinked_to_crm_company: tenantsInScheduleUnlinked,
      tenancy_resolution: tenancyResolution,
      integrity: {
        duplicate_unit_numbers: Number(integrity.duplicate_unit_numbers) || 0,
        tenants_pointing_at_merged_brand: Number(integrity.tenants_pointing_at_merged_brand) || 0,
        deals_with_property_unit_mismatch: Number(integrity.deals_with_property_unit_mismatch) || 0,
        available_units_deal_on_other_property: Number(integrity.available_units_deal_on_other_property) || 0,
        available_units_no_unit_fk: Number(integrity.available_units_no_unit_fk) || 0,
        leasing_units_no_unit_fk: Number(integrity.leasing_units_no_unit_fk) || 0,
        active_deals_no_unit_fk: Number(integrity.active_deals_no_unit_fk) || 0,
      },
    });
  } catch (err: any) {
    console.error("[linkage-audit]", err?.message, err?.stack);
    res.status(500).json({ error: err?.message || "audit failed" });
  }
});

// Tasks scoped to this property — covers every BGP user's tasks
// linked to the property directly OR to a deal whose unit lives
// here. Drives the Weekly Focus card on the property page.
// Linked contacts, rethought (Woody, 2026-08-03): the previous company-leg
// pulled EVERY contact at the landlord company — on Bluewater that meant a
// wall of RocketReach-imported Landsec names with no property involvement.
// Now four evidence-based groups, each requiring a real tie to THIS
// property: active landlord contacts (interaction history, not directory
// membership), tenants in occupation, parties on live deals, and agents /
// prospects who actually viewed or offered.
// Manual overrides on the evidence-based contacts map (Woody, 2026-08-05:
// "need to be able to add or delete these contacts too"). Pins add a CRM
// contact the evidence missed; hides suppress a wrong row. Both are
// per-property and reversible — the underlying CRM data is never touched.
let contactOverridesEnsured = false;
async function ensureContactOverrides() {
  if (contactOverridesEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS property_contact_overrides (
      property_id varchar NOT NULL,
      contact_id varchar NOT NULL,
      kind text NOT NULL,
      created_by varchar,
      created_at timestamptz DEFAULT now(),
      PRIMARY KEY (property_id, contact_id)
    )`).catch(() => {});
  contactOverridesEnsured = true;
}

router.post("/api/properties/:id/contact-override", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureContactOverrides();
    const { clientBlockedForProperty } = await import("./company-scope");
    if (await clientBlockedForProperty(req, String(req.params.id))) {
      return res.status(403).json({ error: "Not available for client accounts" });
    }
    const kind = String(req.body?.kind || "");
    const contactId = String(req.body?.contactId || "");
    if (!contactId || !["pin", "hide"].includes(kind)) return res.status(400).json({ error: "contactId and kind (pin|hide) required" });
    const userId = (req as any).session?.userId || (req as any).tokenUserId;
    await pool.query(
      `INSERT INTO property_contact_overrides (property_id, contact_id, kind, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (property_id, contact_id) DO UPDATE SET kind = $3, created_by = $4`,
      [String(req.params.id), contactId, kind, userId || null]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "override failed" });
  }
});

router.delete("/api/properties/:id/contact-override/:contactId", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureContactOverrides();
    const { clientBlockedForProperty } = await import("./company-scope");
    if (await clientBlockedForProperty(req, String(req.params.id))) {
      return res.status(403).json({ error: "Not available for client accounts" });
    }
    // "__hidden__" restores every hidden row on the property in one go.
    if (String(req.params.contactId) === "__hidden__") {
      await pool.query(
        `DELETE FROM property_contact_overrides WHERE property_id = $1 AND kind = 'hide'`,
        [String(req.params.id)]
      );
      return res.json({ ok: true });
    }
    await pool.query(
      `DELETE FROM property_contact_overrides WHERE property_id = $1 AND contact_id = $2`,
      [String(req.params.id), String(req.params.contactId)]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "override delete failed" });
  }
});

// The portfolio board retains every recorded relationship; presentation can
// search and page the complete set without losing schemes behind a preview cap.
router.get("/api/company-portfolio/:companyId/linked-contacts", requireAuth, async (req: Request, res: Response) => {
  try {
    const cid = String(req.params.companyId);
    const { resolveCompanyScope, clientBrandSliceSql } = await import("./company-scope");
    const scope = await resolveCompanyScope(req as any);
    if (scope && scope !== cid) return res.status(403).json({ error: "Not available for client accounts" });
    const { loadPortfolioContacts } = await import("./portfolio-contacts");
    const slice = await clientBrandSliceSql(scope, "co.id");
    res.json(await loadPortfolioContacts(pool, cid, scope, slice));
  } catch (err: any) {
    console.error("[portfolio-linked-contacts]", err?.message);
    res.status(500).json({ error: "Portfolio contacts could not be loaded" });
  }
});

router.get("/api/properties/:id/linked-contacts", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureContactOverrides();
    const { clientBlockedForProperty } = await import("./company-scope");
    if (await clientBlockedForProperty(req, String(req.params.id))) {
      return res.status(403).json({ error: "Read-only access for client accounts" });
    }
    const pid = String(req.params.id);
    const shape = (r: any, via: string) => ({
      id: r.id, name: r.name, role: r.role, email: r.email, company_id: r.company_id,
      company_name: r.company_name, avatar_url: r.avatar_url, last_interaction: r.last_interaction, via,
    });

    // 1. Landlord-side people who are ACTIVE — they have interaction
    //    history with BGP. Directory-only rows (RocketReach imports with
    //    no touches) stay out.
    const landlordQ = pool.query(
      `WITH owner_cos AS (
         SELECT landlord_id AS id FROM crm_properties WHERE id = $1 AND landlord_id IS NOT NULL
         UNION SELECT freeholder_id FROM crm_properties WHERE id = $1 AND freeholder_id IS NOT NULL
         UNION SELECT long_leaseholder_id FROM crm_properties WHERE id = $1 AND long_leaseholder_id IS NOT NULL
         UNION SELECT company_id FROM crm_company_properties WHERE property_id = $1
       )
       SELECT c.* FROM crm_contacts c JOIN owner_cos o ON o.id = c.company_id
        WHERE c.last_interaction IS NOT NULL
        ORDER BY c.last_interaction DESC LIMIT 8`,
      [pid]
    );

    // 2. Tenants in occupation — brand-first (Woody, 2026-08-05: "very hard
    //    to see which tenants they are"). EVERY occupier company off the
    //    tenancy schedule, A-Z, with its freshest contact attached when one
    //    exists — the brand is the row, the person hangs off it.
    const tenantsQ = pool.query(
      `WITH occ AS (
         SELECT DISTINCT co.id, co.name FROM tenancy_schedule_units ts
         JOIN crm_companies co
           ON co.id = ts.tenant_company_id
           OR lower(co.name) IN (lower(COALESCE(ts.tenant_name,'')), lower(COALESCE(ts.trading_name,'')))
           OR (length(co.name) >= 5 AND lower(COALESCE(ts.tenant_name,'')) LIKE lower(co.name) || ' %')
        WHERE ts.property_id = $1
       )
       SELECT occ.id AS occ_company_id, occ.name AS occ_company_name,
              c.id, c.name, c.role, c.email, c.last_interaction
         FROM occ
         LEFT JOIN LATERAL (
           SELECT c2.id, c2.name, c2.role, c2.email, c2.last_interaction
             FROM crm_contacts c2 WHERE c2.company_id = occ.id
            ORDER BY c2.last_interaction DESC NULLS LAST LIMIT 1
         ) c ON true
        ORDER BY occ.name
        LIMIT 150`,
      [pid]
    );

    // 5. Internal team — the BGP agents on this property (Lead / Leasing /
    //    Letting Surveyor pills) plus the landlord's Director-role people
    //    (the client-side leasing owners, same rule as the tracker's
    //    client-contact picker).
    const bgpTeamQ = pool.query(
      `SELECT u.id, u.name, u.email, pa.role AS agent_role
         FROM crm_property_agents pa JOIN users u ON u.id = pa.user_id
        WHERE pa.property_id = $1
        ORDER BY CASE pa.role WHEN 'Lead' THEN 0 WHEN 'Investment' THEN 1 WHEN 'Leasing' THEN 2 ELSE 3 END, u.name`,
      [pid]
    );
    const clientLeadsQ = pool.query(
      `WITH owner_cos AS (
         SELECT landlord_id AS id FROM crm_properties WHERE id = $1 AND landlord_id IS NOT NULL
         UNION SELECT company_id FROM crm_company_properties WHERE property_id = $1
       )
       SELECT c.* FROM crm_contacts c JOIN owner_cos o ON o.id = c.company_id
        WHERE lower(COALESCE(c.role,'')) LIKE '%director%'
        ORDER BY c.name LIMIT 6`,
      [pid]
    );

    // 6. Consultants — people at advisor-type companies linked to the
    //    property (architects, planners, project managers, engineers…).
    const consultantsQ = pool.query(
      `SELECT DISTINCT ON (c.id) c.*, co.company_type AS consultant_type
         FROM crm_company_properties cp
         JOIN crm_companies co ON co.id = cp.company_id
         JOIN crm_contacts c ON c.company_id = co.id
        WHERE cp.property_id = $1
          AND (co.company_type ILIKE '%consult%' OR co.company_type ILIKE '%architect%'
            OR co.company_type ILIKE '%advis%' OR co.company_type ILIKE '%planning%'
            OR co.company_type ILIKE '%project man%' OR co.company_type ILIKE '%engineer%'
            OR co.company_type ILIKE '%solicitor%' OR co.company_type ILIKE '%lawyer%'
            OR co.industry ILIKE '%consult%' OR co.industry ILIKE '%architect%')
        ORDER BY c.id, c.last_interaction DESC NULLS LAST
        LIMIT 12`,
      [pid]
    );

    // 3. Parties on deals at the property: explicit deal-contact FKs always
    //    count; counterparty-company contacts count when the deal is LIVE
    //    and the person has interaction history.
    const dealsQ = pool.query(
      `WITH pdeals AS (
         SELECT d.id, d.name, d.status,
                d.client_contact_id, d.tenant_contact_id, d.landlord_contact_id,
                d.vendor_contact_id, d.purchaser_contact_id, d.vendor_agent_contact_id,
                d.acquisition_agent_contact_id, d.purchaser_agent_contact_id, d.leasing_agent_contact_id,
                d.tenant_id, d.landlord_id, d.vendor_id, d.purchaser_id
           FROM crm_deals d
           LEFT JOIN property_units pu ON pu.id = d.unit_id
           LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
          WHERE d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1
       ),
       fk AS (
         SELECT DISTINCT ON (cid) cid AS contact_id, pd.name AS deal_name FROM pdeals pd
         CROSS JOIN LATERAL unnest(ARRAY[
           pd.client_contact_id, pd.tenant_contact_id, pd.landlord_contact_id,
           pd.vendor_contact_id, pd.purchaser_contact_id, pd.vendor_agent_contact_id,
           pd.acquisition_agent_contact_id, pd.purchaser_agent_contact_id, pd.leasing_agent_contact_id
         ]) AS cid WHERE cid IS NOT NULL
       ),
       live AS (
         SELECT DISTINCT ON (c.id) c.id AS contact_id, pd.name AS deal_name
           FROM pdeals pd
           JOIN crm_companies co ON co.id IN (pd.tenant_id, pd.vendor_id, pd.purchaser_id)
           JOIN crm_contacts c ON c.company_id = co.id AND c.last_interaction IS NOT NULL
          WHERE COALESCE(pd.status,'') NOT IN ('WIT','COM','INV')
          ORDER BY c.id, c.last_interaction DESC
       ),
       merged AS (
         SELECT contact_id, deal_name FROM fk
         UNION SELECT contact_id, deal_name FROM live
       )
       SELECT DISTINCT ON (c.id) c.*, m.deal_name FROM crm_contacts c JOIN merged m ON m.contact_id = c.id
        ORDER BY c.id, c.last_interaction DESC NULLS LAST
        LIMIT 12`,
      [pid]
    );

    // 3b. Tracker parties — the brands actively negotiating tracker units
    //     (Woody, 2026-08-05: Bluewater had six units in play and the deals
    //     group showed nobody, because those live on the tracker rather
    //     than as formal deal records). Counterparty comes from the unit's
    //     resolved brand, its linked deal, or its latest offer; freshest
    //     contact per brand.
    const trackerQ = pool.query(
      `WITH active_units AS (
         SELECT au.id, au.unit_name, au.marketing_status, au.tenant_company_id, au.deal_id
           FROM available_units au
          WHERE au.property_id = $1
            AND lower(COALESCE(au.marketing_status,'')) ~ '(neg|offer|sol|exc|hots|terms)'
       ),
       parties AS (
         SELECT u.unit_name, u.marketing_status, u.tenant_company_id AS company_id
           FROM active_units u WHERE u.tenant_company_id IS NOT NULL
         UNION
         SELECT u.unit_name, u.marketing_status, d.tenant_id
           FROM active_units u JOIN crm_deals d ON d.id = u.deal_id
          WHERE d.tenant_id IS NOT NULL
         UNION
         SELECT u.unit_name, u.marketing_status, lo.company_id
           FROM active_units u
           JOIN LATERAL (
             SELECT o.company_id FROM unit_offers o
              WHERE o.unit_id = u.id AND o.company_id IS NOT NULL
              ORDER BY o.offer_date DESC LIMIT 1
           ) lo ON true
       )
       SELECT DISTINCT ON (c.company_id) c.*, p.unit_name, p.marketing_status
         FROM parties p JOIN crm_contacts c ON c.company_id = p.company_id
        ORDER BY c.company_id, c.last_interaction DESC NULLS LAST
        LIMIT 12`,
      [pid]
    );

    // 3b-ii. Brands on live deals here with NO contactable person — shown
    //        as brand-only rows so the group still names who's in play.
    const dealBrandsPropQ = pool.query(
      `SELECT DISTINCT ON (co.id) co.id AS brand_id, co.name AS brand_name, d.name AS deal_name
         FROM crm_deals d
         JOIN crm_companies co ON co.id = d.tenant_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN tenancy_schedule_units ts2 ON ts2.id = d.tenancy_unit_id
        WHERE (d.property_id = $1 OR pu.property_id = $1 OR ts2.property_id = $1)
          AND COALESCE(d.status,'') NOT IN ('WIT','COM','INV')
        ORDER BY co.id
        LIMIT 15`,
      [pid]
    );

    // 3c. Active tracker units with NO counterparty recorded anywhere —
    //     surfaced as a visible gap ("link the brand") instead of the group
    //     silently coming up empty (Bluewater's three NEG units, 2026-08-05).
    const unlinkedQ = pool.query(
      `SELECT au.unit_name, au.marketing_status FROM available_units au
        WHERE au.property_id = $1
          AND lower(COALESCE(au.marketing_status,'')) ~ '(neg|offer|sol|exc|hots|terms)'
          AND au.tenant_company_id IS NULL AND au.deal_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM unit_offers o WHERE o.unit_id = au.id AND o.company_id IS NOT NULL)
        ORDER BY au.unit_name LIMIT 8`,
      [pid]
    );

    // 4. Interest — people who actually viewed or offered on the
    //    property's tracker units.
    const interestQ = pool.query(
      `WITH touches AS (
         SELECT v.contact_id, v.viewing_date::timestamp AS at, 'viewed' AS kind
           FROM unit_viewings v JOIN available_units au ON au.id = v.unit_id
          WHERE au.property_id = $1 AND v.contact_id IS NOT NULL
         UNION ALL
         SELECT o.contact_id, o.offer_date::timestamp AS at, 'offered' AS kind
           FROM unit_offers o JOIN available_units au ON au.id = o.unit_id
          WHERE au.property_id = $1 AND o.contact_id IS NOT NULL
       )
       SELECT DISTINCT ON (c.id) c.*, t.kind, t.at FROM crm_contacts c JOIN touches t ON t.contact_id = c.id
        ORDER BY c.id, t.at DESC
        LIMIT 10`,
      [pid]
    );

    const overridesQ = pool.query(
      `SELECT contact_id, kind FROM property_contact_overrides WHERE property_id = $1`, [pid]
    );
    const pinnedQ = pool.query(
      `SELECT c.*, co.name AS company_name FROM property_contact_overrides o
         JOIN crm_contacts c ON c.id = o.contact_id
         LEFT JOIN crm_companies co ON co.id = c.company_id
        WHERE o.property_id = $1 AND o.kind = 'pin'
        ORDER BY c.name`, [pid]
    );

    const [landlord, tenants, deals, interest, bgpTeam, clientLeads, consultants, tracker, unlinked, overrides, pinned, dealBrandsProp] =
      await Promise.all([landlordQ, tenantsQ, dealsQ, interestQ, bgpTeamQ, clientLeadsQ, consultantsQ, trackerQ, unlinkedQ, overridesQ, pinnedQ, dealBrandsPropQ]);
    const hiddenIds = new Set(overrides.rows.filter((r: any) => r.kind === "hide").map((r: any) => r.contact_id));
    const pinnedIds = new Set(overrides.rows.filter((r: any) => r.kind === "pin").map((r: any) => r.contact_id));
    const notHidden = (rows: any[]) => rows.filter((r: any) => !hiddenIds.has(r.id) && !pinnedIds.has(r.id));
    const dealIds = new Set(deals.rows.map((r: any) => r.id));
    const trackerRows = tracker.rows.filter((r: any) => !dealIds.has(r.id));
    res.json({
      landlord: notHidden(landlord.rows).map((r: any) => shape(r, "landlord team")),
      // Brand-first occupier rows: the company is the row, the freshest
      // contact (if any) hangs off it. A hidden contact drops off its
      // brand row but the brand itself stays — it IS in occupation.
      tenants: tenants.rows.map((r: any) => ({
        company_id: r.occ_company_id,
        company_name: r.occ_company_name,
        contact: r.id && !hiddenIds.has(r.id) ? { id: r.id, name: r.name, role: r.role, email: r.email, last_interaction: r.last_interaction } : null,
      })),
      deals: [
        ...notHidden(deals.rows).map((r: any) => shape(r, r.deal_name || "on a deal")),
        ...notHidden(trackerRows).map((r: any) => shape(r, `${r.marketing_status || "negotiating"} · ${r.unit_name || "tracker"}`)),
        ...dealBrandsProp.rows
          .filter((r: any) => !deals.rows.some((d: any) => d.company_id === r.brand_id) && !trackerRows.some((t: any) => t.company_id === r.brand_id))
          .map((r: any) => ({
            id: `co-${r.brand_id}`, name: r.brand_name, role: "no contact on file",
            company_id: r.brand_id, company_name: r.brand_name, last_interaction: null,
            via: r.deal_name || "on a deal",
          })),
      ],
      interest: notHidden(interest.rows).map((r: any) => shape(r, r.kind === "offered" ? "made an offer" : "viewed")),
      internal: [
        ...bgpTeam.rows.map((r: any) => ({ id: `u-${r.id}`, user_id: r.id, name: r.name, role: r.agent_role || "Agent", email: r.email, side: "bgp" })),
        ...notHidden(clientLeads.rows).map((r: any) => ({ ...shape(r, "client"), side: "client" })),
      ],
      consultants: notHidden(consultants.rows).map((r: any) => ({ ...shape(r, r.consultant_type || "consultant") })),
      trackerUnlinked: unlinked.rows.map((r: any) => ({ unit_name: r.unit_name, status: r.marketing_status })),
      pinned: pinned.rows.map((r: any) => shape(r, "added by team")),
      hiddenCount: hiddenIds.size,
    });
  } catch (err: any) {
    console.error("[linked-contacts]", err?.message);
    res.status(500).json({ error: err?.message || "linked contacts failed" });
  }
});

router.get("/api/properties/:id/tasks", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const userId = req.session?.userId || (req as any).tokenUserId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { clientBlockedForProperty, resolveCompanyScope, isPropertyInScope, isDealInScope } = await import("./company-scope");
    if (await clientBlockedForProperty(req, String(req.params.id))) {
      return res.status(403).json({ error: "Read-only access for client accounts" });
    }
    const status = (req.query.status as string) || "active";
    const statusFilter = status === "all" ? "" : "AND t.status <> 'done'";
    // profile_pic_url is added by auto-migrate but production may not
    // have redeployed yet — try the full query first, fall back to a
    // column-stripped version on undefined_column so the panel keeps
    // working through the deploy window.
    const fullSelect = `t.user_id, COALESCE(u.name, u.username, u.email) AS owner_name, u.profile_pic_url`;
    const safeSelect = `t.user_id, COALESCE(u.name, u.username, u.email) AS owner_name, NULL::text AS profile_pic_url`;
    const buildSql = (sel: string) => `SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.is_pinned,
              t.linked_deal_id, t.linked_property_id, t.linked_contact_id, t.created_at,
              t.assigned_by_user_id, ${sel},
              d.name AS deal_name
         FROM user_tasks t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN crm_deals d ON d.id = t.linked_deal_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
        WHERE (t.linked_property_id = $1 OR d.property_id = $1 OR pu.property_id = $1)
          ${statusFilter}
        ORDER BY COALESCE(t.is_pinned, false) DESC,
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 t.due_date ASC NULLS LAST,
                 t.created_at DESC
        LIMIT 50`;
    let rows: any[];
    try {
      ({ rows } = await pool.query(buildSql(fullSelect), [propertyId]));
    } catch (e: any) {
      if (e?.code === "42703" || /column .* does not exist/i.test(e?.message || "")) {
        console.warn("[tasks] users.profile_pic_url missing on prod; falling back:", e.message);
        ({ rows } = await pool.query(buildSql(safeSelect), [propertyId]));
      } else {
        throw e;
      }
    }
    const scope = await resolveCompanyScope(req);
    const tasks = await Promise.all(rows.map(async task => {
      let canComplete = task.user_id === userId || task.assigned_by_user_id === userId;
      // Match task PATCH permissions; seeing a colleague's task is not
      // permission to complete it or modify links outside the portfolio.
      if (canComplete && scope) {
        if (task.linked_property_id && !(await isPropertyInScope(scope, task.linked_property_id))) canComplete = false;
        if (canComplete && task.linked_deal_id && !(await isDealInScope(scope, task.linked_deal_id))) canComplete = false;
      }
      return { ...task, can_complete: canComplete };
    }));
    res.json({ tasks });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "tasks fetch failed" });
  }
});

// Landlord-orphan deals — active deals where landlord_id matches this
// property's landlord but property_id is NULL. These deals belong to
// the property but were tagged with the parent landlord only, which
// is why the property page doesn't see them. Surface so the team can
// adopt them.
router.get("/api/properties/:id/orphan-deals", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const prop = await pool.query<{ landlord_id: string | null }>(
      `SELECT landlord_id FROM crm_properties WHERE id = $1`, [propertyId]
    );
    const landlordId = prop.rows[0]?.landlord_id;
    if (!landlordId) return res.json([]);
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.status, d.tenant_id, c.name AS tenant_name, c.domain_url AS tenant_domain,
              d.deal_ref, d.rent_pa, d.updated_at
         FROM crm_deals d
         LEFT JOIN crm_companies c ON c.id = d.tenant_id
        WHERE d.landlord_id = $1
          AND d.property_id IS NULL
          AND d.unit_id IS NULL
          AND COALESCE(d.status, '') NOT IN ('WIT', 'COM', 'INV')
        ORDER BY d.updated_at DESC NULLS LAST
        LIMIT 30`,
      [landlordId]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Adopt an orphan deal onto this property — writes property_id and
// (if the deal's tenant resolves to a tenancy_schedule row on this
// property) the matching tenancy_unit_id + unit_id. One click → fully
// linked on the canonical spine.
//
// Only adopts deals that are genuinely orphaned (no property_id) and
// share the property's landlord — otherwise a malicious caller could
// move any deal between properties. The dealId is bounded against
// the property's landlord_id so the action stays scoped to the
// orphan-deals list rendered on the property page.
router.post("/api/properties/:id/adopt-deal", requireAuth, async (req: Request, res: Response) => {
  try {
    if (await (await import("./company-scope")).isClientRequestUser(req as any)) {
      return res.status(403).json({ error: "Read-only access for client accounts" });
    }
    const propertyId = req.params.id;
    const { dealId } = req.body as { dealId: string };
    if (!dealId) return res.status(400).json({ error: "dealId required" });

    // Confirm the property exists and grab its landlord_id so we can
    // only adopt deals that already belong to that landlord (the
    // orphan deals the linkage card surfaces).
    const propRes = await pool.query<{ landlord_id: string | null }>(
      `SELECT landlord_id FROM crm_properties WHERE id = $1`, [propertyId]
    );
    if (propRes.rows.length === 0) return res.status(404).json({ error: "Property not found" });
    const landlordId = propRes.rows[0].landlord_id;
    if (!landlordId) return res.status(400).json({ error: "Property has no landlord — can't adopt orphan deals" });

    // Confirm the deal is genuinely an orphan of this landlord.
    const dealRes = await pool.query<{ id: string; tenant_id: string | null }>(
      `SELECT id, tenant_id FROM crm_deals
        WHERE id = $1
          AND landlord_id = $2
          AND property_id IS NULL
          AND unit_id IS NULL
          AND COALESCE(status, '') NOT IN ('WIT', 'COM', 'INV')`,
      [dealId, landlordId]
    );
    if (dealRes.rows.length === 0) {
      return res.status(400).json({ error: "Deal is not an adoptable orphan on this property's landlord" });
    }
    const tenantId = dealRes.rows[0].tenant_id;

    // Resolve a tenancy row + property_units row (both bounded to
    // this property). The tenancy match prefers the tenant brand FK,
    // falls back to lowercased tenant name string.
    const match = await pool.query<{ tenancy_unit_id: string | null; unit_id: string | null }>(
      `SELECT t.id AS tenancy_unit_id, pu.id AS unit_id
         FROM tenancy_schedule_units t
         LEFT JOIN property_units pu
           ON pu.property_id = $1
          AND lower(trim(pu.unit_name)) = lower(trim(t.unit_number))
        WHERE t.property_id = $1
          AND (
            ($2::varchar IS NOT NULL AND t.tenant_company_id = $2)
            OR ($2::varchar IS NOT NULL AND
                lower(trim(coalesce(t.trading_name, t.tenant_name, ''))) =
                lower(trim(coalesce((SELECT name FROM crm_companies WHERE id = $2), ''))))
          )
        LIMIT 1`,
      [propertyId, tenantId]
    );
    const tenancyUnitId = match.rows[0]?.tenancy_unit_id || null;
    const unitId = match.rows[0]?.unit_id || null;

    const sets: string[] = ["property_id = $1"];
    const params: any[] = [propertyId, dealId];
    if (unitId) { sets.push(`unit_id = $${params.length + 1}`); params.push(unitId); }
    if (tenancyUnitId) { sets.push(`tenancy_unit_id = $${params.length + 1}`); params.push(tenancyUnitId); }

    // Race-safe — re-assert that the deal is still an orphan when we
    // write. Between the eligibility SELECT above and this UPDATE,
    // another concurrent adopt-deal call (or a manual edit) could
    // have set property_id. We only adopt if it's still NULL.
    const updRes = await pool.query(
      `UPDATE crm_deals SET ${sets.join(", ")} WHERE id = $2 AND property_id IS NULL`,
      params
    );
    if ((updRes.rowCount || 0) === 0) {
      return res.status(409).json({ error: "Deal was adopted by another request in the meantime — refresh and check the deal's current property." });
    }
    res.json({ ok: true, unitId, tenancyUnitId });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Portfolio tasks — the client-facing "who has done what" board (Messages
// Phase 2). Titles, owners and outcomes only; task descriptions stay
// internal to BGP.
router.get("/api/company-portfolio/:companyId/tasks", requireAuth, async (req: Request, res: Response) => {
  try {
    const cid = String(req.params.companyId);
    const { resolveCompanyScope } = await import("./company-scope");
    const scope = await resolveCompanyScope(req as any);
    if (scope && scope !== cid) return res.status(403).json({ error: "Not available for client accounts" });

    const PROPS = `SELECT id FROM crm_properties WHERE landlord_id = $1
       UNION SELECT property_id FROM crm_company_properties WHERE company_id = $1`;
    const r = await pool.query(
      `SELECT t.id, t.title, t.status, t.priority, t.category, t.due_date, t.completed_at, t.created_at,
              u.name AS assignee_name, p.name AS property_name, d.name AS deal_name
         FROM user_tasks t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN crm_properties p ON p.id = t.linked_property_id
         LEFT JOIN crm_deals d ON d.id = t.linked_deal_id
        WHERE (t.linked_property_id IN (${PROPS})
               OR t.linked_deal_id IN (SELECT id FROM crm_deals WHERE property_id IN (${PROPS})))
          AND (t.status <> 'done' OR t.completed_at > NOW() - INTERVAL '60 days')
        ORDER BY (t.status = 'done'), COALESCE(t.due_date, t.created_at), t.created_at
        LIMIT 300`,
      [cid]
    );
    const open = r.rows.filter((t: any) => t.status !== "done");
    const done = r.rows
      .filter((t: any) => t.status === "done")
      .sort((a: any, b: any) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());
    res.json({ open, done });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
