// One feed of a property's units for the property page
// (docs/property-page-rebuild-2026-11-13.md): every tenancy schedule row with
// its Letting Tracker row, live deal, brief, counts and plan outlines, plus
// the units that are on the tracker only. The unit list, the plan colouring
// and the pills all read this, so a unit says the same thing in each place.
// It runs a fixed number of queries per property, never one per unit.
//
// What a client login may read is decided here, not on the screen: nothing in
// either reply carries BGP's fee, the internal agents or BGP's notes on a
// target, and the lease advisory lines are for BGP staff only.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { clientBlockedForProperty, isPropertyInScope, resolveCompanyScope } from "./company-scope";
import { normUnitSql, resolveBrandIdSubquery } from "./tenant-brand-resolver";
import { briefStateOf, daysSince, stageSinceFor } from "./landsec-unit";
import { openPlanCandidates } from "./property-plan-match";
import { legacyToCode } from "@shared/deal-status";
import { closedStatusSqlList, isLettingType, lettingTypeSqlList } from "@shared/letting-rules";
import {
  namedTenant, propertyUnitCounts, unitFlags, unitOccupancy, unitStage,
  type PropertyUnit, type PropertyUnitDeal, type PropertyUnitDetail, type PropertyUnitPlan, type PropertyUnitsFeed,
} from "@shared/property-units";

type Db = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

export const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// A client login outside its own properties (an asset manager or joint agent
// outside their schemes) is refused, and so are BGP staff viewing as a client
// when the property is not that client's: clientBlockedForProperty alone lets
// the second through.
export async function propertyReadBlocked(req: Request, propertyId: string): Promise<boolean> {
  if (await clientBlockedForProperty(req, propertyId)) return true;
  const scope = await resolveCompanyScope(req);
  return !!scope && !(await isPropertyInScope(scope, propertyId));
}

const num = (value: unknown): number | null => { const n = Number(value); return value != null && value !== "" && Number.isFinite(n) ? n : null; };
const text = (value: unknown): string | null => { const s = String(value ?? "").trim(); return s || null; };
const LIVE_DEAL = `btrim(COALESCE(d.status, '')) <> '' AND lower(btrim(COALESCE(d.status, ''))) NOT IN (${closedStatusSqlList()})`;
const DATES = ["lease_start", "lease_expiry", "break_date", "landlord_break_date", "next_review_date"].map(c => `to_char(t.${c}, 'YYYY-MM-DD') AS ${c}`).join(", ");
const DEAL_COLUMNS = `d.id AS deal_id, d.deal_ref, d.name AS deal_name, d.deal_type, d.status AS deal_status, d.stage_entered_at, d.created_at AS deal_created_at, dc.name AS deal_tenant`;

