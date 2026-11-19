// The Landsec board report (Woody, 2026-11-19, after a call with Mark Warne
// at Landsec: "board level reports to analyse activity across all schemes and
// report Brand engagements, letting activity, summary of the quarterly
// business review can generate report with the rental growth, deal speed").
// The tenth report: a PDF to present and an Excel of the figures behind it,
// for the months and schemes picked on the Reports page.
//
// The rules (which day counts, what is left out, rental growth, deal speed,
// brands by stage) are shared/landsec-board-report.ts. This file gathers the
// rows and lays them out.
//
// THE RULE: THE SAME FEEDS AS THE PAGES, as for every Landsec report.
//  - Lettings and their dates: the reports' one read of deal dates
//    (dealDatesFor in server/landsec-reports.ts).
//  - Units, occupancy, passing rent and ERV: the property page's unit feed,
//    cut for whoever asks (unitsFor).
//  - Live lettings by stage: the deal clock feed (clockFor).
//  - Viewings: the viewings list, read as a Landsec login reads it.
//  - Brand engagements: the Brand CRM plan read as a Landsec login reads it
//    (brandGrid and loadPlan with a Landsec viewer and the Landsec brand
//    slice), whoever asks: never a line BGP has not ticked to show Landsec.
//  - Offers: the one query of its own, by named column: the offer's day, its
//    brand, the property, and whether a person logged or confirmed it.
//  - The market report: only the text people saved (server/landsec-board-market.ts).
//
// Every row is built key by key. What BGP earns, how it is shared, BGP's own
// remarks on a record, who at BGP runs it, its mail and its compliance working
// are never named here. qa/regression/landsec-reports-guards.test.mjs holds
// this file to the same list of words as the other report builders.
import { pool } from "./db";
import { resolveLandsecPortfolio } from "./landsec-schemes";
import type { LandsecViewer } from "./landsec-access";
import { listLeasingViewings } from "./leasing-viewings";
import { brandGrid, loadPlan, planSchemes, type PlanViewer } from "./brand-scheme-plan";
import { clientBrandSliceSql } from "./company-scope";
import { loadBoardMarket } from "./landsec-board-market";
import {
  brandOf, clockFor, count, dealDatesFor, longDay, money, pdfDocument, shortDay, stageLabel, unitsFor, workbookOf,
  type Ctx, type PdfCol, type ReportScheme, type Sheet,
} from "./landsec-reports";
import type { PropertyUnit } from "@shared/property-units";
import { LANDSEC_CATEGORIES, landsecCategoryLabel, landsecCategoryOf, type LandsecCategoryOrOther } from "@shared/landsec";
import { reportDay, type LandsecReportDef } from "@shared/landsec-reports";
import { londonDay } from "@shared/stage-since";
import { BRAND_STAGE_LABELS } from "@shared/brand-stage";
import {
  BOARD_MARKET_SECTIONS, BOARD_REPORT_TITLE, boardActivity, brandEngagement, categoryRows, dealSpeed, rentalGrowth,
  type BoardActivity, type BoardBrandLine, type BoardCounts, type BoardDeal, type BoardMarket, type BoardOffer, type BoardViewing, type BrandEngagement, type DealSpeed, type RentalGrowth, type SpeedStat,
} from "@shared/landsec-board-report";

// ── What the pack is worked out from ─────────────────────────────────────

export interface BoardSchemeRow {
  key: string; name: string;
  units: number; occupied: number; vacant: number; unknown: number;
  /** Live lettings by stage code today, as the Deals page lists them. */
  live: Record<string, number>;
}

export interface BoardData {
  today: string;
  deals: BoardDeal[];
  activity: BoardActivity;
  growth: RentalGrowth;
  speed: DealSpeed;
  schemes: BoardSchemeRow[];
  /** The Brand CRM plan's lines at the chosen schemes, as a Landsec login reads them. Null when the plan could not be read. */
  brandLines: BoardBrandLine[] | null;
  engagement: BrandEngagement | null;
  /** Brands trading at the schemes or on the plan there, by company id: for the market report's public signals. */
  brands: Map<string, { name: string; category: LandsecCategoryOrOther | null }>;
}

const uniq = <T,>(list: T[]): T[] => Array.from(new Set(list));
const same = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The offers on the Letting Tracker units at the chosen properties: day, brand, property, and whether a person logged or confirmed it. */
async function offersAt(propertyIds: string[]): Promise<Array<{ propertyId: string; companyId: string | null; day: string | null; logged: boolean }>> {
  if (propertyIds.length === 0) return [];
  const rows = (await pool.query(
    `/* landsec-board-report:offers */
     SELECT a.property_id, o.company_id, o.offer_date, (o.source IS NULL OR o.confirmed_at IS NOT NULL) AS logged
       FROM unit_offers o JOIN available_units a ON a.id = o.unit_id
      WHERE a.property_id = ANY($1)`, [propertyIds])).rows;
  return rows.map((r: any) => ({ propertyId: String(r.property_id), companyId: r.company_id ? String(r.company_id) : null, day: reportDay(r.offer_date), logged: r.logged === true }));
}

/** Each brand's name and brief category, read from its type. */
async function brandTypes(ids: string[]): Promise<Map<string, { name: string; category: LandsecCategoryOrOther | null }>> {
  const out = new Map<string, { name: string; category: LandsecCategoryOrOther | null }>();
  if (ids.length === 0) return out;
  const rows = (await pool.query(
    `/* landsec-board-report:brands */ SELECT c.id, c.name, c.company_type FROM crm_companies c WHERE c.id = ANY($1::varchar[]) AND c.merged_into_id IS NULL`, [ids])).rows;
  for (const r of rows) out.set(String(r.id), { name: String(r.name || ""), category: landsecCategoryOf(r.company_type) });
  return out;
}

