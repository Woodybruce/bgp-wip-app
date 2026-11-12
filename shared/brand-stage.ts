// Brand CRM: where a brand stands at a unit (docs/brand-crm-spec-2026-11-12.md,
// 2.1.2 and 2.1.3; Woody, 2026-11-12: "rethink the stage names").
//
// The stage belongs to a brand AT A UNIT (or at a scheme, before a unit is
// picked). Nobody types it: it is read from the records the app already
// holds (wishes, targets, viewings, offers, deals, tenancies), and the
// furthest live evidence wins. The words follow the Letting Tracker so the
// two cannot disagree. Shared by the server, the screens and the tests: no
// node imports here.
import { legacyToCode, type DealStatusCode } from "./deal-status";
import { isLettingType, LETTING_STATUS_LABELS, TENANT_REP_TYPES } from "./letting-rules";
import { parseReqSize } from "./requirement-fit";

// ── Stages ───────────────────────────────────────────────────────────────
export const RANKED_BRAND_STAGES = ["wanted", "unit_identified", "approached", "viewed", "negotiating", "hots", "solicitors", "let", "trading"] as const;
export type RankedBrandStage = (typeof RANKED_BRAND_STAGES)[number];
export type BrandStage = RankedBrandStage | "not_proceeding" | "disposing";
export const BRAND_STAGES: BrandStage[] = [...RANKED_BRAND_STAGES, "not_proceeding", "disposing"];

export const BRAND_STAGE_LABELS: Record<BrandStage, string> = {
  wanted: "Wanted",
  unit_identified: "Unit identified",
  approached: "Approached",
  viewed: "Viewed",
  negotiating: "Negotiating",
  hots: "HOTs",
  solicitors: "Solicitors",
  let: "Let",
  trading: "Trading",
  not_proceeding: "Not proceeding",
  disposing: "Disposing",
};

export const BRAND_STAGE_MEANINGS: Record<BrandStage, string> = {
  wanted: "We want them in this scheme and no unit is picked yet.",
  unit_identified: "A unit is named for them and they have not been approached on it.",
  approached: "The unit has been put to the brand or its agent, or a viewing is booked.",
  viewed: "They have inspected the unit.",
  negotiating: "An offer is in or terms are being traded.",
  hots: "Heads of terms are agreed.",
  solicitors: "The letting is in legals.",
  let: "Exchanged or completed, and not yet open.",
  trading: "They are the tenant there today.",
  not_proceeding: "It stopped.",
  disposing: "The brand is giving this unit up.",
};

/** 1 (Wanted) to 9 (Trading); 0 for Not proceeding and Disposing, which are never ranked as a target. */
export const brandStageRank = (stage: BrandStage): number => RANKED_BRAND_STAGES.indexOf(stage as RankedBrandStage) + 1;

export const NOT_PROCEEDING_REASONS = {
  brandPassed: "Brand passed",
  landlordDeclined: "Landlord declined",
  withdrawn: "Withdrawn",
  otherBrand: "Unit went to another brand",
} as const;

// ── Evidence ─────────────────────────────────────────────────────────────
// One record that says something about a brand at a unit. `status` is the
// record's own status word, exactly as stored.
export type EvidenceSrc =
  | "trading"          // tenancy or leasing schedule row naming the brand as tenant
  | "deal"             // crm_deals row naming the brand as tenant
  | "hots"             // heads of terms issued from the brand's offer, before the deal names the tenant
  | "offer"            // unit_offers
  | "viewing"          // unit_viewings
  | "interest"         // unit_interest
  | "share"            // unit_shares: the unit was sent to the brand (BGP only)
  | "tracker_target"   // unit_target_operators on the unit's Targeting Brief
  | "schedule_target"  // target_tenants on the leasing schedule
  | "target_list"      // target_company_ids on a leasing or tenancy schedule row
  | "case_unit"        // a proposed unit on the Landsec brand case
  | "wish"             // a Wanted line (brand_scheme_targets)
  | "name_match";      // the brand's name typed into a target list, with no link (BGP only)

export interface StageEvidence {
  src: EvidenceSrc;
  status?: string | null;
  at?: string | null;            // when the record reached this state
  dealType?: string | null;      // deal
  dealRef?: number | string | null;
  outcome?: string | null;       // schedule_target
  hasUnit?: boolean;             // wish, case_unit: a unit is picked
  ruledOut?: boolean;            // wish
  reason?: string | null;        // wish: why it was ruled out
  detail?: string | null;        // a short tail for the evidence line (never a note)
  byName?: boolean;
  internal?: boolean;            // BGP only: removed before a client viewer's stage is worked out
  refId?: string | null;
}