// The schedule rows. One tracker row and one live deal at most per row
// (lateral, limit 1), so a unit with two tracker rows is still one unit. A
// tracker row belongs to a schedule row by the four links TRACKER_ONLY_SQL
// tests below, so a tracker row that is not a unit of its own is always on its
// schedule row: the tenancy links win, then the physical unit, then the name,
// then the newest. The deal is the tracker row's own, then a letting, then the
// most recently updated.
const SPINE_SQL = `
  SELECT t.id, t.grouping, t.premises, t.unit_number, t.floor_level, t.status, t.occupancy_status, t.tenant_name, t.trading_name,
         t.permitted_use, t.passing_rent_pa, t.erv_pa, t.nia_sqft, t.gia_sqft, t.sort_order, ${DATES},
         COALESCE(tc_fk.id, tc_soft.id) AS company_id, COALESCE(tc_fk.name, tc_soft.name) AS company_name,
         (lower(btrim(COALESCE(t.status, ''))) = 'archived' OR lower(btrim(COALESCE(t.occupancy_status, ''))) = 'archived') AS archived,
         t.deal_id AS row_deal_id, au.id AS tracker_id, au.marketing_status, au.asking_rent, ${DEAL_COLUMNS},
         ub.id AS brief_id, ub.agreed_at AS brief_agreed_at,
         lu.brief_signed_leasing_at, lu.brief_signed_am_at,
         (lu.brief_use IS NOT NULL OR lu.brief_category IS NOT NULL OR lu.brief_ner_floor IS NOT NULL OR lu.brief_target_brands IS NOT NULL) AS agreed_brief_drafted
    FROM tenancy_schedule_units t
    LEFT JOIN crm_companies tc_fk ON tc_fk.id = t.tenant_company_id AND tc_fk.merged_into_id IS NULL
    LEFT JOIN LATERAL (
      SELECT c.id, c.name FROM crm_companies c
       WHERE t.tenant_company_id IS NULL
         AND c.id = ${resolveBrandIdSubquery("coalesce(nullif(btrim(t.trading_name), ''), t.tenant_name, '')")}
       LIMIT 1
    ) tc_soft ON TRUE
    LEFT JOIN LATERAL (
      SELECT a.id, a.marketing_status, a.asking_rent, a.deal_id FROM available_units a
       WHERE a.property_id = t.property_id
         AND (
           a.tenancy_unit_id::text = t.id::text
           OR a.id = t.letting_tracker_unit_id
           OR (a.tenancy_unit_id IS NULL AND a.unit_id IS NOT NULL AND t.property_unit_id = a.unit_id)
           OR (a.tenancy_unit_id IS NULL
               AND (a.unit_id IS NULL OR t.property_unit_id IS NULL)
               AND ${normUnitSql("a.unit_name")} <> ''
               AND ${normUnitSql("coalesce(nullif(trim(t.unit_number), ''), t.premises)")} = ${normUnitSql("a.unit_name")})
         )
       ORDER BY (a.tenancy_unit_id = t.id) DESC NULLS LAST, (a.id = t.letting_tracker_unit_id) DESC NULLS LAST, (a.unit_id = t.property_unit_id) DESC NULLS LAST,
                a.updated_at DESC NULLS LAST, a.id
       LIMIT 1
    ) au ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.* FROM crm_deals d
       WHERE (d.tenancy_unit_id = t.id OR d.id = au.deal_id OR d.id = t.deal_id) AND ${LIVE_DEAL}
       ORDER BY (d.id = au.deal_id) DESC NULLS LAST, (d.deal_type IN (${lettingTypeSqlList()})) DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.id
       LIMIT 1
    ) d ON TRUE
    LEFT JOIN crm_companies dc ON dc.id = d.tenant_id
    LEFT JOIN LATERAL (
      SELECT b.id, b.agreed_at FROM unit_briefs b WHERE b.unit_id = au.id ORDER BY b.created_at DESC LIMIT 1
    ) ub ON TRUE
    LEFT JOIN landsec_units lu ON lu.tenancy_unit_id = t.id
   WHERE t.property_id = $1`;