/** The Brand CRM plan at the chosen schemes, as a Landsec login reads it, whoever asks. */
async function brandLinesFor(ctx: Ctx, viewer: LandsecViewer): Promise<{ lines: BoardBrandLine[]; brands: Array<{ id: string; name: string; category: LandsecCategoryOrOther | null }> }> {
  const all = planSchemes(await resolveLandsecPortfolio(viewer.companyId));
  const keys = new Set(ctx.schemes.map(s => s.key));
  const planViewer: PlanViewer = { kind: "landsec", clientCompanyId: viewer.companyId, schemes: keys };
  const [grid, plan] = await Promise.all([
    brandGrid(pool, planViewer, all, await clientBrandSliceSql(viewer.companyId, "c.id"), ctx.madeAt),
    loadPlan(pool, { brandIds: null, propertyIds: uniq(all.flatMap(s => s.propertyIds)), schemes: all, viewer: planViewer, now: ctx.madeAt }),
  ]);
  const lines: BoardBrandLine[] = [];
  const brands: Array<{ id: string; name: string; category: LandsecCategoryOrOther | null }> = [];
  for (const b of grid.brands) {
    if (!b.id) continue;
    let listed = false;
    for (const row of plan.rowsByBrand.get(b.id) || []) {
      if (!row.scheme.key || !keys.has(row.scheme.key)) continue;
      // The earliest dated record behind the line, else the day it reached its stage.
      const days = row.evidence.map(e => reportDay(e.at)).filter((d): d is string => !!d).sort();
      lines.push({ brand: b.name, category: b.category ?? null, scheme: row.scheme.key, unit: row.unit?.label || null, stage: row.stage, firstSeen: days[0] || reportDay(row.stageSince) });
      listed = true;
    }
    if (listed) brands.push({ id: b.id, name: b.name, category: b.category ?? null });
  }
  return { lines, brands };
}

export async function boardData(ctx: Ctx, viewer: LandsecViewer): Promise<BoardData> {
  const today = londonDay(ctx.madeAt);
  const schemeOfProperty = new Map<string, ReportScheme>();
  for (const s of ctx.schemes) for (const p of s.properties) schemeOfProperty.set(p.id, s);
  const propertyIds = Array.from(schemeOfProperty.keys());

  const [units, clock, dates, viewingRows, offerRows, plan] = await Promise.all([
    unitsFor(ctx), clockFor(ctx), dealDatesFor(ctx),
    // Read as a Landsec login reads the viewings list, whoever asks.
    listLeasingViewings({ companyId: viewer.companyId, propertyIds: new Set(propertyIds), jointAgent: false }),
    offersAt(propertyIds),
    brandLinesFor(ctx, viewer).catch((e: any) => { console.warn(`[landsec-board-report] brand plan: ${e?.message}`); return null; }),
  ]);

  const unitOf = new Map<string, PropertyUnit>();
  for (const s of units) for (const u of s.units) {
    if (u.scheduleRowId) unitOf.set(`s:${u.scheduleRowId}`, u);
    if (u.trackerId) unitOf.set(`t:${u.trackerId}`, u);
  }
  const types = await brandTypes(uniq([
    ...viewingRows.map(v => v.companyId), ...offerRows.map(o => o.companyId), ...units.flatMap(s => s.units.map(u => u.tenant.companyId)),
  ].filter((id): id is string => !!id)));

  const deals: BoardDeal[] = [];
  for (const d of dates) {
    const scheme = schemeOfProperty.get(d.propertyId);
    if (!scheme || !d.letting) continue;
    const unit = (d.scheduleRowId ? unitOf.get(`s:${d.scheduleRowId}`) : undefined) || (d.trackerId ? unitOf.get(`t:${d.trackerId}`) : undefined);
    deals.push({
      id: d.id, ref: d.ref, scheme: scheme.key, unit: d.unit, brand: d.tenant, category: d.category, rentPa: d.rentPa,
      instructed: d.instructed, created: d.created, marketing: d.firstMove.AVA || null,
      hotsIssued: d.hotsIssued, hotsMoved: d.firstMove.HOT || null,
      exchangedOn: d.exchanged, exchangeMoved: d.firstMove.EXC || null,
      completedOn: d.completed, completeMoved: d.firstMove.COM || null,
      passingRent: unit?.passingRent ?? null, erv: unit?.erv ?? null,
      scheduleShowsTenant: !!unit && unit.occupancy === "occupied" && ((!!d.tenantId && unit.tenant.companyId === d.tenantId) || same(brandOf(unit), d.tenant)),
    });
  }

  const viewings: BoardViewing[] = viewingRows.filter(v => v.propertyId && schemeOfProperty.has(v.propertyId)).map(v => ({
    scheme: schemeOfProperty.get(v.propertyId!)!.key, day: reportDay(v.viewingDate), status: v.status ? String(v.status) : null,
    category: v.companyId ? types.get(v.companyId)?.category ?? null : null,
  }));
  const offers: BoardOffer[] = offerRows.filter(o => schemeOfProperty.has(o.propertyId)).map(o => ({
    scheme: schemeOfProperty.get(o.propertyId)!.key, day: o.day, logged: o.logged, category: o.companyId ? types.get(o.companyId)?.category ?? null : null,
  }));

  const schemes: BoardSchemeRow[] = units.map(s => {
    const live: Record<string, number> = {};
    for (const d of clock) if (d.scheme?.key === s.scheme.key && d.code) live[d.code] = (live[d.code] || 0) + 1;
    return {
      key: s.scheme.key, name: s.scheme.name, units: s.units.length,
      occupied: s.units.filter(u => u.occupancy === "occupied").length, vacant: s.units.filter(u => u.occupancy === "vacant").length, unknown: s.units.filter(u => u.occupancy === "unknown").length,
      live,
    };
  });

  const brands = new Map<string, { name: string; category: LandsecCategoryOrOther | null }>();
  for (const s of units) for (const u of s.units) {
    const id = u.occupancy === "occupied" ? u.tenant.companyId : null;
    if (id && types.has(id)) brands.set(id, types.get(id)!);
  }
  for (const b of plan?.brands || []) brands.set(b.id, { name: b.name, category: b.category });

  return {
    today, deals, schemes,
    activity: boardActivity({ deals, viewings, offers }, ctx.period, today),
    growth: rentalGrowth(deals, ctx.period),
    speed: dealSpeed(deals, ctx.period),
    brandLines: plan ? plan.lines : null,
    engagement: plan ? brandEngagement(plan.lines, ctx.period) : null,
    brands,
  };
}

