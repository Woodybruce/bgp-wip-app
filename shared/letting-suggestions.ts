// Comments not yet logged (Woody, 2026-11-13: "yes to table"). His example is
// a real comment on a target, "Offered: 15 year lease. Rent £120kpax and 9%
// t/o. 6 MRF", that never became an offer. This file is the contract and the
// pure rule: which words read as an offer or a viewing that should have been
// logged, what counts as already logged, and who may see a suggestion.
//
// Detection uses the shorthand rules only (shared/letting-note-parse.ts): no
// AI, nothing sent anywhere. A suggestion is never an offer or a viewing. A
// person opens the unit's normal form from it, checks it and saves; only then
// is the suggestion marked as logged. No function here reads the clock or a
// database: the store and the routes are in server/letting-suggestions.ts.
import { formatCalendarDate } from "./calendar-date";
import { NOTE_MAX } from "./letting-note";
import { buildReading, cleanNote } from "./letting-note-parse";

export const SUGGESTION_KINDS = ["offer", "viewing"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_SOURCES = ["target_comment", "viewing", "interest_note", "brief_comment"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];
export type SuggestionVisibility = "bgp" | "brief";
export type SuggestionStatus = "open" | "confirmed" | "dismissed";

// Where the words came from, as the list says it.
export const SUGGESTION_SOURCE_LABELS: Record<SuggestionSource, string> = {
  target_comment: "Target comment", viewing: "Viewing note", interest_note: "Interest note", brief_comment: "Brief comment",
};
// A target's comment log is BGP's own notes. The other three are read by
// everyone working the unit.
export const SUGGESTION_VISIBILITY: Record<SuggestionSource, SuggestionVisibility> = {
  target_comment: "bgp", viewing: "brief", interest_note: "brief", brief_comment: "brief",
};
// An offer or a viewing for the same unit and brand within this many days
// either side of the evidence means it is already logged.
export const LOGGED_WINDOW_DAYS = 14;
export const SUGGESTION_EXCERPT_MAX = NOTE_MAX;
export const DISMISS_REASON_MAX = 500;
// Why the app itself closed a suggestion (resolved_by_name is then empty).
export const CLOSED_ALREADY_LOGGED = "already_logged";
export const CLOSED_SOURCE_CHANGED = "source_changed";
// The viewing outcomes that say an offer is on its way or has come.
export const OFFER_OUTCOMES: readonly string[] = ["Offer Received", "Offer Expected"];

// What the rules read out of the words. Figures and short terms only: never
// a contact, an agent or any id.
export interface SuggestionDetails {
  rentPa?: number;
  termYears?: number;
  rentFreeMonths?: number;
  turnoverRentPct?: number;
  premium?: number;
  fittingOutContribution?: number;
  rentDeposit?: string;
  breakOption?: string;
  rentReview?: string;
  incentives?: string;
  date?: string;             // yyyy-mm-dd, when the words give one
  time?: string;             // HH:MM, a viewing's
  outcome?: string;          // a viewing's outcome as the words give it
  viewingOutcome?: string;   // the outcome recorded on the viewing the suggestion came from
}

export type SuggestionSourceRef =
  | { type: "target_comment"; targetId: string; at: string }
  | { type: "viewing"; viewingId: string }
  | { type: "interest_note"; interestId: string }
  | { type: "brief_comment"; commentId: string };

// One suggestion as the list sends it. `source` is enough to open the form:
// a target comment is read by the server from its target id and timestamp;
// the other three hand the form their own words (`excerpt`).
export interface LettingSuggestion {
  id: string;
  unitId: string;
  unitName: string;
  propertyId: string | null;
  propertyName: string | null;
  kind: SuggestionKind;
  brandName: string | null;
  companyId: string | null;          // for a joint agent: only a brand already named on the unit
  sourceKind: SuggestionSource;
  sourceLabel: string;
  source: SuggestionSourceRef;
  excerpt: string;
  details: SuggestionDetails;
  summary: string;
  saidBy: string | null;
  evidenceDate: string | null;       // yyyy-mm-dd
  status: SuggestionStatus;
  createdAt: string | null;
}
export interface LettingSuggestionList { suggestions: LettingSuggestion[]; count: number }

// ── The source reference and the dedupe key ────────────────────────────────

export function sourceRefText(ref: SuggestionSourceRef): string {
  if (ref.type === "target_comment") return `${ref.targetId}|${ref.at}`;
  if (ref.type === "viewing") return ref.viewingId;
  if (ref.type === "interest_note") return ref.interestId;
  return ref.commentId;
}
export function parseSourceRef(kind: string, ref: string): SuggestionSourceRef | null {
  const text = String(ref || "");
  if (!text) return null;
  if (kind === "target_comment") {
    const cut = text.indexOf("|");
    return cut > 0 && cut < text.length - 1 ? { type: "target_comment", targetId: text.slice(0, cut), at: text.slice(cut + 1) } : null;
  }
  if (kind === "viewing") return { type: "viewing", viewingId: text };
  if (kind === "interest_note") return { type: "interest_note", interestId: text };
  if (kind === "brief_comment") return { type: "brief_comment", commentId: text };
  return null;
}

// A short, stable hash of the words (cyrb53). Not a secret: it only tells an
// edited comment from the one that was read before.
export function wordsHash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/**
 * One key for one piece of evidence: where it is, what it reads as, and the
 * words themselves. The same comment is never raised twice, whatever a person
 * did with it; an edited comment is a new piece of evidence.
 */
export function suggestionDedupeKey(sourceKind: SuggestionSource, sourceRef: string, kind: SuggestionKind, words: string): string {
  return `${sourceKind}:${sourceRef}:${kind}:${wordsHash(cleanNote(words))}`;
}

// ── The detection rule ─────────────────────────────────────────────────────

// A money or lease term. One of these with a word that says terms are being
// proposed, or two of them, reads as an offer.
const OFFER_TERMS = ["rentPa", "termYears", "rentFreeMonths", "turnoverRentPct", "premium", "fittingOutContribution", "rentDeposit"] as const;
const OFFER_EXTRAS = ["breakOption", "rentReview", "incentives"] as const;
const OFFER_WORDS = /\b(offer(?:ed|s|ing)?|propos(?:e|ed|es|al|als|ing)|terms|hots|heads of terms|counter(?:ed|s|ing)?|counter-?(?:offer|proposal)s?|bid(?:s|ding)?)\b/i;
// A viewing that happened.
const VIEWING_HAPPENED = /\b(viewed|showed|shown|walked|toured|inspected)\b/i;
// A viewing named as a thing: it counts with a date (booked or held), or with
// an outcome when the words are not only asking for one.
const VIEWING_NAMED = /\b(viewings?|tours?|inspections?|walk[- ]?(?:round|around|through))\b/i;
const VIEWING_ASKED = /\b(wants?|wanted|would like|requests?|requested|requesting|ask(?:ed|ing|s)? for|keen (?:on|for|to)|arrang(?:e|ing)|to book|needs?)\b[^.;\n]{0,24}\b(viewings?|tours?|inspections?|view)\b|\b(viewings?|tours?|inspections?)\s+(?:is |are |was )?(wanted|requested|needed|tbc|to be (?:arranged|booked|confirmed))\b/i;

export interface DetectInput {
  text: string;
  /** Today in London, yyyy-mm-dd. */
  today: string;
  /** The London day the words were written, when the source records it. */
  writtenOn?: string | null;
  /** Who wrote them, when the source records it. */
  author?: string | null;
  /** Names of the letting team: never a brand or its contact. */
  staffNames?: readonly string[];
  /** The brands already named on the unit. */
  brandNames?: readonly string[];
  /** The unit's quoting rent. A comment that only repeats it is not an offer. */
  quotingRentPa?: number | null;
  /** Which kinds to look for. Both when absent. */
  kinds?: readonly SuggestionKind[];
}
export interface Detected {
  kind: SuggestionKind;
  /** The literal words that were read. */
  excerpt: string;
  details: SuggestionDetails;
  /** The date the words themselves give, if any. */
  date: string | null;
  /** A brand the words name, from the brands on the unit. */
  brandName: string | null;
}

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";
const pick = (from: Record<string, unknown>, keys: readonly string[]): SuggestionDetails => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (present(from[k])) out[k] = from[k];
  return out as SuggestionDetails;
};

