// The rules behind "drop a note in, fill the form" (shared/letting-note.ts).
// THE RULES READER FILLS TIGHT SHORTHAND ONLY (`tightNote`, at the end of this
// file). A note written out in full is never filled from these rules alone:
// `guardReading` decides what it may fill. Do not add patterns here to guess
// at free prose; four review rounds showed that does not converge.
// Pure functions only: no clock, no database, no AI. Three parts:
//
//   readShorthand       reads the common ways UK leasing agents write terms
//                       ("£120kpax", "6 MRF", "9% t/o", "TBO yr 5") with no AI
//   normaliseCandidate  checks what an AI reader proposed against the note
//                       itself: a value is kept only when its words are in the
//                       note and, for a figure, the figure is in those words
//   buildReading        puts the two together (the shorthand reading wins
//                       where both found a field) into a LettingNoteReading
//
// The house rule: refuse rather than guess. A wrong figure saved as fact is
// the worst outcome, so when a note can be read two ways (two rents, a range,
// a date that may be still to come, keen and not keen) nothing is set and the
// reason is given in `dropped`. An AI value never fills a box the rules
// refused.
//
// The safety net (review round three): a wrong value in a form is worse than
// an empty box. For every box all the candidates in the note are gathered
// first. One fills the box; two different ones, a choice ("or"), a term the
// note turns down, or a value whose meaning hangs on words the rules do not
// understand fill nothing, with a plain reason. The first is never just taken,
// and what is refused stays in the notes box.
//
// A field that is missing was not stated. Nothing here ever sends a null, so
// a negotiation round's unstated terms carry over from the last position.
// "Today" is always passed in: no function here reads the clock.
import { calendarDateValue } from "./calendar-date";
import { VIEWING_OUTCOMES } from "./viewing-workflow";
import type { LettingNoteField, LettingNoteFields, LettingNoteReading, NoteKind } from "./letting-note";

export const NOTE_OUTCOMES: readonly string[] = [...VIEWING_OUTCOMES, "No Show"];

const TERM_FIELDS: LettingNoteField[] = ["rentPa", "rentFreeMonths", "termYears", "breakOption", "premium", "fittingOutContribution",
  "turnoverRentPct", "rentReview", "rentDeposit", "incentives"];
const VIEWING_FIELDS: LettingNoteField[] = ["brandName", "brandId", "contactName", "agentName", "date", "time", "attendees", "outcome",
  "nextAction", "followUpDate", "note"];

// The boxes each form has. A value for any other box is never returned.
export const NOTE_KIND_FIELDS: Record<NoteKind, readonly LettingNoteField[]> = {
  offer: ["brandName", "brandId", "contactName", "agentName", "date", ...TERM_FIELDS, "note"],
  round: ["date", "party", ...TERM_FIELDS, "note"],
  viewing: VIEWING_FIELDS,
  viewing_outcome: VIEWING_FIELDS,
  interest: ["brandName", "brandId", "contactName", "agentName", "agentCompanyName", "agentCompanyId", "moreBrands", "date", "note"],
};

// The save routes' limits (server/unit-negotiation.ts, server/leasing-viewings.ts).
const NAME_MAX = 200;
const TERM_TEXT_MAX = 500;
const NEXT_ACTION_MAX = 2000;
const LONG_TEXT_MAX = 4000;
const MONEY_MAX = 100_000_000;
const RENT_MIN = 1000;
const NUMBER_MAX = { rentFreeMonths: 600, termYears: 999, turnoverRentPct: 100 } as const;
const EARLIEST_DAY = "2000-01-01";
// A day and month with no year that falls within this many days ahead is as
// likely to be still to come as to be last year's: it is not placed.
const SOON_DAYS = 62;

type Dropped = { field: string; reason: string };
type Quotes = Partial<Record<LettingNoteField, string>>;
type Span = { start: number; end: number };
type Found<T> = { value: T; start: number; end: number };

export interface PartialReading {
  fields: LettingNoteFields;
  quotes: Quotes;
  unplaced: string[];
  dropped: Dropped[];
  saidBy: string | null;
}

export interface ShorthandReading extends PartialReading {
  /** Every figure in the note that could be the yearly rent: the ones written as a rent and the loose sums of rent size. */
  rentFigures: number[];
  /** The sentences of the note that hold words no rule could place. Empty when the rules read all of it. */
  leftover: string[];
  /** The note as it was read: line ends tidied, long runs of white space closed up. */
  text: string;
  /** The stretches of `text` the rules read. */
  claimed: Span[];
  /** True when the name at the start is the caller, a colleague or the source's own author. */
  saidByKnown: boolean;
  /** Where the note's own words begin, after a leading name and date. */
  bodyFrom: number;
  /** Where in `text` each value that was read sits. */
  at: Partial<Record<LettingNoteField, Span>>;
  /** The day the note's dates were placed from: the day it was written, or today. */
  refDay?: string;
  /** The letting team, the note's author and a known stamp's name: never the brand. */
  teamNames?: string[];
}

export interface NoteContext {
  kind: NoteKind;
  /** Today in London, yyyy-mm-dd. */
  today: string;
  /**
   * The London day the note was written, when the source records it (a target
   * comment's own day). "Yesterday" and a day and month with no year are
   * placed from this day; today still decides what counts as the future.
   */
  writtenOn?: string | null;
  /** Who wrote the note, when the source records it (a target comment's userName). */
  author?: string | null;
  /** Names of the letting team: never the brand's contact. */
  staffNames?: readonly string[];
  /** Brand names the caller may already pick. One found in the note is the brand. */
  brandNames?: readonly string[];
}

// ── Small helpers ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
// A line end inside the text the rules scan. It is not white space, so no
// pattern can join a figure on one line to a label on the next.
const LINE = "\u0001";
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const addNoteDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayOf = (y: number, m: number, d: number): string | null => calendarDateValue(`${pad(y, 4)}-${pad(m)}-${pad(d)}`);
const weekdayOf = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
const norm = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const oneLine = (v: unknown, max: number): string => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max) : "");
const sameName = (a: string, b: string): boolean => norm(a) === norm(b);
const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLetter = (c: string | undefined): boolean => !!c && /[a-z]/i.test(c);
/** The few characters before a place in the text. Every look-back is cut to a short window, so no check re-reads the whole note. */
const back = (s: string, at: number, n = 40): string => s.slice(Math.max(0, at - n), at);

/**
 * The note as the rules read it: line ends made the same, tabs and odd spaces
 * made plain spaces, and every run of white space closed up to one space or
 * one line end. A pasted note padded with thousands of spaces reads in the
 * same time as a short one.
 */
export function cleanNote(raw: unknown): string {
  return (typeof raw === "string" ? raw : raw == null ? "" : String(raw))
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u0085\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .trim();
}

class Claims {
  private spans: Span[] = [];
  constructor(spans: readonly Span[] = []) { this.spans = spans.map(s => ({ ...s })); }
  free(start: number, end: number): boolean { return !this.spans.some(s => start < s.end && end > s.start); }
  take(start: number, end: number): boolean {
    if (end <= start || !this.free(start, end)) return false;
    this.spans.push({ start, end });
    return true;
  }
  /** Claims whatever part of the stretch is still free. */
  takeFree(start: number, end: number): void {
    let at = start;
    for (const s of this.all()) {
      if (s.end <= at || s.start >= end) continue;
      if (s.start > at) this.spans.push({ start: at, end: s.start });
      at = Math.max(at, s.end);
    }
    if (at < end) this.spans.push({ start: at, end });
  }
  /** Gives up a claim made on exactly this stretch. */
  release(start: number, end: number): void { this.spans = this.spans.filter(s => !(s.start === start && s.end === end)); }
  all(): Span[] { return [...this.spans].sort((a, b) => a.start - b.start); }
}

function each(re: RegExp, text: string, fn: (m: RegExpExecArray) => void): void {
  const g = new RegExp(re.source, `${re.flags.replace(/[gd]/g, "")}gd`);      // d: where each group was found
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    if (m[0] === "") { g.lastIndex++; continue; }
    fn(m);
  }
}

// Everyday words. A brand whose name is made only of these ("Next", "Office",
// "The Works") is found in a note only where the note's own capitals or the
// words around it show a brand is meant, and a name made of them at the start
// of a note ("Honest Burgers 9 Nov") is not taken for a person.
const ORDINARY = new Set(("the a an and of for to in on at by with from or new old big little small great good best better fresh real pure simply honest happy " +
  "lucky funny fat thin tall short long wide high low hot cold cool warm sweet salty spicy red blue green black white grey gray brown pink orange yellow " +
  "purple gold golden silver one two three four five six seven eight nine ten first second third next last office boots gap game games ask apple mango " +
  "monsoon jigsaw lush dune size range works shed body shop shops store stores market markets house home homes kitchen kitchens bar bars grill cafe coffee " +
  "tea bread bakery pizza pasta burger burgers chicken wings steak fish chips sushi noodle noodles rice taco tacos burrito sandwich salad juice shake shack " +
  "food foods eat eats drink drinks wine beer brew club clubs company co group ltd limited plc uk london city town urban street road lane square station " +
  "park garden gardens river island mountain lake sea beach north south east west sports sport direct world planet space star stars sun moon sky cloud " +
  "tiger giraffe bear fox wolf lion dog cat bird duck goose swan pig cow sheep horse face look looks stuff things card cards factory book books box boxes " +
  "flight bounce gravity electric light lights iron flat hat cap bag bags shoe shoes sock socks dress dresses suit suits watch watches phone phones mobile " +
  "vision express oasis coast warehouse faith bank banks cruise boss diesel guess reserved made loaf dreams pod pods crew animal quiz select links savers " +
  "benefit habitat revolution browns caravan grind notes tossed sticks reel putt pins sixes meta sandbox breakout monopoly paradox twist joy bliss crisp " +
  "crust dough flour sugar spice salt pepper honey butter cream milk cheese egg eggs bean beans leaf leaves root roots seed seeds tree trees wood woods " +
  "stone stones rock rocks brick bricks glass steel copper pilgrims guys kids boys girls men women lads brothers sisters sons daughters family friends " +
  "neighbours people folk original originals classic classics modern vintage retro royal imperial national central general united global local social " +
  "public private open closed early late daily nightly weekly every any all some this that these those here there now then today week month year time " +
  "times day days night nights morning hour hours minute work play rest stop start go run walk fly jump swing swingers dance sing live love like want need " +
  "keep save spend pay buy sell let rent lease offer deal deals value price prices pound pounds penny cash money").split(" "));
// Brands that are also a person's first name ("Leon", "Paul").
const FIRST_NAMES = new Set(("leon joe paul bill bills ted ben sam tom tim jack jo carl wendy oliver lewis harry jamie gino marco rosa mark max frankie benny henry " +
  "george john james jane mary anna emma eve ella lola fred frank tony jimmy johnny eddie charlie archie alfie rudy pepe franco").split(" "));