// ── Words ────────────────────────────────────────────────────────────────

const pct = (n: number | null | undefined): string => (n == null ? "Not held" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const days = (n: number | null | undefined): string => (n == null ? "None measured" : `${n} ${n === 1 ? "day" : "days"}`);
const plural = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;
const groupOf = (category: LandsecCategoryOrOther | null): string | null => LANDSEC_CATEGORIES.find(c => c.key === category)?.group || null;
const LIVE_STAGES = ["AVA", "NEG", "HOT", "SOL"];

/** How each figure is counted, in plain words: printed under the figures and on the workbook's About sheet. */
export const BOARD_COUNTED: Record<"lettings" | "hots" | "instructions" | "viewings" | "offers" | "occupancy" | "bulk" | "growth" | "speed" | "brands", string> = {
  lettings: "Lettings exchanged or completed: lettings whose exchange or completion day falls in the period, each counted once. The day is the date on the deal, else the day its status was moved in the app.",
  hots: "Heads of Terms agreed: lettings that reached the Heads of Terms stage in the period: the day Heads of Terms were issued in the app, else the day the status was moved to HOTs.",
  instructions: "New instructions: units put to market in the period: the instructed date on the deal, else the day the letting was added to the app.",
  viewings: "Viewings held: viewings dated in the period and not later than today, leaving out cancelled viewings, no-shows and diary entries marked as not a leasing viewing.",
  offers: "Offers received: offers dated in the period that a person logged or confirmed. An offer found in the inbox that nobody has confirmed is not counted.",
  occupancy: "Units occupied and vacant, and live lettings by stage: as the tenancy schedule and the Deals page stand today. The app does not keep occupancy by date, so this is not the position on the last day of the period.",
  bulk: "A date stamped on five or more other deals in the same minute is a bulk update, not the day a letting moved, and is not counted.",
  growth: "Rental growth: for each letting that exchanged or completed in the period, the rent on the deal against the unit's passing rent before the letting and against its ERV, as the tenancy schedule holds them. A figure the app does not hold is never estimated: the letting is left out of that comparison. The average is the average of each letting's own change.",
  speed: "Deal speed: whole days between two confirmed days. Instruction is the instructed date on the deal, else the day its status was first moved to Marketing; the day a letting was added to the app is not used. A letting with a day missing, not confirmed or out of order is left out and counted as left out.",
  brands: "Brand engagements: the Brand CRM plan for these schemes as a Landsec login reads it today. A brand is counted once, at the furthest stage any of its lines has reached. Newly in play: the earliest dated record of the brand at these schemes falls in the period.",
};

const leftOutWords = (a: BoardActivity): string | null => {
  const parts = [
    a.leftOut.stageMoves ? plural(a.leftOut.stageMoves, "stage move", "stage moves") : null,
    a.leftOut.instructions ? plural(a.leftOut.instructions, "new instruction", "new instructions") : null,
  ].filter(Boolean);
  return parts.length ? `Left out this period for that reason: ${parts.join(" and ")}.` : null;
};

const countsLine = (c: BoardCounts): string =>
  `lettings exchanged or completed ${c.lettings}, Heads of Terms agreed ${c.hots}, new instructions ${c.instructions}, viewings held ${c.viewings}, offers received ${c.offers}`;

/** Brands of one category group (null: every brand), by company id: for the market report's public signals. */
export function boardBrandsIn(data: BoardData, group: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, b] of data.brands) if (b.name && (!group || groupOf(b.category) === group)) out.set(id, b.name);
  return out;
}

