// ─────────────────────────────────────────────────────────────────────────
// Client team-events sync (Landsec).
//
// Populates team_events with the BGP account team's diary entries that relate
// to a client — so the client's dashboard "Upcoming Events" card shows their
// meetings WITHOUT the client ever touching Microsoft. This runs server-side
// with each account-team member's own delegated token (getDelegatedGraphToken
// ForUser); the client never receives a token.
//
// SECURITY: only events that match the client (a client property name in the
// subject/location, the word "Landsec", or a client contact as an attendee)
// are stored. Everything else in a team member's diary is discarded. Personal
// events are stripped defensively too.
// ─────────────────────────────────────────────────────────────────────────
import { pool } from "./db";
import { getDelegatedGraphTokenForUser } from "./microsoft";

const PERSONAL_PATTERNS = [
  /\blunch\b/i, /\bbreakfast\b/i, /\bdinner\b/i, /\bgym\b/i, /\bworkout\b/i,
  /\bdentist\b/i, /\bdoctor\b/i, /\bdr\b/i, /\bhairdress/i, /\bbarber/i,
  /\bschool\s*(run|pick|drop)/i, /\bkids?\b/i, /\bnursery\b/i, /\bvet\b/i,
  /\bdog\b/i, /\bpersonal\b/i, /\bbirthday\b/i, /\banniversary\b/i,
  /\bholiday\b/i, /\bday\s*off\b/i, /\bannual\s*leave\b/i, /\bwfh\b/i,
  /\bwork\s*from\s*home\b/i, /\bfocus\s*time\b/i, /\bno\s*meetings?\b/i,
  /\bdent\b/i, /\bhospital\b/i, /\bappointment\b/i,
];

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase();
}

export async function syncClientTeamEvents(clientCompanyId: string): Promise<{
  teamMembers: number; connected: number; scanned: number; matched: number; upserted: number;
}> {
  const stats = { teamMembers: 0, connected: 0, scanned: 0, matched: 0, upserted: 0 };

  const companyRow = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [clientCompanyId]);
  const companyName: string = companyRow.rows[0]?.name;
  if (!companyName) return stats;

  // Account team = the client-team board members (BGP staff).
  const teamRes = await pool.query(
    `SELECT DISTINCT user_id FROM crm_client_team_members WHERE client_company_id = $1`,
    [clientCompanyId]
  );
  const teamUserIds: string[] = teamRes.rows.map((r: any) => r.user_id).filter(Boolean);
  stats.teamMembers = teamUserIds.length;
  if (teamUserIds.length === 0) return stats;

  // Match set: the client's property names + id, their tenant/contact brands,
  // and their contact emails (broader match = attendee is a client contact).
  const propRes = await pool.query(
    `SELECT id, name FROM crm_properties
      WHERE landlord_id = $1 OR id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1)`,
    [clientCompanyId]
  );
  const properties = propRes.rows.map((r: any) => ({ id: r.id as string, name: r.name as string }));
  // Only match property names of a reasonable length to avoid generic hits.
  const propMatchers = properties
    .filter(p => p.name && p.name.trim().length >= 5)
    .map(p => ({ id: p.id, needle: norm(p.name.replace(/,.*$/, "").trim()) }));

  const contactRes = await pool.query(
    `SELECT LOWER(email) AS email FROM crm_contacts WHERE company_id = $1 AND email IS NOT NULL AND email <> ''`,
    [clientCompanyId]
  );
  const contactEmails = new Set<string>(contactRes.rows.map((r: any) => r.email));

  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 1);
  const end = new Date(now); end.setDate(end.getDate() + 30);

  type Ev = { title: string; start: string; end: string; location: string; propertyId: string | null; uid: string };
  const matchedEvents = new Map<string, Ev>();

  for (const uid of teamUserIds) {
    const token = await getDelegatedGraphTokenForUser(uid).catch(() => null);
    if (!token) continue;
    stats.connected++;
    try {
      const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}&$top=100&$orderby=start/dateTime&$select=subject,start,end,location,attendees,iCalUId,isAllDay,showAs`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="Europe/London"' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const events = data.value || [];
      for (const e of events) {
        stats.scanned++;
        const subject = e.subject || "";
        const location = e.location?.displayName || "";
        const hay = norm(subject + " " + location);
        if (!hay.trim()) continue;
        if (PERSONAL_PATTERNS.some(re => re.test(subject))) continue;

        // Match 1: client property name or the word "landsec" in subject/location.
        let propertyId: string | null = null;
        let matched = hay.includes(norm(companyName));
        if (!matched) {
          const hit = propMatchers.find(m => hay.includes(m.needle));
          if (hit) { matched = true; propertyId = hit.id; }
        }
        // Match 2 (broader): a client contact is an attendee.
        if (!matched && Array.isArray(e.attendees)) {
          matched = e.attendees.some((a: any) => contactEmails.has(norm(a?.emailAddress?.address)));
        }
        if (!matched) continue;

        stats.matched++;
        const uid2 = e.iCalUId || `${subject}|${e.start?.dateTime}`;
        if (!matchedEvents.has(uid2)) {
          matchedEvents.set(uid2, {
            title: subject || "Meeting",
            start: e.start?.dateTime,
            end: e.end?.dateTime,
            location,
            propertyId,
            uid: uid2,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[client-events-sync] member ${uid} failed:`, err?.message);
    }
  }

  // Idempotent replace: clear this client's previously-synced events, reinsert.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM team_events WHERE company_name = $1 AND event_type = 'client-sync'`,
      [companyName]
    );
    for (const ev of matchedEvents.values()) {
      if (!ev.start) continue;
      await client.query(
        `INSERT INTO team_events (title, event_type, start_time, end_time, property_id, company_name, location, created_by)
         VALUES ($1, 'client-sync', $2, $3, $4, $5, $6, 'client-events-sync')`,
        [ev.title, ev.start, ev.end || ev.start, ev.propertyId, companyName, ev.location || null]
      );
      stats.upserted++;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  return stats;
}

// Sync every client that has an account-team board configured.
export async function syncAllClientTeamEvents(): Promise<void> {
  try {
    const res = await pool.query(
      `SELECT DISTINCT client_company_id FROM crm_client_team_members WHERE client_company_id IS NOT NULL`
    );
    for (const row of res.rows) {
      try {
        const s = await syncClientTeamEvents(row.client_company_id);
        console.log(`[client-events-sync] ${row.client_company_id}: ${s.upserted} events (${s.connected}/${s.teamMembers} diaries, ${s.matched} matched)`);
      } catch (e: any) {
        console.warn(`[client-events-sync] ${row.client_company_id} failed:`, e?.message);
      }
    }
  } catch (e: any) {
    console.warn("[client-events-sync] sweep failed:", e?.message);
  }
}

// Boot: run once shortly after startup, then hourly. Production only.
export function startClientEventsSyncLoop(): void {
  if (process.env.NODE_ENV !== "production") return;
  setTimeout(() => { syncAllClientTeamEvents(); }, 30_000);
  setInterval(() => { syncAllClientTeamEvents(); }, 60 * 60 * 1000);
}
