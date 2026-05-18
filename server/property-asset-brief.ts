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
         LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
         LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
         LEFT JOIN LATERAL (
           SELECT array_agg(da2.user_id) AS user_ids
             FROM crm_deal_agents da2 WHERE da2.deal_id = d.id
         ) da ON true
         LEFT JOIN LATERAL (
           SELECT SUM(amount_pence)::bigint AS amount_pence
             FROM deal_fee_allocations fa WHERE fa.deal_id = d.id
         ) df ON true
        WHERE (d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1)
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
         LEFT JOIN tenancy_schedule_units ts ON ts.id = d.tenancy_unit_id
        WHERE (d.property_id = $1 OR pu.property_id = $1 OR ts.property_id = $1)
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
      active_deals: activeDeals,
      pipeline,
      activity,
      risks,
      performance,
      commentary: p.notes || "",
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

// Regenerate the BGP Commentary — pulls the same data the brief
// renders (asset lead, owner, active deals, recent activity, risks,
// performance) and asks Claude Sonnet to write a 3-5 sentence
// operational narrative. Persisted on crm_properties so the panel
// always has a value even when offline.
router.post("/api/properties/:id/bgp-commentary/regenerate", requireAuth, async (req: Request, res: Response) => {
  try {
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

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const fmtMoney = (p: number | null | undefined) => p == null ? "—" : `£${Math.round(Number(p) / 100).toLocaleString()}`;
    const dealLines = (brief.active_deals as any[]).slice(0, 15).map(d => `- ${d.tenant_name || d.name}${d.unit_name ? ` @ ${d.unit_name}` : ""} — ${d.stage_label} (${fmtMoney(d.fee_pence)} fee)`).join("\n") || "(none)";
    const activityLines = (brief.activity as any[]).slice(0, 8).map(a => `- ${a.summary} (${new Date(a.date).toLocaleDateString("en-GB")})`).join("\n") || "(none in last 14 days)";
    const riskLines = (brief.risks as any[]).map(r => `- ${r.severity.toUpperCase()}: ${r.message}`).join("\n") || "(none flagged)";
    const focusLines = (brief.weekly_focus as any[]).map(f => `- ${f.text}`).join("\n") || "(none set)";
    const ownerName = brief.owner?.name || "the asset owner";
    const propertyName = brief.property?.name || "this property";

    const prompt = `You are a BGP analyst writing the commentary section of a client-facing operational brief on ${propertyName}, owned by ${ownerName}.

Active deals on the property:
${dealLines}

Recent activity (last 14 days):
${activityLines}

Risks flagged:
${riskLines}

Asset lead's stated focus this week:
${focusLines}

Performance: ${(brief.performance.vacancy_rate * 100).toFixed(1)}% vacancy${brief.performance.wault_years != null ? `, WAULT ${brief.performance.wault_years.toFixed(1)} yrs` : ""}.

Write a 3-5 sentence operational paragraph for the asset owner reading this. Cover:
1. What's actively moving on the property right now (the big-ticket live deals).
2. The risks worth flagging (vacancies / expiries / covenant).
3. Where BGP's focus is this week + a forward-looking line.

Rules: British English, partner-tone, no hype, no "I'm pleased to". Reference the actual tenants / units / £ figures above — don't generalise. No bullet points or headings, prose only. No preamble or "here is".`;

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
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
// property) the matching unit_id. One click → linked.
router.post("/api/properties/:id/adopt-deal", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const { dealId } = req.body as { dealId: string };
    if (!dealId) return res.status(400).json({ error: "dealId required" });

    // Try to find a matching unit on this property — by tenant brand
    // first (most reliable), then by tenant name string.
    const unit = await pool.query<{ unit_id: string | null }>(
      `SELECT pu.id AS unit_id
         FROM crm_deals d
         LEFT JOIN tenancy_schedule_units t
           ON t.property_id = $1
          AND (t.tenant_company_id = d.tenant_id
               OR lower(trim(coalesce(t.trading_name, t.tenant_name, ''))) =
                  lower(trim(coalesce((SELECT name FROM crm_companies WHERE id = d.tenant_id), ''))))
         LEFT JOIN property_units pu
           ON pu.property_id = $1
          AND lower(trim(pu.unit_name)) = lower(trim(t.unit_number))
        WHERE d.id = $2
        LIMIT 1`,
      [propertyId, dealId]
    );
    const unitId = unit.rows[0]?.unit_id || null;

    await pool.query(
      `UPDATE crm_deals
          SET property_id = $1${unitId ? ", unit_id = $3" : ""}
        WHERE id = $2`,
      unitId ? [propertyId, dealId, unitId] : [propertyId, dealId]
    );
    res.json({ ok: true, unitId });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
