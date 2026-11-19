// The deal page's reads (Woody, 2026-11-18: "need full time line of deal
// tracking from marketing to completion", "the tasks list for the deal?
// Responsibility"; docs/deal-page-review-2026-11-18.md, steps 3 to 5 and 7).
// One read for the page and one for its timeline, each keyed by the deal and
// writing nothing. They read the records the Letting Tracker's pieces read
// (the unit's offers, Heads of Terms, checklist, recommendation and brief)
// without the routes that write when opened (a checklist starts itself, an
// offer's negotiation writes its first round): those open only when a person
// asks, through the dialogs. The rules are shared/deal-page.ts.
//
// Who may read: whoever may open the deal (GET /api/crm/deals/:id): BGP
// staff, a client login on a deal in its scope, a scheme-limited login and a
// joint agent at their schemes. The letting's pieces are read only when the
// caller may also open the unit's brief (briefAccess), as on the tracker.
// BGP's AML working, invoicing and private tasks go to BGP staff only.
import type { Express, Request } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { isClientRequestUser, isDealInScope, resolveCompanyScope } from "./company-scope";
import { isJointAgentLogin, schemeLimitedPropertyIdsOrNone } from "./landsec-access";
import { briefAccess, type BriefAccess } from "./unit-brief-workspace";
import { briefStateOf, clockForDeal, clockWriterFor, nerFloorOf, schemeOfProperty, type ClockWriter } from "./landsec-unit";
import { resolveLandsecPortfolio } from "./landsec-schemes";
import { readOfferStatus } from "./unit-negotiation";
import { CLOSED_STATUSES, legacyToCode, statusSpellingsFor } from "@shared/deal-status";
import { ALL_LETTING_TYPES, DEFAULT_LETTING_TYPE, isLettingType } from "@shared/letting-rules";
import { STAGE_BULK_PEERS, londonDay, statusLineIsMoveSql } from "@shared/stage-since";
import { checklistStageFor, checklistSummary } from "@shared/deal-checklist";
import { landsecBriefCheck, landsecIncentivesRecorded, landsecNer } from "@shared/landsec";
import { calendarDateValue } from "@shared/calendar-date";
import {
  buildStageStrip, eventsForViewer, hotsStageOf, inLettingWindow, lettingWindow, sortEvents, stageLabel,
  type DealEvent, type DealLettingSummary, type DealOfferLine, type DealPageData, type DealPageNames, type DealPageViewer, type LettingWindow, type StageMove,
} from "@shared/deal-page";

// The three client-side roles on a brief who decide a recommendation (the
// same list as DECIDER_ROLES in server/unit-recommendation.ts).
const DECIDER_ROLES = ["client_leasing", "senior_asset_manager", "asset_manager"];
const DEAL_COLUMNS = `id, name, deal_ref, status, deal_type, team, property_id, tenancy_unit_id, unit_id, landlord_id, tenant_id, vendor_id, purchaser_id, created_at, stage_entered_at,
  instructed_at, exchanged_at, completed_at, invoiced_at, target_date, rent_pa, rent_free, capital_contribution, lease_length, break_option`;

const iso = (d: any): string | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
// A calendar day: from a stored yyyy-mm-dd, or from a timestamp column (a Date).
const day = (d: any): string | null => {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  return calendarDateValue(String(d).slice(0, 10));
};
const money = (n: any): string | null => (n != null && Number.isFinite(Number(n)) && Number(n) > 0 ? `£${Math.round(Number(n)).toLocaleString("en-GB")} pa` : null);
const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

interface DealContext {
  deal: any;
  viewer: DealPageViewer;
  userId: string;
  // The Letting Tracker row, when the deal has one and the caller may open its brief.
  unit: any | null;
  access: BriefAccess | null;
  current: boolean;
  window: LettingWindow;
}

// Whoever may open the deal, and as what. Mirrors GET /api/crm/deals/:id.
async function viewerFor(req: Request, deal: any): Promise<DealPageViewer | null> {
  const scope = await resolveCompanyScope(req);
  if (!scope) return (await isClientRequestUser(req)) ? null : "staff";
  if (!(await isDealInScope(scope, deal.id))) return null;
  const limited = await schemeLimitedPropertyIdsOrNone(req, "deal-page");
  if (limited && (!deal.property_id || !limited.includes(deal.property_id))) return null;
  return (await isJointAgentLogin(req)) ? "joint_agent" : "client";
}

// The deal's Letting Tracker row: the one that points at it, else (for a
// letting) the row on its unit, which a deal keeps after the unit is
// re-marketed and a new deal takes the row.
async function trackerUnitFor(deal: any): Promise<any | null> {
  const r = await pool.query(
    `SELECT a.id, a.unit_name, a.property_id, a.deal_id, a.tenancy_unit_id, a.marketing_status,
            a.hots_content, a.hots_version, a.hots_agreed_at, a.hots_issued_at, a.hots_issued_by_name, a.hots_final_at, a.hots_final_by_name,
            p.name AS property_name
       FROM available_units a
       LEFT JOIN crm_properties p ON p.id = a.property_id
      WHERE a.deal_id = $1 OR ($3::boolean AND $2::varchar IS NOT NULL AND a.tenancy_unit_id = $2)
      ORDER BY (a.deal_id = $1) DESC NULLS LAST, a.updated_at DESC NULLS LAST
      LIMIT 1`, [deal.id, deal.tenancy_unit_id || null, isLettingType(deal.deal_type)]);
  return r.rows[0] || null;
}