/** The lines the pack prints, as plain sentences, for one market report section (null: the overall one). A draft is written from these. */
export function boardFacts(data: BoardData, group: string | null, schemeNames: Map<string, string> = new Map(data.schemes.map(s => [s.key, s.name]))): string[] {
  const out: string[] = [];
  const name = (key: string) => schemeNames.get(key) || key;
  if (!group) {
    out.push(`All schemes in the period: ${countsLine(data.activity.total)}.`);
    const occupied = data.schemes.reduce((n, s) => n + s.occupied, 0), vacant = data.schemes.reduce((n, s) => n + s.vacant, 0);
    out.push(`Today: ${occupied} units occupied and ${vacant} vacant.`);
    for (const s of data.schemes) {
      const c = data.activity.byScheme[s.key];
      if (c) out.push(`${s.name}: ${countsLine(c)}.`);
    }
    const g = data.growth;
    if (g.withPrevious) out.push(`Rental growth against previous passing rent: average ${pct(g.avgVsPreviousPct)} across ${plural(g.withPrevious, "letting", "lettings")}.`);
    if (g.withErv) out.push(`Agreed rent against ERV: average ${pct(g.avgVsErvPct)} across ${plural(g.withErv, "letting", "lettings")}.`);
    if (data.speed.toHots.count) out.push(`Instruction to Heads of Terms: median ${days(data.speed.toHots.median)} across ${plural(data.speed.toHots.count, "letting", "lettings")}.`);
    if (data.speed.toExchange.count) out.push(`Heads of Terms to exchange: median ${days(data.speed.toExchange.median)} across ${plural(data.speed.toExchange.count, "letting", "lettings")}.`);
    if (data.engagement) out.push(`Brands by furthest stage today: ${data.engagement.byStage.map(s => `${s.label} ${s.brands}`).join(", ")}.`);
  } else {
    for (const row of categoryRows(data.activity.byCategory).filter(r => r.group === group)) out.push(`${row.total ? `${group}, all categories` : row.label}: ${countsLine(row.counts)}.`);
    for (const r of data.growth.rows) {
      const deal = data.deals.find(d => d.id === r.id);
      if (!deal || groupOf(deal.category) !== group || !r.brand) continue;
      const against = [r.vsPreviousPct != null ? `${pct(r.vsPreviousPct)} against the previous passing rent` : null, r.vsErvPct != null ? `${pct(r.vsErvPct)} against ERV` : null].filter(Boolean).join(", ");
      out.push(`${r.brand} at ${name(r.scheme)} exchanged or completed${against ? `: agreed rent ${against}` : ""}.`);
    }
  }
  const lines = (data.brandLines || []).filter(l => !group || groupOf(l.category) === group);
  const inGroup = new Set(lines.map(l => l.brand));
  for (const n of (data.engagement?.newlyInPlay || []).filter(b => inGroup.has(b.brand)).slice(0, 15)) {
    out.push(`${n.brand} came into play in the period (first dated record ${n.firstSeen}) at ${n.schemes.map(name).join(", ")}; furthest stage ${n.stage}.`);
  }
  if (group) {
    const far = lines.filter(l => ["negotiating", "hots", "solicitors", "let"].includes(l.stage)).slice(0, 15);
    for (const l of far) out.push(`${l.brand} is at ${BRAND_STAGE_LABELS[l.stage]} at ${name(l.scheme)}.`);
  }
  return out;
}

// ── The PDF ──────────────────────────────────────────────────────────────

const right = (header: string, width: number): PdfCol => ({ header, width, align: "right" });
const COUNT_COLS: PdfCol[] = [right("Exchanged or completed", 20), right("HoTs agreed", 12), right("New instructions", 16), right("Viewings held", 13), right("Offers received", 15)];
const countCells = (c: BoardCounts | undefined): string[] => [c?.lettings || 0, c?.hots || 0, c?.instructions || 0, c?.viewings || 0, c?.offers || 0].map(n => count(n));

function speedSection(title: string, stat: SpeedStat): [string, string][] {
  return [[`Median ${title}`, days(stat.median)], [`Average ${title}`, days(stat.average)]];
}