function offerIn(text: string, input: DetectInput): Detected | null {
  const reading = buildReading({ kind: "offer", text, today: input.today, writtenOn: input.writtenOn, author: input.author, staffNames: input.staffNames, brandNames: input.brandNames });
  const f = reading.fields as Record<string, unknown>;
  const terms = OFFER_TERMS.filter(k => present(f[k]));
  if (!terms.length) return null;
  const proposed = OFFER_WORDS.test(text);
  // Words that only repeat the unit's quoting rent are about the brief, not a bid.
  const quoting = Number(input.quotingRentPa);
  if (!proposed && Number.isFinite(quoting) && quoting > 0 && f.rentPa === quoting) return null;
  // The same when the quoting rent is the only term read, whatever the words
  // say ("Quoting terms: £125k pa", "We proposed £125k pa"): it is BGP's own
  // note of the asking terms far more often than a brand's bid at them.
  if (Number.isFinite(quoting) && quoting > 0 && f.rentPa === quoting && terms.length === 1) return null;
  if (!proposed && terms.length < 2) return null;
  const date = typeof f.date === "string" ? f.date : null;
  return {
    kind: "offer", excerpt: text, date,
    details: { ...pick(f, OFFER_TERMS), ...pick(f, OFFER_EXTRAS), ...(date ? { date } : {}) },
    brandName: typeof f.brandName === "string" && f.brandName.trim() ? f.brandName.trim() : null,
  };
}

