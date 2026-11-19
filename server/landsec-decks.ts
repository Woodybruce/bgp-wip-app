// The Landsec report decks: gathering (Woody, 2026-11-19: "we dont need
// complicated excels just visual PDF which can also be power point").
//
// This file reads what a deck needs and hands it to shared/landsec-decks.ts,
// which lays it out as slides. It has NO query of its own: every figure comes
// through the reports' existing reads, which are the pages' own feeds
// (server/landsec-reports.ts says which), so a deck holds what its viewer's
// pages show and nothing else.
//
//  - Board report: the board report's own gathered figures (boardData), the
//    market report's items (server/landsec-market-report.ts), the words people
//    saved for it, and the lease roll from the unit feed.
//  - Market report: the same items and words, laid out sector by sector.
//  - Asset profile: the unit feed for one scheme, the Schemes cards' count
//    of trading units by brief category, and the scheme's target tenants.
//  - Target tenants (both decks): the Brand CRM plan read as a Landsec login
//    reads it, whoever asks (brandLinesFor), counted by targetTenants.
//  - Leasing activity: the leasing activity rows (the deal clock feed and the
//    one read of deal dates), and the viewings list read as a Landsec login
//    reads it, counted by the board report's own test of a viewing held.
//
// Every value handed on is named, key by key. What BGP earns, how it is
// shared, BGP's own remarks, who at BGP runs a letting, its mail and its
// compliance working are never named here.
import { categoryMixByProperty, sumCategoryMixes } from "./landsec-home";
import { listLeasingViewings } from "./leasing-viewings";
import type { LandsecViewer } from "./landsec-access";
import { loadBoardMarket } from "./landsec-board-market";
import { BOARD_COUNTED, boardData, brandLinesFor } from "./landsec-board-report";
import { activityRows, brandOf, leaseRoll, longDay, stageLabel, total, unitRow, unitsFor, type Ctx, type RollYear } from "./landsec-reports";
import { UNIT_OCCUPANCY_LABELS, type PropertyUnit } from "@shared/property-units";
import { LANDSEC_CATEGORIES, landsecCategoryLabel } from "@shared/landsec";
import { reportDay } from "@shared/landsec-reports";
import { londonDay } from "@shared/stage-since";
import { targetTenants, viewingHeld } from "@shared/landsec-board-report";
import type { MarketWords } from "@shared/landsec-market-report";
import { marketDeck } from "@shared/landsec-market-deck";
import { marketData } from "./landsec-market-report";
import type { Deck } from "@shared/landsec-deck";
import { activityDeck, assetDeck, boardDeck, type DeckRollYear } from "@shared/landsec-decks";

/** The line at the foot of every slide: words, not a logo. */
export const deckFooter = (ctx: Pick<Ctx, "madeAt" | "madeBy">): string =>
  `Made in ChatBGP on ${longDay(ctx.madeAt)} by ${ctx.madeBy}. It holds what is recorded in ChatBGP on that day.`;

const rollYears = (roll: RollYear[]): DeckRollYear[] => roll.map(r => ({ year: r.year, expiries: r.expiries, breaks: r.breaks, expiryRent: r.expiryRent, breakRent: r.breakRent }));
const thisYear = (ctx: Ctx): number => Number(londonDay(ctx.madeAt).slice(0, 4));

async function boardSlides(ctx: Ctx, viewer: LandsecViewer): Promise<Deck> {
  const [data, market, units] = await Promise.all([
    boardData(ctx, viewer),
    loadBoardMarket(ctx.period, ctx.schemes.map(s => s.key)).catch((): MarketWords => ({})),
    unitsFor(ctx),
  ]);
  const items = await marketData(ctx, viewer, data);
  return boardDeck({
    period: { label: ctx.period.label, from: ctx.period.from, to: ctx.period.to },
    schemes: ctx.schemes.map(s => ({ key: s.key, name: s.name })),
    footer: deckFooter(ctx), thisYear: thisYear(ctx),
    activity: data.activity, growth: data.growth, speed: data.speed,
    schemeRows: data.schemes.map(s => ({ key: s.key, name: s.name, units: s.units, occupied: s.occupied, vacant: s.vacant, unknown: s.unknown, live: s.live })),
    targets: data.targets,
    roll: rollYears(leaseRoll(units.flatMap(s => s.units.map(u => unitRow(s.scheme, u))))),
    marketData: items,
    market,
    counted: BOARD_COUNTED,
  });
}

/** The Market report: who is doing what sector by sector, the competition, the research read, and the words people saved. */
async function marketSlides(ctx: Ctx, viewer: LandsecViewer): Promise<Deck> {
  const [data, words] = await Promise.all([
    boardData(ctx, viewer),
    loadBoardMarket(ctx.period, ctx.schemes.map(s => s.key)).catch((): MarketWords => ({})),
  ]);
  return marketDeck({
    period: { label: ctx.period.label, from: ctx.period.from, to: ctx.period.to },
    schemes: ctx.schemes.map(s => ({ key: s.key, name: s.name })),
    footer: deckFooter(ctx), data: await marketData(ctx, viewer, data), words,
  });
}

