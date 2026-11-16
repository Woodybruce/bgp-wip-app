// Monday's CRM week ahead (Woody, 2026-11-16: "the directors then want a
// summary of those meetings emailed to them on a monday morning"). The week's
// landlord meetings, as CRM Meetings reads them from BGP diaries, and the
// CRM's confirmed events, in one email to the equity directors at 07:30 on a
// Monday. The rules and the wording are shared/crm-week-ahead.ts, the same
// ones the calendar on the CRM Overview draws from.
//
// Who is mailed is decided here and nowhere else: the directors list in
// server/auth.ts, or CRM_WEEK_AHEAD_TO (a comma list; "off" stops it), and
// only addresses that are an active BGP login. A request never names a
// recipient: the test send goes to the admin who pressed it.
import type { Express, Request } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin, EQUITY_DIRECTOR_EMAILS } from "./auth";
import { getLandlordMeetingDigest } from "./landlord-meetings";
import { sendSharedMailboxEmail } from "./shared-mailbox";
import { groupWeekMeetings, weekAheadHtml, weekAheadSubject, type WeekAhead, type WeekEvent } from "../shared/crm-week-ahead";

const LAST_KEY = "crm_week_ahead_last";
export const WEEK_AHEAD_SCHEDULE = "Mondays at 07:30";

function baseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
}

async function confirmedEvents(week: { start: string; end: string }): Promise<WeekEvent[]> {
  const { getCrmEngagementData } = await import("./crm-engagement");
  const data = await getCrmEngagementData(undefined, {}, "all");
  return data.events
    .filter(event => event.dateConfirmed && event.status !== "cancelled" && !!event.startsAt && event.startsAt >= week.start && event.startsAt < week.end)
    .map(event => ({
      id: event.id, title: event.title, startsAt: event.startsAt!, endsAt: event.endsAt, location: event.location, ownerName: event.ownerName,
      companies: [...new Set(event.companies.map(company => company.companyName))],
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function loadWeekAhead(now?: Date): Promise<WeekAhead> {
  const digest = await getLandlordMeetingDigest(now ? { weekOnly: true, now } : { weekOnly: true });
  // The meetings are the point of the email: it still goes if the CRM's own
  // events cannot be read.
  let events: WeekEvent[] = [];
  try { events = await confirmedEvents(digest.week); }
  catch (error: any) { console.warn("[crm-week-ahead] CRM events could not be read:", error?.message); }
  return { week: { start: digest.week.start, end: digest.week.end }, meetings: groupWeekMeetings(digest.meetings), events, coverage: digest.coverage };
}

export async function weekAheadRecipients(): Promise<string[]> {
  const setting = (process.env.CRM_WEEK_AHEAD_TO || "").trim();
  if (setting.toLowerCase() === "off") return [];
  const wanted = (setting ? setting.split(/[,;\s]+/) : EQUITY_DIRECTOR_EMAILS).map(address => address.trim().toLowerCase()).filter(address => address.includes("@"));
  if (!wanted.length) return [];
  // An active BGP login only: a leaver, or an address typed wrong, is never mailed.
  const { rows } = await pool.query(
    `SELECT lower(trim(email)) AS email FROM users
      WHERE lower(trim(email)) = ANY($1::text[]) AND COALESCE(role,'') <> 'Client' AND is_active IS DISTINCT FROM false`, [wanted]);
  const active = new Set(rows.map((row: any) => String(row.email)));
  return wanted.filter((address, index) => active.has(address) && wanted.indexOf(address) === index);
}

export async function mondayWeekAhead(): Promise<{ sent: number; failed: number; meetings: number; events: number }> {
  const to = await weekAheadRecipients();
  if (!to.length) { console.log("[crm-week-ahead] nobody to send to"); return { sent: 0, failed: 0, meetings: 0, events: 0 }; }
  const week = await loadWeekAhead();
  const subject = weekAheadSubject(week);
  const html = weekAheadHtml(week, baseUrl());
  let sent = 0, failed = 0;
  for (const address of to) {
    try { await sendSharedMailboxEmail({ to: address, subject, body: html }); sent++; }
    catch (error: any) { failed++; console.warn("[crm-week-ahead] one email could not be sent:", String(error?.message || error).slice(0, 200)); }
  }
  const record = { at: new Date().toISOString(), sent, failed, meetings: week.meetings.length, events: week.events.length, week: week.week };
  await pool.query(
    `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [LAST_KEY, JSON.stringify(record)]);
  console.log(`[crm-week-ahead] ${sent} sent, ${failed} failed: ${record.meetings} meetings, ${record.events} events`);
  return { sent, failed, meetings: record.meetings, events: record.events };
}

async function callerEmail(req: Request): Promise<string | null> {
  const userId = req.session?.userId || req.tokenUserId;
  if (!userId) return null;
  const { rows } = await pool.query("SELECT lower(trim(email)) AS email FROM users WHERE id=$1 AND is_active IS DISTINCT FROM false", [userId]);
  return rows[0]?.email || null;
}

export function setupCrmWeekAheadRoutes(app: Express): void {
  app.get("/api/admin/crm-week-ahead", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [week, recipients, last] = await Promise.all([
        loadWeekAhead(), weekAheadRecipients(),
        pool.query("SELECT value FROM system_settings WHERE key=$1", [LAST_KEY]).then(result => result.rows[0]?.value || null),
      ]);
      res.json({ schedule: WEEK_AHEAD_SCHEDULE, recipients, subject: weekAheadSubject(week), html: weekAheadHtml(week, baseUrl()),
        meetings: week.meetings.length, events: week.events.length, coverage: week.coverage, last });
    } catch (error: any) { res.status(503).json({ message: "The week ahead could not be put together. Nothing was sent." }); }
  });
  // A copy to the admin who asked, and to nobody else.
  app.post("/api/admin/crm-week-ahead/send-me", requireAuth, requireAdmin, async (req, res) => {
    try {
      const to = await callerEmail(req);
      if (!to) return res.status(400).json({ message: "Your login has no email address to send to." });
      const week = await loadWeekAhead();
      await sendSharedMailboxEmail({ to, subject: `[Copy] ${weekAheadSubject(week)}`, body: weekAheadHtml(week, baseUrl()) });
      res.json({ sentTo: to });
    } catch (error: any) { res.status(503).json({ message: "The copy could not be sent." }); }
  });
}