function viewingIn(text: string, input: DetectInput): Detected | null {
  const happened = VIEWING_HAPPENED.test(text);
  const named = VIEWING_NAMED.test(text);
  if (!happened && !named) return null;
  const reading = buildReading({ kind: "viewing", text, today: input.today, writtenOn: input.writtenOn, author: input.author, staffNames: input.staffNames, brandNames: input.brandNames });
  const f = reading.fields as Record<string, unknown>;
  const date = typeof f.date === "string" ? f.date : null;
  const outcome = typeof f.outcome === "string" && f.outcome.trim() ? f.outcome.trim() : null;
  if (!date && !outcome) return null;
  // "Second viewing wanted" with no date asks for a viewing: it is not one.
  if (!happened && !date && VIEWING_ASKED.test(text)) return null;
  return {
    kind: "viewing", excerpt: text, date,
    details: { ...(date ? { date } : {}), ...pick(f, ["time"]), ...(outcome ? { outcome } : {}) },
    brandName: typeof f.brandName === "string" && f.brandName.trim() ? f.brandName.trim() : null,
  };
}

/**
 * What a piece of writing reads as: an offer that was made, a viewing that
 * happened or is booked, both, or (most often) neither. The reader refuses
 * rather than guesses, so words it could not read make no suggestion.
 */
export function detectInText(input: DetectInput): Detected[] {
  const text = cleanNote(input.text).slice(0, SUGGESTION_EXCERPT_MAX);
  if (!text) return [];
  const kinds = input.kinds || SUGGESTION_KINDS;
  const out: Detected[] = [];
  const offer = kinds.includes("offer") ? offerIn(text, input) : null;
  if (offer) out.push(offer);
  const viewing = kinds.includes("viewing") ? viewingIn(text, input) : null;
  if (viewing) out.push(viewing);
  return out;
}

