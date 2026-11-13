// Landsec scheme and unit pages (docs/landsec-pitch-plan.md, item 2): one
// page per unit that everyone on the scheme shares. The unit is the tenancy
// schedule row (the canonical spine); the page gathers its leasing-schedule
// strategy row, the letting-tracker row with files, viewings and offers,
// the unit brief with its target operators, the live deal with its solicitor
// leg, the people on the scheme, and the Landsec-only fields in
// landsec_units (who to report to, who checks heads, leasing plan, marketing
// details, legal progress, solicitor catch-ups).
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { isPropertyInScope } from "./company-scope";
import { legacyToCode, CLOSED_STATUSES } from "@shared/deal-status";
import { LETTING_STATUS_LABELS } from "@shared/letting-rules";
import { resolveLandsecPortfolio, schemeForPropertyName, type LandsecPortfolio, type ResolvedScheme } from "./landsec-schemes";
import { landsecViewer, viewerCanSeeScheme, type LandsecViewer } from "./landsec-access";
import { landsecNer, landsecBriefCheck, landsecIncentivesRecorded, type LandsecAgreedBrief, type LandsecDealClock } from "@shared/landsec";
import { waitingClockFor, type WaitingClock } from "@shared/deal-waiting";
import { resolveStageSince, checkStageSinceInput, londonDay, statusLineIsMoveSql, type StageFacts } from "@shared/stage-since";
import { prepareWaitingLink, waitingChecklistsForDeals, waitingOptionsForDeal } from "./deal-checklist";

const VACANT = ["Vacant", "Void", "Available"];

const landsecScope = landsecViewer;

// A unit is reachable when its property is one of the 14 schemes, inside a
// client login's scope, and — for an asset manager or joint agent — one of
// the person's own schemes. This is also who may write a deal's clock (who it
// is waiting on): the checklist's "Deal is waiting on this" asks it too.
export async function unitAccess(req: Request, propertyId: string): Promise<(LandsecViewer & { schemeKey: string | null }) | null> {
  const scope = await landsecScope(req);
  if (!scope) return null;
  if (scope.isClient && !(await isPropertyInScope(scope.companyId, propertyId))) return null;
  const portfolio = await resolveLandsecPortfolio(scope.companyId);
  const scheme = portfolio.schemes.find(s => s.properties.some(p => p.id === propertyId));
  if (!scheme || !viewerCanSeeScheme(scope, scheme.key)) return null;
  return { ...scope, schemeKey: scheme.key };
}

function agreedBriefOf(r: any): LandsecAgreedBrief {
  return {
    use: r.brief_use, category: r.brief_category, nerFloor: r.brief_ner_floor, incentiveCeiling: r.brief_incentive_ceiling,
    capexEnvelope: r.brief_capex_envelope, targetBrands: r.brief_target_brands, notes: r.brief_notes,
    updatedAt: r.brief_updated_at, updatedByName: r.brief_updated_by_name,
    leasing: { by: r.brief_signed_leasing_by, at: r.brief_signed_leasing_at },
    am: { by: r.brief_signed_am_by, at: r.brief_signed_am_at },
  };
}

export const daysSince = (d: any, now: number = Date.now()): number | null => (d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / 86400000)) : null);

// What is known about when each deal reached its stage (shared/stage-since.ts
// has the rule, resolveStageSince): the latest status change in the audit
// log, with how many OTHER deals changed status in the same minute (a bulk
// stamp is not the day the deal moved), and the date a person set by hand.
// A deal with neither has no entry: the caller falls back to the deal's own
// stage timestamp, else its creation, which is never a confirmed date.
export async function stageSinceFor(dealIds: string[], db: { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> } = pool): Promise<Map<string, StageFacts>> {
  const out = new Map<string, StageFacts>();
  if (dealIds.length === 0) return out;
  const none = () => ({ rows: [] as any[] });
  const [history, set] = await Promise.all([
    db.query(
      `/* stage-since:history */
       WITH latest AS (
         SELECT deal_id, MAX(created_at) AS latest FROM deal_audit_log
          WHERE deal_id = ANY($1) AND field = 'status' AND ${statusLineIsMoveSql()}
          GROUP BY deal_id
       ), minutes AS (
         SELECT date_trunc('minute', a.created_at) AS minute, COUNT(DISTINCT a.deal_id)::int AS deals
           FROM deal_audit_log a
          WHERE a.field = 'status' AND ${statusLineIsMoveSql("a")}
            AND date_trunc('minute', a.created_at) IN (SELECT date_trunc('minute', latest) FROM latest)
          GROUP BY 1
       )
       SELECT l.deal_id, l.latest, GREATEST(COALESCE(m.deals, 1) - 1, 0) AS peers
         FROM latest l LEFT JOIN minutes m ON m.minute = date_trunc('minute', l.latest)`, [dealIds]).catch(none),
    // The date set by hand, and when it was set (its own line in the deal's
    // history). Read apart from the query above, so a failure here never
    // loses the dates the history gives.
    db.query(
      `/* stage-since:set */
       SELECT k.deal_id, k.stage_since::text AS stage_since, k.stage_since_code, k.stage_since_by_name,
              (SELECT MAX(a.created_at) FROM deal_audit_log a WHERE a.deal_id = k.deal_id AND a.field = 'stage_since') AS set_at
         FROM landsec_deal_clock k
        WHERE k.deal_id = ANY($1) AND k.stage_since IS NOT NULL`, [dealIds]).catch(none),
  ]);
  for (const row of history.rows) out.set(row.deal_id, { auditAt: row.latest, auditPeers: Number(row.peers) || 0 });
  for (const row of set.rows) {
    out.set(row.deal_id, {
      ...(out.get(row.deal_id) || {}),
      hand: { date: row.stage_since, code: row.stage_since_code, byName: row.stage_since_by_name, setAt: row.set_at },
    });
  }
  return out;
}

// The same answer for a caller that holds only the deals themselves (the
// Deals list's phone cards, GET /api/crm/deals): the date each deal reached
// its stage and whether it is confirmed, by the one rule, with the deal's own
// stage timestamp, else its creation, as the fallback. A deal whose date
// cannot be read at all has no entry.
export async function stageDatesForDeals(
  deals: { id: string; status?: string | null; createdAt?: string | Date | null }[],
  db: { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> } = pool,
): Promise<Map<string, { since: string; confirmed: boolean }>> {
  const out = new Map<string, { since: string; confirmed: boolean }>();
  const ids = deals.map(d => d.id).filter(Boolean);
  if (ids.length === 0) return out;
  const [facts, entered] = await Promise.all([
    stageSinceFor(ids, db),
    db.query(`/* stage-since:entered */ SELECT id, stage_entered_at FROM crm_deals WHERE id = ANY($1) AND stage_entered_at IS NOT NULL`, [ids])
      .then(r => new Map<string, any>(r.rows.map((row: any) => [row.id, row.stage_entered_at]))).catch(() => new Map<string, any>()),
  ]);
  for (const d of deals) {
    const stage = resolveStageSince(legacyToCode(d.status || null), facts.get(d.id), entered.get(d.id) || d.createdAt || null);
    const at = stage.since ? new Date(stage.since) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    out.set(d.id, { since: typeof stage.since === "string" ? stage.since : at.toISOString(), confirmed: stage.confirmed });
  }
  return out;
}

// The stage half of a deal's clock: its status code, the date it reached that
// stage, the days since, whether the date is confirmed, and the hand-set date
// while it applies. `fallback` is the deal's stage timestamp, else its creation.
function dealClock(status: string | null, facts: StageFacts | undefined, fallback: any) {
  const code = legacyToCode(status);
  const stage = resolveStageSince(code, facts, fallback);
  return { code, since: stage.since || null, days: daysSince(stage.since), stageConfirmed: stage.confirmed, stageSet: stage.set };
}

