// Brand CRM: the diary (docs/brand-crm-spec-2026-11-12.md, 2.2 to 2.4, with
// Woody's decision 4). One dated list across brands: CRM actions, booked
// viewings and viewing follow-ups, deals waiting on someone (the Landsec deal
// clock), briefs awaiting a signature and brand cases awaiting a reply.
// Nothing here writes: an action is ticked off, and a request is added,
// through the CRM plan's own routes (server/crm-engagement.ts).
//
// Two front doors, as for the plan (server/brand-scheme-plan.ts). BGP staff
// use /api/brand-crm/diary and see everything. Every Landsec login, and
// staff viewing as Landsec, uses /api/landsec/diary, which is always a
// client's view:
// - a full Landsec login or leasing manager: the 14 schemes, brands in its
//   list only, the actions its own company raised and the ones BGP chose to
//   show it (title, due date, owner, status and place; never the notes or
//   who BGP marked it as waiting on);
// - an asset manager: exactly the same as a full Landsec login (Woody,
//   2026-11-13), whatever schemes are stored on the login;
// - a joint agent: deals waiting, viewings and shared actions on their own
//   schemes. No briefs, no brand cases, no brand ids and no contact names.
// Everything is cut here, before it is sent.
import type { Express, Request } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { clientBrandSliceSql, getCompanyIdForClientTeam } from "./company-scope";
import { resolveLandsecPortfolio, landsecCompanyId } from "./landsec-schemes";
import { clientPlanView, getCrmEngagementData, type ClientShare } from "./crm-engagement";
import { landsecPlanViewer, planSchemes, staffDoor, type PlanScheme, type PlanViewer, type Queryable } from "./brand-scheme-plan";
import { legacyToCode, CLOSED_STATUSES } from "@shared/deal-status";
import { briefStatus } from "@shared/landsec";
import { daysSince } from "@shared/brand-stage";
import { crmEngagementLink } from "@shared/landlord-engagement-view";
import type { EngagementAction, EngagementData } from "@shared/crm-engagement";
import { addDiaryDays, diaryCounts, diaryDay, londonDayOf, type DiaryData, type DiaryItem, type DiarySide } from "@shared/brand-diary";

export interface DiaryViewer extends PlanViewer { userId: string | null }
export interface DiaryOptions {
  now?: Date;
  brandSliceSql?: string | null;                                        // a client viewer's brand list, written against crm_companies
  companyIdForClientTeam?: (team: string) => Promise<string | null>;    // whose client company a login's team is
  engagement?: (viewerId: string | null) => Promise<EngagementData>;    // every brand action, as BGP staff see them
}

// A viewing follow-up older than this with nothing recorded against it is
// left to the Viewings board, not carried in the diary for ever.
const FOLLOW_UP_LOOK_BACK_DAYS = 30;
const iso = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const uniq = <T,>(list: T[]) => Array.from(new Set(list));
const sideOf = (party: string): DiarySide => /^landsec/i.test(party) ? "landsec" : /^bgp$/i.test(party) ? "bgp" : /^joint agent$/i.test(party) ? "joint_agent" : "other";
const CLIENT_BRIEF_ROLES = ["client_leasing", "senior_asset_manager", "asset_manager"];

