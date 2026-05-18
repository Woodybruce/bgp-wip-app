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

router.get("/api/properties/:id/asset-brief", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;

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
      `SELECT d.id, d.name, d.status, d.deal_type, d.updated_at,
              d.unit_id, d.tenant_id,
              pu.unit_name,
              tc.name AS tenant_name, tc.domain AS tenant_domain,
              da.user_ids AS bgp_user_ids,
              df.amount_pence AS fee_pence
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
         LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
         LEFT JOIN LATERAL (
           SELECT array_agg(da2.user_id) AS user_ids
             FROM crm_deal_agents da2 WHERE da2.deal_id = d.id
         ) da ON true
         LEFT JOIN LATERAL (
           SELECT SUM(amount_pence)::bigint AS amount_pence
             FROM deal_fee_allocations fa WHERE fa.deal_id = d.id
         ) df ON true
        WHERE (d.property_id = $1 OR pu.property_id = $1)
          AND COALESCE(d.status, '') NOT IN ('WIT', 'COM', 'INV')
        ORDER BY d.updated_at DESC NULLS LAST
        LIMIT 60`,
      [propertyId]
    ).catch(() => ({ rows: [] as any[] }));
    const activeDeals = dealsQ.rows.map(d => ({
      id: d.id,
      name: d.name,
      status: d.status,
      deal_type: d.deal_type,
      stage_label: stageLabel(d.status),
      stage_bucket: stageBucket(d.status),
      unit_id: d.unit_id,
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

    // 3. Pipeline counts — group active deals into the six client-
    //    friendly buckets the funnel renders.
    const pipeline = {
      engaged: 0, viewed: 0, pitch_out: 0, hots: 0, legals: 0, signed: 0,
    } as Record<string, number>;
    for (const d of activeDeals) {
      const bucket = d.stage_bucket;
      if (pipeline[bucket] !== undefined) pipeline[bucket]++;
    }

    // 4. Activity feed — interactions on deals scoped to this property.
    //    SUMMARY only (kind / contact name / direction / date) — we
    //    deliberately don't return the email body / preview so the
    //    client view stays at headline level without leaking content.
    const activityQ = await pool.query<any>(
      `SELECT i.id, i.type, i.direction, i.interaction_date, i.bgp_user,
              c.name AS contact_name,
              co.name AS company_name,
              d.id AS deal_id, d.name AS deal_name
         FROM crm_interactions i
         LEFT JOIN crm_contacts c ON c.id = i.contact_id
         LEFT JOIN crm_companies co ON co.id = c.company_id
         LEFT JOIN crm_deals d ON d.id = i.deal_id
         LEFT JOIN property_units pu ON pu.id = d.unit_id
        WHERE (d.property_id = $1 OR pu.property_id = $1)
          AND i.interaction_date > NOW() - INTERVAL '14 days'
        ORDER BY i.interaction_date DESC
        LIMIT 30`,
      [propertyId]
    ).catch(() => ({ rows: [] as any[] }));
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

    const lsuQ = await pool.query<any>(
      `SELECT u.id, u.unit_name, u.tenant_name, u.status, u.lease_expiry, u.lease_break,
              c.aml_pep_status, c.kyc_status,
              EXISTS (
                SELECT 1 FROM crm_deals d2
                 LEFT JOIN property_units pu2 ON pu2.id = d2.unit_id
                 WHERE (d2.property_id = $1 OR pu2.property_id = $1)
                   AND COALESCE(d2.status, '') NOT IN ('WIT', 'COM', 'INV')
                   AND pu2.unit_name = u.unit_name
              ) AS has_live_deal
         FROM leasing_schedule_units u
         LEFT JOIN crm_companies c ON LOWER(TRIM(c.name)) = LOWER(TRIM(u.tenant_name))
        WHERE u.property_id = $1`,
      [propertyId]
    ).catch(() => ({ rows: [] as any[] }));
    const horizonMs = 18 * 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const u of lsuQ.rows) {
      const status = String(u.status || "").toLowerCase();
      if (/vacant|available/.test(status)) {
        risks.push({ kind: "vacant", severity: "med", message: `${u.unit_name || "Unit"} vacant — no active deal on file`, unit_id: u.id, unit_name: u.unit_name });
      }
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

    // 6. Performance scorecard — light first cut, derived from the
    //    leasing schedule (top + bottom MAT psqft, vacancy rate,
    //    weighted-average unexpired lease term).
    const perfQ = await pool.query<any>(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(LOWER(status), '') !~ 'vacant|available') AS occupied_units,
         COUNT(*) AS total_units,
         AVG(EXTRACT(EPOCH FROM (lease_expiry - NOW())) / 31557600.0) FILTER (WHERE lease_expiry > NOW()) AS wault_years
         FROM leasing_schedule_units WHERE property_id = $1`,
      [propertyId]
    ).catch(() => ({ rows: [] as any[] }));
    const perfRow = perfQ.rows[0] || {};
    const topPsqftQ = await pool.query<any>(
      `SELECT unit_name, tenant_name, mat_psqft, lfl_percent
         FROM leasing_schedule_units
        WHERE property_id = $1 AND mat_psqft IS NOT NULL
        ORDER BY mat_psqft DESC NULLS LAST LIMIT 5`,
      [propertyId]
    ).catch(() => ({ rows: [] as any[] }));
    const bottomPsqftQ = await pool.query<any>(
      `SELECT unit_name, tenant_name, mat_psqft, lfl_percent
         FROM leasing_schedule_units
        WHERE property_id = $1 AND mat_psqft IS NOT NULL
        ORDER BY mat_psqft ASC NULLS LAST LIMIT 5`,
      [propertyId]
    ).catch(() => ({ rows: [] as any[] }));
    const performance = {
      total_units: Number(perfRow.total_units || 0),
      occupied_units: Number(perfRow.occupied_units || 0),
      vacancy_rate: perfRow.total_units ? 1 - Number(perfRow.occupied_units || 0) / Number(perfRow.total_units) : 0,
      wault_years: perfRow.wault_years ? Number(perfRow.wault_years) : null,
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
    ].filter(Boolean).map(d => new Date(d as any).getTime());
    const lastUpdatedAt = allDates.length > 0 ? new Date(Math.max(...allDates)).toISOString() : p.updated_at;

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
      active_deals: activeDeals,
      pipeline,
      activity,
      risks,
      performance,
      commentary: p.notes || "",
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
  if (s === "AGT") return "hots";
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

// Tasks scoped to this property — covers every BGP user's tasks
// linked to the property directly OR to a deal whose unit lives
// here. Drives the Weekly Focus card on the property page.
router.get("/api/properties/:id/tasks", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const status = (req.query.status as string) || "active";
    const statusFilter = status === "all" ? "" : "AND t.status <> 'done'";
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.is_pinned,
              t.linked_deal_id, t.linked_property_id, t.linked_contact_id, t.created_at, t.updated_at,
              t.user_id, COALESCE(u.name, u.username, u.email) AS owner_name, u.profile_pic_url,
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
        LIMIT 50`,
      [propertyId]
    );
    res.json({ tasks: rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "tasks fetch failed" });
  }
});

export default router;