export interface EvidenceReading {
  stage: BrandStage;
  live: boolean;                 // false = it only explains why the row stopped
  label: string;
  reason?: string;               // not_proceeding
  note?: string;                 // said beside the stage, never moves it
}

const TRACKER_TARGET_STAGE: Record<string, BrandStage> = {
  "identified": "unit_identified",
  "approached": "approached",
  "meeting held": "approached",
  "inspection done": "viewed",
  "offer": "negotiating",
  "negotiating": "negotiating",
  "heads of terms": "hots",
  "in sols": "solicitors",
  "let": "let",
  "passed": "not_proceeding",
};

const DEAL_STAGE: Partial<Record<DealStatusCode, BrandStage>> = {
  OPP: "approached", REP: "approached", SPEC: "approached", LIVE: "approached", AVA: "approached",
  NEG: "negotiating", HOT: "hots", SOL: "solicitors", EXC: "let", COM: "let", INV: "let",
  WIT: "not_proceeding", ARCH: "not_proceeding",
};

const DISPOSAL_TYPES = ["Lease Disposal", "Sub-Letting"];
const lower = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
export const isAgreedOfferStatus = (status: string | null | undefined) => /^(agreed|accept)/i.test(String(status ?? "").trim());

/** What one record says. Null = it says nothing about a stage (an AI
 *  suggestion nobody approved, an offer from an earlier letting, advisory
 *  work on the unit). */
export function readEvidence(e: StageEvidence): EvidenceReading | null {
  const st = lower(e.status);
  const tail = e.detail ? `, ${e.detail}` : "";
  switch (e.src) {
    case "trading":
      return { stage: "trading", live: true, label: "Tenant on the schedule" };
    case "deal": {
      const type = String(e.dealType ?? "").trim();
      const code = legacyToCode(e.status);
      const ref = e.dealRef != null && e.dealRef !== "" ? ` #${e.dealRef}` : "";
      if (DISPOSAL_TYPES.includes(type)) {
        // A disposal that has finished or been pulled is history, not a line.
        if (!code || ["EXC", "COM", "INV", "WIT", "ARCH"].includes(code)) return null;
        return { stage: "disposing", live: true, label: `${type}${ref}: ${LETTING_STATUS_LABELS[code]}` };
      }
      // Rent reviews, renewals, investment sales and the rest say nothing
      // about a letting. A deal with no type is read as a letting.
      if (type && !isLettingType(type) && !(TENANT_REP_TYPES as readonly string[]).includes(type)) return null;
      const stage = code ? DEAL_STAGE[code] : undefined;
      if (!code || !stage) return null;
      const label = `Deal${ref}: ${LETTING_STATUS_LABELS[code]}${tail}`;
      return stage === "not_proceeding" ? { stage, live: false, label, reason: NOT_PROCEEDING_REASONS.withdrawn } : { stage, live: true, label };
    }
    case "hots":
      return { stage: "hots", live: true, label: `Heads of terms ${st === "final" ? "agreed and filed" : "issued"}` };
    case "offer":
      if (st === "closed") return null;
      if (st === "rejected") return { stage: "not_proceeding", live: false, label: "Offer rejected", reason: NOT_PROCEEDING_REASONS.landlordDeclined };
      if (st === "withdrawn") return { stage: "not_proceeding", live: false, label: "Offer withdrawn", reason: NOT_PROCEEDING_REASONS.withdrawn };
      return { stage: "negotiating", live: true, label: `${isAgreedOfferStatus(e.status) ? "Offer agreed" : "Offer in"}${tail}` };
    case "viewing":
      if (st === "cancelled" || st === "not_leasing") return null;
      if (st === "completed") return { stage: "viewed", live: true, label: "Viewed the unit" };
      return { stage: "approached", live: true, label: st === "no_show" ? "Viewing booked, did not attend" : "Viewing booked" };
    case "interest":
      return { stage: "approached", live: true, label: "Interest logged" };
    case "share":
      return { stage: "approached", live: true, label: "Unit sent to the brand" };
    case "tracker_target": {
      const stage = TRACKER_TARGET_STAGE[st] || "unit_identified";
      const label = `Target on the unit's brief${e.status ? `: ${String(e.status).trim()}` : ""}`;
      return stage === "not_proceeding" ? { stage, live: false, label, reason: NOT_PROCEEDING_REASONS.brandPassed } : { stage, live: true, label };
    }
    case "schedule_target": {
      if (st === "suggested" || st === "rejected") return null;
      const outcome = lower(e.outcome);
      if (outcome === "signed") return { stage: "let", live: true, label: "Leasing schedule target: signed" };
      if (outcome === "passed") return { stage: "not_proceeding", live: false, label: "Leasing schedule target: passed", reason: NOT_PROCEEDING_REASONS.brandPassed };
      if (outcome === "withdrawn") return { stage: "not_proceeding", live: false, label: "Leasing schedule target: withdrawn", reason: NOT_PROCEEDING_REASONS.withdrawn };
      return { stage: "unit_identified", live: true, label: "Target on the leasing schedule" };
    }
    case "target_list":
      return { stage: "unit_identified", live: true, label: "On the unit's target list" };
    case "case_unit": {
      if (st === "declined") return { stage: "not_proceeding", live: false, label: "Brand case unit: declined", reason: NOT_PROCEEDING_REASONS.landlordDeclined };
      const reading: EvidenceReading = { stage: e.hasUnit ? "unit_identified" : "wanted", live: true, label: `Proposed in the brand case${tail}` };
      // "Under offer" on a brand case is picked by hand; it never moves the stage.
      if (st === "under offer") reading.note = "Marked under offer on the brand case";
      return reading;
    }
    case "wish":
      if (e.ruledOut) return { stage: "not_proceeding", live: false, label: "Wanted line ruled out", reason: String(e.reason ?? "").trim() || "Ruled out" };
      return { stage: e.hasUnit ? "unit_identified" : "wanted", live: true, label: e.hasUnit ? "Wanted in this unit" : "Wanted at this scheme" };
    case "name_match":
      return { stage: "unit_identified", live: true, label: `Named in a target list${tail}` };
  }
}

