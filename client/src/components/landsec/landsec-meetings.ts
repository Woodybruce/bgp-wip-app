import type { CalendarMeeting } from "@/components/leasing-viewings-calendar";
import { DIARY_KIND_LABELS, type DiaryData } from "@shared/brand-diary";

// Team calendar rows (GET /api/team-events) as meetings on the Landsec
// calendar: the meetings the BGP account team, the shared ChatBGP mailbox and
// the Landsec mailbox were invited to with someone from Landsec
// (server/client-team-events-sync.ts), and those added for Landsec. The
// server sends a Landsec login only its own company's; BGP staff viewing as
// Landsec are sent BGP's whole diary, so only Landsec's are kept.
// team_events times are London clock times with no zone (the team calendar
// reads them that way too), so the digits are the time: never convert them.
const dayOf = (raw: string) => String(raw).slice(0, 10);
const timeOf = (raw: string) => String(raw).replace(" ", "T").slice(11, 16);

export function landsecMeetings(rows: unknown): CalendarMeeting[] {
  if (!Array.isArray(rows)) return [];
  const out: CalendarMeeting[] = [];
  for (const r of rows as any[]) {
    if (!r || !r.start_time || !/landsec/i.test(String(r.company_name || ""))) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.start_time))) continue;
    const start = new Date(r.start_time).getTime();
    const allDay = !!r.end_time && new Date(r.end_time).getTime() - start >= 24 * 3600_000;
    out.push({
      id: String(r.id),
      title: String(r.title || "Meeting"),
      date: dayOf(r.start_time),
      time: allDay ? null : timeOf(r.start_time),
      endTime: !allDay && r.end_time ? timeOf(r.end_time) : null,
      location: r.location ? String(r.location) : null,
      propertyId: r.property_id ? String(r.property_id) : null,
      propertyName: r.property_name ? String(r.property_name) : null,
      attendees: Array.isArray(r.attendees) ? r.attendees.map(String) : [],
    });
  }
  return out;
}

// The CRM layer on the Landsec calendar (Woody, 2026-11-15: "can we link that
// calendar to or have it overlay the normal team and Landsec calendar?"): the
// dated lines of the Landsec diary (GET /api/landsec/diary), which the server
// has already cut to what this login may see. A booked viewing is left out,
// because the calendar already draws it as a viewing; an undated line (a deal
// waiting, a brief to sign) has no day to sit on and stays in the diary.
const CRM_LABEL: Partial<Record<keyof typeof DIARY_KIND_LABELS, string>> = { crm_action: "CRM action", viewing_followup: "Viewing follow-up" };
export function landsecCrmEntries(diary: DiaryData | null | undefined): CalendarMeeting[] {
  const out: CalendarMeeting[] = [];
  for (const item of diary?.items || []) {
    if (!item.date || item.kind === "viewing_booked") continue;
    out.push({
      id: `crm:${item.id}`, title: item.title, date: item.date, time: null, endTime: null, location: null, propertyId: null, propertyName: null, attendees: [],
      crm: {
        label: CRM_LABEL[item.kind] || DIARY_KIND_LABELS[item.kind], url: item.url, owner: item.owner, companyId: item.brand?.id || null, company: item.brand?.name || null,
        place: [item.scheme?.name, item.unitLabel].filter(Boolean).join(" · ") || null,
        detail: item.kind === "crm_action" ? (item.raisedBy === "client" ? "Your request to BGP" : "From BGP") : null,
      },
    });
  }
  return out;
}
