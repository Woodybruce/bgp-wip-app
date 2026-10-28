import type { EngagementEvent } from "@shared/crm-engagement";

export const CRM_ENGAGEMENT_KEY = "/api/crm/engagement";
export const LONDON = "Europe/London";
export const GUEST_LABELS = { suggested: "Suggested", invited: "Invited", accepted: "Accepted", declined: "Declined", attended: "Attended", no_show: "Did not attend" } as const;
export const EVENT_LABELS = { draft: "Draft", planned: "Planned", cancelled: "Cancelled", completed: "Completed" } as const;

export function londonDay(value: string | Date): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function londonDateTimeInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${londonDay(d)}T${time}`;
}

// datetime-local deliberately represents London time, regardless of the
// device's timezone. Reject the spring clock-change gap instead of moving it.
export function londonInputToIso(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a valid date and time.");
  const nominal = new Date(`${value}:00Z`).getTime();
  for (const offset of [60, 0]) {
    const candidate = new Date(nominal - offset * 60_000);
    if (Number.isFinite(candidate.getTime()) && londonDateTimeInput(candidate.toISOString()) === value) return candidate.toISOString();
  }
  throw new Error("That time does not exist in London because the clocks change. Please choose another time.");
}

export function eventDate(value: string | null, withTime = true): string {
  if (!value) return "Date to confirm";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON, day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date) : "Date to confirm";
}

export function monthDays(month: string): string[] {
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => new Date(first.getTime() + index * 86400_000).toISOString().slice(0, 10));
}
export function moveMonth(month: string, amount: number): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0, 7);
}
export function eventOccursOn(event: EngagementEvent, day: string): boolean {
  if (!event.dateConfirmed || !event.startsAt || event.status === "cancelled") return false;
  const start = londonDay(event.startsAt);
  // An event ending exactly at midnight does not occupy the following day.
  const end = event.endsAt ? londonDay(new Date(new Date(event.endsAt).getTime() - 1)) : start;
  return start <= day && day <= (end < start ? start : end);
}
export function eventMatchesCompany(event: EngagementEvent, companyId: string): boolean {
  return !companyId || event.companies.some(c => c.companyId === companyId) || event.guests.some(g => g.companyId === companyId);
}