// Units on the Letting Tracker with no schedule row: the same test, in the
// same order, as the tenancy schedule's own read (server/tenancy-schedule.ts,
// "Stable tenancy/physical/tracker links take precedence over labels"), so
// both screens count the same units. qa/regression/property-units-guards.test.mjs
// holds the two in step.
const TRACKER_IDENTITY = `coalesce('physical:' || au.unit_id, 'name:' || nullif(${normUnitSql("au.unit_name")}, ''), 'tracker:' || au.id)`;
const TRACKER_ONLY_SQL = `
  SELECT DISTINCT ON (${TRACKER_IDENTITY})
         au.id AS tracker_id, au.unit_name, au.sqft, au.floor, au.use_class, au.asking_rent, au.marketing_status, ${DEAL_COLUMNS}, (${LIVE_DEAL}) AS deal_live,
         ub.id AS brief_id, ub.agreed_at AS brief_agreed_at
    FROM available_units au
    LEFT JOIN crm_deals d ON d.id = au.deal_id
    LEFT JOIN crm_companies dc ON dc.id = d.tenant_id
    LEFT JOIN LATERAL (
      SELECT b.id, b.agreed_at FROM unit_briefs b WHERE b.unit_id = au.id ORDER BY b.created_at DESC LIMIT 1
    ) ub ON TRUE
   WHERE au.property_id = $1
     AND NOT EXISTS (
       SELECT 1 FROM tenancy_schedule_units ts
       WHERE ts.property_id = au.property_id
         AND (
           ts.id::text = au.tenancy_unit_id::text
           OR ts.letting_tracker_unit_id = au.id
           OR (au.tenancy_unit_id IS NULL AND au.unit_id IS NOT NULL AND ts.property_unit_id = au.unit_id)
           OR (au.tenancy_unit_id IS NULL
               AND (au.unit_id IS NULL OR ts.property_unit_id IS NULL)
               AND ${normUnitSql("au.unit_name")} <> ''
               AND ${normUnitSql("coalesce(nullif(trim(ts.unit_number), ''), ts.premises)")} = ${normUnitSql("au.unit_name")})
         )
     )
   ORDER BY ${TRACKER_IDENTITY}, au.created_at DESC, au.id`;

// Viewings, the offers of the current letting (any status but Closed) and
// brief targets, counted per tracker row in one go.
const TALLY_SQL = `
  SELECT 'viewings' AS kind, v.unit_id, count(*)::int AS n FROM unit_viewings v JOIN available_units a ON a.id = v.unit_id
   WHERE a.property_id = $1 AND v.deleted_at IS NULL GROUP BY v.unit_id
  UNION ALL
  SELECT 'offers', o.unit_id, count(*)::int FROM unit_offers o JOIN available_units a ON a.id = o.unit_id
   WHERE a.property_id = $1 AND COALESCE(o.status, '') <> 'Closed' GROUP BY o.unit_id
  UNION ALL
  SELECT 'targets', b.unit_id, count(*)::int FROM unit_target_operators x JOIN unit_briefs b ON b.id = x.brief_id JOIN available_units a ON a.id = b.unit_id
   WHERE a.property_id = $1 GROUP BY b.unit_id`;

// A plan's proposals are the ones its Match board lists
// (server/property-plan-match.ts openPlanCandidates): the outlines of its
// latest scan, while that scan is ready and still matches the plan's image,
// that nobody has saved or marked "not a unit" and that nothing has since
// been drawn over.
const PLANS_SQL = `
  SELECT p.id, p.floor, p.storage_key,
         (SELECT count(*)::int FROM property_plan_units u WHERE u.plan_id = p.id) AS outlines,
         (SELECT count(*)::int FROM property_plan_units u WHERE u.plan_id = p.id AND u.tenancy_unit_id IS NULL) AS unlinked,
         s.status AS scan_status, s.image_key AS scan_image_key, s.candidates AS scan_candidates
    FROM property_plans p
    LEFT JOIN LATERAL (
      SELECT s.status, s.image_key, s.candidates FROM property_plan_scans s WHERE s.plan_id = p.id ORDER BY s.created_at DESC, s.id DESC LIMIT 1
    ) s ON TRUE
   WHERE p.property_id = $1 AND COALESCE(p.is_geo, false) = false
   ORDER BY p.display_order, p.floor, p.id`;
const OUTLINES_SQL = `
  SELECT u.id, u.plan_id, u.tenancy_unit_id, u.unit_id, u.label, u.polygon FROM property_plan_units u JOIN property_plans p ON p.id = u.plan_id
   WHERE p.property_id = $1 AND COALESCE(p.is_geo, false) = false
   ORDER BY u.created_at, u.id`;
const OPEN_DEALS_SQL = `
  SELECT ${DEAL_COLUMNS}, d.tenancy_unit_id FROM crm_deals d LEFT JOIN crm_companies dc ON dc.id = d.tenant_id
   WHERE d.property_id = $1 AND ${LIVE_DEAL}
   ORDER BY d.updated_at DESC NULLS LAST, d.id`;