async function windowFor(deal: any, unit: any): Promise<LettingWindow> {
  const current = unit.deal_id === deal.id;
  const [replaced, earlier] = await Promise.all([
    !current && unit.deal_id ? pool.query(`SELECT created_at FROM crm_deals WHERE id = $1`, [unit.deal_id]) : Promise.resolve(null),
    unit.tenancy_unit_id && deal.created_at
      ? pool.query(`SELECT 1 FROM crm_deals WHERE id <> $1 AND tenancy_unit_id = $2 AND created_at < $3 AND deal_type = ANY($4::text[]) LIMIT 1`,
          [deal.id, unit.tenancy_unit_id, deal.created_at, ALL_LETTING_TYPES as string[]])
      : Promise.resolve(null),
  ]);
  const replacedAt = replaced?.rows[0]?.created_at || null;
  const later = replacedAt && deal.created_at && new Date(replacedAt).getTime() > new Date(deal.created_at).getTime();
  return lettingWindow({ dealCreatedAt: deal.created_at, earlierLetting: !!earlier?.rows.length, replacedAt: later ? replacedAt : null });
}

async function loadDealContext(req: Request, dealId: string): Promise<DealContext | { status: number; error: string }> {
  const userId = String(req.session?.userId || (req as any).tokenUserId || "");
  if (!userId) return { status: 401, error: "Sign in again" };
  const deal = (await pool.query(`SELECT ${DEAL_COLUMNS} FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
  if (!deal) return { status: 404, error: "Not found" };
  const viewer = await viewerFor(req, deal);
  if (!viewer) return { status: 403, error: "Access denied" };
  const found = await trackerUnitFor(deal);
  const access = found ? await briefAccess(req, found.property_id) : null;
  const unit = found && access ? found : null;
  return {
    deal, viewer, userId, unit, access: unit ? access : null,
    current: !!unit && unit.deal_id === deal.id,
    window: unit ? await windowFor(deal, unit) : { from: null, to: null },
  };
}

// The deal's status moves, oldest first, each marked unconfirmed when it
// shares its minute with the status changes of STAGE_BULK_PEERS or more other
// deals (an import or a bulk tidy-up), as days at stage reads them.
async function stageMoves(dealId: string): Promise<StageMove[]> {
  const r = await pool.query(
    `WITH mine AS (
       SELECT id, old_value, new_value, created_at, changed_by_name FROM deal_audit_log
        WHERE deal_id = $1 AND field = 'status' AND ${statusLineIsMoveSql()}
     ), minutes AS (
       SELECT date_trunc('minute', b.created_at) AS minute, COUNT(DISTINCT b.deal_id)::int AS deals
         FROM deal_audit_log b
        WHERE b.field = 'status' AND ${statusLineIsMoveSql("b")}
          AND date_trunc('minute', b.created_at) IN (SELECT date_trunc('minute', created_at) FROM mine)
        GROUP BY 1
     )
     SELECT m.*, GREATEST(COALESCE(n.deals, 1) - 1, 0) AS peers
       FROM mine m LEFT JOIN minutes n ON n.minute = date_trunc('minute', m.created_at)
      ORDER BY m.created_at`, [dealId]);
  const out: StageMove[] = [];
  for (const row of r.rows) {
    const to = legacyToCode(row.new_value);
    const at = iso(row.created_at);
    if (!to || !at) continue;
    out.push({ from: legacyToCode(row.old_value), to, at, byName: text(row.changed_by_name) || null, confirmed: Number(row.peers) < STAGE_BULK_PEERS });
  }
  return out;
}

// The other live deals this one may be said to depend on: the scheme's for a
// Landsec deal, else the same property's. Only for a caller who may set it.
async function otherDealsFor(deal: any, writer: ClockWriter | null): Promise<DealPageData["otherDeals"]> {
  if (!writer || !deal.property_id) return [];
  let propertyIds: string[] = [deal.property_id];
  if (writer.kind === "landsec") {
    const scheme = schemeOfProperty(await resolveLandsecPortfolio(writer.access.companyId), deal.property_id);
    if (scheme) propertyIds = scheme.properties.map(p => p.id);
  }
  const closed = statusSpellingsFor(CLOSED_STATUSES).map(s => s.toLowerCase());
  const r = await pool.query(
    `SELECT d.id, d.deal_ref, d.name, d.status, COALESCE(t.premises, t.unit_number) AS unit, tc.name AS tenant
       FROM crm_deals d
       LEFT JOIN tenancy_schedule_units t ON t.id = d.tenancy_unit_id
       LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
      WHERE d.property_id = ANY($1::text[]) AND d.id <> $2 AND d.status IS NOT NULL AND lower(btrim(d.status)) <> ALL($3::text[])
      ORDER BY d.updated_at DESC NULLS LAST LIMIT 80`, [propertyIds, deal.id, closed]);
  return r.rows
    .filter((d: any) => { const c = legacyToCode(d.status); return !!c && !CLOSED_STATUSES.includes(c); })
    .map((d: any) => ({ id: d.id, ref: d.deal_ref ?? null, name: text(d.tenant) || text(d.name), unit: d.unit || null }));
}

async function offersFor(ctx: DealContext): Promise<DealOfferLine[]> {
  const { unit, access } = ctx;
  const jointAgent = ctx.viewer === "joint_agent";
  const rows = (await pool.query(
    `SELECT o.id, o.company_name, o.contact_name, o.status, o.rent_pa, o.offer_date, o.agreed_at, o.created_at,
            (SELECT count(*)::int FROM unit_offer_rounds r WHERE r.offer_id = o.id) AS rounds,
            f.rent_pa AS first_rent, f.created_by_user_id AS first_by, l.rent_pa AS last_rent, l.round_date AS last_date, l.party AS last_party
       FROM unit_offers o
       LEFT JOIN LATERAL (SELECT rent_pa, created_by_user_id FROM unit_offer_rounds r WHERE r.offer_id = o.id ORDER BY r.round_no ASC, r.created_at ASC LIMIT 1) f ON true
       LEFT JOIN LATERAL (SELECT rent_pa, round_date, party FROM unit_offer_rounds r WHERE r.offer_id = o.id ORDER BY r.round_no DESC, r.created_at DESC LIMIT 1) l ON true
      WHERE o.unit_id = $1
      ORDER BY o.offer_date, o.created_at`, [unit.id])).rows;
  return rows.filter((r: any) => inLettingWindow(r.created_at || r.offer_date, ctx.window)).map((r: any) => {
    const status = readOfferStatus(r.status);
    const logged = r.rounds > 0;
    // A joint agent sees a contact's name only on an offer its own login logged.
    const own = !jointAgent || (!!r.first_by && r.first_by === access?.userId);
    return {
      offerId: r.id, companyName: r.company_name || (own ? r.contact_name : null) || null, status,
      rounds: logged ? r.rounds : 1,
      firstRentPa: logged ? r.first_rent ?? null : r.rent_pa ?? null,
      latestRentPa: logged ? r.last_rent ?? null : r.rent_pa ?? null,
      lastRoundDate: logged ? day(r.last_date) : day(r.offer_date),
      lastParty: logged && r.last_party === "landlord" ? "landlord" : "tenant",
      agreedAt: status === "Agreed" ? iso(r.agreed_at) : null,
    };
  });
}

async function lettingFor(ctx: DealContext): Promise<DealLettingSummary | null> {
  const { unit, deal } = ctx;
  if (!unit) return null;
  const today = londonDay();
  const scheduleRow = deal.tenancy_unit_id || unit.tenancy_unit_id || null;
  const [briefQ, recQ, viewingQ, offers, agreedQ] = await Promise.all([
    pool.query(
      `SELECT b.id, b.agreed_at, b.commercials,
              (SELECT COUNT(*)::int FROM unit_brief_people p WHERE p.brief_id = b.id) AS total,
              (SELECT COUNT(*)::int FROM unit_brief_people p WHERE p.brief_id = b.id AND p.agreed_at IS NOT NULL AND p.agreed_version = COALESCE(b.version, 1)) AS agreed
         FROM unit_briefs b WHERE b.unit_id = $1 ORDER BY b.created_at DESC LIMIT 1`, [unit.id]),
    pool.query(
      `SELECT r.id, r.recommendation, r.version, r.issued_at, r.decided_at,
              (SELECT COUNT(*)::int FROM unit_brief_people p WHERE p.brief_id = b.id AND p.role = ANY($3::text[])) AS total,
              (SELECT COUNT(*)::int FROM unit_brief_people p
                 JOIN unit_recommendation_decisions dd ON dd.recommendation_id = r.id AND dd.brief_person_id = p.id AND dd.version = r.version
                WHERE p.brief_id = b.id AND p.role = ANY($3::text[]) AND dd.decision = 'approved') AS approved,
              (SELECT COUNT(*)::int FROM unit_brief_people p
                 JOIN unit_recommendation_decisions dd ON dd.recommendation_id = r.id AND dd.brief_person_id = p.id AND dd.version = r.version
                WHERE p.brief_id = b.id AND p.role = ANY($3::text[]) AND dd.decision = 'declined') AS declined
         FROM unit_recommendations r
         LEFT JOIN LATERAL (SELECT id FROM unit_briefs ub WHERE ub.unit_id = r.unit_id ORDER BY ub.created_at DESC LIMIT 1) b ON TRUE
        WHERE r.unit_id = $1 AND r.deal_id = $2
        ORDER BY r.updated_at DESC NULLS LAST LIMIT 1`, [unit.id, deal.id, DECIDER_ROLES]),
    pool.query(
      `SELECT viewing_date, status FROM unit_viewings
        WHERE unit_id = $1 AND deleted_at IS NULL AND status IN ('scheduled', 'completed')`, [unit.id]),
    offersFor(ctx),
    // The older two-signature Agreed brief at a Landsec scheme, which still
    // carries a floor for the Net Effective Rent check.
    scheduleRow ? pool.query(`SELECT brief_ner_floor, brief_signed_leasing_at, brief_signed_am_at FROM landsec_units WHERE tenancy_unit_id = $1 LIMIT 1`, [scheduleRow]).catch(() => ({ rows: [] as any[] })) : Promise.resolve({ rows: [] as any[] }),
  ]);
  const viewings = viewingQ.rows.filter((v: any) => inLettingWindow(day(v.viewing_date), ctx.window));
  const dates = viewings.map((v: any) => day(v.viewing_date)).filter((d: string | null): d is string => !!d).sort();
  const past = dates.filter(d => d < today);
  const ahead = viewings.filter((v: any) => v.status === "scheduled" && (day(v.viewing_date) || "") >= today);
  const b = briefQ.rows[0];
  const rec = recQ.rows[0];
  const agreed = agreedQ.rows[0] || null;
  const ner = landsecNer({ headlinePa: deal.rent_pa, rentFreeMonths: deal.rent_free, capital: deal.capital_contribution, leaseLength: deal.lease_length, breakOption: deal.break_option });
  return {
    trackerId: unit.id,
    unitName: text(unit.unit_name) || "Unit",
    propertyId: unit.property_id || null,
    propertyName: text(unit.property_name) || null,
    current: ctx.current,
    marketingStatus: unit.marketing_status || null,
    brief: b ? { id: b.id, agreedAt: iso(b.agreed_at), signoff: { total: b.total || 0, agreed: b.agreed || 0 } } : null,
    // The deal's Net Effective Rent against the brief's floor, as the Deals
    // list and the unit page check it, and whether the unit's brief is agreed.
    briefCheck: landsecBriefCheck(ner?.nerPa, nerFloorOf(b?.commercials, agreed?.brief_ner_floor), landsecIncentivesRecorded(deal.rent_free, deal.capital_contribution)),
    briefState: briefStateOf(b ? { id: b.id, agreedAt: b.agreed_at } : null,
      agreed ? { signedLeasingAt: agreed.brief_signed_leasing_at, signedAmAt: agreed.brief_signed_am_at, drafted: agreed.brief_ner_floor != null } : null),
    currentDealId: unit.deal_id || null,
    // The Heads of Terms state is cleared when the unit is re-marketed
    // (server/letting-cycle.ts): only the unit's current deal has one.
    hots: ctx.current ? {
      stage: hotsStageOf({ hotsContent: unit.hots_content, agreedAt: unit.hots_agreed_at, issuedAt: unit.hots_issued_at, finalAt: unit.hots_final_at }),
      version: Number(unit.hots_version) || 0,
      agreedAt: iso(unit.hots_agreed_at), issuedAt: iso(unit.hots_issued_at), issuedByName: unit.hots_issued_by_name || null,
      finalAt: iso(unit.hots_final_at), finalByName: unit.hots_final_by_name || null,
    } : null,
    recommendation: rec ? {
      id: rec.id, recommendation: rec.recommendation || null, version: Number(rec.version) || 1, issuedAt: iso(rec.issued_at), decidedAt: iso(rec.decided_at),
      total: rec.total || 0, approved: rec.approved || 0, declined: rec.declined || 0,
    } : null,
    offers,
    viewings: {
      total: viewings.length,
      completed: viewings.filter((v: any) => v.status === "completed" || (day(v.viewing_date) || "") < today).length,
      upcoming: ahead.length,
      last: past.length ? past[past.length - 1] : null,
      next: ahead.map((v: any) => day(v.viewing_date)).filter(Boolean).sort()[0] || null,
    },
  };
}

// The deal's own checklist (one per letting: the unit and this deal), read as
// it stands. Opening the checklist dialog is what starts one.
async function checklistFor(ctx: DealContext): Promise<DealPageData["checklist"]> {
  if (!ctx.unit) return null;
  const c = (await pool.query(
    `SELECT id, responsible_name, responsible_side FROM deal_checklists WHERE deal_id = $1 AND unit_id = $2 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    [ctx.deal.id, ctx.unit.id])).rows[0];
  if (!c) return null;
  const items = (await pool.query(
    `SELECT id, stage, label, required, done_at, done_by_name, due_date, assignee_name, assignee_side
       FROM deal_checklist_items WHERE checklist_id = $1 ORDER BY sort_order, created_at, id`, [c.id])).rows;
  const today = londonDay();
  const stage = checklistStageFor(legacyToCode(ctx.deal.status) || "AVA");
  return {
    id: c.id, responsibleName: c.responsible_name || null, responsibleSide: c.responsible_side || null, stage,
    summary: checklistSummary(items.map((i: any) => ({ stage: i.stage, required: !!i.required, doneAt: i.done_at, dueDate: i.due_date, assignee: i.assignee_name })), stage, today, !!c.responsible_name),
    items: items.map((i: any) => ({
      id: i.id, stage: i.stage, label: i.label, required: !!i.required, done: !!i.done_at, doneAt: iso(i.done_at), doneByName: i.done_by_name || null,
      dueDate: i.due_date || null, assigneeName: i.assignee_name || null, assigneeSide: i.assignee_side || null,
      overdue: !i.done_at && !!i.due_date && String(i.due_date).slice(0, 10) < today,
    })),
  };
}

