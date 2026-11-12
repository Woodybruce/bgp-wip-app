// The joint agent's Letting Tracker (Woody, 2026-11-12: "joint agents should
// have full control like us", "only on their instructed properties", "they
// can't have access to the brand pages"). One read gives the page everything
// a row shows: the unit's marketing fields, its deal reference, the brief,
// interest, viewings and offers, the deal checklist, the recommendation, the
// Heads of Terms stage and what the "Against the brief" monitor is worked out
// from (shared/brief-progress.ts).
//
// The /api/landsec/ prefix is open at the gateway to both restricted Landsec
// roles, so every handler here refuses everyone but a joint agent and BGP
// staff, and only ever reads units on the caller's schemes.
//
// What goes out is an allow-list. Never BGP's fee, fee split, the deal id,
// the landlord or BGP's agents on a unit; never a CRM id, an email address or
// a phone number; never the Outlook invitation behind a viewing or the
// wording the inbox sweep wrote on an interest line; and the contact typed on
// an offer only to the login that logged the offer. BGP staff get the same
// shape: their own tracker is the staff page.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { clientBrandSliceSql } from "./company-scope";
import { landsecViewer } from "./landsec-access";
import { resolveLandsecPortfolio } from "./landsec-schemes";
import { legacyToCode } from "@shared/deal-status";
import { isHistoricStatus } from "@shared/letting-rules";
import { checklistStageFor, checklistSummary } from "@shared/deal-checklist";
import type {
  LandsecTrackerData, LandsecTrackerUnit, LandsecTrackerPickProperty, LandsecTrackerPickUnit,
} from "@shared/landsec-tracker";

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";
// The client-side people on a brief who decide a recommendation (the same
// three roles as DECIDER_ROLES in server/unit-recommendation.ts).
const DECIDER_ROLES = ["client_leasing", "senior_asset_manager", "asset_manager"];
const LINES = 3;

interface TrackerProperty { id: string; name: string; schemeKey: string; schemeName: string }
interface TrackerAccess {
  userId: string;
  name: string | null;
  role: "joint_agent" | "bgp";
  firm: string | null;
  companyId: string;
  properties: Map<string, TrackerProperty>;
}

// Who is asking, and which properties may they have. A joint agent gets the
// properties of the schemes on their login; BGP staff every scheme property;
// anyone else (an asset manager, a leasing manager, the plain Landsec login,
// another client) gets null. No catch: if the role cannot be read the request
// fails, rather than a restricted login being treated as a wider one.
async function trackerAccess(req: Request): Promise<TrackerAccess | null> {
  const userId = req.session?.userId || (req as any).tokenUserId || null;
  if (!userId) return null;
  const viewer = await landsecViewer(req);
  if (!viewer) return null;
  const user = (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user) return null;
  const staff = !viewer.isClient && viewer.role === "bgp" && String(user.email || "").toLowerCase().endsWith(BGP_EMAIL_DOMAIN);
  const jointAgent = viewer.isClient && viewer.role === "joint_agent" && !!viewer.schemes;
  if (!staff && !jointAgent) return null;
  const portfolio = await resolveLandsecPortfolio(viewer.companyId);
  const properties = new Map<string, TrackerProperty>();
  for (const s of portfolio.schemes) {
    if (jointAgent && !viewer.schemes!.has(s.key)) continue;
    for (const p of s.properties) properties.set(p.id, { id: p.id, name: p.name, schemeKey: s.key, schemeName: s.name });
  }
  return { userId, name: user.name || user.email || null, role: jointAgent ? "joint_agent" : "bgp", firm: jointAgent ? viewer.firm : null, companyId: viewer.companyId, properties };
}

const REFUSED = "The tracker is for the joint agents on a Landsec scheme and BGP";
const fail = (res: Response, e: any, message: string) => {
  console.error("[landsec-tracker]", e?.message || e);
  res.status(500).json({ message });
};

