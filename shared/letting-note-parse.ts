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

type Dropped = { field: string; reason: string };
type Quotes = Partial<Record<LettingNoteField, string>>;

export interface PartialReading {
  fields: LettingNoteFields;
  quotes: Quotes;
  unplaced: string[];
  dropped: Dropped[];
  saidBy: string | null;
}

export interface ShorthandReading extends PartialReading {
  /** The parts of the note no rule could place. Empty when the rules read all of it. */
  leftover: string[];
}

export interface NoteContext {
  kind: NoteKind;
  /** Today in London, yyyy-mm-dd. */
  today: string;
  /** Who wrote the note, when the source records it (a target comment's userName). */
  author?: string | null;
  /** Names of the letting team: never the brand's contact. */
  staffNames?: readonly string[];
  /** Brand names the caller may already pick. One found in the note is the brand. */
  brandNames?: readonly string[];
}

// ── Small helpers ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const addNoteDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayOf = (y: number, m: number, d: number): string | null => calendarDateValue(`${pad(y, 4)}-${pad(m)}-${pad(d)}`);
const weekdayOf = (day: string): number => new Date(`${day}T00:00:00.000Z`).getUTCDay();
const norm = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const oneLine = (v: unknown, max: number): string => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max) : "");
const sameName = (a: string, b: string): boolean => norm(a) === norm(b);
const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLetter = (c: string | undefined): boolean => !!c && /[a-z]/i.test(c);

class Claims {
  private spans: { start: number; end: number }[] = [];
  free(start: number, end: number): boolean { return !this.spans.some(s => start < s.end && end > s.start); }
  take(start: number, end: number): boolean {
    if (end <= start || !this.free(start, end)) return false;
    this.spans.push({ start, end });
    return true;
  }
  all(): { start: number; end: number }[] { return [...this.spans].sort((a, b) => a.start - b.start); }
}

function each(re: RegExp, text: string, fn: (m: RegExpExecArray) => void): void {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    if (m[0] === "") { g.lastIndex++; continue; }
    fn(m);
  }
}

// ── Money ──────────────────────────────────────────────────────────────────

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const MONEY_AT = new RegExp(String.raw`(£)?\s?${NUM}(?:(k|mn?)|\s?(million|thousand))?`, "iy");
// A year's figure: pax, p.a.x., pa, p.a., per annum (exclusive), per year, a year.
const PER_YEAR_AT = /\s*(?:p\.?a\.?x\.?|per\s+annum|per\s+year|a\s+year|p\.?a\.?)(?![a-z])(?:\s+(?:exclusive|excl\.?|exc\.?)(?![a-z]))?/iy;
// Not a year's figure. These are refused, never converted: a monthly or
// per-square-foot figure saved as annual is wrong by a large multiple.
const NOT_YEARLY = String.raw`(?:psf|p\.s\.f\.?|per\s+sq(?:uare)?\.?\s*(?:ft|foot|feet)\.?|\/\s?sq\.?\s?ft\.?|\/\s?ft|pcm|p\.c\.m\.?|per\s+calendar\s+month|per\s+month|a\s+month|monthly|\/\s?(?:month|mo)(?![a-z])|pm(?![a-z])|per\s+week|a\s+week|weekly|pw(?![a-z])|per\s+quarter|quarterly)`;
const NOT_YEARLY_AT = new RegExp(String.raw`\s*${NOT_YEARLY}`, "iy");
const NOT_YEARLY_RE = new RegExp(NOT_YEARLY, "i");

interface Money { value: number; start: number; end: number; pound: boolean; mult: boolean }

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
  const factor = mult === "k" || mult === "thousand" ? 1_000 : mult ? 1_000_000 : 1;
  return { value: n * factor, start: m.index, end, pound: !!m[1], mult: !!mult };
}

const looksLikeMoney = (m: Money): boolean => m.pound || m.mult || m.value >= 1000;

// The money written just before `at` ("£50k CC"), with "towards the" and the like between.
function moneyBefore(text: string, at: number): Money | null {
  const head = text.slice(0, at);
  const m = new RegExp(String.raw`(?:^|[^\d.,£])((?:£\s?)?${NUM}(?:(?:k|mn?)|\s?(?:million|thousand))?)\s*(?:(?:towards|for|of|as|in)\s+)?(?:(?:the|a)\s+)?$`, "i").exec(head);
  if (!m) return null;
  const start = m.index + m[0].indexOf(m[1]);
  const money = moneyAt(text, start);
  return money && /^\s*(?:(?:towards|for|of|as|in)\s+)?(?:(?:the|a)\s+)?$/i.test(text.slice(money.end, at)) ? money : null;
}

const pounds = (n: number): string => `£${Math.round(n).toLocaleString("en-GB")}`;

// ── Dates and times ────────────────────────────────────────────────────────

const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const MONTH_NO: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAY_NO: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const NOT_A_DAY = String.raw`(?!\s*(?:years?|yrs?|yr|months?|mths?|m|k|mrf|rf|%)(?![a-z]))`;

// How a day and month with no year is placed.
//   past     the most recent such date that is not in the future
//   nearest  whichever of last time and next time is closer (a viewing may be booked ahead)
//   future   the next such date, today included (a follow-up)
export type DateMode = "past" | "nearest" | "future";
export const dateModeFor = (kind: NoteKind): DateMode => (kind === "viewing" ? "nearest" : "past");

interface DateHit { start: number; end: number; quote: string; resolve(today: string, mode: DateMode): string | null }

function placeDayMonth(d: number, m: number, today: string, mode: DateMode): string | null {
  const year = Number(today.slice(0, 4));
  const days: string[] = [];
  for (let y = year - 8; y <= year + 8; y++) { const day = dayOf(y, m, d); if (day) days.push(day); }
  const before = days.filter(x => x <= today).pop() || null;
  const after = days.find(x => x >= today) || null;
  if (mode === "past") return before;
  if (mode === "future") return after;
  if (!before || !after) return before || after;
  return Date.parse(after) - Date.parse(today) < Date.parse(today) - Date.parse(before) ? after : before;
}

