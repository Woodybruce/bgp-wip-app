// Landsec reports (Woody, 2026-11-19, after a call with Mark Warne at
// Landsec: the reports Landsec takes from VTS should come from the app;
// "quarters just have ability to pick one or several months"; who runs them:
// "yes landsec and BGP"). The period rule and the list of reports are
// shared/landsec-reports.ts; this file reads the feeds, builds the Excel data
// exports and serves every report. The three reports to present are slide
// decks (Woody, 2026-11-19: "we dont need complicated excels just visual PDF
// which can also be power point"): what is on their slides is
// shared/landsec-decks.ts, gathered by server/landsec-decks.ts and drawn as a
// PDF or a PowerPoint by server/landsec-deck-pdf.ts and -pptx.ts.
//
// THE RULE: THE SAME FEEDS AS THE PAGES.
//  - Units come from the property page's unit feed (loadPropertyUnits, cut by
//    unitsForViewer for whoever asks, behind propertyReadBlocked).
//  - Deals come from the deal clock feed the Deals page reads
//    (landsecDealsFeed).
//  - Viewings come from the viewings list, read as a Landsec login reads it.
//  - Requirements come from the Requirements list, worded for a client
//    (requirementReason(...).clientText).
//  - Comparables come from the Comps list, cut to the schemes.
//  - Trading units by brief category come from the Schemes cards' own count.
// The one query of its own (dealDatesFor) reads a deal's dates and when it
// last moved stage, by name, and nothing else.
//
// Every row is built key by key from a named list. What BGP earns, how it is
// shared, BGP's own remarks on a record, who at BGP runs it, its mail and its
// compliance working are never named here, so they reach no report for any
// viewer. qa/regression/landsec-reports-guards.test.mjs fails the build if
// one of those field names appears in this file.
//
// Who may run one: BGP staff (all 14 schemes) and a Landsec login (the schemes
// on the login). A joint agent is refused at the gateway
// (jointAgentApiDenied) and again here.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { contentDispositionFor } from "./utils/http-headers";
import { landsecViewer, viewerCanSeeScheme, type LandsecViewer } from "./landsec-access";
import { resolveLandsecPortfolio } from "./landsec-schemes";
import { propertyReadBlocked, unitViewerFor, loadPropertyUnits, unitsForViewer } from "./property-units";
import { landsecDealsFeed } from "./landsec-unit";
import { listLeasingViewings } from "./leasing-viewings";
import { UNIT_OCCUPANCY_LABELS, type PropertyUnit } from "@shared/property-units";
import { statusLabelsFor } from "@shared/letting-rules";
import { legacyToCode, CLOSED_STATUSES } from "@shared/deal-status";
import { statusLineIsMoveSql } from "@shared/stage-since";
import { landsecCategoryOf, type LandsecCategoryOrOther } from "@shared/landsec";
import { isLettingType } from "@shared/letting-rules";
import { STAGE_BULK_PEERS } from "@shared/stage-since";
import { requirementReason } from "@shared/requirement-live";
import {
  LANDSEC_REPORT_PALETTE, LANDSEC_REPORTS, REPORT_MAX_MONTHS, defaultReportMonths, inReportPeriod, landsecReportByKey, landsecReportFileName, parseReportPeriod, reportDay, shortReportDay,
  type LandsecReportDef, type LandsecReportsIndex, type ReportPeriod,
} from "@shared/landsec-reports";
import { DECK_MIME, deckFormat, type DeckFileFormat } from "@shared/landsec-deck";

// ── Who is asking, and for which schemes ─────────────────────────────────

export interface ReportScheme { key: string; name: string; town: string; group: string; properties: Array<{ id: string; name: string }> }

/** The schemes this viewer may report on: every scheme for BGP staff and a Landsec login with none ticked, else the ticked ones. */
export async function reportSchemesFor(viewer: LandsecViewer): Promise<ReportScheme[]> {
  const portfolio = await resolveLandsecPortfolio(viewer.companyId);
  return portfolio.schemes.filter(s => viewerCanSeeScheme(viewer, s.key))
    .map(s => ({ key: s.key, name: s.name, town: s.town, group: s.group, properties: s.properties.map(p => ({ id: p.id, name: p.name })) }));
}

/** The schemes asked for, out of those allowed. A key the viewer may not see, or that is no scheme, is simply not there. None asked = all allowed. */
export function pickSchemes(allowed: ReportScheme[], asked: unknown): ReportScheme[] {
  const keys = String(Array.isArray(asked) ? asked.join(",") : asked ?? "").split(",").map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return allowed;
  const want = new Set(keys);
  return allowed.filter(s => want.has(s.key));
}

/** A joint agent, or anyone who is not Landsec or BGP, runs no report. */
export async function reportViewer(req: Request): Promise<LandsecViewer | null> {
  const viewer = await landsecViewer(req);
  if (!viewer || viewer.role === "joint_agent") return null;
  return viewer;
}

export interface Ctx {
  req: Request;
  schemes: ReportScheme[];
  period: ReportPeriod;
  madeBy: string;
  madeAt: Date;
  cache: Map<string, Promise<any>>;
}
const once = <T,>(ctx: Ctx, key: string, load: () => Promise<T>): Promise<T> => {
  if (!ctx.cache.has(key)) ctx.cache.set(key, load());
  return ctx.cache.get(key) as Promise<T>;
};

// ── Small helpers ────────────────────────────────────────────────────────

export const text = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s ? s : null; };
export const num = (v: unknown): number | null => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const figure = (v: unknown): number | null => {
  // A figure typed as words ("£95,000 pa", "2,400 sq ft"): the first number in it.
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const yearOf = (day: string | null): number | null => (day ? Number(day.slice(0, 4)) : null);
// A day typed on a comparable: only a full date is read as one ("Q1 2024" and "March 2024" stay as typed).
const typedDay = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  return uk ? `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}` : null;
};
const list = (v: unknown): string | null => (Array.isArray(v) ? v.map(x => String(x ?? "").trim()).filter(Boolean).join(", ") || null : text(v));
export const stageLabel = (code: string | null | undefined, dealType?: string | null): string | null =>
  code ? (statusLabelsFor(dealType ?? "New Letting") as Record<string, string>)[code] || code : null;
