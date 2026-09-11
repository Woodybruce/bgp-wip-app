/**
 * Find the meeting context for a card transaction.
 * Returns the closest calendar event around the transaction time, with attendees.
 *
 * TODO: requires a Microsoft Graph service principal (app permissions) to fetch
 * calendars without a logged-in user session. Currently stubbed; the receipt
 * flow proceeds without calendar context until this is wired up.
 */

export interface MeetingContext {
  eventId: string;
  subject: string;
  attendees: string;       // comma-separated
  start: Date;
  end: Date;
  refinedCategory?: string; // e.g. "Client Entertainment" if attendees include external clients
}

// A diary event only belongs on an expense where "who was there / what was it
// about" is the point — hospitality. A train fare, software subscription or
// parking charge that merely overlaps a meeting in the calendar must NOT
// inherit that meeting's subject + a dozen attendees (the noise Woody flagged
// on the Railway / Google / Anthropic rows).
export const CALENDAR_RELEVANT_CATEGORIES = new Set<string>([
  "Client Entertainment",
  "Agent Entertainment (External)",
  "Staff Entertainment",
  "Directors Meetings",
  "Meals & Drinks",
  "Subsistence",
]);
export function isCalendarRelevantCategory(category: string | null | undefined): boolean {
  return !!category && CALENDAR_RELEVANT_CATEGORIES.has(category);
}

// Merchant category codes for eating/drinking — the only swipes where a
// meeting match is wanted before a receipt (and therefore a category) exists.
//   5811 caterers · 5812 restaurants · 5813 bars · 5814 fast food
const HOSPITALITY_MCCS = new Set(["5811", "5812", "5813", "5814"]);
export function isHospitalityMcc(code: string | null | undefined): boolean {
  return !!code && HOSPITALITY_MCCS.has(String(code).trim());
}

export async function findMeetingContext(args: {
  userEmail: string;
  userId?: string | null;
  when: Date | string | null;
  baseCategory?: string;
  // When true, only return a meeting the transaction time actually falls
  // within (plus a small grace) — never the merely-nearest event. Used by the
  // card-swipe enrichment so a random purchase doesn't grab an unrelated
  // meeting into its description.
  requireContaining?: boolean;
}): Promise<MeetingContext | null> {
  if (!args.userEmail || !args.when) return null;
  // If the caller already knows the category and it isn't hospitality, never
  // attach a meeting — a train fare or SaaS charge keeps its own identity.
  if (args.baseCategory !== undefined && !isCalendarRelevantCategory(args.baseCategory)) return null;
  const at = new Date(args.when);
  if (isNaN(at.getTime())) return null;

  // Prefer the cardholder's OWN delegated token (the calendar consent the
  // firm already uses day-to-day) reading /me/calendarView. Fall back to an
  // app-only token + /users/{email}/calendarView, which needs the separate
  // Calendars.Read *application* permission. Either way we no-op on failure.
  const { getDelegatedGraphTokenForUser, getAppGraphToken } = await import("./microsoft");
  let token: string | null = args.userId ? await getDelegatedGraphTokenForUser(args.userId) : null;
  let calendarPath = token ? `/me/calendarView` : "";
  if (!token) {
    token = await getAppGraphToken();
    calendarPath = `/users/${encodeURIComponent(args.userEmail)}/calendarView`;
  }
  if (!token) return null;

  // A card is usually charged at the end of a meal/meeting, so look back
  // further than forward: 2h before → 1h after the transaction time.
  const start = new Date(at.getTime() - 120 * 60_000);
  const end = new Date(at.getTime() + 60 * 60_000);
  // calendarView defaults to UTC when no Prefer header is sent, so the
  // returned dateTime strings are UTC — we append "Z" to parse them.
  const url =
    `https://graph.microsoft.com/v1.0${calendarPath}` +
    `?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}` +
    `&$select=id,subject,start,end,attendees,isAllDay,showAs&$orderby=start/dateTime&$top=25`;

  let data: any;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status === 403) {
        console.warn(`[expense-calendar] Graph 403 for ${args.userEmail} — Calendars.Read not consented for this path (delegated user token or app-only application permission)`);
      } else {
        console.warn(`[expense-calendar] Graph calendarView ${res.status} for ${args.userEmail}`);
      }
      return null;
    }
    data = await res.json();
  } catch (e: any) {
    console.warn(`[expense-calendar] calendarView fetch failed: ${e?.message}`);
    return null;
  }

  const parse = (g: any): Date => new Date(`${g?.dateTime}Z`);
  const events: any[] = (data.value || [])
    .filter((e: any) => !e.isAllDay && e.showAs !== "free" && e.subject);
  if (events.length === 0) return null;

  // Prefer an event whose span contains the transaction time (with a grace:
  // a card is often charged a little before a meeting "starts" or just after
  // it ends — 15m before → 30m after).
  const tx = at.getTime();
  const GRACE_BEFORE = 15 * 60_000;
  const GRACE_AFTER = 30 * 60_000;
  const containing = events.find((e) => {
    const s = parse(e.start).getTime();
    const en = parse(e.end).getTime();
    return tx >= s - GRACE_BEFORE && tx <= en + GRACE_AFTER;
  });
  // requireContaining (card-swipe path) never falls back to the nearest
  // event — no meeting overlapping the spend means no meeting attached.
  const chosen = containing || (args.requireContaining
    ? null
    : events
        .slice()
        .sort((a, b) => Math.abs(parse(a.start).getTime() - tx) - Math.abs(parse(b.start).getTime() - tx))[0]);
  if (!chosen) return null;

  const attendeeEmails: string[] = (chosen.attendees || [])
    .map((a: any) => a.emailAddress?.address)
    .filter(Boolean);
  const attendeeNames: string[] = (chosen.attendees || [])
    .map((a: any) => a.emailAddress?.name || a.emailAddress?.address)
    .filter(Boolean);

  return {
    eventId: chosen.id,
    subject: chosen.subject,
    attendees: attendeeNames.join(", "),
    start: parse(chosen.start),
    end: parse(chosen.end),
    refinedCategory: args.baseCategory
      ? refineEntertainmentCategory({ attendeeEmails, baseCategory: args.baseCategory })
      : undefined,
  };
}