export async function boardReportPdf(ctx: Ctx, viewer: LandsecViewer): Promise<Buffer> {
  const data = await boardData(ctx, viewer);
  const market: BoardMarket = await loadBoardMarket(ctx.period, ctx.schemes.map(s => s.key)).catch(() => ({}));
  const pdf = await pdfDocument(`${BOARD_REPORT_TITLE}, ${ctx.period.label}`, "", ctx, false, 15);
  const a = data.activity, t = a.total;
  const schemeName = new Map(ctx.schemes.map(s => [s.key, s.name]));
  const occupied = data.schemes.reduce((n, s) => n + s.occupied, 0), vacant = data.schemes.reduce((n, s) => n + s.vacant, 0);
  const liveNow = data.schemes.reduce((n, s) => n + LIVE_STAGES.reduce((m, code) => m + (s.live[code] || 0), 0), 0);

  // 1. Headlines.
  pdf.heading("Headlines for the period");
  pdf.figures([
    ["Exchanged/completed", count(t.lettings)], ["Heads of Terms", count(t.hots)], ["New instructions", count(t.instructions)], ["Viewings held", count(t.viewings)],
    ["Offers received", count(t.offers)], ["Units occupied", count(occupied)], ["Units vacant", count(vacant)], ["Live lettings", count(liveNow)],
  ]);
  pdf.para(`Schemes: ${ctx.schemes.map(s => s.name).join(", ")}.`, true);
  pdf.para(`Of the ${plural(t.lettings, "letting", "lettings")}, ${count(t.exchanged)} exchanged and ${count(t.completed)} completed in the period (a letting that did both is counted once). Of the ${plural(t.viewings, "viewing", "viewings")}, ${count(t.viewingsCompleted)} ${t.viewingsCompleted === 1 ? "is" : "are"} marked completed.`);
  pdf.gap(4);
  for (const key of ["lettings", "hots", "instructions", "viewings", "offers", "occupancy"] as const) pdf.para(BOARD_COUNTED[key], true);
  pdf.para([BOARD_COUNTED.bulk, leftOutWords(a)].filter(Boolean).join(" "), true);

  // 2. Letting activity.
  pdf.pageBreak(260);
  pdf.heading("Letting activity by scheme");
  pdf.table([{ header: "Scheme", width: 24 }, ...COUNT_COLS], [
    ...data.schemes.map(s => [s.name, ...countCells(a.byScheme[s.key])]),
    ...(data.schemes.length > 1 ? [["All schemes", ...countCells(t)]] : []),
  ], "No scheme is picked.");
  pdf.para("Counted in the period, by the rules under the headlines.", true);
  pdf.gap(6);
  pdf.table([{ header: "Scheme, today", width: 24 }, right("Occupied", 13), right("Vacant", 11), ...LIVE_STAGES.map(code => right(stageLabel(code) || code, 13))], [
    ...data.schemes.map(s => [s.name, count(s.occupied), count(s.vacant), ...LIVE_STAGES.map(code => count(s.live[code] || 0))]),
    ...(data.schemes.length > 1 ? [["All schemes", count(occupied), count(vacant), ...LIVE_STAGES.map(code => count(data.schemes.reduce((n, s) => n + (s.live[code] || 0), 0)))]] : []),
  ], "No scheme is picked.");
  pdf.para("Units occupied and vacant on the tenancy schedule, and live lettings by stage as the Deals page lists them, today.", true);

  pdf.heading("Letting activity by brief category");
  pdf.table([{ header: "Category", width: 24 }, ...COUNT_COLS], categoryRows(a.byCategory).map(r => [r.label, ...countCells(r.counts)]), "Nothing is recorded in the period.");
  pdf.para("The category is read from the brand's type, by the categories of Landsec's agency brief. A letting, viewing or offer with no brand recorded is under No brand recorded.", true);

  // 3. Rental growth.
  pdf.pageBreak(260);
  const g = data.growth;
  pdf.heading("Rental growth");
  pdf.figures([["Lettings", count(g.lettings)], ["vs previous rent", pct(g.avgVsPreviousPct)], ["vs ERV", pct(g.avgVsErvPct)], ["With both figures", count(g.withBoth)]]);
  pdf.para(g.lettings === 0
    ? "No letting exchanged or completed in the period on a day the app can confirm."
    : `Of the ${plural(g.lettings, "letting", "lettings")} that exchanged or completed in the period, ${count(g.withPrevious)} had an agreed rent and a previous passing rent, ${count(g.withErv)} had an agreed rent and an ERV, and ${count(g.withBoth)} had all three. ${count(g.leftOut)} ${g.leftOut === 1 ? "is" : "are"} left out of both comparisons for want of a figure.`);
  if (g.withPrevious) pdf.para(`Against the previous passing rent: agreed rents of ${money(g.agreedForPrevious)} a year against ${money(g.previousTotal)}, ${pct(g.totalVsPreviousPct)} on the total; the average of each letting's own change is ${pct(g.avgVsPreviousPct)}.`);
  if (g.withErv) pdf.para(`Against ERV: agreed rents of ${money(g.agreedForErv)} a year against ERVs of ${money(g.ervTotal)}, ${pct(g.totalVsErvPct)} on the total; the average of each letting's own change is ${pct(g.avgVsErvPct)}.`);
  pdf.gap(4);
  if (g.lettings) {
    pdf.table([
      { header: "Scheme", width: 15 }, { header: "Unit", width: 12 }, { header: "Brand", width: 15 }, { header: "Day", width: 11 },
      right("Agreed pa", 11), right("Previous pa", 11), right("Change", 8), right("ERV pa", 10), right("vs ERV", 8),
    ], g.rows.map(r => [
      schemeName.get(r.scheme) || r.scheme, r.unit || "", r.brand || "", shortDay(r.day),
      money(r.agreedRent) || "Not held", money(r.previousRent) || "Not held", pct(r.vsPreviousPct), money(r.erv) || "Not held", pct(r.vsErvPct),
    ]), "");
  }
  pdf.para(BOARD_COUNTED.growth, true);

  // 4. Deal speed.
  pdf.pageBreak(240);
  const sp = data.speed;
  pdf.heading("Deal speed");
  pdf.figures([...speedSection("to HoTs", sp.toHots), ...speedSection("to exchange", sp.toExchange)]);
  pdf.para(`Instruction to Heads of Terms: ${plural(sp.toHots.count, "letting", "lettings")} measured of those that reached Heads of Terms in the period; ${count(sp.toHots.leftOut)} left out. Heads of Terms to exchange: ${plural(sp.toExchange.count, "letting", "lettings")} measured of those that exchanged in the period; ${count(sp.toExchange.leftOut)} left out.`);
  pdf.gap(4);
  const speedCols: PdfCol[] = [{ header: "Scheme", width: 20 }, { header: "Unit", width: 16 }, { header: "Brand", width: 22 }, { header: "From", width: 14 }, { header: "To", width: 14 }, right("Days", 9)];
  const speedRows = (stat: SpeedStat) => stat.rows.map(r => [schemeName.get(r.scheme) || r.scheme, r.unit || "", r.brand || "", shortDay(r.from), shortDay(r.to), count(r.days)]);
  if (sp.toHots.count) { pdf.para("Instruction to Heads of Terms"); pdf.table(speedCols, speedRows(sp.toHots), ""); }
  if (sp.toExchange.count) { pdf.para("Heads of Terms to exchange"); pdf.table(speedCols, speedRows(sp.toExchange), ""); }
  pdf.para(BOARD_COUNTED.speed, true);

  // 5. Brand engagements.
  pdf.pageBreak(260);
  pdf.heading("Brand engagements");
  const e = data.engagement;
  if (!e) pdf.para("The Brand CRM plan could not be read, so this section is not in this copy.", true);
  else {
    pdf.figures(e.byStage.map((s): [string, string] => [s.label, count(s.brands)]));
    pdf.para(`${plural(e.brands, "brand has", "brands have")} a line at these schemes. ${count(e.otherStages)} more ${e.otherStages === 1 ? "is" : "are"} at a stage outside these six (Wanted, Unit identified, Trading, Not proceeding or Disposing).`);
    pdf.gap(4);
    pdf.para("Newly in play in the period");
    pdf.table([{ header: "Brand", width: 30 }, { header: "First dated record", width: 18 }, { header: "Schemes", width: 34 }, { header: "Furthest stage", width: 18 }],
      e.newlyInPlay.map(n => [n.brand, shortDay(n.firstSeen), n.schemes.map(k => schemeName.get(k) || k).join(", "), n.stage]), "No brand's earliest dated record falls in the period.");
    if (e.undated) pdf.para(`${plural(e.undated, "brand has", "brands have")} no dated record, so the report cannot say when ${e.undated === 1 ? "it" : "they"} came into play.`, true);
    pdf.gap(4);
    pdf.para("Furthest on at each scheme");
    const far = ctx.schemes.flatMap(s => (e.furthestByScheme[s.key] || []).map(b => [s.name, b.brand, b.unit || "No unit yet", b.stage]));
    pdf.table([{ header: "Scheme", width: 26 }, { header: "Brand", width: 30 }, { header: "Unit", width: 26 }, { header: "Stage", width: 18 }], far, "No brand is between Approached and Let at these schemes.");
    pdf.para(BOARD_COUNTED.brands, true);
  }

  // 6. The market report: only what a person saved.
  const saved = BOARD_MARKET_SECTIONS.filter(s => market[s.key]?.text);
  if (saved.length) pdf.pageBreak(260);
  for (const s of saved) {
    const m = market[s.key]!;
    pdf.heading(s.key === "overall" ? "Market report" : `Market report: ${s.title}`);
    for (const paragraph of m.text.split(/\n+/).filter(Boolean)) { pdf.para(paragraph); pdf.gap(4); }
    pdf.para(`Saved by ${m.savedBy} (${m.savedByFirm})${m.savedAt ? ` on ${longDay(new Date(m.savedAt))}` : ""}.`, true);
  }

  // About.
  pdf.heading("About this report");
  pdf.para(`Period: ${ctx.period.label}. Made by ${ctx.madeBy} on ${longDay(ctx.madeAt)}.`);
  pdf.para("It holds what is recorded in ChatBGP on the day it was made. A letting Landsec did without BGP is in it only if it is on the app. Nothing in it is estimated: a figure the app does not hold is shown as not held and left out of the averages.");
  pdf.para(saved.length
    ? `The market report is written by BGP and Landsec. Printed here: ${saved.map(s => s.title).join(", ")}. A section with nothing saved is not printed.`
    : "The market report is written by BGP and Landsec. Nothing has been saved for this period and these schemes, so none is printed.");
  pdf.para("The figures behind every table are in the Board report figures workbook, from the same page.", true);
  return Buffer.from(await pdf.bytes());
}