function dealOf(row: any, since: Map<string, string>): PropertyUnitDeal | null {
  if (!row.deal_id) return null;
  return {
    id: row.deal_id, ref: row.deal_ref ?? null, name: text(row.deal_name), type: text(row.deal_type), tenant: text(row.deal_tenant),
    code: legacyToCode(row.deal_status), days: daysSince(since.get(row.deal_id) || row.stage_entered_at || row.deal_created_at),
    letting: isLettingType(row.deal_type),
  };
}

const naturally = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

export async function loadPropertyUnits(db: Db, propertyId: string, today: string = londonToday()): Promise<PropertyUnitsFeed | null> {
  const property = (await db.query(`SELECT id, name FROM crm_properties WHERE id = $1`, [propertyId])).rows[0];
  if (!property) return null;
  const [spine, trackerOnly, tallies, planRows, outlineRows, openDeals] = await Promise.all([
    db.query(SPINE_SQL, [propertyId]),
    db.query(TRACKER_ONLY_SQL, [propertyId]),
    db.query(TALLY_SQL, [propertyId]),
    db.query(PLANS_SQL, [propertyId]),
    db.query(OUTLINES_SQL, [propertyId]),
    db.query(OPEN_DEALS_SQL, [propertyId]),
  ]);
  const dealIds = [...new Set([...spine.rows, ...trackerOnly.rows, ...openDeals.rows].map(r => r.deal_id).filter(Boolean))];
  const since = await stageSinceFor(dealIds, db);

  const tally = new Map<string, { viewings: number; offers: number; targets: number }>();
  for (const row of tallies.rows) {
    const entry = tally.get(row.unit_id) || { viewings: 0, offers: 0, targets: 0 };
    entry[row.kind as "viewings" | "offers" | "targets"] = row.n;
    tally.set(row.unit_id, entry);
  }
  const outlinesByRow = new Map<string, Array<{ planId: string; outlineId: string }>>();
  const outlinesByPlan = new Map<string, any[]>();
  for (const row of outlineRows.rows) {
    outlinesByPlan.set(row.plan_id, [...(outlinesByPlan.get(row.plan_id) || []), row]);
    if (!row.tenancy_unit_id) continue;
    const list = outlinesByRow.get(row.tenancy_unit_id) || [];
    list.push({ planId: row.plan_id, outlineId: row.id });
    outlinesByRow.set(row.tenancy_unit_id, list);
  }
  const plans: PropertyUnitPlan[] = planRows.rows.map(p => ({
    id: p.id, floor: p.floor, outlines: p.outlines, unlinkedOutlines: p.unlinked,
    proposals: p.scan_status === "ready" && p.scan_image_key === p.storage_key ? openPlanCandidates(p.scan_candidates, outlinesByPlan.get(p.id) || []).length : 0,
  }));
  const ctx = { today, propertyHasPlans: plans.length > 0 };
  const placed = new Set<string>();
  const finish = (unit: Omit<PropertyUnit, "flags">): PropertyUnit => {
    if (unit.deal) placed.add(unit.deal.id);
    return { ...unit, flags: unitFlags(unit, ctx) };
  };

  // An archived row is history, not a unit, unless a live letting still hangs
  // off it: a letting is never hidden because its row was archived, and such
  // a unit says nothing about who occupies it.
  const units: PropertyUnit[] = spine.rows.flatMap(r => {
    const deal = dealOf(r, since);
    const stage = unitStage({ hasTracker: !!r.tracker_id, trackerStatus: r.marketing_status, dealStatus: r.deal_status, dealType: r.deal_type });
    if (r.archived && !stage && !deal) return [];
    const tradingName = text(r.trading_name), legalName = text(r.tenant_name);
    return [finish({
      id: r.id, scheduleRowId: r.id, trackerId: r.tracker_id || null,
      label: text(r.unit_number) || text(r.premises) || "Unnamed unit",
      floor: text(r.floor_level), grouping: text(r.grouping), use: text(r.permitted_use), scheduleStatus: text(r.status),
      tenant: { name: namedTenant(tradingName, legalName), tradingName, legalName, companyId: r.company_id || null, companyName: r.company_name || null },
      sqft: num(r.nia_sqft) ?? num(r.gia_sqft), passingRent: num(r.passing_rent_pa), erv: num(r.erv_pa), quotingRent: num(r.asking_rent),
      leaseStart: r.lease_start, leaseExpiry: r.lease_expiry, breakDate: r.break_date, landlordBreakDate: r.landlord_break_date, nextReview: r.next_review_date,
      occupancy: r.archived ? "unknown" : unitOccupancy(r),
      stage,
      deal,
      brief: briefStateOf(
        r.brief_id ? { id: r.brief_id, agreedAt: r.brief_agreed_at } : null,
        { signedLeasingAt: r.brief_signed_leasing_at, signedAmAt: r.brief_signed_am_at, drafted: !!r.agreed_brief_drafted }),
      counts: (r.tracker_id && tally.get(r.tracker_id)) || { viewings: 0, offers: 0, targets: 0 },
      outlines: outlinesByRow.get(r.id) || [],
    })];
  });

  // On the tracker, not on the schedule. A letting that has exchanged or
  // completed reads as occupied by the deal's tenant; one still running is a
  // vacant unit being let; a withdrawn one says nothing about the unit.
  for (const r of trackerOnly.rows) {
    const code = legacyToCode(r.deal_status);
    const live = !!r.deal_id && r.deal_live === true;
    const stage = unitStage({ hasTracker: true, trackerStatus: r.marketing_status, dealStatus: r.deal_status, dealType: r.deal_type });
    const let_ = !!code && ["EXC", "COM", "INV"].includes(code);
    const showTenant = let_ || stage === "HOT" || stage === "SOL";
    units.push(finish({
      id: `tracker:${r.tracker_id}`, scheduleRowId: null, trackerId: r.tracker_id,
      label: text(r.unit_name) || "Unnamed unit", floor: text(r.floor), grouping: null, use: text(r.use_class), scheduleStatus: null,
      tenant: { name: showTenant ? text(r.deal_tenant) : null, tradingName: null, legalName: null, companyId: null, companyName: null },
      sqft: num(r.sqft), passingRent: null, erv: null, quotingRent: num(r.asking_rent),
      leaseStart: null, leaseExpiry: null, breakDate: null, landlordBreakDate: null, nextReview: null,
      occupancy: let_ ? "occupied" : stage ? "vacant" : "unknown",
      stage,
      deal: live ? dealOf(r, since) : null,
      brief: briefStateOf(r.brief_id ? { id: r.brief_id, agreedAt: r.brief_agreed_at } : null, null),
      counts: tally.get(r.tracker_id) || { viewings: 0, offers: 0, targets: 0 },
      outlines: [],
    }));
  }

  units.sort((a, b) => Number(!a.scheduleRowId) - Number(!b.scheduleRowId) || naturally.compare(a.label, b.label) || a.id.localeCompare(b.id));
  // A deal on a listed unit (the unit's own, or another open deal on its row,
  // such as a rent review beside the letting) is not unplaced.
  const rowIds = new Set(spine.rows.map(r => r.id));
  for (const r of spine.rows) if (r.row_deal_id) placed.add(r.row_deal_id);
  const unplacedDeals = openDeals.rows.filter(d => !placed.has(d.deal_id) && !rowIds.has(d.tenancy_unit_id)).map(d => dealOf(d, since)!).filter(Boolean);
  return { property: { id: property.id, name: property.name }, plans, units, unplacedDeals, counts: propertyUnitCounts(units, plans) };
}

