// ChatBGP's two read tools for units and for what a deal is waiting on
// (15 November 2026; Woody: "do you need to fix some more stuff", after
// ChatBGP told a Landsec login that Burger King was not at Bluewater and that
// nothing recorded what its unit's letting was waiting on).
//
// The rule: THE SAME FEEDS AS THE PAGES. Nothing here queries the schedule,
// the tracker or the deal clock for itself.
//  - get_property_units reads the property page's unit feed
//    (server/property-units.ts): propertyReadBlocked is the read check,
//    loadPropertyUnits / loadPropertyUnitDetail the data, and unitsForViewer /
//    unitViewerFor the cut for a client login.
//  - get_deal_waiting_on reads the deal clock feed the Deals page reads
//    (landsecDealsFeed in server/landsec-unit.ts, which is waitingClockFor
//    over the clock and the checklist) and the open checklist items the
//    Waiting on editor is given (waitingOptionsForDeal in
//    server/deal-checklist.ts, which checks briefAccess itself).
// So a login gets from ChatBGP what its own pages give it and nothing more:
// a property outside its company or its schemes is not found, and a deal
// outside its schemes is not in its clock feed. What goes to the model is
// built field by field below: a fee, BGP's notes on a target, an email or an
// internal agent is never named, so it never goes.
//
// For BGP staff and client logins. A joint agent has its own allow-list
// (server/chatbgp-joint-agent.ts) and never reaches these.
import type { Request } from "express";
import { pool } from "./db";
import { propertyReadBlocked, unitViewerFor, loadPropertyUnits, loadPropertyUnitDetail, unitsForViewer } from "./property-units";
import { landsecDealsFeed } from "./landsec-unit";
import { waitingOptionsForDeal } from "./deal-checklist";
import { UNIT_OCCUPANCY_LABELS, unitMatchesFilter, type PropertyUnit, type PropertyUnitDeal, type PropertyUnitDetail, type PropertyUnitsFeed, type UnitFilter } from "@shared/property-units";
import { statusLabelsFor } from "@shared/letting-rules";
import { CHECKLIST_STAGES } from "@shared/deal-checklist";
import type { WaitingOptions } from "@shared/deal-waiting";

export const UNIT_TOOL_NAMES = ["get_property_units", "get_deal_waiting_on"] as const;

export const UNIT_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_property_units",
      description: "Read the units of one property from the property page's own unit list (the tenancy schedule joined to the Letting Tracker and the live transactions). For each unit: its label and floor, the tenant and brand in it, size, passing rent, lease start, expiry, breaks and next review, whether it is occupied or vacant, the letting stage, the live transaction's ref and tenant, whether it has a Targeting Brief, and for a unit in a live letting who that letting is waiting on. Use this FIRST for 'who is in unit X', 'which unit is <brand> in', 'when does <tenant>'s lease end', 'what is vacant at <property>', 'what is the <brand> unit waiting on'. Give the property by name or id, and a search word (unit number, tenant or brand) to narrow it. This is the current record: prefer it to query_leasing_schedule, which reads the older leasing schedule board and can miss a tenant.",
      parameters: {
        type: "object",
        properties: {
          property: { type: "string", description: "The property's name (part of it is enough, e.g. 'Bluewater') or its id" },
          search: { type: "string", description: "Optional. A unit number or label, a tenant, a trading name or a brand, e.g. 'L057' or 'Burger King'" },
          filter: { type: "string", enum: ["all", "vacant", "live", "deals", "expiring"], description: "Optional. vacant = vacant units; live = units in a live letting; transactions = units with any open transaction; expiring = lease expiry or break within 12 months" },
          limit: { type: "number", description: "Most units to return (default 25, at most 60)" },
        },
        required: ["property"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_deal_waiting_on",
      description: "What a live transaction or letting is waiting on, from the transaction clock the Transactions page shows: its stage, the days at that stage, who it is waiting on (the person and the party), since when, the transaction checklist item that points at, what it depends on, and the next open checklist items with who is responsible for each. Find the transaction by dealRef or dealId, or by a property with a search word (the unit, the incoming tenant, or the brand in the unit now), or by a search word alone. With waitingOn it lists the transactions waiting on that person or party; with nothing it lists every transaction that is waiting on someone. Use for 'what is this transaction waiting on', 'who is holding up X', 'what is next on the checklist', 'which transactions are waiting on me'. For one or two transactions it also gives the unit as the property page shows it (who is in it now, size, rent, lease dates, the offers on it). Asked about a unit, say who is in it now and until when, then the letting running on it and who that letting is with (the agreed offer names the incoming tenant when the transaction does not yet), then who it is waiting on and for what. The waiting-on is recorded: never say it is not, and never answer this from the leasing schedule.",
      parameters: {
        type: "object",
        properties: {
          dealRef: { type: "string", description: "The transaction's Ref number" },
          dealId: { type: "string", description: "The transaction's id" },
          property: { type: "string", description: "The property's name or id" },
          search: { type: "string", description: "A unit, a tenant or a brand, e.g. 'Burger King' or 'L057'" },
          waitingOn: { type: "string", description: "A person's name or a party (e.g. 'Tenant', 'Landsec leasing manager') to list the transactions waiting on them" },
          limit: { type: "number", description: "Most transactions to return (default 10, at most 25)" },
        },
        required: [],
      },
    },
  },
];