export const longDay = (d: Date): string => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
// "2 Sep 2026": always a three-letter month.
export const shortDay = (day: string | null): string => shortReportDay(day);
export const money = (v: number | null | undefined): string => (v == null ? "" : `£${Math.round(v).toLocaleString("en-GB")}`);
export const count = (v: number | null | undefined): string => (v == null ? "" : Math.round(v).toLocaleString("en-GB"));
// A total of figures that are recorded: blank, not zero, when none is.
export const total = (values: Array<number | null | undefined>): number | null => {
  const held = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return held.length ? held.reduce((n, v) => n + v, 0) : null;
};

// ── The feeds ────────────────────────────────────────────────────────────

export interface SchemeUnits { scheme: ReportScheme; units: PropertyUnit[] }

/** Every unit at the chosen schemes, as the property page's unit feed gives them to this viewer. */
export function unitsFor(ctx: Ctx): Promise<SchemeUnits[]> {
  return once(ctx, "units", async () => {
    const viewer = await unitViewerFor(ctx.req);
    const out: SchemeUnits[] = [];
    for (const scheme of ctx.schemes) {
      const units: PropertyUnit[] = [];
      for (const property of scheme.properties) {
        if (await propertyReadBlocked(ctx.req, property.id)) continue;
        const feed = await loadPropertyUnits(pool, property.id);
        if (feed) units.push(...unitsForViewer(feed, viewer).units);
      }
      out.push({ scheme, units });
    }
    return out;
  });
}

/** The deal clock feed's rows at the chosen schemes. */
export function clockFor(ctx: Ctx): Promise<any[]> {
  return once(ctx, "clock", async () => {
    const feed = await landsecDealsFeed(ctx.req);
    const keys = new Set(ctx.schemes.map(s => s.key));
    return (feed?.deals || []).filter((d: any) => d.scheme && keys.has(d.scheme.key));
  });
}

/** A day in a deal's history: `confirmed` is false when the same minute stamped 5 or more other deals (shared/stage-since.ts). */
export interface HistoryDay { day: string; confirmed: boolean }
export interface DealDates {
  id: string; ref: number | null; name: string | null; status: string | null; dealType: string | null; propertyId: string;
  tenant: string | null; tenantId: string | null; category: LandsecCategoryOrOther | null; unit: string | null; rentPa: number | null;
  /** The unit's schedule row and Letting Tracker row, to find it in the unit feed. */
  scheduleRowId: string | null; trackerId: string | null;
  /** A letting by its type, or because it has a Letting Tracker row. */
  letting: boolean;
  instructed: string | null; hotsIssued: string | null; exchanged: string | null; completed: string | null; movedInPeriod: string | null;
  /** The day the deal was added to the app (not confirmed when it came in with a bulk load), and its first move to each stage in its history. */
  created: HistoryDay | null;
  firstMove: Partial<Record<"AVA" | "HOT" | "EXC" | "COM", HistoryDay>>;
}

/**
 * The dates held on each deal at the chosen schemes, and the day it last
 * moved stage inside the period. The one query this file makes for itself:
 * named columns, dates and the stage only.
 */
export function dealDatesFor(ctx: Ctx): Promise<DealDates[]> {
  return once(ctx, "dealDates", async () => {
    const ids = ctx.schemes.flatMap(s => s.properties.map(p => p.id));
    if (ids.length === 0) return [];
    const london = (column: string) => `(${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date`;
    const londonDaySql = london("a.created_at");
    const rows = (await pool.query(
      `/* landsec-reports:deal-dates */
       WITH moves AS (
         SELECT a.deal_id, a.new_value, a.created_at, date_trunc('minute', a.created_at) AS stamped
           FROM deal_audit_log a
          WHERE a.field = 'status' AND ${statusLineIsMoveSql("a")}
            AND a.deal_id IN (SELECT p.id FROM crm_deals p WHERE p.property_id = ANY($1))
       ), stamps AS (
         SELECT date_trunc('minute', o.created_at) AS stamped, COUNT(DISTINCT o.deal_id)::int AS deals
           FROM deal_audit_log o
          WHERE o.field = 'status' AND ${statusLineIsMoveSql("o")}
            AND date_trunc('minute', o.created_at) IN (SELECT m.stamped FROM moves m)
          GROUP BY 1
       )
       SELECT d.id, d.deal_ref, d.name, d.status, d.deal_type, d.property_id, d.rent_pa, d.tenant_id,
              d.instructed_at, d.exchanged_at, d.completed_at,
              to_char(${london("d.created_at")}, 'YYYY-MM-DD') AS created_day,
              (SELECT COUNT(*)::int FROM crm_deals c WHERE c.id <> d.id AND date_trunc('minute', c.created_at) = date_trunc('minute', d.created_at)) AS created_with,
              tc.name AS tenant_name, tc.company_type AS tenant_type, COALESCE(t.premises, t.unit_number, au.unit_name) AS unit_name,
              t.id AS schedule_row_id, au.id AS tracker_id,
              CASE WHEN au.deal_id = d.id THEN au.hots_issued_at END AS hots_issued_at,
              (SELECT json_agg(json_build_object('to', m.new_value, 'day', to_char(${london("m.created_at")}, 'YYYY-MM-DD'), 'with', GREATEST(COALESCE(s.deals, 1) - 1, 0)) ORDER BY m.created_at)
                 FROM moves m LEFT JOIN stamps s ON s.stamped = m.stamped WHERE m.deal_id = d.id) AS moves,
              (SELECT MAX(a.created_at) FROM deal_audit_log a
                WHERE a.deal_id = d.id AND a.field = 'status' AND ${statusLineIsMoveSql("a")}
                  AND ${londonDaySql} >= $2::date AND ${londonDaySql} < $3::date) AS moved_at
         FROM crm_deals d
         LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
         LEFT JOIN LATERAL (
           SELECT u.id, u.deal_id, u.unit_name, u.tenancy_unit_id, u.hots_issued_at FROM available_units u
            WHERE u.property_id = ANY($1) AND (u.deal_id = d.id OR (d.tenancy_unit_id IS NOT NULL AND u.tenancy_unit_id = d.tenancy_unit_id))
            ORDER BY (u.deal_id = d.id) DESC NULLS LAST, u.updated_at DESC NULLS LAST
            LIMIT 1
         ) au ON TRUE
         LEFT JOIN tenancy_schedule_units t ON t.id = COALESCE(d.tenancy_unit_id, au.tenancy_unit_id) AND t.property_id = ANY($1)
        WHERE d.property_id = ANY($1) AND d.status IS NOT NULL`,
      [ids, ctx.period.start, ctx.period.end])).rows;
    return rows.map((r: any): DealDates => {
      // The first time the deal's history shows it moving to each stage.
      const firstMove: DealDates["firstMove"] = {};
      for (const m of Array.isArray(r.moves) ? r.moves : []) {
        const code = legacyToCode(m?.to);
        if ((code === "AVA" || code === "HOT" || code === "EXC" || code === "COM") && m?.day && !firstMove[code]) {
          firstMove[code] = { day: String(m.day), confirmed: Number(m.with || 0) < STAGE_BULK_PEERS };
        }
      }
      return {
        id: r.id, ref: r.deal_ref ?? null, name: text(r.name), status: text(r.status), dealType: text(r.deal_type), propertyId: r.property_id,
        tenant: text(r.tenant_name), tenantId: text(r.tenant_id), category: r.tenant_id ? landsecCategoryOf(r.tenant_type) : null, unit: text(r.unit_name), rentPa: num(r.rent_pa),
        scheduleRowId: text(r.schedule_row_id), trackerId: text(r.tracker_id), letting: isLettingType(r.deal_type) || !!r.tracker_id,
        instructed: reportDay(r.instructed_at), hotsIssued: reportDay(r.hots_issued_at), exchanged: reportDay(r.exchanged_at), completed: reportDay(r.completed_at),
        movedInPeriod: reportDay(r.moved_at),
        created: r.created_day ? { day: String(r.created_day), confirmed: Number(r.created_with || 0) < STAGE_BULK_PEERS } : null,
        firstMove,
      };
    });
  });
}