const wordKey = (w: string): string => w.toLowerCase().replace(/['’]s$/, "").replace(/[^a-z0-9&]/g, "");
const isOrdinary = (w: string): boolean => { const k = wordKey(w); return !k || k === "&" || ORDINARY.has(k); };

// ── Money ──────────────────────────────────────────────────────────────────

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const MONEY_AT = new RegExp(String.raw`(£)?\s?${NUM}(?:(k|mn?)|\s?(million|thousand))?`, "iy");
// A year's figure: pax, p.a.x., pa, p.a., p/a, per annum (exclusive), per year, a year.
const PER_YEAR_AT = /\s?(?:p\.?a\.?x\.?|per\s+annum|per\s+year|a\s+year|each\s+year|annually|p\/a|p\.?a\.?)(?![a-z])(?:\s+(?:exclusive|excl\.?|exc\.?)(?![a-z]))?/iy;
// "pax" and "exclusive" are only ever said of rent. A plain "pa" may be turnover, rates or a service charge.
const RENT_ONLY_WORDS = /p\.?a\.?x|excl|exc(?![a-z])/i;
// Not a year's figure. These are refused, never converted: a monthly, Zone A
// or per-square-foot figure saved as annual is wrong by a large multiple.
const NOT_YEARLY = String.raw`(?:psf|p\.s\.f\.?|psm|per\s+sq(?:uare)?\.?\s?(?:metres?|meters?|ft|foot|feet|m(?![a-z]))\.?|\/\s?sq\.?\s?(?:ft|m(?![a-z]))\.?|\/\s?(?:ft|sqft|sqm|m2)(?![a-z])|per\s+(?:ft|m2|sqft|sqm)(?![a-z])|itza(?![a-z])|zone\s+a(?![a-z])|za(?![a-z])|pcm(?![a-z])|p\.c\.m\.?|per\s+calendar\s+month|per\s+month|per\s+mth|a\s+month|each\s+month|every\s+month|monthly|\/\s?(?:month|mth|mo)(?![a-z])|every\s(?:week|quarter|qtr|day)|p\/m(?![a-z])|p\.m\.?(?![a-z])|pm(?![a-z])|per\s+week|a\s+week|each\s+week|weekly|\/\s?(?:week|wk)(?![a-z])|pw(?![a-z])|p\.w\.?(?![a-z])|per\s+quarter|per\s+qtr|a\s+quarter|each\s+quarter|quarterly|\/\s?(?:quarter|qtr)(?![a-z])|pq(?![a-z])|p\.q\.?(?![a-z])|per\s+day|a\s+day|daily)`;
const NOT_YEARLY_AT = new RegExp(String.raw`\s?${NOT_YEARLY}`, "iy");
// A floor area, not a sum: "2,400 sq ft".
const AREA_AT = /\s?(?:sq\.?\s?(?:ft|feet|foot|m(?![a-z])|metres?|meters?)|sqft|sqm|sf(?![a-z])|square\s+(?:feet|foot|metres?|meters?)|ft2|m2)/iy;

interface Money { value: number; plain: number; start: number; end: number; pound: boolean; mult: boolean; k: boolean }

function stickyAt(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

function moneyAt(text: string, at: number): Money | null {
  if (at > 0 && /[\d.,]/.test(text[at - 1]) && /\d/.test(text[at] || "")) return null;
  const m = stickyAt(MONEY_AT, text, at);
  if (!m) return null;
  const n = parseFloat(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  let end = m.index + m[0].length;
  let mult = (m[3] || m[4] || "").toLowerCase();
  // "6months": the m belongs to the next word, not to the figure. "120kpax" is fine.
  if (m[3] && isLetter(text[end]) && !stickyAt(PER_YEAR_AT, text, end) && !stickyAt(NOT_YEARLY_AT, text, end)) {
    end -= m[3].length;
    mult = "";
  }
  // "3m rent in advance" is three months, not three million. A bare "Nm" is
  // millions only with a pound sign before it or a per-year word after it.
  if (mult.startsWith("m") && m[3] && !m[1] && !stickyAt(PER_YEAR_AT, text, end)) {
    end -= m[3].length;
    mult = "";
  }
  const factor = mult === "k" || mult === "thousand" ? 1_000 : mult ? 1_000_000 : 1;
  return { value: n * factor, plain: n, start: m.index, end, pound: !!m[1], mult: !!mult, k: mult === "k" || mult === "thousand" };
}

const looksLikeMoney = (m: Money): boolean => m.pound || m.mult || m.value >= 1000;

// The money written just before `at` ("£50k CC"), with "towards the" and the like between.
function moneyBefore(text: string, at: number): Money | null {
  const from = Math.max(0, at - 48);
  const head = text.slice(from, at);
  const m = new RegExp(String.raw`(?:^|[^\d.,£])((?:£\s?)?${NUM}(?:(?:k|mn?)|\s?(?:million|thousand))?)\s?(?:(?:towards|for|of|as|in)\s)?(?:(?:the|a)\s)?$`, "i").exec(head);
  if (!m) return null;
  const start = from + m.index + m[0].indexOf(m[1]);
  const money = moneyAt(text, start);
  return money && /^\s?(?:(?:towards|for|of|as|in)\s)?(?:(?:the|a)\s)?$/i.test(text.slice(money.end, at)) ? money : null;
}

const pounds = (n: number): string => `£${Math.round(n).toLocaleString("en-GB")}`;

// ── Dates and times ────────────────────────────────────────────────────────

const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
// The same months with no capture group, for use inside other patterns.
const MONTH_WORDS = MONTH.replace("(", "(?:");
const MONTH_NO: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAY_NO: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const NOT_A_DAY = String.raw`(?!\s?(?:years?|yrs?|yr|months?|mths?|m|k|mrf|rf|%)(?![a-z]))`;
// "Unit 3/4", "breaks at 5/10", "class A1/3", "1/2 rent": numbers, not a day and a month.
const NUMBER_NOT_DATE_BEFORE = /(?:\b(?:units?|nos?\.?|numbers?|shops?|suites?|kiosks?|plots?|flats?|floors?|levels?|blocks?|phases?|class|use|breaks?|tbo|lbo|mbo|years?|yrs?|yr|ratio|split|scored?|rated|options?|stores?|pods?|pitch(?:es)?)\s?(?:at\s|in\s|on\s|of\s|:\s?)?|#\s?)$/i;
const NUMBER_NOT_DATE_AFTER = /^\s?(?:rent|of(?![a-z])|share|split|ratio|the\s+rent|price|size|way)/i;
// "MSU 1/2", "SU 3/4": a unit code in capitals, then its numbers.
const UNIT_CODE_BEFORE = /(?:^|[^A-Za-z0-9])(?:[MLKRF]?SU|[KR]U|[LU]?GF|FF|LG|UG)\s?$/;
// "3/5 Market Place", "10/12 King Street": a pair of street numbers.
const STREET = String.raw`(?:Street|St|Road|Rd|Place|Pl|Lane|Ln|Square|Sq|Parade|Walk|Row|Avenue|Ave|Way|Court|Ct|Gate|Arcade|Mews|Terrace|Crescent|Hill|Close|Drive|Yard|Quay|Wharf|Broadway|Circus|Gardens|Market|Mall|Centre|Buildings?|House|Chambers|Passage|Bridge|Green|Park|Strand|Cheapside|Piccadilly|Poultry|Kingsway|Aldwych|Holborn|Bishopsgate|Moorgate|Eastcheap|Cornhill|Haymarket|Minories)`;
const ADDRESS_AFTER = new RegExp(String.raw`^,?\s(?:(?:The|[A-Z][A-Za-z'’]+)\s){0,3}${STREET}\b`);
// "for 3/5 Cheapside", "at 1/2 Old Jewry": a pair of numbers before a name may be an address or a date.
const MAYBE_ADDRESS_BEFORE = /(?:\b(?:for|at|of)\s|@\s?)$/i;
const MAYBE_ADDRESS_AFTER = /^\s[A-Z][a-z]/;
// A count, a length or a time straight after a number: "25 covers", "25 year lease", "10am".
const NOT_A_YEAR_AFTER = String.raw`(?!\d|[:.,]\d|[/%]|(?:st|nd|rd|th)\b|\s?(?:years?|yrs?|yr|y|months?|mths?|m|k|mrf|rf|%|[ap]\.?m\.?|x|weeks?|wks?|days?|sq|psf|people|persons?|pax|covers|seats|tables|units?|mins?|minutes?|hours?|hrs?|staff|sites?|stores?|shops?|ft|sqft|per\s?cent|pct|attendees|guests|visitors|viewings|offers|brands|operators|tenants|parties|enquiries|interested|nights|of)(?![a-z]))`;

// How a day and month with no year is placed.
//   past     the most recent such date that is not in the future. One that
//            falls in the coming weeks is not placed: it may be still to come
//   nearest  the coming one or the last one, whichever is close by (a viewing
//            may be booked ahead). One months away either way is not placed
//   future   the next such date, today included (a follow-up)
export type DateMode = "past" | "nearest" | "future";
export const dateModeFor = (kind: NoteKind): DateMode => (kind === "viewing" ? "nearest" : "past");

// `why` says why a date was not placed: it may be still to come, it has no
// year and is a long way off either way, a follow-up day that has just gone,
// or numbers that may not be a date at all.
interface Placed { day: string | null; why?: "toCome" | "farOff" | "passed" | "unclear" }
const TO_COME: Placed = { day: null, why: "toCome" };
const FAR_OFF: Placed = { day: null, why: "farOff" };
const PASSED: Placed = { day: null, why: "passed" };
const UNCLEAR: Placed = { day: null, why: "unclear" };
// A viewing with no year is placed only this close to the day the note was written.
const NEAR_DAYS = 120;
interface DateHit { start: number; end: number; quote: string; place(ref: string, mode: DateMode): Placed }

function placeDayMonth(d: number, m: number, ref: string, mode: DateMode): Placed {
  const year = Number(ref.slice(0, 4));
  const days: string[] = [];
  for (let y = year - 8; y <= year + 8; y++) { const day = dayOf(y, m, d); if (day) days.push(day); }
  if (!days.length) return { day: null };      // "31/11", "11/13": not a calendar date
  const before = days.filter(x => x <= ref).pop() || null;
  const after = days.find(x => x >= ref) || null;
  const ahead = after ? daysBetween(ref, after) : Infinity, behind = before ? daysBetween(before, ref) : Infinity;
  // "Follow up by 10 Nov", read on 13 Nov: that day has just gone, and next year's is not what was meant.
  if (mode === "future") return before !== ref && behind <= SOON_DAYS ? PASSED : { day: after };
  if (mode === "past") {
    if (before !== ref && ahead <= SOON_DAYS) return TO_COME;
    return behind <= 366 ? { day: before } : FAR_OFF;      // "29 Feb" three years back is not placed
  }
  if (ahead <= NEAR_DAYS && ahead <= behind) return { day: after };
  return behind <= NEAR_DAYS ? { day: before } : FAR_OFF;
}

function placeWeekday(weekday: number, lead: string, ref: string, mode: DateMode): Placed {
  const behind = (weekdayOf(ref) - weekday + 7) % 7;     // days since the last one, 0 = today
  const ahead = (weekday - weekdayOf(ref) + 7) % 7;      // days to the next one, 0 = today
  if (lead === "last") return { day: addNoteDays(ref, -(behind || 7)) };
  const coming = lead === "next" ? addNoteDays(ref, ahead || 7) : lead === "this" || mode === "future" ? addNoteDays(ref, ahead) : null;
  if (!coming) return { day: null };   // a bare "Monday" could be last week's or next week's: left for the person
  return mode === "past" && coming > ref ? TO_COME : { day: coming };
}

const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));
// "may" is also a verb: as a month it needs a capital, an ordinal or a year.
const monthOk = (word: string, day: string, year: string | undefined): boolean =>
  word.toLowerCase() !== "may" || word[0] === "M" || !!year || /(?:st|nd|rd|th)$/i.test(day);

/** Every date written in the text, in the order written. */
export function findDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const add = (m: RegExpExecArray, place: DateHit["place"]) => hits.push({ start: m.index, end: m.index + m[0].length, quote: m[0], place });
  each(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/, text, m => add(m, () => ({ day: dayOf(+m[1], +m[2], +m[3]) })));
  // "5 Nov 25": two digits after a day and month are the year when they could be one and nothing after them says otherwise.
  each(new RegExp(String.raw`(?<![\d.,£/])(\d{1,2}(?:st|nd|rd|th)?)[\s-](?:of\s)?${MONTH}\b\.?(?:(?:,?\s|-)(\d{4})(?!\d)|(?:\s'|-)(\d{2})(?!\d|\s${MONTH_WORDS}\b)|\s(2\d|3[0-5])${NOT_A_YEAR_AFTER})?`, "i"), text, m => {
    const year = m[3] || m[4] || m[5];
    if (!monthOk(m[2], m[1], year)) return;
    if (!year && NUMBER_NOT_DATE_BEFORE.test(back(text, m.index, 16))) return;      // "Unit 12 Nov Street"
    const d = parseInt(m[1], 10), mo = MONTH_NO[m[2].slice(0, 3).toLowerCase()];
    add(m, (ref, mode) => {
      if (!year) return placeDayMonth(d, mo, ref, mode);
      // A bare "25" is taken as the year only when it is this year or next to it.
      if (m[5] && Math.abs(fullYear(year) - Number(ref.slice(0, 4))) > 1) return UNCLEAR;
      return { day: dayOf(fullYear(year), mo, d) };
    });
  });
  each(new RegExp(String.raw`\b${MONTH}\.?\s(\d{1,2}(?:st|nd|rd|th)?)(?![\d,.]*\d)${NOT_A_DAY}(?:,?\s(\d{4})(?!\d))?`, "i"), text, m => {
    if (!monthOk(m[1], m[2], m[3])) return;
    const d = parseInt(m[2], 10), mo = MONTH_NO[m[1].slice(0, 3).toLowerCase()];
    add(m, (ref, mode) => (m[3] ? { day: dayOf(Number(m[3]), mo, d) } : placeDayMonth(d, mo, ref, mode)));
  });
  // British order: day, month, year. A slash date may leave the year off.
  each(new RegExp(String.raw`(?<![\d/.£A-Za-z-])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])${NOT_A_DAY}`), text, m => {
    if (m[0] === "24/7") return;
    const before = back(text, m.index, 16), after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    // A fraction, a pair of unit numbers or a pair of street numbers is not a date.
    if (!m[3] && (NUMBER_NOT_DATE_BEFORE.test(before) || UNIT_CODE_BEFORE.test(before) || NUMBER_NOT_DATE_AFTER.test(after.slice(0, 12)) || ADDRESS_AFTER.test(after))) return;
    // "Offer for 3/5 Cheapside": an address or a date. Not placed, and the reason says so.
    const maybeAddress = !m[3] && MAYBE_ADDRESS_BEFORE.test(before) && MAYBE_ADDRESS_AFTER.test(after);
    add(m, (ref, mode) => (maybeAddress ? UNCLEAR : m[3] ? { day: dayOf(fullYear(m[3]), +m[2], +m[1]) } : placeDayMonth(+m[1], +m[2], ref, mode)));
  });
  each(/(?<![\d/.£-])(\d{1,2})([.-])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/, text, m => add(m, () => ({ day: dayOf(fullYear(m[4]), +m[3], +m[1]) })));
  each(/\b(today|yesterday|tomorrow)\b/i, text, m => {
    const shift = { today: 0, yesterday: -1, tomorrow: 1 }[m[1].toLowerCase() as "today" | "yesterday" | "tomorrow"];
    add(m, (ref, mode) => (shift > 0 && mode === "past" ? TO_COME : { day: addNoteDays(ref, shift) }));
  });
  // Short weekday names need their capital ("Sat" is a day, "sat" is not).
  each(/\b(?:([Ll]ast|[Nn]ext|[Tt]his|[Oo]n)\s)?([Mm]onday|[Tt]uesday|[Ww]ednesday|[Tt]hursday|[Ff]riday|[Ss]aturday|[Ss]unday|Mon|Tues?|Wed|Thurs?|Thu|Fri|Sat|Sun)\b/, text, m => {
    add(m, (ref, mode) => placeWeekday(WEEKDAY_NO[m[2].slice(0, 3).toLowerCase()], (m[1] || "").toLowerCase(), ref, mode));
  });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: DateHit[] = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
  return out;
}

/** The first date in a piece of text, placed against `today`. Null when none can be placed with certainty. */
export function readLooseDate(text: string, today: string, mode: DateMode = "past"): string | null {
  for (const hit of findDates(cleanNote(text))) { const day = hit.place(today, mode).day; if (day) return day; }
  return null;
}

// A date that is not when the offer was made or the viewing held: an opening,
// a completion, a lease expiry, a start, a deadline.
const NOT_THIS_DATE_LEAD = /\b(?:open(?:s|ing|ed)?|launch(?:es|ing)?|completion|complet(?:e|es|ing)|exchange|expir(?:es|y|ing|ed)|ends?|ending|start(?:s|ing)?|commenc(?:e|es|ing|ement)|handover|possession|access|deadline|longstop|due|from|by|until|till|before|after|since|effective|w\/c|wc|commencing|w\.?e\.?f\.?)\s?(?:date\s?)?(?:is\s|of\s|on\s|:\s?|-\s?)?(?:the\s)?$/i;
// A viewing that was moved: the new day is not the day an outcome is about.
const MOVED_LEAD = /\b(?:postponed|moved|rebooked|rescheduled|pushed(?:\sback)?|put\sback|delayed)\s(?:to|for|until|till)\s(?:the\s)?$/i;
const OTHER_EVENT_AFTER = /^\s?(?:viewing|inspection|site\s+visit|opening|completion|start|expiry|deadline|launch)\b/i;
const NOT_PLACED_REASON = (quote: string, why: Placed["why"]) => {
  const said = `"${quote.replace(/\.$/, "")}"`;
  if (why === "farOff") return `${said} has no year and is a long way off either way. Set the date by hand.`;
  if (why === "passed") return `${said} looks like a follow-up date that has passed. Set it by hand.`;
  if (why === "unclear") return `${said} may not be a date, or its year is not clear. Set the date by hand.`;
  return `${said} looks like a date still to come. Set the date by hand.`;
};

function dateIsOfSomethingElse(text: string, hit: Span, kind: NoteKind): boolean {
  const before = back(text, hit.start, 32);
  if (NOT_THIS_DATE_LEAD.test(before)) return true;
  if (kind !== "viewing" && MOVED_LEAD.test(before)) return true;
  return kind !== "viewing" && kind !== "viewing_outcome" && OTHER_EVENT_AFTER.test(text.slice(hit.end, hit.end + 16));
}

/** `doubt` is set when the words could be read two ways: no time is to be taken from them. */
interface TimeHit { start: number; end: number; quote: string; value: string; doubt?: string }

// The number before a time is a unit's number, not an hour: "Unit 3 - 10am", "Kiosk 2 - 4.30pm".
const UNIT_WORD_BEFORE = /(?:\b(?:units?|no\.|nos\.?|numbers?|shops?|suites?|kiosks?|plots?|flats?|floors?|levels?|blocks?|phases?|stores?|pods?|pitch(?:es)?|[mlkrf]?su|gf|ff|lg|ug)\s?(?:\d{1,3}[a-z]?\s?(?:,|&|and|\+|\/)\s?)*|#\s?)$/i;
const MORE_THAN_ONE_TIME = "The note gives more than one time. Set the time by hand.";
const TIME_OF_SOMETHING_ELSE_BEFORE = /\b(?:cancel(?:led|ed)|called|rang|phoned|emailed|texted|messaged|replied|sent|received|chased|spoke|posted|logged|updated)\b[^.;,!?\u0001]{0,24}$/i;
const UNIT_OR_TIME = "A unit number runs into the time. Set the time by hand.";

export function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const add = (m: RegExpExecArray, value: string, doubt?: string) => hits.push({ start: m.index, end: m.index + m[0].length, quote: m[0], value, ...(doubt ? { doubt } : {}) });
  // A range ("2-3pm", "between 10 and 11am"): the time it starts. A number
  // that follows "Unit" or the like is that unit's number, never an hour.
  each(/(?<![\d:.£/A-Za-z])(\d{1,2})(?:[:.]([0-5]\d))?(\s?(?:-|–|to|and|&|until|till)\s?)(\d{1,2})(?:[:.]([0-5]\d))?\s?(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/i, text, m => {
    const from = Number(m[1]), to = Number(m[4]);
    const joiner = m[3].trim().toLowerCase(), before = back(text, m.index, 24);
    if (UNIT_WORD_BEFORE.test(before)) {
      if (joiner === "and" || joiner === "&") add(m, "", UNIT_OR_TIME);      // "Units 5 and 6pm": unit 6 in the afternoon, or 6pm
      return;                                                                // "Unit 3 - 10am": the time is 10am
    }
    if (from < 1 || from > 12 || to < 1 || to > 12) return;
    // "viewings at 10 and 11am" is two times; "between 10 and 11am" is one slot.
    if ((joiner === "and" || joiner === "&") && !/\bbetween\s$/i.test(before)) { add(m, "", MORE_THAN_ONE_TIME); return; }
    const endsPm = m[6].toLowerCase().startsWith("p");
    let pm: boolean;
    if (endsPm) {
      // "11-1pm" starts in the morning. "5-2pm" would start at five in the morning: not guessed.
      if (from > to && to !== 12 && from !== 12 && from < 8) { add(m, "", "That time range could be read two ways. Set the time by hand."); return; }
      pm = from === 12 || (to !== 12 && from < to);
    } else if (from === 12 || to === 12 || from >= to) return;      // across midnight: not guessed
    else pm = false;
    add(m, `${pad((from % 12) + (pm ? 12 : 0))}:${m[2] || "00"}`);
  });
  // "3pm-4pm", "10am to 12pm": both ends say which half of the day, so the start is plain.
  each(/(?<![\d:.£])(\d{1,2})(?:[:.]([0-5]\d))?\s?(am|pm|a\.m\.?|p\.m\.?)\s?(?:-|–|to|until|till)\s?\d{1,2}(?:[:.][0-5]\d)?\s?(?:am|pm|a\.m\.?|p\.m\.?)(?![a-z])/i, text, m => {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return;
    add(m, `${pad((h % 12) + (m[3].toLowerCase().startsWith("p") ? 12 : 0))}:${m[2] || "00"}`);
  });
  each(/(?<![\d:.£])(\d{1,2})(?:[:.]([0-5]\d))?\s?(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/i, text, m => {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return;
    const pm = m[3].toLowerCase().startsWith("p");
    add(m, `${pad((h % 12) + (pm ? 12 : 0))}:${m[2] || "00"}`);
  });
  each(/(?<![\d:.£])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])(?!\s?(?:am|pm))/i, text, m => add(m, `${pad(Number(m[1]))}:${m[2]}`));
  each(/\b(noon|midday)\b/i, text, m => add(m, "12:00"));
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TimeHit[] = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
  return out;
}

// ── Outcomes and whose position ────────────────────────────────────────────

const NO_SHOW = /\bno[\s-]?show\b|\b(?:didn['’]?t|did\s+not)\s+(?:show|turn\s+up|attend)\b/i;
const KEEN = /\b(?:(?:very|really|quite|super|extremely)\s)?(?:interested|keen)\b|\b(?:liked|loved|likes|loves)\s(?:it|the\s(?:unit|space|site|shop))\b|\bpositive\b/i;
const NOT_KEEN = /\bless\sso\b|\bnot\sso\smuch\b|\bunlikely\sto\s(?:proceed|progress|offer|go\s(?:ahead|forward)|take\sit|pursue|move\sforward|happen)\b|\bno\s(?:real|genuine|serious)\sinterest\b|\bnot\s(?:for\s(?:them|him|her)|proceeding|progressing|pursuing|going\s(?:ahead|forward)|moving\sforward|taking\sit\s(?:forward|further))\b|\bno\sinterest\b|\b(?:un|dis)interested\b|\b(?:they(?:['’]ve|\shave)?|have|has)\spassed\b(?!\s(?:it\s)?(?:on\s)?to\b)|\bpass(?:ed|ing)\son\s(?:it|this|the\sunit)\b|\bruled\s(?:it\s)?out\b|\b(?:they(?:['’]ve|\shave)?|have|has|brand|tenant|operator)\sdeclined\b|\bdeclined\s(?:it|the\s(?:unit|space|site)|to\s(?:offer|proceed|take|bid|progress))\b|\bturned\s(?:it|us|the\sunit)\sdown\b|\bpulled\sout\b|\bwalked\saway\b|\b(?:didn['’]?t|did\snot|don['’]?t|do\snot|doesn['’]?t|does\snot)\s(?:really\s)?(?:like|love|rate|want)\s(?:it|this|the\s(?:unit|space|site|shop))\b|\b(?:disliked|hated)\s(?:it|the\s(?:unit|space|site|shop))\b/i;
const LATER_OUTCOMES: [string, RegExp][] = [
  ["Offer Received", /\boffer\s(?:was\s|has\sbeen\s)?received\b|\breceived\s(?:an\s|their\s)?offer\b|\b(?:made|put\sin|submitted)\san\soffer\b|\boffer\s(?:is\s)?in\b/i],
  ["Offer Expected", /\boffer\s(?:is\s)?expected\b|\bexpect(?:ing)?\s(?:an\s|their\s)?offer\b|\boffer\sto\sfollow\b|\bwill\s(?:be\s)?(?:make|making|put(?:ting)?\sin|submit(?:ting)?)\san\soffer\b|\b(?:going|intend(?:s|ing)?|plan(?:s|ning)?)\sto\s(?:make\san\s)?offer\b|\bwill\soffer\b/i],
  ["Second Viewing", /\b(?:second|2nd|another|repeat|further)\sviewing\b|\bre-?visit\b|\bview(?:ing)?\s(?:it\s)?again\b|\breturn\svisit\b/i],
];
const FOLLOW_UP = /\bfollow(?:ing)?[\s-]?up\b|\bchas(?:e|ing)\b|\b(?:will|to)\srevert\b|\b(?:get|come|coming)\sback\sto\s(?:us|me)\b|\b(?:thinking\sabout|considering)\sit\b/i;
const NEGATORS = new Set(("not no never nor neither without hardly barely less unlikely cannot isnt wasnt werent arent didnt dont doesnt wont cant couldnt wouldnt " +
  "hasnt havent").split(" "));
// Words that may sit between "not" and "keen" without changing what is meant.
const SOFTENERS = new Set(("very really that too so all particularly overly especially massively hugely terribly exactly quite as at been be being feeling looking " +
  "sounding seem seemed seems super extremely a bit longer any more still yet currently now").split(" "));
// "Not keen on the frontage" is an objection to one thing, not a view on the unit.
const ABOUT_ONE_THING = /^\s(?:on|in|about|with|at)\s(?!(?:it|them|all|present|taking|proceeding)\b|(?:this|that)\s(?:stage|time|point)\b|(?:this|that)\b(?!\s\w)|the\s(?:unit|space|site|shop|moment)\b)/i;
const BOTH_WAYS_REASON = "The note reads both ways (keen and not keen). Choose the outcome.";
// "Will revert if interested", "doubt they are keen", "asked whether we would
// be interested": the keenness is a condition or a doubt, so it says nothing either way.
const DOUBTERS = new Set(("if whether unless doubt doubts doubted doubtful doubtfully unsure unclear unconvinced should might may maybe perhaps possibly " +
  "potentially could wonder wondering depends depending").split(" "));
const CONDITION_AFTER = /^\s?\?|^\s(?:if|only\sif|but\sonly|provided|providing|as\slong\sas|so\slong\sas|assuming|depending|dependent|at\sthe\sright\s(?:rent|price|number|deal|terms|level))\b/i;
// "Interested parties: none yet" is not about this brand's view.
const NOT_A_VIEW_AFTER = /^\s(?:part(?:y|ies)|buyers?|purchasers?|bidders?)\b/i;
// "More interested in Unit 5 next door": a comparison with something else.
const COMPARED_BEFORE = /\b(?:more|less|most|rather|mainly|mostly|only|primarily|chiefly)\s$/i;

// The word that turns the phrase at `start` round ("not", "wasn't", "no longer"), looking back a few words within the same clause.
function negatedAt(text: string, start: number): { at: number; between: string[]; twice: boolean } | null {
  const window = back(text, start, 44);
  const base = start - window.length;
  let cut = 0;
  each(/[.;!?,\u0001]|\b(?:but|however|although|though|whereas)\b/i, window, m => { cut = m.index + m[0].length; });
  const words: { word: string; at: number }[] = [];
  each(/[A-Za-z]+(?:['’][A-Za-z]+)?/, window.slice(cut), m => { words.push({ word: m[0].toLowerCase().replace(/’/g, "'"), at: base + cut + m.index }); });
  const last = words.slice(-5);
  const turns = (w: string): boolean => NEGATORS.has(w) || /n't$/.test(w);
  for (let i = last.length - 1; i >= 0; i--) {
    if (turns(last[i].word)) return { at: last[i].at, between: last.slice(i + 1).map(w => w.word), twice: last.slice(0, i).some(w => turns(w.word)) };
  }
  return null;
}

// The words of the same clause that come before a place, the nearest few.
function clauseWordsBefore(text: string, start: number, count = 7): string[] {
  const window = back(text, start, 60);
  let cut = 0;
  each(/[.;!?,\u0001]|\b(?:but|however|although|though|whereas)\b/i, window, m => { cut = m.index + m[0].length; });
  // "May" with its capital is the month, not a doubt.
  return (window.slice(cut).match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).slice(-count).filter(w => w !== "May").map(w => w.toLowerCase().replace(/’/g, "'"));
}

/** `doubt` marks words that mention keenness only as a condition or a doubt: they give no outcome. */
type OutcomeRead = { outcome: string; quote: string; start: number } | { reason: string } | { doubt: true } | null;

function readOutcome(text: string, within?: Span): OutcomeRead {
  const hit = (outcome: string, start: number, end: number) => ({ outcome, quote: text.slice(start, end), start });
  const inside = (m: RegExpExecArray): boolean => !within || (m.index >= within.start && m.index + m[0].length <= within.end);
  const keen: Span[] = [], notKeen: Span[] = [], noShows: Span[] = [];
  each(NO_SHOW, text, m => { if (inside(m) && !(/^no/i.test(m[0]) && negatedAt(text, m.index))) noShows.push({ start: m.index, end: m.index + m[0].length }); });      // "not a no show"
  if (noShows.length) return hit("No Show", noShows[0].start, noShows[0].end);
  let oneThing = false, doubt = false;
  each(KEEN, text, m => {
    if (!inside(m)) return;
    const end = m.index + m[0].length;
    const after = text.slice(end, end + 28);
    if (NOT_A_VIEW_AFTER.test(after)) return;
    if (clauseWordsBefore(text, m.index).some(w => DOUBTERS.has(w)) || CONDITION_AFTER.test(after) || COMPARED_BEFORE.test(back(text, m.index, 12))) { doubt = true; return; }
    const neg = negatedAt(text, m.index);
    if (!neg) keen.push({ start: m.index, end });
    else if (neg.twice || !neg.between.every(w => SOFTENERS.has(w))) return;       // "not sure they are interested", "wasn't not interested": says nothing either way
    else if (ABOUT_ONE_THING.test(text.slice(end, end + 28))) oneThing = true;
    else notKeen.push({ start: neg.at, end });
  });
  each(NOT_KEEN, text, m => {
    if (!inside(m) || negatedAt(text, m.index)) return;
    if (clauseWordsBefore(text, m.index).some(w => DOUBTERS.has(w))) { doubt = true; return; }      // "if they have passed, we go to Pho"
    notKeen.push({ start: m.index, end: m.index + m[0].length });
  });
  if (keen.length && (notKeen.length || oneThing)) return { reason: BOTH_WAYS_REASON };
  if (notKeen.length) { const first = notKeen.sort((a, b) => a.start - b.start)[0]; return hit("Not Interested", first.start, first.end); }
  const firstPlain = (re: RegExp): Span | null => {
    let found: Span | null = null;
    each(re, text, m => { if (!found && inside(m) && !negatedAt(text, m.index)) found = { start: m.index, end: m.index + m[0].length }; });
    return found;
  };
  for (const [outcome, re] of LATER_OUTCOMES) { const s = firstPlain(re); if (s) return hit(outcome, s.start, s.end); }
  if (keen.length) return hit("Interested", keen[0].start, keen[0].end);
  const follow = firstPlain(FOLLOW_UP);
  return follow ? hit("Follow Up", follow.start, follow.end) : doubt ? { doubt: true } : null;
}

/**
 * The viewing outcome a phrase means, or null. "Not very keen", "no longer
 * interested" and "didn't like it" are Not Interested; a phrase that says
 * both, or neither plainly, gives null.
 */
export function outcomeFromWords(text: string): { outcome: string; quote: string; start: number } | null {
  const exact = NOTE_OUTCOMES.find(o => o.toLowerCase() === norm(text));
  if (exact) return { outcome: exact, quote: text, start: 0 };
  const read = readOutcome(cleanNote(text).replace(/\n/g, LINE));
  return read && "outcome" in read ? read : null;
}

const WHICH_POSITION = String.raw`(?:(?:final|revised|latest|improved|best|new|first|second|third|opening|current|last)\s)?`;
const LANDLORD_SAID = new RegExp(String.raw`\b(?:we|i)(?:\shave|['’]ve|\sare|['’]re)?\s(?:countered|counter(?:[\s-]?offered)?|went\sback|gone\sback|came\sback|responded|proposed|offered|put\sforward|accepted|rejected|refused|declined|want|wanted|need|at(?=\s£?\d))\b|\b(?:landlord|ll|client|our)(?:['’]s)?\s${WHICH_POSITION}(?:counter(?:ed)?(?:[\s-]?offer)?|response|proposal|position|came\sback|offered|proposed)\b`, "i");
const TENANT_SAID = new RegExp(String.raw`\bthey(?:\shave|['’]ve|\sare|['’]re)?\s(?:still\s)?(?:offered|countered|came\sback|come\sback|proposed|increased|improved|revised|upped|responded|rejected|refused|declined|accepted|agreed|moved|want|wanted|asked|holding|sticking|at(?=\s£?\d))\b|\b(?:tenant|brand|operator|occupier|their)(?:['’]s)?\s${WHICH_POSITION}(?:offer(?:ed)?|counter(?:ed)?(?:[\s-]?offer)?|came\sback|proposal|proposed|position|revised(?:\soffer)?|response|improved(?:\soffer)?)\b`, "i");

// ── The author stamp ───────────────────────────────────────────────────────

// Words that start a note about a letting and are not a person's name
// ("Offer Received 9 Nov" is not written by someone called Offer Received).
const NOT_A_NAME = new Set(("offer offered offers received viewing viewed rent lease term terms tenant landlord counter countered they we the brand " +
  "interest interested meeting call email spoke met update note notes re hots heads second first new agreed follow up no show not break premium " +
  "deposit unit site visit inspection proposal revised final best bid on at from to with for and or by of in their our his her " +
  "jan january feb february mar march apr april may jun june jul july aug august sep sept september oct october nov november dec december " +
  "mon monday tue tues tuesday wed wednesday thu thur thurs thursday fri friday sat saturday sun sunday today yesterday tomorrow").split(" "));

// Agents' firms that read like a person's name ("Knight Frank 9 Nov").
const AGENT_FIRMS = ["knight frank", "cushman wakefield", "avison young", "lambert smith hampton", "gerald eve", "montagu evans", "shelley sandzer", "davis coffer lyons",
  "nash bond", "lunson mitchenall", "jackson criss", "kenningham retail", "brasier freeth", "hanover green", "harper dennis hobbs", "bruce gillingham pollard", "time retail partners"];
const isAgentFirm = (name: string): boolean => { const n = norm(name).replace(/\s?&\s?/g, " "); return AGENT_FIRMS.some(f => n === f || n.startsWith(`${f} `)); };

// First names in common use. A name the reader does not know is taken for a
// person, and so for who wrote the note, only when it starts with one of
// these: "Krispy Kreme 9 Nov Offered" is a brand, "Ben Sykes 9 Nov Offered" a person.
const PERSON_FIRST_NAMES = new Set(("adam adrian aidan alan alex alexander alexandra alice alison amanda amelia amy andrea andrew andy angela ann anna anne anthony " +
  "antony archie arthur ashley barry becky ben benjamin beth bethany bob brian bruce callum cameron cara carl carol caroline catherine cathy charles charlie " +
  "charlotte chloe chris christian christine christopher claire clare colin connor craig dan daniel danny darren dave david dawn dean debbie deborah dennis " +
  "derek diane dominic donna doug douglas duncan ed eddie edward eleanor elizabeth ella ellie emily emma eric ewan fiona frances francis frank fred freddie " +
  "gareth gary gavin gemma geoff george georgia georgina gill gillian glen gordon grace graham grant greg gregory guy hannah harriet harry hayley heather " +
  "helen henry holly howard hugh hugo iain ian imogen isabel isabella jack jackie jacob jacqueline jake james jamie jane janet jason jay jean jen jenny " +
  "jennifer jeremy jess jessica jill jim jo joan joanna joanne joe joel john johnny jon jonathan jonny jordan joseph josh joshua judith julia julian julie " +
  "justin karen kate katherine kathryn katie kay keith kelly ken kenneth kerry kevin kieran kim kirsty kyle laura lauren lee leah leanne lewis liam linda " +
  "lisa liz lloyd louis louise lucy luke lydia lynn maddie malcolm marcus margaret maria marie mark martin mary matt matthew megan mel melanie melissa " +
  "michael michelle mick mike millie mohammed molly naomi natalie natasha nathan neil niall nick nicholas nicola nicole nigel oliver olivia ollie oscar owen " +
  "pat patricia patrick paul paula pete peter phil philip phillip philippa pippa rachel ralph ray rebecca rhys richard rick rob robert robin roger ron rory " +
  "rosie ross roy rupert russell ruth ryan sally sam samantha samuel sandra sara sarah scott sean seb sebastian shane sharon shaun sheila simon sophie " +
  "stacey stephanie stephen steve steven stewart stuart sue susan suzanne tania tanya terry tessa theo thomas tim timothy toby tom tony tracey tracy trevor " +
  "vanessa vicky victoria vince vincent wayne wendy will william woody yvonne zach zoe").split(" "));
// Brands that read like a person's name: never taken for the note's author.
const PERSON_LIKE_BRANDS = new Set(["ted baker", "tim hortons", "paul smith", "jo malone", "jack wills", "joe browns", "tommy hilfiger", "calvin klein", "michael kors",
  "ralph lauren", "hugo boss", "kate spade", "laura ashley", "charlotte tilbury", "vivienne westwood", "karen millen", "max mara", "ben sherman", "fred perry",
  "kurt geiger", "russell bromley", "russell & bromley", "harvey nichols", "john lewis", "stella mccartney", "cath kidston", "lulu guinness", "anya hindmarch",
  "oliver bonas", "oliver sweeney", "charles tyrwhitt", "thomas pink", "thomas sabo", "jimmy choo", "tom ford", "marc jacobs", "victoria beckham", "jamie oliver",
  "gordon ramsay", "rick stein", "tom kerridge", "harry ramsden", "harry ramsdens", "ben & jerry", "ben & jerrys", "joe & the juice", "paul bakery", "tony macaroni",
  "frankie & benny", "frankie & bennys", "holland & barrett", "marks & spencer", "crew clothing", "george asda", "simon carter", "jeff banks", "louis vuitton",
  "emma bridgewater", "sophie allport", "jack & jones", "sally beauty", "mary portas"]);

interface Stamp { name: string; known: boolean; day: string | null; why?: Placed["why"]; dateQuote: string; dateStart: number; end: number }

// A leading "Ben Sykes 9 Nov", as the tracker draws a target comment (who,
// short date, then the words): who wrote the note and when. Never the brand's
// contact. A name the reader knows (the caller, a colleague, the source's own
// author) is always taken. Any other name is taken only in the tracker's own
// shape, a person's name, a date, then words that start with a capital, and
// never when it is made of everyday words or does not start with a first
// name: "Honest Burgers 9 Nov: offered..." and "Krispy Kreme 9 Nov Offered"
// are brands, and "Sam Hart 12 Nov offered..." may be the brand's own person.
// A name that is not taken stays at the head of the notes, so it is not lost.
function readStamp(text: string, dates: DateHit[], ctx: NoteContext, ref: string): Stamp | null {
  const known = [...(ctx.staffNames || []), ...(ctx.author ? [ctx.author] : [])];
  const brands = ctx.brandNames || [];
  for (const date of dates) {
    if (date.start > 90) break;
    const before = text.slice(0, date.start).replace(/[\s,:(–·|-]+$/, "");
    if (!before || before.length > 80 || /[.;!?\u0001]/.test(before)) continue;
    const knownAs = known.find(k => sameName(k, before));
    const isKnown = !!knownAs;
    if (!isKnown && !/^[A-Z][A-Za-z'’-]*(?:\s[A-Z][A-Za-z'’-]*){1,3}$/.test(before)) continue;      // one word and a date is more likely a brand
    const placed = date.place(ref, "past");
    if (!placed.day && !placed.why) continue;
    const tail = /^(?:\s\d{1,2}[:.]\d{2}(?:\s?(?:am|pm))?)?\s?[):,–·|-]?[\s\u0001]?/i.exec(text.slice(date.end, date.end + 16))![0].length;
    const end = date.end + tail;
    if (!isKnown) {
      const words = before.split(/\s/);
      if (isAgentFirm(before) || words.some(w => NOT_A_NAME.has(wordKey(w)) || ORDINARY.has(wordKey(w)) || /['’]s$/i.test(w))) continue;
      if (!PERSON_FIRST_NAMES.has(wordKey(words[0])) || PERSON_LIKE_BRANDS.has(norm(before).replace(/['’]/g, ""))) continue;
      if (brands.some(b => sameName(b, before))) continue;
      if (!placed.day || (end < text.length && !/[A-Z]/.test(text[end]))) continue;
    }
    return { name: knownAs ? knownAs.trim() : before, known: isKnown, day: placed.day, why: placed.why, dateQuote: date.quote, dateStart: date.start, end };
  }
  return null;
}

// ── The shorthand reader ───────────────────────────────────────────────────

// The lead of a term that takes the figure after it: "Rent free 9 months",
// "RF 9 months", "Term 10 years", "Deposit 6 months". Group 1 is a figure that
// the lead itself follows ("6 months deposit 3 months rent free"), in which
// case the lead belongs to that figure and not to the next one.
const TERM_LEAD_BEFORE = /(?:(\d(?:\.\d+)?\s?(?:months?|mths?|mos?|m|years?|yrs?|yr)(?:['’]s?)?\s))?(?:\brent[\s-]?free(?:\speriod)?|\br\/f|\brf|\b(?:lease\s)?term|\blease|\bletting|\b(?:rent(?:al)?\s)?deposit|\bdep)\s?(?:of\s|for\s|is\s|:\s?|-\s?|=\s?)?$/i;
const ledByTerm = (text: string, at: number): boolean => { const m = TERM_LEAD_BEFORE.exec(back(text, at, 36)); return !!m && !m[1]; };

// "6-9 months rent free", "8 to 10% t/o", "3 or 6 months deposit", "6 + 6 MRF": two figures, so neither is taken.
// A dash with a space each side is a list ("TBO yr 5 - 6 MRF"), not a range.
function oneOfTwoFigures(text: string, m: RegExpExecArray): boolean {
  const at = (m as RegExpExecArray & { indices?: ([number, number] | undefined)[] }).indices?.[1];
  if (!at) return false;
  // The first figure may carry its own unit: "from 8% to 10% turnover", "6 months to 9 months rent free".
  return /\d\s?(?:%|months?|mths?)?(?:[-–]|\s?\+\s?|\s(?:to|or)\s)$/i.test(back(text, at[0], 14)) || /^(?:[-–]|\s?\+\s?|\s(?:to|or)\s)\d/i.test(text.slice(at[1], at[1] + 5));
}

// "No to the 12 months rent free", "rejected £135k pax", "instead of 12 MRF": a term the note turns down is not a term of the offer.
const TURNED_DOWN_BEFORE = /\b(?:no|not|never|won['’]?t|can['’]?t|cannot|couldn['’]?t|wouldn['’]?t|didn['’]?t|don['’]?t|doesn['’]?t|refus(?:ed|ing|es)|reject(?:ed|ing|s)|declin(?:ed|ing|es)|said\sno|instead\sof|rather\sthan|in\splace\sof|in\slieu\sof|dropp(?:ed|ing)|withdr(?:ew|awn|awing))\s(?:to\s)?(?:(?:do|give|accept|agree(?:\sto)?|pay|go(?:ing)?\sto|offer|take|consider|entertain|stretch\sto|budge\son|get|have|want|need|like)\s)?(?:to\s)?(?:(?:the|a|an|any|their|our|his|her)\s)?(?:(?:request(?:ed)?|ask|demand|counter|offer)\s(?:for\s|of\s)?)?$/i;
// "12 MRF requested, not agreed", "£135k pax rejected": the same, said after the term.
const TURNED_DOWN_AFTER_TERM = /^[\s,(]*(?:(?:was|were|is|has\sbeen|have\sbeen|requested|asked\sfor|sought|wanted)[\s,]+){0,2}(?:not\s(?:agreed|accepted|acceptable|approved|possible|happening|on\sthe\stable)(?!\s(?:yet\s)?(?:on|re|regarding|about|for)\b)|refused|rejected|declined|turned\sdown|a\snon[\s-]?starter)\b/i;
const turnedDownReason = (words: string, what: string): string => `The note turns "${words}" down, or sets it against something else. Type the ${what}.`;

// "No rent free discussed yet", "rent free: none agreed": nothing has been settled, which is not the same as nil.
const NOT_SETTLED = String.raw`(?!\s(?:period\s)?(?:(?:has|have|had|was|is|were)\s)?(?:been\s)?(?:discussed|agreed|mentioned|offered|proposed|requested|confirmed|yet|so\sfar|as\syet|at\sthis)\b)`;
// A rent free period counted in weeks or days is not turned into months.
const RENT_FREE_IN_WEEKS = /\b(?:rent[\s-]?free(?:\speriod)?|rf|r\/f)\s?(?:of\s|is\s|:\s?|-\s?|=\s?)?\d{1,3}\s?(?:weeks?|wks?|days?)\b|(?<![\d.,£])\d{1,3}\s?(?:weeks?|wks?|days?)(?:['’]s?)?\s?(?:of\s)?(?:rent[\s-]?free|r\/f|rf)\b/i;
const MORE_RENT_FREE = "The note gives more than one rent free period. Type the months.";
const MORE_DEPOSITS = "The note gives more than one deposit. Type the deposit.";
const MORE_TURNOVER = "The note gives more than one turnover percentage. Type it.";
const MORE_BREAKS = "The note gives more than one break. Type the break.";

const RENT_FREE: { re: RegExp; years?: boolean; trails?: boolean; nil?: boolean }[] = [
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:x\s?)?m\.?r\.?f\b\.?/i, trails: true },
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?|mos?|m)(?:['’]s?)?\s?(?:of\s)?(?:rent[\s-]?free|r\/f|rf)\b/i, trails: true },
  { re: /\brent[\s-]?free(?:\speriod)?\s?(?:of\s|is\s|:\s?|-\s?|=\s?|\|\s?)?(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?|mos?|m)\b/i },
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?)\sfree\b(?!\s(?:of|from)\s(?!rent\b))/i, trails: true },      // not "3 months free of service charge"
  { re: /(?<![\d.,£])(\d{1,2}(?:\.\d+)?)\s?(?:years?|yrs?|yr)(?:['’]s?)?\s?(?:of\s)?(?:rent[\s-]?free|r\/f|rf)\b(?!\s?(?:of\s|:\s?|-\s?|=\s?)?\d)/i, years: true, trails: true },
  { re: /\brent[\s-]?free(?:\speriod)?\s?(?:of\s|is\s|:\s?|-\s?|=\s?)?(\d{1,2}(?:\.\d+)?)\s?(?:years?|yrs?)\b/i, years: true },
  { re: /(?<![\d.,£])(\d{1,3})\s?rf\b/i, trails: true },
  { re: /\b(?:rf|r\/f)\s?(?:of\s|:\s?|-\s?|=\s?)?(\d{1,3})(?:\s?(?:months?|mths?|m))?\b(?!\s?(?:years?|yrs?|%|k\b|weeks?|wks?|days?))/i },
  { re: new RegExp(String.raw`\b(?:rent[\s-]?free(?:\speriod)?|rf|r\/f)\s?(?:is\s|:\s?|-\s?|=\s?)?(?:nil|none|zero)\b${NOT_SETTLED}|\bno\srent[\s-]?free\b${NOT_SETTLED}|\bnil\srent[\s-]?free\b`, "i"), nil: true },
];
// "Their t/o 15% up on last year", "turnover 12% ahead of budget": how trade is going, not a turnover rent.
const TRADE_MOVE = String.raw`(?:up|down|ahead|behind|above|below|higher|lower|more|less|better|worse|increase|increased|growth|grew|rise|rose|drop|fall|fell|uplift|yoy|lfl|like[\s-]for|year[\s-]on)`;
const TURNOVER: RegExp[] = [
  new RegExp(String.raw`(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent|pct)\s?(?:of\s)?(?:gross\s)?(?:t\/o|t\.o\.?|turnover|tor\b)(?:\srent)?(?!\s${TRADE_MOVE}\b)`, "i"),
  new RegExp(String.raw`\b(?:t\/o|turnover|tor)(?:\srent)?\s?(?:of\s|at\s|:\s?|-\s?|=\s?|@\s?)?(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent|pct)(?!\s?${TRADE_MOVE}\b)`, "i"),
  // "9% TO": TO in capitals is turnover; "to" in small letters is a word.
  new RegExp(String.raw`(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?%\s?TO\b(?!\s(?:${TRADE_MOVE})\b)`),
  new RegExp(String.raw`\bTO\s?(?:of\s|at\s|:\s?|@\s?)?(\d{1,3}(?:\.\d+)?)\s?%(?!\s?(?:${TRADE_MOVE})\b)`),
];
const WHO = String.raw`(tenant|landlord|mutual|rolling)(?:['’]?s)?(?:[\s-]only)?`;
const BREAKS: { re: RegExp; who: number; year: number[]; leads?: boolean }[] = [
  // "T break yr 5", "LL break at year 3": T and LL in capitals.
  { re: /\b(T|LL)\sbreak(?:\s(?:option|clause))?\s?(?:at\s|in\s|@\s?|on\s|after\s)?(?:the\s)?(?:end\sof\s)?(?:(?:year|yr|y)\s?(\d{1,2})\b|(\d{1,2})(?:st|nd|rd|th)\b(?:\s(?:year|anniversary))?)(?!\s?\/)/, who: 1, year: [2, 3] },
  { re: /(?<![\d.,£])(\d{1,2})(?:st|nd|rd|th)?[\s-]?(?:years?|yrs?|yr)\s(tbo|lbo|mbo)\b/i, who: 2, year: [1], leads: true },
  // Not "TBO on 6 months notice": a notice period is not the year of the break.
  { re: /\b(tbo|lbo|mbo)\s?(?:at\s|in\s|@\s?|on\s|[-–:|]\s?)?(?:the\s)?(?:end\sof\s)?(?:year|yr|y)?\s?(\d{1,2})(?:st|nd|rd|th)?(?:\s(?:year|anniversary))?\b(?!\s?(?:\/|months?|mths?|weeks?|wks?|days?|%|mrf\b|rf\b|m\b|k\b))/i, who: 1, year: [2] },
  { re: new RegExp(String.raw`\b(?:${WHO}\s)?break(?:\s(?:option|clause))?\s?(?:at\s|in\s|@\s?|on\s|after\s)?(?:the\s)?(?:end\sof\s)?(?:(?:year|yr|y)\s?(\d{1,2})\b|(\d{1,2})(?:st|nd|rd|th)\b(?:\s(?:year|anniversary))?)(?!\s?\/)`, "i"), who: 1, year: [2, 3] },
  { re: new RegExp(String.raw`\b(?:${WHO}\s)?break(?:\s(?:option|clause))?\s(?:at|in|on|after)\s(?:the\s)?(?:end\sof\s)?(\d{1,2})\b(?:\s?(?:years?|yrs?))?(?!\s?(?:months?|mths?|%|\/|[.:]\d|am\b|pm\b))`, "i"), who: 1, year: [2] },
  { re: new RegExp(String.raw`(?<![\d.,£])(\d{1,2})(?:st|nd|rd|th)?[\s-]?(?:year|yr)\s(?:${WHO}\s)?break\b(?:\s(?:option|clause))?`, "i"), who: 2, year: [1] },
];
// "15 yrs TBO yr 10": the break names its own year, so the years before it are the term.
const BREAK_OWN_YEAR_AFTER = /^\s?(?:at\s|in\s|@\s?|on\s)?(?:the\s)?(?:end\sof\s)?(?:(?:year|yr|y)\s?\d{1,2}\b|\d{1,2}(?:st|nd|rd|th)\b|\d{1,2}\b(?!\s?(?:\/|months?|mths?|weeks?|wks?|days?|%|mrf\b|rf\b|m\b|k\b|years?|yrs?|yr\b|x\b)))/i;
// "break at year 5 and year 10", "TBO yr 5 & 10": a second break after the first.
const SECOND_BREAK = new RegExp(String.raw`^\s?(?:&|and|or|,|\/|\+)\s?(?:(?:at\s)?(?:the\s)?(?:end\sof\s)?(?:years?|yrs?|y)\s?)?\d{1,2}(?:st|nd|rd|th)?\b(?![.:/]\d|\s?(?:mrf|rf|months?|mths?|m|%|k|years?|yrs?|yr|yrly|yearly|x|am|pm|weeks?|wks?|days?)(?![a-z])|\s${MONTH}\b)`, "i");
const BREAKS_PLURAL = /\bbreaks\s(?:(?:at|in|on|after)\s)?(?:the\s)?(?:(?:years?|yrs?)\s?)?\d|\b(?:tbo|lbo|mbo)s?\s(?:at\s|in\s)?(?:years|yrs)\s?\d/i;
const NO_BREAK = /\bno\sbreaks?\b(?!\s(?:penalt(?:y|ies)|fees?|costs?|payments?|charges?|premium|notice))/i;
const BREAK_WHO: Record<string, string> = { tbo: "Tenant", lbo: "Landlord", mbo: "Mutual", tenant: "Tenant", landlord: "Landlord", mutual: "Mutual", rolling: "Rolling", t: "Tenant", ll: "Landlord" };
const REVIEW_BASIS = String.raw`(?:\s?(?:,\s?)?(?:(?:to|linked\sto|at|-)\s?)?(?:omv|omr|open\smarket(?:\s(?:value|rent))?|rpi|cpi|index(?:ed|ation)?|fixed(?:\suplifts?)?)(?![a-z])(?:\s(?:cap(?:ped)?|collar(?:ed)?)[^.;,\u0001]{0,60})?)`;
const UPWARDS = String.raw`(?:,?\s(?:and\s)?upwards?[\s-]only)`;
// "Rent review at year 5 and 10": the further years belong to the review.
const MORE_REVIEW_YEARS = String.raw`(?:\s?(?:&|and|,)\s?(?:(?:year|yr)\s?)?\d{1,2}(?:st|nd|rd|th)?\b(?![.:/]\d|\s?(?:mrf|rf|months?|mths?|m|%|k|years?|yrs?|yr|am|pm)(?![a-z])))*`;
const REVIEWS: RegExp[] = [
  new RegExp(String.raw`(?<![\d.,£])\d{1,2}[\s-]?(?:yearly|year|yr)\s(?:upwards?[\s-]only\s)?(?:(?:rent\s)?reviews?|rr)\b${REVIEW_BASIS}?${UPWARDS}?`, "i"),
  new RegExp(String.raw`\b(?:upwards?[\s-]only\s)?(?:rent\sreviews?|rr)\b(?:\s?(?::\s?|-\s?|at\s|in\s|every\s|@\s?|on\s)?(?:the\s)?(?:end\sof\s)?(?:year\s?|yr\s?)?\d{1,2}(?:st|nd|rd|th)?(?:\s?(?:yearly|years?|yrs?|anniversary))?${MORE_REVIEW_YEARS}${REVIEW_BASIS}?|${REVIEW_BASIS})${UPWARDS}?`, "i"),
];
const DEPOSITS: { re: RegExp; months?: boolean; none?: boolean; trails?: boolean }[] = [
  { re: /(?<![\d.,£])(\d{1,2})\s?(?:months?|mths?|m)(?:['’]s?)?\s?(?:rent(?:al)?\s)?(?:deposit|dep)\b/i, months: true, trails: true },
  { re: /\b(?:rent(?:al)?\s)?(?:deposit|dep)\s?(?:of\s|at\s|is\s|:\s?|-\s?|=\s?|\|\s?)?(\d{1,2})\s?(?:months?|mths?)(?:['’]s?)?(?:\srent(?![\s-]?free)(?!\s?(?:review|of|at|is|:|£|\d)))?\b/i, months: true },
  { re: /\bno\s(?:rent(?:al)?\s)?deposit\b|\b(?:rent(?:al)?\s)?deposit\s?(?:is\s|:\s?|-\s?|=\s?)?(?:none|nil|waived|not\srequired)\b/i, none: true },
];
// A contribution in so many words, then the bare "fit out", which is the
// landlord's contribution only when the words beside it say so: "£1m fit out"
// and "fit out cost £800k" are what the brand will spend.
const FITOUT_WORDS: { re: RegExp; bare?: boolean }[] = [
  { re: /\b(?:cc|cap(?:ital)?\.?\s?con(?:tribution|trib)?|capex\scontribution|fit(?:ting)?[\s-]?out\scontribution|(?:landlord|ll)(?:['’]?s)?\scontribution|contribution)\b/i },
  { re: /\bfit(?:ting)?[\s-]?out(?:\s(?:costs?|works))?\b/i, bare: true },
];
const CONTRIBUTION_NEAR = /\b(?:towards?|contribution|contribut(?:e|es|ing|ed)|cc|landlord(?:['’]?s)?|ll)\b[^.;\u0001]*$/i;
// A contribution to legal costs, the marketing fund or the service charge is not a fit-out contribution.
const NOT_FITOUT_AFTER = /^\s(?:to|towards|for)\s(?:the\s|their\s)?(?:legals?|legal\s(?:costs?|fees)|costs|fees|professional|surveyors?|sdlt|stamp|marketing|promotions?|service\scharge|s\/c|sinking|insurance)/i;
// The brand's own money, or a contribution to something else: "tenant fit out £750k", "marketing contribution £5,000 pa".
const NOT_LANDLORDS_BEFORE = /(?:\b(?:tenant(?:['’]?s)?|their|own|marketing|promotions?|promotional|service\scharge|sinking\sfund|insurance|legal|charity|bid)|s\/c)\s(?:the\s)?$/i;
const PREMIUM_WORDS: { re: RegExp; bare?: boolean }[] = [{ re: /\b(?:premium|key\smoney)\b/i }];

// "rent", "base rent", "rent of", "rent c." just before a figure. Group 1 or 2
// marks a rent that is not the offer: a quoting, guide or passing rent, a
// turnover rent, a service charge.
const RENT_LEAD_BEFORE = /(?:\b(guide|quoting|quoted|asking|passing|current|existing|estimated|turnover|service|market|ground|peppercorn|previous|prior|former|old|last|historic)\s)?(?:\b(?:base|headline|initial|annual|starting|minimum|guaranteed)\s)?\brent(?:al)?(\s(?:passing|quoted|guide))?(?:\soffer(?:ed)?)?\s?(?:of\s|at\s|is\s|was\s|:\s?|-\s?|–\s?|=\s?|@\s?)?(?:(?:c\.?|circa|approx\.?|approximately|about|around|say)\s?)?$/i;
// Words before a yearly figure that make it something other than the rent offered.
const NOT_RENT_BEFORE = /(?<![a-z])(?:(?:quoting|asking|passing|current|estimated|market|guide)\srent(?:al)?|rent\spassing|service\scharge|s\/c|sc|rates|insurance|turnover|turn(?:s|ed|ing)?\sover|t\/o|sales|takings?|doing|does|did|takes|took|taking|paying|paid|pays|(?<!\b(?:will|would|to|can|could|may|might|shall|should|must)\s|['’](?:ll|d)\s)pay|deposit|premium|key\smoney|contribution|cc|erv|itza|zone\sa|quoting|quoted|asking|passing|guide|budget|capex|fit[\s-]?out|costs?|approx\.?|approximately|est\.?|estimated|o\/a|oiro|oieo|offers?\s(?:over|around|above|in\s(?:excess|the\sregion)\sof)|\d\s?[x×])\s?(?:(?:of|at|is|are|was|circa|about|around|approx\.?|approximately|est\.?|c\.?)\s?|[:=@~-]\s?)*$/i;
// Words after a yearly figure that do the same: "£20k pa service charge".
const NOT_RENT_AFTER = /^\s?(?:(?:of|in|for)\s)?(?:service\scharge|s\/c|sc(?![a-z])|(?:business\s)?rates|turnover|t\/o|sales|takings|insurance|premium|deposit|contribution|cc(?![a-z])|fit[\s-]?out|capex|budget|erv|all[\s-]in(?![a-z])|incl(?:\.|uding|usive)?\s(?:of\s)?(?:sc(?![a-z])|s\/c|service|rates|all|everything))/i;
// The same words anywhere earlier in the clause, for a plain "pa" figure: "service charge capped at £12k pa".
const NOT_RENT_IN_CLAUSE = /(?<![a-z])(?:service\scharge|s\/c|rates|insurance|turnover|turn(?:s|ed|ing)?\sover|t\/o|sales|takings?)(?![a-z])/i;
const RENT_WORD_AT = /\s(?:base\s|headline\s)?rent\b(?!\s?(?:free|review|deposit|in\sadvance|holiday|commencement|passing))/iy;
// The other half of a range ("£90-100k", "£90k to £100k").
// A slash joins the two ends too: "£120/130k pax".
const RANGE_BEFORE = /((?:£\s?)?\d[\d,.]*(?:\s?(?:k|mn?))?)(\s?(?:-|–|—|to)\s?|\/)$/i;
const RANGE_AFTER = /^(\s?(?:-|–|—|to)\s?|\/)(?:£\s?)?\d/i;
const STEPPED_RENT = /\b(?:rising|increasing|stepping(?:\sup)?|steps?\sup|going\sup)\sto\b|\bstepped\srent\b|(?:£\s?\d[\d,.]*\s?(?:k|m)?|\d[\d,.]*\s?k)\sthereafter\b/i;
const MORE_THAN_ONE_RENT = "The note gives more than one rent. Type the rent.";
const STEPPED_RENT_REASON = "The note gives a stepped rent. Type the rent.";
// A net effective rent is worked out from the headline rent and the incentives: it is not the rent offered.
const NET_EFFECTIVE_BEFORE = /\b(?:ner|net(?:\seffective)?(?:\srent)?)\s?(?:of\s|at\s|is\s|was\s|:\s?|-\s?|=\s?|@\s?)?(?:(?:c\.?|circa|approx\.?|about|around)\s?)?$/i;
// "Year 1 - £80,000", "thereafter £100k": one step of a stepped rent.
const STEP_BEFORE = /(?:\b(?:years?|yrs?|yr|y)\s?\d{1,2}(?:\s?(?:-|–|to|&|and)\s?\d{1,2})?(?:\s?\+|\sonwards)?|\bthereafter)\s?[-–:=@,]?\s?(?:rent\s)?$/i;
const STEP_AFTER = /^\s?\(?(?:in\s|for\s|from\s)?(?:years?|yrs?|yr)\s?\d/i;
// A sum with a pound sign or a k that is plainly something other than a rent:
// a fee, a bond, a spend, a threshold. Every other loose sum of rent size
// counts as a figure that could be the rent.
const LOOSE_NOT_RENT_BEFORE = /(?<![a-z])(?:fees?|bond|guarantee|works|spend(?:s|ing)?|spent|invest(?:s|ed|ing|ment)?|worth|cap(?:ped)?|threshold|over|above|below|under|exceed(?:s|ing)?|legals?|revenue|ebitda|profit|loss|value|valuation|price|penalty|refund|savings?|grant|loan|vat|rv|rateable\svalue|bill|invoice|surrender|dilaps|dilapidations|compensation|overage)\s?(?:(?:of|at|is|are|was|circa|about|around|approx\.?|c\.?)\s?|[:=@~-]\s?)*$/i;
const NOT_A_SUM_AFTER = /^\s?(?:years?|yrs?|yr|months?|mths?|mrf|rf|%|per\s?cent|pct|x)(?![a-z])/i;
const NO_RANGE_BEFORE = String.raw`(?<!\d\s?(?:-|–|to|\+)\s?)`;
const NO_RANGE_AFTER = String.raw`(?!\s?(?:-|–|to|\+)\s?\d)`;
const TERMS: RegExp[] = [
  new RegExp(String.raw`(?<!\b(?:unexpired|remaining|residual)\s)\b(?:lease\s)?term\s?(?:of\s|is\s|:\s?|-\s?|=\s?|\|\s?)?(\d{1,3}(?:\.\d)?)${NO_RANGE_AFTER}(?:\s?(?:years?|yrs?|yr|y))?\b(?!\s?(?:months?|mths?|%))`, "i"),
  new RegExp(String.raw`(?<![\d.,£])${NO_RANGE_BEFORE}(\d{1,3}(?:\.\d)?)[\s-]?(?:years?|yrs?|yr)\s(?:lease|term|letting)\b`, "i"),
  new RegExp(String.raw`\b(?:lease|letting)\s?(?:of\s|for\s|:\s?|-\s?)?(\d{1,3}(?:\.\d)?)${NO_RANGE_AFTER}[\s-]?(?:years?|yrs?|yr)\b`, "i"),
];
const BARE_YEARS = new RegExp(String.raw`(?<![\d.,£])${NO_RANGE_BEFORE}(\d{1,3}(?:\.\d)?)[\s-]?(?:years?|yrs?)\b(?!['’]?\s?(?:of\s|in\s)?(?:break|rent|review|rr|free|rf|old|ago|anniversary|upward|tenant|landlord|mutual|rolling|notice|trading|trade|business|operation|experience|(?:audited\s|management\s|trading\s)?accounts|guarantee|guarantor|warranty|(?:business\s)?plan|history|track|half|certain|stepped|discount|payback|time\b|figures|projections?|forecast))`, "i");
// "Term: 5+5 years", "5+5 lease": a term in two parts.
const TERM_IN_PARTS = /(?<![\d.,£])\d{1,2}\s?\+\s?\d{1,2}(?=\s?(?:years?|yrs?|yr|lease|term)\b)|\b(?:lease\s)?term\s?(?:of\s|is\s|:\s?|-\s?|=\s?)?\d{1,2}\s?\+\s?\d{1,2}\b/i;
const YEARS_RANGE = /(?<![\d.,£])\d{1,3}\s?(?:-|–|to)\s?\d{1,3}[\s-]?(?:years?|yrs?|yr)\b/i;
// "They've been in Covent Garden 10 years": how long they have traded, not the term.
const TRADING_HISTORY = /\b(?:been|trading|traded|operat(?:ed|ing)|established|running)\b/i;
// A follow-up or a chase may be "on" a day. An answer, a response or a decision
// "on 9 Nov" has already come: only "by", "due" and "expected" look ahead.
const FOLLOW_UP_LEAD = /(?:(?:follow(?:ing)?[\s-]?up|chas(?:e|ing)|f\/u)\s?(?:due\s|expected\s)?(?:by\s|on\s|before\s)?|(?:revert|(?:get|come)\sback(?:\sto\s(?:us|me))?)\s?(?:by\s|before\s)?|(?:decision|answer|response)\s(?:(?:is\s)?(?:due|expected)\s(?:by\s|on\s|before\s)?|by\s|before\s))(?:the\s)?$/i;
type LabelField = "brandName" | "contactName" | "agentName" | "attendees" | "nextAction";
const LABELS: { re: RegExp; field: LabelField; name: boolean }[] = [
  { re: /\b(?:brand|tenant|operator|occupier)\s?:\s?/i, field: "brandName", name: true },
  { re: /\bcontact(?:\sis\s|\s?:\s?)/i, field: "contactName", name: true },
  { re: /\bagent(?:\sis\s|\s?:\s?)/i, field: "agentName", name: true },
  { re: /\b(?:attendees\s?:\s?|(?<!\bat\s)present\s?:\s?|attended\sby\s)/i, field: "attendees", name: false },      // not "At present: no offer"
  { re: /\b(?:next\s(?:action|steps?)|next)\s?:\s?/i, field: "nextAction", name: false },
];
const LABEL_WORDS: Record<LabelField, string> = { brandName: "brand", contactName: "contact", agentName: "agent", attendees: "list of who attended", nextAction: "next action" };
// Where a labelled name ends: "James at CBRE acting for Pho" is James, and a
// person's name stops before a phone number or an email address.
const BRAND_STOP = /[.;,\u0001(]|\s[-–]\s|\s(?:at|acting|for|from|on\sbehalf|who|re|regarding)\s|\s(?=\S*@)|^(?=\S*@)/i;
const NAME_STOP = /[.;,\u0001(]|\s[-–]\s|\s(?:at|acting|for|from|on\sbehalf|who|re|regarding)\s|\s(?=\S*[\d@])|^(?=\S*[\d@])/i;
// Not a name: "tbc", "not known yet", "n/a".
const PLACEHOLDER = /^(?:tbc|tba|tbd|unknown|not|no|none|nil|n\/?a|to\sbe|awaiting|pending|[?x-]+)(?![a-z])/i;
// Not a person: "Agent: direct", "contact is their property director".
const NOT_A_PERSON_START = /^(?:direct|in-?house|their|the|via|self|unrepresented|acting|same|as\sabove|see|per|our|his|her|my|a|an|being|yet|still|now|currently|also)(?![a-z])/i;

// Words that carry no term of their own once the terms around them are read.
const FILLER = new Set(("a an the and with at of on for to is was are were be been in by from as or plus also but so then that this it its they we i " +
  "their our them us have has had offer offered offering offers lease term rent rental terms proposed proposal follows following per vat " +
  "exclusive excl incl including year years received tenant landlord unit re regarding basis stc subject contract headline base " +
  "viewing viewed booked wrote said interest interested enquiry enquired acting between made").split(" "));

// A stretch of the note with its loose ends trimmed, or "" when only filler is left.
function tidyPart(part: string): string {
  const tidy = part.replace(/[\s\u0001]+/g, " ").replace(/^[\s:;,.()–—\-+&/]+|[\s:;,(–—\-+&/]+$/g, "").replace(/\.$/, "");
  return (tidy.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || []).some(w => /\d/.test(w) || !FILLER.has(w.toLowerCase())) ? tidy : "";
}

// Short forms that end in a full stop without ending the sentence.
const ABBREVIATIONS = new Set("p.a p.a.x p.c.m p.s.f p.m a.m p.q p.w t.o c approx est excl exc incl no nos yr yrs mth mths ltd co e.g i.e etc vs st sq ft".split(" "));

// The clause a stretch of text ends in. A stop after a short form ("c.", "approx.", "p.a.") does not end it.
function clauseOf(before: string): string {
  let cut = 0;
  each(/[;!?,\u0001]|\.(?=\s|$)/, before, m => {
    if (m[0] === ".") {
      const word = (/[^\s(]+$/.exec(before.slice(0, m.index)) || [""])[0].toLowerCase().replace(/^£+/, "");
      if (ABBREVIATIONS.has(word) || /^(?:[a-z]\.)*[a-z]$/.test(word)) return;
    }
    cut = m.index + m[0].length;
  });
  return before.slice(cut);
}

// The sentences and lines of the note, each with the clauses its commas make.
function sentencesOf(text: string, from = 0): { start: number; end: number; clauses: Span[] }[] {
  const out: { start: number; end: number; clauses: Span[] }[] = [];
  let start = from, clauseStart = from, clauses: Span[] = [];
  const closeClause = (end: number) => { if (end > clauseStart) clauses.push({ start: clauseStart, end }); };
  const close = (end: number, next: number) => {
    closeClause(end);
    if (end > start) out.push({ start, end, clauses });
    start = clauseStart = next;
    clauses = [];
  };
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === ";") { close(i, i + 1); continue; }
    if (c === "," && text[i + 1] === " ") { closeClause(i); clauseStart = i + 1; continue; }
    if ((c === "-" || c === "–") && text[i - 1] === " " && text[i + 1] === " ") { closeClause(i); clauseStart = i + 1; continue; }
    if (c !== "." && c !== "!" && c !== "?") continue;
    const next = text[i + 1];
    if (next !== undefined && next !== " " && next !== "\n") continue;      // "9.30am", "£1.2m", "p.a.x."
    if (c === ".") {
      const word = (/\S+$/.exec(text.slice(Math.max(0, i - 12), i)) || [""])[0].toLowerCase().replace(/^[(£]+/, "");
      const after = text[i + 2];
      if ((ABBREVIATIONS.has(word) || /^(?:[a-z]\.)+[a-z]$/.test(word)) && after !== undefined && !/[A-Z]/.test(after)) continue;      // "p.a.x. on", "w.e.f. 1 Jan"
    }
    close(i + 1, i + 1);
  }
  close(text.length, text.length);
  return out;
}

// What no rule placed, as whole sentences: a sentence that holds words nothing
// read is kept whole. Where only one item of a comma list went unread ("rent
// £45 psf, 10 years") that item is kept on its own, whole.
function leftoverOf(text: string, claims: Claims, from = 0): string[] {
  const spans = claims.all();
  const unread = (s: Span): string => {
    let at = s.start, rest = "";
    for (const c of spans) {
      if (c.end <= at || c.start >= s.end) continue;
      rest += ` ${text.slice(at, Math.max(at, c.start))}`;
      at = Math.max(at, c.end);
    }
    return tidyPart(`${rest} ${text.slice(Math.min(at, s.end), s.end)}`);
  };
  const whole = (s: Span): string => {
    const kept = text.slice(s.start, s.end).replace(/\s+/g, " ").replace(/^[\s:;,.()–—\-+&/]+|[\s:;,(–—\-+&/]+$/g, "");
    return /\.[A-Za-z]{1,3}\.$/.test(kept) ? kept : kept.replace(/[.!]$/, "");      // "p.a.x." keeps its stop
  };
  const parts: string[] = [];
  for (const sentence of sentencesOf(text, from)) {
    if (/^\s*\(?(?:\d{1,2}|[a-z])[.)]\s*$/i.test(text.slice(sentence.start, sentence.end))) continue;      // "1.", "(2)", "a)": the number of a list item
    const open = sentence.clauses.filter(c => unread(c));
    if (!open.length) continue;
    const kept = whole(open.length === 1 ? open[0] : sentence);
    if (kept) parts.push(kept);
  }
  return parts;
}

const inRange = (n: number, max: number): boolean => Number.isFinite(n) && n >= 0 && n <= max;
const validDay = (day: string | null | undefined): string | null => (day && calendarDateValue(day) === day ? day : null);
/** The day dates in the note are placed from: the day it was written when the source records one, otherwise today. */
const refDay = (ctx: NoteContext): string => { const w = validDay(ctx.writtenOn); return w && w <= ctx.today && w >= EARLIEST_DAY ? w : ctx.today; };

// A brand the caller may already pick, named in the note.
function findBrands(text: string, scan: string, names: readonly string[], claims: Claims, stampEnd: number, kind: NoteKind): { name: string; start: number; end: number }[] {
  const found: { name: string; start: number; end: number }[] = [];
  const caseTells = /[a-z]/.test(text) && /[A-Z]/.test(text);      // a note all in one case says nothing by its capitals
  const startsSentence = (at: number): boolean => at <= stampEnd || /(?:^|[.!?:;\u0001]\s?)(?:[-•*]\s?)?$/.test(back(scan, at, 5));
  // Words after a name that show a brand is the subject: "Next have offered", "Office keen on".
  const SAYS_A_BRAND = /^(?:['’]s)?(?:\sand\s[A-Z]|\s(?:have|has|had|are|were|offered|offer|offers|offering|want|wants|wanted|viewed|viewing|viewings|called|rang|emailed|came|keen|interested|confirmed|said|say|says|need|needs|will|would|could|can|may|might|agreed|declined|passed|countered|proposed|accepted|rejected|withdrew|looking|looked|liked|loved|not|interest|enquiry|enquired|asked|asking|via|team|agents?|ltd|limited|plc|uk)\b|\s(?:on\s)?\d{1,2}(?:st|nd|rd|th)?[\s/](?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;
  const AFTER_FROM = /\b(?:from|for|behalf\sof|by|brand|tenant|operator|occupier|re)\s?:?\s$/i;
  const ENDS_HERE = /^(?:['’]s)?(?:\s?$|\s?[,;:.!?)/&+–-]|\sand\b)/i;
  const NOT_A_BRAND_AFTER = /^\s(?:weeks?|months?|years?|quarter|steps?|door|time|to|days?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thur?s?|fri|sat|sun|morning|afternoon|thing|stage|action|floor|level|up|is|was|few)\b/i;
  const PERSON_BEFORE = /\b(?:spoke\s(?:to|with)|met(?:\swith)?|called|emailed|rang|cc)\s$/i;
  // "Wagamama not interested but Pho want details": the brand that turned the unit down is not the brand showing interest or offering.
  const TURNED_DOWN_AFTER = /^(?:['’]s)?\s(?:(?:are|were|is|was|have|has|had|say|says|said)\s)?(?:(?:they\s(?:are|were)\s)?(?:not|no\slonger|n['’]t)\s(?:interested|keen|proceeding|pursuing|progressing|going|for\sthem|taking)|(?:now\s)?(?:passed|declined|pulled\sout|withdrawn|withdrew|ruled\s(?:it\s|themselves\s)?out|walked\saway|dropped\sout|out\b|uninterested|said\sno|gone\scold|went\scold)|(?:are|is)\sout\b)/i;
  // "Itsu (not Wagamama)", "neither Dishoom nor Pho".
  const NOT_THIS_BRAND_BEFORE = /(?:\b(?:not|neither|nor|except|excluding|unlike|without|rather\sthan|instead\sof|in\splace\sof)|n['’]t)\s(?:the\s)?$/i;
  const turnedDownMatters = kind === "interest" || kind === "offer";
  for (const name of [...new Set(names.map(n => n.trim()).filter(n => n.length >= 2))].sort((a, b) => b.length - a.length)) {
    const brandWords = name.split(/\s+/);
    const single = brandWords.length === 1;
    const ordinary = single ? isOrdinary(name) || FIRST_NAMES.has(wordKey(name)) : brandWords.every(isOrdinary);
    // The words of the name that carry a capital: not a leading "The", nor "and", "of" and the like.
    const marks = brandWords.map((w, i) => i).filter(i => /^[A-Z0-9]/.test(brandWords[i]) && !/^(?:the|and|of|a|an|at|in|on|de|la|le|di|&)$/i.test(brandWords[i]));
    const capitals = marks.length ? marks : [0];
    let taken = false;
    each(new RegExp(String.raw`(?<![A-Za-z0-9])${escapeRe(name).replace(/\s+/g, String.raw`\s`)}(?![A-Za-z0-9])`, "i"), scan, m => {
      const start = m.index, end = m.index + m[0].length;
      if (taken || found.some(f => start < f.end && end > f.start) || !claims.free(start, end)) return;
      const after = scan.slice(end, end + 24), before = back(scan, start, 20);
      const words = m[0].split(/\s/);
      const hasCapitals = capitals.every(i => /^[A-Z0-9]/.test(words[i] || ""));
      const opens = startsSentence(start);
      const named = AFTER_FROM.test(before) && ENDS_HERE.test(after);                                     // "offer from next"
      const inContext = (opens && SAYS_A_BRAND.test(after)) || named;
      if (single && ordinary && NOT_A_BRAND_AFTER.test(after)) return;                                    // "Next week", "Next to the unit"
      if (single && ordinary && !named && /(?<![A-Za-z])(?!The\s)[A-Z][A-Za-z'’&-]*\s$/.test(before) && !/[.!?:;\u0001]\s?$/.test(before)) return;      // "Head Office approval needed"
      if (turnedDownMatters && (TURNED_DOWN_AFTER.test(scan.slice(end, end + 48)) || NOT_THIS_BRAND_BEFORE.test(before))) return;
      if (single && /^\s[A-Z][a-z]/.test(after) && (FIRST_NAMES.has(wordKey(name)) || PERSON_BEFORE.test(before))) return;      // "Leon Smith at Wagamama"
      let ok: boolean;
      if (caseTells && hasCapitals) ok = !ordinary || !opens || (!single && capitals.some(i => i > 0)) || inContext;
      else if (caseTells) ok = !single && (!ordinary || inContext) && !/[A-Z]/.test(m[0]);                // small letters in a note that uses capitals
      else ok = !ordinary || (!single && inContext);
      if (!ok) return;
      taken = true;
      found.push({ name, start, end });
    });
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * Reads the terms an agent wrote in shorthand, with no AI. Each value comes
 * with the exact words it was read from. Anything it is not sure of is left
 * in `leftover` for a person (or the AI reader) rather than guessed.
 */
export function readShorthand(raw: string, ctx: NoteContext): ShorthandReading {
  const text = cleanNote(raw);
  const scan = text.replace(/\n/g, LINE);
  const ref = refDay(ctx);
  const allowed = new Set<LettingNoteField>(NOTE_KIND_FIELDS[ctx.kind]);
  const fields: LettingNoteFields = {};
  const quotes: Quotes = {};
  const dropped: Dropped[] = [];
  const unplaced: string[] = [];
  const claims = new Claims();
  // Where each term that was read sits in the note.
  const placed = new Map<LettingNoteField, Span>();
  // Words a rule refused. No other rule reads them, and they stay in the notes box.
  const blocked = new Claims();
  const free = (start: number, end: number): boolean => claims.free(start, end) && blocked.free(start, end);
  const has = (f: LettingNoteField) => (fields as Record<string, unknown>)[f] !== undefined;
  const put = (f: LettingNoteField, value: unknown, start: number, end: number): boolean => {
    if (!allowed.has(f) || has(f) || !free(start, end) || !claims.take(start, end)) return false;
    (fields as Record<string, unknown>)[f] = value;
    quotes[f] = text.slice(start, end).trim();
    placed.set(f, { start, end });
    return true;
  };
  const drop = (field: string, reason: string) => { if (!dropped.some(d => d.field === field)) dropped.push({ field, reason }); };
  const span = (m: RegExpExecArray): [number, number] => [m.index, m.index + m[0].length];
  // The safety net for every box: all the readings of it are gathered first.
  // One value fills the box. Two different values fill nothing, the reason is
  // given, and the words stay in the notes. The first is never simply taken.
  const settle = <T>(f: LettingNoteField, found: Found<T>[], tooMany: string, same: (a: T, b: T) => boolean = (a, b) => a === b): void => {
    if (!found.length || has(f)) return;
    if (found.some(x => !same(x.value, found[0].value))) {
      for (const x of found) blocked.take(x.start, x.end);
      drop(f, tooMany);
      return;
    }
    if (put(f, found[0].value, found[0].start, found[0].end)) for (const x of found.slice(1)) claims.take(x.start, x.end);
  };
  const turnedDown = (start: number, end = -1): boolean => TURNED_DOWN_BEFORE.test(back(scan, start, 56)) || (end >= 0 && TURNED_DOWN_AFTER_TERM.test(scan.slice(end, end + 40)));

  // 1. Who wrote it and when.
  const dates = findDates(scan);
  const stamp = readStamp(scan, dates, ctx, ref);
  if (stamp) claims.take(0, stamp.end);

  // 2. Labelled lines: "Contact: Sam Hart", "Next action: send plans". Every
  // such line is read. Two different names for one box set nothing.
  for (const label of LABELS) {
    if (!allowed.has(label.field) || has(label.field)) continue;
    const person = label.field === "contactName" || label.field === "agentName";
    const found: Found<string>[] = [];
    each(label.re, scan, m => {
      if (found.length >= 4 || !free(m.index, m.index + m[0].length) || found.some(x => m.index < x.end)) return;
      const from = m.index + m[0].length;
      const rest = scan.slice(from, from + (label.name ? 120 : LONG_TEXT_MAX));
      const stop = (label.name ? (person ? NAME_STOP : BRAND_STOP) : /\.(?=\s|\u0001|$)|[;\u0001]/).exec(rest);
      const end = from + (stop ? stop.index : rest.length);
      const value = text.slice(from, end).replace(/\s+/g, " ").trim();
      if (!value || (label.field !== "nextAction" && PLACEHOLDER.test(value))) return;
      if (label.name && (value.length > 80 || !/[A-Za-z]/.test(value) || value.split(" ").length > 6)) return;
      if (person && NOT_A_PERSON_START.test(value)) return;                          // "Agent: direct"
      if (person && /\sis\s$/i.test(m[0]) && !/^[A-Z]/.test(value)) return;          // "the agent is confident they will offer"
      found.push({ value, start: m.index, end });
    });
    if (!found.length) continue;
    const distinct = found.filter((x, i) => found.findIndex(y => sameName(y.value, x.value)) === i);
    if (label.name && distinct.length > 1) {
      for (const x of found) blocked.take(x.start, x.end);
      drop(label.field, `The note gives more than one ${LABEL_WORDS[label.field]}. Type the name.`);
      continue;
    }
    const first = found[0];
    for (const x of found) claims.take(x.start, x.end);
    const value = label.name ? first.value : distinct.map(x => x.value).join("; ");
    (fields as Record<string, unknown>)[label.field] = value.slice(0, label.name ? NAME_MAX : label.field === "nextAction" ? NEXT_ACTION_MAX : LONG_TEXT_MAX);
    quotes[label.field] = text.slice(first.start, first.end).trim();
    placed.set(label.field, { start: first.start, end: first.end });
    // "Agent: Jane Roe (Savills)", "agent is James at CBRE": the firm, where the form has a box for it.
    if (label.field === "agentName" && allowed.has("agentCompanyName") && !has("agentCompanyName")) {
      const end = first.end;
      const firm = /^\s?(?:\(([^()\u0001]{2,60})\)|(?:at|from|of)\s([A-Z][A-Za-z0-9&'’.-]*(?:\s[A-Z][A-Za-z0-9&'’.-]*){0,3}))/.exec(scan.slice(end, end + 70));
      const firmName = firm ? (firm[1] || firm[2]).trim().replace(/[.,]$/, "") : "";
      if (firm && firmName && !PLACEHOLDER.test(firmName) && claims.take(end, end + firm[0].length)) {
        fields.agentCompanyName = firmName;
        quotes.agentCompanyName = text.slice(end, end + firm[0].length).trim();
        placed.set("agentCompanyName", { start: end, end: end + firm[0].length });
      }
    }
  }

  // Rent free before deposit: in "RF 9 months deposit 6 months" the nine months are the rent free.
  if (allowed.has("rentFreeMonths")) {
    const found: Found<number>[] = [];
    const seen = new Claims();
    let refused = false;
    const refuse = (s: number, e: number, reason: string) => { refused = true; blocked.take(s, e); drop("rentFreeMonths", reason); };
    for (const r of RENT_FREE) each(r.re, scan, m => {
      const [s, e] = span(m);
      if (!free(s, e) || !seen.free(s, e)) return;
      if (r.trails && ledByTerm(scan, m.index)) return;      // "Term 10 years RF 6 months": the ten years are the term
      if (!r.nil && oneOfTwoFigures(scan, m)) return refuse(s, e, MORE_RENT_FREE);
      if (turnedDown(s, e)) return refuse(s, e, turnedDownReason(text.slice(s, e).trim(), "months"));
      const months = r.nil ? 0 : Number(m[1]) * (r.years ? 12 : 1);
      if (!inRange(months, NUMBER_MAX.rentFreeMonths)) return refuse(s, e, `"${m[0].trim()}" is not a rent free period this form can hold. Type the months.`);
      seen.take(s, e);
      found.push({ value: months, start: s, end: e });
    });
    each(RENT_FREE_IN_WEEKS, scan, m => {
      const [s, e] = span(m);
      if (free(s, e) && seen.free(s, e)) refuse(s, e, `"${text.slice(s, e).trim()}" is counted in weeks or days, not months. Type the months.`);
    });
    if (refused) for (const x of found) blocked.take(x.start, x.end);
    else settle("rentFreeMonths", found, MORE_RENT_FREE);
  }

  if (allowed.has("rentDeposit")) {
    const found: Found<string>[] = [];
    const seen = new Claims();
    let refused = false;
    for (const d of DEPOSITS) each(d.re, scan, m => {
      const [s, e] = span(m);
      if (!free(s, e) || !seen.free(s, e)) return;
      if (d.trails && ledByTerm(scan, m.index)) return;
      if (!d.none && oneOfTwoFigures(scan, m)) { refused = true; blocked.take(s, e); return drop("rentDeposit", MORE_DEPOSITS); }
      if (turnedDown(s, e)) { refused = true; blocked.take(s, e); return drop("rentDeposit", turnedDownReason(text.slice(s, e).trim(), "deposit")); }
      const n = Number(m[1]);
      seen.take(s, e);
      found.push({ value: d.none ? "No deposit" : `${n} month${n === 1 ? "" : "s"}`, start: s, end: e });
    });
    each(/\b(?:rent(?:al)?\s)?deposit\s?(?:of\s|at\s|:\s?|-\s?|=\s?)?(?=£)/i, scan, m => {
      const money = moneyAt(scan, m.index + m[0].length);
      if (!money || !(money.value > 0 && money.value <= MONEY_MAX) || !free(m.index, money.end) || !seen.take(m.index, money.end)) return;
      found.push({ value: pounds(money.value), start: m.index, end: money.end });
    });
    if (refused) for (const x of found) blocked.take(x.start, x.end);
    else settle("rentDeposit", found, MORE_DEPOSITS);
  }

  if (allowed.has("turnoverRentPct")) {
    const found: Found<number>[] = [];
    const seen = new Claims();
    let refused = false;
    const refuse = (s: number, e: number, reason: string) => { refused = true; blocked.take(s, e); drop("turnoverRentPct", reason); };
    for (const re of TURNOVER) each(re, scan, m => {
      const [s, e] = span(m);
      if (!free(s, e) || !seen.free(s, e)) return;
      if (oneOfTwoFigures(scan, m)) return refuse(s, e, MORE_TURNOVER);
      if (turnedDown(s, e)) return refuse(s, e, turnedDownReason(text.slice(s, e).trim(), "turnover percentage"));
      const pct = Number(m[1]);
      if (!inRange(pct, NUMBER_MAX.turnoverRentPct)) return refuse(s, e, `"${m[0].trim()}" is over 100%. Type the turnover percentage.`);
      seen.take(s, e);
      found.push({ value: pct, start: s, end: e });
    });
    if (refused) for (const x of found) blocked.take(x.start, x.end);
    else settle("turnoverRentPct", found, MORE_TURNOVER);
  }

  if (allowed.has("breakOption")) {
    const found: Found<string>[] = [];
    const seen = new Claims();
    let many = false, declined = "";
    const add = (value: string, s: number, e: number) => {
      if (!seen.take(s, e)) return;
      if (turnedDown(s, e) && !/^no\b/i.test(scan.slice(s, s + 3))) declined = declined || text.slice(s, e).trim();
      found.push({ value, start: s, end: e });
    };
    for (const b of BREAKS) each(b.re, scan, m => {
      const year = b.year.map(i => m[i]).find(Boolean);
      if (!year) return;
      let end = m.index + m[0].length;
      if (!free(m.index, end) || !seen.free(m.index, end)) return;
      if (b.leads) {
        // "15 yrs TBO yr 10": the break has its own year, so the fifteen years are the term.
        const own = BREAK_OWN_YEAR_AFTER.exec(scan.slice(end, end + 28));
        if (own && free(end, end + own[0].length)) return;
      }
      // "Break clause yr 5 (tenant)", "break at year 5, tenant only".
      const tail = m[b.who] ? null : /^\s?\((tenant|landlord|mutual)(?:['’]?s)?(?:[\s-](?:only|option))?\)|^,?\s(tenant|landlord|mutual)[\s-]only\b/i.exec(scan.slice(end, end + 24));
      const who = BREAK_WHO[(m[b.who] || tail?.[1] || tail?.[2] || "").toLowerCase()];
      end += tail ? tail[0].length : 0;
      // "Break at year 5 and year 10", "TBO yr 5 & 10": a second break follows.
      const second = SECOND_BREAK.exec(scan.slice(end, end + 28));
      if (second && free(end, end + second[0].length)) { many = true; end += second[0].length; }
      add(`${who ? `${who} break` : "Break"} at year ${Number(year)}`, m.index, end);
    });
    // A labelled line: "Break: tenant, year 10", "Break: 5th anniversary, tenant only".
    each(/\bbreaks?(?:\s(?:option|clause))?(?:\s?[:=|]|\s[-–](?=\s))\s?/i, scan, m => {
      const from = m.index + m[0].length;
      const line = /^[^.;\u0001]{0,80}/.exec(scan.slice(from, from + 80))![0];
      if (/^(?:none|nil|no)\b/i.test(line)) { add("No break", m.index, from + /^\w+/.exec(line)![0].length); return; }
      const years: { n: number; end: number }[] = [];
      each(/\b(?:year|yr|y)\s?(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\b(?:\s(?:year|anniversary))?/i, line, y => { years.push({ n: Number(y[1] || y[2]), end: y.index + y[0].length }); });
      if (years.length > 1) { many = true; return; }                             // two break dates: left for the person
      if (!years.length) return;
      const who = /\b(tenant|landlord|mutual|rolling)(?:['’]?s)?(?:[\s-]only)?\b|\((T|LL)\)/.exec(line) || /\b(tenant|landlord|mutual|rolling)(?:['’]?s)?(?:[\s-]only)?\b/i.exec(line);
      const end = from + Math.max(years[0].end, who ? who.index + who[0].length : 0);
      add(`${who ? `${BREAK_WHO[(who[1] || who[2]).toLowerCase()]} break` : "Break"} at year ${years[0].n}`, m.index, end);
    });
    each(NO_BREAK, scan, m => { if (free(...span(m))) add("No break", ...span(m)); });
    if (BREAKS_PLURAL.test(scan)) many = true;
    if (many || declined || new Set(found.map(x => x.value)).size > 1) {
      for (const x of found) blocked.take(x.start, x.end);
      drop("breakOption", many || !declined ? MORE_BREAKS : turnedDownReason(declined, "break"));
    } else settle("breakOption", found, MORE_BREAKS);
  }

  if (allowed.has("rentReview")) {
    const found: Found<string>[] = [];
    const seen = new Claims();
    let declined = "";
    for (const re of REVIEWS) each(re, scan, m => {
      const [s, e] = span(m);
      if (!free(s, e) || !seen.take(s, e)) return;
      if (turnedDown(s, e)) declined = declined || text.slice(s, e).trim();
      found.push({ value: upperFirst(text.slice(s, e).replace(/\s+/g, " ").trim()).slice(0, TERM_TEXT_MAX), start: s, end: e });
    });
    if (declined) { for (const x of found) blocked.take(x.start, x.end); drop("rentReview", turnedDownReason(declined, "rent review")); }
    else settle("rentReview", found, "The note gives more than one rent review. Type the rent review.", (a, b) => sameName(a, b));
  }

  // Money against a word: "£50k CC", "premium of £25,000".
  const moneyByWord = (field: "fittingOutContribution" | "premium", words: { re: RegExp; bare?: boolean }[], label: string) => {
    if (!allowed.has(field)) return;
    const found: Found<number>[] = [];
    const seen = new Claims();
    let refused = false;
    const refuse = (s: number, e: number, reason: string) => { refused = true; blocked.take(s, e); drop(field, reason); };
    for (const w of words) each(w.re, scan, m => {
      if (!free(...span(m)) || !seen.free(...span(m))) return;
      const wordEnd = m.index + m[0].length;
      const lead = back(scan, m.index, 40);
      // A reverse premium is an incentive, and a surrender premium or one the landlord pays is not paid by the tenant.
      if (field === "premium" && (/(?:reverse|surrender)\s?$/i.test(lead) || /^[^.;,\u0001]{0,24}\b(?:payable|paid)\sby\s(?:the\s)?(?:ll|landlord)\b/i.test(scan.slice(wordEnd, wordEnd + 50)))) return;
      if (field === "fittingOutContribution") {
        if (NOT_FITOUT_AFTER.test(scan.slice(wordEnd, wordEnd + 40)) || NOT_LANDLORDS_BEFORE.test(lead)) return;
        // A bare "fit out" is what the brand will spend unless the words with it say it is a contribution.
        if (w.bare && !CONTRIBUTION_NEAR.test(lead) && !/^\s(?:contribution|cc)\b/i.test(scan.slice(wordEnd, wordEnd + 16))) return;
      }
      const sep = /^\s?(?:of\s|at\s|is\s|:\s?|-\s?|–\s?|=\s?|@\s?)?/.exec(scan.slice(wordEnd, wordEnd + 6))![0].length;
      const after = moneyAt(scan, wordEnd + sep);
      const money = after && looksLikeMoney(after) ? after : moneyBefore(scan, m.index);
      if (!money || !looksLikeMoney(money) || !free(money.start, money.end) || !seen.free(money.start, money.end)) return;
      const start = Math.min(m.index, money.start), end = Math.max(wordEnd, money.end);
      if (turnedDown(start, end)) return refuse(start, end, turnedDownReason(text.slice(start, end).trim(), label));
      const not = stickyAt(NOT_YEARLY_AT, scan, money.end) || stickyAt(AREA_AT, scan, money.end);
      if (not && money.end >= wordEnd) return refuse(start, not.index + not[0].length, `"${text.slice(start, not.index + not[0].length).trim()}" is not a single sum. Type the ${label}.`);
      const yearly = money.end >= wordEnd ? stickyAt(PER_YEAR_AT, scan, money.end) : null;
      if (yearly) return refuse(start, yearly.index + yearly[0].length, `"${text.slice(start, yearly.index + yearly[0].length).trim()}" is a yearly sum, not a single ${label}. Type the ${label}.`);
      if (!(money.value > 0 && money.value <= MONEY_MAX)) return refuse(start, end, `"${text.slice(start, end).trim()}" does not look like a real ${label}. Type it.`);
      seen.take(start, end);
      found.push({ value: money.value, start, end });
    });
    if (refused) for (const x of found) blocked.take(x.start, x.end);
    else settle(field, found, `The note gives more than one ${label}. Type the ${label}.`);
  };
  moneyByWord("fittingOutContribution", FITOUT_WORDS, "fit-out contribution");
  moneyByWord("premium", PREMIUM_WORDS, "premium");

  // Rent. Every figure that could be the rent is gathered first: the ones
  // written as a rent ("£120k pax", "rent 120k") and every other loose sum of
  // rent size that nothing else explains ("Offer £150k"). One figure written
  // as a rent, with no other beside it, is the rent. Two different figures, a
  // range or a stepped rent set nothing.
  const rentFigures: number[] = [];
  if (allowed.has("rentPa")) {
    const hits: { value: number; start: number; end: number }[] = [];
    const rivals: number[] = [];
    const refusals: string[] = [];
    let range = false, outOfBounds = false, stepped = STEPPED_RENT.test(scan);
    const sized = (n: number): boolean => n >= RENT_MIN && n <= MONEY_MAX;
    // True when the figure is one end of a range. The other end must be money
    // too and not a term already read ("£120k pax - £50k CC" is a list).
    const inRangeWith = (money: Money, afterYear: number): boolean => {
      const other = (at: number, tight: boolean): boolean => {
        const m = moneyAt(scan, at);
        return !!m && free(m.start, m.end) && (m.pound || m.k || (tight && !money.pound)) && !stickyAt(NOT_YEARLY_AT, scan, m.end) && !stickyAt(AREA_AT, scan, m.end)
          && !NOT_RENT_AFTER.test(scan.slice(m.end, m.end + 24)) && !NOT_A_SUM_AFTER.test(scan.slice(m.end, m.end + 10));
      };
      const b = RANGE_BEFORE.exec(back(scan, money.start, 20));
      if (b && other(money.start - b[0].length, !/\s/.test(b[2]))) return true;
      for (const from of new Set([money.end, afterYear])) {
        const a = RANGE_AFTER.exec(scan.slice(from, from + 8));
        if (a && other(from + a[1].length, !/\s/.test(a[1]))) return true;
      }
      return false;
    };
    // "Year 1 - £80,000", "£100k pax (yr 1)": one step of a stepped rent, unless the year belongs to a break or a review already read.
    const isStep = (money: Money, end: number): boolean => {
      const lead = STEP_BEFORE.exec(back(scan, money.start, 28));
      if (lead && free(money.start - lead[0].length, money.start)) return true;
      const tail = STEP_AFTER.exec(scan.slice(end, end + 16));
      return !!tail && free(end, end + tail[0].length);
    };
    each(/£\s?\d|(?<![\d.,£A-Za-z])\d/, scan, m => {
      const money = moneyAt(scan, m.index);
      if (!money || !free(money.start, money.end)) return;
      const before = back(scan, money.start, 48);
      const clause = clauseOf(before);
      if (stickyAt(AREA_AT, scan, money.end)) return;                           // "2,400 sq ft"
      // A net effective rent is never the rent offered, but it does show the note holds two rent figures.
      if (NET_EFFECTIVE_BEFORE.test(before)) {
        if ((money.pound || money.mult) && sized(money.value) && !stickyAt(NOT_YEARLY_AT, scan, money.end)) {
          rivals.push(money.value);
          refusals.push(`"${text.slice(money.start, money.end).trim()}" is a net effective rent, not the rent offered. Type the annual rent.`);
        }
        return;
      }
      const lead = RENT_LEAD_BEFORE.exec(before);
      const led = !!lead && !lead[1] && !lead[2];
      if (!led && (lead || NOT_RENT_BEFORE.test(before))) return;               // a quoting rent, a service charge, a turnover figure
      const start = led ? money.start - (before.length - lead!.index) : money.start;
      const not = stickyAt(NOT_YEARLY_AT, scan, money.end);
      if (not) {
        if (led || money.pound) refusals.push(`"${text.slice(start, not.index + not[0].length).trim()}" is not a yearly figure (per square foot, per month or the like). Type the annual rent.`);
        return;
      }
      const year = stickyAt(PER_YEAR_AT, scan, money.end);
      const afterYear = year ? year.index + year[0].length : money.end;
      const word = money.pound || money.k ? stickyAt(RENT_WORD_AT, scan, afterYear) : null;
      const end = word ? word.index + word[0].length : afterYear;
      // Euros or dollars: not a figure this form can hold.
      if (/[$€]\s?$/.test(before) || /^\s?(?:eur|euros?|usd|dollars?|€|\$)(?![a-z])/i.test(scan.slice(money.end, money.end + 9))) {
        if (led || year || word) refusals.push(`"${text.slice(start, end).trim()}" is not in pounds. Type the annual rent.`);
        return;
      }
      const written = led
        ? looksLikeMoney(money) && !(!money.pound && !money.mult && !year && /^(?:19|20)\d\d$/.test(scan.slice(money.start, money.end)))      // "rent 2026": a year
        : (money.pound || money.mult) && !!(year || word);
      if (!written) {
        // A loose sum: not written as a rent, but of rent size and not explained by the words round it.
        if (led || !(money.pound || money.mult) || !sized(money.value)) return;
        if (NOT_A_SUM_AFTER.test(scan.slice(money.end, money.end + 10)) || NOT_RENT_AFTER.test(scan.slice(money.end, money.end + 24))) return;
        if (NOT_RENT_IN_CLAUSE.test(clause) || LOOSE_NOT_RENT_BEFORE.test(before)) return;
        if (isStep(money, money.end)) stepped = true;
        rivals.push(money.value);
        return;
      }
      if (!led && !word && !(year && RENT_ONLY_WORDS.test(year[0]))) {
        // A plain "pa" with words round it that name something else: "£20k pa service charge".
        if (NOT_RENT_AFTER.test(scan.slice(end, end + 24)) || NOT_RENT_IN_CLAUSE.test(clause)) return;
      }
      if (inRangeWith(money, afterYear)) { range = true; return; }
      const quote = text.slice(start, end).trim();
      if (money.value < RENT_MIN) { refusals.push(`"${quote}" is too small to be a year's rent. Type the annual rent.`); if (led) outOfBounds = true; return; }
      if (money.value > MONEY_MAX) { refusals.push(`"${quote}" is too large to be a year's rent. Type the annual rent.`); if (led) outOfBounds = true; return; }
      if (isStep(money, end)) stepped = true;
      // "They rejected £135k pax": not the rent, but it does show the note holds another rent figure.
      if (turnedDown(start, end)) { rivals.push(money.value); refusals.push(turnedDownReason(quote, "annual rent")); return; }
      hits.push({ value: money.value, start, end });
    });
    const written = new Set(hits.map(h => h.value));
    const all = new Set([...written, ...rivals]);
    rentFigures.push(...all);
    // "Rent £1 pa for 2 years then £80k pax": the refused £1 is still a second rent.
    if (range || written.size > 1 || (hits.length && outOfBounds)) drop("rentPa", MORE_THAN_ONE_RENT);
    else if (hits.length && stepped) drop("rentPa", STEPPED_RENT_REASON);
    else if (hits.length && all.size > 1) drop("rentPa", MORE_THAN_ONE_RENT);
    else if (hits.length) put("rentPa", hits[0].value, hits[0].start, hits[0].end);
    else if (all.size > 1) drop("rentPa", stepped ? STEPPED_RENT_REASON : "The note gives more than one figure that could be the rent. Type the rent.");
    else if (refusals.length) drop("rentPa", refusals[0]);
  }

  if (allowed.has("termYears")) {
    const MORE_TERMS = "The note gives more than one length in years. Type the term.";
    const stated: Found<number>[] = [];
    const seen = new Claims();
    let declined = "";
    for (const re of TERMS) each(re, scan, m => {
      const [s, e] = span(m);
      if (!free(s, e) || !seen.free(s, e) || !inRange(Number(m[1]), NUMBER_MAX.termYears)) return;
      if (turnedDown(s, e)) { declined = declined || text.slice(s, e).trim(); blocked.take(s, e); return; }
      seen.take(s, e);
      stated.push({ value: Number(m[1]), start: s, end: e });
    });
    const bare: Found<number>[] = [];
    each(BARE_YEARS, scan, m => {
      const [s, e] = span(m);
      if (!free(s, e) || !seen.free(s, e) || !inRange(Number(m[1]), NUMBER_MAX.termYears)) return;
      const before = back(scan, m.index, 60);
      // "Peppercorn for 2 years", "after 5 years", "first 2 years": a period within the lease, not its length.
      if (/(?:every|after|at|in|for|first|year|within|over|last|past|next|about)\s$/i.test(before) || ledByTerm(scan, m.index)) return;
      if (TRADING_HISTORY.test(/[^.;!?\u0001]*$/.exec(before)![0])) return;
      if (/^\s(?:unexpired|remaining|left|to\srun)\b/i.test(scan.slice(e, e + 12)) || /\b(?:unexpired|remaining|residual)\b[^.;,\u0001]{0,12}$/i.test(before)) return;      // what is left of an existing lease
      if (turnedDown(s, e)) { declined = declined || text.slice(s, e).trim(); return; }
      bare.push({ value: Number(m[1]), start: s, end: e });
    });
    const parts = TERM_IN_PARTS.exec(scan);
    const range = YEARS_RANGE.exec(scan);
    if (declined) drop("termYears", turnedDownReason(declined, "term"));
    else if (parts && free(...span(parts))) drop("termYears", "The note gives a term in two parts. Type the term.");
    else if (range && free(...span(range)) && !stated.length) drop("termYears", "The note gives a range of years. Type the term.");
    else if (stated.length) {
      // A length stated as the term, and another length in years beside it: neither is taken.
      if (new Set([...stated, ...bare].map(x => x.value)).size > 1) drop("termYears", MORE_TERMS);
      else settle("termYears", stated, MORE_TERMS);
    } else if (bare.length === 1) put("termYears", bare[0].value, bare[0].start, bare[0].end);
    else if (bare.length > 1) drop("termYears", MORE_TERMS);
  }

  // "£150k CC or 18 months rent free", "deposit £25k or 3 months' rent": a
  // choice between two terms. Neither is an agreed term, so neither is filled.
  // A base rent "or" a turnover percentage is one rent set two ways, and stays.
  {
    const terms = TERM_FIELDS.filter(f => placed.has(f)).map(f => ({ f, ...placed.get(f)! })).sort((a, b) => a.start - b.start);
    const refuse = new Set<LettingNoteField>();
    const pair = (a: LettingNoteField, b: LettingNoteField): boolean => (a === "rentPa" && b === "turnoverRentPct") || (a === "turnoverRentPct" && b === "rentPa");
    terms.forEach((t, i) => {
      const next = terms[i + 1];
      if (next && next.start - t.end <= 16 && /^[\s,]*(?:or|or\selse|alternatively)\s(?:a\s|an\s)?$/i.test(scan.slice(t.end, next.start)) && !pair(t.f, next.f)) { refuse.add(t.f); refuse.add(next.f); }
      // The other half of the choice is not a term the rules read: "deposit £25k or 3 months' rent".
      if (t.f !== "rentPa" && t.f !== "turnoverRentPct" && /^,?\sor\s(?:a\s|an\s)?(?:£\s?\d|\d)/i.test(scan.slice(t.end, t.end + 12)) && !(next && pair(t.f, next.f) && next.start - t.end <= 8)) refuse.add(t.f);
    });
    for (const f of refuse) {
      const at = placed.get(f)!;
      delete (fields as Record<string, unknown>)[f];
      delete quotes[f];
      // The words go back to the notes box: the claim is given up and the place is blocked instead.
      claims.release(at.start, at.end);
      blocked.take(at.start, at.end);
      drop(f, "The note gives a choice between two terms. Fill in the one that applies.");
    }
  }

  // Dates: a follow-up ("chase by 20 Nov") is not the date of the offer or viewing,
  // and nor is an opening, a completion, a lease expiry or a start. Two
  // different days set nothing.
  const whens: { hit: DateHit; placed: Placed }[] = [];
  const followUps: { day: string; start: number; end: number }[] = [];
  for (const hit of dates) {
    if (!free(hit.start, hit.end)) continue;
    const lead = FOLLOW_UP_LEAD.exec(back(scan, hit.start, 40));
    if (lead) {
      if (!allowed.has("followUpDate")) continue;
      const placed = hit.place(ref, "future");
      if (placed.day) followUps.push({ day: placed.day, start: hit.start - lead[0].length, end: hit.end });
      else if (placed.why) drop("followUpDate", NOT_PLACED_REASON(hit.quote, placed.why));
      continue;
    }
    if (!allowed.has("date") || dateIsOfSomethingElse(scan, hit, ctx.kind)) continue;
    whens.push({ hit, placed: hit.place(ref, dateModeFor(ctx.kind)) });
  }
  if (new Set(followUps.map(f => f.day)).size > 1) drop("followUpDate", "The note gives more than one follow-up date. Set it by hand.");
  else if (followUps.length && !dropped.some(d => d.field === "followUpDate") && claims.take(followUps[0].start, followUps[0].end)) {
    fields.followUpDate = followUps[0].day;
    quotes.followUpDate = text.slice(followUps[0].start, followUps[0].end).trim();
    placed.set("followUpDate", { start: followUps[0].start, end: followUps[0].end });
  }
  // A day well ahead (a lease start, a completion) cannot be the day of an offer
  // or of interest: when the note also holds a day that has come, only that one counts.
  const tomorrow = addNoteDays(ctx.today, 1);
  const come = ctx.kind === "viewing" ? [] : whens.filter(w => w.placed.day && w.placed.day <= tomorrow);
  const counted = come.length ? come : whens;
  const placedDays = [...new Set(counted.map(w => w.placed.day).filter(Boolean))];
  if (placedDays.length > 1) drop("date", "The note gives more than one date. Set the date by hand.");
  else if (placedDays.length === 1) {
    const { hit } = counted.find(w => w.placed.day)!;
    if (put("date", placedDays[0], hit.start, hit.end)) {
      // "Tuesday 17 Nov": the day of the week belongs to the date.
      const i = dates.indexOf(hit), day = i > 0 ? dates[i - 1] : null;
      if (day && hit.start - day.end <= 2 && /day$|^(?:mon|tues?|wed|thur?s?|fri|sat|sun)$/i.test(day.quote) && !/\S/.test(scan.slice(day.end, hit.start).replace(",", ""))) claims.take(day.start, hit.start);
    }
  } else {
    const unplaced = whens.find(w => w.placed.why);
    if (unplaced) drop("date", NOT_PLACED_REASON(unplaced.hit.quote, unplaced.placed.why));
  }
  const bodyDate = has("date") || placedDays.length > 1;
  if (stamp && allowed.has("date") && !bodyDate) {
    if (stamp.day) { fields.date = stamp.day; quotes.date = stamp.dateQuote; placed.set("date", { start: stamp.dateStart, end: stamp.dateStart + stamp.dateQuote.length }); }
    else if (stamp.why) drop("date", NOT_PLACED_REASON(stamp.dateQuote, stamp.why));
  }
  // "keen on the unit 12 Nov": the figure was taken as a unit number, so the date is not read. Say so rather than lose it.
  if (allowed.has("date") && !has("date") && !dropped.some(d => d.field === "date")) {
    each(new RegExp(String.raw`(?<![\d.,£/])(\d{1,2}(?:st|nd|rd|th)?)[\s-](?:of\s)?${MONTH}\b`, "i"), scan, m => {
      if (dropped.some(d => d.field === "date") || !monthOk(m[2], m[1], undefined) || dates.some(d => d.start < m.index + m[0].length && d.end > m.index)) return;
      const unit = NUMBER_NOT_DATE_BEFORE.exec(back(scan, m.index, 16));
      if (unit) drop("date", `"${`${unit[0]}${m[0]}`.trim()}" could be a unit number or a date. Set the date by hand.`);
    });
  }

  if (allowed.has("time")) {
    // "Cancelled by them at 9am", "Sam rang at 8.30": when something else happened, not when the viewing is.
    const times = findTimes(scan).filter(t => free(t.start, t.end) && !TIME_OF_SOMETHING_ELSE_BEFORE.test(back(scan, t.start, 40)));
    const doubt = times.find(t => t.doubt);
    if (doubt) drop("time", doubt.doubt!);
    else if (new Set(times.map(t => t.value)).size > 1) drop("time", MORE_THAN_ONE_TIME);
    else if (times.length) put("time", times[0].value, times[0].start, times[0].end);
  }

  // Whose position. Read for every kind so the words are not left over; only a round has the box.
  const ours = LANDLORD_SAID.exec(scan), theirs = TENANT_SAID.exec(scan);
  if (allowed.has("party")) {
    if (ours && theirs) drop("party", "The note gives both sides' positions. Choose whose position this is and check the figures.");
    // Two rents in one note are two positions, whoever's words name only one side.
    else if ((ours || theirs) && dropped.some(d => d.field === "rentPa" && /more than one/.test(d.reason))) drop("party", "The note gives more than one position. Choose whose position this is and check the figures.");
    else if (ours) put("party", "landlord", ...span(ours));
    else if (theirs) put("party", "tenant", ...span(theirs));
  }
  for (const m of [ours, theirs]) if (m) claims.take(...span(m));

  if (allowed.has("outcome")) {
    // Read from the whole note: "follow up by 20 Nov" is an outcome and a date.
    const body = stamp ? `${" ".repeat(stamp.end)}${scan.slice(stamp.end)}` : scan;
    const found = readOutcome(body);
    if (found && "reason" in found) drop("outcome", found.reason);
    else if (found && "outcome" in found) {
      fields.outcome = found.outcome;
      quotes.outcome = found.quote.trim();
      claims.take(found.start, found.start + found.quote.length);
      placed.set("outcome", { start: found.start, end: found.start + found.quote.length });
    }
  }

  if (allowed.has("brandName") && !has("brandName") && !dropped.some(d => d.field === "brandName") && ctx.brandNames?.length) {
    const found = findBrands(text, scan, ctx.brandNames, claims, stamp ? stamp.end : 0, ctx.kind);
    if (found.length === 1 || (found.length > 1 && allowed.has("moreBrands"))) {
      for (const f of found) claims.take(f.start, f.end);
      fields.brandName = found[0].name;
      quotes.brandName = text.slice(found[0].start, found[0].end);
      placed.set("brandName", { start: found[0].start, end: found[0].end });
      if (found.length > 1) { fields.moreBrands = found.slice(1).map(f => ({ name: f.name })); quotes.moreBrands = found.slice(1).map(f => text.slice(f.start, f.end)).join(", "); }
    } else if (found.length > 1) drop("brandName", "The note names more than one brand. Choose the brand.");
  }

  return {
    fields, quotes, dropped: dropped.filter(d => !has(d.field as LettingNoteField)), unplaced, saidBy: stamp?.name || null, saidByKnown: !!stamp?.known,
    leftover: leftoverOf(text, claims, stamp ? stamp.end : 0), text, claimed: claims.all(), bodyFrom: stamp ? stamp.end : 0, rentFigures,
    at: Object.fromEntries(placed) as Partial<Record<LettingNoteField, Span>>, refDay: ref,
    teamNames: [...(ctx.staffNames || []), ...(ctx.author ? [ctx.author] : []), ...(stamp?.known && stamp.name ? [stamp.name] : [])],
  };
}

// ── Checking what an AI reader proposed ────────────────────────────────────

const MONEY_FIELDS = new Set<LettingNoteField>(["rentPa", "premium", "fittingOutContribution"]);
const NUMBER_FIELDS = new Set<LettingNoteField>(["rentFreeMonths", "termYears", "turnoverRentPct"]);
const NAME_FIELDS = new Set<LettingNoteField>(["brandName", "contactName", "agentName", "agentCompanyName"]);
const TEXT_MAX: Partial<Record<LettingNoteField, number>> = {
  breakOption: TERM_TEXT_MAX, rentReview: TERM_TEXT_MAX, rentDeposit: TERM_TEXT_MAX, incentives: TERM_TEXT_MAX,
  nextAction: NEXT_ACTION_MAX, attendees: LONG_TEXT_MAX, note: LONG_TEXT_MAX,
};
// Ids are only ever added by the server, from what the caller may already pick.
const NEVER_FROM_A_READER = new Set<string>(["brandId", "agentCompanyId"]);

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, fifteen: 15, eighteen: 18, twenty: 20, "twenty-five": 25, thirty: 30 };

/** The figures in a piece of text that are written as money: with a pound sign, a k or an m. */
function figuresWrittenAsMoney(text: string): number[] {
  const out: number[] = [];
  each(/£\s?\d|(?<![\d.,£])\d/, text, m => {
    const money = moneyAt(text, m.index);
    if (money && (money.pound || money.mult)) out.push(money.value, money.plain);
  });
  return out;
}

/** Every figure a piece of text states: "£120kpax" gives 120 and 120000, "six months" gives 6. */
export function figuresIn(text: string): number[] {
  const out: number[] = [];
  each(/\d/, text, m => {
    if (m.index > 0 && /[\d.,]/.test(text[m.index - 1])) return;
    const money = moneyAt(text, m.index);
    if (money) out.push(money.value, money.plain);
  });
  each(/[a-z]+(?:-[a-z]+)?/i, text, m => { const n = NUMBER_WORDS[m[0].toLowerCase()]; if (n !== undefined) out.push(n); });
  return [...new Set(out)];
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/%$/, "").trim();
  const money = moneyAt(s, 0);
  return money && money.end === s.length ? money.value : null;
}

const NOT_IN_NOTE = "The words this was read from are not in the note.";
// The words that make a sum the sum for its box, when it has no pound sign and no k.
const SUM_WORDS: Partial<Record<LettingNoteField, RegExp>> = {
  rentPa: /\brent(?:al)?\b|p\.?a\.?x|\bp\.?a\b|per\sannum|a\syear|per\syear/i,
  premium: /\bpremium\b|key\smoney/i,
  fittingOutContribution: /\bcontribution\b|\bcc\b|cap(?:ital)?\.?\s?con|fit(?:ting)?[\s-]?out|\btowards\b/i,
};
// Words that do not say a brand is keen: an AI reader's "Interested" is not taken from them.
const LUKEWARM = /\b(?:ok(?:ay)?|alright|not\sbad|lukewarm|non-?committal|undecided|on\sthe\sfence|mixed|hesitant|cautious|unconvinced|not\sconvinced|reservations|concerns?|worried|so-so|cool(?:ish)?|cold|tepid|neutral|polite)\b/i;
const PHONE_NUMBER = /(?:\+44|\b0)\s?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/;
const TURNOVER_WORDS = /t\/o|t\.o\.|\bturnover\b|\btor\b|\bTO\b|of\s(?:gross\s|net\s)?(?:sales|takings)/;
const TRADE_MOVE_AFTER = new RegExp(String.raw`(?:%|per\s?cent|pct)\s?(?:${TRADE_MOVE})\b`, "i");
// Years that are not the length of the lease: "3 years accounts", "2 year guarantee".
const YEARS_OF_SOMETHING_ELSE = /\d\s?(?:years?|yrs?)['’]?\s?(?:of\s)?(?:audited\s|management\s|trading\s)?(?:accounts|guarantee|guarantor|warranty|business\splan|plan\b|trading|experience|history|track|figures|projections?|forecast|rent[\s-]?free|break)/i;

// Why the figure `n`, as written inside `quote`, cannot be the sum for this
// box, or null when one place it is written can. Looks at the words either
// side of the figure in the note itself, not only inside the quote.
function sumRefusal(f: LettingNoteField, n: number, quote: string, before: string, after: string): string | null {
  const around = `${before}${quote}${after}`;
  const from = before.length, to = from + quote.length;
  let reason: string | null = null, seen = false;
  const refuse = (why: string) => { reason = reason || why; };
  let fine = false;
  each(/\d/, around, m => {
    if (fine || m.index < from || m.index >= to) return;
    if (m.index > 0 && /[\d.,]/.test(around[m.index - 1])) return;
    const money = moneyAt(around, around[m.index - 1] === "£" ? m.index - 1 : m.index);
    if (!money || !(near(money.value, n) || near(money.plain, n))) return;
    seen = true;
    if (stickyAt(NOT_YEARLY_AT, around, money.end)) return refuse(`"${quote}" is not a yearly figure or a single sum (per square foot, per month or the like). Type it.`);
    if (stickyAt(AREA_AT, around, money.end)) return refuse(`"${quote}" is a floor area, not a sum of money. Type it.`);
    if (f === "rentPa") {
      const lead = RENT_LEAD_BEFORE.exec(back(around, money.start, 48));
      const led = !!lead && !lead[1] && !lead[2];
      const year = stickyAt(PER_YEAR_AT, around, money.end);
      const end = year ? year.index + year[0].length : money.end;
      const elsewhere = `"${quote}" reads as something other than the rent offered (a turnover figure, a service charge, rates or a guide). Type the annual rent.`;
      if (!led && (lead || NOT_RENT_BEFORE.test(back(around, money.start, 48)))) return refuse(elsewhere);
      if (!led && !(year && RENT_ONLY_WORDS.test(year[0])) && NOT_RENT_AFTER.test(around.slice(end, end + 24))) return refuse(elsewhere);
    }
    fine = true;
  });
  return fine || !seen ? null : reason;
}

/**
 * Checks a reading proposed by an AI. `candidate` holds one { value, quote }
 * per field, plus `unplaced` (a list of text) and `saidBy`. A value is kept
 * only when its quote is literally in the note and, for a figure, the figure
 * is in the quote; everything refused is listed in `dropped` with the reason.
 */
export function normaliseCandidate(rawNote: string, candidate: unknown, ctx: NoteContext, shorthand?: ShorthandReading): PartialReading {
  const note = cleanNote(rawNote);
  // What the rules make of the same note: an AI value is also checked against the figures and dates they found.
  const rules = shorthand && shorthand.text === note ? shorthand : readShorthand(note, ctx);
  const scan = note.replace(/\n/g, LINE);
  const noteDates = findDates(scan);
  const src: Record<string, unknown> = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : {};
  const allowed = new Set<string>(NOTE_KIND_FIELDS[ctx.kind]);
  const haystack = norm(note);
  const ref = refDay(ctx);
  const fields: LettingNoteFields = {};
  const quotes: Quotes = {};
  const dropped: Dropped[] = [];
  const unplaced: string[] = [];
  const inNote = (s: string): boolean => { const n = norm(s).replace(/(?:…|\.\.\.)$/, "").trim(); return !!n && haystack.includes(n); };
  const addUnplaced = (s: unknown) => { const t = oneLine(s, 300); if (t && inNote(t) && unplaced.length < 12 && !unplaced.some(u => sameName(u, t))) unplaced.push(t); };
  const keep = (f: LettingNoteField, value: unknown, quote: string) => { (fields as Record<string, unknown>)[f] = value; quotes[f] = quote; };
  const drop = (field: string, reason: string) => { dropped.push({ field, reason }); };
  // The words either side of a quote, as the note has them.
  const sides = (quote: string): { before: string; after: string } => {
    const q = norm(quote).replace(/(?:…|\.\.\.)$/, "").trim();
    const at = haystack.indexOf(q);
    return at < 0 ? { before: "", after: "" } : { before: back(haystack, at, 48), after: haystack.slice(at + q.length, at + q.length + 32) };
  };
  // Where a quote sits in the note. The note has no doubled white space, so a place in the lower-cased note is the same place in the note.
  const placeOf = (quote: string): Span | null => {
    const q = norm(quote).replace(/(?:…|\.\.\.)$/, "").trim();
    const at = q ? haystack.indexOf(q) : -1;
    return at < 0 ? null : { start: at, end: at + q.length };
  };
  // The quote with the note's own capitals, and a few words either side.
  const inContext = (quote: string, pad = 16): string => { const at = placeOf(quote); return at ? note.slice(Math.max(0, at.start - pad), at.end + pad) : quote; };

  for (const [key, raw] of Object.entries(src)) {
    if (key === "unplaced" || key === "saidBy" || NEVER_FROM_A_READER.has(key)) continue;
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (key === "moreBrands") continue;
    if (!item || item.value === null || item.value === undefined || item.value === "") continue;      // not stated: the form keeps what it has
    const quote = oneLine(item.quote, 400);
    if (!allowed.has(key)) { addUnplaced(quote); continue; }                                           // no box for it on this form
    const f = key as LettingNoteField;
    if (!quote || !inNote(quote)) { drop(f, NOT_IN_NOTE); continue; }

    if (MONEY_FIELDS.has(f) || NUMBER_FIELDS.has(f)) {
      const n = toNumber(item.value);
      if (n === null) { drop(f, "That is not a figure."); continue; }
      const stated = figuresIn(quote);
      // The figure itself, as written: never worked out from months or years.
      if (!stated.some(s => near(s, n))) { drop(f, `The figure ${n} is not in the words "${quote}".`); continue; }
      if (MONEY_FIELDS.has(f)) {
        const { before, after } = sides(quote);
        const refusal = sumRefusal(f, n, norm(quote), before, after);
        if (refusal) { drop(f, refusal); continue; }
        if (f === "rentPa" && n < RENT_MIN) { drop(f, `"${quote}" is too small to be a year's rent. Type the annual rent.`); continue; }
        if (!(n > 0 && n <= MONEY_MAX)) { drop(f, `"${quote}" does not look like a real sum. Type it.`); continue; }
        // A sum is written with a pound sign or a k, or beside the word for its box. A phone number is neither.
        const written = figuresWrittenAsMoney(quote).some(s => near(s, n)) || SUM_WORDS[f]!.test(quote);
        if (!written || PHONE_NUMBER.test(inContext(quote, 8))) { drop(f, `"${quote}" does not read as a sum of money for this box. Type it.`); continue; }
        // The note holds another figure that could be the rent: the reader's choice of one is not used.
        if (f === "rentPa" && rules.rentFigures.some(v => !near(v, n))) { drop(f, MORE_THAN_ONE_RENT); continue; }
      } else if (!inRange(n, NUMBER_MAX[f as keyof typeof NUMBER_MAX])) { drop(f, `${n} is outside what this box takes (0 to ${NUMBER_MAX[f as keyof typeof NUMBER_MAX]}).`); continue; }
      // "They've been in Covent Garden 10 years" is how long they have traded.
      if (f === "termYears" && TRADING_HISTORY.test(`${/[^.;!?]*$/.exec(sides(quote).before)![0]} ${quote}`)) {
        drop(f, `"${quote}" reads as how long they have traded, not the length of the lease. Type the term.`); continue;
      }
      if (f === "termYears" && YEARS_OF_SOMETHING_ELSE.test(`${quote}${sides(quote).after}`)) {
        drop(f, `"${quote}" reads as years of something else (accounts, a guarantee, a break), not the length of the lease. Type the term.`); continue;
      }
      if (f === "turnoverRentPct" && (!TURNOVER_WORDS.test(inContext(quote)) || TRADE_MOVE_AFTER.test(`${quote}${sides(quote).after}`))) {
        drop(f, `"${quote}" does not read as a turnover rent. Type the turnover percentage.`); continue;
      }
      if (f === "rentFreeMonths" && /\b(?:weeks?|wks?|days?)\b/i.test(quote) && !/\b(?:months?|mths?|years?|yrs?)\b/i.test(quote)) {
        drop(f, `"${quote}" is counted in weeks or days, not months. Type the months.`); continue;
      }
      keep(f, n, quote);
    } else if (f === "date" || f === "followUpDate") {
      // The date is worked out here from the writer's own words, not taken on trust,
      // and only where the rules too see a date at that place in the note: "3/5 Market Place" is an address.
      const at = placeOf(quote);
      const hit = at ? noteDates.find(d => d.start < at.end && d.end > at.start) : undefined;
      if (!hit && findDates(quote).length) { drop(f, `"${quote}" may not be a date (a unit number or a street number). Set the date by hand.`); continue; }
      if (hit && f === "date" && (dateIsOfSomethingElse(scan, hit, ctx.kind) || FOLLOW_UP_LEAD.test(back(scan, hit.start, 40)))) {
        drop(f, `"${quote}" reads as the date of something else (an opening, a completion, a start or a deadline). Set the date by hand.`); continue;
      }
      const placed: Placed = hit ? hit.place(ref, f === "followUpDate" ? "future" : dateModeFor(ctx.kind)) : { day: null };
      if (!placed.day) { drop(f, placed.why ? NOT_PLACED_REASON(hit!.quote, placed.why) : `The date could not be worked out from "${quote}". Set it by hand.`); continue; }
      keep(f, placed.day, quote);
    } else if (f === "time") {
      // Read with the words before it, so "Unit 3 - 10am" is not a range from three o'clock.
      const at = placeOf(quote);
      const time = at ? findTimes(scan).find(t => t.start < at.end && t.end > at.start) : findTimes(quote)[0];
      if (!time || time.doubt) { drop(f, time?.doubt || `The time could not be worked out from "${quote}". Set it by hand.`); continue; }
      keep(f, time.value, quote);
    } else if (f === "party") {
      if (item.value !== "tenant" && item.value !== "landlord") { drop(f, "Whose position it is was not clear. Choose it."); continue; }
      // The quoted words must say whose position it is, and not the other side's.
      const [mine, theirs] = item.value === "landlord" ? [LANDLORD_SAID, TENANT_SAID] : [TENANT_SAID, LANDLORD_SAID];
      if (!mine.test(quote) || theirs.test(quote)) { drop(f, `"${quote}" does not say it is the ${item.value}'s position. Choose it.`); continue; }
      keep(f, item.value, quote);
    } else if (f === "outcome") {
      const found = outcomeFromWords(oneLine(item.value, 100));
      if (!found || !NOTE_OUTCOMES.includes(found.outcome)) { drop(f, `"${oneLine(item.value, 60)}" is not one of the viewing outcomes. Choose one.`); continue; }
      // The quoted words must not say the opposite: "Not very keen" is not Interested.
      // They are read where they sit in the note, so "if interested" keeps its "if".
      const at = placeOf(quote);
      const said = at ? readOutcome(scan, at) : readOutcome(quote);
      const keenness = ["Interested", "Not Interested"];
      const opposite = said && "outcome" in said && [said.outcome, found.outcome].includes("Not Interested") && said.outcome !== found.outcome
        && keenness.includes(said.outcome) && keenness.includes(found.outcome);
      const doubtful = (said && "doubt" in said && keenness.includes(found.outcome)) || (found.outcome === "Interested" && LUKEWARM.test(quote));
      if (opposite || doubtful || (said && "reason" in said)) { drop(f, `"${quote}" does not plainly say ${found.outcome}. Choose the outcome.`); continue; }
      keep(f, found.outcome, quote);
    } else {
      const text = oneLine(item.value, NAME_FIELDS.has(f) ? NAME_MAX : TEXT_MAX[f] ?? TERM_TEXT_MAX);
      if (!text) continue;
      // A name is never tidied up or completed: it is the note's own spelling. So is the leftover text.
      if ((NAME_FIELDS.has(f) || f === "note") && !inNote(text)) { drop(f, f === "note" ? "The leftover text was reworded, so it was not used." : `"${text}" is not written in the note.`); continue; }
      if (NAME_FIELDS.has(f) && PLACEHOLDER.test(text)) continue;                                      // "tbc" is not a name
      if ((f === "contactName" || f === "agentName") && /[\d@]/.test(text)) { drop(f, `"${text}" holds a number or an email address, not only a name. Type the name.`); continue; }
      // A break, a deposit or a review must not state a figure its own words do not hold.
      if ((f === "breakOption" || f === "rentDeposit" || f === "rentReview") && figuresIn(text).some(n => !figuresIn(quote).some(q => near(q, n)))) {
        drop(f, `"${text}" gives a figure that is not in the words "${quote}". Type it.`); continue;
      }
      if (f === "breakOption" && /^no\sbreak/i.test(text) && !NO_BREAK.test(inContext(quote))) { drop(f, `"${quote}" does not plainly say there is no break. Type the break.`); continue; }
      // Free text is the note's own words: a name, a next step or an incentive the note does not hold is not listed.
      if ((f === "attendees" || f === "incentives" || f === "nextAction") && !inNote(text) && !norm(quote).includes(norm(text))) {
        drop(f, `"${text}" is not what the note says ("${quote}"). Type it.`); continue;
      }
      keep(f, text, quote);
    }
  }

  if (allowed.has("moreBrands") && Array.isArray(src.moreBrands)) {
    const more: { name: string }[] = [];
    for (const b of src.moreBrands.slice(0, 10)) {
      const name = oneLine(b && typeof b === "object" ? (b as Record<string, unknown>).name ?? (b as Record<string, unknown>).value : b, NAME_MAX);
      if (name && inNote(name) && !more.some(m => sameName(m.name, name)) && !(fields.brandName && sameName(fields.brandName, name))) more.push({ name });
    }
    if (more.length) { fields.moreBrands = more; quotes.moreBrands = more.map(m => m.name).join(", "); }
  }
  if (Array.isArray(src.unplaced)) for (const u of src.unplaced.slice(0, 12)) addUnplaced(u);

  const said = src.saidBy && typeof src.saidBy === "object" ? oneLine((src.saidBy as Record<string, unknown>).value, NAME_MAX) : oneLine(src.saidBy, NAME_MAX);
  return { fields, quotes, unplaced, dropped, saidBy: said && inNote(said) ? said : null };
}

/**
 * The shorthand reading wins where both found the same field; the AI fills
 * the rest. A box the shorthand rules refused with a reason (two rents, a
 * monthly figure, a date still to come) stays empty whatever the AI proposed.
 */
export function mergeReadings(shorthand: PartialReading, ai: PartialReading): PartialReading {
  const mine = new Set(Object.keys(shorthand.fields));
  const refused = new Set(shorthand.dropped.map(d => d.field));
  const dropped = [...shorthand.dropped];
  for (const d of ai.dropped) if (!mine.has(d.field) && !dropped.some(x => x.field === d.field)) dropped.push(d);
  const unplaced = [...shorthand.unplaced];
  for (const u of ai.unplaced) if (!unplaced.some(x => sameName(x, u))) unplaced.push(u);
  const aiFields: Record<string, unknown> = {}, aiQuotes: Quotes = {};
  for (const [key, value] of Object.entries(ai.fields)) {
    if (refused.has(key)) continue;
    aiFields[key] = value;
    const quote = ai.quotes[key as LettingNoteField];
    if (quote !== undefined) aiQuotes[key as LettingNoteField] = quote;
  }
  return {
    fields: { ...(aiFields as LettingNoteFields), ...shorthand.fields },
    quotes: { ...aiQuotes, ...shorthand.quotes },
    unplaced, dropped,
    saidBy: shorthand.saidBy || ai.saidBy,
  };
}

/** An id only on one exact match, capitals aside, within the names the caller may already pick. */
export function exactNameMatch<T extends { id: string; name: string }>(name: string | null | undefined, options: readonly T[]): T | null {
  if (!name || !norm(name)) return null;
  const hits = options.filter(o => sameName(o.name, name));
  const ids = new Set(hits.map(h => h.id));
  return ids.size === 1 ? hits[0] : null;
}

export interface BuildReadingInput extends NoteContext {
  text: string;
  /** What an AI reader proposed, when one was asked. Null or absent: the shorthand rules alone. */
  candidate?: unknown;
  usedAi?: boolean;
  /** The shorthand reading of this same text, when the caller has already made it. */
  shorthand?: ShorthandReading;
}

const WHAT_A_NAME_IS: Partial<Record<LettingNoteField, string>> = { brandName: "the brand", contactName: "the brand's contact", agentName: "the brand's agent", agentCompanyName: "the agent's firm" };

/**
 * The whole reading: shorthand first, the checked AI candidate for the rest,
 * then the rules that look across fields.
 */
export function buildReading(input: BuildReadingInput): LettingNoteReading {
  const text = cleanNote(input.text);
  const short = input.shorthand && input.shorthand.text === text ? input.shorthand : readShorthand(text, input);
  const ai = input.candidate != null ? normaliseCandidate(text, input.candidate, input, short) : null;
  const merged = ai ? mergeReadings(short, ai) : { fields: { ...short.fields }, quotes: { ...short.quotes }, unplaced: [...short.unplaced], dropped: [...short.dropped], saidBy: short.saidBy };
  const { fields, quotes, dropped } = merged;
  let saidBy = input.author || merged.saidBy || null;
  const remove = (f: LettingNoteField, reason: string) => {
    delete (fields as Record<string, unknown>)[f];
    delete quotes[f];
    if (!dropped.some(d => d.field === f)) dropped.push({ field: f, reason });
  };

  // The person who wrote the note, or one of the letting team, is not the brand's contact.
  const sure = [...(input.staffNames || []), ...(input.author ? [input.author] : []), ...(short.saidBy && short.saidByKnown ? [short.saidBy] : [])];
  for (const f of ["contactName", "agentName"] as const) {
    const name = fields[f];
    if (name && sure.some(t => sameName(t, name))) remove(f, `${name} looks like the person who wrote the note or one of the letting team, not ${WHAT_A_NAME_IS[f]}.`);
  }
  // A name that only opens the note ("Sam Hart 12 Nov ...") may be who wrote it
  // or someone at the brand. When a reading also puts that name in a box, the
  // note reads both ways: neither is set.
  if (saidBy && !sure.some(t => sameName(t, saidBy!))) {
    const opener = saidBy;
    for (const f of ["brandName", "contactName", "agentName", "agentCompanyName"] as const) {
      const name = fields[f];
      if (!name || !sameName(name, opener)) continue;
      remove(f, `${opener} opens the note, so it could be who wrote it or ${WHAT_A_NAME_IS[f]}. Type the name in the right box.`);
      saidBy = null;
    }
    // Read as who wrote it, but a brand can open a note the same way: said, so the name is not lost.
    if (saidBy && NOTE_KIND_FIELDS[input.kind].includes("brandName") && !fields.brandName && !dropped.some(d => d.field === "brandName")) {
      dropped.push({ field: "brandName", reason: `${opener} opens the note and was read as who wrote it. If it is the brand, type it in the brand box.` });
    }
  }

  const tomorrow = addNoteDays(input.today, 1);
  if (fields.date) {
    if (fields.date < EARLIEST_DAY) remove("date", "That date is too far back. Check the year.");
    else if (input.kind !== "viewing" && input.kind !== "viewing_outcome" && fields.date > tomorrow) remove("date", "That date is in the future. Set the date by hand.");
    else if (fields.date > addNoteDays(input.today, 730)) remove("date", "That date is more than two years ahead. Check the year.");
  }
  if (fields.followUpDate && (fields.followUpDate < EARLIEST_DAY || fields.followUpDate > addNoteDays(input.today, 730))) remove("followUpDate", "That follow-up date does not look right. Set it by hand.");
  // A follow-up before the day the note was written has already gone.
  else if (fields.followUpDate && fields.followUpDate < refDay(input)) remove("followUpDate", "That follow-up date has passed. Set it by hand.");
  if (fields.outcome && fields.date && fields.date > input.today) remove("outcome", "A viewing in the future cannot have an outcome yet.");
  // A comment written before the viewing it names cannot hold that viewing's outcome.
  else if (fields.outcome && fields.date && fields.date > refDay(input)) remove("outcome", "The viewing had not happened when this was written, so it has no outcome yet.");

  // What no rule or reader placed is kept for the form's notes box, as whole
  // sentences, so nothing is lost and nothing reads as a fragment.
  let leftover = short.leftover;
  if (ai) {
    // Less the words the AI reader placed, so the notes box does not repeat the boxes above it.
    const claims = new Claims(short.claimed);
    const flat = norm1(text);
    for (const [key, quote] of Object.entries(ai.quotes)) {
      if (!quote || quote.length < 2 || (fields as Record<string, unknown>)[key] === undefined || key in short.fields) continue;
      const at = flat.indexOf(norm1(quote));
      if (at >= 0) claims.takeFree(at, at + quote.length);
    }
    leftover = leftoverOf(text, claims, short.bodyFrom);
  }
  if (!fields.note) {
    const note = leftover.map((part, i) => (i === leftover.length - 1 || /[.!?]$/.test(part) ? part : `${part}.`)).join(" ").slice(0, LONG_TEXT_MAX);
    if (note && NOTE_KIND_FIELDS[input.kind].includes("note")) fields.note = note;
  }

  return { kind: input.kind, text, fields, quotes, unplaced: merged.unplaced, dropped, saidBy, usedAi: !!input.usedAi };
}

// Lower case with curly quotes and line ends made plain, one character for one, so a place found in it is the same place in the text.
function norm1(s: string): string { return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\n/g, " "); }

// ── Tight shorthand, and what a note written out in full may fill ─────────
//
// The rules above cannot understand free prose, and four rounds of review
// showed that patching them one note at a time does not converge. So the
// rules reader fills tight shorthand only. A note is tight when EVERY word in
// it is one of a short list of things the rules read for certain (a term in
// one of its usual shapes, an opening word, a known author's stamp, one date,
// one time, a brand already on the unit) or a separator. Any other word,
// however harmless it looks, makes the note not tight. Do not add patterns
// here to read free prose: a note written out in full goes to the guard below.

const TIGHT_MAX = 200;
const T_NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const T_END = String.raw`(?![A-Za-z0-9%£])`;
const T_PA = String.raw`(?:p\.?a\.?x\.?|per\s+annum|p\.?a\.?)(?![A-Za-z])(?:\s(?:exclusive|excl\.?|exc\.?)(?![A-Za-z]))?`;
const T_MONTHS = String.raw`(?:months?|mths?)['’]?`;
const T_YEARS = String.raw`(?:years?|yrs?|yr)`;
// A dash straight against a figure or a pound sign ("Rent -£100k") is a minus sign, not a separator.
const T_SEP = String.raw`\s?(?:of\s|at\s|is\s|:\s?|-(?![£\d])\s?|=\s?|@\s?)?`;
const T_SUM = String.raw`(£)?\s?${T_NUM}\s?(k|mn?)?`;
const T_WHO: Record<string, string> = { tbo: "Tenant", lbo: "Landlord", mbo: "Mutual", tenant: "Tenant", landlord: "Landlord", mutual: "Mutual", t: "Tenant", ll: "Landlord" };

type TightValue = string | number;
interface TightToken { re: RegExp; field: LettingNoteField; value: (m: RegExpExecArray) => TightValue | null }

const sumOf = (pound: string | undefined, num: string, mult: string | undefined, pa: string | undefined, needPa = false): number | null => {
  if (!pound && !mult && !(pa && !needPa)) return null;
  const n = parseFloat(num.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return n * (!mult ? 1 : mult.toLowerCase() === "k" ? 1_000 : 1_000_000);
};
const breakText = (who: string | undefined, year: string): string => `${who ? `${T_WHO[who.toLowerCase().replace(/['’]?s$/, "")] || "Tenant"} break` : "Break"} at year ${Number(year)}`;
const monthsText = (n: string): string => `${Number(n)} month${Number(n) === 1 ? "" : "s"}`;
const tok = (src: string, field: LettingNoteField, value: TightToken["value"], flags = "iy"): TightToken => ({ re: new RegExp(src, flags), field, value });

// Tried in this order at each place in the note, so "5 year rent review" is a
// review and "5 yr TBO" a break before either is taken for a term.
const TIGHT_TOKENS: TightToken[] = [
  tok(String.raw`\d{1,2}[\s-]?(?:yearly|year|yr)\s(?:upwards?[\s-]only\s)?(?:(?:rent\s)?reviews?|rr)(?:\s(?:to\s)?(?:omv|open\smarket(?:\s(?:value|rent))?))?(?:,?\s(?:upwards?[\s-]only))?${T_END}`, "rentReview", m => m[0]),
  tok(String.raw`(?:rent\sreviews?|rr)${T_SEP}(?:every\s)?(?:the\s)?(?:year\s?|yr\s?)?\d{1,2}(?:\s?(?:yearly|years?|yrs?))?${T_END}`, "rentReview", m => m[0]),
  tok(String.raw`(tbo|lbo|mbo)${T_SEP}(?:(?:year|yr|y)\s?)?(\d{1,2})(?:st|nd|rd|th)?(?:\s(?:year|anniversary))?(?![\d/.:])(?!\s?(?:months?|mths?|weeks?|wks?|days?|%))${T_END}`, "breakOption", m => breakText(m[1], m[2])),
  tok(String.raw`(?:(tenant|landlord|mutual)(?:['’]?s)?\s|(T|LL)\s)?break(?:\s(?:option|clause))?${T_SEP}(?:the\s)?(?:end\sof\s)?(?:year|yr|y)\s?(\d{1,2})${T_END}`, "breakOption", m => breakText(m[1] || m[2], m[3])),
  // "10 yr TBO 5": a 10 year term with a break at year 5, only with "yr" or "years" written before TBO and a figure after it.
  tok(String.raw`(\d{1,2})\s?${T_YEARS}(?=\s(?:tbo|lbo|mbo)\s?\d{1,2}(?![\d/.:])(?!\s?(?:months?|mths?|weeks?|wks?|days?|%))${T_END})`, "termYears", m => Number(m[1])),
  tok(String.raw`(\d{1,2})(?:st|nd|rd|th)?[\s-]?(?:year|yr)\s(?:(tbo|lbo|mbo)|(?:(tenant|landlord|mutual)(?:['’]?s)?\s)?break)${T_END}`, "breakOption", m => breakText(m[2] || m[3], m[1])),
  tok(String.raw`break\s?:\s?(tenant|landlord|mutual),?\s(?:year|yr)\s?(\d{1,2})${T_END}`, "breakOption", m => breakText(m[1], m[2])),
  tok(String.raw`(\d{1,3})\s?(?:x\s?)?mrf${T_END}`, "rentFreeMonths", m => Number(m[1])),
  tok(String.raw`(\d{1,3})\s?${T_MONTHS}\s?(?:rent[\s-]?free|r\/f|rf)${T_END}`, "rentFreeMonths", m => Number(m[1])),
  tok(String.raw`(?:rent[\s-]?free(?:\speriod)?|rf|r\/f)${T_SEP}(\d{1,3})\s?${T_MONTHS}${T_END}`, "rentFreeMonths", m => Number(m[1])),
  tok(String.raw`(\d{1,2})\s?${T_MONTHS}\s?(?:rent(?:al)?\s)?(?:deposit|dep)${T_END}`, "rentDeposit", m => monthsText(m[1])),
  tok(String.raw`(?:rent(?:al)?\s)?deposit${T_SEP}(\d{1,2})\s?${T_MONTHS}(?:\srent(?![\s-]?free))?${T_END}`, "rentDeposit", m => monthsText(m[1])),
  tok(String.raw`(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent)\s?(?:of\s)?(?:t\/o|turnover)(?:\srent)?${T_END}`, "turnoverRentPct", m => Number(m[1])),
  tok(String.raw`(\d{1,3}(?:\.\d+)?)\s?%\s?TO${T_END}`, "turnoverRentPct", m => Number(m[1]), "y"),
  tok(String.raw`(?:t\/o|turnover)(?:\srent)?${T_SEP}(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent)(?![A-Za-z0-9])`, "turnoverRentPct", m => Number(m[1])),
  tok(String.raw`(?:cc|cap(?:ital)?\.?\s?con(?:tribution|trib)?|(?:fit(?:ting)?[\s-]?out\s)?contribution)${T_SEP}${T_SUM}${T_END}`, "fittingOutContribution", m => (m[1] ? sumOf(m[1], m[2], m[3], undefined) : null)),
  tok(String.raw`${T_SUM}\s(?:cc|cap(?:ital)?\.?\s?con(?:tribution|trib)?|(?:fit(?:ting)?[\s-]?out\s)?contribution)${T_END}`, "fittingOutContribution", m => (m[1] ? sumOf(m[1], m[2], m[3], undefined) : null)),
  tok(String.raw`premium${T_SEP}${T_SUM}${T_END}`, "premium", m => (m[1] ? sumOf(m[1], m[2], m[3], undefined) : null)),
  tok(String.raw`${T_SUM}\spremium${T_END}`, "premium", m => (m[1] ? sumOf(m[1], m[2], m[3], undefined) : null)),
  tok(String.raw`rent(?:al)?${T_SEP}${T_SUM}(?:\s?(${T_PA}))?${T_END}`, "rentPa", m => sumOf(m[1], m[2], m[3], m[4])),
  tok(String.raw`${T_SUM}\s?(${T_PA})(?:\s(?:base\s|headline\s)?rent)?${T_END}`, "rentPa", m => sumOf(m[1], m[2], m[3], m[4], true)),
  tok(String.raw`(\d{1,3}(?:\.\d)?)(?:\s?|-)${T_YEARS}(?:\s(?:lease|term))?${T_END}`, "termYears", m => Number(m[1])),
  tok(String.raw`(?:lease|term)(?:\slength)?${T_SEP}(\d{1,3}(?:\.\d)?)(?:\s?|-)${T_YEARS}${T_END}`, "termYears", m => Number(m[1])),
];
const TIGHT_OPENER = new RegExp(String.raw`(?:offer(?:ed|s)?|proposed|terms|hots|rent|term|lease|rec['’]?d(?:\sfrom)?)${T_END}`, "iy");
// Opening words that belong to one kind of form only. "Counter", "revised"
// and "now" are a position only on a negotiation round: on an offer a counter
// may be the landlord's. Never "We": whose side that is goes to the round's own box.
const TIGHT_KIND_OPENER: Record<NoteKind, RegExp | null> = {
  offer: null,
  round: new RegExp(String.raw`(?:counter(?:ed)?|revised|now)${T_END}`, "iy"),
  viewing: new RegExp(String.raw`(?:viewing|viewed|booked|site\svisit)${T_END}`, "iy"),
  viewing_outcome: new RegExp(String.raw`(?:viewing|viewed)${T_END}`, "iy"),
  interest: new RegExp(String.raw`(?:enquiry|enquired|interested|from)${T_END}`, "iy"),
};
// On a viewing outcome only, a closed list of outcome phrases, read only when
// the note is that phrase with a brand and a date and nothing else.
const TIGHT_OUTCOME = new RegExp(String.raw`(keen|not\sinterested|second\sviewing|offer\sexpected|no[\s-]show)${T_END}`, "iy");
const TIGHT_OUTCOME_VALUE: Record<string, string> = { keen: "Interested", "not interested": "Not Interested", "second viewing": "Second Viewing", "offer expected": "Offer Expected", "no show": "No Show" };
// A tight rent above this is not read from shorthand: it is far more likely to be sales.
// The largest hospitality and leisure units in a shopping scheme (a cinema, a
// leisure box, a department store re-let) rarely pass about £1.5m a year; a
// higher figure in a line of shorthand is more likely sales or a capital sum.
const TIGHT_RENT_MAX = 1_500_000;
// A sum this big beside a turnover percentage may be the sales the percentage is
// of: sales of £0.5m to £1m are usual for a café or restaurant unit.
const TIGHT_SALES_SIZED = 500_000;
// A capital contribution or premium below this is probably per square foot with the psf left off.
const TIGHT_CAPITAL_MIN = 1_000;
// A deposit longer than this many months is not a usual deposit.
const TIGHT_DEPOSIT_MAX_MONTHS = 12;
// How far back a tight note's date may be before its terms may be an earlier letting's.
const TIGHT_DATE_DAYS = 365;
const TIGHT_SUM_FIELDS = new Set<LettingNoteField>(["rentPa", "premium", "fittingOutContribution"]);
// A dash straight against a figure ("-£100k") is a minus sign, not a separator.
const TIGHT_SEPARATOR = /(?:[\s\u0001.,;:!()[\]–—/&+*•'"‘’“”]+|-(?![£\d])|(?:and|with|plus|on|at|of|for|the|a)(?![A-Za-z0-9]))+/iy;
const TIGHT_TERM_FIELDS: LettingNoteField[] = TERM_FIELDS.filter(f => f !== "incentives");
const TIGHT_ALSO = new Set<LettingNoteField>(["date", "time", "brandName"]);

export type Tightness = { tight: true } | { tight: false; why: string };

// The dates in a note, with a day of the week written just before its date
// ("Tues 17 Nov") counted as one with it; `weekday` is that day (0 Sunday).
const WEEKDAY_WORD = /^(?:(?:last|next|this|on)\s)?(mon|tues?|wed|thur?s?|fri|sat|sun)[a-z]*$/i;
const WEEKDAY_NUMBER: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function oneDateEach(scan: string): (Span & { weekday?: number })[] {
  const out: (Span & { weekday?: number })[] = [];
  for (const d of findDates(scan)) {
    const last = out[out.length - 1];
    const day = last ? WEEKDAY_WORD.exec(scan.slice(last.start, last.end)) : null;
    if (last && day && d.start - last.end <= 2 && !/\S/.test(scan.slice(last.end, d.start).replace(",", ""))) { last.end = d.end; last.weekday = WEEKDAY_NUMBER[day[1].toLowerCase().slice(0, 3)]; }
    else out.push({ start: d.start, end: d.end });
  }
  return out;
}
// "Mon 13 Nov" when 13 November is a Friday: one of the two is wrong.
const weekdayClash = (dates: (Span & { weekday?: number })[], day: string | null | undefined): boolean =>
  !!day && dates.some(d => d.weekday !== undefined && d.weekday !== weekdayOf(day));
// "Viewed 20 Nov" when 20 November is still to come: one of the two is wrong.
// The same test in `tightNote` and `sureWhen`. On an outcome the rules leave a
// date still to come out, so the note's dates are placed again to see it.
const viewedButToCome = (short: ShorthandReading, kind: NoteKind): boolean => {
  const ref = short.refDay;
  if ((kind !== "viewing" && kind !== "viewing_outcome") || !ref || !/(?<![A-Za-z])viewed(?![A-Za-z])/i.test(short.text)) return false;
  if (short.fields.date && short.fields.date > ref) return true;
  return findDates(short.text.replace(/\n/g, LINE)).some(h => { const day = h.place(ref, "nearest").day; return !!day && day > ref; });
};
// A time written as a slot: "2-3pm", "10 to 11am" (also "ten to eleven"), "10am till 11am".
const TIME_SLOT = /[-–—]|\b(?:and|to|till|until)\b/i;
// "next Fri" written when a Friday falls within the next six days could mean
// this week's or the week after's. Only the same weekday as the day the note
// is read from is clear. A weekday with a date ("next Fri 20 Nov") is one span
// with its date and is not caught here.
const NEXT_WEEKDAY = /^next\s(mon|tues?|wed|thur?s?|fri|sat|sun)[a-z]*$/i;
const nextWeekdayUnclear = (scan: string, dates: Span[], ref: string | undefined): boolean => dates.some(d => {
  const m = NEXT_WEEKDAY.exec(scan.slice(d.start, d.end).trim());
  return !!m && (!ref || (WEEKDAY_NUMBER[m[1].toLowerCase().slice(0, 3)] - weekdayOf(ref) + 7) % 7 !== 0);
});
// "10/5": a day and a month with no year and no month name, which is also how a 10 year lease with a break at year 5 is written.
const BARE_DAY_MONTH = /^\d{1,2}\s?\/\s?\d{1,2}$/;

interface Cover {
  uncovered: string | null;
  found: { field: LettingNoteField; value: TightValue; start: number; end: number }[];
  brandsSeen: Set<string>;
  dateSeen: boolean;
  timeSeen: boolean;
}

// Walks a stretch of the note word by word. Every word must be a tight term,
// a date, a time, a brand on the unit, an opening word, a separator or one of
// `extra`; the first that is none of them is returned as `uncovered`.
function coverWords(scan: string, from: number, to: number, o: { kind: NoteKind; brandNames?: readonly string[]; dates: Span[]; times: Span[]; extra?: ReadonlySet<string> }): Cover {
  const brands = [...new Set((o.brandNames || []).map(b => b.trim()).filter(b => b.length >= 2))].sort((a, b) => b.length - a.length)
    .map(name => ({ name, re: new RegExp(String.raw`(?<![A-Za-z0-9])${escapeRe(name).replace(/\s+/g, String.raw`\s`)}(?![A-Za-z0-9])`, "iy") }));
  const cover: Cover = { uncovered: null, found: [], brandsSeen: new Set(), dateSeen: false, timeSeen: false };
  const text = scan.slice(0, to);
  let i = from;
  while (i < to) {
    const sep = stickyAt(TIGHT_SEPARATOR, text, i);
    if (sep && sep[0]) { i += sep[0].length; continue; }
    let next = -1;
    for (const t of TIGHT_TOKENS) {
      const m = stickyAt(t.re, text, i);
      if (!m) continue;
      const value = t.value(m);
      if (value === null) continue;
      cover.found.push({ field: t.field, value, start: i, end: i + m[0].length });
      next = i + m[0].length;
      break;
    }
    if (next < 0 && o.kind === "viewing_outcome" && !o.extra) {
      const m = stickyAt(TIGHT_OUTCOME, text, i);
      if (m) { cover.found.push({ field: "outcome", value: TIGHT_OUTCOME_VALUE[m[1].toLowerCase().replace(/[\s-]+/g, " ")], start: i, end: i + m[0].length }); next = i + m[0].length; }
    }
    if (next < 0) {
      const date = o.dates.find(d => d.start === i && d.end <= to), time = o.times.find(t => t.start === i && t.end <= to);
      if (date) { cover.dateSeen = true; next = date.end; }
      else if (time) { cover.timeSeen = true; next = time.end; }
    }
    if (next < 0) for (const b of brands) { const m = stickyAt(b.re, text, i); if (m) { cover.brandsSeen.add(norm(b.name)); next = i + m[0].length; break; } }
    if (next < 0) { const own = TIGHT_KIND_OPENER[o.kind]; const m = stickyAt(TIGHT_OPENER, text, i) || (own ? stickyAt(own, text, i) : null); if (m) next = i + m[0].length; }
    if (next < 0 && o.extra) { const w = /[A-Za-z]+(?:['’][A-Za-z]+)?/y; w.lastIndex = i; const m = w.exec(text); if (m && o.extra.has(m[0].toLowerCase())) next = i + m[0].length; }
    if (next <= i) {
      cover.uncovered = (/^\S+/.exec(text.slice(i, i + 40).replace(/\u0001/g, " ")) || [text[i]])[0];
      return cover;
    }
    i = next;
  }
  return cover;
}

// The few plain words that may follow a date for it to be the date of the
// note itself ("Viewing 20 Nov 2pm, booked", "9 Nov Pho offered £100k pax").
// Any other word ("cancelled", "withdrew", "postponed") or a question mark
// leaves the date and the time to be checked.
const PLAIN_AFTER_DATE: ReadonlySet<string> = new Set(("they have has bid bids offered offering offer revised improved increased came back to agreed subject contract stc " +
  "viewing viewed booked confirmed walk round visit inspection site enquiry enquired interest").split(" "));

/**
 * Whether a note is tight shorthand, and if not, why. A positive test: every
 * word must be one the rules read for certain or a separator, there is at
 * most one date and one time, the rules found nothing to refuse and no rival
 * for any box, they read every term exactly as the tight shapes do, and the
 * note is short. Only a tight note's rules reading fills the form.
 */
export function tightNote(short: ShorthandReading, opts: { kind: NoteKind; brandNames?: readonly string[]; unitName?: string | null; propertyName?: string | null; teamNames?: readonly string[] }): Tightness {
  const no = (why: string): Tightness => ({ tight: false, why });
  const text = short.text;
  if (!text) return no("The note is empty.");
  if (text.length > TIGHT_MAX) return no("The note is longer than a line of shorthand.");
  const scan = text.replace(/\n/g, LINE);
  const dates = oneDateEach(scan), times = findTimes(scan);
  if (dates.length > 1) return no("The note gives more than one date.");
  if (times.length > 1 || times.some(t => t.doubt)) return no("The note gives more than one time, or a time that could be read two ways.");
  if (times.some(t => TIME_SLOT.test(t.quote))) return no("The note gives a time slot. Check the time.");
  if (nextWeekdayUnclear(scan, dates, short.refDay)) return no("\"Next\" with a day of the week could mean this week or the week after. Check the date.");
  // "10/5" on an offer or a round is as likely a 10 year lease with a break at year 5 as a date.
  const bare = dates.filter(d => BARE_DAY_MONTH.test(scan.slice(d.start, d.end).trim()));
  const bareWhy = `"${bare.length ? scan.slice(bare[0].start, bare[0].end).trim() : ""}" could be a date or a lease and its break (such as 10 years with a break at year 5). Check it.`;
  if (bare.length && (opts.kind === "offer" || opts.kind === "round")) return no(bareWhy);
  if (bare.length && !short.fields.date) return no(`"${scan.slice(bare[0].start, bare[0].end).trim()}" could not be placed as a date. Check it.`);
  const cover = coverWords(scan, short.saidByKnown ? short.bodyFrom : 0, scan.length, { kind: opts.kind, brandNames: opts.brandNames, dates, times });
  if (!short.saidByKnown && short.saidBy) return no(`The note opens with ${short.saidBy}, who is not known as its author.`);
  if (cover.uncovered) return no(`"${cover.uncovered}" is not part of the shorthand the quick read covers.`);
  const { found, brandsSeen } = cover;
  const dateSeen = cover.dateSeen || (short.saidByKnown && short.bodyFrom > 0 && dates.some(d => d.start < short.bodyFrom));
  const timeSeen = cover.timeSeen;
  if (brandsSeen.size > 1) return no("The note names more than one brand.");
  // The rules must have read exactly what the tight shapes read: nothing refused, no rival, nothing else.
  const refused = short.dropped.filter(d => d.field !== "date");
  if (refused.length) return no(`The quick read left out the ${NOTE_FIELD_WORDS[refused[0].field as LettingNoteField] || refused[0].field}.`);
  if (bare.some(d => found.some(t => t.end <= d.start && !/[A-Za-z0-9£]/.test(scan.slice(t.end, d.start))))) return no(bareWhy);
  const outcomes = found.filter(t => t.field === "outcome");
  const filled = Object.keys(short.fields) as LettingNoteField[];
  const other = filled.find(f => !TIGHT_TERM_FIELDS.includes(f) && !TIGHT_ALSO.has(f) && !(f === "outcome" && outcomes.length));
  if (other) return no(`The note says more than terms (${NOTE_FIELD_WORDS[other] || other}).`);
  for (const f of TIGHT_TERM_FIELDS) {
    const mine = found.filter(t => t.field === f), rules = short.fields[f];
    if (!mine.length && rules === undefined) continue;
    const span = short.at[f];
    const agrees = (t: (typeof found)[number]): boolean => rules !== undefined && (typeof t.value === "number"
      ? typeof rules === "number" && near(t.value, rules)
      : f === "rentReview" ? !!span && span.start < t.end && span.end > t.start : norm(String(t.value)) === norm(String(rules)));
    if (!mine.length || !mine.every(agrees)) return no(`The quick read and the shorthand do not agree on the ${NOTE_FIELD_WORDS[f]}.`);
  }
  if (outcomes.length || short.fields.outcome !== undefined) {
    if (outcomes.length !== 1 || short.fields.outcome !== outcomes[0].value) return no("The quick read and the shorthand do not agree on the outcome.");
    if (found.length !== 1 || !short.fields.brandName || !short.fields.date || short.fields.time !== undefined) return no("An outcome is read from shorthand only when it stands alone with a brand and a date.");
  }
  if (short.fields.brandName && ![...brandsSeen].includes(norm(short.fields.brandName))) return no("The brand was not read from the shorthand.");
  if (short.fields.brandName && notABrandName(short.fields.brandName, { unitName: opts.unitName, propertyName: opts.propertyName, teamNames: [...(opts.teamNames || []), ...(short.teamNames || [])] })) {
    return no(`"${short.fields.brandName}" is the unit, the scheme, an agent's firm or one of the team, not the brand.`);
  }
  if (short.fields.date && !dateSeen) return no("The date was not read from the shorthand.");
  if (short.fields.time && !timeSeen) return no("The time was not read from the shorthand.");
  // On a viewing, the date in the author's stamp is the day the note was written, not the viewing's day.
  if (opts.kind === "viewing" && short.fields.date && short.at.date && short.at.date.start < short.bodyFrom) return no("The date at the head of the note is the day it was written, not the day of the viewing.");
  if (weekdayClash(dates, short.fields.date)) return no("The day of the week does not match the date. Check the date.");
  if (viewedButToCome(short, opts.kind)) return no("The note says viewed, but its date is still to come. Check the date.");
  // An old date: the terms may be an earlier letting's, or the lease that is ending.
  if (short.refDay && short.fields.date && short.fields.date < addNoteDays(short.refDay, -TIGHT_DATE_DAYS)) return no("The note's date is more than a year old, so its terms may be from an earlier letting.");
  // "£2m pa at 9% t/o" is 9% of sales of £2m, not a rent of £2m.
  const inOrder = [...found].sort((x, y) => x.start - y.start);
  for (let k = 1; k < inOrder.length; k++) {
    const x = inOrder[k - 1], y = inOrder[k];
    const pair = (x.field === "turnoverRentPct" && TIGHT_SUM_FIELDS.has(y.field)) || (y.field === "turnoverRentPct" && TIGHT_SUM_FIELDS.has(x.field));
    if (pair && /(?<![A-Za-z])(?:at|of|on)(?![A-Za-z])/i.test(scan.slice(x.end, y.start))) return no("A sum is joined to the turnover percentage, so it may be the sales the percentage is of.");
  }
  // A sales-sized sum beside a turnover percentage, whatever joins them.
  const sums = [...found.filter(t => TIGHT_SUM_FIELDS.has(t.field)).map(t => t.value), ...[...TIGHT_SUM_FIELDS].map(f => short.fields[f])];
  if ((found.some(t => t.field === "turnoverRentPct") || short.fields.turnoverRentPct !== undefined) && sums.some(v => typeof v === "number" && v >= TIGHT_SALES_SIZED)) {
    return no("A sum of £500,000 or more is beside the turnover percentage, so it may be the sales the percentage is of.");
  }
  const capital = [...found.filter(t => t.field === "premium" || t.field === "fittingOutContribution").map(t => t.value), short.fields.premium, short.fields.fittingOutContribution];
  if (capital.some(v => typeof v === "number" && v < TIGHT_CAPITAL_MIN)) return no("The capital sum is under £1,000, so it may be per square foot. Check it.");
  const deposits = [...found.filter(t => t.field === "rentDeposit").map(t => String(t.value)), ...(typeof short.fields.rentDeposit === "string" ? [short.fields.rentDeposit] : [])];
  if (deposits.some(d => figuresIn(d).some(n => n > TIGHT_DEPOSIT_MAX_MONTHS))) return no("The deposit is longer than 12 months, which is not usual. Check it.");
  const term = short.fields.termYears, pct = short.fields.turnoverRentPct, free = short.fields.rentFreeMonths;
  if (typeof term === "number" && (term <= 0 || term > 50)) return no("The term is not a usual length of lease. Check it.");
  if (typeof pct === "number" && pct > 25) return no("The turnover percentage is higher than a turnover rent usually is. Check it.");
  if (typeof free === "number" && typeof term === "number" && free >= term * 12) return no("The rent free is as long as the lease or longer. Check it.");
  const breakYears = [...found.filter(t => t.field === "breakOption").map(t => String(t.value)), ...(typeof short.fields.breakOption === "string" ? [short.fields.breakOption] : [])]
    .map(b => /\byear\s(\d+)/i.exec(b)).filter((m): m is RegExpExecArray => !!m).map(m => Number(m[1]));
  if (breakYears.some(y => y <= 0 || (typeof term === "number" && y >= term))) return no("The break is at year 0, or at or after the end of the term. Check it.");
  if (found.some(t => t.field === "rentPa" && typeof t.value === "number" && t.value > TIGHT_RENT_MAX) || (typeof short.fields.rentPa === "number" && short.fields.rentPa > TIGHT_RENT_MAX)) {
    return no("The rent is higher than a shorthand note is trusted with. Check it is not the sales.");
  }
  return { tight: true };
}

const NOTE_FIELD_WORDS: Partial<Record<LettingNoteField, string>> = {
  brandName: "brand", contactName: "contact", agentName: "agent", agentCompanyName: "agent's firm", moreBrands: "other brands", date: "date", time: "time",
  party: "whose position it is", rentPa: "rent", rentFreeMonths: "rent free", termYears: "term", breakOption: "break", premium: "premium",
  fittingOutContribution: "fit-out contribution", turnoverRentPct: "turnover rent", rentReview: "rent review", rentDeposit: "rent deposit",
  incentives: "incentives", outcome: "outcome", nextAction: "next action", followUpDate: "follow-up date", attendees: "who attended", note: "notes",
};

// The words that may stand before a date for it to be the date of the note
// itself: "9 Nov: ...", "Pho 9 Nov ...", "Viewing booked Thurs 3pm".
const SURE_LEAD = new Set("on the viewing viewed booked offer offered offers received dated date for interest enquiry enquired terms proposed counter countered revised hots".split(" "));

/**
 * In a note written out in full, the date the rules read is sure only when it
 * is the note's one date, it heads the note (a known author's stamp, or
 * nothing before it but a brand on the unit and a few plain words), and every
 * word after it is plain too (`PLAIN_AFTER_DATE`, the tight terms, a brand on
 * the unit, separators): "Viewing 20 Nov was cancelled" and "Viewing 20 Nov
 * 2pm?" leave it to be checked. The time is sure only when it is the note's
 * one time and sits right beside a sure date.
 */
export function sureWhen(short: ShorthandReading, unitBrands: readonly string[] = [], kind: NoteKind = "viewing"): { date: boolean; time: boolean } {
  const scan = short.text.replace(/\n/g, LINE);
  const dates = oneDateEach(scan);
  const at = short.at.date;
  let date = false;
  if (short.fields.date && at && dates.length === 1) {
    const whole = dates[0].start <= at.start && dates[0].end >= at.end ? dates[0] : at;      // "Thurs 19 Nov" as one
    // On a viewing the stamp's date is the day the note was written, never the viewing's day.
    if (short.saidByKnown && at.start < short.bodyFrom) date = kind !== "viewing";
    else if (whole.start >= short.bodyFrom) {
      let lead = scan.slice(short.bodyFrom, whole.start);
      if (!/[.;!?\u0001]/.test(lead)) {
        for (const b of [...unitBrands].filter(n => n.trim().length >= 2).sort((a, b) => b.length - a.length)) {
          lead = lead.replace(new RegExp(String.raw`(?<![A-Za-z0-9])${escapeRe(b.trim()).replace(/\s+/g, String.raw`\s`)}(?![A-Za-z0-9])`, "gi"), " ");
        }
        const words = lead.match(/[A-Za-z0-9'’]+/g) || [];
        date = words.length <= 4 && words.every(w => SURE_LEAD.has(w.toLowerCase()));
      }
    }
    // An old date may be an earlier letting's: it is checked, not filled.
    if (short.refDay && short.fields.date < addNoteDays(short.refDay, -TIGHT_DATE_DAYS)) date = false;
    // "Mon 13 Nov" when 13 November is a Friday; "10/5" on an offer or a round.
    if (weekdayClash(dates, short.fields.date)) date = false;
    if ((kind === "offer" || kind === "round") && BARE_DAY_MONTH.test(scan.slice(whole.start, whole.end).trim())) date = false;
    // "Viewed 20 Nov" with 20 November still to come; "next Fri" that could be this week's or the week after's.
    if (viewedButToCome(short, kind) || nextWeekdayUnclear(scan, dates, short.refDay)) date = false;
    // A positive walk over every word after the date.
    if (date) {
      const after = Math.max(whole.end, short.bodyFrom);
      date = !coverWords(scan, after, scan.length, { kind, brandNames: unitBrands, dates: [], times: findTimes(scan).filter(t => t.start >= after), extra: PLAIN_AFTER_DATE }).uncovered;
    }
  }
  let time = false;
  const t = short.at.time;
  if (date && at && t && short.fields.time) {
    const times = findTimes(scan);
    // A slot ("2-3pm", "10 to 11am") is listed with its words, never filled.
    if (times.length === 1 && !times[0].doubt && !TIME_SLOT.test(times[0].quote)) {
      const whole = dates[0].start <= at.start && dates[0].end >= at.end ? dates[0] : at;
      const gap = t.start >= whole.end ? scan.slice(whole.end, t.start) : t.end <= whole.start ? scan.slice(t.end, whole.start) : "x";
      time = /^[\s,]*(?:at\s|@\s?|from\s)?$/i.test(gap);
    }
  }
  return { date, time };
}

export interface GuardInput {
  kind: NoteKind;
  today: string;
  writtenOn?: string | null;
  /** The rules' reading of the whole note (buildReading with no candidate). */
  rules: LettingNoteReading;
  short: ShorthandReading;
  /** The provider's reading, checked against the note (normaliseCandidate). Null when there was none. */
  ai: PartialReading | null;
  /** The brands already on the unit. */
  unitBrands: readonly string[];
  unitName?: string | null;
  propertyName?: string | null;
  /** The caller, the letting team and the note's author: never the brand's contact. */
  teamNames: readonly string[];
  /** True when the provider's brand, not on the unit, is one this caller may already pick. */
  aiBrandPickable?: boolean;
}
export type UnsureValue = NonNullable<LettingNoteReading["unsure"]>[number];

// Letting agents' firms that are never a brand, beside the ones that read like a person's name (AGENT_FIRMS).
const LETTING_AGENTS: ReadonlySet<string> = new Set(["savills", "cbre", "jll", "jones lang lasalle", "colliers", "cushman & wakefield", "bnp paribas", "bnp paribas real estate",
  "lsh", "dcl", "hdh", "kf", "allsop", "strettons", "rapleys", "morgan williams", "cluttons", "fleurets", "christie & co", "bgp", "bruce gillingham pollard"]);

// A name that is the unit, the scheme, an agent's firm or one of the team, so never the brand. Used by `tightNote` and `guardReading`.
const isTeamName = (name: unknown, teamNames: readonly string[]): boolean => {
  const n = norm(String(name ?? ""));
  return !!n && teamNames.some(t => { const s = norm(t); return !!s && (s === n || s.startsWith(`${n} `) || n.startsWith(`${s} `)); });
};
function notABrandName(name: string, o: { unitName?: string | null; propertyName?: string | null; teamNames?: readonly string[] }): boolean {
  return !!(o.unitName && sameName(o.unitName, name)) || !!(o.propertyName && sameName(o.propertyName, name)) || isAgentFirm(name) || LETTING_AGENTS.has(norm(name)) || isTeamName(name, o.teamNames || []);
}

/**
 * What a note that is not tight may fill: a sure date, a sure time and a
 * brand already on the unit that the rules found alone (and the provider, if
 * it named one, named the same), and NOTHING else, with or without a provider.
 * Every other value the rules or the provider read goes to `unsure` with the
 * words it came from, for the person to check and use one at a time: the same
 * value for a box once, two different values as two lines. Agreement between
 * the two readers is not proof (review, 13 November 2026), so there is no
 * "fill when both agree". A provider value that fails a check here (a brand
 * that is the unit, the scheme, an agent's firm or one the caller cannot pick;
 * a colleague as the contact) is `dropped`, never listed.
 */
export function guardReading(g: GuardInput): { fields: LettingNoteFields; quotes: Quotes; unsure: UnsureValue[]; dropped: Dropped[] } {
  const text = g.short.text;
  const R = g.rules.fields as Record<string, unknown>, Rq = g.rules.quotes;
  const A = (g.ai?.fields || {}) as Record<string, unknown>, Aq = g.ai?.quotes || {};
  const sure = sureWhen(g.short, g.unitBrands, g.kind);
  const fields: Record<string, unknown> = {};
  const quotes: Quotes = {};
  const unsure: UnsureValue[] = [];
  const dropped: Dropped[] = [];
  const fill = (f: LettingNoteField, v: unknown, q: string | undefined) => { fields[f] = v; if (q !== undefined) quotes[f] = q; };
  const same = (f: LettingNoteField, a: unknown, b: unknown): boolean => {
    if (typeof a === "number" || typeof b === "number") return typeof a === "number" && typeof b === "number" && near(a, b);
    const x = norm(String(a ?? "")), y = norm(String(b ?? ""));
    if (x === y) return true;
    if (f !== "rentReview" && f !== "rentDeposit") return false;
    const fx = figuresIn(x).sort(), fy = figuresIn(y).sort();
    return fx.length > 0 && fx.length === fy.length && fx.every((n, i) => near(n, fy[i]));
  };
  // The words a brand's name is written with in the note, capitals and all.
  const asWritten = (name: string): string => {
    const at = norm1(text).indexOf(norm1(name).trim());
    return at >= 0 ? text.slice(at, at + name.trim().length) : name;
  };
  const push = (f: LettingNoteField, value: unknown, q: string | undefined) => {
    if (typeof value !== "string" && typeof value !== "number") return;
    if (value === "" || unsure.some(u => u.field === f && same(f, u.value, value))) return;
    unsure.push({ field: f, value, quote: String(q || "") });
  };
  const doubt = (f: LettingNoteField, v: unknown, q: string | undefined) => {
    if (f !== "moreBrands") return push(f, v, q);
    // One line for each further brand, so each can be used on its own.
    const names = Array.isArray(v) ? v.map(b => String((b as { name?: unknown })?.name || "").trim()) : String(v ?? "").split(/\s*,\s*/);
    for (const name of names) if (name) push(f, name, asWritten(name));
  };
  const isTeam = (name: unknown): boolean => isTeamName(name, g.teamNames);
  const onUnit = (name: unknown): boolean => typeof name === "string" && g.unitBrands.some(b => sameName(b, name));
  const isPlace = (name: string): boolean => !!(g.unitName && sameName(g.unitName, name)) || !!(g.propertyName && sameName(g.propertyName, name));
  const notABrand = (name: string): boolean => notABrandName(name, { unitName: g.unitName, propertyName: g.propertyName, teamNames: g.teamNames });
  // Why the provider's value cannot even be listed, or null when it may be.
  const refusedWhy = (f: LettingNoteField, a: unknown): string | null => {
    if (typeof a !== "string") return null;
    if (f === "brandName") {
      if (notABrand(a)) return `"${a}" is the unit, the scheme, an agent's firm or one of the team, not the brand.`;
      if (!onUnit(a) && !g.aiBrandPickable) return `"${a}" is not a brand on this unit or one you can pick. Type the brand.`;
    }
    if ((f === "contactName" || f === "agentName") && isTeam(a)) return `${a} looks like one of the letting team, not the brand's ${f === "contactName" ? "contact" : "agent"}.`;
    if (f === "agentCompanyName" && (isPlace(a) || isTeam(a))) return `"${a}" is the unit, the scheme or one of the team, not the agent's firm.`;
    return null;
  };

  const keys = new Set<LettingNoteField>([...Object.keys(R), ...Object.keys(A)] as LettingNoteField[]);
  for (const f of keys) {
    if (f === "note" || f === "brandId" || f === "agentCompanyId") continue;
    const r = R[f], rq = Rq[f], aq = Aq[f];
    let a = A[f];
    if (f === "moreBrands" && Array.isArray(a)) {
      const kept = a.filter(b => !notABrand(String((b as { name?: unknown })?.name || "")));
      if (kept.length < a.length) dropped.push({ field: f, reason: "A name the second reading gave as a further brand is the unit, the scheme, an agent's firm or one of the team." });
      a = kept.length ? kept : undefined;
    }
    const why = a === undefined ? null : refusedWhy(f, a);
    if (why) { dropped.push({ field: f, reason: why }); a = undefined; }
    const list = () => { if (r !== undefined) doubt(f, r, rq); if (a !== undefined) doubt(f, a, aq); };
    if (f === "date" && (g.kind === "offer" || g.kind === "round")) {
      // "10/5" on an offer or a round may be a lease and its break: never offered as a date.
      const bare = (q: string | undefined) => BARE_DAY_MONTH.test(String(q || "").trim());
      if ((r !== undefined && bare(rq)) || (a !== undefined && bare(aq))) {
        dropped.push({ field: f, reason: `"${bare(rq) ? rq : aq}" could be a date or a lease and its break (such as 10 years with a break at year 5). Set the date by hand.` });
        if (bare(aq)) a = undefined;
        if (bare(rq)) { if (a !== undefined) doubt(f, a, aq); continue; }
      }
    }
    if (f === "date" || f === "time") {
      if (sure[f] && r !== undefined && (a === undefined || same(f, a, r))) fill(f, r, rq);
      else list();
    } else if (f === "brandName") {
      // Only when the rules found this one brand on the unit: "Pho or Itsu" names two, and neither is sure.
      const rOk = onUnit(r) && !notABrand(String(r)) && R.moreBrands === undefined && !g.rules.dropped.some(d => d.field === "brandName" && /more than one brand/.test(d.reason));
      if (rOk && (A[f] === undefined || (typeof a === "string" && sameName(a, String(r))))) fill(f, r, rq);
      else list();
    } else list();
  }
  return { fields: fields as LettingNoteFields, quotes, unsure, dropped };
}