const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);
const num = (v: any): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v: any): string | null => { const s = String(v ?? "").trim(); return s ? s : null; };
const hasText = (v: any): boolean => String(v ?? "").trim() !== "";
const todayLondon = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// A note on an interest line as a joint agent may read it. A line the inbox
// or diary sweep made carries the BGP mailbox and the email's subject in its
// note (server/viewing-sync.ts): that is BGP's email history, so the note is
// dropped, whatever the row's source column says.
const SWEEP_NOTE = /^\s*(synced from|detected in|backfilled from|captured from)\b/i;
const EMAIL_IN_TEXT = /<?[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+>?/g;
function interestNote(row: { notes: any; source: any }): string | null {
  if (row.source) return null;
  const note = text(row.notes);
  if (!note || SWEEP_NOTE.test(note)) return null;
  return text(note.replace(EMAIL_IN_TEXT, ""));
}

function hotsStage(r: any): LandsecTrackerUnit["hots"]["stage"] {
  if (r.hots_final) return "final";
  if (r.hots_issued_at) return "issued";
  if (hasText(r.hots_content)) return r.hots_agreed_at ? "agreed" : "draft";
  if (hasText(r.hots_template) || r.hots_template_docx) return "no_draft";
  return "no_template";
}

async function buildTracker(access: TrackerAccess): Promise<LandsecTrackerData> {
  const propertyIds = Array.from(access.properties.keys());
  const schemes = new Map<string, { key: string; name: string; properties: { id: string; name: string }[] }>();
  access.properties.forEach(p => {
    if (!schemes.has(p.schemeKey)) schemes.set(p.schemeKey, { key: p.schemeKey, name: p.schemeName, properties: [] });
    schemes.get(p.schemeKey)!.properties.push({ id: p.id, name: p.name });
  });
  const viewer = { role: access.role, userId: access.userId, name: access.name, firm: access.firm };
  const base: LandsecTrackerData = { viewer, schemes: Array.from(schemes.values()), units: [] };
  if (propertyIds.length === 0) return base;

  // The unit rows. Named columns only: nothing is added to this reply by a
  // new column on available_units or crm_deals.
  const unitRows = (await pool.query(
    `SELECT au.id, au.property_id,
            COALESCE(pu.unit_name, au.unit_name) AS unit_name,
            COALESCE(pu.floor, au.floor) AS floor,
            COALESCE(pu.sqft, au.sqft) AS sqft,
            COALESCE(pu.use_class, au.use_class) AS use_class,
            COALESCE(pu.condition, au.condition) AS condition,
            COALESCE(pu.epc_rating, au.epc_rating) AS epc_rating,
            au.asking_rent, au.rates_pa, au.service_charge_pa, au.rent_poa, au.lease_terms,
            au.available_date, au.marketing_start_date, au.marketing_status,
            au.notes, au.restrictions, au.created_at, au.updated_at,
            d.deal_ref, au.tenancy_unit_id IS NOT NULL AS has_unit_page,
            ts.existing_tenant,
            au.hots_content, COALESCE(au.hots_version, 0) AS hots_version, au.hots_agreed_at, au.hots_issued_at,
            EXISTS (SELECT 1 FROM unit_marketing_files f WHERE f.id = au.hots_final_file_id AND f.unit_id = au.id) AS hots_final,
            p.hots_template, p.hots_template_docx
       FROM available_units au
       JOIN crm_properties p ON p.id = au.property_id
       LEFT JOIN property_units pu ON pu.id = au.unit_id
       LEFT JOIN crm_deals d ON d.id = au.deal_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(nullif(trim(t.trading_name), ''), nullif(trim(t.tenant_name), '')) AS existing_tenant
           FROM tenancy_schedule_units t
          WHERE (au.tenancy_unit_id IS NOT NULL AND t.id = au.tenancy_unit_id)
             OR (au.tenancy_unit_id IS NULL AND t.property_id = au.property_id
                 AND lower(trim(coalesce(nullif(trim(t.unit_number), ''), t.premises, ''))) = lower(trim(coalesce(au.unit_name, ''))))
          ORDER BY (t.id = au.tenancy_unit_id) DESC NULLS LAST
          LIMIT 1
       ) ts ON TRUE
      WHERE au.property_id = ANY($1::varchar[])
      ORDER BY au.created_at DESC`, [propertyIds])).rows;
  if (unitRows.length === 0) return base;
  const unitIds: string[] = unitRows.map((r: any) => r.id);

  const [briefQ, interestQ, viewingQ, offerQ, checklistQ, recommendationQ] = await Promise.all([
    // One brief per unit: the newest, as the brief list does.
    pool.query(
      `SELECT DISTINCT ON (b.unit_id) b.id, b.unit_id, b.agreed_at, COALESCE(b.version, 1) AS version,
              b.min_targets, b.priority_targets, b.deadline1_date, b.deadline2_date, b.commercials
         FROM unit_briefs b
        WHERE b.unit_id = ANY($1::varchar[])
        ORDER BY b.unit_id, b.created_at DESC`, [unitIds]),
    pool.query(
      `SELECT i.id, i.unit_id, i.company_name, i.contact_name, i.agent_company_name, i.interest_date, i.notes, i.source
         FROM unit_interest i
        WHERE i.unit_id = ANY($1::varchar[])
        ORDER BY i.interest_date DESC, i.created_at DESC`, [unitIds]),
    // Booked and held viewings, as the staff tracker counts them. The brand
    // and the person met are names; the invitation behind a diary booking
    // (source_details, attendees) and the notes are not read at all.
    pool.query(
      `SELECT v.id, v.unit_id, COALESCE(co.name, v.company_name) AS company_name,
              COALESCE(ct.name, v.contact_name) AS contact_name,
              v.viewing_date, v.viewing_time, v.status, v.outcome
         FROM unit_viewings v
         LEFT JOIN crm_companies co ON co.id = v.company_id
         LEFT JOIN crm_contacts ct ON ct.id = v.contact_id
        WHERE v.unit_id = ANY($1::varchar[]) AND v.deleted_at IS NULL AND v.status IN ('scheduled', 'completed')
        ORDER BY v.viewing_date DESC, v.viewing_time DESC NULLS LAST`, [unitIds]),
    // The author of an offer's first round is the login that logged it.
    pool.query(
      `SELECT o.id, o.unit_id, o.company_name, o.contact_name, o.offer_date, o.status,
              o.rent_pa, o.rent_free_months, o.term_years, o.fitting_out_contribution, f.created_by_user_id AS first_by
         FROM unit_offers o
         LEFT JOIN LATERAL (SELECT r.created_by_user_id FROM unit_offer_rounds r WHERE r.offer_id = o.id
                             ORDER BY r.round_no ASC, r.created_at ASC LIMIT 1) f ON TRUE
        WHERE o.unit_id = ANY($1::varchar[])
        ORDER BY o.offer_date DESC, o.created_at DESC`, [unitIds]),
    // The checklist of the unit's current deal (as /api/deal-checklists/summary).
    pool.query(
      `SELECT c.unit_id, c.responsible_name, i.stage, i.required, i.done_at IS NOT NULL AS done, i.due_date,
              i.assignee_name IS NOT NULL AS assigned
         FROM deal_checklists c
         JOIN available_units au ON au.id = c.unit_id AND COALESCE(au.deal_id, '') = COALESCE(c.deal_id, '')
         LEFT JOIN deal_checklist_items i ON i.checklist_id = c.id
        WHERE c.unit_id = ANY($1::varchar[])`, [unitIds]),
    // The recommendation on the unit's current deal (as /api/unit-recommendations/summary).
    pool.query(
      `SELECT r.unit_id, r.issued_at,
              (SELECT COUNT(*)::int FROM unit_brief_people p WHERE p.brief_id = b.id AND p.role = ANY($2::text[])) AS total,
              (SELECT COUNT(*)::int FROM unit_brief_people p
                 JOIN unit_recommendation_decisions d ON d.recommendation_id = r.id AND d.brief_person_id = p.id AND d.version = r.version
                WHERE p.brief_id = b.id AND p.role = ANY($2::text[]) AND d.decision = 'approved') AS approved,
              (SELECT COUNT(*)::int FROM unit_brief_people p
                 JOIN unit_recommendation_decisions d ON d.recommendation_id = r.id AND d.brief_person_id = p.id AND d.version = r.version
                WHERE p.brief_id = b.id AND p.role = ANY($2::text[]) AND d.decision = 'declined') AS declined
         FROM unit_recommendations r
         JOIN available_units au ON au.id = r.unit_id AND COALESCE(au.deal_id, '') = COALESCE(r.deal_id, '')
         LEFT JOIN LATERAL (SELECT id FROM unit_briefs ub WHERE ub.unit_id = au.id ORDER BY ub.created_at DESC LIMIT 1) b ON TRUE
        WHERE r.unit_id = ANY($1::varchar[])`, [unitIds, DECIDER_ROLES]),
  ]);

  const briefIds: string[] = briefQ.rows.map((r: any) => r.id);
  const [signoffQ, targetQ] = briefIds.length ? await Promise.all([
    pool.query(
      `SELECT p.brief_id, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE p.agreed_at IS NOT NULL AND p.agreed_version = COALESCE(b.version, 1))::int AS agreed
         FROM unit_brief_people p JOIN unit_briefs b ON b.id = p.brief_id
        WHERE p.brief_id = ANY($1::varchar[]) GROUP BY p.brief_id`, [briefIds]),
    // The monitor needs how many targets there are, their priority and how
    // far each has got. Nothing else about a target is read here.
    pool.query(`SELECT t.brief_id, t.status, t.priority FROM unit_target_operators t WHERE t.brief_id = ANY($1::varchar[])`, [briefIds]),
  ]) : [{ rows: [] as any[] }, { rows: [] as any[] }];

  const group = <T,>(rows: any[], key: string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return m;
  };
  const briefByUnit = new Map<string, any>(briefQ.rows.map((r: any) => [r.unit_id, r]));
  const signoffByBrief = new Map<string, any>(signoffQ.rows.map((r: any) => [r.brief_id, r]));
  const targetsByBrief = group<any>(targetQ.rows, "brief_id");
  const interestByUnit = group<any>(interestQ.rows, "unit_id");
  const viewingsByUnit = group<any>(viewingQ.rows, "unit_id");
  const offersByUnit = group<any>(offerQ.rows, "unit_id");
  const checklistByUnit = group<any>(checklistQ.rows, "unit_id");
  const recommendationByUnit = new Map<string, any>(recommendationQ.rows.map((r: any) => [r.unit_id, r]));
  const day = todayLondon();

  base.units = unitRows.map((r: any): LandsecTrackerUnit => {
    const property = access.properties.get(r.property_id)!;
    const statusCode = legacyToCode(r.marketing_status) || "AVA";

    const b = briefByUnit.get(r.id) || null;
    const so = b ? signoffByBrief.get(b.id) : null;
    const signoff = { total: so?.total || 0, agreed: so?.agreed || 0, complete: !!b?.agreed_at };
    const commercials = b && b.commercials && typeof b.commercials === "object" ? b.commercials : null;
    const brief = b ? {
      id: b.id as string, agreed: !!b.agreed_at, agreedAt: iso(b.agreed_at), signoff,
    } : null;

    const interest = interestByUnit.get(r.id) || [];
    const viewings = viewingsByUnit.get(r.id) || [];
    const offers = offersByUnit.get(r.id) || [];
    // The contact on an offer is the logging agent's own note of who they
    // spoke to: it goes only to the login that logged the offer.
    const offerLine = (o: any) => {
      const own = !!o.first_by && o.first_by === access.userId;
      return {
        id: o.id as string, companyName: text(o.company_name) || (own ? text(o.contact_name) : null),
        contactName: own ? text(o.contact_name) : null, own,
        offerDate: text(o.offer_date), status: text(o.status) || "Pending", rentPa: num(o.rent_pa),
      };
    };

    const checklistRows = checklistByUnit.get(r.id) || [];
    let checklist: LandsecTrackerUnit["checklist"] = null;
    if (checklistRows.length) {
      const responsibleName = text(checklistRows[0].responsible_name);
      const stage = checklistStageFor(statusCode);
      const items = checklistRows.filter((x: any) => x.stage).map((x: any) => ({ stage: x.stage as string, required: !!x.required, doneAt: x.done ? true : null, dueDate: x.due_date || null, assignee: x.assigned ? true : null }));
      checklist = { ...checklistSummary(items, stage, day, !!responsibleName), responsibleName, stage };
    }

    const rec = recommendationByUnit.get(r.id) || null;
    let recommendation: LandsecTrackerUnit["recommendation"] = null;
    if (rec) {
      const issued = !!rec.issued_at;
      const stage = !issued ? "draft" : rec.total > 0 && rec.approved === rec.total ? "approved" : rec.declined > 0 ? "declined" : "issued";
      recommendation = { stage, approved: issued ? rec.approved : 0, total: rec.total, issuedAt: iso(rec.issued_at) };
    }

    return {
      id: r.id, unitName: String(r.unit_name || "").trim(), propertyId: r.property_id, propertyName: property.name,
      schemeKey: property.schemeKey, schemeName: property.schemeName,
      marketingStatus: text(r.marketing_status), statusCode,
      floor: text(r.floor), sqft: num(r.sqft), useClass: text(r.use_class), condition: text(r.condition), epcRating: text(r.epc_rating),
      askingRent: num(r.asking_rent), rentPoa: !!r.rent_poa, ratesPa: num(r.rates_pa), serviceChargePa: num(r.service_charge_pa),
      leaseTerms: text(r.lease_terms), availableDate: text(r.available_date), marketingStartDate: text(r.marketing_start_date),
      notes: text(r.notes), restrictions: text(r.restrictions), existingTenant: text(r.existing_tenant),
      dealRef: r.deal_ref ?? null, hasUnitPage: !!r.has_unit_page,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      brief,
      interest: {
        count: interest.length,
        lines: interest.slice(0, LINES).map((i: any) => ({
          id: i.id as string, companyName: text(i.company_name), agentCompanyName: text(i.agent_company_name),
          // The person is shown only when the line names no brand and no agent
          // and was logged by hand; otherwise the line would have no name.
          contactName: !i.source && !text(i.company_name) && !text(i.agent_company_name) ? text(i.contact_name) : null,
          interestDate: text(i.interest_date), notes: interestNote(i),
        })),
      },
      viewings: {
        count: viewings.length,
        lines: viewings.slice(0, LINES).map((v: any) => ({
          id: v.id as string, companyName: text(v.company_name), contactName: text(v.contact_name),
          viewingDate: text(v.viewing_date), viewingTime: text(v.viewing_time), status: text(v.status) || "scheduled", outcome: text(v.outcome),
        })),
      },
      offers: { count: offers.length, lines: offers.slice(0, LINES).map(offerLine) },
      checklist,
      recommendation,
      hots: { stage: hotsStage(r), version: Number(r.hots_version) || 0, issuedAt: iso(r.hots_issued_at) },
      monitor: {
        statusCode,
        brief: b ? {
          signoff, minTargets: b.min_targets ?? null, priorityTargets: b.priority_targets ?? null,
          deadline1Date: text(b.deadline1_date), deadline2Date: text(b.deadline2_date),
          commercials: { quotingRentPa: num(commercials?.quotingRentPa), nerFloorPa: num(commercials?.nerFloorPa) },
          targets: (targetsByBrief.get(b.id) || []).map((t: any) => ({ status: text(t.status), priority: text(t.priority) })),
        } : null,
        recommendation: recommendation ? { stage: recommendation.stage, approved: recommendation.approved, total: recommendation.total } : null,
        viewings: viewings.map((v: any) => ({ status: text(v.status), viewingDate: text(v.viewing_date) })),
        offers: offers.map((o: any) => ({
          status: text(o.status), companyName: text(o.company_name), rentPa: num(o.rent_pa), rentFreeMonths: num(o.rent_free_months),
          termYears: num(o.term_years), fittingOutContribution: num(o.fitting_out_contribution),
        })),
      },
    };
  });
  return base;
}

export function setupLandsecTrackerRoutes(app: Express) {
  // The tracker: every unit on the caller's schemes.
  app.get("/api/landsec/tracker", requireAuth, async (req, res) => {
    try {
      const access = await trackerAccess(req);
      if (!access) return res.status(403).json({ message: REFUSED });
      res.json(await buildTracker(access));
    } catch (e: any) { fail(res, e, "The tracker could not be loaded"); }
  });

  // Add unit: the properties on the caller's schemes and, for one of them,
  // the units on its tenancy schedule with where each stands on the tracker.
  // Names and status only: no deal id, no brand or tenant record.
  app.get("/api/landsec/tracker/pick-list", requireAuth, async (req, res) => {
    try {
      const access = await trackerAccess(req);
      if (!access) return res.status(403).json({ message: REFUSED });
      const properties: LandsecTrackerPickProperty[] = Array.from(access.properties.values())
        .map(p => ({ id: p.id, name: p.name, schemeKey: p.schemeKey, schemeName: p.schemeName }))
        .sort((a, b) => a.schemeName.localeCompare(b.schemeName) || a.name.localeCompare(b.name));
      const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : "";
      if (!propertyId) return res.json({ properties, units: [] });
      if (!access.properties.has(propertyId)) return res.status(403).json({ message: "That property is not on one of your schemes" });

      const [tenancy, tracker] = await Promise.all([
        pool.query(
          `SELECT t.id, COALESCE(nullif(trim(t.unit_number), ''), t.premises) AS unit_name,
                  COALESCE(nullif(trim(t.occupancy_status), ''), t.status) AS occupancy,
                  COALESCE(nullif(trim(t.trading_name), ''), nullif(trim(t.tenant_name), '')) AS tenant_name
             FROM tenancy_schedule_units t
            WHERE t.property_id = $1
            ORDER BY 2 LIMIT 2000`, [propertyId]),
        pool.query(
          `SELECT au.id, au.tenancy_unit_id, COALESCE(pu.unit_name, au.unit_name) AS unit_name, au.marketing_status, au.created_at, d.deal_ref
             FROM available_units au
             LEFT JOIN property_units pu ON pu.id = au.unit_id
             LEFT JOIN crm_deals d ON d.id = au.deal_id
            WHERE au.property_id = $1`, [propertyId]),
      ]);
      // One line per physical unit, keyed as the tracker's own duplicate guard
      // keys it: the first comma segment of the name, lower-cased.
      const keyOf = (name: any) => String(name || "").split(",")[0].trim().toLowerCase();
      const byKey = new Map<string, LandsecTrackerPickUnit>();
      for (const t of tenancy.rows) {
        const key = keyOf(t.unit_name);
        if (!key || byKey.has(key)) continue;
        byKey.set(key, { unitName: String(t.unit_name).trim(), tenancyUnitId: t.id, trackerUnitId: null, statusCode: null, dealRef: null, occupancy: text(t.occupancy), tenantName: text(t.tenant_name) });
      }
      // The live tracker row wins, else the most recent one.
      const best = new Map<string, any>();
      for (const a of tracker.rows) {
        const key = keyOf(a.unit_name);
        if (!key) continue;
        const code = legacyToCode(a.marketing_status) || "AVA";
        const cand = { ...a, code, live: !isHistoricStatus(code) };
        const byTenancy = a.tenancy_unit_id ? Array.from(byKey.entries()).find(([, u]) => u.tenancyUnitId === a.tenancy_unit_id)?.[0] : null;
        const k = byTenancy || key;
        const cur = best.get(k);
        if (!cur || (cand.live && !cur.live) || (cand.live === cur.live && new Date(cand.created_at) > new Date(cur.created_at))) best.set(k, cand);
      }
      best.forEach((a, key) => {
        let row = byKey.get(key);
        if (!row) { row = { unitName: String(a.unit_name).trim(), tenancyUnitId: null, trackerUnitId: null, statusCode: null, dealRef: null, occupancy: null, tenantName: null }; byKey.set(key, row); }
        // A let or withdrawn row is history: adding the unit again starts a new letting.
        if (a.live) { row.trackerUnitId = a.id; row.dealRef = a.deal_ref ?? null; row.statusCode = a.code; }
      });
      const units = Array.from(byKey.values()).sort((a, b) => a.unitName.localeCompare(b.unitName, "en-GB", { numeric: true }));
      res.json({ properties, units });
    } catch (e: any) { fail(res, e, "The units could not be loaded"); }
  });

  // Brand names for the interest, viewing and offer forms: id and name from
  // the Landsec brand list, by search. Nothing else about a brand.
  app.get("/api/landsec/tracker/brands", requireAuth, async (req, res) => {
    try {
      const access = await trackerAccess(req);
      if (!access) return res.status(403).json({ message: REFUSED });
      const q = String(req.query.q ?? "").trim().slice(0, 80);
      if (q.length < 2) return res.json([]);
      const slice = await clientBrandSliceSql(access.companyId, "c.id");
      const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
      const rows = (await pool.query(
        `SELECT c.id, c.name FROM crm_companies c
          WHERE c.company_type ~* '^tenant([[:space:]]|-|$)' AND c.merged_into_id IS NULL AND c.archived_at IS NULL
            AND ${slice}
            AND c.name ILIKE $1
          ORDER BY (lower(c.name) = lower($2)) DESC, (lower(c.name) LIKE lower($2) || '%') DESC, c.name
          LIMIT 25`, [like, q])).rows;
      res.json(rows.map((r: any) => ({ id: r.id as string, name: r.name as string })));
    } catch (e: any) { fail(res, e, "The brands could not be loaded"); }
  });
}