// ── Rows, each built from a named list ───────────────────────────────────

export const brandOf = (u: PropertyUnit): string | null => text(u.tenant.companyName) || text(u.tenant.name);

export function unitRow(scheme: ReportScheme, u: PropertyUnit) {
  return {
    scheme: scheme.name, unit: u.label, floor: u.floor, use: u.use,
    brand: brandOf(u), tradingName: text(u.tenant.name), leaseName: text(u.tenant.legalName),
    sqft: u.sqft, passingRent: u.passingRent, erv: u.erv, quotingRent: u.quotingRent,
    leaseStart: u.leaseStart, leaseExpiry: u.leaseExpiry, tenantBreak: u.breakDate, landlordBreak: u.landlordBreakDate, nextReview: u.nextReview,
    occupancy: UNIT_OCCUPANCY_LABELS[u.occupancy], lettingStage: stageLabel(u.stage),
    lettingRef: u.deal?.ref ?? null, lettingTenant: text(u.deal?.tenant),
  };
}
export type UnitRow = ReturnType<typeof unitRow>;

const BRIEF_CHECK_WORDS: Record<string, string> = { pass: "Meets the floor", fail: "Below the NER floor", unchecked: "Not checked: incentives not recorded" };

export interface ActivityRow {
  scheme: string; unit: string | null; brand: string | null; ref: number | null; deal: string | null; dealType: string | null; jointAgent: string | null;
  stage: string | null; stageCode: string | null; live: string; daysAtStage: number | null; daysDate: string | null; atStageSince: string | null;
  waitingOn: string | null; waitingSince: string | null;
  quotingRent: number | null; dealRent: number | null; ner: number | null; briefCheck: string | null;
  instructed: string | null; hotsIssued: string | null; exchanged: string | null; completed: string | null; movedInPeriod: string | null;
}

/**
 * Leasing activity: every deal the clock feed lists at the chosen schemes
 * (the live ones), then the deals that changed stage in the period and are
 * no longer live (exchanged on, completed, withdrawn).
 */
export async function activityRows(ctx: Ctx): Promise<ActivityRow[]> {
  const [clock, dates, units] = await Promise.all([clockFor(ctx), dealDatesFor(ctx), unitsFor(ctx)]);
  const datesById = new Map(dates.map(d => [d.id, d]));
  const schemeOfProperty = new Map<string, ReportScheme>();
  for (const s of ctx.schemes) for (const p of s.properties) schemeOfProperty.set(p.id, s);
  const quoting = new Map<string, number | null>();
  for (const s of units) for (const u of s.units) {
    if (u.trackerId) quoting.set(`t:${u.trackerId}`, u.quotingRent);
    if (u.scheduleRowId) quoting.set(`s:${u.scheduleRowId}`, u.quotingRent);
  }
  const out: ActivityRow[] = [];
  const seen = new Set<string>();
  for (const d of clock) {
    seen.add(d.id);
    const held = datesById.get(d.id);
    const waiting = d.clock ? [text(d.clock.waitingOnName), text(d.clock.waitingOnParty)].filter(Boolean) : [];
    out.push({
      scheme: d.scheme.name, unit: text(d.unit), brand: text(d.tenant), ref: d.ref ?? null, deal: text(d.name), dealType: text(d.dealType), jointAgent: text(d.jointAgent),
      stage: stageLabel(d.code, d.dealType), stageCode: d.code || null, live: "Live", daysAtStage: d.days ?? null,
      daysDate: d.days == null ? null : d.stageConfirmed === false ? "No" : "Yes",
      atStageSince: reportDay(d.since),
      waitingOn: waiting.length ? Array.from(new Set(waiting)).join(", ") : null, waitingSince: reportDay(d.clock?.waitingSince),
      quotingRent: (d.trackerId ? quoting.get(`t:${d.trackerId}`) : undefined) ?? (d.unitId ? quoting.get(`s:${d.unitId}`) : undefined) ?? null,
      dealRent: held?.rentPa ?? null, ner: num(d.ner?.nerPa), briefCheck: d.briefCheck ? BRIEF_CHECK_WORDS[d.briefCheck] || null : null,
      instructed: held?.instructed ?? null, hotsIssued: held?.hotsIssued ?? null, exchanged: held?.exchanged ?? null, completed: held?.completed ?? null,
      movedInPeriod: held?.movedInPeriod ?? null,
    });
  }
  for (const d of dates) {
    if (seen.has(d.id)) continue;
    const code = legacyToCode(d.status);
    if (!code) continue;
    const moved = d.movedInPeriod
      || (inReportPeriod(d.completed, ctx.period) ? d.completed : null)
      || (inReportPeriod(d.exchanged, ctx.period) ? d.exchanged : null);
    if (!moved) continue;
    const scheme = schemeOfProperty.get(d.propertyId);
    if (!scheme) continue;
    out.push({
      scheme: scheme.name, unit: d.unit, brand: d.tenant, ref: d.ref, deal: d.name, dealType: d.dealType, jointAgent: null,
      stage: stageLabel(code, d.dealType), stageCode: code, live: (CLOSED_STATUSES as string[]).includes(code) ? "Closed" : "Live", daysAtStage: null, daysDate: null, atStageSince: null,
      waitingOn: null, waitingSince: null, quotingRent: null, dealRent: d.rentPa, ner: null, briefCheck: null,
      instructed: d.instructed, hotsIssued: d.hotsIssued, exchanged: d.exchanged, completed: d.completed, movedInPeriod: moved,
    });
  }
  return out.sort((a, b) => a.scheme.localeCompare(b.scheme) || (a.live === b.live ? 0 : a.live === "Live" ? -1 : 1) || (b.daysAtStage ?? -1) - (a.daysAtStage ?? -1));
}

