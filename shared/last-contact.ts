// A deal's last contact (crm_deals.last_interaction, written by the app's
// reading of emails and meetings). One rule for the deal page and the Deals
// table: a date in the past is the last contact; a date AHEAD is an upcoming
// meeting or email, shown as "Next", never as a minus number of days
// (Woody, 2026-09-27 on the deal page; 2026-11-13 on the table, "-96d").
//
// The Deals list says where its date came from (GET /api/crm/deals,
// lastContactSource), because most deals have no reading yet (review,
// 2026-11-13): 'read' is the app's reading of emails and meetings; 'event' is
// the latest thing done on the deal (a stage change, heads of terms, a
// document); 'edit' is only the last time the deal was changed, which is not
// a contact at all. An edit date is never drawn as a contact and never
// sorted as one. No source = a stored reading (the deal page, older callers).
export type LastContactSource = "read" | "event" | "edit";

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
export function lastContactSortValue(value: string | Date | null | undefined, source?: LastContactSource | null): Date | null {
  if (!value || source === "edit") return null;
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at);
}

const ukDay = (at: number, withYear: boolean) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "Europe/London" });

// The cell's words and title on the Deals table. kind 'unread' is a deal with
// no contact read yet (only its last edit is known): quiet words, the edit
// date in the title. kind 'activity' is the latest deal event: a real date,
// drawn in a neutral tone because it is not an email or a meeting.
export const NO_CONTACT_READ = "No contact read yet";
export function lastContactCell(value: string | Date | null | undefined, now: number = Date.now(), source?: LastContactSource | null):
  { kind: "none" | "last" | "next" | "unread" | "activity"; label: string; title: string; days: number | null } {
  const r = readLastContact(value, now);
  if (source === "edit") {
    const changed = r.kind === "last" || r.kind === "next" ? ` Deal last changed ${ukDay(r.at, true)}` : "";
    return { kind: "unread", label: NO_CONTACT_READ, title: `No email or meeting read yet.${changed}`, days: null };
  }
  if (r.kind === "none" || r.kind === "text") return { kind: "none", label: "—", title: "", days: null };
  if (r.kind === "next") return { kind: "next", label: `Next: ${ukDay(r.at, false)}`, title: `A meeting or email dated ahead (${ukDay(r.at, true)})`, days: null };
  const d = r.days;
  const label = d === 0 ? "today" : d < 30 ? `${d}d` : d < 365 ? `${Math.round(d / 7)}w` : `${Math.round(d / 365)}y`;
  if (source === "event") {
    return { kind: "activity", label, title: `Latest activity on the deal ${ukDay(r.at, true)} (a stage change, heads of terms or a document). No email or meeting read yet`, days: d };
  }
  return { kind: "last", label, title: `Last contact ${ukDay(r.at, true)}, from the app's reading of emails and meetings`, days: d };
}

// The latest contact that has happened: a date ahead (a meeting booked) is
// never a "last touch" (consistency review, 2026-11-14: brand pages read a
// booked meeting as "-3 days ago").
export function latestPastContact(values: Array<string | Date | null | undefined>, now: number = Date.now()): string | null {
  let best: { at: number; value: string } | null = null;
  for (const v of values) {
    const r = readLastContact(v, now);
    if (r.kind !== "last") continue;
    if (!best || r.at > best.at) best = { at: r.at, value: v instanceof Date ? v.toISOString() : String(v) };
  }
  return best?.value ?? null;
}

// Whole days since a past contact, or null (nothing, unreadable, or ahead).
export function daysSinceContact(value: string | Date | null | undefined, now: number = Date.now()): number | null {
  const r = readLastContact(value, now);
  return r.kind === "last" ? r.days : null;
}

// The short label people boards use beside a contact: "today", "4d", "3w",
// "5mo", "2y"; a date ahead is "Next: 12 Feb", never a minus figure.
export function lastContactShort(value: string | Date | null | undefined, now: number = Date.now()): string | null {
  const r = readLastContact(value, now);
  if (r.kind === "next") return `Next: ${ukDay(r.at, false)}`;
  if (r.kind !== "last") return null;
  const d = r.days;
  if (d < 1) return "today";
  if (d < 7) return `${d}d`;
  if (d < 56) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}