// Tasks linked to the deal, other than the checklist's own (the checklist
// shows those). BGP staff read every one; any other login only its own.
async function tasksFor(ctx: DealContext): Promise<DealPageData["tasks"]> {
  const staff = ctx.viewer === "staff";
  const r = await pool.query(
    `SELECT t.id, t.title, t.status, t.due_date, t.user_id, t.assigned_by_name, u.name AS assignee
       FROM user_tasks t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.linked_deal_id = $1 AND COALESCE(t.source, '') <> 'deal_checklist' AND ($2::boolean OR t.user_id = $3)
      ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.created_at DESC
      LIMIT 100`, [ctx.deal.id, staff, ctx.userId]);
  return r.rows.map((t: any) => ({
    id: t.id, title: text(t.title), assignee: text(t.assignee) || null, assignedBy: text(t.assigned_by_name) || null,
    dueDate: day(t.due_date), status: t.status || "todo", done: t.status === "done", mine: t.user_id === ctx.userId,
  }));
}

const addressText = (a: any): string | null => {
  if (!a) return null;
  if (typeof a === "string") return text(a) || null;
  return text(a.formatted || a.line1 || a.address || a.text) || null;
};

async function namesFor(ctx: DealContext): Promise<DealPageNames> {
  const { deal, viewer } = ctx;
  const staff = viewer === "staff";
  const partyIds = { landlord: deal.landlord_id, tenant: deal.tenant_id, vendor: deal.vendor_id, purchaser: deal.purchaser_id } as const;
  const ids = Array.from(new Set(Object.values(partyIds).filter(Boolean))) as string[];
  const [prop, companies, unit] = await Promise.all([
    deal.property_id ? pool.query(`SELECT id, name, address, postcode, status, folder_teams, sharepoint_folder_url FROM crm_properties WHERE id = $1`, [deal.property_id]) : Promise.resolve({ rows: [] as any[] }),
    ids.length ? pool.query(`SELECT id, name, domain, website FROM crm_companies WHERE id = ANY($1::text[])`, [ids]) : Promise.resolve({ rows: [] as any[] }),
    staff && deal.unit_id ? pool.query(`SELECT id, unit_name, property_id, unit_address, unit_postcode, unit_uprn, unit_address_free_text FROM property_units WHERE id = $1`, [deal.unit_id]) : Promise.resolve({ rows: [] as any[] }),
  ]);
  const p = prop.rows[0];
  const byId = new Map<string, any>(companies.rows.map((c: any) => [c.id, c]));
  const parties: DealPageNames["parties"] = {};
  for (const [role, id] of Object.entries(partyIds) as [keyof typeof partyIds, string | null][]) {
    const c = id ? byId.get(id) : null;
    if (c) parties[role] = { id: viewer === "joint_agent" ? null : c.id, name: text(c.name), domain: text(c.domain) || text(c.website) || null };
  }
  const u = unit.rows[0];
  return {
    property: p ? {
      id: p.id, name: text(p.name), address: addressText(p.address), postcode: text(p.postcode) || null, status: text(p.status) || null,
      folderTeams: staff && Array.isArray(p.folder_teams) ? p.folder_teams : null, sharepointFolderUrl: staff ? p.sharepoint_folder_url || null : null,
    } : null,
    parties,
    unit: u ? {
      id: u.id, unitName: text(u.unit_name), propertyId: u.property_id || null, unitAddress: u.unit_address || null, unitPostcode: u.unit_postcode || null,
      unitUprn: u.unit_uprn || null, unitAddressFreeText: u.unit_address_free_text || null,
    } : null,
  };
}

