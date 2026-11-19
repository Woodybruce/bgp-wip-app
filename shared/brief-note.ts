// A plain note read into a unit's Targeting Brief (Woody, 2026-11-19: "brief
// form needs our type and populate tool"). The person types or pastes the
// brief, or the client's email about it; the reader fills the Brief and
// Commercials boxes on the screen; nothing is saved until they press Save, so
// the form itself is the check. This file is the contract and the checks; the
// reader is server/brief-note-reader.ts.
//
// What may fill a box:
// - A text box (objective, criteria, instruction, deliverables, the text
//   commercials) takes the note's own words: a span of the note, or a lightly
//   joined version of which at least 80% of the longer words are the note's.
// - The title is the reader's short wording, kept when most of its words are
//   the note's (the CRM forms' rule, titleFromNote).
// - The client is a name the note gives, word for word.
// - A date comes with the words it was read from, which must be in the note
//   and carry that date (the CRM forms' rule, dateFromNote).
// - A count and every figure come with the words they were read from, which
//   must be in the note and hold the figure: money a year, rent free in
//   months, a lease in years, turnover rent as a percentage.
// - Money is a year's: words that make a figure a month's or a square foot's
//   ("pcm", "psf") send it back to the person, never into a box.
// - A priority category is one on the unit's category list, with words of
//   the note that ask for it.
// Anything that fails is listed back with the reason, never filled.
import { dateFromNote, titleFromNote } from "./crm-note";
import { BRIEF_COMMERCIAL_FIELDS, BRIEF_FIGURE_MAX, type BriefCommercials } from "./unit-brief";

export const BRIEF_NOTE_MAX = 8000;

// The Brief tab's boxes the reader may fill, in form order (the dialog's keys).
export const BRIEF_NOTE_TEXT_FIELDS = [
  { key: "objective", label: "Objective" },
  { key: "locationContext", label: "Location / adjacency context" },
  { key: "targetCriteria", label: "Target operator criteria" },
  { key: "agentInstruction", label: "Agent instruction" },
  { key: "successMeasures", label: "Success measures" },
  { key: "deadline1Deliverables", label: "Deadline 1 deliverables" },
  { key: "deadline2Deliverables", label: "Deadline 2 deliverables" },
] as const;
export const BRIEF_NOTE_DATE_FIELDS = [
  { key: "instructedDate", label: "Instructed date" },
  { key: "deadline1Date", label: "Deadline 1" },
  { key: "deadline2Date", label: "Deadline 2" },
] as const;
export const BRIEF_NOTE_COUNT_FIELDS = [
  { key: "minTargets", label: "Targets wanted" },
  { key: "priorityTargets", label: "Priority A wanted" },
] as const;

export type BriefNoteFieldKey =
  | "title" | "clientCompany"
  | (typeof BRIEF_NOTE_TEXT_FIELDS)[number]["key"]
  | (typeof BRIEF_NOTE_DATE_FIELDS)[number]["key"]
  | (typeof BRIEF_NOTE_COUNT_FIELDS)[number]["key"];

export interface BriefNoteReading {
  /** The Brief tab's boxes as the dialog holds them: text, dates as yyyy-mm-dd, counts as digits. */
  fields: Partial<Record<BriefNoteFieldKey, string>>;
  /** Priority categories from the unit's list, added to those already chosen. */
  categories: string[];
  /** True when the list was Landsec's agency brief categories (a Landsec scheme), so the dialog splits them the same way. */
  landsecCategories: boolean;
  /** The Commercials boxes as the dialog holds them (figures as digits). */
  commercials: Partial<Record<keyof BriefCommercials, string>>;
  /** Plain labels of what was filled on the Brief tab, in form order. */
  filled: string[];
  /** Plain labels of what was filled on the Commercials tab. */
  filledCommercials: string[];
  /** What the reader found that failed a check, with the reason: for the person to add by hand. */
  notPlaced: string[];
}

