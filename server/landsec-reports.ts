// Landsec reports (Woody, 2026-11-19, after a call with Mark Warne at
// Landsec: the reports Landsec takes from VTS should come from the app;
// "quarters just have ability to pick one or several months"; who runs them:
// "yes landsec and BGP"). The period rule and the list of reports are
// shared/landsec-reports.ts; this file builds each one.
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
import fs from "fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { contentDispositionFor } from "./utils/http-headers";
import { landsecViewer, viewerCanSeeScheme, type LandsecViewer } from "./landsec-access";
import { resolveLandsecPortfolio } from "./landsec-schemes";
import { propertyReadBlocked, unitViewerFor, loadPropertyUnits, unitsForViewer } from "./property-units";
import { landsecDealsFeed } from "./landsec-unit";
import { listLeasingViewings } from "./leasing-viewings";
import { categoryMixByProperty, sumCategoryMixes } from "./landsec-home";
import { A4, MARGIN, wrapText } from "./unit-info-sheet";
import { UNIT_OCCUPANCY_LABELS, type PropertyUnit } from "@shared/property-units";
import { statusLabelsFor } from "@shared/letting-rules";
import { legacyToCode, CLOSED_STATUSES } from "@shared/deal-status";
import { statusLineIsMoveSql } from "@shared/stage-since";
import { LANDSEC_CATEGORIES, landsecCategoryLabel, landsecCategoryOf, type LandsecCategoryOrOther } from "@shared/landsec";
import { isLettingType } from "@shared/letting-rules";
import { STAGE_BULK_PEERS } from "@shared/stage-since";
import { requirementReason } from "@shared/requirement-live";
import {
  LANDSEC_REPORT_PALETTE, LANDSEC_REPORTS, REPORT_MAX_MONTHS, defaultReportMonths, inReportPeriod, landsecReportByKey, landsecReportFileName, parseReportPeriod, reportDay,
  type LandsecReportDef, type LandsecReportsIndex, type ReportPeriod,
} from "@shared/landsec-reports";

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
export const shortDay = (day: string | null): string => {
  if (!day) return "";
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
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

function unitRow(scheme: ReportScheme, u: PropertyUnit) {
  return {
    scheme: scheme.name, unit: u.label, floor: u.floor, use: u.use,
    brand: brandOf(u), tradingName: text(u.tenant.name), leaseName: text(u.tenant.legalName),
    sqft: u.sqft, passingRent: u.passingRent, erv: u.erv, quotingRent: u.quotingRent,
    leaseStart: u.leaseStart, leaseExpiry: u.leaseExpiry, tenantBreak: u.breakDate, landlordBreak: u.landlordBreakDate, nextReview: u.nextReview,
    occupancy: UNIT_OCCUPANCY_LABELS[u.occupancy], lettingStage: stageLabel(u.stage),
    lettingRef: u.deal?.ref ?? null, lettingTenant: text(u.deal?.tenant),
  };
}
type UnitRow = ReturnType<typeof unitRow>;

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
async function activityRows(ctx: Ctx): Promise<ActivityRow[]> {
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

interface RollYear { year: number; expiries: number; expirySqft: number | null; expiryRent: number | null; breaks: number; breakSqft: number | null; breakRent: number | null }
function leaseRoll(rows: UnitRow[]): RollYear[] {
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

// ── The PDFs ─────────────────────────────────────────────────────────────

// Text the standard PDF fonts can draw: anything outside Latin-1 becomes a space.
const pdfSafe = (v: unknown): string =>
  String(v ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "-")
    .replace(/\s+/g, " ").replace(/[^\x20-\x7E\xA0-\xFF]/g, " ").trim();

// The Landsec report palette as PDF colours (shared/landsec-reports.ts says where it came from).
const colour = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const NAVY = colour(LANDSEC_REPORT_PALETTE.navy), PALE = colour(LANDSEC_REPORT_PALETTE.paleBlue), SAND = colour(LANDSEC_REPORT_PALETTE.sand), GOLD = colour(LANDSEC_REPORT_PALETTE.gold);
const TEXT = colour(LANDSEC_REPORT_PALETTE.text), MUTED = colour(LANDSEC_REPORT_PALETTE.muted), WHITE = rgb(1, 1, 1);

// Landsec's own logo (the mark above the word, from its website footer):
// white for the navy band, near-black for a white page. The only logo a
// Landsec report carries. A file that cannot be read means no logo: nothing
// is drawn in its place and none is ever typeset.
export function landsecLogoBytes(kind: "light" | "dark"): Uint8Array | null {
  const file = kind === "light" ? "landsec-logo-light.png" : "landsec-logo-dark.png";
  for (const p of [`${process.cwd()}/server/assets/${file}`, `${process.cwd()}/dist/server/assets/${file}`]) {
    try { if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p)); } catch {}
  }
  return null;
}

export interface PdfCol { header: string; width: number; align?: "left" | "right" }
export interface Pdf {
  heading(text: string): void;
  /** Start a new page unless this one is still empty; with `need`, only when fewer than that many points are left on it. */
  pageBreak(need?: number): void;
  para(text: string, quiet?: boolean): void;
  figures(items: Array<[string, string]>): void;
  table(columns: PdfCol[], rows: string[][], empty: string): void;
  gap(h: number): void;
  bytes(): Promise<Uint8Array>;
}

/** A Landsec report as an A4 document: a navy band with Landsec's logo, then headings, figures and tables that break across pages. */
export async function pdfDocument(title: string, subtitle: string, ctx: Ctx, landscape: boolean, titleSize = 20): Promise<Pdf> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const size: [number, number] = landscape ? [A4[1], A4[0]] : A4;
  const [pw, ph] = size;
  const side = landscape ? 40 : MARGIN;
  const contentW = pw - side * 2;
  const FOOT = 46;
  doc.setTitle(pdfSafe(subtitle ? `${title}: ${subtitle}` : title));
  doc.setAuthor("Bruce Gillingham Pollard");
  const markLight = landsecLogoBytes("light"), markDark = landsecLogoBytes("dark");
  const logoLight: PDFImage | null = markLight ? await doc.embedPng(markLight) : null;
  const logoDark: PDFImage | null = markDark ? await doc.embedPng(markDark) : null;
  const drawMark = (pg: PDFPage, img: PDFImage | null, x: number, y: number, h: number) => { if (img) pg.drawImage(img, { x, y, width: (img.width / img.height) * h, height: h }); };
  const label = (pg: PDFPage, words: string, x: number, y: number, s: number, color = MUTED, align: "left" | "right" = "left") => {
    const t = pdfSafe(words).toUpperCase();
    const space = s * 0.14;
    const width = bold.widthOfTextAtSize(t, s) + space * Math.max(0, t.length - 1);
    let cx = align === "right" ? x - width : x;
    for (const ch of t) { pg.drawText(ch, { x: cx, y, size: s, font: bold, color }); cx += bold.widthOfTextAtSize(ch, s) + space; }
  };

  // Page one: the band.
  let page = doc.addPage(size);
  const bandH = 92;
  page.drawRectangle({ x: 0, y: ph - bandH, width: pw, height: bandH, color: NAVY });
  page.drawRectangle({ x: 0, y: ph - bandH - 2, width: pw, height: 2, color: GOLD });
  // The logo sits at the right of the band; the title and the period at the left.
  const logoH = 58;
  if (logoLight) drawMark(page, logoLight, pw - side - (logoLight.width / logoLight.height) * logoH, ph - bandH + (bandH - logoH) / 2, logoH);
  const sub = pdfSafe(subtitle);
  page.drawText(pdfSafe(title), { x: side, y: sub ? ph - 48 : ph - 54, size: titleSize, font: serif, color: WHITE });
  if (sub) page.drawText(sub, { x: side, y: ph - 68, size: 10.5, font, color: WHITE });
  let y = ph - bandH - 20;

  let repeat: (() => void) | null = null;
  const newPage = () => {
    page = doc.addPage(size);
    drawMark(page, logoDark, side, ph - 50, 28);
    label(page, subtitle ? `${title} · ${subtitle}` : title, pw - side, ph - 36, 7, MUTED, "right");
    y = ph - 62;
    if (repeat) repeat();
  };
  const room = (h: number) => { if (y - h < FOOT) newPage(); };
  const cut = (words: string, f: PDFFont, s: number, width: number): string[] => {
    const out: string[] = [];
    for (const line of wrapText(pdfSafe(words), f, s, width)) {
      let rest = line;
      while (f.widthOfTextAtSize(rest, s) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && f.widthOfTextAtSize(rest.slice(0, n), s) > width) n--;
        out.push(rest.slice(0, n)); rest = rest.slice(n);
      }
      out.push(rest);
    }
    return out.length ? out : [""];
  };

  const api: Pdf = {
    gap(h) { y -= h; },
    pageBreak(need) { if (y < ph - 140 && (need == null || y - need < FOOT)) { const hold = repeat; repeat = null; newPage(); repeat = hold; } },
    heading(words) {
      const hold = repeat; repeat = null;
      room(60);
      repeat = hold;
      y -= 12;
      page.drawText(pdfSafe(words), { x: side, y: y - 12, size: 12.5, font: bold, color: NAVY });
      y -= 18;
      page.drawLine({ start: { x: side, y }, end: { x: pw - side, y }, thickness: 0.8, color: PALE });
      y -= 8;
    },
    para(words, quiet) {
      for (const line of cut(words, font, 9.5, contentW)) {
        room(13.5);
        page.drawText(line, { x: side, y: y - 9.5, size: 9.5, font, color: quiet ? MUTED : TEXT });
        y -= 13.5;
      }
    },
    figures(items) {
      if (!items.length) return;
      const perRow = landscape ? 6 : 4;
      for (let i = 0; i < items.length; i += perRow) {
        const row = items.slice(i, i + perRow);
        room(54);
        const w = contentW / perRow;
        row.forEach(([name, value], j) => {
          const x = side + j * w;
          page.drawRectangle({ x, y: y - 46, width: w - 8, height: 46, color: PALE });
          page.drawText(pdfSafe(value) || "-", { x: x + 8, y: y - 22, size: 15, font: serif, color: NAVY });
          label(page, name, x + 8, y - 38, 6.5, TEXT);
        });
        y -= 54;
      }
    },
    table(columns, rows, empty) {
      const total = columns.reduce((n, c) => n + c.width, 0);
      const widths = columns.map(c => (c.width / total) * contentW);
      const pad = 4, s = 8, lh = 10.5;
      const head = () => {
        page.drawRectangle({ x: side, y: y - 18, width: contentW, height: 18, color: NAVY });
        let x = side;
        columns.forEach((c, i) => {
          const t = pdfSafe(c.header);
          const tx = c.align === "right" ? x + widths[i] - pad - bold.widthOfTextAtSize(t, 7.5) : x + pad;
          page.drawText(t, { x: tx, y: y - 12.5, size: 7.5, font: bold, color: WHITE });
          x += widths[i];
        });
        y -= 18;
      };
      room(18 + lh + 8);
      head();
      if (rows.length === 0) {
        page.drawText(pdfSafe(empty), { x: side + pad, y: y - 13, size: 9, font, color: MUTED });
        y -= 22;
        return;
      }
      repeat = head;
      rows.forEach((cells, r) => {
        const wrapped = cells.map((c, i) => cut(c, font, s, widths[i] - pad * 2).slice(0, 4));
        const h = Math.max(...wrapped.map(w => w.length)) * lh + 6;
        if (y - h < FOOT) newPage();
        if (r % 2 === 1) page.drawRectangle({ x: side, y: y - h, width: contentW, height: h, color: PALE, opacity: 0.45 });
        let x = side;
        wrapped.forEach((linesOf, i) => {
          linesOf.forEach((line, k) => {
            const tx = columns[i].align === "right" ? x + widths[i] - pad - font.widthOfTextAtSize(line, s) : x + pad;
            page.drawText(line, { x: tx, y: y - 4 - s - k * lh, size: s, font, color: TEXT });
          });
          x += widths[i];
        });
        y -= h;
      });
      repeat = null;
      y -= 8;
    },
    async bytes() {
      const pages = doc.getPages();
      let foot = pdfSafe(`Made in ChatBGP on ${longDay(ctx.madeAt)} by ${ctx.madeBy}. It holds what is recorded in ChatBGP on that day.`);
      while (foot.length > 20 && font.widthOfTextAtSize(foot, 7) > contentW - 60) foot = foot.slice(0, -1);
      pages.forEach((pg, i) => {
        pg.drawLine({ start: { x: side, y: 34 }, end: { x: pw - side, y: 34 }, thickness: 0.8, color: SAND });
        pg.drawText(foot, { x: side, y: 22, size: 7, font, color: MUTED });
        const n = `${i + 1} of ${pages.length}`;
        pg.drawText(n, { x: pw - side - font.widthOfTextAtSize(n, 7), y: 22, size: 7, font, color: MUTED });
      });
      return doc.save();
    },
  };
  return api;
}

