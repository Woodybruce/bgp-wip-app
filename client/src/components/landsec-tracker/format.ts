// Small shared pieces of the joint agent's Letting Tracker
// (client/src/pages/landsec-tracker.tsx).
import { LETTING_STATUS_LABELS } from "@shared/letting-rules";
import type { DealStatusCode } from "@shared/deal-status";

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
