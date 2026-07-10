// AI Daily Briefing — generation + per-day cache.
//
// Previously /api/ai-briefing ran a ~15s Claude call on EVERY app open, and
// its calendar window pulled today + tomorrow ("includes the following day").
// This module fixes both:
//   - generateBriefing() builds the briefing for one user. Calendar/email
//     window is now today-only (Europe/London day).
//   - getOrCreateTodaysBriefing() is a read-through cache keyed by
//     (user_id, briefing_date) — the first request of the day generates and
//     stores; every later open returns the stored copy instantly.
//   - pregenerateAllBriefings() is run by the 6am cron so the briefing is
//     already sitting there when the user opens the app.

import { pool } from "./db";

export interface BriefingResult {
  briefing: string;
  generatedAt: string;
  stats: Record<string, number>;
}

let _tableReady = false;
async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_briefings (
      user_id VARCHAR NOT NULL,
      briefing_date DATE NOT NULL,
      briefing TEXT NOT NULL,
      stats JSONB,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, briefing_date)
    )
  `);
  _tableReady = true;
}

// "Today" in London, as YYYY-MM-DD — so the cache rolls over at UK midnight,
// not UTC midnight.
export function londonDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** Build the briefing for one user. msToken is optional — when absent
 *  (e.g. the background pre-gen for a user with no cached MS token) the
 *  calendar + inbox sections are simply omitted. */
export async function generateBriefing(userId: string, msToken: string | null): Promise<BriefingResult> {
  const userRow = await pool.query("SELECT name, team, email, role FROM users WHERE id = $1", [userId]);
  const userName = userRow.rows[0]?.name || "Team member";
  const userTeam = userRow.rows[0]?.team || "";
  // Client logins (e.g. Landsec) get a briefing built ONLY from their own
  // company's world — portfolio, leasing events, their deals with BGP —
  // never BGP-internal diary/inbox/task chatter.
  const userEmail = (userRow.rows[0]?.email || "").toLowerCase();
  const isClient = userRow.rows[0]?.role === "Client" || (!!userEmail && !userEmail.endsWith("@brucegillinghampollard.com"));

  const tasks = await pool.query(
    `SELECT * FROM user_tasks WHERE user_id = $1 AND status != 'done'
     ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date ASC NULLS LAST`,
    [userId]
  );
  const overdueTasks = tasks.rows.filter((t: any) => t.due_date && new Date(t.due_date) < new Date());
  const todayTasks = tasks.rows.filter((t: any) => {
    if (!t.due_date) return false;
    return new Date(t.due_date).toDateString() === new Date().toDateString();
  });

  const recentDone = await pool.query(
    `SELECT * FROM user_tasks WHERE user_id = $1 AND status = 'done' AND completed_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );

  const teamDeals = await pool.query(
    `SELECT d.id, d.name, d.status, p.name as property_name, tc.name as tenant_name, d.updated_at
     FROM crm_deals d
     LEFT JOIN crm_properties p ON d.property_id = p.id
     LEFT JOIN crm_companies tc ON d.tenant_id = tc.id
     WHERE d.team @> ARRAY[$1]::text[] AND d.status NOT IN ('WIT')
     ORDER BY d.updated_at DESC LIMIT 15`,
    [userTeam]
  );

  let calendarContext = "";
  let emailContext = "";
  if (msToken) {
    // Today only — start of today → start of tomorrow (London). The old
    // window added 2 days, which is why tomorrow's meetings leaked in.
    const startToday = new Date(`${londonDateKey()}T00:00:00`);
    const endToday = new Date(startToday);
    endToday.setDate(endToday.getDate() + 1);
    try {
      const calRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${startToday.toISOString()}&endDateTime=${endToday.toISOString()}&$top=20&$orderby=start/dateTime&$select=subject,start,end,location,organizer,attendees`,
        { headers: { Authorization: `Bearer ${msToken}`, Prefer: 'outlook.timezone="Europe/London"' } }
      );
      if (calRes.ok) {
        const calData = await calRes.json();
        const events = (calData.value || []).map((e: any) => ({
          subject: e.subject, start: e.start?.dateTime, location: e.location?.displayName || "",
        }));
        if (events.length > 0) {
          calendarContext = `Today's calendar (${events.length} events):\n${events.map((e: any) => `- ${new Date(e.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ${e.subject}${e.location ? ` (${e.location})` : ""}`).join("\n")}`;
        }
      }
    } catch (e: any) { console.log("[ai-briefing] Calendar fetch error:", e.message); }

    try {
      const emailRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,isRead,importance,bodyPreview`,
        { headers: { Authorization: `Bearer ${msToken}` } }
      );
      if (emailRes.ok) {
        const emailData = await emailRes.json();
        const emails = (emailData.value || []).filter((e: any) => !e.isRead).slice(0, 8);
        if (emails.length > 0) {
          emailContext = `Unread emails (${emails.length}):\n${emails.map((e: any) => `- ${e.from?.emailAddress?.name || "Unknown"}: "${e.subject}" — ${(e.bodyPreview || "").slice(0, 80)}`).join("\n")}`;
        }
      }
    } catch (e: any) { console.log("[ai-briefing] Email fetch error:", e.message); }
  }

  const stuckRes = await pool.query(
    `SELECT id, name, status, updated_at FROM crm_deals
     WHERE status NOT IN ('COM', 'INV', 'WIT')
     AND updated_at < NOW() - INTERVAL '14 days'
     AND team @> ARRAY[$1]::text[]
     ORDER BY updated_at ASC LIMIT 5`,
    [userTeam]
  );
  const stuckDeals = stuckRes.rows;

  const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // ── Client-scoped briefing (e.g. Landsec) ──────────────────────────────
  if (isClient) {
    let portfolioContext = "";
    try {
      const co = await pool.query(
        `SELECT id, name FROM crm_companies WHERE name = $1
         ORDER BY (company_type = 'Landlord') DESC NULLS LAST LIMIT 1`,
        [userTeam]
      );
      const companyId = co.rows[0]?.id;
      if (companyId) {
        const stats = await pool.query(
          `SELECT count(DISTINCT p.id) AS props, count(t.id) AS units,
                  count(t.id) FILTER (WHERE t.status IN ('Occupied','Not Vacant','Let')) AS occupied,
                  count(t.id) FILTER (WHERE t.status IN ('Vacant','Void')) AS vacant
           FROM crm_properties p LEFT JOIN tenancy_schedule_units t ON t.property_id = p.id
           WHERE p.landlord_id = $1`, [companyId]);
        const expiring = await pool.query(
          `SELECT t.tenant_name, t.trading_name, t.unit_number, t.lease_expiry, p.name AS property
           FROM tenancy_schedule_units t JOIN crm_properties p ON p.id = t.property_id
           WHERE p.landlord_id = $1 AND t.lease_expiry BETWEEN NOW() AND NOW() + INTERVAL '6 months'
             AND coalesce(t.tenant_name,'') <> ''
           ORDER BY t.lease_expiry ASC LIMIT 10`, [companyId]);
        const s = stats.rows[0] || {};
        portfolioContext = `PORTFOLIO (${userTeam}): ${s.props || 0} properties, ${s.units || 0} units — ${s.occupied || 0} occupied, ${s.vacant || 0} vacant.
${expiring.rows.length > 0 ? `LEASES EXPIRING (next 6 months):\n${expiring.rows.map((r: any) => `- ${r.trading_name || r.tenant_name} — ${r.unit_number || "unit"} @ ${r.property}, expires ${new Date(r.lease_expiry).toLocaleDateString("en-GB")}`).join("\n")}` : "No leases expiring in the next 6 months."}`;
      }
    } catch (e: any) { console.log("[ai-briefing] client portfolio context error:", e.message); }

    const clientPrompt = `You are the AI portfolio briefing assistant for ${userName} at ${userTeam}, a client of Bruce Gillingham Pollard (BGP), viewing their ${userTeam} portfolio dashboard. Today is ${todayStr}.

Generate a concise, warm, professional daily briefing about the ${userTeam} portfolio ONLY. Structure:

1. **Greeting** — brief and personalised.
2. **Portfolio at a glance** — headline numbers (properties, units, occupancy).
3. **Leasing events** — upcoming lease expiries or vacancies worth attention.
4. **Deal momentum** — commentary on active ${userTeam} deals with BGP.
5. **Looking ahead** — what to keep an eye on.

STRICT RULES: mention ONLY ${userTeam}-related information. Never reference BGP internal staff, their diaries, tasks or emails. Under 300 words.

${portfolioContext || `No portfolio data available for ${userTeam}.`}

${calendarContext ? `${userName}'s own calendar today:\n${calendarContext}` : ""}

ACTIVE DEALS (${teamDeals.rows.length} for ${userTeam}):
${teamDeals.rows.slice(0, 10).map((d: any) => `- ${d.name} — ${d.status}${d.property_name ? ` @ ${d.property_name}` : ""}${d.tenant_name ? ` (tenant: ${d.tenant_name})` : ""}`).join("\n") || "No active deals."}

${stuckDeals.length > 0 ? `DEALS WITH NO RECENT UPDATE (14+ days):\n${stuckDeals.map((d: any) => `- ${d.name} (${d.status})`).join("\n")}` : ""}`;

    const { callClaude } = await import("./utils/anthropic-client");
    const clientResult = await callClaude({
      messages: [{ role: "user", content: clientPrompt }],
      max_completion_tokens: 1000,
      temperature: 0.7,
    });
    const clientText = clientResult?.choices?.[0]?.message?.content || "Unable to generate briefing at this time.";
    return {
      briefing: clientText,
      generatedAt: new Date().toISOString(),
      stats: {
        openTasks: tasks.rows.length,
        overdueTasks: overdueTasks.length,
        todayTasks: todayTasks.length,
        completedYesterday: recentDone.rows.length,
        activeDeals: teamDeals.rows.length,
        stuckDeals: stuckDeals.length,
        unreadEmails: 0,
      },
    };
  }

  const prompt = `You are the AI briefing assistant for ${userName} at Bruce Gillingham Pollard (BGP), a London commercial property agency. Today is ${todayStr}.

Generate a personalised daily briefing. Be concise, actionable, and warm. Structure it as:

1. **Good morning greeting** — Brief, warm, personalised.

2. **Today at a glance** — Quick bullet summary of what's ahead (meetings count, tasks count, urgent items).

3. **Priority actions** — What needs attention RIGHT NOW. Be specific and actionable. Include deadlines.

4. **Deal momentum** — Brief commentary on active deals, highlight any that need attention.

5. **Inbox intelligence** — If there are notable unread emails, flag the important ones with suggested actions.

6. **Looking ahead** — Any upcoming deadlines or things to prepare for.

Keep the entire briefing under 400 words. Only describe TODAY — do not list tomorrow's meetings. Use a professional but personable tone — like a brilliant PA who knows the business inside out.

Here is ${userName}'s context:

TASKS (${tasks.rows.length} open):
${overdueTasks.length > 0 ? `OVERDUE (${overdueTasks.length}): ${overdueTasks.map((t: any) => `"${t.title}" (due ${new Date(t.due_date).toLocaleDateString("en-GB")})`).join(", ")}` : "No overdue tasks."}
${todayTasks.length > 0 ? `DUE TODAY (${todayTasks.length}): ${todayTasks.map((t: any) => `"${t.title}"`).join(", ")}` : ""}
${tasks.rows.filter((t: any) => t.priority === "urgent" || t.priority === "high").map((t: any) => `[${t.priority.toUpperCase()}] "${t.title}"${t.due_date ? ` (due ${new Date(t.due_date).toLocaleDateString("en-GB")})` : ""}`).join("\n") || "No high-priority tasks."}

COMPLETED YESTERDAY: ${recentDone.rows.length > 0 ? recentDone.rows.map((t: any) => `"${t.title}"`).join(", ") : "None"}

${calendarContext || "No calendar data available."}

${emailContext || "No email data available."}

ACTIVE DEALS (${teamDeals.rows.length} for ${userTeam} team):
${teamDeals.rows.slice(0, 10).map((d: any) => `- ${d.name} — ${d.status}${d.property_name ? ` @ ${d.property_name}` : ""}${d.tenant_name ? ` (tenant: ${d.tenant_name})` : ""}`).join("\n") || "No active deals."}

${stuckDeals.length > 0 ? `DEALS NEEDING ATTENTION (no update 14+ days):\n${stuckDeals.map((d: any) => `- ${d.name} (${d.status}, last updated ${new Date(d.updated_at).toLocaleDateString("en-GB")})`).join("\n")}` : ""}`;

  const { callClaude } = await import("./utils/anthropic-client");
  const briefingResult = await callClaude({
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 1200,
    temperature: 0.7,
  });
  const briefingText = briefingResult?.choices?.[0]?.message?.content || "Unable to generate briefing at this time.";

  return {
    briefing: briefingText,
    generatedAt: new Date().toISOString(),
    stats: {
      openTasks: tasks.rows.length,
      overdueTasks: overdueTasks.length,
      todayTasks: todayTasks.length,
      completedYesterday: recentDone.rows.length,
      activeDeals: teamDeals.rows.length,
      stuckDeals: stuckDeals.length,
      unreadEmails: emailContext ? parseInt(emailContext.match(/\d+/)?.[0] || "0") : 0,
    },
  };
}

async function readCached(userId: string, dateKey: string): Promise<BriefingResult | null> {
  const r = await pool.query(
    `SELECT briefing, stats, generated_at FROM daily_briefings WHERE user_id = $1 AND briefing_date = $2`,
    [userId, dateKey]
  );
  if (!r.rows[0]) return null;
  return {
    briefing: r.rows[0].briefing,
    generatedAt: new Date(r.rows[0].generated_at).toISOString(),
    stats: r.rows[0].stats || {},
  };
}

async function store(userId: string, dateKey: string, result: BriefingResult): Promise<void> {
  await pool.query(
    `INSERT INTO daily_briefings (user_id, briefing_date, briefing, stats, generated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (user_id, briefing_date)
     DO UPDATE SET briefing = EXCLUDED.briefing, stats = EXCLUDED.stats, generated_at = EXCLUDED.generated_at`,
    [userId, dateKey, result.briefing, JSON.stringify(result.stats), result.generatedAt]
  );
}

/** Read-through cache. Returns today's stored briefing if present; otherwise
 *  generates once, stores, and returns it. `force` regenerates (the manual
 *  refresh button). */
export async function getOrCreateTodaysBriefing(
  userId: string,
  msToken: string | null,
  opts: { force?: boolean } = {}
): Promise<BriefingResult> {
  await ensureTable();
  const dateKey = londonDateKey();
  if (!opts.force) {
    const cached = await readCached(userId, dateKey);
    if (cached) return cached;
  }
  const fresh = await generateBriefing(userId, msToken);
  await store(userId, dateKey, fresh).catch((e) => console.warn("[ai-briefing] cache store failed:", e?.message));
  return fresh;
}

/** 6am pre-generation for every active user, so the briefing is already
 *  cached when they open the app. Pulls each user's MS token from their
 *  stored MSAL cache (no HTTP session needed). Sequential + best-effort. */
export async function pregenerateAllBriefings(): Promise<{ generated: number; failed: number }> {
  await ensureTable();
  const dateKey = londonDateKey();
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE is_active IS NOT FALSE AND email LIKE '%@brucegillinghampollard.com'"
  );
  let generated = 0, failed = 0;
  for (const u of rows) {
    try {
      // Skip if already generated for today (e.g. the user opened the app
      // before the cron ran).
      const existing = await readCached(u.id, dateKey);
      if (existing) continue;
      // Best-effort MS token from the user's cached MSAL session.
      let msToken: string | null = null;
      try {
        const { getValidMsToken } = await import("./microsoft");
        msToken = await getValidMsToken({ session: { userId: u.id } } as any);
      } catch { /* no token — briefing generates without calendar/email */ }
      const result = await generateBriefing(u.id, msToken);
      await store(u.id, dateKey, result);
      generated++;
    } catch (e: any) {
      failed++;
      console.warn(`[ai-briefing] pregen failed for ${u.id}:`, e?.message);
    }
  }
  console.log(`[ai-briefing] morning pre-gen: ${generated} generated, ${failed} failed`);
  return { generated, failed };
}