function placeWeekday(weekday: number, lead: string, today: string, mode: DateMode): string | null {
  const back = (weekdayOf(today) - weekday + 7) % 7;      // days since the last one, 0 = today
  const ahead = (weekday - weekdayOf(today) + 7) % 7;     // days to the next one, 0 = today
  if (lead === "last") return addNoteDays(today, -(back || 7));
  if (lead === "next") return addNoteDays(today, ahead || 7);
  if (lead === "this") return addNoteDays(today, ahead);
  if (mode === "future") return addNoteDays(today, ahead);
  return null;   // a bare "Monday" could be last week's or next week's: left for the person
}

const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));
// "may" is also a verb: as a month it needs a capital, an ordinal or a year.
const monthOk = (word: string, day: string, year: string | undefined): boolean =>
  word.toLowerCase() !== "may" || word[0] === "M" || !!year || /(?:st|nd|rd|th)$/i.test(day);

/** Every date written in the text, in the order written. */
export function findDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const add = (m: RegExpExecArray, resolve: DateHit["resolve"]) => hits.push({ start: m.index, end: m.index + m[0].length, quote: m[0], resolve });
  each(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/, text, m => add(m, () => dayOf(+m[1], +m[2], +m[3])));
  each(new RegExp(String.raw`(?<![\d.,£/])(\d{1,2}(?:st|nd|rd|th)?)[\s-]+(?:of\s+)?${MONTH}\b\.?(?:,?\s+(\d{4})(?!\d)|\s+'(\d{2})(?!\d))?`, "i"), text, m => {
    const year = m[3] || m[4];
    if (!monthOk(m[2], m[1], year)) return;
    const d = parseInt(m[1], 10), mo = MONTH_NO[m[2].slice(0, 3).toLowerCase()];
    add(m, (today, mode) => (year ? dayOf(fullYear(year), mo, d) : placeDayMonth(d, mo, today, mode)));
  });
  each(new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2}(?:st|nd|rd|th)?)(?![\d,.]*\d)${NOT_A_DAY}(?:,?\s+(\d{4})(?!\d))?`, "i"), text, m => {
    if (!monthOk(m[1], m[2], m[3])) return;
    const d = parseInt(m[2], 10), mo = MONTH_NO[m[1].slice(0, 3).toLowerCase()];
    add(m, (today, mode) => (m[3] ? dayOf(Number(m[3]), mo, d) : placeDayMonth(d, mo, today, mode)));
  });
  // British order: day, month, year. A slash date may leave the year off.
  each(new RegExp(String.raw`(?<![\d/.£-])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])${NOT_A_DAY}`), text, m => {
    if (m[0] === "24/7") return;
    add(m, (today, mode) => (m[3] ? dayOf(fullYear(m[3]), +m[2], +m[1]) : placeDayMonth(+m[1], +m[2], today, mode)));
  });
  each(/(?<![\d/.£-])(\d{1,2})([.-])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/, text, m => add(m, () => dayOf(fullYear(m[4]), +m[3], +m[1])));
  each(/\b(today|yesterday|tomorrow)\b/i, text, m => {
    const shift = { today: 0, yesterday: -1, tomorrow: 1 }[m[1].toLowerCase() as "today" | "yesterday" | "tomorrow"];
    add(m, today => addNoteDays(today, shift));
  });
  // Short weekday names need their capital ("Sat" is a day, "sat" is not).
  each(/\b(?:([Ll]ast|[Nn]ext|[Tt]his|[Oo]n)\s+)?([Mm]onday|[Tt]uesday|[Ww]ednesday|[Tt]hursday|[Ff]riday|[Ss]aturday|[Ss]unday|Mon|Tues?|Wed|Thurs?|Thu|Fri|Sat|Sun)\b/, text, m => {
    add(m, (today, mode) => placeWeekday(WEEKDAY_NO[m[2].slice(0, 3).toLowerCase()], (m[1] || "").toLowerCase(), today, mode));
  });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: DateHit[] = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
  return out;
}

/** The first date in a piece of text, placed against `today`. */
export function readLooseDate(text: string, today: string, mode: DateMode = "past"): string | null {
  for (const hit of findDates(text)) { const day = hit.resolve(today, mode); if (day) return day; }
  return null;
}

interface TimeHit { start: number; end: number; quote: string; value: string }

export function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  each(/(?<![\d:.£])(\d{1,2})(?:[:.]([0-5]\d))?\s?(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/i, text, m => {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return;
    const pm = m[3].toLowerCase().startsWith("p");
    hits.push({ start: m.index, end: m.index + m[0].length, quote: m[0], value: `${pad((h % 12) + (pm ? 12 : 0))}:${m[2] || "00"}` });
  });
  each(/(?<![\d:.£])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])(?!\s?(?:am|pm))/i, text, m => {
    hits.push({ start: m.index, end: m.index + m[0].length, quote: m[0], value: `${pad(Number(m[1]))}:${m[2]}` });
  });
  each(/\b(noon|midday)\b/i, text, m => hits.push({ start: m.index, end: m.index + m[0].length, quote: m[0], value: "12:00" }));
  return hits.sort((a, b) => a.start - b.start);
}

// ── Outcomes and whose position ────────────────────────────────────────────

const OUTCOME_WORDS: [string, RegExp][] = [
  ["No Show", /\bno[\s-]?show\b|\b(?:didn['’]?t|did\s+not)\s+(?:show|turn\s+up|attend)\b/i],
  ["Not Interested", /\bnot\s+(?:interested|keen|for\s+them|proceeding|progressing|taking\s+it\s+(?:forward|further))\b|\bno\s+interest\b|\b(?:they(?:['’]ve|\s+have)?|have|has)\s+passed\b(?!\s+(?:it\s+)?(?:on\s+)?to\b)|\bpass(?:ed|ing)\s+on\s+(?:it|this|the\s+unit)\b|\bruled\s+(?:it\s+)?out\b|\bdeclined\b/i],
  ["Offer Received", /\boffer\s+(?:was\s+|has\s+been\s+)?received\b|\breceived\s+(?:an\s+|their\s+)?offer\b|\b(?:made|put\s+in|submitted)\s+an\s+offer\b|\boffer\s+(?:is\s+)?in\b/i],
  ["Offer Expected", /\boffer\s+(?:is\s+)?expected\b|\bexpect(?:ing)?\s+(?:an\s+|their\s+)?offer\b|\boffer\s+to\s+follow\b|\bwill\s+(?:be\s+)?(?:make|making|put(?:ting)?\s+in|submit(?:ting)?)\s+an\s+offer\b|\b(?:going|intend(?:s|ing)?)\s+to\s+(?:make\s+an\s+)?offer\b/i],
  ["Second Viewing", /\b(?:second|2nd|another|repeat|further)\s+viewing\b|\bre-?visit\b|\bview(?:ing)?\s+(?:it\s+)?again\b|\breturn\s+visit\b/i],
  ["Interested", /\b(?:very\s+|really\s+|quite\s+)?(?:interested|keen)\b|\b(?:liked|loved|likes|loves)\s+(?:it|the\s+(?:unit|space|site))\b|\bpositive\b/i],
  ["Follow Up", /\bfollow(?:ing)?[\s-]?up\b|\bchas(?:e|ing)\b|\b(?:will|to)\s+revert\b|\b(?:get|come|coming)\s+back\s+to\s+(?:us|me)\b|\b(?:thinking\s+about|considering)\s+it\b/i],
];

/** The viewing outcome a phrase means, or null. "not interested" is read before "interested". */
export function outcomeFromWords(text: string): { outcome: string; quote: string; start: number } | null {
  const exact = NOTE_OUTCOMES.find(o => o.toLowerCase() === norm(text));
  if (exact) return { outcome: exact, quote: text, start: 0 };
  for (const [outcome, re] of OUTCOME_WORDS) {
    const m = re.exec(text);
    if (m) return { outcome, quote: m[0], start: m.index };
  }
  return null;
}

const LANDLORD_SAID = /\b(?:we|i)(?:\s+have|['’]ve)?\s+(?:countered|counter(?:[\s-]?offered)?|went\s+back|gone\s+back|came\s+back|responded|proposed|offered|put\s+forward)\b|\b(?:landlord|ll|client|our)(?:['’]s)?\s+(?:counter(?:ed)?(?:[\s-]?offer)?|response|proposal|position|came\s+back|offered|proposed)\b/i;
const TENANT_SAID = /\bthey(?:\s+have|['’]ve)?\s+(?:offered|countered|came\s+back|come\s+back|proposed|increased|improved|revised|upped|responded)\b|\b(?:tenant|brand|operator|occupier|their)(?:['’]s)?\s+(?:offer(?:ed)?|counter(?:ed)?(?:[\s-]?offer)?|came\s+back|proposal|proposed|position|revised(?:\s+offer)?|response|improved(?:\s+offer)?)\b/i;

// ── The author stamp ───────────────────────────────────────────────────────

// Words that start a note about a letting and are not a person's name
// ("Offer Received 9 Nov" is not written by someone called Offer Received).
const NOT_A_NAME = new Set(("offer offered offers received viewing viewed rent lease term terms tenant landlord counter countered they we the brand " +
  "interest interested meeting call email spoke met update note notes re hots heads second first new agreed follow up no show not break premium " +
  "deposit unit site visit inspection proposal revised final best bid on at from to with for and or by of in their our his her " +
  "jan january feb february mar march apr april may jun june jul july aug august sep sept september oct october nov november dec december " +
  "mon monday tue tues tuesday wed wednesday thu thur thurs thursday fri friday sat saturday sun sunday today yesterday tomorrow").split(" "));

interface Stamp { name: string; day: string | null; dateQuote: string; end: number }

// A leading "Ben Sykes 9 Nov", as the tracker draws a target comment (who,
// short date, then the words): who wrote the note and when. Never the brand's
// contact.
function readStamp(text: string, dates: DateHit[], ctx: NoteContext): Stamp | null {
  const lead = /^\s*/.exec(text)![0].length;
  const known = [...(ctx.staffNames || []), ...(ctx.author ? [ctx.author] : [])];
  const brands = ctx.brandNames || [];
  for (const date of dates) {
    if (date.start > lead + 90) break;
    const before = text.slice(lead, date.start);
    const m = /^([A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,3})\s*[,:(–-]?\s*$/.exec(before);
    if (!m) continue;
    const name = m[1].trim();
    const words = name.split(/\s+/);
    const isKnown = known.some(k => sameName(k, name));
    if (!isKnown) {
      if (words.length < 2) continue;                                        // one word and a date is more likely a brand
      if (words.some(w => NOT_A_NAME.has(w.toLowerCase().replace(/['’]s$/, "")) || /['’]s$/i.test(w))) continue;
      if (brands.some(b => sameName(b, name))) continue;
    }
    const day = date.resolve(ctx.today, "past");
    if (!day) continue;
    const tail = /^\s*[):,–-]?\s*/.exec(text.slice(date.end))![0].length;
    return { name, day, dateQuote: date.quote, end: date.end + tail };
  }
  return null;
}

// ── The shorthand reader ───────────────────────────────────────────────────

const RENT_FREE: { re: RegExp; years?: boolean }[] = [
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:x\s?)?m\.?r\.?f\b\.?/i },
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?|mos?|m)(?:['’]s?)?\s*(?:of\s+)?(?:rent[\s-]?free|r\/f|rf)\b/i },
  { re: /\brent[\s-]?free(?:\s+period)?\s*(?:of|:|-|=)?\s*(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?|mos?|m)\b/i },
  { re: /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:months?|mths?)\s+free\b/i },
  { re: /(?<![\d.,£])(\d{1,2}(?:\.\d+)?)\s?(?:years?|yrs?|yr)(?:['’]s?)?\s*(?:of\s+)?(?:rent[\s-]?free|r\/f|rf)\b/i, years: true },
  { re: /\brent[\s-]?free(?:\s+period)?\s*(?:of|:|-|=)?\s*(\d{1,2}(?:\.\d+)?)\s?(?:years?|yrs?)\b/i, years: true },
  { re: /(?<![\d.,£])(\d{1,3})\s?rf\b/i },
  { re: /\brf\s?(?:of\s+)?(\d{1,3})(?:\s?(?:months?|mths?|m))?\b(?!\s*(?:years?|yrs?|%|k\b))/i },
];
const TURNOVER: RegExp[] = [
  /(?<![\d.,£])(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent|pct)\s*(?:of\s+)?(?:gross\s+)?(?:t\/o|t\.o\.?|turnover|tor\b)(?:\s+rent)?/i,
  /\b(?:t\/o|turnover|tor)(?:\s+rent)?\s*(?:of|at|:|-|=|@)?\s*(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent|pct)/i,
];
const WHO = String.raw`(tenant|landlord|mutual|rolling)(?:['’]?s)?(?:[\s-]only)?`;
const BREAKS: { re: RegExp; who: number; year: number[] }[] = [
  { re: /\b(tbo|lbo|mbo)\s*(?:at|in|@|on)?\s*(?:the\s+)?(?:end\s+of\s+)?(?:year|yr|y)?\s?(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:year|anniversary))?\b/i, who: 1, year: [2] },
  { re: new RegExp(String.raw`\b(?:${WHO}\s+)?break(?:\s+(?:option|clause))?\s*(?:at|in|@|on|after)?\s*(?:the\s+)?(?:end\s+of\s+)?(?:(?:year|yr|y)\s?(\d{1,2})\b|(\d{1,2})(?:st|nd|rd|th)\b(?:\s+(?:year|anniversary))?)`, "i"), who: 1, year: [2, 3] },
  { re: new RegExp(String.raw`(?<![\d.,£])(\d{1,2})(?:st|nd|rd|th)?[\s-]?(?:year|yr)\s+(?:${WHO}\s+)?break\b(?:\s+(?:option|clause))?`, "i"), who: 2, year: [1] },
];
const BREAK_WHO: Record<string, string> = { tbo: "Tenant", lbo: "Landlord", mbo: "Mutual", tenant: "Tenant", landlord: "Landlord", mutual: "Mutual", rolling: "Rolling" };
const REVIEW_BASIS = String.raw`(?:\s*,?\s*(?:to|linked\s+to|at|-)?\s*(?:omv|omr|open\s+market(?:\s+(?:value|rent))?|rpi|cpi|index(?:ed|ation)?|fixed(?:\s+uplifts?)?)(?![a-z])(?:\s+(?:cap(?:ped)?|collar(?:ed)?)[^.;,\n]{0,60})?)`;
const REVIEWS: RegExp[] = [
  new RegExp(String.raw`(?<![\d.,£])\d{1,2}[\s-]?(?:yearly|year|yr)\s+(?:upwards?[\s-]only\s+)?(?:rent\s+)?reviews?\b${REVIEW_BASIS}?(?:\s+upwards?[\s-]only)?`, "i"),
  new RegExp(String.raw`\b(?:upwards?[\s-]only\s+)?(?:rent\s+reviews?|rr)\b(?:\s*(?:at|in|every|@|on)?\s*(?:the\s+)?(?:end\s+of\s+)?(?:year|yr)?\s?\d{1,2}(?:st|nd|rd|th)?(?:\s*(?:yearly|years?|yrs?|anniversary))?${REVIEW_BASIS}?|${REVIEW_BASIS})(?:\s+upwards?[\s-]only)?`, "i"),
];
const DEPOSITS: { re: RegExp; months?: boolean; none?: boolean }[] = [
  { re: /(?<![\d.,£])(\d{1,2})\s?(?:months?|mths?|m)(?:['’]s?)?\s*(?:rent(?:al)?\s+)?deposit\b/i, months: true },
  { re: /\b(?:rent(?:al)?\s+)?deposit\s*(?:of|:|-|=|at)?\s*(\d{1,2})\s?(?:months?|mths?)(?:['’]s?)?(?:\s+rent)?\b/i, months: true },
  { re: /\bno\s+(?:rent(?:al)?\s+)?deposit\b/i, none: true },
];
const FITOUT_WORD = /\b(?:cc|cap(?:ital)?\.?\s?con(?:tribution|trib)?|capex\s+contribution|fit(?:ting)?[\s-]?out(?:\s+(?:contribution|costs?|works))?|(?:landlord|ll)(?:['’]?s)?\s+contribution|contribution)\b/i;
const PREMIUM_WORD = /\b(?:premium|key\s+money)\b/i;
const RENT_LEAD = /\b(?:(quoting|asking|passing|current|estimated|turnover|service|market)\s+)?(?:(?:base|headline|initial|annual|starting)\s+)?rent(?:al)?\s*(?:of|at|is|was|:|-|–|=|@)?\s*/i;
const NOT_RENT_BEFORE = /(?:(?:quoting|asking|passing|current|estimated|market)\s+rent(?:al)?|service\s+charge|s\/c|\bsc|rates|insurance|turnover|t\/o|sales|deposit|premium|key\s+money|contribution|\bcc|erv|quoting|asking|passing|budget|capex|fit[\s-]?out|cost|costs)\s*(?:of|at|is|are|:|-|=|@|circa|c\.)?\s*$/i;
const TERMS: RegExp[] = [
  /\b(?:lease\s+)?term\s*(?:of|:|-|=|is)?\s*(\d{1,3}(?:\.\d)?)(?:\s?(?:years?|yrs?|yr|y))?\b(?!\s*(?:months?|mths?|%))/i,
  /(?<![\d.,£])(\d{1,3}(?:\.\d)?)[\s-]?(?:years?|yrs?|yr)\s*(?:lease|term|letting)\b/i,
  /\b(?:lease|letting)\s*(?:of|for|:|-)?\s*(\d{1,3}(?:\.\d)?)[\s-]?(?:years?|yrs?|yr)\b/i,
];
const BARE_YEARS = /(?<![\d.,£])(\d{1,3}(?:\.\d)?)[\s-]?(?:years?|yrs?)\b(?!\s*(?:break|rent|review|rr|free|rf|old|ago|anniversary|upward))/i;
const FOLLOW_UP_LEAD = /(?:follow(?:ing)?[\s-]?up|chas(?:e|ing)|f\/u|revert|(?:get|come)\s+back(?:\s+to\s+(?:us|me))?|decision|answer|response)\s*(?:due\s+|expected\s+)?(?:by|on|before)?\s*(?:the\s+)?$/i;
const LABELS: { re: RegExp; field: "brandName" | "contactName" | "agentName" | "attendees" | "nextAction"; name: boolean }[] = [
  { re: /\b(?:brand|tenant|operator|occupier)\s*:\s*/i, field: "brandName", name: true },
  { re: /\bcontact(?:\s+is|\s*:)\s*/i, field: "contactName", name: true },
  { re: /\bagent(?:\s+is|\s*:)\s*/i, field: "agentName", name: true },
  { re: /\b(?:(?:attendees|present)\s*:\s*|attended\s+by\s+)/i, field: "attendees", name: false },
  { re: /\b(?:next\s+(?:action|steps?)|next)\s*:\s*/i, field: "nextAction", name: false },
];

// Words that carry no term of their own once the terms around them are read.
const FILLER = new Set(("a an the and with at of on for to is was are were be been in by from as or plus also but so then that this it its they we i " +
  "their our them us have has had offer offered offering offers lease term rent rental terms proposed proposal follows following per vat " +
  "exclusive excl incl including year years received tenant landlord unit re regarding basis stc subject contract headline base " +
  "viewing viewed booked wrote said").split(" "));

// A stretch of the note with its loose ends trimmed, or "" when only filler is left.
function tidyPart(part: string): string {
  const tidy = part.replace(/\s+/g, " ").replace(/^[\s:;,.()–—\-+&/]+|[\s:;,(–—\-+&/]+$/g, "").replace(/\.$/, "");
  return (tidy.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || []).some(w => /\d/.test(w) || !FILLER.has(w.toLowerCase())) ? tidy : "";
}

// What no rule placed: each unbroken stretch of the note between the words that were read.
function leftoverOf(text: string, claims: Claims): string[] {
  const parts: string[] = [];
  let at = 0;
  for (const s of claims.all()) { parts.push(text.slice(at, s.start)); at = Math.max(at, s.end); }
  parts.push(text.slice(at));
  return parts.map(tidyPart).filter(Boolean);
}

const inRange = (n: number, max: number): boolean => Number.isFinite(n) && n >= 0 && n <= max;

/**
 * Reads the terms an agent wrote in shorthand, with no AI. Each value comes
 * with the exact words it was read from. Anything it is not sure of is left
 * in `leftover` for a person (or the AI reader) rather than guessed.
 */
export function readShorthand(text: string, ctx: NoteContext): ShorthandReading {
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
  const dates = findDates(text);
  const stamp = readStamp(text, dates, ctx);
  if (stamp) claims.take(0, stamp.end);

  // 2. Labelled lines: "Contact: Sam Hart", "Next action: send plans".
  for (const label of LABELS) {
    if (!allowed.has(label.field) || has(label.field)) continue;
    const m = label.re.exec(text);
    if (!m || !claims.free(m.index, m.index + m[0].length)) continue;
    const from = m.index + m[0].length;
    const stop = (label.name ? /[.;,\n(]|\s+[-–]\s+/ : /\.(?=\s|$)|[;\n]/).exec(text.slice(from));
    const end = stop ? from + stop.index : text.length;
    const value = text.slice(from, end).replace(/\s+/g, " ").trim();
    if (!value || (label.name && (value.length > 80 || !/[A-Za-z]/.test(value)))) continue;
    if (!claims.take(m.index, end)) continue;
    (fields as Record<string, unknown>)[label.field] = value.slice(0, label.name ? NAME_MAX : label.field === "nextAction" ? NEXT_ACTION_MAX : LONG_TEXT_MAX);
    quotes[label.field] = text.slice(m.index, end).trim();
  }

  if (allowed.has("rentDeposit")) {
    for (const d of DEPOSITS) each(d.re, text, m => {
      if (has("rentDeposit")) return;
      const n = Number(m[1]);
      put("rentDeposit", d.none ? "No deposit" : `${n} month${n === 1 ? "" : "s"}`, ...span(m));
    });
    each(/\b(?:rent(?:al)?\s+)?deposit\s*(?:of|:|-|=|at)?\s*(?=£)/i, text, m => {
      const money = moneyAt(text, m.index + m[0].length);
      if (money && !has("rentDeposit") && money.value > 0 && money.value <= MONEY_MAX) put("rentDeposit", pounds(money.value), m.index, money.end);
    });
  }

  if (allowed.has("rentFreeMonths")) for (const r of RENT_FREE) each(r.re, text, m => {
    if (has("rentFreeMonths") || !claims.free(...span(m))) return;
    const months = Number(m[1]) * (r.years ? 12 : 1);
    if (!inRange(months, NUMBER_MAX.rentFreeMonths)) return drop("rentFreeMonths", `"${m[0].trim()}" is not a rent free period this form can hold. Type the months.`);
    put("rentFreeMonths", months, ...span(m));
  });

  if (allowed.has("turnoverRentPct")) for (const re of TURNOVER) each(re, text, m => {
    if (has("turnoverRentPct") || !claims.free(...span(m))) return;
    const pct = Number(m[1]);
    if (!inRange(pct, NUMBER_MAX.turnoverRentPct)) return drop("turnoverRentPct", `"${m[0].trim()}" is over 100%. Type the turnover percentage.`);
    put("turnoverRentPct", pct, ...span(m));
  });

  if (allowed.has("breakOption")) {
    for (const b of BREAKS) each(b.re, text, m => {
      const year = b.year.map(i => m[i]).find(Boolean);
      const who = BREAK_WHO[(m[b.who] || "").toLowerCase()];
      if (year) put("breakOption", `${who ? `${who} break` : "Break"} at year ${Number(year)}`, ...span(m));
    });
    each(/\bno\s+breaks?\b/i, text, m => { put("breakOption", "No break", ...span(m)); });
  }

  if (allowed.has("rentReview")) for (const re of REVIEWS) each(re, text, m => {
    put("rentReview", upperFirst(m[0].replace(/\s+/g, " ").trim()).slice(0, TERM_TEXT_MAX), ...span(m));
  });

  // Money against a word: "£50k CC", "premium of £25,000".
  const moneyByWord = (field: "fittingOutContribution" | "premium", word: RegExp, label: string) => {
    if (!allowed.has(field)) return;
    each(word, text, m => {
      if (has(field) || !claims.free(...span(m))) return;
      if (field === "premium" && /reverse\s*$/i.test(text.slice(0, m.index))) return;      // a reverse premium is an incentive
      const sep = /^\s*(?:of|at|is|:|-|–|=|@)?\s*/.exec(text.slice(m.index + m[0].length))![0].length;
      const after = moneyAt(text, m.index + m[0].length + sep);
      const money = after && looksLikeMoney(after) ? after : moneyBefore(text, m.index);
      if (!money || !looksLikeMoney(money)) return;
      const start = Math.min(m.index, money.start), end = Math.max(m.index + m[0].length, money.end);
      const not = stickyAt(NOT_YEARLY_AT, text, money.end);
      if (not && money.end >= m.index + m[0].length) return drop(field, `"${text.slice(start, not.index + not[0].length).trim()}" is not a single sum. Type the ${label}.`);
      if (!(money.value > 0 && money.value <= MONEY_MAX)) return drop(field, `"${text.slice(start, end).trim()}" does not look like a real ${label}. Type it.`);
      put(field, money.value, start, end);
    });
  };
  moneyByWord("fittingOutContribution", FITOUT_WORD, "fit-out contribution");
  moneyByWord("premium", PREMIUM_WORD, "premium");

  if (allowed.has("rentPa")) {
    const tooSmall = (quote: string) => drop("rentPa", `"${quote}" is too small to be a year's rent. Type the annual rent.`);
    const notYearly = (quote: string) => drop("rentPa", `"${quote}" is not a yearly figure (per square foot, per month or the like). Type the annual rent.`);
    each(RENT_LEAD, text, m => {
      if (has("rentPa") || m[1]) return;
      const money = moneyAt(text, m.index + m[0].length);
      if (!money || !claims.free(m.index, money.end)) return;
      const not = stickyAt(NOT_YEARLY_AT, text, money.end);
      if (not) return notYearly(text.slice(m.index, not.index + not[0].length).trim());
      if (!looksLikeMoney(money)) return;
      const year = stickyAt(PER_YEAR_AT, text, money.end);
      const end = year ? year.index + year[0].length : money.end;
      if (money.value < RENT_MIN) return tooSmall(text.slice(m.index, end).trim());
      if (money.value > MONEY_MAX) return drop("rentPa", `"${text.slice(m.index, end).trim()}" is too large to be a year's rent. Type the annual rent.`);
      put("rentPa", money.value, m.index, end);
    });
    // A figure with no "rent" before it: "£120,000 pa", "120k pax", "£95k rent".
    each(/£\s?\d|(?<![\d.,£])\d/, text, m => {
      const money = moneyAt(text, m.index);
      if (!money || !claims.free(money.start, money.end) || NOT_RENT_BEFORE.test(text.slice(Math.max(0, money.start - 30), money.start))) return;
      const not = stickyAt(NOT_YEARLY_AT, text, money.end);
      if (not) { if (!has("rentPa") && money.pound) notYearly(text.slice(money.start, not.index + not[0].length).trim()); return; }
      if (has("rentPa") || !(money.pound || money.mult)) return;
      const year = stickyAt(PER_YEAR_AT, text, money.end);
      const word = year ? null : stickyAt(/\s+(?:base\s+|headline\s+)?rent\b(?!\s*(?:free|review|deposit))/iy, text, money.end);
      const tail = year || word;
      if (!tail) return;
      const end = tail.index + tail[0].length;
      if (money.value < RENT_MIN) return tooSmall(text.slice(money.start, end).trim());
      if (money.value > MONEY_MAX) return;
      put("rentPa", money.value, money.start, end);
    });
    if (has("rentPa")) { const i = dropped.findIndex(d => d.field === "rentPa"); if (i >= 0) dropped.splice(i, 1); }
  }

  if (allowed.has("termYears")) {
    for (const re of TERMS) each(re, text, m => {
      if (has("termYears") || !claims.free(...span(m))) return;
      if (!inRange(Number(m[1]), NUMBER_MAX.termYears)) return;
      put("termYears", Number(m[1]), ...span(m));
    });
    if (!has("termYears")) {
      const bare: RegExpExecArray[] = [];
      each(BARE_YEARS, text, m => {
        if (claims.free(...span(m)) && !/(?:every|after|at|in|first|year)\s+$/i.test(text.slice(0, m.index))) bare.push(m);
      });
      if (bare.length === 1 && inRange(Number(bare[0][1]), NUMBER_MAX.termYears)) put("termYears", Number(bare[0][1]), ...span(bare[0]));
      else if (bare.length > 1) drop("termYears", "The note gives more than one length in years. Type the term.");
    }
  }

  // Dates: a follow-up ("chase by 20 Nov") is not the date of the offer or viewing.
  for (const hit of dates) {
    if (!claims.free(hit.start, hit.end)) continue;
    const lead = FOLLOW_UP_LEAD.exec(text.slice(Math.max(0, hit.start - 40), hit.start));
    if (lead) {
      if (!allowed.has("followUpDate") || has("followUpDate")) continue;
      const day = hit.resolve(ctx.today, "future");
      if (day && claims.take(hit.start - lead[0].length, hit.end)) { fields.followUpDate = day; quotes.followUpDate = text.slice(hit.start - lead[0].length, hit.end).trim(); }
      continue;
    }
    if (!allowed.has("date") || has("date")) continue;
    const day = hit.resolve(ctx.today, dateModeFor(ctx.kind));
    if (day) put("date", day, hit.start, hit.end);
  }
  if (stamp?.day && allowed.has("date") && !has("date")) { fields.date = stamp.day; quotes.date = stamp.dateQuote; }

  if (allowed.has("time")) for (const t of findTimes(text)) if (put("time", t.value, t.start, t.end)) break;

  // Whose position. Read for every kind so the words are not left over; only a round has the box.
  const ours = LANDLORD_SAID.exec(text), theirs = TENANT_SAID.exec(text);
  if (allowed.has("party")) {
    if (ours && theirs) drop("party", "The note gives both sides' positions. Choose whose position this is and check the figures.");
    else if (ours) put("party", "landlord", ...span(ours));
    else if (theirs) put("party", "tenant", ...span(theirs));
  }
  for (const m of [ours, theirs]) if (m) claims.take(...span(m));

  if (allowed.has("outcome")) {
    // Read from the whole note: "follow up by 20 Nov" is an outcome and a date.
    const found = outcomeFromWords(text);
    if (found && !(stamp && found.start < stamp.end)) {
      fields.outcome = found.outcome;
      quotes.outcome = found.quote.trim();
      claims.take(found.start, found.start + found.quote.length);
    }
  }

  // A brand the caller may already pick, named in the note.
  if (allowed.has("brandName") && !has("brandName") && ctx.brandNames?.length) {
    const found: { name: string; start: number; end: number }[] = [];
    const noCapitals = !/[A-Z]/.test(text);
    for (const name of [...new Set(ctx.brandNames.map(n => n.trim()).filter(n => n.length >= 2))].sort((a, b) => b.length - a.length)) {
      const m = new RegExp(String.raw`(?<![A-Za-z0-9])${escapeRe(name).replace(/\s+/g, String.raw`\s+`)}(?![A-Za-z0-9])`, "i").exec(text);
      if (!m || found.some(f => m.index < f.end && m.index + m[0].length > f.start)) continue;
      // A one-word brand that is also an ordinary word ("Next") needs its capital.
      if (!/\s/.test(name) && !noCapitals && !/^[A-Z0-9]/.test(m[0])) continue;
      if (claims.free(m.index, m.index + m[0].length)) found.push({ name, start: m.index, end: m.index + m[0].length });
    }
    found.sort((a, b) => a.start - b.start);
    if (found.length === 1 || (found.length > 1 && allowed.has("moreBrands"))) {
      for (const f of found) claims.take(f.start, f.end);
      fields.brandName = found[0].name;
      quotes.brandName = text.slice(found[0].start, found[0].end);
      if (found.length > 1) { fields.moreBrands = found.slice(1).map(f => ({ name: f.name })); quotes.moreBrands = found.slice(1).map(f => text.slice(f.start, f.end)).join(", "); }
    }
  }

  return { fields, quotes, dropped: dropped.filter(d => !has(d.field as LettingNoteField)), unplaced, saidBy: stamp?.name || null, leftover: leftoverOf(text, claims) };
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
    if (!money) return;
    const plain = parseFloat(new RegExp(NUM).exec(text.slice(m.index))![1].replace(/,/g, ""));
    out.push(money.value, plain);
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

/**
 * Checks a reading proposed by an AI. `candidate` holds one { value, quote }
 * per field, plus `unplaced` (a list of text) and `saidBy`. A value is kept
 * only when its quote is literally in the note and, for a figure, the figure
 * is in the quote; everything refused is listed in `dropped` with the reason.
 */
export function normaliseCandidate(note: string, candidate: unknown, ctx: NoteContext): PartialReading {
  const src: Record<string, unknown> = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : {};
  const allowed = new Set<string>(NOTE_KIND_FIELDS[ctx.kind]);
  const haystack = norm(note);
  const fields: LettingNoteFields = {};
  const quotes: Quotes = {};
  const dropped: Dropped[] = [];
  const unplaced: string[] = [];
  const inNote = (s: string): boolean => { const n = norm(s).replace(/(?:…|\.\.\.)$/, "").trim(); return !!n && haystack.includes(n); };
  const addUnplaced = (s: unknown) => { const t = oneLine(s, 300); if (t && inNote(t) && unplaced.length < 12 && !unplaced.some(u => sameName(u, t))) unplaced.push(t); };
  const keep = (f: LettingNoteField, value: unknown, quote: string) => { (fields as Record<string, unknown>)[f] = value; quotes[f] = quote; };
  const drop = (field: string, reason: string) => { dropped.push({ field, reason }); };

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
        const at = haystack.indexOf(norm(quote));
        const after = at >= 0 ? haystack.slice(at + norm(quote).length, at + norm(quote).length + 16) : "";
        if (NOT_YEARLY_RE.test(quote) || new RegExp(String.raw`^\s*${NOT_YEARLY}`, "i").test(after)) { drop(f, `"${quote}" is not a yearly figure or a single sum (per square foot, per month or the like). Type it.`); continue; }
        if (f === "rentPa" && n < RENT_MIN) { drop(f, `"${quote}" is too small to be a year's rent. Type the annual rent.`); continue; }
        if (!(n > 0 && n <= MONEY_MAX)) { drop(f, `"${quote}" does not look like a real sum. Type it.`); continue; }
      } else if (!inRange(n, NUMBER_MAX[f as keyof typeof NUMBER_MAX])) { drop(f, `${n} is outside what this box takes (0 to ${NUMBER_MAX[f as keyof typeof NUMBER_MAX]}).`); continue; }
      keep(f, n, quote);
    } else if (f === "date" || f === "followUpDate") {
      // The date is worked out here from the writer's own words, not taken on trust.
      const day = readLooseDate(quote, ctx.today, f === "followUpDate" ? "future" : dateModeFor(ctx.kind));
      if (!day) { drop(f, `The date could not be worked out from "${quote}". Set it by hand.`); continue; }
      keep(f, day, quote);
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
      keep(f, found.outcome, quote);
    } else {
      const text = oneLine(item.value, NAME_FIELDS.has(f) ? NAME_MAX : TEXT_MAX[f] ?? TERM_TEXT_MAX);
      if (!text) continue;
      // A name is never tidied up or completed: it is the note's own spelling. So is the leftover text.
      if ((NAME_FIELDS.has(f) || f === "note") && !inNote(text)) { drop(f, f === "note" ? "The leftover text was reworded, so it was not used." : `"${text}" is not written in the note.`); continue; }
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

/** The shorthand reading wins where both found the same field; the AI fills the rest. */
export function mergeReadings(shorthand: PartialReading, ai: PartialReading): PartialReading {
  const mine = new Set(Object.keys(shorthand.fields));
  const dropped = [...shorthand.dropped];
  for (const d of ai.dropped) if (!mine.has(d.field) && !dropped.some(x => x.field === d.field)) dropped.push(d);
  const unplaced = [...shorthand.unplaced];
  for (const u of ai.unplaced) if (!unplaced.some(x => sameName(x, u))) unplaced.push(u);
  return {
    fields: { ...ai.fields, ...shorthand.fields },
    quotes: { ...ai.quotes, ...shorthand.quotes },
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
}

/**
 * The whole reading: shorthand first, the checked AI candidate for the rest,
 * then the rules that look across fields.
 */
export function buildReading(input: BuildReadingInput): LettingNoteReading {
  const text = String(input.text || "").trim();
  const short = readShorthand(text, input);
  const ai = input.candidate != null ? normaliseCandidate(text, input.candidate, input) : null;
  const merged = ai ? mergeReadings(short, ai) : { fields: { ...short.fields }, quotes: { ...short.quotes }, unplaced: [...short.unplaced], dropped: [...short.dropped], saidBy: short.saidBy };
  const { fields, quotes, dropped } = merged;
  const saidBy = input.author || merged.saidBy || null;
  const remove = (f: LettingNoteField, reason: string) => {
    delete (fields as Record<string, unknown>)[f];
    delete quotes[f];
    if (!dropped.some(d => d.field === f)) dropped.push({ field: f, reason });
  };

  // The person who wrote the note, or one of the letting team, is not the brand's contact.
  const team = [...(input.staffNames || []), ...(saidBy ? [saidBy] : [])];
  for (const f of ["contactName", "agentName"] as const) {
    const name = fields[f];
    if (name && team.some(t => sameName(t, name))) remove(f, `${name} looks like the person who wrote the note or one of the letting team, not ${f === "contactName" ? "the brand's contact" : "the brand's agent"}.`);
  }

  const tomorrow = addNoteDays(input.today, 1);
  if (fields.date) {
    if (fields.date < EARLIEST_DAY) remove("date", "That date is too far back. Check the year.");
    else if (input.kind !== "viewing" && input.kind !== "viewing_outcome" && fields.date > tomorrow) remove("date", "That date is in the future. Set the date by hand.");
    else if (fields.date > addNoteDays(input.today, 730)) remove("date", "That date is more than two years ahead. Check the year.");
  }
  if (fields.followUpDate && (fields.followUpDate < EARLIEST_DAY || fields.followUpDate > addNoteDays(input.today, 730))) remove("followUpDate", "That follow-up date does not look right. Set it by hand.");
  if (fields.outcome && fields.date && fields.date > input.today) remove("outcome", "A viewing in the future cannot have an outcome yet.");

  // What no rule or reader placed is kept for the form's notes box, so nothing is lost.
  if (!fields.note) {
    // Less the words the AI reader placed, so the notes box does not repeat the boxes above it.
    const used = ai ? Object.values(ai.quotes).filter((q): q is string => !!q && q.length > 1) : [];
    const rest = short.leftover.map(part => {
      let left = part;
      for (const q of used) { const i = left.toLowerCase().indexOf(q.toLowerCase()); if (i >= 0) left = `${left.slice(0, i)} ${left.slice(i + q.length)}`; }
      return left === part ? part : tidyPart(left);
    }).filter(Boolean);
    const note = rest.join(". ").slice(0, LONG_TEXT_MAX);
    if (note && NOTE_KIND_FIELDS[input.kind].includes("note")) fields.note = note;
  }
  if (input.unreadReason && short.leftover.length) dropped.push({ field: "note", reason: input.unreadReason });

  return { kind: input.kind, text, fields, quotes, unplaced: merged.unplaced, dropped, saidBy, usedAi: !!input.usedAi };
}