export async function buildDealPage(req: Request, ctx: DealContext): Promise<DealPageData> {
  const { deal } = ctx;
  const code = legacyToCode(deal.status);
  const live = !!code && !CLOSED_STATUSES.includes(code);
  const letting = isLettingType(deal.deal_type) || !!ctx.unit;
  // A deal on the Letting Tracker is a letting whatever it is typed: its
  // stages read as a letting's (Marketing, not Available).
  const stageType = letting && !isLettingType(deal.deal_type) ? DEFAULT_LETTING_TYPE : deal.deal_type;
  const writer = await clockWriterFor(req, deal);
  const visible = writer ? writer.visible : new Set<string>([deal.property_id].filter(Boolean));
  const [names, clock, moves, otherDeals, lettingSummary, checklist, tasks] = await Promise.all([
    namesFor(ctx),
    clockForDeal(deal, { letting, visible }),
    stageMoves(deal.id),
    live && letting ? otherDealsFor(deal, writer) : Promise.resolve([]),
    lettingFor(ctx),
    checklistFor(ctx),
    tasksFor(ctx),
  ]);
  const since = iso(clock.since);
  const ner = landsecNer({ headlinePa: deal.rent_pa, rentFreeMonths: deal.rent_free, capital: deal.capital_contribution, leaseLength: deal.lease_length, breakOption: deal.break_option });
  return {
    names,
    viewer: { kind: ctx.viewer, canSetWaiting: !!writer && live && letting, canSetStage: !!writer && live, landsec: writer?.kind === "landsec" },
    stage: { code, label: code ? stageLabel(code, stageType) : null, since, days: clock.days, confirmed: !!clock.stageConfirmed, set: clock.stageSet || null },
    strip: buildStageStrip({
      status: deal.status, dealType: stageType, team: deal.team, moves, since, sinceConfirmed: !!clock.stageConfirmed,
      dates: { instructedAt: deal.instructed_at, exchangedAt: deal.exchanged_at, completedAt: deal.completed_at, invoicedAt: ctx.viewer === "staff" ? deal.invoiced_at : null, targetDate: deal.target_date },
    }),
    clock: clock.clock, waitingDays: clock.waitingDays, otherDeals,
    ner, incentivesRecorded: landsecIncentivesRecorded(deal.rent_free, deal.capital_contribution),
    letting: lettingSummary, checklist, tasks,
  };
}