// Everything the unit panel shows for one unit beyond the feed's line: the
// rest of the schedule row, the tracker row with its latest viewings and
// offers, the brief's targets and where the unit is drawn. BGP's notes on a
// target and the brand's contact at a viewing stay with BGP staff.
export async function loadPropertyUnitDetail(db: Db, propertyId: string, unitId: string, viewer: { staff: boolean }, today: string = londonToday()): Promise<PropertyUnitDetail | null> {
  const feed = await loadPropertyUnits(db, propertyId, today);
  const unit = feed?.units.find(u => u.id === unitId || u.trackerId === unitId);
  if (!feed || !unit) return null;
  const [row, tracker, outlines] = await Promise.all([
    unit.scheduleRowId
      ? db.query(`SELECT t.term_years, t.outside_lt_act, t.break_type, t.break_details, t.break_notice, t.erv_profile, t.service_charge, t.insurance, t.rates_payable,
                         t.rateable_value, t.rent_psf, t.turnover_percent, t.nia_sqft, t.gia_sqft, t.itza_sqft, t.comments, t.leasing_comments, t.marketing_active, t.marketing_reason, t.updated_at
                    FROM tenancy_schedule_units t WHERE t.id = $1 AND t.property_id = $2`, [unit.scheduleRowId, propertyId])
      : Promise.resolve({ rows: [] as any[] }),
    unit.trackerId
      ? db.query(`SELECT id, marketing_status, asking_rent, rent_poa, lease_terms, available_date, marketing_start_date, show_on_website
                    FROM available_units WHERE id = $1 AND property_id = $2`, [unit.trackerId, propertyId])
      : Promise.resolve({ rows: [] as any[] }),
    unit.scheduleRowId
      ? db.query(`SELECT u.id, u.plan_id, u.label, p.floor FROM property_plan_units u JOIN property_plans p ON p.id = u.plan_id
                   WHERE p.property_id = $2 AND u.tenancy_unit_id = $1 ORDER BY p.display_order, p.floor, u.id`, [unit.scheduleRowId, propertyId])
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  const trackerRow = tracker.rows[0] || null;
  const [viewings, offers, brief, deals] = await Promise.all([
    trackerRow
      ? db.query(`SELECT id, company_name, contact_name, viewing_date, outcome, status FROM unit_viewings
                   WHERE unit_id = $1 AND deleted_at IS NULL ORDER BY viewing_date DESC NULLS LAST, id LIMIT 8`, [trackerRow.id])
      : Promise.resolve({ rows: [] as any[] }),
    trackerRow
      ? db.query(`SELECT id, company_name, offer_date, rent_pa, rent_free_months, term_years, status FROM unit_offers
                   WHERE unit_id = $1 AND COALESCE(status, '') <> 'Closed' ORDER BY offer_date DESC NULLS LAST, id LIMIT 8`, [trackerRow.id])
      : Promise.resolve({ rows: [] as any[] }),
    trackerRow
      ? db.query(`SELECT b.id, b.title, b.agreed_at,
                         COALESCE((SELECT json_agg(json_build_object('id', x.id, 'name', x.operator_name, 'companyId', x.company_id, 'status', x.status, 'priority', x.priority)
                                                   ORDER BY x.sort_order NULLS LAST, x.operator_name)
                                     FROM unit_target_operators x WHERE x.brief_id = b.id), '[]'::json) AS targets
                    FROM unit_briefs b WHERE b.unit_id = $1 ORDER BY b.created_at DESC LIMIT 1`, [trackerRow.id])
      : Promise.resolve({ rows: [] as any[] }),
    // The same links the feed reads a unit's deal by (SPINE_SQL, TRACKER_ONLY_SQL).
    db.query(`SELECT ${DEAL_COLUMNS} FROM crm_deals d LEFT JOIN crm_companies dc ON dc.id = d.tenant_id
               WHERE ${LIVE_DEAL}
                 AND (($2::text IS NOT NULL AND (d.tenancy_unit_id = $2 OR d.id = (SELECT deal_id FROM tenancy_schedule_units WHERE id = $2 AND property_id = $1)))
                      OR ($3::text IS NOT NULL AND d.id = (SELECT deal_id FROM available_units WHERE id = $3 AND property_id = $1)))
               ORDER BY (d.deal_type IN (${lettingTypeSqlList()})) DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.id`, [propertyId, unit.scheduleRowId, unit.trackerId]),
  ]);
  const since = await stageSinceFor(deals.rows.map(d => d.deal_id), db);
  const r = row.rows[0] || null;
  const b = brief.rows[0] || null;
  return {
    unit,
    schedule: r ? {
      termYears: num(r.term_years), outsideLtAct: text(r.outside_lt_act), breakType: text(r.break_type), breakDetails: text(r.break_details), breakNotice: text(r.break_notice),
      reviewBasis: text(r.erv_profile), serviceCharge: num(r.service_charge), insurance: num(r.insurance), ratesPayable: num(r.rates_payable), rateableValue: num(r.rateable_value),
      rentPsf: num(r.rent_psf), turnoverPercent: num(r.turnover_percent), niaSqft: num(r.nia_sqft), giaSqft: num(r.gia_sqft), itzaSqft: num(r.itza_sqft),
      comments: text(r.comments), leasingComments: text(r.leasing_comments),
    } : null,
    tracker: trackerRow ? {
      id: trackerRow.id, quotingRent: num(trackerRow.asking_rent), rentOnApplication: !!trackerRow.rent_poa, leaseTerms: text(trackerRow.lease_terms),
      availableDate: text(trackerRow.available_date), marketingStartDate: text(trackerRow.marketing_start_date), onWebsite: !!trackerRow.show_on_website,
      viewings: viewings.rows.map(v => ({ id: v.id, company: text(v.company_name), contact: viewer.staff ? text(v.contact_name) : null, date: text(v.viewing_date), outcome: text(v.outcome), status: text(v.status) })),
      offers: offers.rows.map(o => ({ id: o.id, company: text(o.company_name), date: text(o.offer_date), rentPa: num(o.rent_pa), rentFreeMonths: num(o.rent_free_months), termYears: num(o.term_years), status: text(o.status) })),
    } : null,
    brief: b ? {
      id: b.id, title: text(b.title), agreed: !!b.agreed_at,
      targets: (b.targets || []).map((x: any) => ({ id: x.id, name: text(x.name) || "Unnamed brand", companyId: x.companyId || null, status: text(x.status), priority: text(x.priority) })),
    } : null,
    deals: deals.rows.map(d => dealOf(d, since)!).filter(Boolean),
    outlines: outlines.rows.map(o => ({ planId: o.plan_id, outlineId: o.id, floor: o.floor, label: text(o.label) })),
  };
}

const router = Router();

router.get("/api/properties/:propertyId/units", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.params.propertyId);
    if (await propertyReadBlocked(req, propertyId)) return res.status(403).json({ error: "Not available for this account" });
    const feed = await loadPropertyUnits(pool, propertyId);
    if (!feed) return res.status(404).json({ error: "Property not found" });
    res.json(feed);
  } catch (error: any) {
    console.error("[/api/properties/:id/units]", error?.message);
    res.status(500).json({ error: "Could not load this property's units" });
  }
});

router.get("/api/properties/:propertyId/units/:unitId", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.params.propertyId);
    if (await propertyReadBlocked(req, propertyId)) return res.status(403).json({ error: "Not available for this account" });
    const staff = !(await resolveCompanyScope(req));
    const detail = await loadPropertyUnitDetail(pool, propertyId, String(req.params.unitId), { staff });
    if (!detail) return res.status(404).json({ error: "Unit not found on this property" });
    res.json(detail);
  } catch (error: any) {
    console.error("[/api/properties/:id/units/:unitId]", error?.message);
    res.status(500).json({ error: "Could not load this unit" });
  }
});

export default router;