/** The diary for one viewer, already cut to what that viewer may see. */
export async function loadDiary(q: Queryable, viewer: DiaryViewer, schemes: PlanScheme[], options: DiaryOptions = {}): Promise<DiaryData> {
  const now = options.now || new Date();
  const today = londonDayOf(now)!;
  const staff = viewer.kind === "staff";
  const jointAgent = viewer.kind === "joint_agent";
  const restricted = jointAgent;
  const warnings: string[] = [];
  const guarded = async <T,>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await run(); }
    catch (e: any) {
      warnings.push(`${label} could not be read and are left out of the diary.`);
      console.warn(`[brand-diary] ${label}: ${e?.message}`);
      return fallback;
    }
  };

  // A client viewer reads its own schemes and nothing else, whatever is stored.
  const visibleSchemes = staff ? schemes : schemes.filter(s => !viewer.schemes || viewer.schemes.has(s.key));
  const schemeOfProperty = new Map<string, PlanScheme>();
  for (const s of visibleSchemes) for (const id of s.propertyIds) schemeOfProperty.set(id, s);
  const propertyIds = staff ? null : uniq(visibleSchemes.flatMap(s => s.propertyIds));
  const schemeFor = (propertyId: string | null | undefined, propertyName?: string | null): DiaryItem["scheme"] => {
    const scheme = propertyId ? schemeOfProperty.get(propertyId) : null;
    if (scheme) return { key: scheme.key, name: scheme.name };
    return staff && propertyName ? { key: null, name: propertyName } : null;
  };
  const placed = (propertyId: string | null | undefined) => staff || (!!propertyId && schemeOfProperty.has(propertyId));
  // Where a client login opens a unit: the Landsec unit page, else the scheme.
  const clientPlaceUrl = (propertyId: string | null | undefined, tenancyUnitId: string | null | undefined): string | null => {
    const scheme = propertyId ? schemeOfProperty.get(propertyId) : null;
    if (!scheme) return null;
    return tenancyUnitId ? `/landsec/unit/${tenancyUnitId}` : `/landsec/scheme/${scheme.key}`;
  };
  const trackerUrl = (propertyId: string, trackerId: string) => `/available?propertyId=${encodeURIComponent(propertyId)}&unitId=${encodeURIComponent(trackerId)}`;

  const followUpFrom = addDiaryDays(today, -FOLLOW_UP_LOOK_BACK_DAYS);
  const loadEngagement = options.engagement || ((viewerId: string | null) => getCrmEngagementData(undefined, { pool: q, viewerId: viewerId || undefined }, "brand"));
  const [engagement, viewingRows, clockRows, agreedBriefRows, targetingBriefRows, caseRows] = await Promise.all([
    guarded<EngagementData | null>("CRM actions", () => loadEngagement(viewer.userId), null),
    // Both date columns are free text: only rows that start with a date are read, and each is checked again below.
    guarded("Viewings", async () => (await q.query(
      `/* brand-diary:viewings */ SELECT v.id, v.company_id, COALESCE(c.name, v.company_name) AS brand_name, v.viewing_date, v.status, v.follow_up_date, v.next_action,
              ou.name AS owner_name, au.id AS tracker_id, au.property_id, p.name AS property_name, ts.id AS tenancy_unit_id,
              COALESCE(NULLIF(trim(ts.premises), ''), ts.unit_number, au.unit_name) AS unit_label, ft.status AS task_status
         FROM unit_viewings v
         JOIN available_units au ON au.id = v.unit_id
         LEFT JOIN crm_companies c ON c.id = v.company_id
         LEFT JOIN users ou ON ou.id = v.owner_user_id
         LEFT JOIN (SELECT DISTINCT ON (letting_tracker_unit_id) letting_tracker_unit_id AS k, id FROM tenancy_schedule_units
                     WHERE letting_tracker_unit_id IS NOT NULL ORDER BY letting_tracker_unit_id, id) lt ON lt.k = au.id AND au.tenancy_unit_id IS NULL
         LEFT JOIN tenancy_schedule_units ts ON ts.id = COALESCE(au.tenancy_unit_id, lt.id)
         LEFT JOIN crm_properties p ON p.id = au.property_id
         LEFT JOIN LATERAL (SELECT t.status FROM user_tasks t WHERE t.source_ref = 'viewing_followup:' || v.id ORDER BY (t.status = 'done') ASC LIMIT 1) ft ON TRUE
        WHERE v.deleted_at IS NULL AND COALESCE(v.status, '') NOT IN ('cancelled', 'not_leasing')
          AND ($1::text[] IS NULL OR au.property_id = ANY($1))
          AND ((lower(v.status) = 'scheduled' AND v.viewing_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND left(v.viewing_date, 10) >= $2)
            OR (v.follow_up_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND left(v.follow_up_date, 10) >= $3))`, [propertyIds, today, followUpFrom])).rows, [] as any[]),
    guarded("Deals waiting on someone", async () => (await q.query(
      `/* brand-diary:deal-clocks */ SELECT k.deal_id, k.waiting_on_party, k.waiting_on_name, ${iso("k.waiting_since")} AS waiting_since, d.status, d.tenant_id,
              c.name AS brand_name, d.property_id, p.name AS property_name, ts.id AS tenancy_unit_id,
              COALESCE(NULLIF(trim(ts.premises), ''), ts.unit_number) AS unit_label,
              COALESCE((SELECT u.name FROM users u WHERE u.id = (d.internal_agent_ids)[1]), (d.internal_agent)[1]) AS owner_name
         FROM landsec_deal_clock k
         JOIN crm_deals d ON d.id = k.deal_id
         LEFT JOIN crm_companies c ON c.id = d.tenant_id
         LEFT JOIN crm_properties p ON p.id = d.property_id
         LEFT JOIN tenancy_schedule_units ts ON ts.id = COALESCE(d.tenancy_unit_id, (SELECT au.tenancy_unit_id FROM available_units au WHERE au.deal_id = d.id ORDER BY au.updated_at DESC NULLS LAST LIMIT 1))
        WHERE k.waiting_on_party IS NOT NULL AND ($1::text[] IS NULL OR d.property_id = ANY($1))`, [propertyIds])).rows, [] as any[]),
    // Briefs and brand cases are never a joint agent's.
    jointAgent ? [] : guarded("Agreed briefs", async () => (await q.query(
      `/* brand-diary:agreed-briefs */ SELECT lu.tenancy_unit_id, lu.property_id, p.name AS property_name, COALESCE(NULLIF(trim(ts.premises), ''), ts.unit_number) AS unit_label,
              lu.brief_use, lu.brief_category, lu.brief_ner_floor, lu.brief_incentive_ceiling, lu.brief_capex_envelope, lu.brief_target_brands,
              lu.brief_signed_leasing_at, lu.brief_signed_am_at, ${iso("lu.brief_updated_at")} AS since
         FROM landsec_units lu
         LEFT JOIN tenancy_schedule_units ts ON ts.id = lu.tenancy_unit_id
         LEFT JOIN crm_properties p ON p.id = lu.property_id
        WHERE (lu.brief_signed_leasing_at IS NULL OR lu.brief_signed_am_at IS NULL) AND ($1::text[] IS NULL OR lu.property_id = ANY($1))`, [propertyIds])).rows, [] as any[]),
    jointAgent ? [] : guarded("Targeting Briefs", async () => (await q.query(
      `/* brand-diary:targeting-briefs */ SELECT b.id, b.property_id, p.name AS property_name, au.id AS tracker_id, ts.id AS tenancy_unit_id,
              COALESCE(NULLIF(trim(ts.premises), ''), ts.unit_number, au.unit_name) AS unit_label, ${iso("COALESCE(b.terms_updated_at, b.created_at)")} AS since,
              w.names AS waiting_names, w.roles AS waiting_roles
         FROM unit_briefs b
         JOIN available_units au ON au.id = b.unit_id
         LEFT JOIN tenancy_schedule_units ts ON ts.id = au.tenancy_unit_id
         LEFT JOIN crm_properties p ON p.id = b.property_id
         JOIN LATERAL (SELECT array_agg(pp.name ORDER BY pp.sort_order, pp.created_at) AS names, array_agg(DISTINCT pp.role) AS roles
                         FROM unit_brief_people pp
                        WHERE pp.brief_id = b.id AND NOT (pp.agreed_at IS NOT NULL AND pp.agreed_version IS NOT DISTINCT FROM COALESCE(b.version, 1))) w ON w.names IS NOT NULL
        WHERE b.agreed_at IS NULL AND COALESCE(b.status, 'Active') = 'Active' AND ($1::text[] IS NULL OR b.property_id = ANY($1))`, [propertyIds])).rows, [] as any[]),
    jointAgent ? [] : guarded("Brand cases", async () => (await q.query(
      `/* brand-diary:cases */ SELECT bc.id, bc.company_id, c.name AS brand_name, ${iso("bc.sent_at")} AS sent_at
         FROM landsec_brand_cases bc JOIN crm_companies c ON c.id = bc.company_id WHERE bc.status = 'sent'`)).rows, [] as any[]),
  ]);

  // ── CRM actions ────────────────────────────────────────────────────────
  // BGP staff get every brand action. A client login gets what the brand
  // page already gives it (clientPlanView): its own company's requests and
  // the actions BGP shared with it, stripped the same way.
  const placeOfAction = new Map<string, string | null>((engagement?.actions || []).map(a => [a.id, a.propertyId || null]));
  const ownIds = new Set<string>();
  let actions: EngagementAction[] = [];
  if (engagement && staff) actions = engagement.actions;
  else if (engagement && viewer.clientCompanyId) {
    const scope = viewer.clientCompanyId;
    // A joint agent gets shared actions at their own schemes only.
    if (!restricted && engagement.actions.length) {
      const authors = await guarded("Who raised each CRM action", async () => (await q.query(
        `/* brand-diary:action-authors */ SELECT t.id, t.assigned_by_user_id, u.team, u.role FROM crm_engagement_actions a JOIN user_tasks t ON t.id = a.task_id
           LEFT JOIN users u ON u.id = t.assigned_by_user_id WHERE a.task_id = ANY($1)`, [engagement.actions.map(a => a.id)])).rows, [] as any[]);
      const teamCompany = new Map<string, string | null>();
      for (const row of authors) {
        // Only a client login's action is a client request (staff viewing as Landsec raise BGP actions).
        if (String(row.role || "").toLowerCase() !== "client") continue;
        if (viewer.userId && row.assigned_by_user_id === viewer.userId) { ownIds.add(row.id); continue; }
        if (!row.team) continue;
        if (!teamCompany.has(row.team)) teamCompany.set(row.team, (await options.companyIdForClientTeam?.(row.team).catch(() => null)) ?? null);
        if (teamCompany.get(row.team) === scope) ownIds.add(row.id);
      }
    }
    const share: ClientShare = { companyId: scope, properties: new Set(propertyIds || []), ownSchemesOnly: restricted };
    actions = clientPlanView(engagement, ownIds, share).actions;
  }
  actions = actions.filter(a => a.status !== "done");

  // ── The brands a client login may be shown ─────────────────────────────
  // Its brand list, less hidden brands. If the list cannot be read, none.
  const liveCode = (status: any) => { const code = legacyToCode(status); return !!code && !CLOSED_STATUSES.includes(code); };
  const liveClocks = clockRows.filter((r: any) => liveCode(r.status));
  let visibleBrands: Set<string> | null = null;      // null = every brand (staff)
  if (!staff) {
    const brandIds = uniq([
      ...actions.map(a => a.companyId), ...viewingRows.map((r: any) => r.company_id), ...liveClocks.map((r: any) => r.tenant_id), ...caseRows.map((r: any) => r.company_id),
    ].filter((id): id is string => !!id));
    visibleBrands = new Set<string>();
    if (brandIds.length && options.brandSliceSql) {
      const rows = await guarded("The brand list", async () => (await q.query(
        `/* brand-diary:slice */ SELECT c.id FROM crm_companies c WHERE c.id = ANY($1) AND c.merged_into_id IS NULL AND c.archived_at IS NULL AND ${options.brandSliceSql}`, [brandIds])).rows, [] as any[]);
      for (const row of rows) visibleBrands.add(row.id);
    }
  }
  const brandSeen = (companyId: string | null | undefined) => !visibleBrands || (!!companyId && visibleBrands.has(companyId));
  // A joint agent holds no brand ids: the brand's name only.
  const brandOf = (companyId: string | null | undefined, name: string | null | undefined): DiaryItem["brand"] =>
    name || companyId ? { id: jointAgent ? null : companyId || null, name: String(name || "Brand") } : null;
  const brandPage = (companyId: string) => (jointAgent ? null : `/companies/${companyId}`);

  const items: DiaryItem[] = [];
  const item = (base: Pick<DiaryItem, "id" | "kind" | "title"> & Partial<DiaryItem>) => {
    const date = base.date || null;
    items.push({
      daysWaiting: null, brand: null, scheme: null, unitLabel: null, owner: null, waitingOn: null, raisedBy: null, status: null, actionId: null,
      canComplete: false, url: null, ...base, date, overdue: !!date && date < today,
    });
  };

  for (const a of actions) {
    if (!brandSeen(a.companyId)) continue;
    const own = ownIds.has(a.id);
    const raisedBy: "bgp" | "client" = staff ? a.raisedBy || "bgp" : own ? "client" : "bgp";
    // A client's own request carries no place; a shared action only the place the server left on it.
    const propertyId = staff ? a.propertyId : !own && a.schemeName ? placeOfAction.get(a.id) : null;
    const canComplete = !restricted && a.canEdit === true;
    item({
      id: `crm_action:${a.id}`, kind: "crm_action", title: a.title, date: londonDayOf(a.dueAt),
      brand: brandOf(a.companyId, a.companyName),
      scheme: schemeFor(propertyId, staff ? a.schemeName : null),
      unitLabel: a.unitLabel || null,
      owner: a.ownerName || null,
      // Who BGP marked an action as waiting on is BGP's own: staff only.
      waitingOn: staff && a.waitingOnParty ? { side: sideOf(a.waitingOnParty), name: a.waitingOnParty } : null,
      daysWaiting: staff && a.waitingOnParty ? daysSince(a.waitingSince, now) : null,
      raisedBy, status: a.status === "in_progress" ? "in_progress" : "todo",
      canComplete, actionId: canComplete ? a.id : null,
      url: staff ? crmEngagementLink(a.companyId, { action: a.id }, "brand") : brandPage(a.companyId) || clientPlaceUrl(propertyId, null),
    });
  }

  // ── Viewings ───────────────────────────────────────────────────────────
  for (const v of viewingRows) {
    if (!placed(v.property_id)) continue;
    // A client login is shown a viewing only for a brand on its list; one with no linked brand cannot be checked.
    if (!staff && !brandSeen(v.company_id)) continue;
    const common = {
      brand: brandOf(v.company_id, v.brand_name), scheme: schemeFor(v.property_id, v.property_name), unitLabel: v.unit_label || null, owner: v.owner_name || null,
      url: staff ? (v.tracker_id && v.property_id ? trackerUrl(v.property_id, v.tracker_id) : null) : clientPlaceUrl(v.property_id, v.tenancy_unit_id),
    };
    // A date that is not a real date is skipped, never thrown.
    const booked = String(v.status || "").toLowerCase() === "scheduled" ? diaryDay(v.viewing_date) : null;
    if (booked && booked >= today) item({ id: `viewing_booked:${v.id}`, kind: "viewing_booked", title: "Viewing booked", date: booked, ...common });
    const followUp = diaryDay(v.follow_up_date);
    // The follow-up's task, when it has one, is the same job: shown once, and gone when the task is done.
    if (followUp && followUp >= followUpFrom && v.task_status !== "done") {
      // What the agent typed as the next action is BGP's own note.
      item({ id: `viewing_followup:${v.id}`, kind: "viewing_followup", title: staff && v.next_action ? String(v.next_action) : "Follow up the viewing", date: followUp, ...common });
    }
  }

  // ── Deals waiting on someone ───────────────────────────────────────────
  for (const k of liveClocks) {
    if (!placed(k.property_id)) continue;
    if (!staff && k.tenant_id && !brandSeen(k.tenant_id)) continue;
    const party = String(k.waiting_on_party);
    item({
      id: `deal_waiting:${k.deal_id}`, kind: "deal_waiting", title: `Deal waiting on ${party}`, daysWaiting: daysSince(k.waiting_since, now),
      brand: brandOf(k.tenant_id, k.brand_name), scheme: schemeFor(k.property_id, k.property_name), unitLabel: k.unit_label || null, owner: k.owner_name || null,
      // The person named on the clock can be a brand's contact: never for a joint agent.
      waitingOn: { side: sideOf(party), name: !jointAgent && k.waiting_on_name ? `${party} (${k.waiting_on_name})` : party },
      url: staff ? `/deals/${k.deal_id}` : clientPlaceUrl(k.property_id, k.tenancy_unit_id),
    });
  }

  // ── Briefs awaiting a signature ────────────────────────────────────────
  for (const b of agreedBriefRows) {
    if (!placed(b.property_id)) continue;
    const status = briefStatus({
      use: b.brief_use, category: b.brief_category, nerFloor: b.brief_ner_floor, incentiveCeiling: b.brief_incentive_ceiling, capexEnvelope: b.brief_capex_envelope,
      targetBrands: b.brief_target_brands, notes: null, updatedAt: null, updatedByName: null,
      leasing: { by: null, at: b.brief_signed_leasing_at || null }, am: { by: null, at: b.brief_signed_am_at || null },
    });
    if (status !== "awaiting_am" && status !== "awaiting_leasing" && status !== "unsigned") continue;
    const who = status === "awaiting_am" ? "Landsec asset manager" : status === "awaiting_leasing" ? "Landsec leasing manager" : "Landsec leasing manager and asset manager";
    item({
      id: `brief_signature:agreed:${b.tenancy_unit_id}`, kind: "brief_signature", title: "Agreed brief awaiting signature", daysWaiting: daysSince(b.since, now),
      scheme: schemeFor(b.property_id, b.property_name), unitLabel: b.unit_label || null, waitingOn: { side: "landsec", name: who },
      url: schemeOfProperty.has(b.property_id) && b.tenancy_unit_id ? `/landsec/unit/${b.tenancy_unit_id}` : null,
    });
  }
  for (const b of targetingBriefRows) {
    if (!placed(b.property_id)) continue;
    const names: string[] = (Array.isArray(b.waiting_names) ? b.waiting_names : []).filter(Boolean);
    const roles: string[] = Array.isArray(b.waiting_roles) ? b.waiting_roles : [];
    if (!names.length) continue;
    const side: DiarySide = roles.every(r => CLIENT_BRIEF_ROLES.includes(r)) ? "landsec" : roles.every(r => r === "bgp_agent") ? "bgp" : roles.every(r => r === "joint_agent") ? "joint_agent" : "other";
    item({
      id: `brief_signature:targeting:${b.id}`, kind: "brief_signature", title: "Targeting Brief awaiting agreement", daysWaiting: daysSince(b.since, now),
      scheme: schemeFor(b.property_id, b.property_name), unitLabel: b.unit_label || null,
      waitingOn: { side, name: names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ") },
      url: schemeOfProperty.has(b.property_id) && b.tenancy_unit_id ? `/landsec/unit/${b.tenancy_unit_id}`
        : staff && b.tracker_id && b.property_id ? trackerUrl(b.property_id, b.tracker_id) : clientPlaceUrl(b.property_id, null),
    });
  }

  // ── Brand cases awaiting a reply ───────────────────────────────────────
  // A Landsec login: the sent cases it has not answered itself. BGP staff:
  // the sent cases an asset manager has yet to answer.
  const shownCases = caseRows.filter((c: any) => brandSeen(c.company_id));
  if (shownCases.length) {
    const [responses, assetManagers] = await Promise.all([
      guarded("Brand case replies", async () => (await q.query(
        `/* brand-diary:case-responses */ SELECT case_id, user_id FROM landsec_brand_case_responses WHERE case_id = ANY($1)`, [shownCases.map((c: any) => c.id)])).rows, null as any[] | null),
      !staff ? [] : guarded("Asset manager logins", async () => (await q.query(
        `/* brand-diary:asset-managers */ SELECT a.user_id, u.name FROM landsec_access a JOIN users u ON u.id = a.user_id
          WHERE a.landsec_role = 'asset_manager' AND u.is_active IS NOT FALSE ORDER BY u.name`)).rows, [] as any[]),
    ]);
    // With the replies unread nobody can be said to be waiting.
    for (const c of responses ? shownCases : []) {
      const replied = new Set(responses!.filter((r: any) => r.case_id === c.id).map((r: any) => r.user_id));
      const base = { id: `case_response:${c.id}`, kind: "case_response" as const, daysWaiting: daysSince(c.sent_at, now), brand: brandOf(c.company_id, c.brand_name), url: `/landsec/brand-case/${c.company_id}` };
      if (!staff) {
        if (viewer.userId && !replied.has(viewer.userId)) item({ ...base, title: "Brand case awaiting your reply", waitingOn: { side: "landsec", name: "You" } });
        continue;
      }
      const pending = assetManagers.filter((m: any) => !replied.has(m.user_id));
      if (pending.length) {
        const names = pending.map((m: any) => m.name).filter(Boolean);
        item({ ...base, title: `Brand case awaiting ${pending.length} asset manager ${pending.length === 1 ? "reply" : "replies"}`,
          waitingOn: { side: "landsec", name: names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ") || "Landsec asset managers" } });
      } else if (!assetManagers.length && replied.size === 0) {
        item({ ...base, title: "Brand case sent, no reply yet", waitingOn: { side: "landsec", name: "Landsec" } });
      }
    }
  }

  // Dated items by date, then the undated ones, longest wait first.
  items.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1)) || a.title.localeCompare(b.title));
  return {
    items, counts: diaryCounts(items, today), today,
    canAddAction: staff,
    // A request to BGP goes through the CRM plan's client path, which a joint agent cannot reach.
    canAddRequest: viewer.kind === "landsec",
    warnings,
  };
}

