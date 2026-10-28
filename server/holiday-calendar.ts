// Approved holiday → all-day Outlook event on the person's calendar, with
// the board and everyone in their team(s) invited (Woody, 2026-10-28:
// "once approved … creates an all day calendar invite to include the
// board and everyone in their team"). Uses the app-only Graph token the
// shared mailbox already runs on; Graph sends the invitations itself when
// an event with attendees is created on a user's calendar.
import { pool } from "./db";
import { graphRequest } from "./shared-mailbox";
import { isPrivateMailboxAddress } from "./private-mail";
import { BOARD_2026, TEAM_ROSTER_2026, rosterTeamsFor, samePerson } from "@shared/teams";

const SHARED_MAILBOX = "chatbgp@brucegillinghampollard.com";

type HolidayRow = {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  days_count: number;
  notes: string | null;
  approved_by: string | null;
};

type StaffUser = { id: string; name: string; email: string; team: string | null; additional_teams: string[] | null };

/** YYYY-MM-DD of the day after the given YYYY-MM-DD (Graph all-day events
 *  end at midnight on the day AFTER the last day). */
function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function longDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The invite list for a person's holiday: the person, the 2026 board and
 *  every roster member of the person's team(s); users.team /
 *  additional_teams when the person isn't on the roster. Active BGP logins
 *  with an email only — no clients, no private mailboxes. */
export async function holidayAttendeesFor(person: StaffUser, staff: StaffUser[]): Promise<{ attendees: StaffUser[]; teams: string[] }> {
  const byName = (n: string) => staff.find(u => samePerson(u.name, n));
  const picked = new Map<string, StaffUser>();
  const add = (u: StaffUser | undefined) => { if (u?.email) picked.set(u.email.toLowerCase(), u); };

  add(person);
  for (const b of BOARD_2026) add(byName(b));

  let teams: string[] = rosterTeamsFor(person.name) || [];
  if (teams.length) {
    for (const r of TEAM_ROSTER_2026) {
      if (r.teams.some(t => teams.includes(t))) add(byName(r.name));
    }
  } else {
    teams = [person.team, ...(person.additional_teams || [])].filter((t): t is string => !!t);
    if (teams.length) {
      for (const u of staff) {
        const theirs = [u.team, ...(u.additional_teams || [])].filter(Boolean) as string[];
        if (theirs.some(t => teams.includes(t))) add(u);
      }
      // Roster members of those teams who are stored under another team
      for (const r of TEAM_ROSTER_2026) {
        if (r.teams.some(t => teams.includes(t))) add(byName(r.name));
      }
    }
  }
  return { attendees: [...picked.values()], teams };
}

async function activeStaff(): Promise<StaffUser[]> {
  const { rows } = await pool.query(
    `SELECT id, name, email, team, additional_teams FROM users
      WHERE is_active = true AND email IS NOT NULL AND email <> ''
        AND COALESCE(role, '') <> 'Client'
        AND email ILIKE '%@brucegillinghampollard.com'`,
  );
  return rows.filter((u: StaffUser) => !isPrivateMailboxAddress(u.email));
}

/** Creates the all-day event and returns its Graph id plus who was
 *  invited. Throws on any failure — the caller has already approved the
 *  request and only reports the calendar outcome. */
export async function createHolidayCalendarEvent(row: HolidayRow): Promise<{ eventId: string; mailbox: string; teams: string[]; attendeeCount: number }> {
  const staff = await activeStaff();
  const person = staff.find(u => u.id === row.user_id)
    || (await pool.query(`SELECT id, name, email, team, additional_teams FROM users WHERE id = $1`, [row.user_id])).rows[0];
  if (!person) throw new Error("Requester not found");
  if (!person.email) throw new Error(`${person.name} has no email address`);

  const approver = row.approved_by
    ? (await pool.query(`SELECT name FROM users WHERE id = $1`, [row.approved_by])).rows[0]?.name
    : null;

  const { attendees, teams } = await holidayAttendeesFor(person, staff);
  const days = Number(row.days_count);
  const dayWord = days === 1 ? "day" : "days";
  const lines = [
    `${person.name} is on annual leave from ${longDate(row.start_date)} to ${longDate(row.end_date)} (${days} ${dayWord}).`,
    approver ? `Approved by ${approver}.` : "Approved.",
    row.notes ? `Notes: ${row.notes}` : "",
    "Created by the BGP Dashboard (People & HR → Holiday).",
  ].filter(Boolean);

  const body = {
    subject: `${person.name} — annual leave`,
    body: { contentType: "text", content: lines.join("\n") },
    isAllDay: true,
    start: { dateTime: `${row.start_date}T00:00:00`, timeZone: "Europe/London" },
    end: { dateTime: `${nextDay(row.end_date)}T00:00:00`, timeZone: "Europe/London" },
    showAs: "oof",
    isReminderOn: false,
    attendees: attendees
      .filter(a => a.email.toLowerCase() !== person.email.toLowerCase())
      .map(a => ({ emailAddress: { address: a.email, name: a.name }, type: "required" })),
  };

  // Prefer the person's own calendar (the invite then comes from them);
  // fall back to the ChatBGP shared mailbox if the app token can't write
  // to that mailbox.
  const mailboxes = [person.email, SHARED_MAILBOX];
  let lastError: any = null;
  for (const mailbox of mailboxes) {
    const payload = mailbox === person.email
      ? body
      : { ...body, attendees: attendees.map(a => ({ emailAddress: { address: a.email, name: a.name }, type: "required" })) };
    try {
      const ev = await graphRequest(`/users/${encodeURIComponent(mailbox)}/events`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!ev?.id) throw new Error("Graph returned no event id");
      return { eventId: String(ev.id), mailbox, teams, attendeeCount: payload.attendees.length };
    } catch (e: any) {
      lastError = e;
      console.warn(`[holiday-calendar] event on ${mailbox} failed: ${e?.message}`);
    }
  }
  throw lastError || new Error("Calendar event failed");
}