const time = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const t = Date.parse(String(at));
  return Number.isFinite(t) ? t : null;
};

// What else is known about the unit, for the two corrections the stage needs.
export interface UnitLettingContext {
  brandId: string;
  // The unit's latest closed letting (exchanged, completed or invoiced), whoever took it.
  lastClosedLetting?: { at: string | null; tenantId: string | null } | null;
  // The tenant named on the unit's live letting (Negotiating, HOTs or Solicitors).
  liveDealTenantId?: string | null;
}

export interface StageResult {
  stage: BrandStage;
  stageSince: string | null;
  notProceedingReason: string | null;
  evidence: Array<{ src: EvidenceSrc; label: string; at: string | null; byName?: boolean }>;
  notes: string[];
}

// Records from before the unit was last let belong to that earlier letting.
const DATED_SRCS: EvidenceSrc[] = ["viewing", "offer", "interest", "share", "tracker_target", "schedule_target", "hots"];

/** The stage of one brand at one unit. Null = nothing live and nothing that
 *  stopped: no row. */
export function resolveStage(evidence: StageEvidence[], ctx?: UnitLettingContext): StageResult | null {
  type Read = { e: StageEvidence; r: EvidenceReading; t: number | null };
  const read: Read[] = [];
  for (const e of evidence) { const r = readEvidence(e); if (r) read.push({ e, r, t: time(e.at) }); }
  if (read.length === 0) return null;

  const line = (x: Read) => ({ src: x.e.src, label: x.r.label, at: x.e.at || null, ...(x.e.byName ? { byName: true } : {}) });
  const byRank = (a: Read, b: Read) => (brandStageRank(b.r.stage) - brandStageRank(a.r.stage)) || ((b.t ?? 0) - (a.t ?? 0));
  const notes = Array.from(new Set(read.map(x => x.r.note).filter((n): n is string => !!n)));

  // Stale evidence: anything dated before the unit's last closed letting
  // belongs to that letting, unless the letting was the brand's own.
  const closed = ctx?.lastClosedLetting || null;
  const closedAt = closed && closed.tenantId !== ctx?.brandId ? time(closed.at) : null;
  const isStale = (x: Read) => closedAt !== null && x.t !== null && x.t < closedAt
    && (DATED_SRCS.includes(x.e.src) || (x.e.src === "deal" && x.r.stage !== "disposing" && (x.r.stage === "let" || !x.r.live)));
  const fresh = read.filter(x => !isStale(x));
  const stale = read.filter(isStale);

  const ownLetting = fresh.some(x => x.r.live && (x.e.src === "trading" || x.e.src === "deal" || x.e.src === "hots"));
  // The unit's live letting names someone else.
  if (ctx?.liveDealTenantId && ctx.liveDealTenantId !== ctx.brandId && !ownLetting) {
    return { stage: "not_proceeding", stageSince: null, notProceedingReason: NOT_PROCEEDING_REASONS.otherBrand, evidence: [...read].sort(byRank).map(line), notes };
  }

  const disposing = fresh.filter(x => x.r.stage === "disposing");
  if (disposing.length) {
    const since = disposing.map(x => x.t).filter((t): t is number => t !== null).sort((a, b) => a - b)[0];
    return { stage: "disposing", stageSince: since != null ? new Date(since).toISOString() : null, notProceedingReason: null, evidence: [...fresh].sort(byRank).map(line), notes };
  }

  const live = fresh.filter(x => x.r.live);
  if (live.length) {
    const top = Math.max(...live.map(x => brandStageRank(x.r.stage)));
    const winners = live.filter(x => brandStageRank(x.r.stage) === top);
    const since = winners.map(x => x.t).filter((t): t is number => t !== null).sort((a, b) => a - b)[0];
    return { stage: winners[0].r.stage, stageSince: since != null ? new Date(since).toISOString() : null, notProceedingReason: null, evidence: [...live].sort(byRank).map(line), notes };
  }

  const stopped = fresh.filter(x => x.r.stage === "not_proceeding").sort((a, b) => (b.t ?? 0) - (a.t ?? 0));
  if (stopped.length) {
    return { stage: "not_proceeding", stageSince: stopped[0].t != null ? new Date(stopped[0].t).toISOString() : null, notProceedingReason: stopped[0].r.reason || null, evidence: stopped.map(line), notes };
  }

  // Everything on file is from before the unit was let to someone else. A
  // brand whose own earlier letting there has since been replaced is history,
  // not a line.
  if (stale.length && closed?.tenantId && !stale.some(x => x.e.src === "deal" && x.r.stage === "let")) {
    return { stage: "not_proceeding", stageSince: closedAt != null ? new Date(closedAt).toISOString() : null, notProceedingReason: NOT_PROCEEDING_REASONS.otherBrand, evidence: stale.sort(byRank).map(line), notes };
  }
  return null;
}