async function activityPdf(ctx: Ctx): Promise<Uint8Array> {
  const rows = await activityRows(ctx);
  const pdf = await pdfDocument("Leasing activity", ctx.period.label, ctx, true);
  const live = rows.filter(r => r.live === "Live");
  const at = (code: string) => live.filter(r => r.stageCode === code).length;
  pdf.figures([
    ["Live lettings", count(live.length)],
    ...["AVA", "NEG", "HOT", "SOL"].map((code): [string, string] => [stageLabel(code) || code, count(at(code))]),
    ["Moved in period", count(rows.filter(r => r.movedInPeriod).length)],
  ]);
  pdf.para(`Schemes: ${ctx.schemes.map(s => s.name).join(", ")}.`, true);
  pdf.para("Live lettings as the Deals page lists them today, then the deals that changed stage in the period and have since closed. A greyed day count in the app is marked here as not confirmed.", true);
  const columns: PdfCol[] = [
    { header: "Unit", width: 13 }, { header: "Brand or deal", width: 15 }, { header: "Ref", width: 5, align: "right" }, { header: "Stage", width: 10 },
    { header: "Days at stage", width: 11 }, { header: "Waiting on", width: 15 }, { header: "Quoting pa", width: 9, align: "right" }, { header: "Deal rent pa", width: 9, align: "right" },
    { header: "NER pa", width: 9, align: "right" }, { header: "Brief check", width: 11 }, { header: "Dates held", width: 19 },
  ];
  const quiet: string[] = [];
  for (const scheme of ctx.schemes) {
    const mine = rows.filter(r => r.scheme === scheme.name);
    // A scheme with nothing to show is named once at the end, not given an empty table.
    if (mine.length === 0 && ctx.schemes.length > 1) { quiet.push(scheme.name); continue; }
    pdf.heading(scheme.name);
    pdf.table(columns, mine.map(r => [
      r.unit || "", r.brand || r.deal || "", r.ref != null ? String(r.ref) : "", [r.stage, r.live === "Closed" ? "(closed)" : ""].filter(Boolean).join(" "),
      r.daysAtStage == null ? "" : `${r.daysAtStage}${r.daysDate === "No" ? " (date not confirmed)" : ""}`,
      r.waitingOn || "", money(r.quotingRent), money(r.dealRent), money(r.ner), r.briefCheck || "",
      [r.instructed ? `Instructed ${shortDay(r.instructed)}` : "", r.hotsIssued ? `HoTs ${shortDay(r.hotsIssued)}` : "", r.exchanged ? `Exchanged ${shortDay(r.exchanged)}` : "",
        r.completed ? `Completed ${shortDay(r.completed)}` : "", r.movedInPeriod ? `Moved ${shortDay(r.movedInPeriod)}` : ""].filter(Boolean).join("; "),
    ]), "No live letting, and no deal changed stage in the period.");
  }
  if (quiet.length) {
    pdf.heading("Nothing to report");
    pdf.para(`No live letting, and no deal changed stage in the period, at: ${quiet.join(", ")}.`, true);
  }
  return pdf.bytes();
}