async function assetSlides(ctx: Ctx, viewer: LandsecViewer): Promise<Deck> {
  const scheme = ctx.schemes[0];
  const [{ units }] = await unitsFor(ctx);
  // The Brand CRM plan at this scheme, as a Landsec login reads it, whoever asks.
  const plan = await brandLinesFor(ctx, viewer).catch((e: any) => { console.warn(`[landsec-decks] brand plan: ${e?.message}`); return null; });
  const sqft = (list: PropertyUnit[]) => total(list.map(u => u.sqft));
  const occupied = units.filter(u => u.occupancy === "occupied"), vacant = units.filter(u => u.occupancy === "vacant"), unknown = units.filter(u => u.occupancy === "unknown");
  const mixes = await categoryMixByProperty(scheme.properties.map(p => p.id)).catch(() => null);
  let mix: Array<{ label: string; units: number }> | null = null;
  if (mixes) {
    const sum = sumCategoryMixes(scheme.properties.map(p => mixes.get(p.id)));
    mix = [];
    for (const c of LANDSEC_CATEGORIES) if (sum.counts[c.key]) mix.push({ label: c.label, units: sum.counts[c.key]! });
    if (sum.counts.other) mix.push({ label: landsecCategoryLabel("other") || "Other", units: sum.counts.other });
    if (sum.notLinked) mix.push({ label: "No brand", units: sum.notLinked });
  }
  return assetDeck({
    scheme: { name: scheme.name, town: scheme.town, group: scheme.group },
    footer: deckFooter(ctx), madeOn: longDay(ctx.madeAt), thisYear: thisYear(ctx),
    units: units.length, occupied: occupied.length, vacant: vacant.length, unknown: unknown.length,
    sqft: { all: sqft(units), occupied: sqft(occupied), vacant: sqft(vacant), unknown: sqft(unknown) },
    passingRent: total(units.map(u => u.passingRent)),
    mix,
    roll: rollYears(leaseRoll(units.map(u => unitRow(scheme, u)))),
    lettings: units.filter(u => !!u.stage).map(u => ({
      unit: u.label, inUnit: u.occupancy === "occupied" ? brandOf(u) || "" : UNIT_OCCUPANCY_LABELS[u.occupancy],
      stage: stageLabel(u.stage) || "", stageCode: String(u.stage), lettingTo: u.deal?.tenant || "", ref: u.deal?.ref ?? null,
      days: u.deal?.days ?? null, daysConfirmed: !!u.deal?.daysConfirmed,
    })),
    targets: plan ? targetTenants(plan.lines, ctx.period, londonDay(ctx.madeAt)) : null,
    periodLabel: ctx.period.label,
  });
}

async function activitySlides(ctx: Ctx, viewer: LandsecViewer): Promise<Deck> {
  const schemeOfProperty = new Map<string, string>();
  for (const s of ctx.schemes) for (const p of s.properties) schemeOfProperty.set(p.id, s.name);
  const today = londonDay(ctx.madeAt);
  const [rows, viewings] = await Promise.all([
    activityRows(ctx),
    // Read as a Landsec login reads the viewings list, whoever asks.
    listLeasingViewings({ companyId: viewer.companyId, propertyIds: new Set(schemeOfProperty.keys()), jointAgent: false }),
  ]);
  return activityDeck({
    period: { label: ctx.period.label, from: ctx.period.from, to: ctx.period.to },
    schemes: ctx.schemes.map(s => ({ key: s.key, name: s.name })),
    footer: deckFooter(ctx),
    rows: rows.map(r => ({
      scheme: r.scheme, unit: r.unit, brand: r.brand, deal: r.deal, stage: r.stage, stageCode: r.stageCode, live: r.live === "Live",
      daysAtStage: r.daysAtStage, daysConfirmed: r.daysDate !== "No", waitingOn: r.waitingOn, movedInPeriod: r.movedInPeriod,
    })),
    viewings: viewings
      .filter(v => v.propertyId && schemeOfProperty.has(v.propertyId))
      .map(v => ({ day: reportDay(v.viewingDate), status: v.status ? String(v.status) : null, scheme: schemeOfProperty.get(v.propertyId!)! }))
      .filter(v => viewingHeld(v, ctx.period, today))
      .map(v => ({ day: v.day!, scheme: v.scheme })),
  });
}

/** The slides of one of the three decks, by its report key. */
export async function landsecDeck(key: string, ctx: Ctx, viewer: LandsecViewer): Promise<Deck> {
  switch (key) {
    case "board-report": return boardSlides(ctx, viewer);
    case "market-report": return marketSlides(ctx, viewer);
    case "asset-profile": return assetSlides(ctx, viewer);
    case "leasing-activity-pdf": return activitySlides(ctx, viewer);
    default: throw new Error(`No deck for report ${key}`);
  }
}