async function tourRows(ctx: Ctx, viewer: LandsecViewer) {
  const schemeOfProperty = new Map<string, ReportScheme>();
  for (const s of ctx.schemes) for (const p of s.properties) schemeOfProperty.set(p.id, s);
  // Read as a Landsec login reads the viewings list, whoever asks: the
  // company, and the properties of the chosen schemes.
  const viewings = await listLeasingViewings({ companyId: viewer.companyId, propertyIds: new Set(schemeOfProperty.keys()), jointAgent: false });
  return viewings
    .filter(v => v.propertyId && schemeOfProperty.has(v.propertyId) && inReportPeriod(v.viewingDate, ctx.period))
    .map(v => ({
      date: reportDay(v.viewingDate), time: text(v.viewingTime), scheme: schemeOfProperty.get(v.propertyId!)!.name, unit: text(v.unitName), sqft: num(v.sqft),
      brand: text(v.companyName), status: text(v.status), outcome: text(v.outcome), nextStep: text(v.nextAction), followUp: reportDay(v.followUpDate),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || "").localeCompare(String(b.time || "")));
}

async function requirementRows() {
  const rows = await storage.getCrmRequirementsLeasing({});
  const open = rows.filter((r: any) => requirementReason(r).state !== "closed");
  const ids = Array.from(new Set(open.map((r: any) => r.companyId).filter(Boolean)));
  const names = new Map<string, string>();
  if (ids.length) {
    const found = await pool.query(`SELECT id, name FROM crm_companies WHERE id = ANY($1::varchar[]) AND archived_at IS NULL AND merged_into_id IS NULL`, [ids]);
    for (const c of found.rows) names.set(c.id, c.name);
  }
  return open.map((r: any) => ({
    brand: (r.companyId && names.get(r.companyId)) || text(r.name), requirement: text(r.name),
    use: list(r.use), type: list(r.requirementType), size: list(r.size), places: list(r.requirementLocations),
    // What a client login reads of the record: what it is and its own date.
    record: requirementReason(r).clientText,
  })).sort((a, b) => String(a.brand || "").localeCompare(String(b.brand || "")));
}

async function compRows(ctx: Ctx) {
  const comps = await storage.getCrmComps({});
  const byId = new Map<string, ReportScheme>();
  const byName: Array<{ name: string; scheme: ReportScheme }> = [];
  for (const s of ctx.schemes) for (const p of s.properties) {
    byId.set(p.id, s);
    const n = String(p.name || "").toLowerCase().replace(/,.*$/, "").trim();
    if (n.length >= 5) byName.push({ name: n, scheme: s });
  }
  const out: Array<Record<string, unknown>> = [];
  for (const c of comps as any[]) {
    // The Comps list's own test for a client's schemes: the comp's property
    // record, else (older comps) the scheme named in its name or address.
    let scheme = c.propertyId ? byId.get(c.propertyId) : undefined;
    if (!scheme) {
      const hay = `${c.name || ""} ${JSON.stringify(c.address || "")}`.toLowerCase();
      scheme = byName.find(n => hay.includes(n.name))?.scheme;
    }
    if (!scheme) continue;
    const completed = typedDay(c.completionDate);
    out.push({
      scheme: scheme.name, comp: text(c.name), tenant: text(c.tenant), dealType: text(c.dealType || c.transactionType), useClass: text(c.useClass),
      areaSqft: figure(c.areaSqft ?? c.niaSqft), itzaSqft: figure(c.itzaSqft),
      headlineRent: figure(c.headlineRent), zoneA: figure(c.zoneARatePsf ?? c.zoneARate), overallPsf: figure(c.overallRatePsf ?? c.overallRate ?? c.rentPsfOverall),
      netEffectiveRent: figure(c.netEffectiveRent), rentFree: text(c.rentFreeMonths ?? c.rentFree), capital: text(c.fitoutContribution ?? c.capex),
      term: text(c.term), breakClause: text(c.breakClause), leaseStart: typedDay(c.leaseStart) || text(c.leaseStart), leaseExpiry: typedDay(c.leaseExpiry) || text(c.leaseExpiry),
      completed: completed || text(c.completionDate), inPeriod: completed && inReportPeriod(completed, ctx.period) ? "Yes" : "",
      verified: c.verified ? "Yes" : "",
    });
  }
  return out.sort((a, b) => String(a.scheme).localeCompare(String(b.scheme)) || String(b.completed || "").localeCompare(String(a.completed || "")));
}

export interface RollYear { year: number; expiries: number; expirySqft: number | null; expiryRent: number | null; breaks: number; breakSqft: number | null; breakRent: number | null }
export function leaseRoll(rows: UnitRow[]): RollYear[] {
  const years = new Map<number, RollYear>();
  const at = (year: number) => {
    if (!years.has(year)) years.set(year, { year, expiries: 0, expirySqft: null, expiryRent: null, breaks: 0, breakSqft: null, breakRent: null });
    return years.get(year)!;
  };
  for (const r of rows) {
    const e = yearOf(r.leaseExpiry), b = yearOf(r.tenantBreak) ?? yearOf(r.landlordBreak);
    if (e) { const y = at(e); y.expiries += 1; y.expirySqft = total([y.expirySqft, r.sqft]); y.expiryRent = total([y.expiryRent, r.passingRent]); }
    if (b) { const y = at(b); y.breaks += 1; y.breakSqft = total([y.breakSqft, r.sqft]); y.breakRent = total([y.breakRent, r.passingRent]); }
  }
  return Array.from(years.values()).sort((a, b) => a.year - b.year);
}

// ── Sheets ───────────────────────────────────────────────────────────────

export type Kind = "text" | "money" | "int" | "date" | "rate" | "pct";
export interface Col { header: string; key: string; width: number; kind?: Kind }
export interface Sheet { name: string; columns: Col[]; rows: Array<Record<string, unknown>>; caption?: string; totals?: Record<string, unknown> }

const UNIT_COLS: Col[] = [
  { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 22 }, { header: "Floor", key: "floor", width: 12 },
  { header: "Brand", key: "brand", width: 26 }, { header: "Lease name", key: "leaseName", width: 30 },
  { header: "Sq ft", key: "sqft", width: 10, kind: "int" }, { header: "Passing rent pa", key: "passingRent", width: 16, kind: "money" }, { header: "ERV pa", key: "erv", width: 14, kind: "money" },
  { header: "Lease start", key: "leaseStart", width: 13, kind: "date" }, { header: "Lease expiry", key: "leaseExpiry", width: 13, kind: "date" },
  { header: "Tenant break", key: "tenantBreak", width: 13, kind: "date" }, { header: "Landlord break", key: "landlordBreak", width: 14, kind: "date" },
  { header: "Next review", key: "nextReview", width: 13, kind: "date" },
  { header: "Occupancy", key: "occupancy", width: 13 }, { header: "Letting stage", key: "lettingStage", width: 14 },
];
const ACTIVITY_COLS: Col[] = [
  { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 20 }, { header: "Brand", key: "brand", width: 24 },
  { header: "Ref", key: "ref", width: 8, kind: "int" }, { header: "Deal type", key: "dealType", width: 15 },
  { header: "Stage", key: "stage", width: 14 }, { header: "Live or closed", key: "live", width: 13 },
  { header: "Days at stage", key: "daysAtStage", width: 12, kind: "int" }, { header: "Stage date confirmed", key: "daysDate", width: 18 },
  { header: "At stage since", key: "atStageSince", width: 14, kind: "date" },
  { header: "Waiting on", key: "waitingOn", width: 26 }, { header: "Waiting since", key: "waitingSince", width: 13, kind: "date" },
  { header: "Quoting rent pa", key: "quotingRent", width: 15, kind: "money" }, { header: "Rent on the deal pa", key: "dealRent", width: 17, kind: "money" },
  { header: "Net effective rent pa", key: "ner", width: 18, kind: "money" }, { header: "Brief check", key: "briefCheck", width: 24 },
  { header: "Instructed", key: "instructed", width: 13, kind: "date" }, { header: "HoTs issued", key: "hotsIssued", width: 13, kind: "date" },
  { header: "Exchanged", key: "exchanged", width: 13, kind: "date" }, { header: "Completed", key: "completed", width: 13, kind: "date" },
  { header: "Changed stage in period", key: "movedInPeriod", width: 21, kind: "date" }, { header: "Joint agent", key: "jointAgent", width: 20 },
];

export const sheetName = (name: string, taken: Set<string>): string => {
  const base = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let out = base, n = 2;
  while (taken.has(out.toLowerCase())) { const tail = ` ${n++}`; out = `${base.slice(0, 31 - tail.length)}${tail}`; }
  taken.add(out.toLowerCase());
  return out;
};

async function tenancySheets(ctx: Ctx): Promise<Sheet[]> {
  const all = await unitsFor(ctx);
  const taken = new Set<string>(["about", "summary"]);
  const summary: Sheet = {
    name: "Summary",
    columns: [
      { header: "Scheme", key: "scheme", width: 26 }, { header: "Units", key: "units", width: 9, kind: "int" }, { header: "Occupied", key: "occupied", width: 10, kind: "int" },
      { header: "Vacant", key: "vacant", width: 9, kind: "int" }, { header: "Not recorded", key: "unknown", width: 13, kind: "int" },
      { header: "Live lettings", key: "live", width: 13, kind: "int" }, { header: "Sq ft", key: "sqft", width: 12, kind: "int" }, { header: "Passing rent pa", key: "rent", width: 16, kind: "money" },
    ],
    rows: all.map(s => ({
      scheme: s.scheme.name, units: s.units.length, occupied: s.units.filter(u => u.occupancy === "occupied").length, vacant: s.units.filter(u => u.occupancy === "vacant").length,
      unknown: s.units.filter(u => u.occupancy === "unknown").length, live: s.units.filter(u => !!u.stage).length,
      sqft: total(s.units.map(u => u.sqft)), rent: total(s.units.map(u => u.passingRent)),
    })),
  };
  const sum = (key: string) => total(summary.rows.map(r => r[key] as number | null));
  summary.totals = { scheme: "All schemes", units: sum("units"), occupied: sum("occupied"), vacant: sum("vacant"), unknown: sum("unknown"), live: sum("live"), sqft: sum("sqft"), rent: sum("rent") };
  return [summary, ...all.map(s => ({ name: sheetName(s.scheme.name, taken), columns: UNIT_COLS, rows: s.units.map(u => unitRow(s.scheme, u)) }))];
}

async function activitySheets(ctx: Ctx): Promise<Sheet[]> {
  const rows = await activityRows(ctx);
  return [{ name: "Leasing activity", columns: ACTIVITY_COLS, rows: rows as unknown as Array<Record<string, unknown>>,
    caption: "Live lettings as the Deals page lists them today, then the deals that changed stage in the period and have since closed." }];
}

async function spaceSheets(ctx: Ctx): Promise<Sheet[]> {
  const all = await unitsFor(ctx);
  const rows = all.flatMap(s => s.units.map(u => unitRow(s.scheme, u)));
  const events = rows.filter(r => r.leaseExpiry || r.tenantBreak || r.landlordBreak).map(r => ({
    ...r, expiryYear: yearOf(r.leaseExpiry), breakYear: yearOf(r.tenantBreak) ?? yearOf(r.landlordBreak),
    inPeriod: [r.leaseExpiry, r.tenantBreak, r.landlordBreak].some(d => inReportPeriod(d, ctx.period)) ? "Yes" : "",
  })).sort((a, b) => String(a.leaseExpiry || a.tenantBreak || a.landlordBreak).localeCompare(String(b.leaseExpiry || b.tenantBreak || b.landlordBreak)));
  return [
    {
      name: "By year",
      columns: [
        { header: "Year", key: "year", width: 8 }, { header: "Expiries", key: "expiries", width: 10, kind: "int" }, { header: "Expiring sq ft", key: "expirySqft", width: 14, kind: "int" },
        { header: "Expiring rent pa", key: "expiryRent", width: 16, kind: "money" }, { header: "Breaks", key: "breaks", width: 9, kind: "int" },
        { header: "Break sq ft", key: "breakSqft", width: 12, kind: "int" }, { header: "Break rent pa", key: "breakRent", width: 14, kind: "money" },
      ],
      rows: leaseRoll(rows) as unknown as Array<Record<string, unknown>>,
      caption: "A unit with both a tenant's and a landlord's break is counted once, in the year of the tenant's.",
    },
    {
      name: "Lease events",
      columns: [
        { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 22 }, { header: "Brand", key: "brand", width: 26 },
        { header: "Sq ft", key: "sqft", width: 10, kind: "int" }, { header: "Passing rent pa", key: "passingRent", width: 16, kind: "money" },
        { header: "Lease expiry", key: "leaseExpiry", width: 13, kind: "date" }, { header: "Expiry year", key: "expiryYear", width: 11 },
        { header: "Tenant break", key: "tenantBreak", width: 13, kind: "date" }, { header: "Landlord break", key: "landlordBreak", width: 14, kind: "date" }, { header: "Break year", key: "breakYear", width: 10 },
        { header: "Next review", key: "nextReview", width: 13, kind: "date" }, { header: "In period", key: "inPeriod", width: 10 },
        { header: "Occupancy", key: "occupancy", width: 13 }, { header: "Letting stage", key: "lettingStage", width: 14 },
        { header: "Letting ref", key: "lettingRef", width: 10, kind: "int" }, { header: "Letting to", key: "lettingTenant", width: 24 },
      ],
      rows: events,
    },
  ];
}

async function tourSheets(ctx: Ctx, viewer: LandsecViewer): Promise<Sheet[]> {
  return [{
    name: "Tour activity",
    columns: [
      { header: "Date", key: "date", width: 13, kind: "date" }, { header: "Time", key: "time", width: 8 }, { header: "Scheme", key: "scheme", width: 24 },
      { header: "Unit", key: "unit", width: 22 }, { header: "Sq ft", key: "sqft", width: 10, kind: "int" }, { header: "Brand", key: "brand", width: 26 },
      { header: "Status", key: "status", width: 13 }, { header: "Outcome", key: "outcome", width: 22 }, { header: "Next step", key: "nextStep", width: 30 },
      { header: "Follow up by", key: "followUp", width: 13, kind: "date" },
    ],
    rows: await tourRows(ctx, viewer),
  }];
}

async function requirementSheets(): Promise<Sheet[]> {
  return [{
    name: "Requirements",
    columns: [
      { header: "Brand", key: "brand", width: 28 }, { header: "Requirement", key: "requirement", width: 30 }, { header: "Use", key: "use", width: 22 },
      { header: "Type", key: "type", width: 18 }, { header: "Size", key: "size", width: 20 }, { header: "Places", key: "places", width: 40 }, { header: "Record", key: "record", width: 34 },
    ],
    rows: await requirementRows(),
    caption: "Open leasing requirements. They are held by brand, not by scheme, so the scheme ticks do not cut this list.",
  }];
}

async function compSheets(ctx: Ctx): Promise<Sheet[]> {
  return [{
    name: "Comps",
    columns: [
      { header: "Scheme", key: "scheme", width: 24 }, { header: "Comparable", key: "comp", width: 30 }, { header: "Tenant", key: "tenant", width: 24 },
      { header: "Deal type", key: "dealType", width: 14 }, { header: "Use class", key: "useClass", width: 11 },
      { header: "Area sq ft", key: "areaSqft", width: 11, kind: "int" }, { header: "ITZA sq ft", key: "itzaSqft", width: 11, kind: "int" },
      { header: "Headline rent pa", key: "headlineRent", width: 16, kind: "money" }, { header: "Zone A psf", key: "zoneA", width: 11, kind: "rate" },
      { header: "Overall psf", key: "overallPsf", width: 11, kind: "rate" }, { header: "Net effective rent pa", key: "netEffectiveRent", width: 18, kind: "money" },
      { header: "Rent free", key: "rentFree", width: 12 }, { header: "Capital contribution", key: "capital", width: 18 },
      { header: "Term", key: "term", width: 12 }, { header: "Break", key: "breakClause", width: 16 },
      { header: "Lease start", key: "leaseStart", width: 13, kind: "date" }, { header: "Lease expiry", key: "leaseExpiry", width: 13, kind: "date" },
      { header: "Completed", key: "completed", width: 13, kind: "date" }, { header: "Completed in period", key: "inPeriod", width: 17 }, { header: "Verified", key: "verified", width: 9 },
    ],
    rows: await compRows(ctx),
  }];
}

async function portfolioSheets(ctx: Ctx): Promise<Sheet[]> {
  const [all, activity] = await Promise.all([unitsFor(ctx), activityRows(ctx)]);
  const [tenancySummary] = await tenancySheets(ctx);
  const rows = all.flatMap(s => s.units.map(u => unitRow(s.scheme, u)));
  const groups = new Map(ctx.schemes.map(s => [s.name, s]));
  const assets: Sheet = {
    name: "Assets",
    columns: [{ header: "Scheme", key: "scheme", width: 26 }, { header: "Town", key: "town", width: 16 }, { header: "Group", key: "group", width: 10 }, ...tenancySummary.columns.slice(1)],
    rows: tenancySummary.rows.map(r => ({ ...r, town: groups.get(String(r.scheme))?.town, group: groups.get(String(r.scheme))?.group })),
    totals: tenancySummary.totals,
  };
  const tenants = new Map<string, { brand: string; units: number; sqft: number | null; rent: number | null; schemes: Set<string>; firstExpiry: string | null }>();
  for (const r of rows) {
    if (!r.brand || r.occupancy !== UNIT_OCCUPANCY_LABELS.occupied) continue;
    const key = r.brand.toLowerCase();
    const t = tenants.get(key) || { brand: r.brand, units: 0, sqft: null, rent: null, schemes: new Set<string>(), firstExpiry: null };
    t.units += 1; t.sqft = total([t.sqft, r.sqft]); t.rent = total([t.rent, r.passingRent]); t.schemes.add(r.scheme);
    if (r.leaseExpiry && (!t.firstExpiry || r.leaseExpiry < t.firstExpiry)) t.firstExpiry = r.leaseExpiry;
    tenants.set(key, t);
  }
  return [
    assets,
    { name: "Deals", columns: ACTIVITY_COLS.filter(c => c.key !== "movedInPeriod"), rows: activity.filter(a => a.live === "Live") as unknown as Array<Record<string, unknown>> },
    {
      name: "Spaces",
      columns: [
        { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 22 }, { header: "Floor", key: "floor", width: 12 }, { header: "Use", key: "use", width: 14 },
        { header: "Sq ft", key: "sqft", width: 10, kind: "int" }, { header: "Occupancy", key: "occupancy", width: 13 }, { header: "Brand", key: "brand", width: 26 },
        { header: "Letting stage", key: "lettingStage", width: 14 }, { header: "Quoting rent pa", key: "quotingRent", width: 15, kind: "money" }, { header: "ERV pa", key: "erv", width: 14, kind: "money" },
      ],
      rows,
    },
    {
      name: "Tenants",
      columns: [
        { header: "Brand", key: "brand", width: 28 }, { header: "Units", key: "units", width: 8, kind: "int" }, { header: "Sq ft", key: "sqft", width: 12, kind: "int" },
        { header: "Passing rent pa", key: "rent", width: 16, kind: "money" }, { header: "First lease expiry", key: "firstExpiry", width: 16, kind: "date" }, { header: "Schemes", key: "schemes", width: 60 },
      ],
      rows: Array.from(tenants.values()).sort((a, b) => (b.rent ?? -1) - (a.rent ?? -1) || a.brand.localeCompare(b.brand)).map(t => ({ ...t, schemes: Array.from(t.schemes).sort().join(", ") })),
      caption: "Occupied units only, by the brand on the tenancy schedule.",
    },
    {
      name: "Lease terms and options",
      columns: [
        { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 22 }, { header: "Brand", key: "brand", width: 26 }, { header: "Lease name", key: "leaseName", width: 30 },
        { header: "Passing rent pa", key: "passingRent", width: 16, kind: "money" }, { header: "Lease start", key: "leaseStart", width: 13, kind: "date" },
        { header: "Lease expiry", key: "leaseExpiry", width: 13, kind: "date" }, { header: "Tenant break", key: "tenantBreak", width: 13, kind: "date" },
        { header: "Landlord break", key: "landlordBreak", width: 14, kind: "date" }, { header: "Next review", key: "nextReview", width: 13, kind: "date" },
      ],
      rows: rows.filter(r => r.leaseStart || r.leaseExpiry || r.tenantBreak || r.landlordBreak || r.nextReview),
    },
  ];
}

// ── The workbook ─────────────────────────────────────────────────────────

const HELD = "It holds what is recorded in ChatBGP on the day it was made. Nothing in it is estimated.";

export async function workbookOf(def: LandsecReportDef, ctx: Ctx, sheets: Sheet[], more: Array<[string, string]> = []): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ChatBGP";
  wb.created = ctx.madeAt;
  // The Landsec report palette: navy headers, sand banding.
  const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
  const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: argb(LANDSEC_REPORT_PALETTE.navy) } };
  const bandFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: argb(LANDSEC_REPORT_PALETTE.sand) } };
  const FORMATS: Partial<Record<Kind, string>> = { money: "£#,##0", int: "#,##0", date: "dd mmm yyyy", rate: "£#,##0.00", pct: '+0.0"%";-0.0"%";0.0"%"' };

  const about = wb.addWorksheet("About");
  about.columns = [{ key: "label", width: 22 }, { key: "value", width: 96 }];
  about.addRow({ label: `Landsec: ${def.title.replace(/\s*\(formatted\)$/i, "")}` }).font = { bold: true, size: 14, color: { argb: argb(LANDSEC_REPORT_PALETTE.navy) } };
  about.addRow({});
  const lines: Array<[string, string]> = [
    ["Period", ctx.period.label],
    ["How the period is used", def.period],
    ["Schemes", ctx.schemes.map(s => s.name).join(", ")],
    ["Made by", ctx.madeBy],
    ["Made on", longDay(ctx.madeAt)],
    ["Source", `ChatBGP. ${HELD}`],
    ["Sheets", sheets.map(s => s.name).join(", ")],
    ...more,
  ];
  for (const [label, value] of lines) {
    const row = about.addRow({ label, value });
    row.getCell("label").font = { bold: true };
    row.getCell("value").alignment = { wrapText: true, vertical: "top" };
    row.getCell("label").alignment = { vertical: "top" };
  }
  for (const s of sheets) if (s.caption) {
    const row = about.addRow({ label: s.name, value: s.caption });
    row.getCell("label").font = { bold: true };
    row.getCell("value").alignment = { wrapText: true, vertical: "top" };
    row.getCell("label").alignment = { vertical: "top" };
  }

  // A stored calendar day goes in as a real date, so Excel sorts and filters it.
  const cellValue = (kind: Kind | undefined, v: unknown): unknown => {
    if (v == null || v === "") return null;
    if (kind === "date") return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v;
    if (kind === "money" || kind === "int" || kind === "rate" || kind === "pct") { const n = Number(v); return Number.isFinite(n) ? n : v; }
    return v;
  };
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.columns = s.columns.map(c => ({ header: c.header, key: c.key, width: c.width }));
    const head = ws.getRow(1);
    head.eachCell(cell => { cell.fill = headerFill; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.alignment = { vertical: "middle", wrapText: true }; });
    head.height = 30;
    const write = (record: Record<string, unknown>) => {
      const row = ws.addRow(Object.fromEntries(s.columns.map(c => [c.key, cellValue(c.kind, record[c.key])])));
      for (const c of s.columns) {
        const cell = row.getCell(c.key);
        if (c.kind && FORMATS[c.kind] && (typeof cell.value === "number" || cell.value instanceof Date)) cell.numFmt = FORMATS[c.kind]!;
        if (c.kind === "date") cell.alignment = { horizontal: "left" };
      }
      return row;
    };
    s.rows.forEach((record, i) => { const row = write(record); if (i % 2 === 1) row.eachCell({ includeEmpty: true }, cell => { cell.fill = bandFill; }); });
    if (s.rows.length === 0) ws.addRow({ [s.columns[0].key]: "Nothing is recorded for this sheet." }).font = { italic: true };
    if (s.totals && s.rows.length) {
      const row = write(s.totals);
      row.font = { bold: true };
      row.eachCell({ includeEmpty: true }, cell => { cell.border = { top: { style: "thin" } }; });
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Routes ───────────────────────────────────────────────────────────────

const REFUSED = { message: "Reports are for Landsec and BGP logins." };

async function nameOf(req: Request): Promise<string> {
  const userId = req.session?.userId || (req as any).tokenUserId;
  if (!userId) return "ChatBGP";
  const row = (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  return text(row?.name) || "ChatBGP";
}

/** One report as a file. A deck is a PDF unless a PowerPoint is asked for. Exported so it can be run without a browser. */
export async function buildLandsecReport(def: LandsecReportDef, ctx: Omit<Ctx, "cache">, viewer: LandsecViewer, format: DeckFileFormat = "pdf"): Promise<Buffer> {
  const full: Ctx = { ...ctx, cache: new Map() };
  const deck = async (): Promise<Buffer> => {
    const slides = await (await import("./landsec-decks")).landsecDeck(def.key, full, viewer);
    return format === "pptx" ? (await import("./landsec-deck-pptx")).deckPptx(slides) : Buffer.from(await (await import("./landsec-deck-pdf")).deckPdf(slides));
  };
  switch (def.key) {
    case "board-report": return deck();
    case "board-report-figures": return (await import("./landsec-board-report")).boardReportWorkbook(def, full, viewer);
    case "tenancy-schedule": return workbookOf(def, full, await tenancySheets(full));
    case "leasing-activity": return workbookOf(def, full, await activitySheets(full));
    case "leasing-activity-pdf": return deck();
    case "space-activity": return workbookOf(def, full, await spaceSheets(full));
    case "tour-activity": return workbookOf(def, full, await tourSheets(full, viewer));
    case "requirements": return workbookOf(def, full, await requirementSheets());
    case "comps": return workbookOf(def, full, await compSheets(full));
    case "asset-profile": return deck();
    case "portfolio": return workbookOf(def, full, await portfolioSheets(full));
    default: throw new Error(`No builder for report ${def.key}`);
  }
}

export function setupLandsecReportRoutes(app: Express) {
  // What the Reports page needs before anything is exported.
  app.get("/api/landsec/reports", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      const schemes = await reportSchemesFor(viewer);
      const index: LandsecReportsIndex = {
        schemes: schemes.map(s => ({ key: s.key, name: s.name, group: s.group })),
        reports: LANDSEC_REPORTS, defaultPeriod: defaultReportMonths(), maxMonths: REPORT_MAX_MONTHS,
      };
      res.json(index);
    } catch (e: any) {
      console.error("[landsec-reports]", e?.message);
      res.status(500).json({ message: "The reports could not be loaded." });
    }
  });

  // One report: ?from=YYYY-MM&to=YYYY-MM&schemes=key,key, and for a deck &format=pptx for the PowerPoint
  app.get("/api/landsec/reports/:key", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      const def = landsecReportByKey(req.params.key);
      if (!def) return res.status(404).json({ message: "There is no report of that name." });
      const parsed = parseReportPeriod(req.query.from, req.query.to);
      if (!parsed.ok) return res.status(400).json({ message: parsed.error });
      const schemes = pickSchemes(await reportSchemesFor(viewer), req.query.schemes);
      if (schemes.length === 0) return res.status(400).json({ message: "Pick at least one scheme." });
      if (def.schemes === "one" && schemes.length !== 1) return res.status(400).json({ message: "This report is for one scheme. Pick the scheme on its card." });
      const format = deckFormat(req.query.format);
      if (!format || (format === "pptx" && !def.deck)) return res.status(400).json({ message: def.deck ? "A deck comes as a PDF or a PowerPoint." : "This export has one format." });
      const file = await buildLandsecReport(def, { req, schemes, period: parsed.period, madeBy: await nameOf(req), madeAt: new Date() }, viewer, format);
      const name = landsecReportFileName(def, parsed.period, def.schemes === "one" ? schemes[0].name : null, def.deck ? format : undefined);
      res.setHeader("Content-Type", def.deck ? DECK_MIME[format] : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Length", String(file.length));
      res.setHeader("Content-Disposition", contentDispositionFor(name, "attachment"));
      res.setHeader("Cache-Control", "private, no-store");
      res.end(file);
    } catch (e: any) {
      console.error("[landsec-reports]", req.params.key, e?.message);
      res.status(500).json({ message: "The report could not be made." });
    }
  });
}