async function assetProfilePdf(ctx: Ctx): Promise<Uint8Array> {
  const scheme = ctx.schemes[0];
  const [{ units }] = await unitsFor(ctx);
  const rows = units.map(u => unitRow(scheme, u));
  const pdf = await pdfDocument(scheme.name, "Asset profile", ctx, false);
  const sqft = (list: PropertyUnit[]) => total(list.map(u => u.sqft));
  const occupied = units.filter(u => u.occupancy === "occupied"), vacant = units.filter(u => u.occupancy === "vacant"), unknown = units.filter(u => u.occupancy === "unknown");
  const totalSqft = sqft(units);
  const rent = total(units.map(u => u.passingRent));
  pdf.figures([
    ["Units", count(units.length)], ["Occupied", count(occupied.length)], ["Vacant", count(vacant.length)],
    ["Sq ft recorded", count(totalSqft) || "Not recorded"], ["Passing rent pa", money(rent) || "Not recorded"], ["Live lettings", count(units.filter(u => !!u.stage).length)],
  ]);

  pdf.heading("The asset");
  pdf.table([{ header: "Fact", width: 30 }, { header: "", width: 70 }], [
    ["Scheme", scheme.name], ["Town", scheme.town], ["Group", scheme.group],
    ["Property records", scheme.properties.map(p => p.name).join("; ") || "None on the app"],
    ["As at", longDay(ctx.madeAt)],
  ], "");

  pdf.heading("Occupancy");
  const share = (n: number | null, of: number | null) => (n != null && of ? `${Math.round((n / of) * 100)}%` : "");
  pdf.table([{ header: "", width: 34 }, { header: "Units", width: 14, align: "right" }, { header: "Share of units", width: 18, align: "right" }, { header: "Sq ft", width: 16, align: "right" }, { header: "Share of sq ft", width: 18, align: "right" }], [
    ["Occupied", count(occupied.length), share(occupied.length, units.length), count(sqft(occupied)), share(sqft(occupied), totalSqft)],
    ["Vacant", count(vacant.length), share(vacant.length, units.length), count(sqft(vacant)), share(sqft(vacant), totalSqft)],
    ["Not recorded", count(unknown.length), share(unknown.length, units.length), count(sqft(unknown)), share(sqft(unknown), totalSqft)],
  ], "");
  if (units.length === 0) pdf.para("No units are recorded on this scheme's tenancy schedule.", true);

  pdf.heading("Trading units by brief category");
  const mixes = await categoryMixByProperty(scheme.properties.map(p => p.id)).catch(() => null);
  if (!mixes) pdf.para("The category count could not be read.", true);
  else {
    const mix = sumCategoryMixes(scheme.properties.map(p => mixes.get(p.id)));
    const lines: string[][] = [];
    for (const c of LANDSEC_CATEGORIES) if (mix.counts[c.key]) lines.push([c.label, c.group, count(mix.counts[c.key])]);
    if (mix.counts.other) lines.push([landsecCategoryLabel("other") || "Other", "", count(mix.counts.other)]);
    if (mix.notLinked) lines.push(["No brand", "", count(mix.notLinked)]);
    pdf.table([{ header: "Category", width: 46 }, { header: "Group", width: 34 }, { header: "Trading units", width: 20, align: "right" }], lines, "No trading units are recorded.");
    if (mix.byName) pdf.para(`${count(mix.byName)} of these ${mix.byName === 1 ? "was" : "were"} matched to a brand by name.`, true);
  }

  pdf.heading("Lease roll by year");
  pdf.table([
    { header: "Year", width: 12 }, { header: "Expiries", width: 13, align: "right" }, { header: "Expiring sq ft", width: 17, align: "right" }, { header: "Expiring rent pa", width: 19, align: "right" },
    { header: "Breaks", width: 11, align: "right" }, { header: "Break sq ft", width: 13, align: "right" }, { header: "Break rent pa", width: 15, align: "right" },
  ], leaseRoll(rows).map(r => [String(r.year), count(r.expiries), count(r.expirySqft), money(r.expiryRent), count(r.breaks), count(r.breakSqft), money(r.breakRent)]),
  "No lease expiry or break is recorded.");

  pdf.heading("Live lettings by stage");
  const lettings = units.filter(u => !!u.stage);
  const order = ["OPP", "AVA", "NEG", "HOT", "SOL"];
  pdf.figures(order.filter(code => code !== "OPP" || lettings.some(u => u.stage === "OPP")).map((code): [string, string] => [stageLabel(code) || code, count(lettings.filter(u => u.stage === code).length)]));
  // A long run of units that are only being marketed is counted above and
  // listed in the Tenancy schedule report, not here.
  const early = lettings.filter(u => u.stage === "OPP" || u.stage === "AVA");
  const listed = early.length > 12 ? lettings.filter(u => !early.includes(u)) : lettings;
  if (listed.length < lettings.length) pdf.para(`${count(early.length)} units are being marketed with no negotiation yet. They are listed in the Tenancy schedule report.`, true);
  pdf.gap(4);
  pdf.table([{ header: "Unit", width: 22 }, { header: "In the unit now", width: 22 }, { header: "Stage", width: 14 }, { header: "Letting to", width: 20 }, { header: "Ref", width: 7, align: "right" }, { header: "Days at stage", width: 15 }],
    listed.sort((a, b) => order.indexOf(b.stage!) - order.indexOf(a.stage!) || (b.deal?.days ?? -1) - (a.deal?.days ?? -1)).map(u => [
      u.label, u.occupancy === "occupied" ? brandOf(u) || "" : UNIT_OCCUPANCY_LABELS[u.occupancy], stageLabel(u.stage) || "", u.deal?.tenant || "", u.deal?.ref != null ? String(u.deal.ref) : "",
      u.deal?.days == null ? "" : `${u.deal.days}${u.deal.daysConfirmed ? "" : " (date not confirmed)"}`,
    ]), lettings.length ? "No letting has reached negotiation." : "No letting is running at this scheme.");
  return pdf.bytes();
}