const userIdOf = (req: Request): string | null => req.session?.userId || (req as any).tokenUserId || null;

export function setupBrandCrmDiaryRoutes(app: Express) {
  // The diary for BGP staff: everything.
  app.get("/api/brand-crm/diary", requireAuth, async (req, res) => {
    try {
      if (!(await staffDoor(req, res))) return;
      const companyId = await landsecCompanyId();
      const schemes = companyId ? planSchemes(await resolveLandsecPortfolio(companyId)) : [];
      res.json(await loadDiary(pool, { kind: "staff", clientCompanyId: null, schemes: null, userId: userIdOf(req) }, schemes));
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed to load the diary" }); }
  });

  // The diary for a Landsec login, by its role and schemes. Read only: the
  // gateway lets every Landsec role reach /api/landsec/, and nothing but
  // this GET is registered here.
  app.get("/api/landsec/diary", requireAuth, async (req, res) => {
    try {
      const viewer = await landsecPlanViewer(req);
      if (!viewer) return res.status(403).json({ error: "Not available for this account" });
      const schemes = planSchemes(await resolveLandsecPortfolio(viewer.clientCompanyId!));
      res.json(await loadDiary(pool, { ...viewer, userId: userIdOf(req) }, schemes, {
        brandSliceSql: await clientBrandSliceSql(viewer.clientCompanyId, "c.id"),
        companyIdForClientTeam: getCompanyIdForClientTeam,
      }));
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed to load the diary" }); }
  });
}