export function daysSince(at: string | null | undefined, now: Date = new Date()): number | null {
  const t = time(at);
  return t === null ? null : Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

const HEADLINE_WORDS: Record<BrandStage, string> = {
  wanted: "wanted", unit_identified: "unit identified", approached: "approached", viewed: "viewed", negotiating: "negotiating",
  hots: "at HOTs", solicitors: "in solicitors", let: "let", trading: "trading", not_proceeding: "not proceeding", disposing: "disposing",
};

/** "3 schemes: 1 at HOTs, 1 viewed, 1 wanted". Counts are of lines, furthest first. */
export function planHeadline(rows: Array<{ stage: BrandStage; schemeId: string }>): string {
  const live = rows.filter(r => r.stage !== "not_proceeding");
  if (live.length === 0) return "No schemes or units yet";
  const schemes = new Set(live.map(r => r.schemeId)).size;
  const order: BrandStage[] = [...RANKED_BRAND_STAGES].reverse();
  order.push("disposing");
  const parts = order.map(stage => ({ stage, n: live.filter(r => r.stage === stage).length })).filter(p => p.n > 0)
    .map(p => `${p.n} ${HEADLINE_WORDS[p.stage]}`);
  return `${schemes} scheme${schemes === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

/** The furthest stage among a set of lines: a live one first, Disposing next, Not proceeding last. */
export function furthestStage(stages: BrandStage[]): BrandStage | null {
  if (stages.length === 0) return null;
  const ranked = stages.filter(s => brandStageRank(s) > 0).sort((a, b) => brandStageRank(b) - brandStageRank(a));
  if (ranked.length) return ranked[0];
  return stages.includes("disposing") ? "disposing" : "not_proceeding";
}

// ── Requirement chip ─────────────────────────────────────────────────────
export type ReqChip = "linked" | "fits" | "place_fits_size_unknown" | "place_fits_size_out" | "size_fits_no_places" | "not_on_list" | "place_unknown" | "no_requirement";

export const REQ_CHIP_LABELS: Record<ReqChip, string> = {
  linked: "Linked to their requirement",
  fits: "Fits their requirement",
  place_fits_size_unknown: "Place fits, size not known",
  place_fits_size_out: "Place fits, size outside their range",
  size_fits_no_places: "Size fits, no places given",
  not_on_list: "Not on their list of places",
  place_unknown: "Place not checked",
  no_requirement: "No requirement held",
};

// The region chips of the requirements form (client/src/lib/crm-options.ts
// reqLeasingLocations). "National" matches everywhere.
export const REQUIREMENT_REGIONS = ["East Anglia", "Ireland", "London", "Midlands", "N. Ireland", "North East", "North West", "Scotland", "South East", "South West", "Wales"] as const;

export interface ChipRequirement {
  id: string;
  size?: string[] | string | null;
  locations?: string[] | null;
  dealId?: string | null;
}

export interface ChipPlace {
  // The scheme's regions; null when the property is outside the scheme
  // registry (there is no region table for those).
  regions: string[] | null;
  // Scheme name, town, property name, address and postcode, in one string.
  text: string;
  sqft: number | null;
  dealId?: string | null;
  linkedRequirementIds?: string[];   // from a viewing on the unit or a Wanted line
}

export interface ChipResult {
  chip: ReqChip;
  requirementId: string | null;
  unitSqft: number | null;
  range: { min: number; max: number } | null;
}

const CHIP_ORDER: ReqChip[] = ["linked", "fits", "size_fits_no_places", "place_fits_size_unknown", "place_fits_size_out", "place_unknown", "not_on_list", "no_requirement"];
const isRegionChip = (place: string) => (REQUIREMENT_REGIONS as readonly string[]).some(r => r.toLowerCase() === place.toLowerCase());
const placesOf = (req: ChipRequirement) => (req.locations || []).map(l => String(l ?? "").trim()).filter(Boolean);

/** Does one named place or region of a requirement cover this scheme or property? */
export function placeFits(place: string, at: Pick<ChipPlace, "regions" | "text">): boolean {
  const p = place.trim().toLowerCase();
  if (!p) return false;
  if (p === "national") return true;
  if ((at.regions || []).some(r => r.toLowerCase() === p)) return true;
  // Unlike requirementFitsUnit, "London" is kept: it is a region chip here.
  return p.length > 2 && at.text.toLowerCase().includes(p);
}

function chipFor(req: ChipRequirement, place: ChipPlace): ChipResult {
  const sqft = place.sqft && place.sqft > 0 ? place.sqft : null;
  const range = parseReqSize(req.size ?? null);
  const base = { requirementId: req.id, unitSqft: sqft, range };
  if ((place.linkedRequirementIds || []).includes(req.id) || (!!req.dealId && req.dealId === place.dealId)) return { chip: "linked", ...base };
  const places = placesOf(req);
  const sizeKnown = sqft !== null && range !== null;
  const sizeFits = sizeKnown && sqft! >= range!.min && sqft! <= range!.max;
  if (places.length === 0) {
    // No places given (the usual PIPnet case): only the size can be judged.
    return { chip: sizeFits ? "size_fits_no_places" : sizeKnown ? "place_fits_size_out" : "place_fits_size_unknown", ...base };
  }
  if (places.some(p => placeFits(p, place))) {
    return { chip: sizeFits ? "fits" : sizeKnown ? "place_fits_size_out" : "place_fits_size_unknown", ...base };
  }
  // Region chips cannot be judged for a property outside the scheme registry.
  if (place.regions === null && places.some(isRegionChip)) return { chip: "place_unknown", ...base };
  return { chip: "not_on_list", ...base };
}

/** The best chip across the brand's live requirements, with the requirement that produced it. */
export function requirementChip(requirements: ChipRequirement[], place: ChipPlace): ChipResult {
  const sqft = place.sqft && place.sqft > 0 ? place.sqft : null;
  let best: ChipResult = { chip: "no_requirement", requirementId: null, unitSqft: sqft, range: null };
  for (const req of requirements) {
    const got = chipFor(req, place);
    if (CHIP_ORDER.indexOf(got.chip) < CHIP_ORDER.indexOf(best.chip)) best = got;
  }
  return best;
}

/** "Asked for, no target yet": each place a live requirement names that
 *  covers a scheme where the brand has no line. */
export function askedNoTarget(
  requirements: ChipRequirement[],
  schemes: Array<{ key: string; name: string; regions: string[]; text: string }>,
  schemeKeysWithRows: Set<string>,
): Array<{ place: string; schemes: Array<{ key: string; name: string }> }> {
  const out = new Map<string, { place: string; schemes: Array<{ key: string; name: string }> }>();
  for (const req of requirements) {
    for (const place of placesOf(req)) {
      const k = place.toLowerCase();
      if (out.has(k)) continue;
      const open = schemes.filter(s => !schemeKeysWithRows.has(s.key) && placeFits(place, s)).map(s => ({ key: s.key, name: s.name }));
      if (open.length) out.set(k, { place, schemes: open });
    }
  }
  return Array.from(out.values());
}

// ── "On hold" ────────────────────────────────────────────────────────────
// The one hand-set flag. It is stored as the old `parked` value of
// crm_companies.concept_status; the other four old values are read as not on
// hold and are never written again.
export const ON_HOLD_VALUE = "parked";
export const isOnHold = (conceptStatus: string | null | undefined): boolean => conceptStatus === ON_HOLD_VALUE;

/** The only two values a save may write. Throws on anything else. */
export function conceptStatusForSave(value: unknown): null | typeof ON_HOLD_VALUE {
  if (value === null || value === undefined || value === "") return null;
  if (value === ON_HOLD_VALUE) return ON_HOLD_VALUE;
  throw new Error('The brand stage is read from the records now. The only flag that can be set is "On hold".');
}

// ── What the plan endpoints return ───────────────────────────────────────
export interface PlanRow {
  key: string;                       // companyId | scheme key or property id | unit key
  companyId: string | null;          // null for a joint agent
  brandName: string;
  scheme: { key: string | null; name: string; group: string | null; propertyId: string | null };
  unit: {
    key: string; tenancyUnitId: string | null; trackerId: string | null; label: string; sqft: number | null;
    occupier: string | null; leaseExpiry: string | null;
    splitKey: boolean;               // true = the unit is not linked to the tenancy schedule
  } | null;                          // null = no unit yet
  stage: BrandStage;
  stageLabel: string;
  stageSince: string | null;
  daysAtStage: number | null;
  evidence: Array<{ src: EvidenceSrc; label: string; at: string | null; byName?: boolean }>;
  notes: string[];
  notProceedingReason: string | null;
  requirement: ChipResult;
  nextStep: {
    kind: "action" | "viewing_followup" | "viewing_booked" | "deal_waiting";
    title: string; dueAt: string | null; daysWaiting: number | null; who: string | null; refId: string;
  } | null;
  owner: { id: string | null; name: string | null; source: "deal" | "target" | "viewing" | "wish" } | null;
  links: { tracker: string | null; deal: string | null; unitPage: string | null; property: string | null; scheme: string | null; brandCase: string | null };
  wish: { id: string; note: string | null; visibleToClient: boolean; createdByName: string | null; requirementId: string | null } | null;
}

export interface BrandPlan {
  brand: {
    id: string | null; name: string; logoUrl: string | null; headline: string;
    // BGP only: never sent to a client viewer.
    onHold?: boolean; lead?: { id: string; name: string } | null; aim?: string | null;
    nextAction?: { id: string; title: string; dueAt: string | null; ownerName: string | null } | null;
  };
  requirements: Array<{ id: string; summary: string; ageDays: number | null; source: string | null; detailHidden: boolean }>;
  rows: PlanRow[];
  notProceeding: PlanRow[];
  askedNoTarget: Array<{ place: string; schemes: Array<{ key: string; name: string }> }>;
  otherSchemeCount?: number;         // asset managers and joint agents: schemes with lines outside their own
  canEdit: boolean;                  // may add, change or rule out a Wanted line
  warnings: string[];
}

export interface BrandGridCell { stage: BrandStage; count: number; rowKeys: string[] }

export interface BrandGridBrand {
  key: string;                       // the brand id, or an opaque key for a joint agent
  id: string | null;                 // null for a joint agent
  name: string;
  logoUrl: string | null;
  requirementHeld: boolean;
  furthest: BrandStage | null;       // null = on a strategy with no line yet
  wantedNoUnit: number;
  cells: Record<string, BrandGridCell>;
  otherSchemeCount?: number;
  // BGP only.
  onHold?: boolean; lead?: { id: string; name: string } | null; openActions?: number;
  nextAction?: { id: string; title: string; dueAt: string | null; ownerName: string | null } | null;
  // Joint agents only: they hold no brand id to ask for one brand's plan, so the lines come with the grid.
  rows?: PlanRow[];
}

export interface BrandGrid {
  schemes: Array<{ key: string; name: string; group: string }>;
  brands: BrandGridBrand[];
  canEdit: boolean;
  warnings: string[];
}
