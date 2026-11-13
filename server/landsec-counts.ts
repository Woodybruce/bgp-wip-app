// One rule and one set of numbers for the Landsec view
// (docs/landsec-menu-plan-2026-11-12.md, part 7).
//
//   A Landsec property is a record matching one of the 14 schemes.
//   A Landsec deal is a deal on a Landsec property.
//   A live letting is a letting-type deal at Marketing, Negotiating, HOTs or
//   Solicitors, counted from the DEAL, never from the tracker row's own
//   status.
//
// landsecCounts feeds the scheme cards and totals of GET /api/landsec/home
// and is the count for any other Landsec header (Properties, the Deals cards,
// the tracker pills): do not count a second way on a screen. Days at stage
// come from the deal clock (stageSinceFor in server/landsec-unit.ts), not
// from when the deal was last edited.
//
// The Letting Tracker counts rows and Deals counts deals, so the two agree
// only when every live row has a live letting behind it and every live
// letting has a row. The count says where they do not; repair is the admin
// Preview then Apply (GET /api/admin/letting-integrity reports it).
import { pool } from "./db";
import { legacyToCode, CLOSED_STATUSES } from "@shared/deal-status";
import { isLettingType } from "@shared/letting-rules";
import {
  LANDSEC_LIVE_STAGES, LANDSEC_STUCK_STAGES, LANDSEC_STUCK_DAYS,
  type LandsecCount, type LandsecLiveStage,
} from "@shared/landsec";
import { stageSinceFor, daysSince } from "./landsec-unit";
import type { LandsecPortfolio } from "./landsec-schemes";

type Queryable = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

export interface LandsecCounts {
  total: LandsecCount;
  byProperty: Record<string, LandsecCount>;
}

export const emptyLandsecCount = (): LandsecCount => ({
  stages: { AVA: 0, NEG: 0, HOT: 0, SOL: 0 },
  liveLettings: 0, liveDeals: 0, stuck: 0, oldestStageDays: null,
  trackerRows: 0, rowsWithoutLetting: 0, lettingsWithoutRow: 0,
});

export function sumLandsecCounts(list: Array<LandsecCount | null | undefined>): LandsecCount {
  const out = emptyLandsecCount();
  for (const c of list) {
    if (!c) continue;
    for (const s of LANDSEC_LIVE_STAGES) out.stages[s] += c.stages[s];
    out.liveLettings += c.liveLettings;
    out.liveDeals += c.liveDeals;
    out.stuck += c.stuck;
    if (c.oldestStageDays !== null && (out.oldestStageDays === null || c.oldestStageDays > out.oldestStageDays)) out.oldestStageDays = c.oldestStageDays;
    out.trackerRows += c.trackerRows;
    out.rowsWithoutLetting += c.rowsWithoutLetting;
    out.lettingsWithoutRow += c.lettingsWithoutRow;
  }
  return out;
}

// True when the Letting Tracker and Deals would show different numbers.
export const trackerAndDealsDiffer = (c: LandsecCount) => c.rowsWithoutLetting > 0 || c.lettingsWithoutRow > 0;

const liveStage = (code: string | null): LandsecLiveStage | null =>
  code && (LANDSEC_LIVE_STAGES as readonly string[]).includes(code) ? (code as LandsecLiveStage) : null;

export async function landsecCounts(propertyIds: string[], db: Queryable = pool, now: Date = new Date()): Promise<LandsecCounts> {
  const ids = Array.from(new Set(propertyIds.filter(Boolean)));
  const byProperty: Record<string, LandsecCount> = {};
  for (const id of ids) byProperty[id] = emptyLandsecCount();
  if (ids.length === 0) return { total: emptyLandsecCount(), byProperty };

  const [deals, rows] = await Promise.all([
    db.query(
      `/* landsec-counts:deals */
       SELECT d.id, d.property_id, d.status, d.deal_type, d.stage_entered_at, d.created_at
         FROM crm_deals d
        WHERE d.property_id = ANY($1) AND d.status IS NOT NULL`, [ids]),
    db.query(
      `/* landsec-counts:tracker */
       SELECT au.id, au.property_id, au.marketing_status, au.deal_id, d.status AS deal_status
         FROM available_units au
         LEFT JOIN crm_deals d ON d.id = au.deal_id
        WHERE au.property_id = ANY($1)`, [ids]),
  ]);

  // A deal with no type that a tracker row points at is the tracker's own
  // backing deal: read as a letting, as the tracker reads it.
  const onTracker = new Set<string>(rows.rows.map((r: any) => r.deal_id).filter(Boolean));
  const lettings: Array<{ id: string; propertyId: string; stage: LandsecLiveStage }> = [];
  // Stuck and "oldest" are the deal clock's: EVERY open deal on the
  // properties at Negotiating, HOTs or Solicitors, a letting or not, which is
  // the set GET /api/landsec/deals sends and the Stuck pill on Deals counts.
  // Counting lettings only here made the Properties pill disagree with the
  // Deals list it opens.
  const inNegotiation: Array<{ id: string; propertyId: string; fallbackSince: any }> = [];
  for (const d of deals.rows) {
    const count = byProperty[d.property_id];
    if (!count) continue;
    const code = legacyToCode(d.status);
    if (!code || CLOSED_STATUSES.includes(code)) continue;
    count.liveDeals += 1;
    const stage = liveStage(code);
    if (stage && LANDSEC_STUCK_STAGES.includes(stage)) inNegotiation.push({ id: d.id, propertyId: d.property_id, fallbackSince: d.stage_entered_at || d.created_at });
    const letting = isLettingType(d.deal_type) || (!String(d.deal_type || "").trim() && onTracker.has(d.id));
    if (stage && letting) lettings.push({ id: d.id, propertyId: d.property_id, stage });
  }

  const counted = new Set<string>();
  for (const l of lettings) {
    const count = byProperty[l.propertyId];
    counted.add(l.id);
    count.stages[l.stage] += 1;
    count.liveLettings += 1;
    if (!onTracker.has(l.id)) count.lettingsWithoutRow += 1;
  }

  const since = await stageSinceFor(inNegotiation.map(d => d.id), db);
  for (const d of inNegotiation) {
    const count = byProperty[d.propertyId];
    const days = daysSince(since.get(d.id) || d.fallbackSince, now.getTime());
    if (days === null) continue;
    if (days >= LANDSEC_STUCK_DAYS) count.stuck += 1;
    if (count.oldestStageDays === null || days > count.oldestStageDays) count.oldestStageDays = days;
  }

  // The tracker's own count: a row shows its deal's status when it has one,
  // else its own marketing status, else Marketing (effByUnit on the tracker).
  for (const r of rows.rows) {
    const count = byProperty[r.property_id];
    if (!count) continue;
    if (!liveStage(legacyToCode(r.deal_status) || legacyToCode(r.marketing_status) || "AVA")) continue;
    count.trackerRows += 1;
    if (!r.deal_id || !counted.has(r.deal_id)) count.rowsWithoutLetting += 1;
  }

  return { total: sumLandsecCounts(Object.values(byProperty)), byProperty };
}