// Who may set the date a deal reached its stage: everyone who may write the
// clock at the scheme except an asset manager (nothing new was opened to
// asset managers in this build).
const canSetStageSince = (viewer: LandsecViewer): boolean => viewer.role !== "asset_manager";

// The property records a viewer can see: every record of the schemes the
// viewer has (all 14 for BGP staff, a full Landsec login and a leasing
// manager).
function visiblePropertyIds(viewer: LandsecViewer, portfolio: LandsecPortfolio): Set<string> {
  const out = new Set<string>();
  for (const s of portfolio.schemes) if (viewerCanSeeScheme(viewer, s.key)) for (const p of s.properties) out.add(p.id);
  return out;
}

// The scheme a property record belongs to: any of the scheme's records, not
// only the one links go to.
export function schemeOfProperty(portfolio: Pick<LandsecPortfolio, "schemes">, propertyId: string): ResolvedScheme | undefined {
  return propertyId ? portfolio.schemes.find(s => s.properties.some(p => p.id === propertyId)) : undefined;
}

// What a deal's "depends on" shows. A deal on a property the viewer cannot
// see (another scheme, a record that has left the schemes, a deleted deal)
// is sent as "another deal": no id, ref, name or unit.
export function dependsOnFor(row: { depends_on_deal_id: string | null; dep_ref?: number | null; dep_name?: string | null; dep_unit?: string | null; dep_property_id?: string | null }, visible: Set<string>): Pick<LandsecDealClock, "dependsOnDealId" | "dependsOn" | "dependsOnHidden"> {
  if (!row.depends_on_deal_id) return { dependsOnDealId: null, dependsOn: null, dependsOnHidden: false };
  if (!row.dep_property_id || !visible.has(row.dep_property_id)) return { dependsOnDealId: null, dependsOn: null, dependsOnHidden: true };
  return {
    dependsOnDealId: row.depends_on_deal_id,
    dependsOn: { id: row.depends_on_deal_id, ref: row.dep_ref ?? null, name: row.dep_name || "", unit: row.dep_unit ?? null },
    dependsOnHidden: false,
  };
}

async function clocksFor(dealIds: string[], visible: Set<string>): Promise<Map<string, WaitingClock>> {
  const out = new Map<string, WaitingClock>();
  if (dealIds.length === 0) return out;
  const r = await pool.query(
    `SELECT c.*, d.deal_ref AS dep_ref, d.name AS dep_name, d.property_id AS dep_property_id, COALESCE(t.premises, t.unit_number) AS dep_unit
       FROM landsec_deal_clock c
       LEFT JOIN crm_deals d ON d.id = c.depends_on_deal_id
       LEFT JOIN tenancy_schedule_units t ON t.id = d.tenancy_unit_id
      WHERE c.deal_id = ANY($1)`, [dealIds]);
  for (const c of r.rows) {
    out.set(c.deal_id, {
      waitingOnParty: c.waiting_on_party, waitingOnName: c.waiting_on_name, waitingSince: c.waiting_since, waitingNote: c.waiting_note,
      ...dependsOnFor(c, visible),
      updatedAt: c.updated_at, updatedByName: c.updated_by_name,
      // The deal checklist item the deal is waiting on (migration 0058).
      checklistItemId: c.checklist_item_id || null,
    });
  }
  return out;
}

function nerOfDeal(d: any) {
  return landsecNer({ headlinePa: d.rent_pa, rentFreeMonths: d.rent_free, capital: d.capital_contribution, leaseLength: d.lease_length, breakOption: d.break_option });
}

// The Net Effective Rent floor a unit's deals are checked against: the
// Targeting Brief's (unit_briefs commercials) first, else the older Agreed
// brief's (landsec_units.brief_ner_floor).
export function nerFloorOf(targetingCommercials: any, agreedBriefFloor: any): number | null {
  const fromBrief = Number(targetingCommercials?.nerFloorPa);
  if (Number.isFinite(fromBrief) && fromBrief > 0) return fromBrief;
  const old = Number(agreedBriefFloor);
  return agreedBriefFloor != null && Number.isFinite(old) && old > 0 ? old : null;
}

// Whether the unit has a brief and whether it is agreed: the Targeting Brief
// when the unit has one, else the older two-signature Agreed brief.
export function briefStateOf(targeting: { id?: string | null; agreedAt?: any } | null, agreed: { signedLeasingAt?: any; signedAmAt?: any; drafted?: boolean } | null): "agreed" | "drafted" | null {
  if (targeting?.id) return targeting.agreedAt ? "agreed" : "drafted";
  if (agreed?.signedLeasingAt && agreed?.signedAmAt) return "agreed";
  return agreed?.drafted ? "drafted" : null;
}