// ── Pure parts (tested in server/chatbgp-unit-tools.test.ts) ─────────────

const str = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIT_FILTERS: UnitFilter[] = ["all", "vacant", "live", "deals", "expiring"];

export interface UnitToolArgs { property: string; search: string; filter: UnitFilter; limit: number }
export function unitToolArgs(raw: any): UnitToolArgs {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const filter = UNIT_FILTERS.includes(a.filter) ? a.filter : "all";
  const limit = Math.min(60, Math.max(1, Math.floor(Number(a.limit)) || 25));
  return { property: str(a.property ?? a.propertyName ?? a.propertyId), search: str(a.search ?? a.unit ?? a.tenant ?? a.brand), filter, limit };
}

export interface WaitingToolArgs { dealRef: string; dealId: string; property: string; search: string; waitingOn: string; limit: number }
export function waitingToolArgs(raw: any): WaitingToolArgs {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const limit = Math.min(25, Math.max(1, Math.floor(Number(a.limit)) || 10));
  return {
    dealRef: str(a.dealRef ?? a.ref, 20).replace(/^#/, ""), dealId: str(a.dealId, 60), property: str(a.property ?? a.propertyName ?? a.propertyId),
    search: str(a.search ?? a.unit ?? a.tenant ?? a.brand), waitingOn: str(a.waitingOn), limit,
  };
}

// Words that say nothing about which unit or deal is meant.
const FILLER = new Set(["the", "a", "an", "at", "in", "of", "on", "for", "and", "unit", "units", "shop", "store", "lease", "deal", "letting", "tenant", "brand"]);
const plain = (value: unknown): string => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const searchWords = (search: string): string[] => plain(search).split(" ").filter(w => w && !FILLER.has(w));

/** Every word of the search is somewhere in what the row says. No words = everything matches. */
export function textMatches(search: string, ...parts: unknown[]): boolean {
  const words = searchWords(search);
  if (words.length === 0) return true;
  const hay = ` ${parts.map(plain).filter(Boolean).join(" ")} `;
  return words.every(w => hay.includes(w));
}

export const unitMatches = (unit: PropertyUnit, search: string): boolean =>
  textMatches(search, unit.label, unit.floor, unit.grouping, unit.tenant.name, unit.tenant.tradingName, unit.tenant.legalName, unit.tenant.companyName,
    unit.tenant.entityName, unit.deal?.tenant, unit.deal?.name, unit.deal?.ref);

const stageLabel = (code: string | null | undefined, dealType?: string | null): string | null =>
  code ? (statusLabelsFor(dealType ?? "New Letting") as Record<string, string>)[code] || code : null;

const dealLine = (deal: PropertyUnitDeal) => ({
  dealId: deal.id, ref: deal.ref, name: deal.name, type: deal.type, tenant: deal.tenant,
  stage: stageLabel(deal.code, deal.letting ? "New Letting" : deal.type), daysAtStage: deal.days, daysAtStageConfirmed: deal.daysConfirmed,
});

const FLAG_WORDS: Array<[keyof PropertyUnit["flags"], string]> = [
  ["expiryOrBreakSoon", "Lease expiry or break within 12 months"],
  ["vacantNoLetting", "Vacant with no letting running"],
  ["stuck", "Letting at its stage for 30 days or more"],
  ["noAgreedBrief", "No agreed Targeting Brief"],
  ["notOnSchedule", "On the Letting Tracker only, not on the tenancy schedule"],
  ["noLeaseCompany", "No company on the lease recorded"],
];

/** One unit as the model is given it. Built from the unit AS CUT FOR THE
 *  VIEWER, key by key: a field the cut blanked is not written, and a field
 *  not named here never goes. */
export function unitLine(unit: PropertyUnit) {
  const t = unit.tenant;
  const out: Record<string, unknown> = {
    unitId: unit.id, trackerUnitId: unit.trackerId, unit: unit.label, floor: unit.floor, grouping: unit.grouping, use: unit.use,
    occupancy: UNIT_OCCUPANCY_LABELS[unit.occupancy],
    tenant: t.name, brand: t.companyName, leaseName: t.legalName, companyOnLease: t.entityName, companiesHouseNumber: t.companiesHouseNumber,
    sqft: unit.sqft, passingRentPa: unit.passingRent, quotingRentPa: unit.quotingRent,
    leaseStart: unit.leaseStart, leaseExpiry: unit.leaseExpiry, tenantBreak: unit.breakDate, landlordBreak: unit.landlordBreakDate, nextReview: unit.nextReview,
    lettingStage: stageLabel(unit.stage),
    deal: unit.deal ? dealLine(unit.deal) : null,
    brief: unit.brief === "agreed" ? "Agreed" : unit.brief === "drafted" ? "Drafted, not agreed" : "None",
    viewings: unit.counts.viewings, offers: unit.counts.offers, targets: unit.counts.targets,
  };
  const flags = FLAG_WORDS.filter(([key]) => unit.flags[key]).map(([, words]) => words);
  if (flags.length) out.flags = flags;
  for (const key of Object.keys(out)) if (out[key] == null) delete out[key];
  return out;
}

const short = (value: string | null, max = 400): string | null => (value && value.length > max ? `${value.slice(0, max)}…` : value);

/** What the unit panel shows beyond the line, again from the detail as the
 *  feed cut it for the viewer (a brand's contact at a viewing is BGP's). */
export function unitDetailLines(detail: PropertyUnitDetail) {
  const s = detail.schedule, tr = detail.tracker, b = detail.brief;
  const tidy = (o: Record<string, unknown>) => { for (const k of Object.keys(o)) if (o[k] == null || o[k] === "") delete o[k]; return o; };
  return tidy({
    lease: s ? tidy({
      termYears: s.termYears, breakType: s.breakType, breakDetails: s.breakDetails, breakNotice: s.breakNotice, reviewBasis: s.reviewBasis,
      rentPsf: s.rentPsf, turnoverPercent: s.turnoverPercent, serviceCharge: s.serviceCharge, insurance: s.insurance, ratesPayable: s.ratesPayable,
      outsideLandlordAndTenantAct: s.outsideLtAct, comments: short(s.comments), leasingComments: short(s.leasingComments),
    }) : null,
    marketing: tr ? tidy({
      quotingRentPa: tr.quotingRent, rentOnApplication: tr.rentOnApplication || null, leaseTerms: short(tr.leaseTerms), availableDate: tr.availableDate, onWebsite: tr.onWebsite,
      viewings: tr.viewings.map(v => tidy({ company: v.company, contact: v.contact, date: v.date, outcome: v.outcome, status: v.status })),
      offers: tr.offers.map(o => tidy({ company: o.company, date: o.date, rentPa: o.rentPa, rentFreeMonths: o.rentFreeMonths, termYears: o.termYears, status: o.status })),
    }) : null,
    targetingBrief: b ? tidy({ title: b.title, agreed: b.agreed, targets: b.targets.slice(0, 15).map(x => tidy({ name: x.name, status: x.status, priority: x.priority })) }) : null,
    openDeals: detail.deals.length > 1 ? detail.deals.map(dealLine) : null,
  });
}

const dayOf = (value: unknown): string | null => {
  if (!value) return null;
  const d = new Date(value as any);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
// A checklist stage covers more than one deal stage ("Negotiating" runs
// through HOTs), so it is given with the deal stages it covers.
const checklistStageLabel = (key: string | null | undefined): string | null => {
  const stage = CHECKLIST_STAGES.find(s => s.key === key);
  return stage ? `${stage.label} (covers ${stage.codes.map(c => stageLabel(c)).join(", ")})` : null;
};

/** A deal's clock as the model is given it, from one row of the clock feed
 *  (GET /api/landsec/deals). The feed row carries BGP's fee for staff: it is
 *  not named here, so it goes to nobody. */
export function waitingLine(deal: any, options?: WaitingOptions | null, openItems = 5) {
  const clock = deal?.clock || null;
  const named = !!clock && !!(clock.waitingOnName || clock.waitingOnParty);
  const out: Record<string, unknown> = {
    dealId: deal.id, ref: deal.ref ?? null, deal: deal.name || null, dealType: deal.dealType || null, incomingTenant: deal.tenant || null,
    scheme: deal.scheme?.name || null, unit: deal.unit || null, trackerUnitId: deal.trackerId || null,
    stage: stageLabel(deal.code, deal.dealType), daysAtStage: deal.days ?? null, daysAtStageConfirmed: deal.stageConfirmed ?? null,
    waitingOn: named ? {
      person: clock.waitingOnName || null, party: clock.waitingOnParty || null,
      since: dayOf(clock.waitingSince), days: deal.waitingDays ?? null,
      checklistItem: clock.checklistItemLabel || null,
      note: clock.waitingNote && clock.waitingNote !== clock.checklistItemLabel ? clock.waitingNote : null,
      source: clock.derived ? "The next open item on the deal checklist" : "Set on the deal",
    } : null,
    dependsOn: clock?.dependsOnHidden ? "Another transaction" : clock?.dependsOn ? [clock.dependsOn.ref != null ? `Ref ${clock.dependsOn.ref}` : null, clock.dependsOn.name, clock.dependsOn.unit].filter(Boolean).join(", ") : null,
    brief: deal.brief === "agreed" ? "Agreed" : deal.brief === "drafted" ? "Drafted, not agreed" : deal.brief === undefined ? null : "None",
  };
  if (named) { const w = out.waitingOn as Record<string, unknown>; for (const key of Object.keys(w)) if (w[key] == null) delete w[key]; }
  else out.waitingOnNote = "Nobody is named as who this transaction is waiting on.";
  if (options) out.checklist = checklistLines(options, openItems);
  for (const key of Object.keys(out)) if (out[key] == null) delete out[key];
  return out;
}

/** The open checklist items, in the order the checklist runs, with who has each. */
export function checklistLines(options: WaitingOptions, openItems = 5) {
  if (!options.started) return { started: false, note: "No transaction checklist has been started for this letting." };
  return {
    started: true, stage: checklistStageLabel(options.stage), openItemCount: options.items.length,
    nextOpenItems: options.items.slice(0, openItems).map(i => {
      const line: Record<string, unknown> = { stage: checklistStageLabel(i.stage), item: i.label, required: i.required };
      if (i.person?.name) line.responsible = i.viaDeal ? `${i.person.name} (responsible for the letting)` : i.person.name;
      else line.responsible = "Nobody yet";
      if (i.party) line.party = i.party;
      return line;
    }),
  };
}

/** A deal the clock feed does not hold (a property outside the Landsec
 *  schemes): its stage and days from the unit feed, and no waiting-on clock. */
export function unitDealAsClockRow(unit: PropertyUnit | null, deal: PropertyUnitDeal, propertyName: string, propertyId: string) {
  return {
    id: deal.id, ref: deal.ref, name: deal.name, dealType: deal.type, tenant: deal.tenant, scheme: { name: propertyName }, propertyId,
    unit: unit?.label ?? null, trackerId: unit?.trackerId ?? null, code: deal.code, days: deal.days, stageConfirmed: deal.daysConfirmed,
    clock: null, waitingDays: null, brief: unit ? unit.brief : undefined,
  };
}

// ── The run ──────────────────────────────────────────────────────────────

type Db = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
export interface UnitToolDeps {
  db: Db;
  propertyReadBlocked: typeof propertyReadBlocked;
  unitViewerFor: typeof unitViewerFor;
  loadPropertyUnits: typeof loadPropertyUnits;
  loadPropertyUnitDetail: typeof loadPropertyUnitDetail;
  unitsForViewer: typeof unitsForViewer;
  landsecDealsFeed: typeof landsecDealsFeed;
  waitingOptionsForDeal: typeof waitingOptionsForDeal;
}
const LIVE: UnitToolDeps = { db: pool, propertyReadBlocked, unitViewerFor, loadPropertyUnits, loadPropertyUnitDetail, unitsForViewer, landsecDealsFeed, waitingOptionsForDeal };

const NOT_FOUND = "No property of that name is open to this account.";
const PLACE_FILLER = new Set(["shopping", "centre", "center", "retail", "park", "the", "and", "outlet"]);
const likeText = (value: string) => `%${value.replace(/[\\%_]/g, m => `\\${m}`)}%`;

// The properties a name or id could mean, that THIS caller may open. A name
// is tried whole, then by its telling words. A landlord that has switched AI
// off is left out, as ChatBGP's other reads leave it out. propertyReadBlocked
// decides every candidate before anything about it is used, so a property
// outside the caller's company or schemes is simply not found.
async function openProperties(req: Request, text: string, deps: UnitToolDeps): Promise<Array<{ id: string; name: string }>> {
  const base = `SELECT p.id, p.name FROM crm_properties p LEFT JOIN crm_companies c ON c.id = p.landlord_id
                 WHERE (c.ai_disabled IS NULL OR c.ai_disabled = FALSE)`;
  let rows: any[] = [];
  if (UUID.test(text)) rows = (await deps.db.query(`${base} AND p.id = $1`, [text])).rows;
  else {
    rows = (await deps.db.query(`${base} AND p.name ILIKE $1 ORDER BY (lower(p.name) = lower($2)) DESC, length(p.name), p.name LIMIT 25`, [likeText(text), text])).rows;
    if (rows.length === 0) {
      const words = plain(text).split(" ").filter(w => w.length >= 3 && !PLACE_FILLER.has(w)).slice(0, 4);
      if (words.length) rows = (await deps.db.query(`${base} AND p.name ILIKE ANY($1::text[]) ORDER BY length(p.name), p.name LIMIT 25`, [words.map(likeText)])).rows;
    }
  }
  const open: Array<{ id: string; name: string }> = [];
  for (const row of rows) if (!(await deps.propertyReadBlocked(req, row.id))) open.push({ id: row.id, name: row.name });
  const exact = open.filter(p => plain(p.name) === plain(text));
  return exact.length === 1 ? exact : open;
}

// The unit feed for one property, cut for the caller exactly as the route
// GET /api/properties/:id/units cuts it.
type UnitsRead = { feed: PropertyUnitsFeed; viewer: { staff: boolean; jointAgent: boolean } };
async function unitsFeedFor(req: Request, propertyId: string, deps: UnitToolDeps): Promise<UnitsRead | null> {
  if (await deps.propertyReadBlocked(req, propertyId)) return null;
  const feed = await deps.loadPropertyUnits(deps.db, propertyId);
  if (!feed) return null;
  const viewer = await deps.unitViewerFor(req);
  return { feed: deps.unitsForViewer(feed, viewer), viewer };
}

// One unit as its panel on the property page shows it: the line and the detail.
async function unitPicture(read: UnitsRead, unit: PropertyUnit, deps: UnitToolDeps): Promise<Record<string, unknown>> {
  const detail = await deps.loadPropertyUnitDetail(deps.db, read.feed.property.id, unit.id, read.viewer).catch(() => null);
  return { ...unitLine(unit), ...(detail ? unitDetailLines(detail) : {}) };
}

// The clock feed's rows for these deals, each with its open checklist items
// (for the first few only: the checklist read is several queries a deal).
async function waitingFor(req: Request, rows: any[], deps: UnitToolDeps, withChecklist = 5) {
  const out: Record<string, unknown>[] = [];
  for (const [index, row] of rows.entries()) {
    let options: WaitingOptions | null = null;
    if (index < withChecklist) options = await deps.waitingOptionsForDeal(req, row.id).catch(() => null);
    out.push(waitingLine(row, options));
  }
  return out;
}

async function runPropertyUnits(raw: any, req: Request, deps: UnitToolDeps) {
  const args = unitToolArgs(raw);
  if (!args.property) return { error: "Say which property: its name or its id." };
  const properties = await openProperties(req, args.property, deps);
  if (properties.length === 0) return { found: false, message: NOT_FOUND };
  if (properties.length > 4) return { found: false, message: "More than one property matches. Ask which one is meant, then call again with its name.", properties: properties.slice(0, 15).map(p => p.name) };

  const clock = await deps.landsecDealsFeed(req).catch(() => null);
  const results: Record<string, unknown>[] = [];
  for (const property of properties) {
    const read = await unitsFeedFor(req, property.id, deps);
    if (!read) continue;
    const { feed } = read;
    const matched = feed.units.filter(u => unitMatchesFilter(u, args.filter) && unitMatches(u, args.search));
    const shown = matched.slice(0, args.limit);
    const lines: Record<string, unknown>[] = [];
    for (const [index, unit] of shown.entries()) {
      // A handful of units: the unit panel's detail and the letting's clock too.
      const line = shown.length <= 3 ? await unitPicture(read, unit, deps) : unitLine(unit);
      if (unit.deal && index < 5 && shown.length <= 5) {
        const row = clock?.deals.find((d: any) => d.id === unit.deal!.id);
        if (row) line.dealWaitingOn = (await waitingFor(req, [row], deps))[0];
      }
      lines.push(line);
    }
    const c = feed.counts;
    results.push({
      property: feed.property.name, propertyId: feed.property.id,
      counts: { units: c.units, occupied: c.occupied, vacant: c.vacant, notRecorded: c.unknown, liveLettings: c.liveLettings, expiryOrBreakWithin12Months: c.expiryOrBreakSoon },
      matched: matched.length, shown: lines.length, units: lines,
      ...(matched.length === 0 && args.search ? { message: `No unit at ${feed.property.name} matches "${args.search}". Try the unit number, or the tenant's trading name.` } : {}),
    });
  }
  if (results.length === 0) return { found: false, message: NOT_FOUND };
  return { found: true, source: "The property page's unit list (tenancy schedule, Letting Tracker and live deals)", properties: results };
}

async function runDealWaitingOn(raw: any, req: Request, deps: UnitToolDeps) {
  const args = waitingToolArgs(raw);
  const clock = await deps.landsecDealsFeed(req);
  const clockDeals: any[] = clock?.deals || [];
  const source = "The transaction clock the Transactions page shows, and the transaction checklist";
  const rows = new Map<string, any>();
  const notes: string[] = [];

  if (args.dealId || args.dealRef) {
    const inClock = clockDeals.find(d => (args.dealId && d.id === args.dealId) || (args.dealRef && String(d.ref ?? "") === args.dealRef));
    if (inClock) rows.set(inClock.id, inClock);
    else {
      // Not in the clock feed: a deal off the Landsec schemes, a closed one,
      // or one this caller may not open. Its property decides, by the unit
      // feed's own read check.
      const ref = Number(args.dealRef);
      const deal = (await deps.db.query(`SELECT id, property_id FROM crm_deals WHERE ($1 <> '' AND id = $1) OR ($2::int IS NOT NULL AND deal_ref = $2::int) LIMIT 1`,
        [args.dealId, args.dealRef && Number.isInteger(ref) ? ref : null])).rows[0];
      const read = deal?.property_id ? await unitsFeedFor(req, deal.property_id, deps) : null;
      const unit = read?.feed.units.find(u => u.deal?.id === deal.id) || null;
      const open = unit?.deal || read?.feed.unplacedDeals.find(d => d.id === deal.id) || null;
      if (!read || !open) return { found: false, message: "No live transaction with that reference is open to this account." };
      rows.set(open.id, unitDealAsClockRow(unit, open as PropertyUnitDeal, read.feed.property.name, read.feed.property.id));
      notes.push("This property has no waiting-on clock: the stage and the checklist are what is recorded.");
    }
  } else if (args.property) {
    const properties = await openProperties(req, args.property, deps);
    if (properties.length === 0) return { found: false, message: NOT_FOUND };
    if (properties.length > 4) return { found: false, message: "More than one property matches. Ask which one is meant, then call again with its name.", properties: properties.slice(0, 15).map(p => p.name) };
    const ids = new Set(properties.map(p => p.id));
    // The clock feed's own rows at the property (the incoming tenant, the unit, the deal's name)...
    for (const d of clockDeals) if (ids.has(d.propertyId) && textMatches(args.search, d.name, d.tenant, d.unit, d.ref)) rows.set(d.id, d);
    // ...and the units the search finds on the unit list, so "the Burger King
    // unit" finds the letting running on the unit Burger King is in.
    const noDeal: string[] = [];
    for (const property of properties) {
      const read = await unitsFeedFor(req, property.id, deps);
      if (!read) continue;
      for (const unit of read.feed.units) {
        if (args.search && !unitMatches(unit, args.search)) continue;
        if (!unit.deal) { if (args.search) noDeal.push(`${unit.label}${unit.tenant.name ? ` (${unit.tenant.name})` : ""}`); continue; }
        if (!rows.has(unit.deal.id)) rows.set(unit.deal.id, clockDeals.find(d => d.id === unit.deal!.id) || unitDealAsClockRow(unit, unit.deal, read.feed.property.name, read.feed.property.id));
      }
    }
    if (noDeal.length) notes.push(`No live transaction on: ${noDeal.slice(0, 8).join("; ")}. A unit with no live transaction is waiting on no one.`);
  } else {
    if (!clock) return { found: false, message: "Say which property the transaction is at, or give its Ref number." };
    for (const d of clockDeals) {
      if (args.search && !textMatches(args.search, d.name, d.tenant, d.unit, d.scheme?.name, d.ref)) continue;
      if (!args.search && !(d.clock?.waitingOnName || d.clock?.waitingOnParty)) continue;
      rows.set(d.id, d);
    }
  }

  let list = Array.from(rows.values());
  if (args.waitingOn) list = list.filter(d => textMatches(args.waitingOn, d.clock?.waitingOnName, d.clock?.waitingOnParty));
  if (list.length === 0) return { found: false, source, message: notes[0] || "No live transaction open to this account matches that.", ...(notes.length > 1 ? { notes } : {}) };
  const shown = list.slice(0, args.limit);
  const deals = await waitingFor(req, shown, deps, shown.length <= 5 ? 5 : 0);
  // One or two deals: the unit each is on, as the property page shows it (who
  // is in it now, its lease, the offers on it), by the unit feed's own check.
  if (shown.length <= 2) {
    for (const [index, row] of shown.entries()) {
      const read = row.propertyId ? await unitsFeedFor(req, row.propertyId, deps).catch(() => null) : null;
      const unit = read?.feed.units.find(u => u.deal?.id === row.id || (row.unitId && u.id === row.unitId) || (row.trackerId && u.trackerId === row.trackerId));
      if (read && unit) { const { deal: _deal, ...picture } = await unitPicture(read, unit, deps); deals[index].unitNow = picture; }
    }
  }
  return { found: true, source, matched: list.length, shown: shown.length, deals, ...(notes.length ? { notes } : {}) };
}

/** The one door from server/chatbgp.ts (executeCrmToolRaw, after its client
 *  and joint agent gates). Read only: nothing is written and no checklist is
 *  started by asking. */
export async function runUnitTool(fnName: string, fnArgs: any, req: Request, deps: UnitToolDeps = LIVE): Promise<{ data: any }> {
  try {
    if (fnName === "get_property_units") return { data: await runPropertyUnits(fnArgs, req, deps) };
    if (fnName === "get_deal_waiting_on") return { data: await runDealWaitingOn(fnArgs, req, deps) };
    return { data: { error: "Unknown tool" } };
  } catch (error: any) {
    console.error(`[chatbgp-unit-tools] ${fnName}:`, error?.message);
    return { data: { error: "That could not be read just now. Nothing was changed." } };
  }
}