export interface BriefNoteContext {
  text: string;
  today: string; // yyyy-mm-dd, London
  /** The categories this unit's brief takes (the BGP taxonomy, or Landsec's agency brief list). */
  taxonomy: readonly string[];
  landsecCategories?: boolean;
}

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s: unknown) => squash(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const inNote = (note: string, span: unknown) => { const q = plain(span); return q.length >= 2 && plain(note).includes(q); };
const shortQuote = (s: unknown) => { const q = squash(s); return q.length > 60 ? `${q.slice(0, 57)}…` : q; };
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

const STOP = new Set([
  "with", "from", "that", "this", "these", "those", "into", "their", "them", "they", "there", "have", "will", "would", "should",
  "could", "about", "over", "more", "most", "each", "also", "than", "then", "been", "being", "which", "while", "where", "when",
  "what", "your", "ours", "some", "such", "only", "very", "must", "unit", "brief", "client", "letting",
]);

/** A text box's value: a span of the note, or wording of which at least 80% of the longer words are the note's own. */
export function textFromNote(value: unknown, note: string, max = 2000): string | null {
  const t = squash(value).slice(0, max);
  if (t.length < 2) return null;
  if (inNote(note, t)) return t;
  const words = t.toLowerCase().match(/[a-z0-9&']{4,}/g)?.filter(w => !STOP.has(w)) || [];
  if (words.length < 3) return null;
  const hay = plain(note);
  const own = words.filter(w => hay.includes(w.replace(/(?:ing|ed|es|s)$/, ""))).length;
  return own / words.length >= 0.8 ? t : null;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const NUMBER_WORD_RE = NUMBER_WORDS.join("|");
const asNumber = (raw: string) => {
  const w = NUMBER_WORDS.indexOf(raw.toLowerCase());
  return w >= 0 ? w : Number(raw.replace(/,/g, ""));
};
const toNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[£,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** A count (targets wanted, priority A wanted): a whole number the quoted words of the note hold, in digits or words. */
export function countFromNote(value: unknown, quote: unknown, note: string): number | null {
  const n = toNumber(value);
  if (n === null || !Number.isInteger(n) || n < 0 || n > 100 || !inNote(note, quote)) return null;
  const found = [...plain(quote).matchAll(new RegExp(`(?:^|[^a-z\\d.,])(\\d{1,3}|${NUMBER_WORD_RE})(?![a-z\\d]|[.,]\\d)`, "g"))].map(m => asNumber(m[1]));
  return found.some(f => same(f, n)) ? n : null;
}

// A month's, a week's, a square foot's or a square metre's figure: never a year's.
const NOT_A_YEAR_RE = /\b(?:pcm|p\.c\.m|per\s+(?:calendar\s+)?month|a\s+month|monthly|per\s+week|a\s+week|weekly|pw|psf|p\.s\.f|per\s+sq(?:uare)?\.?\s*f(?:oo|ee)?t|per\s+square\s+(?:foot|feet|metre|meter)|psm|per\s+sq\.?\s*m)\b|£\s*\d[\d,.]*\s*\/\s*(?:sq|ft|m)/i;

/** The money figures a phrase holds: "£95,000", "95k", "£1.2m", "1.25 million". */
export function moneyFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of plain(text).matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(k|m|mn|million|thousand|bn|billion)(?![a-z]))?/g)) {
    const base = Number(m[1].replace(/,/g, ""));
    const unit = m[2] || "";
    const mult = unit === "k" || unit === "thousand" ? 1_000 : unit === "m" || unit === "mn" || unit === "million" ? 1_000_000 : unit === "bn" || unit === "billion" ? 1_000_000_000 : 1;
    if (Number.isFinite(base)) out.push(base * mult);
  }
  return out;
}

/** Numbers in a phrase that stand right before one of the units (months, years, per cent), in digits or words. */
function numbersBefore(text: string, unit: string): number[] {
  const re = new RegExp(`(?:^|[^a-z\\d.])(\\d+(?:\\.\\d+)?|${NUMBER_WORD_RE})\\s*-?\\s*(?:${unit})(?![a-z])`, "g");
  return [...plain(text).matchAll(re)].map(m => asNumber(m[1]));
}

export type FigureCheck = { ok: true; value: number } | { ok: false; why: string };

/** One Commercials figure, checked against the words it was read from. */
export function figureFromNote(kind: "money" | "number" | "percent", key: keyof BriefCommercials, value: unknown, quote: unknown, note: string): FigureCheck {
  const n = toNumber(value);
  if (n === null || n < 0 || n > BRIEF_FIGURE_MAX) return { ok: false, why: "not a figure" };
  if (!inNote(note, quote)) return { ok: false, why: "the words it was read from are not in the note" };
  const q = String(quote);
  if (kind === "money") {
    if (NOT_A_YEAR_RE.test(q)) return { ok: false, why: `“${shortQuote(q)}” is not a figure for a year: work it out and type it in` };
    return moneyFigures(q).some(f => same(f, n)) ? { ok: true, value: n } : { ok: false, why: `“${shortQuote(q)}” does not hold ${n.toLocaleString("en-GB")}` };
  }
  if (kind === "percent") {
    return numbersBefore(q, "%|per\\s*cent|percent").some(f => same(f, n)) ? { ok: true, value: n } : { ok: false, why: `“${shortQuote(q)}” does not give ${n}%` };
  }
  // Counted figures: rent free in months, the lease in years.
  const unit = key === "rentFreeMonthsMax" ? "months?|mths?|mos?|m" : key === "leaseTermYears" ? "years?|yrs?|y" : null;
  if (!unit) return { ok: false, why: "not a figure this box takes" };
  return numbersBefore(q, unit).some(f => same(f, n)) ? { ok: true, value: n }
    : { ok: false, why: `“${shortQuote(q)}” does not give ${n} ${key === "rentFreeMonthsMax" ? "months" : "years"}` };
}

const shortCategory = (c: string) => c.replace(/^Tenant\s*-\s*/i, "");

/** The unit's list entry a category name means, by its full or short name. */
export function categoryOnList(name: unknown, taxonomy: readonly string[]): string | null {
  const key = plain(name);
  if (!key) return null;
  return taxonomy.find(c => plain(c) === key) || taxonomy.find(c => plain(shortCategory(c)) === plain(shortCategory(String(name)))) || null;
}

/** The reader's answer, checked. Nothing here is saved: it fills a form a person then reads. */
export function checkBriefNote(answer: unknown, ctx: BriefNoteContext): BriefNoteReading {
  const note = squash(ctx.text).slice(0, BRIEF_NOTE_MAX);
  const a = isObject(answer) ? answer : {};
  const out: BriefNoteReading = { fields: {}, categories: [], landsecCategories: !!ctx.landsecCategories, commercials: {}, filled: [], filledCommercials: [], notPlaced: [] };
  const miss = (label: string, why: string) => out.notPlaced.push(`${label}: ${why}`);
  const given = (v: unknown) => v !== null && v !== undefined && v !== "" && !(isObject(v) && Object.values(v).every(x => x === null || x === undefined || x === ""));

  if (given(a.title)) {
    const title = titleFromNote(a.title, note, 160);
    if (title) { out.fields.title = title; out.filled.push("Title"); } else miss("Title", "its words are not the note's");
  }
  if (given(a.clientCompany)) {
    const client = squash(a.clientCompany).slice(0, 200);
    if (inNote(note, client)) { out.fields.clientCompany = client; out.filled.push("Client"); } else miss("Client", `“${shortQuote(client)}” is not how the note names them`);
  }
  for (const f of BRIEF_NOTE_TEXT_FIELDS) {
    if (!given(a[f.key])) continue;
    const text = textFromNote(a[f.key], note);
    if (text) { out.fields[f.key] = text; out.filled.push(f.label); } else miss(f.label, "not in the note's own words");
  }

  for (const c of Array.isArray(a.priorityCategories) ? a.priorityCategories.slice(0, 20) : []) {
    const name = squash(isObject(c) ? c.name : c);
    if (!name) continue;
    const onList = categoryOnList(name, ctx.taxonomy);
    if (!onList) { miss("Priority category", `“${shortQuote(name)}” is not on this brief's category list`); continue; }
    if (!isObject(c) || !inNote(note, c.quote)) { miss("Priority category", `${shortCategory(onList)}: the note does not ask for it`); continue; }
    if (!out.categories.includes(onList)) out.categories.push(onList);
  }
  if (out.categories.length) out.filled.push(out.categories.length === 1 ? "Priority category" : "Priority categories");

  for (const f of BRIEF_NOTE_DATE_FIELDS) {
    const raw = a[f.key];
    if (!given(raw)) continue;
    const day = isObject(raw) ? dateFromNote(raw.date, raw.quote, note, ctx.today) : null;
    if (day) { out.fields[f.key] = day; out.filled.push(f.label); }
    else miss(f.label, isObject(raw) && raw.quote ? `“${shortQuote(raw.quote)}” does not give that date` : "the note gives no date for it");
  }
  for (const f of BRIEF_NOTE_COUNT_FIELDS) {
    const raw = a[f.key];
    if (!given(raw)) continue;
    const n = isObject(raw) ? countFromNote(raw.value, raw.quote, note) : null;
    if (n !== null) { out.fields[f.key] = String(n); out.filled.push(f.label); }
    else miss(f.label, isObject(raw) && raw.quote ? `“${shortQuote(raw.quote)}” does not give that number` : "the note gives no number for it");
  }

  const commercials = isObject(a.commercials) ? a.commercials : {};
  for (const f of BRIEF_COMMERCIAL_FIELDS) {
    const raw = commercials[f.key];
    if (!given(raw)) continue;
    if (f.kind === "text" || f.kind === "longtext") {
      const text = textFromNote(isObject(raw) ? raw.value : raw, note, f.kind === "longtext" ? 2000 : 300);
      if (text) { out.commercials[f.key] = text; out.filledCommercials.push(f.label); } else miss(f.label, "not in the note's own words");
      continue;
    }
    const r = isObject(raw) ? figureFromNote(f.kind, f.key, raw.value, raw.quote, note) : { ok: false as const, why: "no words given for it" };
    if (r.ok) { out.commercials[f.key] = String(r.value); out.filledCommercials.push(f.label); } else miss(f.label, r.why);
  }
  return out;
}
