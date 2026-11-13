// How the negotiation log writes its figures and dates: money as "£95,000",
// dates as "12 Nov 2026".
import { formatCalendarDate } from "@shared/calendar-date";
import { ROUND_TERM_FIELDS, type OfferStatus, type RoundTerms } from "@shared/unit-negotiation";

export type TermField = (typeof ROUND_TERM_FIELDS)[number];

export const isBlank = (v: unknown): boolean => v === null || v === undefined || v === "";

export const fmtMoney = (n: number): string => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

// A calendar day (yyyy-mm-dd) as "12 Nov 2026".
export const fmtDay = (d: string | null | undefined): string => formatCalendarDate(d) || d || "";

// The same day without its year when it is this year: "12 Nov".
export const fmtShortDay = (d: string | null | undefined): string => {
  const full = formatCalendarDate(d);
  if (!full) return d || "";
  return d && d.slice(0, 4) === String(new Date().getFullYear()) ? full.replace(/\s\d{4}$/, "") : full;
};

// A moment (ISO timestamp) as "12 Nov 2026".
export const fmtStamp = (d: string | null | undefined): string => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep");
};

// One term as it reads in the log. Blank terms read as "".
export function fmtTerm(f: TermField, v: number | string | null | undefined): string {
  if (isBlank(v)) return "";
  if (f.kind === "text") return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (f.kind === "money") return fmtMoney(n);
  const text = n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return f.key === "turnoverRentPct" ? `${text}%` : text;
}

// Which way a figure moved between two positions: 1 up, -1 down, 0 neither
// (text terms, or a figure that was added or removed).
export function direction(f: TermField, prev: RoundTerms | null, next: RoundTerms): 1 | -1 | 0 {
  if (!prev || f.kind === "text") return 0;
  const a = prev[f.key], b = next[f.key];
  if (isBlank(a) || isBlank(b)) return 0;
  const x = Number(a), y = Number(b);
  return y > x ? 1 : y < x ? -1 : 0;
}

// The terms worth a column or a line: those with a value in any position.
export const termsInUse = (positions: RoundTerms[]): TermField[] =>
  ROUND_TERM_FIELDS.filter(f => positions.some(p => !isBlank(p[f.key])));

// Token tones for the status chip. Agreed is the filled one.
export const statusTone = (status: OfferStatus): string =>
  status === "Agreed" ? "bg-foreground text-background border border-transparent"
    : status === "Negotiating" ? "border border-foreground/40 text-foreground"
    : status === "Rejected" ? "border border-destructive/50 text-destructive"
    : "border border-border text-muted-foreground";

// Two tones so the eye can follow whose move each round was.
export const partyTone = (party: string): string =>
  party === "landlord" ? "bg-foreground text-background border border-transparent" : "bg-secondary text-secondary-foreground border border-transparent";

// apiRequest throws "409: the server's message".
export const serverMessage = (e: unknown, fallback: string): string =>
  (e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "") || fallback;
export const statusOf = (e: unknown): number => {
  const m = e instanceof Error ? e.message.match(/^(\d{3}):/) : null;
  return m ? Number(m[1]) : 0;
};