// ── Routes ───────────────────────────────────────────────────────────────

const REFUSED = { message: "Reports are for Landsec and BGP logins." };

async function nameOf(req: Request): Promise<string> {
  const userId = req.session?.userId || (req as any).tokenUserId;
  if (!userId) return "ChatBGP";
  const row = (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]).catch(() => ({ rows: [] as any[] }))).rows[0];
  return text(row?.name) || "ChatBGP";
}

/** One report as a file. Exported so it can be run without a browser. */
export async function buildLandsecReport(def: LandsecReportDef, ctx: Omit<Ctx, "cache">, viewer: LandsecViewer): Promise<Buffer> {
  const full: Ctx = { ...ctx, cache: new Map() };
  switch (def.key) {
    case "board-report": return (await import("./landsec-board-report")).boardReportPdf(full, viewer);
    case "board-report-figures": return (await import("./landsec-board-report")).boardReportWorkbook(def, full, viewer);
    case "tenancy-schedule": return workbookOf(def, full, await tenancySheets(full));
    case "leasing-activity": return workbookOf(def, full, await activitySheets(full));
    case "leasing-activity-pdf": return Buffer.from(await activityPdf(full));
    case "space-activity": return workbookOf(def, full, await spaceSheets(full));
    case "tour-activity": return workbookOf(def, full, await tourSheets(full, viewer));
    case "requirements": return workbookOf(def, full, await requirementSheets());
    case "comps": return workbookOf(def, full, await compSheets(full));
    case "asset-profile": return Buffer.from(await assetProfilePdf(full));
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

  // One report: ?from=YYYY-MM&to=YYYY-MM&schemes=key,key
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
      const file = await buildLandsecReport(def, { req, schemes, period: parsed.period, madeBy: await nameOf(req), madeAt: new Date() }, viewer);
      const name = landsecReportFileName(def, parsed.period, def.schemes === "one" ? schemes[0].name : null);
      res.setHeader("Content-Type", def.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
