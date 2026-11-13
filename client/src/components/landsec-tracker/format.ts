// Small shared pieces of the joint agent's Letting Tracker
// (client/src/pages/landsec-tracker.tsx).
import { LETTING_STATUS_LABELS } from "@shared/letting-rules";
import type { DealStatusCode } from "@shared/deal-status";
import { calendarDateValue } from "@shared/calendar-date";
import { VIEWING_OUTCOMES } from "@shared/viewing-workflow";
import type { LettingNoteFields } from "@shared/letting-note";

export const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
export const TRACKER_KEY = ["/api/landsec/tracker"];

// The statuses a unit can be moved to from the Edit unit form, in order.
export const UNIT_STATUS_OPTIONS: DealStatusCode[] = ["AVA", "NEG", "HOT", "SOL", "EXC", "COM", "WIT"];
export const LIVE_CODES: DealStatusCode[] = ["OPP", "AVA", "NEG", "HOT", "SOL"];

export const statusLabel = (code: string | null | undefined): string =>
  LETTING_STATUS_LABELS[String(code || "AVA").toUpperCase() as DealStatusCode] || String(code || "");

export const todayIso = (): string => new Date().toLocaleDateString("en-CA");

// "2026-11-12" as "12 Nov" (the year only when it is not this one).
export function shortDay(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "numeric" as const } : {}) }).replace(/\bSept\b/, "Sep");
}

export const money = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? "" : `£${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

export const sqftText = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? "" : `${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })} sq ft`;

// A typed number ("95,000", "£95000") as a number, null when blank, NaN when
// it is not a number.
export function typedNumber(v: string): number | null {
  const s = v.replace(/[£,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// apiRequest throws "409: the server's message": the message without the code.
export const serverMessage = (e: unknown, fallback: string): string =>
  (e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "") || fallback;

// What the working dialogs are given for a unit.
export interface TrackerUnitRef { id: string; unitName: string; propertyId: string }

// "Paste a note" on the joint agent's forms (Woody, 2026-11-13). A read note
// fills a form and saves nothing; these turn what was read into what the
// forms hold. The forms here take typed names: no contact id, agent id or
// firm id is ever taken from a reading.
export const noteText = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const noteDay = (v: unknown): string | null => (typeof v === "string" && calendarDateValue(v) === v ? v : null);
export const noteTime = (v: unknown): string | null => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
// A figure as the forms hold it (plain digits), null when the note gave none.
export const noteFigure = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? String(v) : null);
// The note added after what the box already holds, once: on a new line in a
// comments box, on the same line in a one-line note.
export const withNote = (had: string, note: string, oneLine = false): string => {
  const extra = oneLine ? note.replace(/\s+/g, " ").trim() : note.trim();
  if (!extra || had.includes(extra)) return had;
  return had.trim() ? `${had.trim()}${oneLine ? " " : "\n"}${extra}` : extra;
};
// The brand a reading names: its name, with an id only when the reading
// carries one (the reader gives a joint agent an id only for a brand already
// named on the unit) and, where a form may link only certain brands, only
// when it is one of those.
export function noteBrand(fields: LettingNoteFields | null | undefined, allowed?: { id: string; name: string }[]): { id: string | null; name: string } | null {
  const id = typeof fields?.brandId === "string" && fields.brandId ? fields.brandId : null;
  const known = id && allowed ? allowed.find(b => b.id === id) : undefined;
  const name = noteText(fields?.brandName, 200) || known?.name || "";
  if (!name) return null;
  return { id: id && (!allowed || known) ? id : null, name };
}
// The outcome a reading gives, as one of the choices on the form.
export function noteOutcome(v: unknown): string | null {
  const said = noteText(v, 200).toLowerCase();
  if (!said) return null;
  if (/^no[\s-]?show$/.test(said)) return "No Show";
  return VIEWING_OUTCOMES.find(o => o.toLowerCase() === said) || null;
}
