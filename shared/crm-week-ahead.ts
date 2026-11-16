// The CRM week (Woody, 2026-11-16: "merge CRM meetings with the events
// calendar ... overlay for the week", and "the directors then want a summary
// of those meetings emailed to them on a monday morning"). The meetings are
// the ones read from BGP diaries for CRM Meetings; the events are the CRM's
// own confirmed events. These rules are shared by the calendar on the CRM
// Overview and by Monday's email, so both show the same week.
import type { LandlordMeeting, LandlordMeetingCoverage } from "./landlord-meetings";

const LONDON = "Europe/London";

export interface WeekMeeting {
  key: string;
  start: string;
  end: string;
  subject: string;
  location: string;
  webLink: string | null;
  companies: Array<{ id: string; name: string }>;
  bgp: string[];
  others: string[];
}

export interface WeekEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  ownerName: string | null;
  companies: string[];
}

export interface WeekAhead {
  week: { start: string; end: string };
  meetings: WeekMeeting[];
  events: WeekEvent[];
  coverage: LandlordMeetingCoverage;
}

// One diary entry that matches two landlords comes back once per landlord.
// It is one meeting: one line, with both names.
export function groupWeekMeetings(meetings: LandlordMeeting[]): WeekMeeting[] {
  const byKey = new Map<string, WeekMeeting>();
  for (const meeting of meetings) {
    const key = meeting.id.startsWith(`${meeting.companyId}:`) ? meeting.id.slice(meeting.companyId.length + 1) : meeting.id;
    const found = byKey.get(key);
    if (found) {
      if (!found.companies.some(company => company.id === meeting.companyId)) found.companies.push({ id: meeting.companyId, name: meeting.companyName });
      continue;
    }
    const bgpEmails = new Set(meeting.bgpParticipants.map(person => person.email.toLowerCase()));
    byKey.set(key, {
      key, start: meeting.start, end: meeting.end, subject: meeting.subject, location: meeting.location, webLink: meeting.webLink,
      companies: [{ id: meeting.companyId, name: meeting.companyName }],
      bgp: meeting.bgpParticipants.map(person => person.name || person.email),
      others: meeting.participants.filter(person => !bgpEmails.has(person.email.toLowerCase())).map(person => person.name || person.email),
    });
  }
  return [...byKey.values()].sort((a, b) => a.start.localeCompare(b.start) || a.companies[0].name.localeCompare(b.companies[0].name));
}

export function londonDayOf(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function londonTimeOf(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) : "";
}

