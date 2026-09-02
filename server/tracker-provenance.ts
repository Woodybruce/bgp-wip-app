// Tracker provenance — open the thing an activity row came FROM.
//
// Viewings, offers and interest rows are mostly auto-detected: viewings from
// staff Outlook diaries (calendar_event_id), offers and interest from staff
// inboxes (email_conversation_id). The keys were stored but never surfaced,
// so a row said "figures need confirming from the email" with no way to
// reach the email (Woody, 2026-09-02: "the email offers need to pop out the
// actual email so it can be verified and the numbers logged").
//
// Reads use the app-only Graph token, same as the sweep that wrote the rows
// (viewing-sync via interactions.ts) — the source mailbox belongs to whoever
// received it, not to whoever is looking at the tracker.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { getAppToken } from "./shared-mailbox";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MODEL = "claude-haiku-4-5-20251001";

// The sweep prefixes the key by what it found: conv_<conversationId> for a
// mail thread, msg_<id> for a lone message, cal_<iCalUId> for a diary event.
// Interest rows come from BOTH sweeps and share one column, so the prefix is
// the only thing that says whether a row's source is an email or a calendar
// entry.
export function parseSourceKey(raw: string | null | undefined): { kind: "conv" | "msg" | "cal"; id: string } | null {
  const key = String(raw || "").trim();
  if (!key) return null;
  if (key.startsWith("conv_")) return { kind: "conv", id: key.slice(5) };
  if (key.startsWith("msg_")) return { kind: "msg", id: key.slice(4) };
  if (key.startsWith("cal_")) return { kind: "cal", id: key.slice(4) };
  // Older rows may hold a bare conversation id.
  return { kind: "conv", id: key };
}

// The mailbox it landed in is recorded in the row's own note text —
// "Detected in peter@bgp...'s inbox" / "Synced from alext@bgp...'s Outlook
// diary". Parsing it beats guessing the caller's mailbox, which usually
// doesn't hold the thread at all.
function mailboxFromText(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    const m = String(t || "").match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    if (m) return m[1];
  }
  return null;
}