const HOTS_EVENT_TITLES: Record<string, string> = {
  generated: "Heads of Terms drafted",
  amended: "Heads of Terms amended",
  agreed: "Heads of Terms agreed",
  withdrawn: "Agreement to the Heads of Terms withdrawn",
  issued: "Heads of Terms issued",
  reopened: "Heads of Terms reopened for amendments",
  final_uploaded: "Final agreed Heads of Terms filed",
  final_removed: "Final agreed Heads of Terms removed",
  converted: "Moved to Solicitors from the Heads of Terms",
  offer_changed: "Heads of Terms reset: the agreed offer changed",
};
const AML_LINE_TITLES: Record<string, string> = {
  aml_sign_off: "AML signed off by BGP",
  kyc4u_result: "KYC4U result added",
  kycApproved: "KYC approval changed",
  amlCheckCompleted: "AML check changed",
};

export async function buildDealTimeline(ctx: DealContext): Promise<DealEvent[]> {
  const { deal, unit, viewer } = ctx;
  const staff = viewer === "staff";
  const events: DealEvent[] = [];
  const push = (e: Omit<DealEvent, "confirmed" | "detail" | "by" | "open"> & Partial<Pick<DealEvent, "confirmed" | "detail" | "by" | "open">>) => {
    if (!e.at) return;
    events.push({ confirmed: true, detail: null, by: null, open: null, ...e });
  };
  const at = (d: any) => iso(d) || "";
  const none = () => ({ rows: [] as any[] });
  const unitId = unit?.id || null;
  const [moves, viewings, rounds, unseeded, hots, brief, rec, ticks, aml, tokens, drafts, invoices] = await Promise.all([
    stageMoves(deal.id),
    unitId ? pool.query(
      `SELECT v.id, COALESCE(co.name, v.company_name) AS company, v.viewing_date, v.viewing_time, v.status, v.outcome
         FROM unit_viewings v LEFT JOIN crm_companies co ON co.id = v.company_id
        WHERE v.unit_id = $1 AND v.deleted_at IS NULL AND v.status IN ('scheduled', 'completed')`, [unitId]) : none(),
    unitId ? pool.query(
      `SELECT r.id, r.offer_id, r.round_no, r.party, r.round_date, r.rent_pa, r.created_at, r.created_by_name,
              o.company_name, o.contact_name, o.created_at AS offer_created_at, f.created_by_user_id AS first_by
         FROM unit_offer_rounds r JOIN unit_offers o ON o.id = r.offer_id
         LEFT JOIN LATERAL (SELECT created_by_user_id FROM unit_offer_rounds x WHERE x.offer_id = o.id ORDER BY x.round_no ASC, x.created_at ASC LIMIT 1) f ON true
        WHERE o.unit_id = $1 ORDER BY r.round_no`, [unitId]) : none(),
    unitId ? pool.query(
      `SELECT o.id, o.company_name, o.offer_date, o.rent_pa, o.status, o.agreed_at, o.agreed_by_name, o.created_at,
              EXISTS (SELECT 1 FROM unit_offer_rounds r WHERE r.offer_id = o.id) AS seeded
         FROM unit_offers o WHERE o.unit_id = $1`, [unitId]) : none(),
    unitId ? pool.query(`SELECT id, kind, body, version, author_name, created_at FROM unit_hots_events WHERE unit_id = $1 ORDER BY created_at`, [unitId]) : none(),
    unitId ? pool.query(`SELECT id, agreed_at FROM unit_briefs WHERE unit_id = $1 AND agreed_at IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [unitId]) : none(),
    unitId ? pool.query(`SELECT id, issued_at, issued_by_name, decided_at FROM unit_recommendations WHERE unit_id = $1 AND deal_id = $2`, [unitId, deal.id]) : none(),
    unitId ? pool.query(
      `SELECT i.id, i.label, i.done_at, i.done_by_name FROM deal_checklist_items i JOIN deal_checklists c ON c.id = i.checklist_id
        WHERE c.deal_id = $1 AND c.unit_id = $2 AND i.done_at IS NOT NULL`, [deal.id, unitId]) : none(),
    staff ? pool.query(
      `SELECT id, field, old_value, new_value, reason, changed_by_name, created_at FROM deal_audit_log
        WHERE deal_id = $1 AND field = ANY($2::text[]) ORDER BY created_at`, [deal.id, Object.keys(AML_LINE_TITLES)]) : none(),
    staff ? pool.query(
      `SELECT contact_name, contact_email, created_at, completed_at, revoked_at FROM kyc_upload_tokens
        WHERE deal_id = $1 AND COALESCE(is_test, false) = false ORDER BY created_at`, [deal.id]).catch(none) : none(),
    staff ? pool.query(`SELECT id, role, created_at, status FROM kyc4u_drafts WHERE deal_id = $1`, [deal.id]).catch(none) : none(),
    staff ? pool.query(`SELECT id, invoice_number, status, created_at FROM xero_invoices WHERE deal_id = $1`, [deal.id]).catch(none) : none(),
  ]);
  const w = ctx.window;
  const jointAgent = viewer === "joint_agent";

  push({ id: `created:${deal.id}`, at: at(deal.created_at), kind: "created", title: "Deal added", detail: deal.deal_type || null });
  push({ id: `instructed:${deal.id}`, at: at(deal.instructed_at), kind: "instructed", title: "Instructed" });
  for (const m of moves) {
    push({
      id: `stage:${m.at}:${m.to}`, at: m.at, kind: "stage", title: `Moved to ${stageLabel(m.to, deal.deal_type)}`,
      detail: m.from && m.from !== m.to ? `From ${stageLabel(m.from, deal.deal_type)}` : null, by: m.byName, confirmed: m.confirmed,
    });
  }
  for (const b of brief.rows) {
    if (inLettingWindow(b.agreed_at, w)) push({ id: `brief:${b.id}`, at: at(b.agreed_at), kind: "brief", title: "Targeting Brief agreed by everyone on it", open: { to: "brief" } });
  }
  for (const v of viewings.rows) {
    const d = day(v.viewing_date);
    if (!d || !inLettingWindow(d, w)) continue;
    // A viewing, an offer's position and a date typed on the deal carry a day
    // and no time: they are placed at midday.
    push({
      id: `viewing:${v.id}`, at: `${d}T12:00:00.000Z`,
      kind: "viewing", title: `Viewing: ${text(v.company) || "a viewing"}`,
      detail: [/^\d{2}:\d{2}/.test(String(v.viewing_time || "")) ? String(v.viewing_time).slice(0, 5) : null, v.status === "scheduled" ? "Booked" : null, text(v.outcome) || null].filter(Boolean).join(" · ") || null,
      open: { to: "section", section: "negotiation" },
    });
  }
  // Each position on each offer: the tenant's first offer, a revised offer, our counter.
  const company = (r: any) => {
    const own = !jointAgent || (!!r.first_by && r.first_by === ctx.access?.userId);
    return text(r.company_name) || (own ? text(r.contact_name) : "") || "the applicant";
  };
  for (const r of rounds.rows) {
    if (!inLettingWindow(r.offer_created_at, w)) continue;
    const who = company(r);
    const title = r.party === "landlord" ? `Counter to ${who}` : r.round_no <= 1 ? `Offer from ${who}` : `Revised offer from ${who}`;
    const when = day(r.round_date) ? `${day(r.round_date)}T12:00:00.000Z` : at(r.created_at);
    push({ id: `round:${r.id}`, at: when, kind: r.round_no <= 1 && r.party !== "landlord" ? "offer" : "round", title, detail: money(r.rent_pa), by: text(r.created_by_name) || null, open: { to: "offer", offerId: r.offer_id } });
  }
  for (const o of unseeded.rows) {
    if (!inLettingWindow(o.created_at, w)) continue;
    const who = text(o.company_name) || "the applicant";
    if (!o.seeded) {
      const when = day(o.offer_date) ? `${day(o.offer_date)}T12:00:00.000Z` : at(o.created_at);
      push({ id: `offer:${o.id}`, at: when, kind: "offer", title: `Offer from ${who}`, detail: money(o.rent_pa), open: { to: "offer", offerId: o.id } });
    }
    if (o.agreed_at && readOfferStatus(o.status) === "Agreed") {
      push({ id: `agreed:${o.id}`, at: at(o.agreed_at), kind: "offer_status", title: `Terms agreed with ${who}`, by: text(o.agreed_by_name) || null, open: { to: "offer", offerId: o.id } });
    }
  }
  for (const h of hots.rows) {
    const title = HOTS_EVENT_TITLES[h.kind];
    if (!title || !inLettingWindow(h.created_at, w)) continue;
    push({ id: `hots:${h.id}`, at: at(h.created_at), kind: "hots", title, detail: text(h.body) || null, by: text(h.author_name) || null, open: { to: "hots" } });
  }
  for (const r of rec.rows) {
    push({ id: `rec-issued:${r.id}`, at: at(r.issued_at), kind: "recommendation", title: "Approval pack issued", by: text(r.issued_by_name) || null, open: { to: "recommendation" } });
    push({ id: `rec-decided:${r.id}`, at: at(r.decided_at), kind: "recommendation", title: "Approval pack approved by the client", open: { to: "recommendation" } });
  }
  for (const t of ticks.rows) {
    push({ id: `checklist:${t.id}`, at: at(t.done_at), kind: "checklist", title: `Done: ${text(t.label)}`, by: text(t.done_by_name) || null, open: { to: "checklist" } });
  }
  for (const a of aml.rows) {
    push({
      id: `aml:${a.id}`, at: at(a.created_at), kind: "aml", title: AML_LINE_TITLES[a.field] || "AML",
      detail: [a.field === "kyc4u_result" ? text(a.new_value) : null, a.field === "kycApproved" || a.field === "amlCheckCompleted" ? `${text(a.old_value) || "empty"} → ${text(a.new_value) || "empty"}` : null, text(a.reason) || null].filter(Boolean).join(" · ") || null,
      by: text(a.changed_by_name) || null, open: { to: "section", section: "parties" },
    });
  }
  // The request's token is the client's key to its page: never sent, not even as an id.
  tokens.rows.forEach((t: any, n: number) => {
    const who = text(t.contact_name) || text(t.contact_email) || "the client";
    push({ id: `kyc-sent:${n}`, at: at(t.created_at), kind: "aml", title: `Client checks sent to ${who}`, detail: t.revoked_at ? "Cancelled" : null, open: { to: "section", section: "parties" } });
    push({ id: `kyc-done:${n}`, at: at(t.completed_at), kind: "aml", title: `Client checks finished by ${who}`, open: { to: "section", section: "parties" } });
  });
  for (const d of drafts.rows) {
    push({ id: `kyc4u:${d.id}`, at: at(d.created_at), kind: "aml", title: "KYC4U check requested", detail: d.role ? `For the ${text(d.role)}` : null, open: { to: "section", section: "parties" } });
  }
  push({ id: `exchanged:${deal.id}`, at: at(deal.exchanged_at), kind: "exchanged", title: "Exchanged" });
  push({ id: `completed:${deal.id}`, at: at(deal.completed_at), kind: "completed", title: "Completed" });
  if (staff) push({ id: `invoiced:${deal.id}`, at: at(deal.invoiced_at), kind: "invoiced", title: "Invoiced", open: { to: "section", section: "fees" } });
  for (const i of invoices.rows) {
    push({ id: `invoice:${i.id}`, at: at(i.created_at), kind: "invoice", title: `Invoice${i.invoice_number ? ` ${text(i.invoice_number)}` : ""} raised in Xero`, detail: text(i.status) || null, open: { to: "section", section: "fees" } });
  }
  return sortEvents(eventsForViewer(events, viewer));
}

export function setupDealPageRoutes(app: Express) {
  app.get("/api/crm/deals/:id/page", requireAuth, async (req, res) => {
    try {
      const ctx = await loadDealContext(req, String(req.params.id));
      if ("error" in ctx) return res.status(ctx.status).json({ error: ctx.error });
      res.json(await buildDealPage(req, ctx));
    } catch (e: any) {
      console.error("[deal-page]", e?.message);
      res.status(500).json({ error: "The deal page could not be read" });
    }
  });

  app.get("/api/crm/deals/:id/timeline", requireAuth, async (req, res) => {
    try {
      const ctx = await loadDealContext(req, String(req.params.id));
      if ("error" in ctx) return res.status(ctx.status).json({ error: ctx.error });
      res.json({ events: await buildDealTimeline(ctx), letting: ctx.unit ? { trackerId: ctx.unit.id, current: ctx.current } : null });
    } catch (e: any) {
      console.error("[deal-timeline]", e?.message);
      res.status(500).json({ error: "The deal's timeline could not be read" });
    }
  });
}
