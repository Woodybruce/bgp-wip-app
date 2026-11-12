// Small helpers for the transaction recommendation workspace: how a term is
// shown and typed, and the working copy the form edits.
import { parseMoney } from "@shared/unit-brief";
import {
  RECOMMENDATION_COMMENTARY, RECOMMENDATION_TERM_FIELDS,
  type RecommendationCommentaryKey, type RecommendationComparable, type RecommendationOption,
  type RecommendationTermKey, type RecommendationWorkspace,
} from "@shared/unit-recommendation";

export type TermField = (typeof RECOMMENDATION_TERM_FIELDS)[number];

export const TONE_BAD = "text-destructive";
export const SECTION = "min-w-0 space-y-3 rounded-lg border p-3 sm:p-4";
export const SECTION_TITLE = "text-sm font-semibold";
export const FIGURE = "font-mono tabular-nums";

export const has = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";
const plain = (n: number): string => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
// "£95,000"
export const money = (n: number | null | undefined): string => (n === null || n === undefined ? "" : `£${plain(n)}`);
// "£42.00"
export const psf = (n: number | null | undefined): string => (n === null || n === undefined ? "" : `£${n.toFixed(2)}`);
export const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// A term as a person reads it: "£110,000", "2,450 sq ft", "6 months".
export function termDisplay(f: TermField, v: unknown): string {
  if (!has(v)) return "";
  if (f.kind === "money") return money(Number(v));
  if (f.kind === "number") {
    const n = Number(v);
    if (f.key === "areaSqFt") return `${plain(n)} sq ft`;
    if (f.key === "turnoverPct") return `${plain(n)}%`;
    if (f.key === "rentFreeMonths") return `${plain(n)} ${n === 1 ? "month" : "months"}`;
    if (f.key === "termYears") return `${plain(n)} ${n === 1 ? "year" : "years"}`;
    return plain(n);
  }
  return String(v).trim();
}

// A term as it sits in its input: "110,000" for money, "6" for a number.
export function termInput(f: TermField, v: unknown): string {
  if (!has(v)) return "";
  if (f.kind === "money") return plain(Number(v));
  return String(v);
}

// A plain number typed into a box: a number, null when blank, undefined when it is neither.
export function parseNumber(v: string): number | null | undefined {
  const s = v.trim().replace(/,/g, "").replace(/%$/, "");
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : undefined;
}
// What is wrong with a typed figure, in words; null when it will do.
export function figureError(kind: "money" | "number", v: string, max?: number): string | null {
  if (!v.trim()) return null;
  const n = kind === "money" ? parseMoney(v) : parseNumber(v);
  if (n === undefined) return kind === "money" ? "An amount in pounds, like 95000 or £95,000" : "A number";
  if (n !== null && n < 0) return "Cannot be less than 0";
  if (n !== null && max !== undefined && n > max) return `Cannot be more than ${plain(max)}`;
  return null;
}
export const TERM_NUMBER_MAX: Partial<Record<RecommendationTermKey, number>> = { areaSqFt: 10_000_000, turnoverPct: 100, rentFreeMonths: 600, termYears: 999 };
export const TERM_TEXT_MAX = 300;
export const LONG_TEXT_MAX = 4000;
export const SUMMARY_MAX = 3000;
export const DECISION_COMMENT_MAX = 2000;
export const COMPARABLES_MAX = 20;

// The working copy the form edits: every box as the text in it.
export interface RecommendationDraft {
  terms: Record<RecommendationTermKey, string>;
  commentary: Record<RecommendationCommentaryKey, string>;
  recommendation: RecommendationOption | null;
  summary: string;
  comparables: RecommendationComparable[];
}

export function draftOf(ws: RecommendationWorkspace): RecommendationDraft {
  const terms = {} as Record<RecommendationTermKey, string>;
  for (const f of RECOMMENDATION_TERM_FIELDS) terms[f.key] = termInput(f, ws.terms[f.key]);
  const commentary = {} as Record<RecommendationCommentaryKey, string>;
  for (const c of RECOMMENDATION_COMMENTARY) commentary[c.key] = ws.commentary[c.key] || "";
  return { terms, commentary, recommendation: ws.recommendation, summary: ws.summary || "", comparables: ws.comparables };
}

export const sameDraft = (a: RecommendationDraft, b: RecommendationDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

// What a save sends: only what changed. A cleared box goes as null.
export function patchOf(base: RecommendationDraft, draft: RecommendationDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const terms: Record<string, string | null> = {};
  for (const f of RECOMMENDATION_TERM_FIELDS) if (draft.terms[f.key] !== base.terms[f.key]) terms[f.key] = draft.terms[f.key].trim() || null;
  if (Object.keys(terms).length) body.terms = terms;
  const commentary: Record<string, string | null> = {};
  for (const c of RECOMMENDATION_COMMENTARY) if (draft.commentary[c.key] !== base.commentary[c.key]) commentary[c.key] = draft.commentary[c.key].trim() || null;
  if (Object.keys(commentary).length) body.commentary = commentary;
  if (draft.recommendation !== base.recommendation) body.recommendation = draft.recommendation;
  if (draft.summary !== base.summary) body.summary = draft.summary.trim() || null;
  if (JSON.stringify(draft.comparables) !== JSON.stringify(base.comparables)) body.comparables = draft.comparables;
  return body;
}

// What is wrong with the working copy, by box.
export function draftErrors(draft: RecommendationDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of RECOMMENDATION_TERM_FIELDS) {
    const v = draft.terms[f.key];
    const e = f.kind === "money" || f.kind === "number" ? figureError(f.kind, v, f.kind === "number" ? TERM_NUMBER_MAX[f.key] : undefined)
      : v.trim().length > (f.kind === "longtext" ? LONG_TEXT_MAX : TERM_TEXT_MAX) ? `Too long: the limit is ${plain(f.kind === "longtext" ? LONG_TEXT_MAX : TERM_TEXT_MAX)} characters` : null;
    if (e) out[`term:${f.key}`] = e;
  }
  for (const c of RECOMMENDATION_COMMENTARY) if (draft.commentary[c.key].trim().length > LONG_TEXT_MAX) out[`commentary:${c.key}`] = `Too long: the limit is ${plain(LONG_TEXT_MAX)} characters`;
  if (draft.summary.trim().length > SUMMARY_MAX) out.summary = `Too long: the limit is ${plain(SUMMARY_MAX)} characters`;
  return out;
}

export const newComparableId = (): string => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// "2026-03-25" or "2026-03", and a real date.
export function validComparableDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = m[3] ? Number(m[3]) : 1;
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
// "25 Mar 2026", or "Mar 2026" for a month.
export function comparableDate(v: string | null): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (!m) return v;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
  return dt.toLocaleDateString("en-GB", m[3] ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" });
}
