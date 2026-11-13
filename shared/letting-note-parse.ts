// The rules behind "drop a note in, fill the form" (shared/letting-note.ts).
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

export interface PartialReading {
  fields: LettingNoteFields;
  quotes: Quotes;
  unplaced: string[];
  dropped: Dropped[];
  saidBy: string | null;
}

export interface ShorthandReading extends PartialReading {
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
const MONTH_NO: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAY_NO: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const NOT_A_DAY = String.raw`(?!\s?(?:years?|yrs?|yr|months?|mths?|m|k|mrf|rf|%)(?![a-z]))`;
// "Unit 3/4", "breaks at 5/10", "class A1/3", "1/2 rent": numbers, not a day and a month.
const NUMBER_NOT_DATE_BEFORE = /(?:\b(?:units?|nos?\.?|numbers?|shops?|suites?|kiosks?|plots?|flats?|floors?|levels?|blocks?|phases?|class|use|breaks?|tbo|lbo|mbo|years?|yrs?|yr|ratio|split|scored?|rated|options?)\s?(?:at\s|in\s|on\s|of\s|:\s?)?|#\s?)$/i;
const NUMBER_NOT_DATE_AFTER = /^\s?(?:rent|of(?![a-z])|share|split|ratio|the\s+rent|price|size|way)/i;

// How a day and month with no year is placed.
//   past     the most recent such date that is not in the future. One that
//            falls in the coming weeks is not placed: it may be still to come
//   nearest  the coming one or the last one, whichever is close by (a viewing
//            may be booked ahead). One months away either way is not placed
//   future   the next such date, today included (a follow-up)
export type DateMode = "past" | "nearest" | "future";
export const dateModeFor = (kind: NoteKind): DateMode => (kind === "viewing" ? "nearest" : "past");

// `why` says why a date was not placed: it may be still to come, or it has no year and is a long way off either way.
interface Placed { day: string | null; why?: "toCome" | "farOff" }
const TO_COME: Placed = { day: null, why: "toCome" };
const FAR_OFF: Placed = { day: null, why: "farOff" };
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
  if (mode === "future") return { day: after };
  const ahead = after ? daysBetween(ref, after) : Infinity, behind = before ? daysBetween(before, ref) : Infinity;
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
  each(new RegExp(String.raw`(?<![\d.,£/])(\d{1,2}(?:st|nd|rd|th)?)[\s-](?:of\s)?${MONTH}\b\.?(?:,?\s(\d{4})(?!\d)|\s'(\d{2})(?!\d))?`, "i"), text, m => {
    const year = m[3] || m[4];
    if (!monthOk(m[2], m[1], year)) return;
    if (!year && NUMBER_NOT_DATE_BEFORE.test(back(text, m.index, 16))) return;      // "Unit 12 Nov Street"
    const d = parseInt(m[1], 10), mo = MONTH_NO[m[2].slice(0, 3).toLowerCase()];
    add(m, (ref, mode) => (year ? { day: dayOf(fullYear(year), mo, d) } : placeDayMonth(d, mo, ref, mode)));
  });
  each(new RegExp(String.raw`\b${MONTH}\.?\s(\d{1,2}(?:st|nd|rd|th)?)(?![\d,.]*\d)${NOT_A_DAY}(?:,?\s(\d{4})(?!\d))?`, "i"), text, m => {
    if (!monthOk(m[1], m[2], m[3])) return;
    const d = parseInt(m[2], 10), mo = MONTH_NO[m[1].slice(0, 3).toLowerCase()];
    add(m, (ref, mode) => (m[3] ? { day: dayOf(Number(m[3]), mo, d) } : placeDayMonth(d, mo, ref, mode)));
  });
  // British order: day, month, year. A slash date may leave the year off.
  each(new RegExp(String.raw`(?<![\d/.£A-Za-z-])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])${NOT_A_DAY}`), text, m => {
    if (m[0] === "24/7") return;
    // A fraction or a pair of unit numbers is not a date.
    if (!m[3] && (NUMBER_NOT_DATE_BEFORE.test(back(text, m.index, 16)) || NUMBER_NOT_DATE_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 12)))) return;
    add(m, (ref, mode) => (m[3] ? { day: dayOf(fullYear(m[3]), +m[2], +m[1]) } : placeDayMonth(+m[1], +m[2], ref, mode)));
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
  for (const hit of findDates(text)) { const day = hit.place(today, mode).day; if (day) return day; }
  return null;
}

// A date that is not when the offer was made or the viewing held: an opening,
// a completion, a lease expiry, a start, a deadline.
const NOT_THIS_DATE_LEAD = /\b(?:open(?:s|ing|ed)?|launch(?:es|ing)?|completion|complet(?:e|es|ing)|exchange|expir(?:es|y|ing|ed)|ends?|ending|start(?:s|ing)?|commenc(?:e|es|ing|ement)|handover|possession|access|deadline|longstop|due|from|by|until|till|before|after|since|effective|w\/c|wc|commencing|w\.?e\.?f\.?)\s?(?:date\s?)?(?:is\s|of\s|on\s|:\s?|-\s?)?(?:the\s)?$/i;
// A viewing that was moved: the new day is not the day an outcome is about.
const MOVED_LEAD = /\b(?:postponed|moved|rebooked|rescheduled|pushed(?:\sback)?|put\sback|delayed)\s(?:to|for|until|till)\s(?:the\s)?$/i;
const OTHER_EVENT_AFTER = /^\s?(?:viewing|inspection|site\s+visit|opening|completion|start|expiry|deadline|launch)\b/i;
const NOT_PLACED_REASON = (quote: string, why: Placed["why"]) => (why === "farOff"
  ? `"${quote.replace(/\.$/, "")}" has no year and is a long way off either way. Set the date by hand.`
  : `"${quote.replace(/\.$/, "")}" looks like a date still to come. Set the date by hand.`);

function dateIsOfSomethingElse(text: string, hit: Span, kind: NoteKind): boolean {
  const before = back(text, hit.start, 32);
  if (NOT_THIS_DATE_LEAD.test(before)) return true;
  if (kind !== "viewing" && MOVED_LEAD.test(before)) return true;
  return kind !== "viewing" && kind !== "viewing_outcome" && OTHER_EVENT_AFTER.test(text.slice(hit.end, hit.end + 16));
}

interface TimeHit { start: number; end: number; quote: string; value: string }

export function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const add = (m: RegExpExecArray, value: string) => hits.push({ start: m.index, end: m.index + m[0].length, quote: m[0], value });
  // A range ("2-3pm", "between 10 and 11am"): the time it starts.
  each(/(?<![\d:.£/])(\d{1,2})(?:[:.]([0-5]\d))?\s?(?:-|–|to|and|until|till)\s?(\d{1,2})(?:[:.]([0-5]\d))?\s?(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/i, text, m => {
    const from = Number(m[1]), to = Number(m[3]);
    if (from < 1 || from > 12 || to < 1 || to > 12) return;
    const endsPm = m[5].toLowerCase().startsWith("p");
    let pm: boolean;
    if (endsPm) pm = from === 12 || (to !== 12 && from < to);
    else if (from === 12 || to === 12 || from >= to) return;      // across midnight: not guessed
    else pm = false;
    add(m, `${pad((from % 12) + (pm ? 12 : 0))}:${m[2] || "00"}`);
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
const NOT_KEEN = /\bnot\s(?:for\s(?:them|him|her)|proceeding|progressing|pursuing|going\s(?:ahead|forward)|moving\sforward|taking\sit\s(?:forward|further))\b|\bno\sinterest\b|\b(?:un|dis)interested\b|\b(?:they(?:['’]ve|\shave)?|have|has)\spassed\b(?!\s(?:it\s)?(?:on\s)?to\b)|\bpass(?:ed|ing)\son\s(?:it|this|the\sunit)\b|\bruled\s(?:it\s)?out\b|\b(?:they(?:['’]ve|\shave)?|have|has|brand|tenant|operator)\sdeclined\b|\bdeclined\s(?:it|the\s(?:unit|space|site)|to\s(?:offer|proceed|take|bid|progress))\b|\bturned\s(?:it|us|the\sunit)\sdown\b|\bpulled\sout\b|\bwalked\saway\b|\b(?:didn['’]?t|did\snot|don['’]?t|do\snot|doesn['’]?t|does\snot)\s(?:really\s)?(?:like|love|rate|want)\s(?:it|this|the\s(?:unit|space|site|shop))\b|\b(?:disliked|hated)\s(?:it|the\s(?:unit|space|site|shop))\b/i;
const LATER_OUTCOMES: [string, RegExp][] = [
  ["Offer Received", /\boffer\s(?:was\s|has\sbeen\s)?received\b|\breceived\s(?:an\s|their\s)?offer\b|\b(?:made|put\sin|submitted)\san\soffer\b|\boffer\s(?:is\s)?in\b/i],
  ["Offer Expected", /\boffer\s(?:is\s)?expected\b|\bexpect(?:ing)?\s(?:an\s|their\s)?offer\b|\boffer\sto\sfollow\b|\bwill\s(?:be\s)?(?:make|making|put(?:ting)?\sin|submit(?:ting)?)\san\soffer\b|\b(?:going|intend(?:s|ing)?)\sto\s(?:make\san\s)?offer\b/i],
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

type OutcomeRead = { outcome: string; quote: string; start: number } | { reason: string } | null;

function readOutcome(text: string): OutcomeRead {
  const hit = (outcome: string, start: number, end: number) => ({ outcome, quote: text.slice(start, end), start });
  const keen: Span[] = [], notKeen: Span[] = [], noShows: Span[] = [];
  each(NO_SHOW, text, m => { if (!(/^no/i.test(m[0]) && negatedAt(text, m.index))) noShows.push({ start: m.index, end: m.index + m[0].length }); });      // "not a no show"
  if (noShows.length) return hit("No Show", noShows[0].start, noShows[0].end);
  let oneThing = false;
  each(KEEN, text, m => {
    const end = m.index + m[0].length;
    const neg = negatedAt(text, m.index);
    if (!neg) keen.push({ start: m.index, end });
    else if (neg.twice || !neg.between.every(w => SOFTENERS.has(w))) return;       // "not sure they are interested", "wasn't not interested": says nothing either way
    else if (ABOUT_ONE_THING.test(text.slice(end, end + 28))) oneThing = true;
    else notKeen.push({ start: neg.at, end });
  });
  each(NOT_KEEN, text, m => { if (!negatedAt(text, m.index)) notKeen.push({ start: m.index, end: m.index + m[0].length }); });
  if (keen.length && (notKeen.length || oneThing)) return { reason: BOTH_WAYS_REASON };
  if (notKeen.length) { const first = notKeen.sort((a, b) => a.start - b.start)[0]; return hit("Not Interested", first.start, first.end); }
  const firstPlain = (re: RegExp): Span | null => {
    let found: Span | null = null;
    each(re, text, m => { if (!found && !negatedAt(text, m.index)) found = { start: m.index, end: m.index + m[0].length }; });
    return found;
  };
  for (const [outcome, re] of LATER_OUTCOMES) { const s = firstPlain(re); if (s) return hit(outcome, s.start, s.end); }
  if (keen.length) return hit("Interested", keen[0].start, keen[0].end);
  const follow = firstPlain(FOLLOW_UP);
  return follow ? hit("Follow Up", follow.start, follow.end) : null;
}

/**
 * The viewing outcome a phrase means, or null. "Not very keen", "no longer
 * interested" and "didn't like it" are Not Interested; a phrase that says
 * both, or neither plainly, gives null.
 */
export function outcomeFromWords(text: string): { outcome: string; quote: string; start: number } | null {
  const exact = NOTE_OUTCOMES.find(o => o.toLowerCase() === norm(text));
  if (exact) return { outcome: exact, quote: text, start: 0 };
  const read = readOutcome(text);
  return read && "outcome" in read ? read : null;
}

const LANDLORD_SAID = /\b(?:we|i)(?:\shave|['’]ve)?\s(?:countered|counter(?:[\s-]?offered)?|went\sback|gone\sback|came\sback|responded|proposed|offered|put\sforward)\b|\b(?:landlord|ll|client|our)(?:['’]s)?\s(?:counter(?:ed)?(?:[\s-]?offer)?|response|proposal|position|came\sback|offered|proposed)\b/i;
const TENANT_SAID = /\bthey(?:\shave|['’]ve)?\s(?:offered|countered|came\sback|come\sback|proposed|increased|improved|revised|upped|responded)\b|\b(?:tenant|brand|operator|occupier|their)(?:['’]s)?\s(?:offer(?:ed)?|counter(?:ed)?(?:[\s-]?offer)?|came\sback|proposal|proposed|position|revised(?:\soffer)?|response|improved(?:\soffer)?)\b/i;

// ── The author stamp ───────────────────────────────────────────────────────

// Words that start a note about a letting and are not a person's name
// ("Offer Received 9 Nov" is not written by someone called Offer Received).
const NOT_A_NAME = new Set(("offer offered offers received viewing viewed rent lease term terms tenant landlord counter countered they we the brand " +
  "interest interested meeting call email spoke met update note notes re hots heads second first new agreed follow up no show not break premium " +
  "deposit unit site visit inspection proposal revised final best bid on at from to with for and or by of in their our his her " +
  "jan january feb february mar march apr april may jun june jul july aug august sep sept september oct october nov november dec december " +
  "mon monday tue tues tuesday wed wednesday thu thur thurs thursday fri friday sat saturday sun sunday today yesterday tomorrow").split(" "));

// Agents' firms that read like a person's name ("Knight Frank 9 Nov").
const FIRM_WORDS = new Set(("knight frank savills cbre jll cushman wakefield colliers avison lambert gerald montagu shelley sandzer davis coffer lyons fleurets " +
  "christie nash bond lunson mitchenall jackson criss kenningham kingsbury brasier freeth rapleys hanover bruce gillingham pollard partners associates").split(" "));

interface Stamp { name: string; known: boolean; day: string | null; why?: Placed["why"]; dateQuote: string; end: number }

// A leading "Ben Sykes 9 Nov", as the tracker draws a target comment (who,
// short date, then the words): who wrote the note and when. Never the brand's
// contact. A name the reader knows (the caller, a colleague, the source's own
// author) is always taken. Any other name is taken only in the tracker's own
// shape, a person's name, a date, then words that start with a capital, and
// never when it is made of everyday words: "Honest Burgers 9 Nov: offered..."
// is a brand, and "Sam Hart 12 Nov offered..." may be the brand's own person.
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
      if (words.some(w => NOT_A_NAME.has(wordKey(w)) || ORDINARY.has(wordKey(w)) || FIRM_WORDS.has(wordKey(w)) || /['’]s$/i.test(w))) continue;
      if (brands.some(b => sameName(b, before))) continue;
      if (!placed.day || (end < text.length && !/[A-Z]/.test(text[end]))) continue;
    }
    return { name: knownAs ? knownAs.trim() : before, known: isKnown, day: placed.day, why: placed.why, dateQuote: date.quote, end };
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

// "6-9 months rent free", "8 to 10% t/o", "3 or 6 months deposit": two figures, so neither is taken.
// A dash with a space each side is a list ("TBO yr 5 - 6 MRF"), not a range.
function oneOfTwoFigures(text: string, m: RegExpExecArray): boolean {
  const at = (m as RegExpExecArray & { indices?: ([number, number] | undefined)[] }).indices?.[1];
  if (!at) return false;
  return /\d(?:[-–]|\s(?:to|or)\s)$/i.test(back(text, at[0], 6)) || /^(?:[-–]|\s(?:to|or)\s)\d/i.test(text.slice(at[1], at[1] + 5));
}

const RENT_FREE: { re: RegExp; years?: boolean; trails?: boolean; nil?: boolean }[] = [
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:x\s?)?m\.?r\.?f\b\.?/i, trails: true },
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?|mos?|m)(?:['’]s?)?\s?(?:of\s)?(?:rent[\s-]?free|r\/f|rf)\b/i, trails: true },
  { re: /\brent[\s-]?free(?:\speriod)?\s?(?:of\s|is\s|:\s?|-\s?|=\s?)?(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?|mos?|m)\b/i },
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?)\sfree\b/i, trails: true },
  { re: /(?<![\d.,£])(\d{1,2}(?:\.\d+)?)\s?(?:years?|yrs?|yr)(?:['’]s?)?\s?(?:of\s)?(?:rent[\s-]?free|r\/f|rf)\b(?!\s?(?:of\s|:\s?|-\s?|=\s?)?\d)/i, years: true, trails: true },
  { re: /\brent[\s-]?free(?:\speriod)?\s?(?:of\s|is\s|:\s?|-\s?|=\s?)?(\d{1,2}(?:\.\d+)?)\s?(?:years?|yrs?)\b/i, years: true },
  { re: /(?<![\d.,£])(\d{1,3})\s?rf\b/i, trails: true },
  { re: /\b(?:rf|r\/f)\s?(?:of\s|:\s?|-\s?|=\s?)?(\d{1,3})(?:\s?(?:months?|mths?|m))?\b(?!\s?(?:years?|yrs?|%|k\b))/i },
  { re: /\b(?:rent[\s-]?free(?:\speriod)?|rf|r\/f)\s?(?:is\s|:\s?|-\s?|=\s?)?(?:nil|none|zero)\b|\bno\srent[\s-]?free\b|\bnil\srent[\s-]?free\b/i, nil: true },
];
const TURNOVER: RegExp[] = [
  /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent|pct)\s?(?:of\s)?(?:gross\s)?(?:t\/o|t\.o\.?|turnover|tor\b)(?:\srent)?/i,
  /\b(?:t\/o|turnover|tor)(?:\srent)?\s?(?:of\s|at\s|:\s?|-\s?|=\s?|@\s?)?(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent|pct)/i,
  // "9% TO": TO in capitals is turnover; "to" in small letters is a word.
  /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?%\s?TO\b/,
  /\bTO\s?(?:of\s|at\s|:\s?|@\s?)?(\d{1,3}(?:\.\d+)?)\s?%/,
];
const WHO = String.raw`(tenant|landlord|mutual|rolling)(?:['’]?s)?(?:[\s-]only)?`;
const BREAKS: { re: RegExp; who: number; year: number[] }[] = [
  // "T break yr 5", "LL break at year 3": T and LL in capitals.
  { re: /\b(T|LL)\sbreak(?:\s(?:option|clause))?\s?(?:at\s|in\s|@\s?|on\s|after\s)?(?:the\s)?(?:end\sof\s)?(?:(?:year|yr|y)\s?(\d{1,2})\b|(\d{1,2})(?:st|nd|rd|th)\b(?:\s(?:year|anniversary))?)(?!\s?\/)/, who: 1, year: [2, 3] },
  { re: /(?<![\d.,£])(\d{1,2})(?:st|nd|rd|th)?[\s-]?(?:years?|yrs?|yr)\s(tbo|lbo|mbo)\b/i, who: 2, year: [1] },
  { re: /\b(tbo|lbo|mbo)\s?(?:at\s|in\s|@\s?|on\s)?(?:the\s)?(?:end\sof\s)?(?:year|yr|y)?\s?(\d{1,2})(?:st|nd|rd|th)?(?:\s(?:year|anniversary))?\b(?!\s?\/)/i, who: 1, year: [2] },
  { re: new RegExp(String.raw`\b(?:${WHO}\s)?break(?:\s(?:option|clause))?\s?(?:at\s|in\s|@\s?|on\s|after\s)?(?:the\s)?(?:end\sof\s)?(?:(?:year|yr|y)\s?(\d{1,2})\b|(\d{1,2})(?:st|nd|rd|th)\b(?:\s(?:year|anniversary))?)(?!\s?\/)`, "i"), who: 1, year: [2, 3] },
  { re: new RegExp(String.raw`\b(?:${WHO}\s)?break(?:\s(?:option|clause))?\s(?:at|in|on|after)\s(?:the\s)?(?:end\sof\s)?(\d{1,2})\b(?:\s?(?:years?|yrs?))?(?!\s?(?:months?|mths?|%|\/|[.:]\d|am\b|pm\b))`, "i"), who: 1, year: [2] },
  { re: new RegExp(String.raw`(?<![\d.,£])(\d{1,2})(?:st|nd|rd|th)?[\s-]?(?:year|yr)\s(?:${WHO}\s)?break\b(?:\s(?:option|clause))?`, "i"), who: 2, year: [1] },
];
const BREAK_WHO: Record<string, string> = { tbo: "Tenant", lbo: "Landlord", mbo: "Mutual", tenant: "Tenant", landlord: "Landlord", mutual: "Mutual", rolling: "Rolling", t: "Tenant", ll: "Landlord" };
const REVIEW_BASIS = String.raw`(?:\s?(?:,\s?)?(?:(?:to|linked\sto|at|-)\s?)?(?:omv|omr|open\smarket(?:\s(?:value|rent))?|rpi|cpi|index(?:ed|ation)?|fixed(?:\suplifts?)?)(?![a-z])(?:\s(?:cap(?:ped)?|collar(?:ed)?)[^.;,\u0001]{0,60})?)`;
const UPWARDS = String.raw`(?:,?\s(?:and\s)?upwards?[\s-]only)`;
const REVIEWS: RegExp[] = [
  new RegExp(String.raw`(?<![\d.,£])\d{1,2}[\s-]?(?:yearly|year|yr)\s(?:upwards?[\s-]only\s)?(?:rent\s)?reviews?\b${REVIEW_BASIS}?${UPWARDS}?`, "i"),
  new RegExp(String.raw`\b(?:upwards?[\s-]only\s)?(?:rent\sreviews?|rr)\b(?:\s?(?::\s?|-\s?|at\s|in\s|every\s|@\s?|on\s)?(?:the\s)?(?:end\sof\s)?(?:year\s?|yr\s?)?\d{1,2}(?:st|nd|rd|th)?(?:\s?(?:yearly|years?|yrs?|anniversary))?${REVIEW_BASIS}?|${REVIEW_BASIS})${UPWARDS}?`, "i"),
];
const DEPOSITS: { re: RegExp; months?: boolean; none?: boolean; trails?: boolean }[] = [
  { re: /(?<![\d.,£])(\d{1,2})\s?(?:months?|mths?|m)(?:['’]s?)?\s?(?:rent(?:al)?\s)?(?:deposit|dep)\b/i, months: true, trails: true },
  { re: /\b(?:rent(?:al)?\s)?(?:deposit|dep)\s?(?:of\s|at\s|is\s|:\s?|-\s?|=\s?)?(\d{1,2})\s?(?:months?|mths?)(?:['’]s?)?(?:\srent(?![\s-]?free)(?!\s?(?:review|of|at|is|:|£|\d)))?\b/i, months: true },
  { re: /\bno\s(?:rent(?:al)?\s)?deposit\b|\b(?:rent(?:al)?\s)?deposit\s?(?:is\s|:\s?|-\s?|=\s?)?(?:none|nil|waived|not\srequired)\b/i, none: true },
];
const FITOUT_WORD = /\b(?:cc|cap(?:ital)?\.?\s?con(?:tribution|trib)?|capex\scontribution|fit(?:ting)?[\s-]?out(?:\s(?:contribution|costs?|works))?|(?:landlord|ll)(?:['’]?s)?\scontribution|contribution)\b/i;
// A contribution to legal costs is not a fit-out contribution.
const NOT_FITOUT_AFTER = /^\s(?:to|towards|for)\s(?:the\s|their\s)?(?:legals?|legal\s(?:costs?|fees)|costs|fees|professional|surveyors?|sdlt|stamp)/i;
const PREMIUM_WORD = /\b(?:premium|key\smoney)\b/i;

// "rent", "base rent", "rent of", "rent c." just before a figure. Group 1 or 2
// marks a rent that is not the offer: a quoting, guide or passing rent, a
// turnover rent, a service charge.
const RENT_LEAD_BEFORE = /(?:\b(guide|quoting|quoted|asking|passing|current|existing|estimated|turnover|service|market|ground|peppercorn)\s)?(?:\b(?:base|headline|initial|annual|starting|minimum|guaranteed)\s)?\brent(?:al)?(\s(?:passing|quoted|guide))?(?:\soffer(?:ed)?)?\s?(?:of\s|at\s|is\s|was\s|:\s?|-\s?|–\s?|=\s?|@\s?)?(?:(?:c\.?|circa|approx\.?|approximately|about|around|say)\s?)?$/i;
// Words before a yearly figure that make it something other than the rent offered.
const NOT_RENT_BEFORE = /(?<![a-z])(?:(?:quoting|asking|passing|current|estimated|market|guide)\srent(?:al)?|rent\spassing|service\scharge|s\/c|sc|rates|insurance|turnover|turn(?:s|ed|ing)?\sover|t\/o|sales|takings?|doing|deposit|premium|key\smoney|contribution|cc|erv|itza|zone\sa|quoting|asking|passing|guide|budget|capex|fit[\s-]?out|costs?|approx\.?|approximately|est\.?|estimated|o\/a|oiro|oieo|offers?\s(?:over|around|above|in\s(?:excess|the\sregion)\sof)|\d\s?[x×])\s?(?:(?:of|at|is|are|was|circa|about|around|approx\.?|approximately|est\.?|c\.?)\s?|[:=@~-]\s?)*$/i;
// Words after a yearly figure that do the same: "£20k pa service charge".
const NOT_RENT_AFTER = /^\s?(?:(?:of|in|for)\s)?(?:service\scharge|s\/c|sc(?![a-z])|(?:business\s)?rates|turnover|t\/o|sales|takings|insurance|premium|deposit|contribution|cc(?![a-z])|fit[\s-]?out|capex|budget|erv)/i;
// The same words anywhere earlier in the clause, for a plain "pa" figure: "service charge capped at £12k pa".
const NOT_RENT_IN_CLAUSE = /(?<![a-z])(?:service\scharge|s\/c|rates|insurance|turnover|turn(?:s|ed|ing)?\sover|t\/o|sales|takings?)(?![a-z])/i;
const RENT_WORD_AT = /\s(?:base\s|headline\s)?rent\b(?!\s?(?:free|review|deposit|in\sadvance|holiday|commencement|passing))/iy;
// The other half of a range ("£90-100k", "£90k to £100k").
const RANGE_BEFORE = /((?:£\s?)?\d[\d,.]*(?:\s?(?:k|mn?))?)(\s?(?:-|–|—|to)\s?)$/i;
const RANGE_AFTER = /^(\s?(?:-|–|—|to)\s?)(?:£\s?)?\d/i;
const STEPPED_RENT = /\b(?:rising|increasing|stepping(?:\sup)?|steps?\sup|going\sup)\sto\b|\bstepped\srent\b|(?:£\s?\d[\d,.]*\s?(?:k|m)?|\d[\d,.]*\s?k)\sthereafter\b/i;
const MORE_THAN_ONE_RENT = "The note gives more than one rent. Type the rent.";

const NO_RANGE_BEFORE = String.raw`(?<!\d\s?(?:-|–|to)\s?)`;
const NO_RANGE_AFTER = String.raw`(?!\s?(?:-|–|to)\s?\d)`;
const TERMS: RegExp[] = [
  new RegExp(String.raw`\b(?:lease\s)?term\s?(?:of\s|is\s|:\s?|-\s?|=\s?)?(\d{1,3}(?:\.\d)?)${NO_RANGE_AFTER}(?:\s?(?:years?|yrs?|yr|y))?\b(?!\s?(?:months?|mths?|%))`, "i"),
  new RegExp(String.raw`(?<![\d.,£])${NO_RANGE_BEFORE}(\d{1,3}(?:\.\d)?)[\s-]?(?:years?|yrs?|yr)\s(?:lease|term|letting)\b`, "i"),
  new RegExp(String.raw`\b(?:lease|letting)\s?(?:of\s|for\s|:\s?|-\s?)?(\d{1,3}(?:\.\d)?)${NO_RANGE_AFTER}[\s-]?(?:years?|yrs?|yr)\b`, "i"),
];
const BARE_YEARS = new RegExp(String.raw`(?<![\d.,£])${NO_RANGE_BEFORE}(\d{1,3}(?:\.\d)?)[\s-]?(?:years?|yrs?)\b(?!\s?(?:break|rent|review|rr|free|rf|old|ago|anniversary|upward|tbo|lbo|mbo|tenant|landlord|mutual|rolling|notice|trading|experience))`, "i");
const YEARS_RANGE = /(?<![\d.,£])\d{1,3}\s?(?:-|–|to)\s?\d{1,3}[\s-]?(?:years?|yrs?|yr)\b/i;
// "They've been in Covent Garden 10 years": how long they have traded, not the term.
const TRADING_HISTORY = /\b(?:been|trading|traded|operat(?:ed|ing)|established|running)\b/i;
const FOLLOW_UP_LEAD = /(?:follow(?:ing)?[\s-]?up|chas(?:e|ing)|f\/u|revert|(?:get|come)\sback(?:\sto\s(?:us|me))?|decision|answer|response)\s?(?:due\s|expected\s)?(?:by\s|on\s|before\s)?(?:the\s)?$/i;
const LABELS: { re: RegExp; field: "brandName" | "contactName" | "agentName" | "attendees" | "nextAction"; name: boolean }[] = [
  { re: /\b(?:brand|tenant|operator|occupier)\s?:\s?/i, field: "brandName", name: true },
  { re: /\bcontact(?:\sis\s|\s?:\s?)/i, field: "contactName", name: true },
  { re: /\bagent(?:\sis\s|\s?:\s?)/i, field: "agentName", name: true },
  { re: /\b(?:(?:attendees|present)\s?:\s?|attended\sby\s)/i, field: "attendees", name: false },
  { re: /\b(?:next\s(?:action|steps?)|next)\s?:\s?/i, field: "nextAction", name: false },
];
// Where a labelled name ends: "James at CBRE acting for Pho" is James.
const NAME_STOP = /[.;,\u0001(]|\s[-–]\s|\s(?:at|acting|for|from|on\sbehalf|who|re|regarding)\s/i;
// Not a name: "tbc", "not known yet", "n/a".
const PLACEHOLDER = /^(?:tbc|tba|tbd|unknown|not|no|none|nil|n\/?a|to\sbe|awaiting|pending|[?x-]+)(?![a-z])/i;

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
function findBrands(text: string, scan: string, names: readonly string[], claims: Claims, stampEnd: number): { name: string; start: number; end: number }[] {
  const found: { name: string; start: number; end: number }[] = [];
  const caseTells = /[a-z]/.test(text) && /[A-Z]/.test(text);      // a note all in one case says nothing by its capitals
  const startsSentence = (at: number): boolean => at <= stampEnd || /(?:^|[.!?:;\u0001]\s?|^[-•*]\s?)$/.test(back(scan, at, 3));
  // Words after a name that show a brand is the subject: "Next have offered", "Office keen on".
  const SAYS_A_BRAND = /^(?:['’]s)?(?:\sand\s[A-Z]|\s(?:have|has|had|are|were|offered|offer|offers|offering|want|wants|wanted|viewed|viewing|viewings|called|rang|emailed|came|keen|interested|confirmed|said|say|says|need|needs|will|would|could|can|may|might|agreed|declined|passed|countered|proposed|accepted|rejected|withdrew|looking|looked|liked|loved|not|interest|enquiry|enquired|asked|asking|via|team|agents?|ltd|limited|plc|uk)\b|\s(?:on\s)?\d{1,2}(?:st|nd|rd|th)?[\s/](?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;
  const AFTER_FROM = /\b(?:from|for|behalf\sof|by|brand|tenant|operator|occupier|re)\s?:?\s$/i;
  const ENDS_HERE = /^(?:['’]s)?(?:\s?$|\s?[,;:.!?)/&+–-]|\sand\b)/i;
  const NOT_A_BRAND_AFTER = /^\s(?:weeks?|months?|years?|quarter|steps?|door|time|to|days?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thur?s?|fri|sat|sun|morning|afternoon|thing|stage|action|floor|level|up|is|was|few)\b/i;
  const PERSON_BEFORE = /\b(?:spoke\s(?:to|with)|met(?:\swith)?|called|emailed|rang|cc)\s$/i;
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
  const has = (f: LettingNoteField) => (fields as Record<string, unknown>)[f] !== undefined;
  const put = (f: LettingNoteField, value: unknown, start: number, end: number): boolean => {
    if (!allowed.has(f) || has(f) || !claims.take(start, end)) return false;
    (fields as Record<string, unknown>)[f] = value;
    quotes[f] = text.slice(start, end).trim();
    return true;
  };
  const drop = (field: string, reason: string) => { if (!dropped.some(d => d.field === field)) dropped.push({ field, reason }); };
  const span = (m: RegExpExecArray): [number, number] => [m.index, m.index + m[0].length];

  // 1. Who wrote it and when.
  const dates = findDates(scan);
  const stamp = readStamp(scan, dates, ctx, ref);
  if (stamp) claims.take(0, stamp.end);

  // 2. Labelled lines: "Contact: Sam Hart", "Next action: send plans".
  for (const label of LABELS) {
    if (!allowed.has(label.field) || has(label.field)) continue;
    const m = label.re.exec(scan);
    if (!m || !claims.free(m.index, m.index + m[0].length)) continue;
    const from = m.index + m[0].length;
    const rest = scan.slice(from, from + (label.name ? 120 : LONG_TEXT_MAX));
    const stop = (label.name ? NAME_STOP : /\.(?=\s|\u0001|$)|[;\u0001]/).exec(rest);
    const end = from + (stop ? stop.index : rest.length);
    const value = text.slice(from, end).replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (label.name && (value.length > 80 || !/[A-Za-z]/.test(value) || PLACEHOLDER.test(value) || value.split(" ").length > 6)) continue;
    if (!claims.take(m.index, end)) continue;
    (fields as Record<string, unknown>)[label.field] = value.slice(0, label.name ? NAME_MAX : label.field === "nextAction" ? NEXT_ACTION_MAX : LONG_TEXT_MAX);
    quotes[label.field] = text.slice(m.index, end).trim();
    // "Agent: Jane Roe (Savills)", "agent is James at CBRE": the firm, where the form has a box for it.
    if (label.field === "agentName" && allowed.has("agentCompanyName") && !has("agentCompanyName")) {
      const firm = /^\s?(?:\(([^()\u0001]{2,60})\)|(?:at|from|of)\s([A-Z][A-Za-z0-9&'’.-]*(?:\s[A-Z][A-Za-z0-9&'’.-]*){0,3}))/.exec(scan.slice(end, end + 70));
      const firmName = firm ? (firm[1] || firm[2]).trim().replace(/[.,]$/, "") : "";
      if (firm && firmName && !PLACEHOLDER.test(firmName) && claims.take(end, end + firm[0].length)) {
        fields.agentCompanyName = firmName;
        quotes.agentCompanyName = text.slice(end, end + firm[0].length).trim();
      }
    }
  }

  // Rent free before deposit: in "RF 9 months deposit 6 months" the nine months are the rent free.
  if (allowed.has("rentFreeMonths")) for (const r of RENT_FREE) each(r.re, scan, m => {
    if (has("rentFreeMonths") || !claims.free(...span(m))) return;
    if (r.trails && ledByTerm(scan, m.index)) return;      // "Term 10 years RF 6 months": the ten years are the term
    if (!r.nil && oneOfTwoFigures(scan, m)) return drop("rentFreeMonths", "The note gives more than one rent free period. Type the months.");
    const months = r.nil ? 0 : Number(m[1]) * (r.years ? 12 : 1);
    if (!inRange(months, NUMBER_MAX.rentFreeMonths)) return drop("rentFreeMonths", `"${m[0].trim()}" is not a rent free period this form can hold. Type the months.`);
    put("rentFreeMonths", months, ...span(m));
  });

  if (allowed.has("rentDeposit")) {
    for (const d of DEPOSITS) each(d.re, scan, m => {
      if (has("rentDeposit") || !claims.free(...span(m))) return;
      if (d.trails && ledByTerm(scan, m.index)) return;
      if (!d.none && oneOfTwoFigures(scan, m)) return drop("rentDeposit", "The note gives more than one deposit. Type the deposit.");
      const n = Number(m[1]);
      put("rentDeposit", d.none ? "No deposit" : `${n} month${n === 1 ? "" : "s"}`, ...span(m));
    });
    each(/\b(?:rent(?:al)?\s)?deposit\s?(?:of\s|at\s|:\s?|-\s?|=\s?)?(?=£)/i, scan, m => {
      const money = moneyAt(scan, m.index + m[0].length);
      if (money && !has("rentDeposit") && money.value > 0 && money.value <= MONEY_MAX) put("rentDeposit", pounds(money.value), m.index, money.end);
    });
  }

  if (allowed.has("turnoverRentPct")) for (const re of TURNOVER) each(re, scan, m => {
    if (has("turnoverRentPct") || !claims.free(...span(m))) return;
    if (oneOfTwoFigures(scan, m)) return drop("turnoverRentPct", "The note gives more than one turnover percentage. Type it.");
    const pct = Number(m[1]);
    if (!inRange(pct, NUMBER_MAX.turnoverRentPct)) return drop("turnoverRentPct", `"${m[0].trim()}" is over 100%. Type the turnover percentage.`);
    put("turnoverRentPct", pct, ...span(m));
  });

  if (allowed.has("breakOption")) {
    for (const b of BREAKS) each(b.re, scan, m => {
      const year = b.year.map(i => m[i]).find(Boolean);
      if (!year) return;
      const end = m.index + m[0].length;
      // "Break clause yr 5 (tenant)", "break at year 5, tenant only".
      const tail = m[b.who] ? null : /^\s?\((tenant|landlord|mutual)(?:['’]?s)?(?:[\s-](?:only|option))?\)|^,?\s(tenant|landlord|mutual)[\s-]only\b/i.exec(scan.slice(end, end + 24));
      const who = BREAK_WHO[(m[b.who] || tail?.[1] || tail?.[2] || "").toLowerCase()];
      put("breakOption", `${who ? `${who} break` : "Break"} at year ${Number(year)}`, m.index, end + (tail ? tail[0].length : 0));
    });
    // A labelled line: "Break: tenant, year 10", "Break: 5th anniversary, tenant only".
    each(/\bbreaks?(?:\s(?:option|clause))?\s?[:=]\s?/i, scan, m => {
      if (has("breakOption")) return;
      const from = m.index + m[0].length;
      const line = /^[^.;\u0001]{0,80}/.exec(scan.slice(from, from + 80))![0];
      if (/^(?:none|nil|no)\b/i.test(line)) { put("breakOption", "No break", m.index, from + /^\w+/.exec(line)![0].length); return; }
      const years: { n: number; end: number }[] = [];
      each(/\b(?:year|yr|y)\s?(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\b(?:\s(?:year|anniversary))?/i, line, y => { years.push({ n: Number(y[1] || y[2]), end: y.index + y[0].length }); });
      if (years.length !== 1) return;                                           // two break dates: left for the person
      const who = /\b(tenant|landlord|mutual|rolling)(?:['’]?s)?(?:[\s-]only)?\b/i.exec(line);
      const end = from + Math.max(years[0].end, who ? who.index + who[0].length : 0);
      put("breakOption", `${who ? `${BREAK_WHO[who[1].toLowerCase()]} break` : "Break"} at year ${years[0].n}`, m.index, end);
    });
    each(/\bno\sbreaks?\b/i, scan, m => { put("breakOption", "No break", ...span(m)); });
  }

  if (allowed.has("rentReview")) for (const re of REVIEWS) each(re, scan, m => {
    put("rentReview", upperFirst(text.slice(...span(m)).replace(/\s+/g, " ").trim()).slice(0, TERM_TEXT_MAX), ...span(m));
  });

  // Money against a word: "£50k CC", "premium of £25,000".
  const moneyByWord = (field: "fittingOutContribution" | "premium", word: RegExp, label: string) => {
    if (!allowed.has(field)) return;
    each(word, scan, m => {
      if (has(field) || !claims.free(...span(m))) return;
      const wordEnd = m.index + m[0].length;
      if (field === "premium" && /reverse\s?$/i.test(back(scan, m.index, 10))) return;      // a reverse premium is an incentive
      if (field === "fittingOutContribution" && NOT_FITOUT_AFTER.test(scan.slice(wordEnd, wordEnd + 32))) return;
      const sep = /^\s?(?:of\s|at\s|is\s|:\s?|-\s?|–\s?|=\s?|@\s?)?/.exec(scan.slice(wordEnd, wordEnd + 6))![0].length;
      const after = moneyAt(scan, wordEnd + sep);
      const money = after && looksLikeMoney(after) ? after : moneyBefore(scan, m.index);
      if (!money || !looksLikeMoney(money) || !claims.free(money.start, money.end)) return;
      const start = Math.min(m.index, money.start), end = Math.max(wordEnd, money.end);
      const not = stickyAt(NOT_YEARLY_AT, scan, money.end) || stickyAt(AREA_AT, scan, money.end);
      if (not && money.end >= wordEnd) return drop(field, `"${text.slice(start, not.index + not[0].length).trim()}" is not a single sum. Type the ${label}.`);
      if (!(money.value > 0 && money.value <= MONEY_MAX)) return drop(field, `"${text.slice(start, end).trim()}" does not look like a real ${label}. Type it.`);
      put(field, money.value, start, end);
    });
  };
  moneyByWord("fittingOutContribution", FITOUT_WORD, "fit-out contribution");
  moneyByWord("premium", PREMIUM_WORD, "premium");

  // Rent. Every figure that could be the rent is gathered first. One is the
  // rent; two different ones, a range or a stepped rent set nothing.
  if (allowed.has("rentPa")) {
    const hits: { value: number; start: number; end: number }[] = [];
    const refusals: string[] = [];
    let range = false, outOfBounds = false;
    // True when the figure is one end of a range. The other end must be money
    // too and not a term already read ("£120k pax - £50k CC" is a list).
    const inRangeWith = (money: Money, afterYear: number): boolean => {
      const other = (at: number, tight: boolean): boolean => {
        const m = moneyAt(scan, at);
        return !!m && claims.free(m.start, m.end) && (m.pound || m.k || (tight && !money.pound)) && !stickyAt(NOT_YEARLY_AT, scan, m.end) && !stickyAt(AREA_AT, scan, m.end)
          && !NOT_RENT_AFTER.test(scan.slice(m.end, m.end + 24)) && !/^\s?(?:years?|yrs?|yr|months?|mths?|mrf|rf|%)(?![a-z])/i.test(scan.slice(m.end, m.end + 8));
      };
      const b = RANGE_BEFORE.exec(back(scan, money.start, 20));
      if (b && other(money.start - b[0].length, !/\s/.test(b[2]))) return true;
      for (const from of new Set([money.end, afterYear])) {
        const a = RANGE_AFTER.exec(scan.slice(from, from + 8));
        if (a && other(from + a[1].length, !/\s/.test(a[1]))) return true;
      }
      return false;
    };
    each(/£\s?\d|(?<![\d.,£A-Za-z])\d/, scan, m => {
      const money = moneyAt(scan, m.index);
      if (!money || !claims.free(money.start, money.end)) return;
      const before = back(scan, money.start, 48);
      const lead = RENT_LEAD_BEFORE.exec(before);
      const led = !!lead && !lead[1] && !lead[2];
      if (!led && (lead || NOT_RENT_BEFORE.test(before))) return;               // a quoting rent, a service charge, a turnover figure
      const start = led ? money.start - (before.length - lead!.index) : money.start;
      if (stickyAt(AREA_AT, scan, money.end)) return;                           // "2,400 sq ft"
      const not = stickyAt(NOT_YEARLY_AT, scan, money.end);
      if (not) {
        if (led || money.pound) refusals.push(`"${text.slice(start, not.index + not[0].length).trim()}" is not a yearly figure (per square foot, per month or the like). Type the annual rent.`);
        return;
      }
      const year = stickyAt(PER_YEAR_AT, scan, money.end);
      const afterYear = year ? year.index + year[0].length : money.end;
      const word = money.pound || money.k ? stickyAt(RENT_WORD_AT, scan, afterYear) : null;
      const end = word ? word.index + word[0].length : afterYear;
      if (led) {
        if (!looksLikeMoney(money)) return;
        if (!money.pound && !money.mult && !year && /^(?:19|20)\d\d$/.test(scan.slice(money.start, money.end))) return;      // "rent 2026": a year
      } else {
        if (!(money.pound || money.mult) || !(year || word)) return;
        // A plain "pa" with words after it that name something else: "£20k pa service charge".
        if (!word && !(year && RENT_ONLY_WORDS.test(year[0]))) {
          if (NOT_RENT_AFTER.test(scan.slice(end, end + 24)) || NOT_RENT_IN_CLAUSE.test(/[^.;!?,\u0001]*$/.exec(before)![0])) return;
        }
      }
      if (inRangeWith(money, afterYear)) { range = true; return; }
      const quote = text.slice(start, end).trim();
      if (money.value < RENT_MIN) { refusals.push(`"${quote}" is too small to be a year's rent. Type the annual rent.`); if (led) outOfBounds = true; return; }
      if (money.value > MONEY_MAX) { refusals.push(`"${quote}" is too large to be a year's rent. Type the annual rent.`); if (led) outOfBounds = true; return; }
      hits.push({ value: money.value, start, end });
    });
    // "Rent £1 pa for 2 years then £80k pax": the refused £1 is still a second rent.
    if (range || new Set(hits.map(h => h.value)).size > 1 || (hits.length && outOfBounds)) drop("rentPa", MORE_THAN_ONE_RENT);
    else if (hits.length && STEPPED_RENT.test(scan)) drop("rentPa", "The note gives a stepped rent. Type the rent.");
    else if (hits.length) put("rentPa", hits[0].value, hits[0].start, hits[0].end);
    else if (refusals.length) drop("rentPa", refusals[0]);
  }

  if (allowed.has("termYears")) {
    for (const re of TERMS) each(re, scan, m => {
      if (has("termYears") || !claims.free(...span(m))) return;
      if (!inRange(Number(m[1]), NUMBER_MAX.termYears)) return;
      put("termYears", Number(m[1]), ...span(m));
    });
    if (!has("termYears")) {
      const bare: RegExpExecArray[] = [];
      each(BARE_YEARS, scan, m => {
        if (!claims.free(...span(m))) return;
        const before = back(scan, m.index, 60);
        // "Peppercorn for 2 years", "after 5 years", "first 2 years": a period within the lease, not its length.
        if (/(?:every|after|at|in|for|first|year|within|over|last|past|next|about)\s$/i.test(before) || ledByTerm(scan, m.index)) return;
        if (TRADING_HISTORY.test(/[^.;!?\u0001]*$/.exec(before)![0])) return;
        bare.push(m);
      });
      const range = YEARS_RANGE.exec(scan);
      if (range && claims.free(...span(range))) drop("termYears", "The note gives a range of years. Type the term.");
      else if (bare.length === 1 && inRange(Number(bare[0][1]), NUMBER_MAX.termYears)) put("termYears", Number(bare[0][1]), ...span(bare[0]));
      else if (bare.length > 1) drop("termYears", "The note gives more than one length in years. Type the term.");
    }
  }

  // Dates: a follow-up ("chase by 20 Nov") is not the date of the offer or viewing,
  // and nor is an opening, a completion, a lease expiry or a start. Two
  // different days set nothing.
  const whens: { hit: DateHit; placed: Placed }[] = [];
  for (const hit of dates) {
    if (!claims.free(hit.start, hit.end)) continue;
    const lead = FOLLOW_UP_LEAD.exec(back(scan, hit.start, 40));
    if (lead) {
      if (!allowed.has("followUpDate") || has("followUpDate")) continue;
      const day = hit.place(ref, "future").day;
      if (day && claims.take(hit.start - lead[0].length, hit.end)) { fields.followUpDate = day; quotes.followUpDate = text.slice(hit.start - lead[0].length, hit.end).trim(); }
      continue;
    }
    if (!allowed.has("date") || dateIsOfSomethingElse(scan, hit, ctx.kind)) continue;
    whens.push({ hit, placed: hit.place(ref, dateModeFor(ctx.kind)) });
  }
  const placedDays = [...new Set(whens.map(w => w.placed.day).filter(Boolean))];
  if (placedDays.length > 1) drop("date", "The note gives more than one date. Set the date by hand.");
  else if (placedDays.length === 1) {
    const { hit } = whens.find(w => w.placed.day)!;
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
    if (stamp.day) { fields.date = stamp.day; quotes.date = stamp.dateQuote; }
    else if (stamp.why) drop("date", NOT_PLACED_REASON(stamp.dateQuote, stamp.why));
  }

  if (allowed.has("time")) {
    const times = findTimes(scan).filter(t => claims.free(t.start, t.end));
    if (new Set(times.map(t => t.value)).size > 1) drop("time", "The note gives more than one time. Set the time by hand.");
    else if (times.length) put("time", times[0].value, times[0].start, times[0].end);
  }

  // Whose position. Read for every kind so the words are not left over; only a round has the box.
  const ours = LANDLORD_SAID.exec(scan), theirs = TENANT_SAID.exec(scan);
  if (allowed.has("party")) {
    if (ours && theirs) drop("party", "The note gives both sides' positions. Choose whose position this is and check the figures.");
    else if (ours) put("party", "landlord", ...span(ours));
    else if (theirs) put("party", "tenant", ...span(theirs));
  }
  for (const m of [ours, theirs]) if (m) claims.take(...span(m));

  if (allowed.has("outcome")) {
    // Read from the whole note: "follow up by 20 Nov" is an outcome and a date.
    const body = stamp ? `${" ".repeat(stamp.end)}${scan.slice(stamp.end)}` : scan;
    const found = readOutcome(body);
    if (found && "reason" in found) drop("outcome", found.reason);
    else if (found) {
      fields.outcome = found.outcome;
      quotes.outcome = found.quote.trim();
      claims.take(found.start, found.start + found.quote.length);
    }
  }

  if (allowed.has("brandName") && !has("brandName") && ctx.brandNames?.length) {
    const found = findBrands(text, scan, ctx.brandNames, claims, stamp ? stamp.end : 0);
    if (found.length === 1 || (found.length > 1 && allowed.has("moreBrands"))) {
      for (const f of found) claims.take(f.start, f.end);
      fields.brandName = found[0].name;
      quotes.brandName = text.slice(found[0].start, found[0].end);
      if (found.length > 1) { fields.moreBrands = found.slice(1).map(f => ({ name: f.name })); quotes.moreBrands = found.slice(1).map(f => text.slice(f.start, f.end)).join(", "); }
    }
  }

  return {
    fields, quotes, dropped: dropped.filter(d => !has(d.field as LettingNoteField)), unplaced, saidBy: stamp?.name || null, saidByKnown: !!stamp?.known,
    leftover: leftoverOf(text, claims, stamp ? stamp.end : 0), text, claimed: claims.all(), bodyFrom: stamp ? stamp.end : 0,
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
export function normaliseCandidate(rawNote: string, candidate: unknown, ctx: NoteContext): PartialReading {
  const note = cleanNote(rawNote);
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
      const years = /\b(?:years?|yrs?)\b/i.test(quote), months = /\b(?:months?|mths?)\b/i.test(quote);
      const ok = stated.some(s => near(s, n)) || (f === "rentFreeMonths" && years && stated.some(s => near(s * 12, n)))
        || (f === "termYears" && months && !years && stated.some(s => near(s, n * 12)));
      if (!ok) { drop(f, `The figure ${n} is not in the words "${quote}".`); continue; }
      if (MONEY_FIELDS.has(f)) {
        const { before, after } = sides(quote);
        const refusal = sumRefusal(f, n, norm(quote), before, after);
        if (refusal) { drop(f, refusal); continue; }
        if (f === "rentPa" && n < RENT_MIN) { drop(f, `"${quote}" is too small to be a year's rent. Type the annual rent.`); continue; }
        if (!(n > 0 && n <= MONEY_MAX)) { drop(f, `"${quote}" does not look like a real sum. Type it.`); continue; }
      } else if (!inRange(n, NUMBER_MAX[f as keyof typeof NUMBER_MAX])) { drop(f, `${n} is outside what this box takes (0 to ${NUMBER_MAX[f as keyof typeof NUMBER_MAX]}).`); continue; }
      keep(f, n, quote);
    } else if (f === "date" || f === "followUpDate") {
      // The date is worked out here from the writer's own words, not taken on trust.
      const hit = findDates(quote)[0];
      const lead = hit ? `${sides(quote).before}${quote.slice(0, hit.start)}` : "";
      if (hit && f === "date" && dateIsOfSomethingElse(`${lead}${quote.slice(hit.start)}`, { start: lead.length, end: lead.length + (hit.end - hit.start) }, ctx.kind)) {
        drop(f, `"${quote}" reads as the date of something else (an opening, a completion, a start or a deadline). Set the date by hand.`); continue;
      }
      const placed: Placed = hit ? hit.place(ref, f === "followUpDate" ? "future" : dateModeFor(ctx.kind)) : { day: null };
      if (!placed.day) { drop(f, placed.why ? NOT_PLACED_REASON(hit!.quote, placed.why) : `The date could not be worked out from "${quote}". Set it by hand.`); continue; }
      keep(f, placed.day, quote);
    } else if (f === "time") {
      const time = findTimes(quote)[0];
      if (!time) { drop(f, `The time could not be worked out from "${quote}". Set it by hand.`); continue; }
      keep(f, time.value, quote);
    } else if (f === "party") {
      if (item.value !== "tenant" && item.value !== "landlord") { drop(f, "Whose position it is was not clear. Choose it."); continue; }
      keep(f, item.value, quote);
    } else if (f === "outcome") {
      const found = outcomeFromWords(oneLine(item.value, 100));
      if (!found || !NOTE_OUTCOMES.includes(found.outcome)) { drop(f, `"${oneLine(item.value, 60)}" is not one of the viewing outcomes. Choose one.`); continue; }
      // The quoted words must not say the opposite: "Not very keen" is not Interested.
      const said = readOutcome(quote);
      const opposite = said && "outcome" in said && [said.outcome, found.outcome].includes("Not Interested") && said.outcome !== found.outcome
        && ["Interested", "Not Interested"].includes(said.outcome) && ["Interested", "Not Interested"].includes(found.outcome);
      if (opposite || (said && "reason" in said)) { drop(f, `"${quote}" does not plainly say ${found.outcome}. Choose the outcome.`); continue; }
      keep(f, found.outcome, quote);
    } else {
      const text = oneLine(item.value, NAME_FIELDS.has(f) ? NAME_MAX : TEXT_MAX[f] ?? TERM_TEXT_MAX);
      if (!text) continue;
      // A name is never tidied up or completed: it is the note's own spelling. So is the leftover text.
      if ((NAME_FIELDS.has(f) || f === "note") && !inNote(text)) { drop(f, f === "note" ? "The leftover text was reworded, so it was not used." : `"${text}" is not written in the note.`); continue; }
      if (NAME_FIELDS.has(f) && PLACEHOLDER.test(text)) continue;                                      // "tbc" is not a name
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
  /** Said when the rest of the note went unread (no AI available, or it failed). */
  unreadReason?: string | null;
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
  const ai = input.candidate != null ? normaliseCandidate(text, input.candidate, input) : null;
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
  }

  const tomorrow = addNoteDays(input.today, 1);
  if (fields.date) {
    if (fields.date < EARLIEST_DAY) remove("date", "That date is too far back. Check the year.");
    else if (input.kind !== "viewing" && input.kind !== "viewing_outcome" && fields.date > tomorrow) remove("date", "That date is in the future. Set the date by hand.");
    else if (fields.date > addNoteDays(input.today, 730)) remove("date", "That date is more than two years ahead. Check the year.");
  }
  if (fields.followUpDate && (fields.followUpDate < EARLIEST_DAY || fields.followUpDate > addNoteDays(input.today, 730))) remove("followUpDate", "That follow-up date does not look right. Set it by hand.");
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
  if (input.unreadReason && short.leftover.length) dropped.push({ field: "note", reason: input.unreadReason });

  return { kind: input.kind, text, fields, quotes, unplaced: merged.unplaced, dropped, saidBy, usedAi: !!input.usedAi };
}

// Lower case with curly quotes and line ends made plain, one character for one, so a place found in it is the same place in the text.
function norm1(s: string): string { return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\n/g, " "); }
