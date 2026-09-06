// ─────────────────────────────────────────────────────────────────────────
// Teams meeting transcripts → notes (Woody, 2026-08-05: "we will be
// recording meetings via teams so that needs to be built in").
//
// Hourly sweep, production only: for every staff member with a connected
// Microsoft account, find their Teams meetings that ENDED in the last 24h,
// pull the transcript (requires transcription turned on in the meeting),
// and create a meeting note — AI summary up top, full transcript below,
// company-matched via attendees so Landsec meetings land on Landsec.
// The note then flows through the normal notes machinery: knowledge-base
// indexing + suggested actions (accept → linked task).
//
// Permissions: reading transcripts needs OnlineMeetingTranscript.Read.All
// (admin consent, one click in Azure). Until granted, the sweep logs the
// 403 once per run and the status endpoint says exactly what's missing.
// ─────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { ensureNotesTables, extractActions, indexNote } from "./notes";

let lastRun: { at: string; meetingsSeen: number; transcriptsIngested: number; permissionError: string | null } | null = null;

function vttToText(vtt: string): string {
  return vtt
    .split("\n")
    .filter(l => l.trim() && !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
    .map(l => l.replace(/<[^>]+>/g, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 30000);
}

async function companyForAttendees(emails: string[]): Promise<{ companyId: string | null; companyName: string | null }> {
  if (!emails.length) return { companyId: null, companyName: null };
  const r = await pool.query(
    `SELECT c.company_id, co.name, count(*) AS n
       FROM crm_contacts c JOIN crm_companies co ON co.id = c.company_id
      WHERE lower(c.email) = ANY($1) AND c.company_id IS NOT NULL
        AND lower(co.name) NOT LIKE '%gillingham%'
      GROUP BY c.company_id, co.name ORDER BY n DESC LIMIT 1`,
    [emails.map(e => e.toLowerCase())]);
  return r.rows[0] ? { companyId: r.rows[0].company_id, companyName: r.rows[0].name } : { companyId: null, companyName: null };
}

export async function sweepTeamsTranscripts(): Promise<typeof lastRun> {
  await ensureNotesTables();
  const stats = { at: new Date().toISOString(), meetingsSeen: 0, transcriptsIngested: 0, permissionError: null as string | null };

  const staff = await pool.query(
    `SELECT id, name FROM users WHERE email ILIKE '%@brucegillinghampollard.com' AND (role IS NULL OR role <> 'Client')`);
  const { getDelegatedGraphTokenForUser } = await import("./microsoft");

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();

  for (const user of staff.rows) {
    const token = await getDelegatedGraphTokenForUser(user.id).catch(() => null);
    if (!token) continue;
    try {
      const cal = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${since}&endDateTime=${now}&$top=50&$select=subject,start,end,attendees,onlineMeeting,isOnlineMeeting,iCalUId`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!cal.ok) continue;
      const events = ((await cal.json()).value || []).filter((e: any) =>
        e.isOnlineMeeting && e.onlineMeeting?.joinUrl && new Date(e.end?.dateTime + "Z") < new Date());
      for (const ev of events) {
        stats.meetingsSeen++;
        // Resolve the online meeting id from the join URL (organiser-scoped).
        const om = await fetch(
          `https://graph.microsoft.com/v1.0/me/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(ev.onlineMeeting.joinUrl)}'`,
          { headers: { Authorization: `Bearer ${token}` } });
        if (!om.ok) continue; // not the organiser — their sweep will catch it
        const meeting = ((await om.json()).value || [])[0];
        if (!meeting?.id) continue;
        const dedupeRef = `teams:${meeting.id}`;
        const existing = await pool.query(`SELECT 1 FROM notes WHERE meeting_ref = $1`, [dedupeRef]);
        if (existing.rowCount) continue;

        const tr = await fetch(`https://graph.microsoft.com/v1.0/me/onlineMeetings/${meeting.id}/transcripts`, {
          headers: { Authorization: `Bearer ${token}` } });
        if (tr.status === 403) {
          stats.permissionError = "OnlineMeetingTranscript.Read.All not consented — grant it in Azure AD → App registrations → API permissions";
          continue;
        }
        if (!tr.ok) continue;
        const transcript = ((await tr.json()).value || [])[0];
        if (!transcript?.id) continue; // meeting wasn't transcribed

        const content = await fetch(
          `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meeting.id}/transcripts/${transcript.id}/content?$format=text/vtt`,
          { headers: { Authorization: `Bearer ${token}` } });
        if (!content.ok) continue;
        const text = vttToText(await content.text());
        if (text.length < 100) continue;

        const attendeeEmails = (ev.attendees || []).map((a: any) => a?.emailAddress?.address).filter(Boolean);
        const { companyId, companyName } = await companyForAttendees(attendeeEmails);

        // Summary first — the note reads like minutes, not a wall of VTT.
        let summary = "";
        try {
          const Anthropic = (await import("@anthropic-ai/sdk")).default;
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const resp = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 500,
            messages: [{ role: "user", content: `Summarise this commercial-property meeting transcript as crisp minutes: 3-6 bullets of what was discussed/decided. Plain text bullets only.\n\n${text.slice(0, 12000)}` }],
          });
          summary = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
        } catch { /* transcript-only note is still useful */ }

        const when = new Date(ev.start?.dateTime + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        const body = `${summary ? `SUMMARY\n${summary}\n\n` : ""}ATTENDEES\n${attendeeEmails.join(", ") || "(not recorded)"}\n\nTRANSCRIPT\n${text}`;
        const r = await pool.query(
          `INSERT INTO notes (title, body, company_id, author_id, source, meeting_ref)
           VALUES ($1, $2, $3, $4, 'teams', $5) RETURNING id`,
          [`Teams — ${ev.subject || "meeting"} (${when})${companyName ? ` · ${companyName}` : ""}`, body, companyId, user.id, dedupeRef]);
        stats.transcriptsIngested++;
        const created = (await pool.query(`SELECT * FROM notes WHERE id = $1`, [r.rows[0].id])).rows[0];
        await indexNote(created);
        extractActions(r.rows[0].id).catch(() => {});
      }
    } catch (e: any) {
      console.warn(`[teams-notes] sweep for ${user.name} failed:`, e?.message);
    }
  }
  lastRun = stats;
  console.log(`[teams-notes] sweep: ${stats.meetingsSeen} meetings seen, ${stats.transcriptsIngested} transcripts ingested${stats.permissionError ? ` · PERMISSION: ${stats.permissionError}` : ""}`);
  return stats;
}

export function setupTeamsNotesRoutes(app: Express): void {
  app.get("/api/teams-notes/status", requireAuth, async (_req: Request, res: Response) => {
    res.json({ lastRun });
  });
  app.post("/api/teams-notes/sweep", requireAuth, async (req: Request, res: Response) => {
    try {
      const { isClientRequestUser } = await import("./company-scope");
      if (await isClientRequestUser(req as any)) return res.status(403).json({ error: "Not available for client accounts" });
      res.json(await sweepTeamsTranscripts());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}

export function startTeamsNotesLoop(): void {
  if (process.env.NODE_ENV !== "production") return;
  setTimeout(() => { sweepTeamsTranscripts().catch(() => {}); }, 3 * 60 * 1000);
  setInterval(() => { sweepTeamsTranscripts().catch(() => {}); }, 60 * 60 * 1000);
}