/**
 * Refine an entertainment category based on attendees.
 * - All BGP staff → "Staff Entertainment"
 * - All directors only → "Directors Meetings"
 * - External + property agency keywords → "Agent Entertainment (External)"
 * - External + non-agency → "Client Entertainment"
 */
export function refineEntertainmentCategory(args: {
  attendeeEmails: string[];
  baseCategory: string;
}): string {
  if (!["Meals & Drinks", "Subsistence"].includes(args.baseCategory)) return args.baseCategory;

  const bgpDomain = "@bgpllp.co.uk";
  const allBgp = args.attendeeEmails.every((e) => e.toLowerCase().includes(bgpDomain));
  if (allBgp) {
    const directorsOnly = args.attendeeEmails.length <= 5 &&
      args.attendeeEmails.every((e) => /woody|layla|charlotte|jack|rupert/i.test(e));
    return directorsOnly ? "Directors Meetings" : "Staff Entertainment";
  }

  const agencyDomains = /knightfrank|cbre|jll|colliers|cushman|savills|avisonyoung|bnp|gerald-eve|dtre|bryce|workman|corestate|edge|hanover/i;
  const hasAgency = args.attendeeEmails.some((e) => agencyDomains.test(e));
  return hasAgency ? "Agent Entertainment (External)" : "Client Entertainment";
}

// One-off cleanup for the meeting noise the old import-time matcher left on
// non-hospitality card rows (e.g. a leasing meeting stamped on a train fare).
// Surgical + safe: only Revolut rows (their notes carry "Revolut MCC <code>"),
// only where a diary event was auto-attached (calendar_event_id IS NOT NULL),
// and only when the MCC is NOT eating/drinking — so genuine restaurant matches
// (and any manual entry, which never sets calendar_event_id) are untouched.
// Idempotent: after it runs those rows have no calendar_event_id, so reruns
// clear nothing.
export async function clearMeetingNoise(): Promise<number> {
  const { pool } = await import("./db");
  try {
    const r = await pool.query(
      `UPDATE expenses
          SET business_purpose = NULL, attendees = NULL, calendar_event_id = NULL, updated_at = NOW()
        WHERE calendar_event_id IS NOT NULL
          AND notes ~ 'Revolut MCC'
          AND COALESCE(substring(notes from 'Revolut MCC ([0-9]{3,4})'), '') NOT IN ('5811','5812','5813','5814')`,
    );
    return r.rowCount || 0;
  } catch (e: any) {
    console.warn("[expense-calendar] clearMeetingNoise failed:", e?.message);
    return 0;
  }
}
