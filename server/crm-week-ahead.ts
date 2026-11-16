// Monday's week ahead, in two emails (Woody, 2026-11-16: "the directors then
// want a summary of those meetings emailed to them on a monday morning";
// then, asked who and what: the directors' address, no look back, "just
// landlords at this stage but should also do for brands and agents
// separately and send to" the leasing address).
//
//   directors: the week's landlord meetings and the CRM's confirmed events
//   leasing:   the week's meetings with brands BGP is working and with agents
//
// Both at 07:30 on a Monday. The meetings are the ones read from BGP diaries
// (server/landlord-meetings.ts, its two books); the rules and the wording are
// shared/crm-week-ahead.ts, the same ones the calendar on the CRM Overview
// draws from.
//
// Who is mailed is decided here and nowhere else: each edition's own
// address, or its setting (a comma list; "off" stops it), and only ever an
// address on BGP's own domain. A request never names a recipient: the test
// send goes to the admin who pressed it.
import type { Express, Request } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import { getLandlordMeetingDigest, type DiaryBook } from "./landlord-meetings";
import { sendSharedMailboxEmail } from "./shared-mailbox";
import { EDITION_LABELS, WEEK_EDITIONS, groupWeekMeetings, weekAheadHtml, weekAheadSubject, type WeekAhead, type WeekEdition, type WeekEvent } from "../shared/crm-week-ahead";

const BGP_DOMAIN = "@brucegillinghampollard.com";
export const WEEK_AHEAD_SCHEDULE = "Mondays at 07:30";
const EDITIONS: Record<WeekEdition, { to: string; setting: string; book: DiaryBook; events: boolean }> = {
  directors: { to: `directors${BGP_DOMAIN}`, setting: "CRM_WEEK_AHEAD_TO", book: "landlord", events: true },
  leasing: { to: `leasing${BGP_DOMAIN}`, setting: "LEASING_WEEK_AHEAD_TO", book: "leasing", events: false },
};
const lastKey = (edition: WeekEdition) => `crm_week_ahead_last:${edition}`;
const isEdition = (value: unknown): value is WeekEdition => typeof value === "string" && (WEEK_EDITIONS as string[]).includes(value);

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

export async function loadWeekAhead(edition: WeekEdition, now?: Date): Promise<WeekAhead> {
  const { book, events: withEvents } = EDITIONS[edition];
  const digest = await getLandlordMeetingDigest(now ? { weekOnly: true, now, book } : { weekOnly: true, book });
  // The meetings are the point of the email: it still goes if the CRM's own
  // events cannot be read.
  let events: WeekEvent[] = [];
  if (withEvents) {
    try { events = await confirmedEvents(digest.week); }
    catch (error: any) { console.warn("[crm-week-ahead] CRM events could not be read:", error?.message); }
  }
  return { edition, week: { start: digest.week.start, end: digest.week.end }, meetings: groupWeekMeetings(digest.meetings), events, coverage: digest.coverage };
}

// The edition's own address unless its setting names others. Never an
// address outside BGP, whatever the setting holds.
export function weekAheadRecipients(edition: WeekEdition, env: Record<string, string | undefined> = process.env): string[] {
  const { to, setting } = EDITIONS[edition];
  const value = (env[setting] || "").trim();
  if (value.toLowerCase() === "off") return [];
  const wanted = (value ? value.split(/[,;\s]+/) : [to]).map(address => address.trim().toLowerCase());
  return wanted.filter((address, index) => /^[a-z0-9._%+-]+@/.test(address) && address.endsWith(BGP_DOMAIN) && wanted.indexOf(address) === index);
}

async function sendEdition(edition: WeekEdition): Promise<{ sent: number; failed: number; meetings: number; events: number }> {
  const to = weekAheadRecipients(edition);
  if (!to.length) { console.log(`[crm-week-ahead] ${edition}: nobody to send to`); return { sent: 0, failed: 0, meetings: 0, events: 0 }; }
  const week = await loadWeekAhead(edition);
  const subject = weekAheadSubject(week);
  const html = weekAheadHtml(week, baseUrl());
  let sent = 0, failed = 0;
  for (const address of to) {
    try { await sendSharedMailboxEmail({ to: address, subject, body: html }); sent++; }
    catch (error: any) { failed++; console.warn(`[crm-week-ahead] ${edition}: one email could not be sent:`, String(error?.message || error).slice(0, 200)); }
  }
  const record = { at: new Date().toISOString(), sent, failed, meetings: week.meetings.length, events: week.events.length, week: week.week };
  await pool.query(
    `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [lastKey(edition), JSON.stringify(record)]);
  console.log(`[crm-week-ahead] ${edition}: ${sent} sent, ${failed} failed: ${record.meetings} meetings, ${record.events} events`);
  return { sent, failed, meetings: record.meetings, events: record.events };
}

// Both editions. One failing never stops the other.
export async function mondayWeekAhead(): Promise<void> {
  for (const edition of WEEK_EDITIONS) {
    try { await sendEdition(edition); }
    catch (error: any) { console.error(`[crm-week-ahead] ${edition} failed:`, error?.message || error); }
  }
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
      const editions = await Promise.all(WEEK_EDITIONS.map(async edition => {
        const [week, last] = await Promise.all([
          loadWeekAhead(edition),
          pool.query("SELECT value FROM system_settings WHERE key=$1", [lastKey(edition)]).then(result => result.rows[0]?.value || null),
        ]);
        return { edition, label: EDITION_LABELS[edition], recipients: weekAheadRecipients(edition), subject: weekAheadSubject(week),
          html: weekAheadHtml(week, baseUrl()), meetings: week.meetings.length, events: week.events.length, coverage: week.coverage, last };
      }));
      res.json({ schedule: WEEK_AHEAD_SCHEDULE, editions });
    } catch (error: any) { res.status(503).json({ message: "The week ahead could not be put together. Nothing was sent." }); }
  });
  // A copy to the admin who asked, and to nobody else.
  app.post("/api/admin/crm-week-ahead/:edition/send-me", requireAuth, requireAdmin, async (req, res) => {
    try {
      const edition = req.params.edition;
      if (!isEdition(edition)) return res.status(404).json({ message: "There is no such email." });
      const to = await callerEmail(req);
      if (!to) return res.status(400).json({ message: "Your login has no email address to send to." });
      const week = await loadWeekAhead(edition);
      await sendSharedMailboxEmail({ to, subject: `[Copy] ${weekAheadSubject(week)}`, body: weekAheadHtml(week, baseUrl()) });
      res.json({ sentTo: to });
    } catch (error: any) { res.status(503).json({ message: "The copy could not be sent." }); }
  });
}