export function setupLandsecUnitRoutes(app: Express) {
  // The units of one scheme: tenancy rows with their live deal stage. The
  // scheme is named by its key, or found from one of its property records
  // (the property page's "Units and lettings" section knows a property id,
  // not a key). Both doors apply the same scheme check.
  const sendScheme = async (req: Request, res: Response, find: (portfolio: LandsecPortfolio) => ResolvedScheme | undefined, missing: string) => {
    try {
      const scope = await landsecScope(req);
      if (!scope) return res.status(403).json({ error: "Not available for this account" });
      const portfolio = await resolveLandsecPortfolio(scope.companyId);
      const scheme = find(portfolio);
      if (!scheme) return res.status(404).json({ error: missing });
      if (!viewerCanSeeScheme(scope, scheme.key)) return res.status(403).json({ error: "This scheme is outside your access" });
      const ids = scheme.properties.map(p => p.id);
      const units = ids.length === 0 ? { rows: [] as any[] } : await pool.query(
        `SELECT t.id, t.property_id, t.grouping, t.premises, t.unit_number, t.floor_level, t.status, t.tenant_name, t.trading_name,
                t.permitted_use, t.passing_rent_pa, t.erv_pa, t.gia_sqft, t.nia_sqft, t.lease_expiry, t.break_date, t.target_tenants,
                t.marketing_active, t.sort_order,
                au.id AS tracker_id, au.marketing_status, au.asking_rent,
                d.id AS deal_id, d.deal_ref, d.name AS deal_name, d.status AS deal_status, d.stage_entered_at, d.updated_at AS deal_updated_at, d.created_at AS deal_created_at,
                tc.name AS deal_tenant,
                lu.brief_signed_leasing_at, lu.brief_signed_am_at,
                (lu.brief_use IS NOT NULL OR lu.brief_category IS NOT NULL OR lu.brief_ner_floor IS NOT NULL OR lu.brief_target_brands IS NOT NULL) AS brief_drafted,
                ub.id AS targeting_brief_id, ub.agreed_at AS targeting_brief_agreed_at
           FROM tenancy_schedule_units t
           LEFT JOIN available_units au ON au.tenancy_unit_id = t.id
           LEFT JOIN landsec_units lu ON lu.tenancy_unit_id = t.id
           LEFT JOIN LATERAL (
             SELECT b.id, b.agreed_at FROM unit_briefs b WHERE b.unit_id = au.id ORDER BY b.created_at DESC LIMIT 1
           ) ub ON TRUE
           LEFT JOIN LATERAL (
             SELECT d.* FROM crm_deals d
              WHERE (d.tenancy_unit_id = t.id OR d.id = au.deal_id OR d.id = t.deal_id)
                AND d.status IS NOT NULL
              ORDER BY (lower(trim(d.status)) = ANY($2::text[])) ASC, d.updated_at DESC NULLS LAST
              LIMIT 1
           ) d ON TRUE
           LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
          WHERE t.property_id = ANY($1)
          ORDER BY t.property_id, t.sort_order, t.premises`,
        [ids, CLOSED_STATUSES.map(c => c.toLowerCase())]
      );
      const liveIds = units.rows.filter((r: any) => { const c = legacyToCode(r.deal_status); return c && !CLOSED_STATUSES.includes(c); }).map((r: any) => r.deal_id);
      // For waitingOn below: the same reading as the Deals feed (never throws).
      const schemeChecklists = await waitingChecklistsForDeals(liveIds);
      const [since, clocks] = await Promise.all([stageSinceFor(liveIds), clocksFor(liveIds, visiblePropertyIds(scope, portfolio))]);
      const rows = units.rows.map((r: any) => {
        const code = legacyToCode(r.deal_status);
        const live = code && !CLOSED_STATUSES.includes(code);
        return {
          id: r.id, propertyId: r.property_id, grouping: r.grouping, unit: r.premises || r.unit_number, unitNumber: r.unit_number,
          floor: r.floor_level, status: r.status, vacant: VACANT.includes(r.status), tenant: r.tenant_name || r.trading_name,
          use: r.permitted_use, passingRent: r.passing_rent_pa, erv: r.erv_pa, askingRent: r.asking_rent,
          sqft: r.nia_sqft ?? r.gia_sqft, leaseExpiry: r.lease_expiry, breakDate: r.break_date,
          targetTenants: r.target_tenants, marketingActive: r.marketing_active, trackerStatus: r.marketing_status,
          // The Targeting Brief when the unit has one, else the older Agreed
          // brief: the same reading as the deal clock feed below.
          brief: briefStateOf(
            r.targeting_brief_id ? { id: r.targeting_brief_id, agreedAt: r.targeting_brief_agreed_at } : null,
            { signedLeasingAt: r.brief_signed_leasing_at, signedAmAt: r.brief_signed_am_at, drafted: !!r.brief_drafted }),
          deal: live ? {
            id: r.deal_id, ref: r.deal_ref, name: r.deal_name, tenant: r.deal_tenant,
            ...dealClock(r.deal_status, since.get(r.deal_id), r.stage_entered_at || r.deal_created_at),
            // Who the deal is waiting on: what a person set, else what its
            // checklist gives (the party, else the person's name), so a deal
            // reads the same here as on the Deals page and the unit page.
            waitingOn: (clock => clock?.waitingOnParty || clock?.waitingOnName || null)(waitingClockFor(clocks.get(r.deal_id) || null, schemeChecklists.get(r.deal_id) || null, r.deal_id)),
          } : null,
        };
      });
      res.json({
        scheme: { key: scheme.key, name: scheme.name, town: scheme.town, group: scheme.group, propertyId: scheme.canonicalId,
          properties: scheme.properties.map(p => ({ id: p.id, name: p.name })) },
        units: rows,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load the scheme" });
    }
  };

  app.get("/api/landsec/scheme/:key", requireAuth, (req, res) =>
    sendScheme(req, res, portfolio => portfolio.schemes.find(s => s.key === req.params.key), "Unknown scheme"));

  // The same answer, found from a property record. A record that is not one
  // of the 14 schemes is a 404, which the property page reads as "no section".
  app.get("/api/landsec/scheme/by-property/:propertyId", requireAuth, (req, res) =>
    sendScheme(req, res, portfolio => schemeOfProperty(portfolio, String(req.params.propertyId)), "This property is not one of the Landsec schemes"));

  app.get("/api/landsec/unit/:id", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      // Accept a tracker id too — the Letting Tracker links by its own row.
      const t = await pool.query(
        `SELECT t.*, p.name AS property_name FROM tenancy_schedule_units t
           JOIN crm_properties p ON p.id = t.property_id
          WHERE t.id = $1 OR t.id = (SELECT tenancy_unit_id FROM available_units WHERE id = $1)
          LIMIT 1`, [id]);
      const unit = t.rows[0];
      if (!unit) return res.status(404).json({ error: "Unit not found" });
      const access = await unitAccess(req, unit.property_id);
      if (!access) return res.status(403).json({ error: "Unit is outside the Landsec schemes you can see" });
      const { isClient } = access;

      const [leasing, tracker, landsec] = await Promise.all([
        pool.query(`SELECT * FROM leasing_schedule_units WHERE tenancy_unit_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [unit.id]),
        pool.query(`SELECT * FROM available_units WHERE tenancy_unit_id = $1 OR id = $2 ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [unit.id, unit.letting_tracker_unit_id || ""]),
        pool.query(`SELECT * FROM landsec_units WHERE tenancy_unit_id = $1`, [unit.id]),
      ]);
      const trackerRow = tracker.rows[0] || null;

      const [files, viewings, offers, brief] = trackerRow
        ? await Promise.all([
            // The generated brief document carries BGP's notes on the targets: not for a joint agent.
            pool.query(`SELECT id, file_name, file_path, category, mime_type, created_at FROM unit_marketing_files WHERE unit_id = $1 AND ($2::boolean OR COALESCE(file_type, 'upload') <> 'targeting_brief') ORDER BY sort_order NULLS LAST, created_at`, [trackerRow.id, access.role !== "joint_agent"]),
            pool.query(`SELECT id, company_name, contact_name, viewing_date, viewing_time, outcome, status FROM unit_viewings WHERE unit_id = $1 AND deleted_at IS NULL ORDER BY viewing_date DESC LIMIT 20`, [trackerRow.id]).catch(() => ({ rows: [] as any[] })),
            pool.query(`SELECT id, company_name, offer_date, rent_pa, rent_free_months, term_years, break_option, incentives, premium, fitting_out_contribution, status FROM unit_offers WHERE unit_id = $1 ORDER BY offer_date DESC LIMIT 20`, [trackerRow.id]),
            pool.query(`SELECT * FROM unit_briefs WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 1`, [trackerRow.id]),
          ])
        : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
      const briefRow = brief.rows[0] || null;
      const briefJointAgent: string | null = briefRow
        ? ((await pool.query(`SELECT COALESCE(NULLIF(firm, ''), name) AS who FROM unit_brief_people WHERE brief_id = $1 AND role = 'joint_agent' ORDER BY sort_order, created_at LIMIT 1`, [briefRow.id]).catch(() => ({ rows: [] as any[] }))).rows[0]?.who || null)
        : null;
      // Sign-off on the targeting brief: how many of the people involved
      // have agreed its current version (server/unit-brief-workspace.ts).
      const briefSignoff = briefRow
        ? (await pool.query(
            `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE agreed_at IS NOT NULL AND agreed_version = $2)::int AS agreed FROM unit_brief_people WHERE brief_id = $1`,
            [briefRow.id, briefRow.version || 1]).catch(() => ({ rows: [{ total: 0, agreed: 0 }] }))).rows[0]
        : null;
      // "Agreed" is the brief's own agreed date (everyone, on both sides).
      if (briefSignoff) briefSignoff.complete = !!briefRow.agreed_at;
      const targets = briefRow
        // BGP's notes on a target are not for a joint agent.
        ? (await pool.query(`SELECT id, operator_name, company_id, category, priority, status, feedback FROM unit_target_operators WHERE brief_id = $1 ORDER BY sort_order, operator_name`, [briefRow.id])).rows
            .map((t: any) => (access.role === "joint_agent" ? { ...t, feedback: null, company_id: null } : t))
        : [];

      // The deal: the live one on the unit, else the most recent.
      const deal = (await pool.query(
        `SELECT d.id, d.deal_ref, d.name, d.status, d.stage, d.stage_entered_at, d.deal_type, d.instructed_at, d.target_date,
                d.exchanged_at, d.completed_at, d.created_at, d.updated_at,
                d.rent_pa, d.rent_free, d.capital_contribution, d.lease_length, d.break_option, d.break_party,
                d.solicitor_firm, d.solicitor_contact, d.solicitor_instructed_at, d.draft_lease_received_at, d.comments_returned_at,
                d.engrossment_at, d.solicitor_notes, d.fee, d.internal_agent, d.joint_agent_id,
                tc.name AS tenant_name, ja.name AS joint_agent_name
           FROM crm_deals d
           LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
           LEFT JOIN crm_companies ja ON ja.id = d.joint_agent_id
          WHERE (d.tenancy_unit_id = $1 OR d.id = $2 OR d.id = $3) AND d.status IS NOT NULL
          ORDER BY (lower(trim(d.status)) = ANY($4::text[])) ASC, d.updated_at DESC NULLS LAST
          LIMIT 1`,
        [unit.id, trackerRow?.deal_id || "", unit.deal_id || "", CLOSED_STATUSES.map(c => c.toLowerCase())]
      )).rows[0] || null;

      // People: BGP agents on the property, and Landsec contacts linked to it
      // (the pool for "report to" and "checks heads").
      const [agents, contacts, plans] = await Promise.all([
        pool.query(`SELECT u.id, u.name, u.email, a.role FROM crm_property_agents a JOIN users u ON u.id = a.user_id WHERE a.property_id = $1 ORDER BY a.role, u.name`, [unit.property_id]),
        pool.query(
          `SELECT c.id, c.name, c.role, c.email, c.phone FROM crm_contacts c
            WHERE c.company_id = $1 AND (
              c.id IN (SELECT contact_id FROM crm_contact_properties WHERE property_id = $2)
              OR c.id IN (SELECT report_to_contact_id FROM landsec_units WHERE property_id = $2)
              OR c.id IN (SELECT hots_checker_contact_id FROM landsec_units WHERE property_id = $2))
            ORDER BY c.name`,
          [access.companyId, unit.property_id]),
        pool.query(`SELECT id, floor, source, notes FROM property_plans WHERE property_id = $1 ORDER BY display_order`, [unit.property_id]).catch(() => ({ rows: [] as any[] })),
      ]);

      const code = deal ? legacyToCode(deal.status) : null;
      const portfolio = await resolveLandsecPortfolio(access.companyId);
      const [since, clocks, checklists, schemeDeals] = await Promise.all([
        stageSinceFor(deal ? [deal.id] : []),
        clocksFor(deal ? [deal.id] : [], visiblePropertyIds(access, portfolio)),
        waitingChecklistsForDeals(deal ? [deal.id] : []),
        pool.query(
          `SELECT d.id, d.deal_ref, d.name, COALESCE(t.premises, t.unit_number) AS unit FROM crm_deals d
             LEFT JOIN tenancy_schedule_units t ON t.id = d.tenancy_unit_id
            WHERE d.property_id = ANY($1) AND d.status IS NOT NULL AND lower(trim(d.status)) <> ALL($2::text[])
            ORDER BY t.premises, d.name LIMIT 200`,
          [portfolio.schemes.find(s => s.key === access.schemeKey)?.properties.map(p => p.id) || [unit.property_id], CLOSED_STATUSES.map(c => c.toLowerCase())]),
      ]);
      const briefRowLs = landsec.rows[0] || null;
      // The same floor, brief state and incentives rule as the Deals page
      // (GET /api/landsec/deals), so a deal reads the same in both places.
      const nerFloor = nerFloorOf(briefRow?.commercials, briefRowLs?.brief_ner_floor);
      const dealNer = deal ? nerOfDeal(deal) : null;
      const dealIncentives = deal ? landsecIncentivesRecorded(deal.rent_free, deal.capital_contribution) : false;
      const dealBrief = briefStateOf(
        briefRow ? { id: briefRow.id, agreedAt: briefRow.agreed_at } : null,
        briefRowLs ? { signedLeasingAt: briefRowLs.brief_signed_leasing_at, signedAmAt: briefRowLs.brief_signed_am_at, drafted: briefRowLs.brief_ner_floor != null } : null);
      res.json({
        unit: {
          id: unit.id, propertyId: unit.property_id, propertyName: unit.property_name, schemeKey: access.schemeKey,
          schemeName: schemeForPropertyName(unit.property_name)?.name || unit.property_name,
          grouping: unit.grouping, unit: unit.premises || unit.unit_number, unitNumber: unit.unit_number, floor: unit.floor_level,
          status: unit.status, vacant: VACANT.includes(unit.status), occupancyStatus: unit.occupancy_status,
          tenant: unit.tenant_name, tradingName: unit.trading_name, use: unit.permitted_use, tenantMix: unit.tenant_mix,
          leaseStart: unit.lease_start, leaseExpiry: unit.lease_expiry, breakDate: unit.break_date, breakDetails: unit.break_details,
          nextReviewDate: unit.next_review_date, termYears: unit.term_years, outsideLtAct: unit.outside_lt_act,
          areas: {
            basementGia: unit.area_basement_gia, groundGia: unit.area_ground_gia, firstGia: unit.area_first_gia, otherGia: unit.area_other_gia,
            basementNia: unit.area_basement_nia, groundNia: unit.area_ground_nia, firstNia: unit.area_first_nia, otherNia: unit.area_other_nia,
            groundItza: unit.area_ground_itza, giaSqft: unit.gia_sqft, niaSqft: unit.nia_sqft, itzaSqft: unit.itza_sqft,
          },
          passingRent: unit.passing_rent_pa, marketingRent: unit.marketing_rent_pa, erv: unit.erv_pa, ervProfile: unit.erv_profile,
          rentPsf: unit.rent_psf, rentFreeValue: unit.rent_free_value, capexValue: unit.capex_value,
          rateableValue: unit.rateable_value, ratesPayable: unit.rates_payable, serviceCharge: unit.service_charge,
          targetTenants: unit.target_tenants, leasingComments: unit.leasing_comments, comments: unit.comments,
          epcRating: unit.epc_rating, marketingActive: unit.marketing_active, marketingReason: unit.marketing_reason,
        },
        leasing: leasing.rows[0] ? {
          id: leasing.rows[0].id, targetBrands: leasing.rows[0].target_brands, optimumTarget: leasing.rows[0].optimum_target,
          priority: leasing.rows[0].priority, status: leasing.rows[0].status, updates: leasing.rows[0].updates,
          positioning: leasing.rows[0].positioning, zone: leasing.rows[0].zone, matPsqft: leasing.rows[0].mat_psqft,
          lflPercent: leasing.rows[0].lfl_percent, occCostPercent: leasing.rows[0].occ_cost_percent,
        } : null,
        tracker: trackerRow ? {
          id: trackerRow.id, marketingStatus: trackerRow.marketing_status, askingRent: trackerRow.asking_rent, rentPoa: trackerRow.rent_poa,
          leaseTerms: trackerRow.lease_terms, availableDate: trackerRow.available_date, showOnWebsite: trackerRow.show_on_website,
          marketingStartDate: trackerRow.marketing_start_date, viewingsCount: trackerRow.viewings_count, lastViewingDate: trackerRow.last_viewing_date,
          notes: trackerRow.notes, restrictions: trackerRow.restrictions, hotsContent: trackerRow.hots_content || null, hotsUpdatedAt: trackerRow.hots_updated_at || null,
          files: files.rows.map((f: any) => ({ id: f.id, name: f.file_name, category: f.category, mimeType: f.mime_type, url: String(f.file_path || "").startsWith("/") ? f.file_path : `/uploads/${f.file_path}`, createdAt: f.created_at })),
          // A joint agent is never sent the brand's contact at a viewing.
          viewings: access.role === "joint_agent" ? viewings.rows.map((v: any) => ({ ...v, contact_name: null })) : viewings.rows,
          offers: offers.rows.map((o: any) => {
            const ner = landsecNer({ headlinePa: o.rent_pa, rentFreeMonths: o.rent_free_months, capital: (o.fitting_out_contribution || 0) + (o.premium || 0), termYears: o.term_years, breakOption: o.break_option });
            const incentivesRecorded = landsecIncentivesRecorded(o.rent_free_months, o.fitting_out_contribution, o.premium);
            return { ...o, ner, incentivesRecorded, briefCheck: landsecBriefCheck(ner?.nerPa, nerFloor, incentivesRecorded) };
          }),
        } : null,
        schemeLiveDeals: schemeDeals.rows.map((d: any) => ({ id: d.id, ref: d.deal_ref, name: d.name, unit: d.unit })),
        brief: briefRow ? {
          id: briefRow.id, title: briefRow.title, objective: briefRow.objective, targetCriteria: briefRow.target_criteria,
          priorityCategories: briefRow.priority_categories, agentInstruction: briefRow.agent_instruction, status: briefRow.status,
          instructedDate: briefRow.instructed_date, targets,
          signoff: briefSignoff, agreedAt: briefRow.agreed_at || null,
          // Sole or joint agents and each agent's share: for every role,
          // the joint agent included.
          agencyBasis: briefRow.agency_basis || null, jointAgentFeePct: briefRow.joint_agent_fee_pct ?? null, jointAgentName: briefJointAgent,
        } : null,
        deal: deal ? {
          id: deal.id, ref: deal.deal_ref, name: deal.name, status: deal.status, live: !!code && !CLOSED_STATUSES.includes(code),
          stage: deal.stage, stageEnteredAt: deal.stage_entered_at, ...dealClock(deal.status, since.get(deal.id), deal.stage_entered_at || deal.created_at),
          // Whether this viewer may set the date the deal reached its stage.
          canSetStage: !!code && !CLOSED_STATUSES.includes(code) && canSetStageSince(access),
          ner: dealNer, incentivesRecorded: dealIncentives, briefCheck: landsecBriefCheck(dealNer?.nerPa, nerFloor, dealIncentives), brief: dealBrief,
          // Who it is waiting on: as set, else read from the deal's checklist
          // (marked derived; nothing is stored until a person saves).
          // A deal that has closed is not waiting on anyone: only what was set is shown.
          clock: waitingClockFor(clocks.get(deal.id) || null, code && !CLOSED_STATUSES.includes(code) ? checklists.get(deal.id) || null : null, deal.id),
          dealType: deal.deal_type, tenant: deal.tenant_name, instructedAt: deal.instructed_at, targetDate: deal.target_date,
          exchangedAt: deal.exchanged_at, completedAt: deal.completed_at, updatedAt: deal.updated_at,
          terms: { rentPa: deal.rent_pa, rentFree: deal.rent_free, capitalContribution: deal.capital_contribution, leaseLength: deal.lease_length, breakOption: deal.break_option, breakParty: deal.break_party },
          solicitors: { firm: deal.solicitor_firm, contact: deal.solicitor_contact, instructedAt: deal.solicitor_instructed_at, draftLeaseReceivedAt: deal.draft_lease_received_at, commentsReturnedAt: deal.comments_returned_at, engrossmentAt: deal.engrossment_at, notes: deal.solicitor_notes },
          jointAgent: deal.joint_agent_name,
          fee: isClient ? undefined : deal.fee,
          agents: isClient ? undefined : deal.internal_agent,
        } : null,
        // A joint agent is told who at BGP is on the property, not their email.
        people: { bgp: access.role === "joint_agent" ? agents.rows.map((a: any) => ({ ...a, email: null })) : agents.rows, landsec: contacts.rows },
        plans: plans.rows,
        agreedBrief: landsec.rows[0] ? agreedBriefOf(landsec.rows[0]) : null,
        landsec: landsec.rows[0] ? {
          reportToContactId: landsec.rows[0].report_to_contact_id, reportToName: landsec.rows[0].report_to_name,
          hotsCheckerContactId: landsec.rows[0].hots_checker_contact_id, hotsCheckerName: landsec.rows[0].hots_checker_name,
          incentives: landsec.rows[0].incentives, leasingPlan: landsec.rows[0].leasing_plan, marketingDetails: landsec.rows[0].marketing_details,
          legalProgress: landsec.rows[0].legal_progress, solicitorCatchups: landsec.rows[0].solicitor_catchups || [],
          updatedAt: landsec.rows[0].updated_at, updatedByName: landsec.rows[0].updated_by_name,
        } : null,
        viewer: { isClient, role: access.role },
      });
    } catch (e: any) {
      console.error("[/api/landsec/unit]", e?.message);
      res.status(500).json({ error: e?.message || "Failed to load the unit" });
    }
  });

  // Save the page's editable fields. Each key writes to the table that owns
  // it; the Landsec-only fields upsert landsec_units. Unknown keys are
  // ignored, so a client login cannot reach fee or allocation columns.
  app.put("/api/landsec/unit/:id", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const unit = (await pool.query(`SELECT id, property_id, letting_tracker_unit_id, deal_id FROM tenancy_schedule_units WHERE id = $1`, [id])).rows[0];
      if (!unit) return res.status(404).json({ error: "Unit not found" });
      const access = await unitAccess(req, unit.property_id);
      if (!access) return res.status(403).json({ error: "Unit is outside the Landsec schemes you can see" });
      const b = req.body || {};
      const userId = req.session?.userId || (req as any).tokenUserId;
      const userName = userId ? (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId])).rows[0]?.name || null : null;
      const num = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));
      const txt = (v: any) => (v === undefined ? undefined : v === null || v === "" ? null : String(v));
      const written: string[] = [];

      // Tenancy row: ERV and target tenants.
      if ("erv" in b || "targetTenants" in b) {
        await pool.query(
          `UPDATE tenancy_schedule_units SET
             erv_pa = CASE WHEN $2::boolean THEN $3 ELSE erv_pa END,
             target_tenants = CASE WHEN $4::boolean THEN $5 ELSE target_tenants END,
             updated_at = NOW()
           WHERE id = $1`,
          [id, "erv" in b, num(b.erv), "targetTenants" in b, txt(b.targetTenants) ?? null]
        );
        written.push("tenancy");
      }
      // Leasing-schedule row: target brands.
      if ("targetBrands" in b) {
        const r = await pool.query(`UPDATE leasing_schedule_units SET target_brands = $2, updated_at = NOW() WHERE tenancy_unit_id = $1`, [id, txt(b.targetBrands) ?? null]);
        if (r.rowCount) written.push("leasing");
      }
      // Tracker row: target (asking) rent and lease terms.
      if ("askingRent" in b || "leaseTerms" in b) {
        const r = await pool.query(
          `UPDATE available_units SET
             asking_rent = CASE WHEN $2::boolean THEN $3 ELSE asking_rent END,
             lease_terms = CASE WHEN $4::boolean THEN $5 ELSE lease_terms END,
             updated_at = NOW()
           WHERE tenancy_unit_id = $1 OR id = $6`,
          [id, "askingRent" in b, num(b.askingRent), "leaseTerms" in b, txt(b.leaseTerms) ?? null, unit.letting_tracker_unit_id || ""]
        );
        if (r.rowCount) written.push("tracker");
      }
      // Deal: the solicitor leg.
      const sol = b.solicitors;
      if (sol && typeof sol === "object") {
        const dealId = String(b.dealId || "");
        const own = dealId ? (await pool.query(`SELECT id FROM crm_deals WHERE id = $1 AND (tenancy_unit_id = $2 OR id = $3 OR id = (SELECT deal_id FROM available_units WHERE tenancy_unit_id = $2 LIMIT 1))`, [dealId, id, unit.deal_id || ""])).rows[0] : null;
        if (!own) return res.status(400).json({ error: "That deal is not on this unit" });
        const date = (v: any) => (v === undefined ? undefined : v ? new Date(v) : null);
        await pool.query(
          `UPDATE crm_deals SET
             solicitor_firm = COALESCE($2, solicitor_firm), solicitor_contact = COALESCE($3, solicitor_contact),
             solicitor_instructed_at = CASE WHEN $4::boolean THEN $5 ELSE solicitor_instructed_at END,
             draft_lease_received_at = CASE WHEN $6::boolean THEN $7 ELSE draft_lease_received_at END,
             comments_returned_at = CASE WHEN $8::boolean THEN $9 ELSE comments_returned_at END,
             engrossment_at = CASE WHEN $10::boolean THEN $11 ELSE engrossment_at END,
             solicitor_notes = COALESCE($12, solicitor_notes), updated_at = NOW()
           WHERE id = $1`,
          [dealId, txt(sol.firm) ?? null, txt(sol.contact) ?? null,
           "instructedAt" in sol, date(sol.instructedAt) ?? null,
           "draftLeaseReceivedAt" in sol, date(sol.draftLeaseReceivedAt) ?? null,
           "commentsReturnedAt" in sol, date(sol.commentsReturnedAt) ?? null,
           "engrossmentAt" in sol, date(sol.engrossmentAt) ?? null,
           txt(sol.notes) ?? null]
        );
        written.push("deal");
      }
      // The agreed brief: any change to its terms withdraws both signatures.
      const ab = b.agreedBrief;
      if (ab && typeof ab === "object") {
        await pool.query(
          `INSERT INTO landsec_units (tenancy_unit_id, property_id, brief_use, brief_category, brief_ner_floor, brief_incentive_ceiling,
                                      brief_capex_envelope, brief_target_brands, brief_notes, brief_updated_at, brief_updated_by_name, updated_by, updated_by_name, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $10, NOW())
           ON CONFLICT (tenancy_unit_id) DO UPDATE SET
             brief_use = EXCLUDED.brief_use, brief_category = EXCLUDED.brief_category, brief_ner_floor = EXCLUDED.brief_ner_floor,
             brief_incentive_ceiling = EXCLUDED.brief_incentive_ceiling, brief_capex_envelope = EXCLUDED.brief_capex_envelope,
             brief_target_brands = EXCLUDED.brief_target_brands, brief_notes = EXCLUDED.brief_notes,
             brief_updated_at = NOW(), brief_updated_by_name = EXCLUDED.brief_updated_by_name,
             brief_signed_leasing_by = NULL, brief_signed_leasing_user_id = NULL, brief_signed_leasing_at = NULL,
             brief_signed_am_by = NULL, brief_signed_am_user_id = NULL, brief_signed_am_at = NULL,
             updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
          [id, unit.property_id, txt(ab.use) ?? null, txt(ab.category) ?? null, num(ab.nerFloor), txt(ab.incentiveCeiling) ?? null,
           num(ab.capexEnvelope), txt(ab.targetBrands) ?? null, txt(ab.notes) ?? null, userName, userId || null]
        );
        written.push("agreedBrief");
      }
      // Landsec-only fields.
      const ls = b.landsec;
      if (ls && typeof ls === "object") {
        const existing = (await pool.query(`SELECT solicitor_catchups FROM landsec_units WHERE tenancy_unit_id = $1`, [id])).rows[0];
        let catchups: any[] = Array.isArray(existing?.solicitor_catchups) ? existing.solicitor_catchups : [];
        if (ls.addCatchup && typeof ls.addCatchup === "object" && String(ls.addCatchup.note || "").trim()) {
          catchups = [{ at: ls.addCatchup.at || new Date().toISOString(), note: String(ls.addCatchup.note).trim(), byName: userName }, ...catchups].slice(0, 100);
        }
        await pool.query(
          `INSERT INTO landsec_units (tenancy_unit_id, property_id, report_to_contact_id, report_to_name, hots_checker_contact_id, hots_checker_name,
                                      incentives, leasing_plan, marketing_details, legal_progress, solicitor_catchups, updated_by, updated_by_name, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, NOW())
           ON CONFLICT (tenancy_unit_id) DO UPDATE SET
             report_to_contact_id = CASE WHEN $14::boolean THEN EXCLUDED.report_to_contact_id ELSE landsec_units.report_to_contact_id END,
             report_to_name = CASE WHEN $15::boolean THEN EXCLUDED.report_to_name ELSE landsec_units.report_to_name END,
             hots_checker_contact_id = CASE WHEN $16::boolean THEN EXCLUDED.hots_checker_contact_id ELSE landsec_units.hots_checker_contact_id END,
             hots_checker_name = CASE WHEN $17::boolean THEN EXCLUDED.hots_checker_name ELSE landsec_units.hots_checker_name END,
             incentives = CASE WHEN $18::boolean THEN EXCLUDED.incentives ELSE landsec_units.incentives END,
             leasing_plan = CASE WHEN $19::boolean THEN EXCLUDED.leasing_plan ELSE landsec_units.leasing_plan END,
             marketing_details = CASE WHEN $20::boolean THEN EXCLUDED.marketing_details ELSE landsec_units.marketing_details END,
             legal_progress = CASE WHEN $21::boolean THEN EXCLUDED.legal_progress ELSE landsec_units.legal_progress END,
             solicitor_catchups = EXCLUDED.solicitor_catchups,
             updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
          [id, unit.property_id,
           txt(ls.reportToContactId) ?? null, txt(ls.reportToName) ?? null, txt(ls.hotsCheckerContactId) ?? null, txt(ls.hotsCheckerName) ?? null,
           txt(ls.incentives) ?? null, txt(ls.leasingPlan) ?? null, txt(ls.marketingDetails) ?? null, txt(ls.legalProgress) ?? null,
           JSON.stringify(catchups), userId || null, userName,
           "reportToContactId" in ls, "reportToName" in ls, "hotsCheckerContactId" in ls, "hotsCheckerName" in ls,
           "incentives" in ls, "leasingPlan" in ls, "marketingDetails" in ls, "legalProgress" in ls]
        );
        written.push("landsec");
      }
      res.json({ ok: true, written });
    } catch (e: any) {
      console.error("[/api/landsec/unit PUT]", e?.message);
      res.status(500).json({ error: e?.message || "Failed to save the unit" });
    }
  });

  // Every live deal across the 14 schemes with its stage, days at stage,
  // who it is waiting on, what it depends on and its Net Effective Rent —
  // the portfolio view of where deals are stuck and with whom. This is the
  // clock feed: the Deals page, its board and the deal page join it by deal
  // id for a Landsec viewer (docs/landsec-menu-plan-2026-11-12.md, part 4),
  // and the older Lettings page lists it. A deal that is not on a scheme
  // property is not in it, so its clock cells are blank.
  app.get("/api/landsec/deals", requireAuth, async (req, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope) return res.status(403).json({ error: "Not available for this account" });
      const portfolio = await resolveLandsecPortfolio(scope.companyId);
      const propToScheme = new Map<string, { key: string; name: string }>();
      for (const s of portfolio.schemes) if (viewerCanSeeScheme(scope, s.key)) for (const p of s.properties) propToScheme.set(p.id, { key: s.key, name: s.name });
      const ids = Array.from(propToScheme.keys());
      if (ids.length === 0) return res.json({ deals: [], parties: {} });
      // The unit and the brief are found through the deal's own unit link
      // and, where a deal has none, through the Letting Tracker row that
      // points at it (available_units.deal_id): every tracker unit's backing
      // deal is linked that way. Only a unit on a property the viewer can
      // see is named or linked.
      const r = await pool.query(
        `SELECT d.id, d.deal_ref, d.name, d.status, d.deal_type, d.property_id, d.tenancy_unit_id, d.stage_entered_at, d.created_at, d.updated_at,
                d.rent_pa, d.rent_free, d.capital_contribution, d.lease_length, d.break_option, d.fee, d.joint_agent_id,
                tc.name AS tenant_name, ja.name AS joint_agent_name,
                COALESCE(t.premises, t.unit_number, au.unit_name) AS unit_name, t.id AS unit_id, au.id AS tracker_id,
                ub.id AS targeting_brief_id, ub.agreed_at AS targeting_brief_agreed_at, ub.commercials AS targeting_brief_commercials,
                lu.brief_ner_floor, lu.brief_signed_leasing_at, lu.brief_signed_am_at
           FROM crm_deals d
           LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
           LEFT JOIN crm_companies ja ON ja.id = d.joint_agent_id
           LEFT JOIN LATERAL (
             SELECT a.id, a.unit_name, a.tenancy_unit_id FROM available_units a
              WHERE a.property_id = ANY($1) AND (a.deal_id = d.id OR (d.tenancy_unit_id IS NOT NULL AND a.tenancy_unit_id = d.tenancy_unit_id))
              ORDER BY (a.deal_id = d.id) DESC NULLS LAST, a.updated_at DESC NULLS LAST
              LIMIT 1
           ) au ON TRUE
           LEFT JOIN tenancy_schedule_units t ON t.id = COALESCE(d.tenancy_unit_id, au.tenancy_unit_id) AND t.property_id = ANY($1)
           LEFT JOIN landsec_units lu ON lu.tenancy_unit_id = t.id
           LEFT JOIN LATERAL (
             SELECT b.id, b.agreed_at, b.commercials FROM unit_briefs b WHERE b.unit_id = au.id ORDER BY b.created_at DESC LIMIT 1
           ) ub ON TRUE
          WHERE d.property_id = ANY($1) AND d.status IS NOT NULL AND lower(trim(d.status)) <> ALL($2::text[])
          ORDER BY d.updated_at DESC NULLS LAST`,
        [ids, CLOSED_STATUSES.map(c => c.toLowerCase())]
      );
      const live = r.rows.filter((d: any) => { const c = legacyToCode(d.status); return c && !CLOSED_STATUSES.includes(c); });
      const dealIds = live.map((d: any) => d.id);
      const [since, clocks, checklists] = await Promise.all([stageSinceFor(dealIds), clocksFor(dealIds, new Set(ids)), waitingChecklistsForDeals(dealIds)]);
      const parties: Record<string, number> = {};
      const deals = live.map((d: any) => {
        // A deal nobody has set a waiting-on for shows the one read from its
        // checklist, marked derived; it counts as named in every filter.
        const clock = waitingClockFor(clocks.get(d.id) || null, checklists.get(d.id) || null, d.id);
        if (clock?.waitingOnParty) parties[clock.waitingOnParty] = (parties[clock.waitingOnParty] || 0) + 1;
        const ner = nerOfDeal(d);
        const incentivesRecorded = landsecIncentivesRecorded(d.rent_free, d.capital_contribution);
        return {
          id: d.id, ref: d.deal_ref, name: d.name, dealType: d.deal_type, tenant: d.tenant_name, jointAgent: d.joint_agent_name,
          scheme: propToScheme.get(d.property_id) || null, propertyId: d.property_id, unitId: d.unit_id, unit: d.unit_name, trackerId: d.tracker_id,
          ...dealClock(d.status, since.get(d.id), d.stage_entered_at || d.created_at),
          waitingDays: clock?.waitingSince ? daysSince(clock.waitingSince) : null,
          clock,
          ner, incentivesRecorded,
          briefCheck: landsecBriefCheck(ner?.nerPa, nerFloorOf(d.targeting_brief_commercials, d.brief_ner_floor), incentivesRecorded),
          brief: briefStateOf(
            d.targeting_brief_id ? { id: d.targeting_brief_id, agreedAt: d.targeting_brief_agreed_at } : null,
            { signedLeasingAt: d.brief_signed_leasing_at, signedAmAt: d.brief_signed_am_at, drafted: d.brief_ner_floor != null }),
          fee: scope.isClient ? undefined : d.fee,
        };
      }).sort((a: any, b: any) => (b.days ?? -1) - (a.days ?? -1));
      // canSetStage: whether this viewer may set the date a deal reached its stage.
      res.json({ deals, parties, canSetStage: canSetStageSince(scope) });
    } catch (e: any) {
      console.error("[/api/landsec/deals]", e?.message);
      res.status(500).json({ error: e?.message || "Failed to load the deals" });
    }
  });

  // What the Waiting on editor offers for a deal: the open items on its
  // checklist and the people who can be made responsible for one. Reading
  // it never starts a checklist.
  app.get("/api/landsec/deal/:id/waiting-options", requireAuth, async (req, res) => {
    try {
      const dealId = String(req.params.id);
      const deal = (await pool.query(`SELECT id, property_id FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
      if (!deal?.property_id) return res.status(404).json({ error: "Deal not found" });
      if (!(await unitAccess(req, deal.property_id))) return res.status(403).json({ error: "Deal is outside the Landsec schemes you can see" });
      res.json(await waitingOptionsForDeal(req, dealId));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load the checklist items" });
    }
  });

  // Who the deal is waiting on. checklistItemId links it to an open item on
  // the deal's own checklist (null clears the link); newItemLabel adds a new
  // item to that checklist and links it; personKey makes that person
  // responsible for the linked item through the checklist's own assign (one
  // task, one email). The party, name and note default from the item.
  //
  // stageSince (yyyy-mm-dd, or null to clear) is the date the deal reached its
  // current stage, set by hand: shared/stage-since.ts has the rule. It is
  // saved apart from the waiting-on, with its own line in the deal's history.
  app.put("/api/landsec/deal/:id/clock", requireAuth, async (req, res) => {
    try {
      const dealId = String(req.params.id);
      const deal = (await pool.query(`SELECT id, property_id, status, stage_entered_at, created_at FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
      if (!deal?.property_id) return res.status(404).json({ error: "Deal not found" });
      const access = await unitAccess(req, deal.property_id);
      if (!access) return res.status(403).json({ error: "Deal is outside the Landsec schemes you can see" });
      const b = req.body || {};
      // The stage date is checked before anything is written.
      const settingStage = "stageSince" in b;
      const stageCode = legacyToCode(deal.status);
      let stageSince: string | null = null;
      if (settingStage) {
        if (!canSetStageSince(access)) return res.status(403).json({ error: "An asset manager login cannot set the date a deal reached its stage" });
        if (!stageCode || CLOSED_STATUSES.includes(stageCode)) return res.status(400).json({ error: "The date can only be set on a live deal" });
        const checked = checkStageSinceInput(b.stageSince, { today: londonDay(), createdAt: deal.created_at });
        if (!checked.ok) return res.status(400).json({ error: checked.error });
        stageSince = checked.date;
      }
      // A request that only sets the stage date leaves the waiting-on, and who last changed it, as they are.
      const stageOnly = settingStage && Object.keys(b).every(k => k === "stageSince");
      const userId = req.session?.userId || (req as any).tokenUserId;
      const userName = userId ? (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId])).rows[0]?.name || null : null;
      const txt = (v: any) => (v === undefined ? undefined : v === null || v === "" ? null : String(v));
      const dependsOn = txt(b.dependsOnDealId);
      if (dependsOn) {
        if (dependsOn === dealId) return res.status(400).json({ error: "A deal cannot depend on itself" });
        const dep = (await pool.query(`SELECT property_id FROM crm_deals WHERE id = $1`, [dependsOn])).rows[0];
        if (!dep || !(await unitAccess(req, dep.property_id))) return res.status(400).json({ error: "The deal it depends on is not on a Landsec scheme you can see" });
      }
      // The link to the deal's checklist, checked before anything is written:
      // the item is on this deal's own checklist and still open.
      const linking = "checklistItemId" in b || b.newItemLabel != null || b.personKey != null;
      const link = linking ? await prepareWaitingLink(req, dealId, b) : null;
      if (link && !link.ok) return res.status(link.status).json({ error: link.error });
      const linked = link && link.ok ? link : null;
      const existing = (await pool.query(`SELECT * FROM landsec_deal_clock WHERE deal_id = $1`, [dealId])).rows[0];
      const itemChanged = !!linked && (linked.itemId || null) !== (existing?.checklist_item_id || null);
      // With an item linked, what the form leaves out comes from the item:
      // the party its responsible person stands for, their name, its label.
      const party = "waitingOnParty" in b ? txt(b.waitingOnParty) : linked?.itemId && itemChanged ? linked.party : undefined;
      const name = "waitingOnName" in b ? txt(b.waitingOnName) : linked?.itemId && itemChanged ? linked.name : undefined;
      const note = "waitingNote" in b ? txt(b.waitingNote) : linked?.itemId && itemChanged ? linked.label : undefined;
      // The waiting clock restarts when the party or the linked item changes
      // (or a date is given).
      const since = b.waitingSince ? new Date(b.waitingSince)
        : linked?.itemId && itemChanged ? new Date()
        : party === undefined ? undefined
        : party === null ? (linked?.itemId || name ? existing?.waiting_since || new Date() : null)
        : existing?.waiting_on_party === party && existing?.waiting_since ? existing.waiting_since : new Date();
      if (!stageOnly) await pool.query(
        `INSERT INTO landsec_deal_clock (deal_id, waiting_on_party, waiting_on_name, waiting_since, waiting_note, depends_on_deal_id, updated_by, updated_by_name, updated_at, checklist_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $14)
         ON CONFLICT (deal_id) DO UPDATE SET
           waiting_on_party = CASE WHEN $9::boolean THEN EXCLUDED.waiting_on_party ELSE landsec_deal_clock.waiting_on_party END,
           waiting_on_name = CASE WHEN $10::boolean THEN EXCLUDED.waiting_on_name ELSE landsec_deal_clock.waiting_on_name END,
           waiting_since = CASE WHEN $11::boolean THEN EXCLUDED.waiting_since ELSE landsec_deal_clock.waiting_since END,
           waiting_note = CASE WHEN $12::boolean THEN EXCLUDED.waiting_note ELSE landsec_deal_clock.waiting_note END,
           depends_on_deal_id = CASE WHEN $13::boolean THEN EXCLUDED.depends_on_deal_id ELSE landsec_deal_clock.depends_on_deal_id END,
           checklist_item_id = CASE WHEN $15::boolean THEN EXCLUDED.checklist_item_id ELSE landsec_deal_clock.checklist_item_id END,
           updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
        [dealId, party ?? null, name ?? null, since ?? null, note ?? null, dependsOn ?? null, userId || null, userName,
         party !== undefined, name !== undefined, since !== undefined, note !== undefined, "dependsOnDealId" in b,
         linked?.itemId || null, !!linked]
      );
      // The stage date and its line in the deal's history are one statement:
      // the line's time is how a later change of status stops the date applying.
      if (settingStage && stageSince) {
        await pool.query(
          `WITH was AS (SELECT stage_since::text AS d FROM landsec_deal_clock WHERE deal_id = $1),
                up AS (
                  INSERT INTO landsec_deal_clock (deal_id, stage_since, stage_since_code, stage_since_by_name)
                  VALUES ($1, ($2::text)::date, $3, $4)
                  ON CONFLICT (deal_id) DO UPDATE SET stage_since = EXCLUDED.stage_since, stage_since_code = EXCLUDED.stage_since_code, stage_since_by_name = EXCLUDED.stage_since_by_name
                  RETURNING deal_id)
           INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name)
           SELECT up.deal_id, 'stage_since', (SELECT d FROM was), $2::text, $5, $6, $4 FROM up`,
          [dealId, stageSince, stageCode, userName, `Date the deal reached ${LETTING_STATUS_LABELS[stageCode!] || stageCode} set by hand`, userId || null]);
      } else if (settingStage) {
        await pool.query(
          `WITH was AS (SELECT stage_since::text AS d FROM landsec_deal_clock WHERE deal_id = $1 AND stage_since IS NOT NULL),
                up AS (
                  UPDATE landsec_deal_clock SET stage_since = NULL, stage_since_code = NULL, stage_since_by_name = NULL
                   WHERE deal_id = $1 AND stage_since IS NOT NULL
                  RETURNING deal_id)
           INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name)
           SELECT up.deal_id, 'stage_since', (SELECT d FROM was), NULL, 'Hand-set stage date cleared', $2, $3 FROM up`,
          [dealId, userId || null, userName]);
      }
      // The named person is made responsible for the linked item by the
      // checklist itself, after the clock is saved: one task, one email.
      const assigned = linked ? await linked.assign() : null;
      const [stored, checklists] = await Promise.all([
        clocksFor([dealId], visiblePropertyIds(access, await resolveLandsecPortfolio(access.companyId))),
        waitingChecklistsForDeals([dealId]),
      ]);
      // The stage half as the feed now reads it, when the stage date was sent.
      const stage = settingStage ? dealClock(deal.status, (await stageSinceFor([dealId])).get(dealId), deal.stage_entered_at || deal.created_at) : undefined;
      res.json({ ok: true, clock: waitingClockFor(stored.get(dealId) || null, checklists.get(dealId) || null, dealId), checklistItemId: linked?.itemId ?? undefined, assigned, stage });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to save the deal clock" });
    }
  });

  // Sign (or withdraw a signature on) the agreed brief as the Landsec
  // leasing manager or the asset manager. The signature records who the
  // signed-in person is and when; it cannot be given on an empty brief.
  // Until the role logins exist (item 6) any Landsec or BGP login can sign
  // in either role — the name on the signature is the accountability.
  app.post("/api/landsec/unit/:id/brief/sign", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const unit = (await pool.query(`SELECT id, property_id FROM tenancy_schedule_units WHERE id = $1`, [id])).rows[0];
      if (!unit) return res.status(404).json({ error: "Unit not found" });
      const access = await unitAccess(req, unit.property_id);
      if (!access) return res.status(403).json({ error: "Unit is outside the Landsec schemes you can see" });
      const role = req.body?.role === "am" ? "am" : req.body?.role === "leasing" ? "leasing" : null;
      if (!role) return res.status(400).json({ error: "role must be 'leasing' or 'am'" });
      // A role login signs only as itself; BGP and legacy Landsec logins may sign either.
      if (access.role === "asset_manager" && role !== "am") return res.status(403).json({ error: "An asset manager login signs as the asset manager" });
      if (access.role === "leasing_manager" && role !== "leasing") return res.status(403).json({ error: "A leasing manager login signs as the leasing manager" });
      if (access.role === "joint_agent") return res.status(403).json({ error: "Joint agents do not sign the brief" });
      const withdraw = !!req.body?.withdraw;
      const userId = req.session?.userId || (req as any).tokenUserId;
      const user = userId ? (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0] : null;
      const by = user?.name || user?.email || "Unknown";
      const row = (await pool.query(`SELECT * FROM landsec_units WHERE tenancy_unit_id = $1`, [id])).rows[0];
      if (!row) return res.status(400).json({ error: "Write the brief before signing it" });
      if (!withdraw) {
        const content = row.brief_use || row.brief_category || row.brief_ner_floor || row.brief_incentive_ceiling || row.brief_capex_envelope || row.brief_target_brands;
        if (!content) return res.status(400).json({ error: "The brief is empty — set the use, category, rent floor, incentive ceiling or target brands first" });
      }
      const col = role === "am" ? "am" : "leasing";
      await pool.query(
        `UPDATE landsec_units SET
           brief_signed_${col}_by = $2, brief_signed_${col}_user_id = $3, brief_signed_${col}_at = $4, updated_at = NOW()
         WHERE tenancy_unit_id = $1`,
        [id, withdraw ? null : by, withdraw ? null : userId || null, withdraw ? null : new Date()]
      );
      const after = (await pool.query(`SELECT * FROM landsec_units WHERE tenancy_unit_id = $1`, [id])).rows[0];
      res.json({ ok: true, agreedBrief: agreedBriefOf(after) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to sign the brief" });
    }
  });
}