// A diary viewing's note opens with the Outlook invitation's subject. That
// line is BGP's diary, not the agent's note: it is never read or shown.
const DIARY_NOTE_PREFIX = /^\s*(?:Synced from Outlook: "[^\r\n]*"|Synced from [^\n]*'s Outlook diary: [^\n]*|Captured from Outlook\.)\s*/i;
export function ownViewingNote(notes: string | null | undefined, source?: string | null): string {
  const text = String(notes || "");
  if (source !== "diary") return text.trim();
  const own = text.replace(DIARY_NOTE_PREFIX, "");
  return own === text ? "" : own.trim();
}

export interface ViewingForDetection { outcome: string | null; notes: string | null; viewingDate: string | null; source?: string | null }

/**
 * The offer a viewing points at: its note reads as an offer, or its outcome
 * is Offer Received or Offer Expected. A viewing never suggests a viewing.
 */
export function detectFromViewing(v: ViewingForDetection, input: Omit<DetectInput, "text" | "kinds" | "writtenOn">): Detected | null {
  const note = cleanNote(ownViewingNote(v.notes, v.source)).slice(0, SUGGESTION_EXCERPT_MAX);
  const day = v.viewingDate && /^\d{4}-\d{2}-\d{2}$/.test(v.viewingDate) ? v.viewingDate : null;
  const outcome = OFFER_OUTCOMES.find(o => o.toLowerCase() === String(v.outcome || "").trim().toLowerCase()) || null;
  const read = note ? detectInText({ ...input, text: note, kinds: ["offer"], writtenOn: day && day <= input.today ? day : null })[0] : null;
  if (read) return { ...read, details: { ...read.details, ...(outcome ? { viewingOutcome: outcome } : {}) } };
  if (!outcome) return null;
  return { kind: "offer", excerpt: note, date: null, details: { viewingOutcome: outcome }, brandName: null };
}

// ── A brand named in the words ─────────────────────────────────────────────

const lower = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The one brand on the unit that the words name. Null when none is named, or
 * when more than one is: the reader does not pick between them.
 */
export function brandNamedIn<T extends { id: string; name: string }>(text: string, brands: readonly T[]): T | null {
  const words = lower(text);
  const hits = new Map<string, T>();
  for (const b of brands) {
    const name = lower(b.name);
    if (name.length < 2) continue;
    if (new RegExp(`(?<![a-z0-9])${escapeRe(name)}(?![a-z0-9])`).test(words)) hits.set(b.id, b);
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

// ── Already logged ─────────────────────────────────────────────────────────

export interface BrandRef { companyId?: string | null; brandName?: string | null }
export function sameBrand(a: BrandRef, b: BrandRef): boolean {
  if (a.companyId && b.companyId) return a.companyId === b.companyId;
  const left = lower(a.brandName), right = lower(b.brandName);
  return !!left && left === right;
}

const DAY_MS = 86_400_000;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const daysApart = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS);

/** An offer or a viewing already on the unit. */
export interface LoggedRecord extends BrandRef { date: string | null; viewingId?: string | null }

/**
 * True when the unit already holds a record for the same brand dated within
 * 14 days either side of the evidence. A viewing that says an offer is
 * expected looks forward: any offer from that brand since the viewing (less
 * the same 14 days), or one recorded from that viewing, means it is logged.
 * A suggestion with no brand cannot be matched, so it is never "logged".
 */
export function alreadyLogged(
  s: BrandRef & { evidenceDate: string | null; fromViewingId?: string | null },
  records: readonly LoggedRecord[],
): boolean {
  for (const r of records) {
    if (s.fromViewingId && r.viewingId && r.viewingId === s.fromViewingId) return true;
    if (!sameBrand(s, r)) continue;
    if (!isDay(s.evidenceDate) || !isDay(r.date)) return true;
    const gap = daysApart(s.evidenceDate, r.date);
    if (s.fromViewingId ? gap >= -LOGGED_WINDOW_DAYS : Math.abs(gap) <= LOGGED_WINDOW_DAYS) return true;
  }
  return false;
}

// ── Who sees a suggestion ──────────────────────────────────────────────────

// The parts of briefAccess() the rule needs (server/unit-brief-workspace.ts).
export interface SuggestionViewer { isStaff: boolean; seesBgpNotes: boolean; agentControl: boolean; landsecRole: string | null }

/**
 * BGP's own notes ('bgp') are for BGP staff only. The rest ('brief') are for
 * BGP staff and the scheme's joint agent. Nobody else is shown, counted or
 * hinted a suggestion: not an asset manager, not a Landsec leasing manager,
 * not any other client login.
 */
export function suggestionVisibleTo(visibility: string, viewer: SuggestionViewer | null | undefined): boolean {
  if (!viewer || viewer.landsecRole === "asset_manager") return false;
  if (visibility === "bgp") return viewer.isStaff && viewer.seesBgpNotes;
  if (visibility === "brief") return viewer.agentControl && (viewer.isStaff || viewer.landsecRole === "joint_agent");
  return false;
}

// ── Plain words ────────────────────────────────────────────────────────────

const figure = (n: number): string => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const count = (n: number, one: string, many: string): string => `${figure(n)} ${n === 1 ? one : many}`;

/** What a suggestion looks like, in plain words: "Offer: 15 years, £120,000 a year, 9% turnover, 6 months rent free". */
export function describeSuggestion(kind: SuggestionKind, details: SuggestionDetails | null | undefined): string {
  const d = details || {};
  if (kind === "viewing") {
    const when = d.date ? `${formatCalendarDate(d.date) || d.date}${d.time ? ` at ${d.time}` : ""}` : "";
    const parts = [when, d.outcome ? `outcome ${d.outcome}` : ""].filter(Boolean);
    return parts.length ? `Viewing: ${parts.join(", ")}` : "Viewing";
  }
  const parts: string[] = [];
  if (typeof d.termYears === "number") parts.push(count(d.termYears, "year", "years"));
  if (typeof d.rentPa === "number") parts.push(`£${figure(d.rentPa)} a year`);
  if (typeof d.turnoverRentPct === "number") parts.push(`${figure(d.turnoverRentPct)}% turnover`);
  if (typeof d.rentFreeMonths === "number") parts.push(`${count(d.rentFreeMonths, "month", "months")} rent free`);
  if (typeof d.premium === "number") parts.push(`£${figure(d.premium)} premium`);
  if (typeof d.fittingOutContribution === "number") parts.push(`£${figure(d.fittingOutContribution)} fit-out contribution`);
  if (d.rentDeposit) parts.push(`deposit ${d.rentDeposit}`);
  if (d.breakOption) parts.push(d.breakOption.charAt(0).toLowerCase() + d.breakOption.slice(1));
  if (parts.length) return `Offer: ${parts.join(", ")}`;
  if (d.viewingOutcome === "Offer Received") return "The viewing says an offer was received. None is logged for this brand.";
  if (d.viewingOutcome === "Offer Expected") return "The viewing says an offer is expected. None is logged for this brand.";
  return "Offer";
}

// ── One unit's sources into candidates ─────────────────────────────────────

// A brand on the unit: a CRM brand (companyId) or a target named in words only.
export interface UnitBrand { companyId: string | null; name: string }
export interface TargetSource {
  id: string; operatorName: string | null; companyId: string | null; companyName: string | null;
  comments: { text: string; at: string; day: string | null; userName: string | null }[];   // day = the London day of `at`
}
export interface ViewingSource extends ViewingForDetection { id: string; companyId: string | null; companyName: string | null; saidBy: string | null; status: string | null }
export interface InterestSource { id: string; companyId: string | null; companyName: string | null; notes: string | null; interestDate: string | null }
export interface BriefCommentSource { id: string; body: string; userName: string | null; day: string | null }   // day = the London day it was written
export interface UnitSources {
  unitId: string;
  today: string;
  quotingRentPa: number | null;
  staffNames: readonly string[];
  brands: readonly UnitBrand[];
  targets: readonly TargetSource[];
  viewings: readonly ViewingSource[];
  interest: readonly InterestSource[];
  briefComments: readonly BriefCommentSource[];
  offersLogged: readonly LoggedRecord[];
  viewingsLogged: readonly LoggedRecord[];
}
export interface SuggestionCandidate {
  unitId: string;
  kind: SuggestionKind;
  companyId: string | null;
  brandName: string | null;
  sourceKind: SuggestionSource;
  sourceRef: string;
  dedupeKey: string;
  excerpt: string;
  details: SuggestionDetails;
  saidBy: string | null;
  evidenceDate: string | null;
  visibility: SuggestionVisibility;
  /** An offer or a viewing for the same unit and brand is already there: not raised. */
  logged: boolean;
}

// A viewing that was called off, or was never a viewing, points at nothing.
const DEAD_VIEWING = new Set(["cancelled", "not_leasing"]);
const pastDay = (day: string | null | undefined, today: string): string | null => (isDay(day) && day <= today ? day : null);
const clip = (s: string | null | undefined, max: number): string | null => { const t = String(s || "").trim().slice(0, max); return t || null; };

/**
 * Everything on one unit that reads as an offer or a viewing, in the order
 * the sources are read: target comments, viewings, interest notes, brief
 * comments. Each candidate says whether it is already logged. Pure: the
 * caller loads the rows and stores what comes back.
 */
export function candidatesForUnit(src: UnitSources): SuggestionCandidate[] {
  const out: SuggestionCandidate[] = [];
  const base = { today: src.today, staffNames: src.staffNames, quotingRentPa: src.quotingRentPa, brandNames: src.brands.map(b => b.name) };
  const add = (found: Detected, sourceKind: SuggestionSource, ref: SuggestionSourceRef, brand: BrandRef, saidBy: string | null, fallbackDay: string | null, fromViewingId: string | null = null) => {
    const sourceRef = sourceRefText(ref);
    const evidenceDate = found.date || (isDay(fallbackDay) ? fallbackDay : null);
    const companyId = brand.companyId || null;
    const brandName = clip(brand.brandName, 200);
    out.push({
      unitId: src.unitId, kind: found.kind, companyId, brandName, sourceKind, sourceRef,
      dedupeKey: suggestionDedupeKey(sourceKind, sourceRef, found.kind, `${found.excerpt}\n${found.details.viewingOutcome || ""}`),
      excerpt: found.excerpt, details: found.details, saidBy: clip(saidBy, 200), evidenceDate,
      visibility: SUGGESTION_VISIBILITY[sourceKind],
      logged: alreadyLogged({ companyId, brandName, evidenceDate, fromViewingId }, found.kind === "offer" ? src.offersLogged : src.viewingsLogged),
    });
  };

  // The brands on the unit, one entry a name: a CRM brand wins over the same name typed on a target.
  const byName = new Map<string, { id: string; name: string; companyId: string | null }>();
  for (const b of src.brands) {
    const key = lower(b.name);
    if (!key || (byName.has(key) && !b.companyId)) continue;
    byName.set(key, { id: `name:${key}`, name: b.name, companyId: b.companyId || null });
  }
  const named = [...byName.values()];

  // 1. A target's comment log: BGP's own notes. The brand is the target's.
  for (const t of src.targets) {
    const brand: BrandRef = { companyId: t.companyId, brandName: t.companyName || t.operatorName };
    if (!brand.companyId && !lower(brand.brandName)) continue;
    for (const c of t.comments) {
      if (!c || !c.at || !String(c.text || "").trim()) continue;
      for (const found of detectInText({ ...base, text: c.text, writtenOn: pastDay(c.day, src.today), author: c.userName })) {
        add(found, "target_comment", { type: "target_comment", targetId: t.id, at: c.at }, brand, c.userName, c.day);
      }
    }
  }
  // 2. A viewing that says an offer came or is coming, or whose note reads as one.
  for (const v of src.viewings) {
    if (DEAD_VIEWING.has(String(v.status || ""))) continue;
    const brand: BrandRef = { companyId: v.companyId, brandName: v.companyName };
    if (!brand.companyId && !lower(brand.brandName)) continue;
    const found = detectFromViewing(v, base);
    if (found) add(found, "viewing", { type: "viewing", viewingId: v.id }, brand, v.saidBy, v.viewingDate, v.id);
  }
  // 3. An interest note a person wrote. The brand is the line's, or the one brand on the unit the note names.
  for (const i of src.interest) {
    const text = String(i.notes || "");
    if (!text.trim()) continue;
    let brand: BrandRef = { companyId: i.companyId, brandName: i.companyName };
    if (!brand.companyId && !lower(brand.brandName)) {
      const hit = brandNamedIn(text, named);
      if (!hit) continue;
      brand = { companyId: hit.companyId, brandName: hit.name };
    }
    for (const found of detectInText({ ...base, text, writtenOn: pastDay(i.interestDate, src.today) })) {
      add(found, "interest_note", { type: "interest_note", interestId: i.id }, brand, null, i.interestDate);
    }
  }
  // 4. A Targeting Brief comment that names one brand on the unit.
  for (const c of src.briefComments) {
    const text = String(c.body || "");
    if (!text.trim()) continue;
    const brand = brandNamedIn(text, named);
    if (!brand) continue;
    for (const found of detectInText({ ...base, text, writtenOn: pastDay(c.day, src.today), author: c.userName })) {
      add(found, "brief_comment", { type: "brief_comment", commentId: c.id }, { companyId: brand.companyId, brandName: brand.name }, c.userName, c.day);
    }
  }
  return out;
}