// ── The workbook ─────────────────────────────────────────────────────────

const COUNT_SHEET_COLS = [
  { header: "Lettings exchanged or completed", key: "lettings", width: 18, kind: "int" as const }, { header: "Exchanged", key: "exchanged", width: 11, kind: "int" as const },
  { header: "Completed", key: "completed", width: 11, kind: "int" as const }, { header: "Heads of Terms agreed", key: "hots", width: 14, kind: "int" as const },
  { header: "New instructions", key: "instructions", width: 13, kind: "int" as const }, { header: "Viewings held", key: "viewings", width: 11, kind: "int" as const },
  { header: "Viewings marked completed", key: "viewingsCompleted", width: 16, kind: "int" as const }, { header: "Offers received", key: "offers", width: 11, kind: "int" as const },
];
const countKeys = (c: BoardCounts | undefined) => ({
  lettings: c?.lettings || 0, exchanged: c?.exchanged || 0, completed: c?.completed || 0, hots: c?.hots || 0,
  instructions: c?.instructions || 0, viewings: c?.viewings || 0, viewingsCompleted: c?.viewingsCompleted || 0, offers: c?.offers || 0,
});

export async function boardReportWorkbook(def: LandsecReportDef, ctx: Ctx, viewer: LandsecViewer): Promise<Buffer> {
  const data = await boardData(ctx, viewer);
  const market: BoardMarket = await loadBoardMarket(ctx.period, ctx.schemes.map(s => s.key)).catch(() => ({}));
  const a = data.activity, g = data.growth, sp = data.speed, e = data.engagement;
  const schemeName = new Map(ctx.schemes.map(s => [s.key, s.name]));
  const occupied = data.schemes.reduce((n, s) => n + s.occupied, 0), vacant = data.schemes.reduce((n, s) => n + s.vacant, 0);
  const figure = (section: string, name: string, value: number | string | null, counted: string) => ({ section, figure: name, value: value ?? "Not held", counted });

  const headlines: Sheet = {
    name: "Headlines",
    columns: [{ header: "Section", key: "section", width: 20 }, { header: "Figure", key: "figure", width: 44 }, { header: "Value", key: "value", width: 14 }, { header: "How it is counted", key: "counted", width: 110 }],
    rows: [
      figure("Headlines", "Lettings exchanged or completed", a.total.lettings, BOARD_COUNTED.lettings),
      figure("Headlines", "of which exchanged in the period", a.total.exchanged, BOARD_COUNTED.lettings),
      figure("Headlines", "of which completed in the period", a.total.completed, BOARD_COUNTED.lettings),
      figure("Headlines", "Heads of Terms agreed", a.total.hots, BOARD_COUNTED.hots),
      figure("Headlines", "New instructions", a.total.instructions, BOARD_COUNTED.instructions),
      figure("Headlines", "Viewings held", a.total.viewings, BOARD_COUNTED.viewings),
      figure("Headlines", "of which marked completed", a.total.viewingsCompleted, BOARD_COUNTED.viewings),
      figure("Headlines", "Offers received", a.total.offers, BOARD_COUNTED.offers),
      figure("Headlines", "Units occupied today", occupied, BOARD_COUNTED.occupancy),
      figure("Headlines", "Units vacant today", vacant, BOARD_COUNTED.occupancy),
      figure("Left out", "Stage moves dated in the period by a bulk update", a.leftOut.stageMoves, BOARD_COUNTED.bulk),
      figure("Left out", "Lettings added in the period in a bulk load, with no instructed date", a.leftOut.instructions, BOARD_COUNTED.bulk),
      figure("Left out", "Offers in the period found in the inbox and not confirmed by a person", a.leftOut.offersNotConfirmed, BOARD_COUNTED.offers),
      figure("Left out", "Offers whose date cannot be read as a day", a.leftOut.offersNoDate, BOARD_COUNTED.offers),
      figure("Rental growth", "Lettings exchanged or completed", g.lettings, BOARD_COUNTED.growth),
      figure("Rental growth", "with an agreed rent and a previous passing rent", g.withPrevious, BOARD_COUNTED.growth),
      figure("Rental growth", "with an agreed rent and an ERV", g.withErv, BOARD_COUNTED.growth),
      figure("Rental growth", "with all three figures", g.withBoth, BOARD_COUNTED.growth),
      figure("Rental growth", "left out of both comparisons", g.leftOut, BOARD_COUNTED.growth),
      figure("Rental growth", "Average change against previous passing rent", pct(g.avgVsPreviousPct), BOARD_COUNTED.growth),
      figure("Rental growth", "Change on the total against previous passing rent", pct(g.totalVsPreviousPct), BOARD_COUNTED.growth),
      figure("Rental growth", "Average change against ERV", pct(g.avgVsErvPct), BOARD_COUNTED.growth),
      figure("Rental growth", "Change on the total against ERV", pct(g.totalVsErvPct), BOARD_COUNTED.growth),
      figure("Deal speed", "Instruction to Heads of Terms: lettings measured", sp.toHots.count, BOARD_COUNTED.speed),
      figure("Deal speed", "Instruction to Heads of Terms: median days", sp.toHots.median, BOARD_COUNTED.speed),
      figure("Deal speed", "Instruction to Heads of Terms: average days", sp.toHots.average, BOARD_COUNTED.speed),
      figure("Deal speed", "Instruction to Heads of Terms: lettings left out", sp.toHots.leftOut, BOARD_COUNTED.speed),
      figure("Deal speed", "Heads of Terms to exchange: lettings measured", sp.toExchange.count, BOARD_COUNTED.speed),
      figure("Deal speed", "Heads of Terms to exchange: median days", sp.toExchange.median, BOARD_COUNTED.speed),
      figure("Deal speed", "Heads of Terms to exchange: average days", sp.toExchange.average, BOARD_COUNTED.speed),
      figure("Deal speed", "Heads of Terms to exchange: lettings left out", sp.toExchange.leftOut, BOARD_COUNTED.speed),
      ...(e ? [
        figure("Brand engagements", "Brands with a line at these schemes", e.brands, BOARD_COUNTED.brands),
        ...e.byStage.map(s => figure("Brand engagements", `Brands at ${s.label}`, s.brands, BOARD_COUNTED.brands)),
        figure("Brand engagements", "Brands at another stage", e.otherStages, BOARD_COUNTED.brands),
        figure("Brand engagements", "Brands newly in play in the period", e.newlyInPlay.length, BOARD_COUNTED.brands),
        figure("Brand engagements", "Brands with no dated record", e.undated, BOARD_COUNTED.brands),
      ] : [figure("Brand engagements", "The Brand CRM plan could not be read", null, BOARD_COUNTED.brands)]),
    ],
  };

  const byScheme: Sheet = {
    name: "By scheme",
    columns: [{ header: "Scheme", key: "scheme", width: 26 }, ...COUNT_SHEET_COLS,
      { header: "Units", key: "units", width: 8, kind: "int" }, { header: "Occupied today", key: "occupied", width: 12, kind: "int" }, { header: "Vacant today", key: "vacant", width: 11, kind: "int" },
      { header: "Occupancy not recorded", key: "unknown", width: 14, kind: "int" },
      ...LIVE_STAGES.map(code => ({ header: `Live at ${stageLabel(code) || code} today`, key: `live${code}`, width: 14, kind: "int" as const }))],
    rows: data.schemes.map(s => ({ scheme: s.name, ...countKeys(a.byScheme[s.key]), units: s.units, occupied: s.occupied, vacant: s.vacant, unknown: s.unknown, ...Object.fromEntries(LIVE_STAGES.map(code => [`live${code}`, s.live[code] || 0])) })),
    totals: { scheme: "All schemes", ...countKeys(a.total), units: data.schemes.reduce((n, s) => n + s.units, 0), occupied, vacant, unknown: data.schemes.reduce((n, s) => n + s.unknown, 0),
      ...Object.fromEntries(LIVE_STAGES.map(code => [`live${code}`, data.schemes.reduce((n, s) => n + (s.live[code] || 0), 0)])) },
    caption: "The first eight columns are counted in the period. Units, occupancy and live lettings are as recorded today.",
  };

  const byCategory: Sheet = {
    name: "By category",
    columns: [{ header: "Category", key: "category", width: 34 }, { header: "Group", key: "group", width: 24 }, ...COUNT_SHEET_COLS],
    rows: categoryRows(a.byCategory).map(r => ({ category: r.label, group: r.group, ...countKeys(r.counts) })),
    caption: "The category is read from the brand's type, by the categories of Landsec's agency brief. A row ending \": all\" is its group's total.",
  };

  const growth: Sheet = {
    name: "Rental growth",
    columns: [
      { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 20 }, { header: "Brand", key: "brand", width: 26 }, { header: "Ref", key: "ref", width: 8, kind: "int" },
      { header: "Exchanged or completed", key: "day", width: 16, kind: "date" }, { header: "Agreed rent pa", key: "agreedRent", width: 15, kind: "money" },
      { header: "Previous passing rent pa", key: "previousRent", width: 18, kind: "money" }, { header: "Change against previous", key: "vsPreviousPct", width: 16, kind: "pct" },
      { header: "ERV pa", key: "erv", width: 14, kind: "money" }, { header: "Change against ERV", key: "vsErvPct", width: 14, kind: "pct" }, { header: "What is not held", key: "missing", width: 60 },
    ],
    rows: g.rows.map(r => ({ scheme: schemeName.get(r.scheme) || r.scheme, unit: r.unit, brand: r.brand, ref: r.ref, day: r.day, agreedRent: r.agreedRent, previousRent: r.previousRent, vsPreviousPct: r.vsPreviousPct, erv: r.erv, vsErvPct: r.vsErvPct, missing: r.missing })),
    caption: BOARD_COUNTED.growth,
  };

  const speed: Sheet = {
    name: "Deal speed",
    columns: [
      { header: "Measure", key: "measure", width: 30 }, { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 20 }, { header: "Brand", key: "brand", width: 26 },
      { header: "Ref", key: "ref", width: 8, kind: "int" }, { header: "From", key: "from", width: 13, kind: "date" }, { header: "To", key: "to", width: 13, kind: "date" }, { header: "Days", key: "days", width: 8, kind: "int" },
    ],
    rows: [
      ...sp.toHots.rows.map(r => ({ measure: "Instruction to Heads of Terms", scheme: schemeName.get(r.scheme) || r.scheme, unit: r.unit, brand: r.brand, ref: r.ref, from: r.from, to: r.to, days: r.days })),
      ...sp.toExchange.rows.map(r => ({ measure: "Heads of Terms to exchange", scheme: schemeName.get(r.scheme) || r.scheme, unit: r.unit, brand: r.brand, ref: r.ref, from: r.from, to: r.to, days: r.days })),
    ],
    caption: BOARD_COUNTED.speed,
  };

  const newly = new Set((e?.newlyInPlay || []).map(n => n.brand));
  const brands: Sheet = {
    name: "Brand engagements",
    columns: [
      { header: "Brand", key: "brand", width: 28 }, { header: "Category", key: "category", width: 26 }, { header: "Scheme", key: "scheme", width: 24 }, { header: "Unit", key: "unit", width: 22 },
      { header: "Stage", key: "stage", width: 16 }, { header: "Earliest dated record", key: "firstSeen", width: 16, kind: "date" }, { header: "Brand newly in play in period", key: "newly", width: 18 },
    ],
    rows: (data.brandLines || []).map(l => ({ brand: l.brand, category: landsecCategoryLabel(l.category) || "", scheme: schemeName.get(l.scheme) || l.scheme, unit: l.unit, stage: BRAND_STAGE_LABELS[l.stage], firstSeen: l.firstSeen, newly: newly.has(l.brand) ? "Yes" : "" }))
      .sort((x, y) => x.brand.localeCompare(y.brand) || x.scheme.localeCompare(y.scheme)),
    caption: data.brandLines ? BOARD_COUNTED.brands : "The Brand CRM plan could not be read, so this sheet is empty.",
  };

  const marketSheet: Sheet = {
    name: "Market report",
    columns: [{ header: "Section", key: "section", width: 24 }, { header: "Text", key: "text", width: 120 }, { header: "Saved by", key: "savedBy", width: 22 }, { header: "Firm", key: "firm", width: 10 }, { header: "Saved on", key: "savedOn", width: 13, kind: "date" }],
    rows: BOARD_MARKET_SECTIONS.filter(s => market[s.key]?.text).map(s => ({ section: s.title, text: market[s.key]!.text, savedBy: market[s.key]!.savedBy, firm: market[s.key]!.savedByFirm, savedOn: reportDay(market[s.key]!.savedAt) })),
    caption: "Written by BGP and Landsec. Only the sections that have been saved for this period and these schemes are here.",
  };

  return workbookOf(def, ctx, [headlines, byScheme, byCategory, growth, speed, brands, marketSheet], [
    ["What it holds", "What is recorded in ChatBGP. A letting Landsec did without BGP is in it only if it is on the app. A figure the app does not hold is left blank and left out of the averages."],
    ["Dates", [BOARD_COUNTED.bulk, leftOutWords(a)].filter(Boolean).join(" ")],
  ]);
}