async function graphGet(token: string, url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Graph ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

const MSG_SELECT = "id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,webLink,hasAttachments,conversationId";

function shapeMessage(m: any) {
  return {
    id: m.id,
    subject: m.subject || "(no subject)",
    from: m.from?.emailAddress ? { name: m.from.emailAddress.name, address: m.from.emailAddress.address } : null,
    to: (m.toRecipients || []).map((r: any) => r?.emailAddress?.address).filter(Boolean),
    cc: (m.ccRecipients || []).map((r: any) => r?.emailAddress?.address).filter(Boolean),
    receivedDateTime: m.receivedDateTime || null,
    bodyHtml: m.body?.contentType === "html" ? m.body?.content || "" : "",
    bodyText: m.body?.contentType === "html" ? "" : (m.body?.content || m.bodyPreview || ""),
    webLink: m.webLink || null,
    hasAttachments: !!m.hasAttachments,
  };
}

// Pull the thread (or single message) behind an offer / interest row.
async function loadSourceEmail(sourceKey: string | null, noteTexts: Array<string | null | undefined>) {
  const parsed = parseSourceKey(sourceKey);
  if (!parsed) return { error: "This row wasn't created from an email — nothing to open." };
  if (parsed.kind === "cal") return { error: "This row came from a diary entry, not an email — open the calendar instead." };
  const mailbox = mailboxFromText(...noteTexts);
  if (!mailbox) return { error: "Couldn't tell which mailbox this came from. Open it in Outlook by searching the subject." };

  let token: string;
  try {
    token = await getAppToken();
  } catch (e: any) {
    return { error: `Microsoft 365 app access unavailable: ${e?.message || e}` };
  }

  try {
    if (parsed.kind === "msg") {
      const m = await graphGet(token, `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(parsed.id)}?$select=${MSG_SELECT}`);
      return { mailbox, messages: [shapeMessage(m)] };
    }
    // No $orderby alongside the conversationId filter — Graph rejects the
    // pair as an "InefficientFilter"; sort the handful of results here.
    const filter = `conversationId eq '${parsed.id.replace(/'/g, "''")}'`;
    const data = await graphGet(
      token,
      `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages?$filter=${encodeURIComponent(filter)}&$select=${MSG_SELECT}&$top=10`,
    );
    const messages = (data.value || [])
      .map(shapeMessage)
      .sort((a: any, b: any) => String(b.receivedDateTime || "").localeCompare(String(a.receivedDateTime || "")));
    if (messages.length === 0) return { error: `The thread is no longer in ${mailbox} (moved or deleted).`, mailbox };
    return { mailbox, messages };
  } catch (e: any) {
    return { error: e?.message || "Couldn't read the email from Microsoft 365.", mailbox };
  }
}

function plainText(msgs: Array<{ subject: string; bodyHtml: string; bodyText: string; from: any; receivedDateTime: string | null }>): string {
  return msgs
    .map(m => {
      const body = m.bodyText || String(m.bodyHtml || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
      return `From: ${m.from?.name || m.from?.address || "?"} (${m.receivedDateTime || ""})\nSubject: ${m.subject}\n${body.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()}`;
    })
    .join("\n\n---\n\n")
    .slice(0, 12_000);
}

export function setupTrackerProvenanceRoutes(app: Express): void {
  // ── The email behind an offer ─────────────────────────────────────────
  app.get("/api/tracker/offer/:offerId/email", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(`SELECT email_conversation_id, comments, company_name FROM unit_offers WHERE id = $1`, [req.params.offerId]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ message: "Offer not found" });
      res.json(await loadSourceEmail(row.email_conversation_id, [row.comments]));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  // ── The email behind an interest row ─────────────────────────────────
  app.get("/api/tracker/interest/:interestId/email", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(`SELECT email_conversation_id, notes, company_name FROM unit_interest WHERE id = $1`, [req.params.interestId]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ message: "Interest not found" });
      res.json(await loadSourceEmail(row.email_conversation_id, [row.notes]));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  // ── The diary event behind a viewing ─────────────────────────────────
  // Viewings are meant to live in the team calendar; this hands back the
  // real event so the row can link straight to it (Outlook web link, plus
  // the in-app calendar day).
  // Serves viewings (calendar_event_id) and interest rows synced from a
  // diary rather than an inbox — those carry cal_<iCalUId> in the same
  // column the email keys use.
  app.get("/api/tracker/:kind/:rowId/event", requireAuth, async (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (kind !== "viewing" && kind !== "interest") return res.status(400).json({ message: "Unknown row type" });
      const r = kind === "viewing"
        ? await pool.query(`SELECT calendar_event_id AS key, notes, viewing_date AS on_date FROM unit_viewings WHERE id = $1`, [req.params.rowId])
        : await pool.query(`SELECT email_conversation_id AS key, notes, interest_date AS on_date FROM unit_interest WHERE id = $1`, [req.params.rowId]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ message: "Row not found" });
      const eventId = String(row.key || "").trim();
      if (!eventId) return res.json({ error: "This was logged by hand — it isn't in anyone's diary." });
      if (eventId.startsWith("conv_") || eventId.startsWith("msg_")) {
        return res.json({ error: "This came from an email, not a diary entry — open the email instead." });
      }
      const mailbox = mailboxFromText(row.notes);
      if (!mailbox) return res.json({ error: "Couldn't tell whose diary this came from." });
      let token: string;
      try { token = await getAppToken(); }
      catch (e: any) { return res.json({ error: `Microsoft 365 app access unavailable: ${e?.message || e}` }); }
      try {
        // The sweep stores the event's iCalUId when it has one, falling back
        // to cal_<graph id> — so only the prefixed form can be fetched by id;
        // an iCalUId has to be looked up with a filter.
        const EV_SELECT = "id,subject,start,end,location,attendees,organizer,webLink,bodyPreview";
        let ev: any;
        if (eventId.startsWith("cal_")) {
          ev = await graphGet(
            token,
            `${GRAPH}/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(eventId.slice(4))}?$select=${EV_SELECT}`,
          );
        } else {
          const filter = `iCalUId eq '${eventId.replace(/'/g, "''")}'`;
          const found = await graphGet(
            token,
            `${GRAPH}/users/${encodeURIComponent(mailbox)}/events?$filter=${encodeURIComponent(filter)}&$select=${EV_SELECT}&$top=1`,
          );
          ev = (found.value || [])[0];
          if (!ev) return res.json({ error: `That event is no longer in ${mailbox}'s diary.`, mailbox });
        }
        res.json({
          mailbox,
          event: {
            id: ev.id,
            subject: ev.subject || "(no subject)",
            start: ev.start?.dateTime || null,
            end: ev.end?.dateTime || null,
            timeZone: ev.start?.timeZone || null,
            location: ev.location?.displayName || null,
            organizer: ev.organizer?.emailAddress?.address || null,
            attendees: (ev.attendees || []).map((a: any) => ({ name: a?.emailAddress?.name, address: a?.emailAddress?.address })).filter((a: any) => a.address),
            webLink: ev.webLink || null,
            preview: ev.bodyPreview || null,
          },
          // The in-app team calendar, on the day it happened.
          appCalendarUrl: row.on_date ? `/calendar?date=${String(row.on_date).slice(0, 10)}` : "/calendar",
        });
      } catch (e: any) {
        res.json({ error: e?.message || "Couldn't read the diary event.", mailbox });
      }
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  // ── Read the figures out of the offer email ──────────────────────────
  // SUGGESTIONS ONLY — nothing is written to the offer. The dialog shows
  // these next to the fields for a human to accept.
  app.post("/api/tracker/offer/:offerId/extract", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(`SELECT email_conversation_id, comments, company_name FROM unit_offers WHERE id = $1`, [req.params.offerId]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ message: "Offer not found" });
      const src = await loadSourceEmail(row.email_conversation_id, [row.comments]);
      if ((src as any).error || !(src as any).messages) return res.json({ error: (src as any).error || "No email to read." });
      if (!process.env.ANTHROPIC_API_KEY) return res.json({ error: "AI key not configured on this environment." });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const { safeParseJSON } = await import("./utils/anthropic-client");
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 800,
        messages: [{
          role: "user",
          content: `Read this property offer email thread and pull out the commercial terms offered.

Return ONLY JSON:
{"rentPa": number|null, "termYears": number|null, "rentFreeMonths": number|null, "breakOption": string|null, "premium": number|null, "fittingOutContribution": number|null, "incentives": string|null, "notes": string|null}

Rules:
- Rent is the annual rent in GBP (convert "£85k" to 85000, "£45 psf on 2,000 sq ft" to 90000 only if both numbers are explicit — otherwise null).
- Use null for anything not clearly stated. Never guess a number.
- breakOption / incentives: short phrases as written.
- notes: one sentence on anything material that has no field (conditions, subject-to, deadlines). Null if nothing.

EMAIL THREAD:
${plainText((src as any).messages)}`,
        }],
      });
      const text = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      const parsed = safeParseJSON(text);
      if (!parsed) return res.json({ error: "Couldn't read figures from that email." });
      res.json({ suggested: parsed, mailbox: (src as any).mailbox });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  // ── Interest → target operator ───────────────────────────────────────
  // "it needs to also show what brand is keen and then add it to the target
  // operator with the relevant comments or a summary of them" — one click:
  // ensure the unit's brief, create the target, and carry every interest
  // note for that brand across as the rationale (AI-summarised when there
  // is more than one).
  app.post("/api/tracker/interest/:interestId/add-target", requireAuth, async (req: any, res: Response) => {
    try {
      const r = await pool.query(`SELECT * FROM unit_interest WHERE id = $1`, [req.params.interestId]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ message: "Interest not found" });
      const brandName: string = row.company_name || row.contact_name || "";
      if (!brandName) return res.status(400).json({ message: "This interest row has no brand to add." });

      const unitQ = await pool.query(`SELECT id, unit_name FROM available_units WHERE id = $1`, [row.unit_id]);
      const unit = unitQ.rows[0];
      if (!unit) return res.status(404).json({ message: "Unit not found" });

      // Already a target on this unit? Don't duplicate.
      const existing = await pool.query(
        `SELECT t.id FROM unit_target_operators t
           JOIN unit_briefs b ON b.id = t.brief_id
          WHERE b.unit_id = $1 AND (LOWER(t.operator_name) = LOWER($2) OR ($3::varchar IS NOT NULL AND t.company_id = $3))
          LIMIT 1`,
        [row.unit_id, brandName, row.company_id || null],
      );
      if (existing.rows[0]) {
        return res.json({ ok: true, alreadyTarget: true, targetId: existing.rows[0].id, operatorName: brandName });
      }

      // Every interest note for this brand on this unit — the "relevant
      // comments" that should travel with the target.
      const sibQ = await pool.query(
        `SELECT interest_date, notes FROM unit_interest
          WHERE unit_id = $1 AND (LOWER(COALESCE(company_name, '')) = LOWER($2) OR ($3::varchar IS NOT NULL AND company_id = $3))
          ORDER BY interest_date DESC`,
        [row.unit_id, brandName, row.company_id || null],
      );
      const digest = sibQ.rows
        .map((s: any) => `${String(s.interest_date || "").slice(0, 10)}: ${String(s.notes || "").trim()}`)
        .filter((l: string) => l.length > 12)
        .join("\n");

      let rationale = digest || `Expressed interest ${String(row.interest_date || "").slice(0, 10)}.`;
      if (sibQ.rows.length > 1 && digest.length > 200 && process.env.ANTHROPIC_API_KEY) {
        try {
          const Anthropic = (await import("@anthropic-ai/sdk")).default;
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const msg = await client.messages.create({
            model: MODEL,
            max_tokens: 300,
            messages: [{
              role: "user",
              content: `Summarise this brand's interest in one property unit into two sentences max, for a leasing tracker note. Keep dates and specifics, drop email boilerplate. Plain text only.\n\nBrand: ${brandName}\nUnit: ${unit.unit_name}\n\n${digest}`,
            }],
          });
          const out = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
          if (out) rationale = out;
        } catch { /* keep the raw digest */ }
      }

      // Ensure the unit has a brief to hang targets off (same shape the
      // tracker's own "+ Target operator" flow creates).
      let briefId: string | null = (await pool.query(`SELECT id FROM unit_briefs WHERE unit_id = $1 LIMIT 1`, [row.unit_id])).rows[0]?.id || null;
      if (!briefId) {
        const ins = await pool.query(
          `INSERT INTO unit_briefs (unit_id, title) VALUES ($1, $2) RETURNING id`,
          [row.unit_id, `Operator Targeting — ${unit.unit_name || "Unit"}`],
        );
        briefId = ins.rows[0].id;
      }

      const userId = req.session?.userId || req.tokenUserId || null;
      const userName = userId ? (await pool.query(`SELECT name FROM users WHERE id = $1`, [userId])).rows[0]?.name || "BGP" : "BGP";
      const comment = [{
        userId,
        userName,
        text: `Added from tracker interest. ${rationale}`,
        at: new Date().toISOString(),
      }];

      const ins = await pool.query(
        `INSERT INTO unit_target_operators
           (brief_id, operator_name, company_id, priority, status, rationale, comments, agent_user_ids)
         VALUES ($1, $2, $3, 'B', 'Identified', $4, $5, $6) RETURNING id`,
        [briefId, brandName, row.company_id || null, rationale, JSON.stringify(comment), userId ? [String(userId)] : null],
      );
      res.json({ ok: true, targetId: ins.rows[0].id, operatorName: brandName, rationale });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });
}