// What the 14-scheme rule would take out of the Landsec view if it were
// applied everywhere: the Landsec-linked property records outside the
// schemes, and every deal that reaches the Landsec view today (on one of
// those records, or through a Landsec company link) without sitting on a
// scheme property, plus the Letting Tracker rows on those records (a Landsec
// login's tracker lists them today). A report for BGP staff: nothing is removed. No fee
// figures, so it stays safe if a screen ever shows it more widely.
const OUTSIDE_LIST_CAP = 300;

export interface LandsecOutsideSchemes {
  properties: Array<{ id: string; name: string; units: number; deals: number; liveDeals: number; trackerRows: number }>;
  deals: Array<{
    id: string; ref: number | null; name: string | null; dealType: string | null; status: string | null; live: boolean;
    propertyId: string | null; propertyName: string | null;
    // "property": it sits on a Landsec record outside the schemes.
    // "company": Landsec is named on the deal, which is on another property or none.
    via: "property" | "company";
  }>;
  counts: { properties: number; deals: number; liveDeals: number; onOutsideProperties: number; byCompanyLink: number; listed: number; trackerRows: number };
}

export async function landsecOutsideSchemes(portfolio: LandsecPortfolio, db: Queryable = pool): Promise<LandsecOutsideSchemes> {
  const outsideIds = portfolio.outOfScope.map(p => p.id);
  const schemeIds = portfolio.schemes.flatMap(s => s.properties.map(p => p.id));
  const r = await db.query(
    `/* landsec-counts:outside */
     SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.property_id, p.name AS property_name
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE (d.property_id = ANY($2::text[])
             OR d.landlord_id = $1 OR d.tenant_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1
             OR d.id IN (SELECT deal_id FROM crm_company_deals WHERE company_id = $1))
        AND (d.property_id IS NULL OR NOT (d.property_id = ANY($3::text[])))
      ORDER BY p.name NULLS LAST, d.name`,
    [portfolio.companyId, outsideIds, schemeIds]);

  const tracker = new Map<string, number>();
  if (outsideIds.length > 0) {
    const t = await db.query(
      `/* landsec-counts:outside-tracker */
       SELECT property_id, COUNT(*)::int AS n FROM available_units WHERE property_id = ANY($1::text[]) GROUP BY property_id`, [outsideIds]);
    for (const row of t.rows) tracker.set(row.property_id, Number(row.n) || 0);
  }

  const outside = new Set(outsideIds);
  const livePerProperty = new Map<string, number>();
  const deals = r.rows.map((d: any) => {
    const code = legacyToCode(d.status);
    const live = !!code && !CLOSED_STATUSES.includes(code);
    const via: "property" | "company" = d.property_id && outside.has(d.property_id) ? "property" : "company";
    if (live && via === "property") livePerProperty.set(d.property_id, (livePerProperty.get(d.property_id) || 0) + 1);
    return { id: d.id, ref: d.deal_ref ?? null, name: d.name ?? null, dealType: d.deal_type ?? null, status: code || d.status || null, live,
      propertyId: d.property_id ?? null, propertyName: d.property_name ?? null, via };
  });
  const onOutside = deals.filter(d => d.via === "property").length;
  // Live deals first, so the cap never hides one behind closed history.
  const listed = [...deals.filter(d => d.live), ...deals.filter(d => !d.live)].slice(0, OUTSIDE_LIST_CAP);
  return {
    properties: portfolio.outOfScope.map(p => ({ id: p.id, name: p.name, units: p.units, deals: p.deals, liveDeals: livePerProperty.get(p.id) || 0, trackerRows: tracker.get(p.id) || 0 })),
    deals: listed,
    counts: {
      properties: outsideIds.length, deals: deals.length, liveDeals: deals.filter(d => d.live).length,
      onOutsideProperties: onOutside, byCompanyLink: deals.length - onOutside, listed: listed.length,
      trackerRows: Array.from(tracker.values()).reduce((n, v) => n + v, 0),
    },
  };
}
