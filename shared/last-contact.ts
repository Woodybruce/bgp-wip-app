// A deal's last contact (crm_deals.last_interaction, written by the app's
// reading of emails and meetings). One rule for the deal page and the Deals
// table: a date in the past is the last contact; a date AHEAD is an upcoming
// meeting or email, shown as "Next", never as a minus number of days
// (Woody, 2026-09-27 on the deal page; 2026-11-13 on the table, "-96d").
export type LastContact =
  | { kind: "none" }
  | { kind: "text"; text: string }               // not a date: shown as written
  | { kind: "last"; at: number; days: number }   // whole days ago, never negative
  | { kind: "next"; at: number };

export function readLastContact(value: string | Date | null | undefined, now: number = Date.now()): LastContact {
  if (!value) return { kind: "none" };
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(at)) return { kind: "text", text: String(value) };
  if (at > now) return { kind: "next", at };
  return { kind: "last", at, days: Math.max(0, Math.round((now - at) / 86400000)) };
}

// What a sort on the column compares: the date itself, so a date ahead is the
// newest of all; nothing for a deal with no readable date (those sort last).
export function lastContactSortValue(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at);
}

const ukDay = (at: number, withYear: boolean) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "Europe/London" });

// The cell's words and title on the Deals table.
export function lastContactCell(value: string | Date | null | undefined, now: number = Date.now()): { kind: "none" | "last" | "next"; label: string; title: string; days: number | null } {
  const r = readLastContact(value, now);
  if (r.kind === "none" || r.kind === "text") return { kind: "none", label: "—", title: "", days: null };
  if (r.kind === "next") return { kind: "next", label: `Next: ${ukDay(r.at, false)}`, title: `A meeting or email dated ahead (${ukDay(r.at, true)})`, days: null };
  const d = r.days;
  const label = d === 0 ? "today" : d < 30 ? `${d}d` : d < 365 ? `${Math.round(d / 7)}w` : `${Math.round(d / 365)}y`;
  return { kind: "last", label, title: `Last contact ${ukDay(r.at, true)}, from the app's reading of emails and meetings`, days: d };
}