// The Monday of the London week a day falls in, as yyyy-mm-dd.
export function mondayOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function weekDaysFrom(monday: string): string[] {
  const first = new Date(`${monday}T12:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, index) => new Date(first + index * 86400_000).toISOString().slice(0, 10));
}

export function moveWeek(monday: string, amount: number): string {
  return new Date(new Date(`${monday}T12:00:00Z`).getTime() + amount * 7 * 86400_000).toISOString().slice(0, 10);
}

const longDay = (day: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
const shortDay = (day: string, year = false) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) }).format(new Date(`${day}T12:00:00Z`));

export function weekLabel(monday: string): string {
  const days = weekDaysFrom(monday);
  return `${shortDay(days[0])} to ${shortDay(days[6], true)}`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function weekAheadSubject(week: WeekAhead): string {
  const monday = londonDayOf(week.week.start);
  return `CRM week ahead: ${count(week.meetings.length, "landlord meeting", "landlord meetings")}, ${count(week.events.length, "event", "events")} (${weekLabel(monday)})`;
}

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function names(list: string[], limit: number): string {
  const shown = list.slice(0, limit).map(esc).join(", ");
  return list.length > limit ? `${shown} and ${list.length - limit} more` : shown;
}

// The email's body. Names and subjects come from diaries, so every one is
// escaped; the only links are to the app's own pages.
export function weekAheadHtml(week: WeekAhead, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const monday = londonDayOf(week.week.start);
  const ink = "#1a1a1a", muted = "#6b6b6b", rule = "#e3ddd8", accent = "#6E0C25";
  const dayBlocks = weekDaysFrom(monday).map(day => {
    const lines: Array<{ at: string; html: string }> = [];
    for (const meeting of week.meetings) {
      if (londonDayOf(meeting.start) !== day) continue;
      const who = meeting.companies.map(company => `<a href="${base}/companies/${encodeURIComponent(company.id)}" style="color:${accent};text-decoration:none;font-weight:bold">${esc(company.name)}</a>`).join(" and ");
      const detail = [
        meeting.bgp.length ? `BGP: ${names(meeting.bgp, 6)}` : "",
        meeting.others.length ? `With: ${names(meeting.others, 6)}` : "",
        meeting.location ? esc(meeting.location) : "",
      ].filter(Boolean).join(" &middot; ");
      lines.push({ at: meeting.start, html: `<tr><td style="padding:6px 12px 6px 0;width:52px;vertical-align:top;white-space:nowrap;font-family:Consolas,Menlo,monospace;font-size:13px;color:${ink}">${londonTimeOf(meeting.start)}</td><td style="padding:6px 0;vertical-align:top;font-size:14px;color:${ink}">${who}: ${esc(meeting.subject || "Meeting")}${detail ? `<br><span style="font-size:12px;color:${muted}">${detail}</span>` : ""}</td></tr>` });
    }
    for (const event of week.events) {
      if (londonDayOf(event.startsAt) !== day) continue;
      const detail = [
        event.companies.length ? `For: ${names(event.companies, 6)}` : "",
        event.ownerName ? `Owner: ${esc(event.ownerName)}` : "",
        event.location ? esc(event.location) : "",
      ].filter(Boolean).join(" &middot; ");
      lines.push({ at: event.startsAt, html: `<tr><td style="padding:6px 12px 6px 0;width:52px;vertical-align:top;white-space:nowrap;font-family:Consolas,Menlo,monospace;font-size:13px;color:${ink}">${londonTimeOf(event.startsAt)}</td><td style="padding:6px 0;vertical-align:top;font-size:14px;color:${ink}"><span style="font-size:11px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:${muted}">CRM event</span> <a href="${base}/contacts?tab=overview&amp;event=${encodeURIComponent(event.id)}" style="color:${accent};text-decoration:none;font-weight:bold">${esc(event.title)}</a>${detail ? `<br><span style="font-size:12px;color:${muted}">${detail}</span>` : ""}</td></tr>` });
    }
    if (!lines.length) return "";
    lines.sort((a, b) => a.at.localeCompare(b.at));
    return `<h3 style="margin:20px 0 4px;padding-bottom:4px;border-bottom:1px solid ${rule};font-size:14px;color:${ink}">${esc(longDay(day))}</h3><table style="border-collapse:collapse;width:100%">${lines.map(line => line.html).join("")}</table>`;
  }).join("");
  const nothing = !week.meetings.length && !week.events.length;
  const coverage = week.coverage;
  const coverageLine = coverage.status === "not_synced"
    ? "BGP diaries have not been read yet, so meetings may be missing."
    : `Meetings are read from ${coverage.mailboxesChecked} of ${coverage.mailboxesExpected} BGP diaries${coverage.status === "partial" ? ". Some diaries are missing or out of date, so this list may be incomplete" : ""}.`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:${ink}">
<h2 style="margin:0 0 4px;font-size:20px;color:${accent}">CRM week ahead</h2>
<p style="margin:0 0 14px;font-size:13px;color:${muted}">${esc(weekLabel(monday))} &middot; London time</p>
<p style="margin:0 0 4px;font-size:14px">${nothing ? "No landlord meetings were found in BGP diaries for this week, and no CRM events are confirmed." : `This week: <strong>${count(week.meetings.length, "landlord meeting", "landlord meetings")}</strong> in BGP diaries and <strong>${count(week.events.length, "confirmed CRM event", "confirmed CRM events")}</strong>.`}</p>
${dayBlocks}
<p style="margin:22px 0 6px;font-size:13px"><a href="${base}/contacts?tab=overview" style="color:${accent}">Open the CRM calendar</a></p>
<p style="margin:0;font-size:12px;color:${muted}">${esc(coverageLine)} A meeting is listed when its invitation names a landlord in the CRM or one of its people. Private diary entries are never included.</p>
</div>`;
}
