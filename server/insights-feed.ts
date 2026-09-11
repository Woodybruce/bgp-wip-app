// ─────────────────────────────────────────────────────────────────────────
// Insights feed — one event-driven brain, many surfaces.
//
// (Jonathan via Woody, 2026-08-04: a knowledge centre that sits next to
// News, learns as material arrives, and stays relevant to Landsec.)
//
// Three ingest legs, one output stream:
//   news            — new tagged articles since the last cursor, distilled
//                     against the ACTIVE THEMES so repetition strengthens a
//                     theme instead of duplicating a card
//   market-report   — newsletter/report emails from trade publishers
//                     (Propel, Green Street News, EG, Property Week…),
//                     swept from the ChatBGP mailbox AND every active
//                     staff mailbox — the paid feeds land with individuals
//   portfolio       — client-safe activity spikes (viewings/offers on the
//                     client's own portfolio; never BGP email content)
//
// Clearance: every insight carries an audience — 'all' (public-source,
// client-visible within their categories) or 'staff'. Client-specific
// activity insights carry their company_id. The GET endpoint enforces this;
// the daily briefing and digest emails draw from the same stream.
//
// Near-real-time: legs run on a 30-minute tick (production), each with a
// cursor so quiet ticks cost nothing.
// ─────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";

const INSIGHT_CATEGORIES = ["hospitality", "retail", "leisure", "fitness", "investment", "offices", "market"] as const;
// The slice a Landsec-type client sees (mirrors CLIENT_CRM_CATEGORIES intent).
const CLIENT_INSIGHT_CATEGORIES = ["hospitality", "retail", "leisure", "fitness", "market"];

// Publisher senders and where we're allowed to harvest them.
//   any    — pure trade publishers: everything they send is editorial, safe
//            to read from any staff mailbox. Suffix match also covers their
//            sending subdomains (no-reply@email.propertyweek.com etc.).
//   shared — agent/data firms whose newsletters land at the shared ChatBGP
//            inbox. Staff mailboxes hold REAL correspondence with these
//            firms (deals, negotiations) which must never enter the feed.
const REPORT_SENDER_RULES: { domain: string; scope: "any" | "shared" }[] = [
  { domain: "propelinfo.com", scope: "any" },        // verified: paul.charity@propelinfo.com
  { domain: "propelhospitality.com", scope: "any" },
  { domain: "greenstreetnews.com", scope: "any" },   // GSN bulletins (greenstreet.com is the data firm, below)
  { domain: "propertyweek.com", scope: "any" },      // verified: no-reply@email.propertyweek.com
  { domain: "estatesgazette.com", scope: "any" },
  { domain: "egi.co.uk", scope: "any" },
  { domain: "reactnews.com", scope: "any" },
  { domain: "bisnow.com", scope: "any" },
  { domain: "drapers.com", scope: "any" },
  { domain: "retail-week.com", scope: "any" },
  { domain: "businessoffashion.com", scope: "any" },
  { domain: "voguebusiness.com", scope: "any" },
  { domain: "knightfrank.com", scope: "shared" },
  { domain: "savills.com", scope: "shared" },
  { domain: "costar.com", scope: "shared" },
  { domain: "cbre.com", scope: "shared" },
  { domain: "greenstreet.com", scope: "shared" },
];

function matchReportSender(from: string, isSharedInbox: boolean): boolean {
  const f = (from || "").toLowerCase();
  return REPORT_SENDER_RULES.some(r =>
    (isSharedInbox || r.scope === "any") &&
    (f.endsWith(`@${r.domain}`) || f.endsWith(`.${r.domain}`))
  );
}

async function ensureTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_themes (
      id SERIAL PRIMARY KEY,
      theme_key TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      direction TEXT,
      strength INT DEFAULT 1,
      first_seen TIMESTAMP DEFAULT now(),
      last_confirmed TIMESTAMP DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insights (
      id SERIAL PRIMARY KEY,
      theme_id INT,
      headline TEXT NOT NULL,
      detail TEXT,
      category TEXT,
      audience TEXT NOT NULL DEFAULT 'all',   -- all | staff | client
      company_id VARCHAR,                     -- set for client-specific rows
      source_kind TEXT NOT NULL,              -- news | market-report | portfolio
      evidence JSONB,
      created_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_insights_created ON insights (created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_state (
      key TEXT PRIMARY KEY,
      cursor TIMESTAMP
    )`);
  // Cross-tick dedupe for the report leg: the same Propel edition lands in
  // ~15 mailboxes, and copies can straddle a tick boundary — sender+subject+
  // day keys mark what's already been distilled. Pruned after 14 days.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_processed_emails (
      key TEXT PRIMARY KEY,
      processed_at TIMESTAMP DEFAULT now()
    )`);
}

async function getCursor(key: string): Promise<Date | null> {
  const r = await pool.query(`SELECT cursor FROM insight_state WHERE key = $1`, [key]);
  return r.rows[0]?.cursor ? new Date(r.rows[0].cursor) : null;
}
async function setCursor(key: string, when: Date): Promise<void> {
  await pool.query(
    `INSERT INTO insight_state (key, cursor) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET cursor = $2`, [key, when]);
}

async function activeThemes(limit = 20): Promise<any[]> {
  const r = await pool.query(
    `SELECT theme_key, title, category, direction, strength,
            to_char(first_seen, 'DD Mon') AS first_seen
       FROM insight_themes
      WHERE last_confirmed > now() - interval '60 days'
      ORDER BY last_confirmed DESC LIMIT $1`, [limit]);
  return r.rows;
}

// The distiller — shared by the news and market-report legs. Claude sees the
// fresh material AND the active themes, and answers with insights that either
// open a new theme or strengthen an existing one.
async function distil(materialLabel: string, material: string, sourceKind: "news" | "market-report", evidence: any[]): Promise<number> {
  const themes = await activeThemes();
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `You are the market-intelligence brain of a UK retail/hospitality property brokerage. Distil the fresh material below into AT MOST 3 insights a landlord or leasing broker would act on. Fewer is better; return an empty list if nothing is genuinely new or decision-relevant.

ACTIVE THEMES (strengthen one of these rather than restating it):
${JSON.stringify(themes, null, 1)}

FRESH MATERIAL (${materialLabel}):
${material.slice(0, 9000)}

Rules:
- An insight is a market pattern or a concrete operator move, NOT a news summary.
- If the material confirms an active theme, reference its theme_key; the card should say what's NEW about the confirmation.
- category: one of ${JSON.stringify(INSIGHT_CATEGORIES)}.
- Everything here is public-source, so audience is "all".

Reply with ONLY JSON:
{"insights": [{"headline": "<max 90 chars, decisive>", "detail": "<1-2 sentences, why it matters>", "category": "...", "theme_key": "<existing key or new kebab-case key>", "theme_title": "<short theme name>", "direction": "growing"|"fading"|"steady"}]}`;

  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let parsed: any;
  try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); }
  catch { return 0; }

  let inserted = 0;
  for (const ins of (parsed.insights || []).slice(0, 3)) {
    if (!ins.headline || !ins.theme_key) continue;
    const theme = await pool.query(
      `INSERT INTO insight_themes (theme_key, title, category, direction, strength, first_seen, last_confirmed)
       VALUES ($1, $2, $3, $4, 1, now(), now())
       ON CONFLICT (theme_key) DO UPDATE
         SET strength = insight_themes.strength + 1, last_confirmed = now(),
             direction = COALESCE($4, insight_themes.direction)
       RETURNING id, strength`, [ins.theme_key, ins.theme_title || ins.headline, ins.category || "market", ins.direction || "steady"]);
    await pool.query(
      `INSERT INTO insights (theme_id, headline, detail, category, audience, source_kind, evidence)
       VALUES ($1, $2, $3, $4, 'all', $5, $6)`,
      [theme.rows[0].id, ins.headline, ins.detail || null, ins.category || "market", sourceKind, JSON.stringify(evidence.slice(0, 6))]);
    inserted++;
  }
  return inserted;
}

// Leg 1 — news. Batches every article since the cursor; skips quiet ticks.
export async function runNewsLeg(): Promise<number> {
  await ensureTables();
  const cursor = (await getCursor("news")) || new Date(Date.now() - 24 * 3600 * 1000);
  const arts = await pool.query(
    `SELECT id, title, source_name, summary, ai_summary, url, published_at
       FROM news_articles
      WHERE fetched_at > $1
      ORDER BY fetched_at ASC LIMIT 60`, [cursor]);
  if (arts.rows.length < 5) return 0; // wait for a meaningful batch
  const material = arts.rows.map((a: any) =>
    `- [${a.source_name || "?"}] ${a.title}: ${(a.ai_summary || a.summary || "").slice(0, 220)}`).join("\n");
  const evidence = arts.rows.slice(0, 6).map((a: any) => ({ type: "article", id: a.id, title: a.title, url: a.url }));
  const n = await distil(`${arts.rows.length} trade articles`, material, "news", evidence);
  await setCursor("news", new Date());
  console.log(`[insights] news leg: ${arts.rows.length} articles → ${n} insights`);
  return n;
}

// Leg 2 — market-report emails from trade publishers. Sweeps the shared
// ChatBGP inbox PLUS every active staff mailbox (EG Daily only lands with
// individuals; GSN bulletins hit personal inboxes) — the sender rules keep
// BGP's real correspondence out of the feed, and agent-firm domains are
// only ever read from the shared inbox.
export async function runReportLeg(): Promise<number> {
  await ensureTables();
  const cursor = (await getCursor("reports")) || new Date(Date.now() - 24 * 3600 * 1000);
  const since = cursor.toISOString();

  const mailboxes: { address: string; shared: boolean }[] = [
    { address: "chatbgp@brucegillinghampollard.com", shared: true },
  ];
  try {
    const staff = await pool.query(
      `SELECT DISTINCT lower(COALESCE(NULLIF(TRIM(email), ''), username)) AS addr
         FROM users
        WHERE COALESCE(is_active, true)
          AND COALESCE(role, '') <> 'Client'
          AND lower(COALESCE(NULLIF(TRIM(email), ''), username)) LIKE '%@brucegillinghampollard.com'`);
    for (const r of staff.rows) {
      if (r.addr && r.addr !== "chatbgp@brucegillinghampollard.com") {
        mailboxes.push({ address: r.addr, shared: false });
      }
    }
  } catch (e: any) {
    console.warn("[insights] staff mailbox list failed:", e?.message);
  }

  const candidates: any[] = [];
  try {
    const { graphRequest } = await import("./shared-mailbox");
    for (const mb of mailboxes) {
      try {
        const r = await graphRequest(
          `/users/${encodeURIComponent(mb.address)}/messages?$filter=receivedDateTime gt ${since}&$top=30&$select=subject,from,receivedDateTime,bodyPreview,body&$orderby=receivedDateTime asc`);
        for (const m of r?.value || []) {
          const from = (m.from?.emailAddress?.address || "").toLowerCase();
          if (matchReportSender(from, mb.shared)) candidates.push(m);
        }
      } catch (e: any) {
        // Unlicensed / missing mailboxes 404 — skip quietly, sweep the rest.
        console.warn(`[insights] mailbox sweep skipped ${mb.address}:`, String(e?.message || "").slice(0, 140));
      }
    }
  } catch (e: any) {
    console.warn("[insights] report leg mailbox read failed:", e?.message);
    return 0;
  }
  if (!candidates.length) { await setCursor("reports", new Date()); return 0; }

  // Dedupe: 15 copies of one edition = one processing pass. In-batch via the
  // seen set, cross-tick via insight_processed_emails.
  const keyOf = (m: any) => {
    const from = (m.from?.emailAddress?.address || "").toLowerCase();
    const day = String(m.receivedDateTime || "").slice(0, 10);
    return `${from}|${String(m.subject || "").trim().toLowerCase()}|${day}`;
  };
  const seen = new Set<string>();
  const fresh: any[] = [];
  for (const m of candidates.sort((a, b) => String(a.receivedDateTime).localeCompare(String(b.receivedDateTime)))) {
    const k = keyOf(m);
    if (seen.has(k)) continue;
    seen.add(k);
    const done = await pool.query(`SELECT 1 FROM insight_processed_emails WHERE key = $1`, [k]);
    if (!done.rows.length) fresh.push(m);
  }
  await pool.query(`DELETE FROM insight_processed_emails WHERE processed_at < now() - interval '14 days'`).catch(() => {});

  const CAP = 12; // per-tick processing budget across the whole sweep
  const toProcess = fresh.slice(0, CAP);
  let total = 0;
  let earliestFailure: string | null = null;
  for (const m of toProcess) {
    try {
      const bodyText = String(m.body?.content || m.bodyPreview || "")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000);
      const from = m.from?.emailAddress?.address || "publisher";
      total += await distil(
        `market update email from ${from}: "${m.subject}"`, bodyText, "market-report",
        [{ type: "report-email", title: m.subject, from, date: m.receivedDateTime }]);
      // Same email, second harvest: per-brand events → brand_signals, so the
      // Propel round-up feeds the expansion engine + daily alerts, not just
      // the Insights cards.
      try {
        const { extractBrandSignalsFromNewsletter } = await import("./news-brand-linking");
        const n = await extractBrandSignalsFromNewsletter({ subject: m.subject, from, bodyText, receivedAt: m.receivedDateTime });
        if (n > 0) console.log(`[insights] "${m.subject}" → ${n} brand signal(s)`);
      } catch (e: any) {
        console.warn("[insights] newsletter brand-signal extraction failed:", e?.message);
      }
      await pool.query(
        `INSERT INTO insight_processed_emails (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, [keyOf(m)]);
    } catch (e: any) {
      // Unmarked → the cursor below parks before it, so it retries next tick.
      console.warn(`[insights] report email failed ("${m.subject}"):`, e?.message);
      if (!earliestFailure || String(m.receivedDateTime) < earliestFailure) {
        earliestFailure = String(m.receivedDateTime);
      }
    }
  }

  // Park the cursor so nothing is lost: just before the earliest failure, or
  // at the last processed edition when the cap left some unprocessed (the
  // dedupe table stops the succeeded ones re-running).
  const capped = fresh.length > toProcess.length && toProcess.length > 0;
  await setCursor("reports", earliestFailure
    ? new Date(new Date(earliestFailure).getTime() - 1000)
    : capped
    ? new Date(toProcess[toProcess.length - 1].receivedDateTime)
    : new Date());
  console.log(`[insights] report leg: ${mailboxes.length} mailboxes, ${candidates.length} publisher emails, ${fresh.length} new → ${total} insights`);
  return total;
}

// Leg 3 — client-safe portfolio activity. Template-generated (no AI):
// a spike of viewings/offers in a category on the client's own portfolio.
// Never reads email content — activity rows only.
export async function runPortfolioLeg(): Promise<number> {
  await ensureTables();
  const cursor = (await getCursor("portfolio")) || new Date(Date.now() - 48 * 3600 * 1000);
  const spikes = await pool.query(`
    SELECT p.landlord_id AS company_id, co.name AS landlord_name,
           COALESCE(t.company_type, 'other') AS tenant_type,
           count(*)::int AS n
      FROM unit_viewings v
      JOIN available_units u ON u.id = v.unit_id
      JOIN crm_properties p ON p.id = u.property_id
      JOIN crm_companies co ON co.id = p.landlord_id
      LEFT JOIN crm_companies t ON t.id = v.company_id
     WHERE v.created_at > $1 AND p.landlord_id IS NOT NULL
     GROUP BY p.landlord_id, co.name, t.company_type
    HAVING count(*) >= 3`, [cursor]);
  let inserted = 0;
  for (const s of spikes.rows) {
    const cat = (s.tenant_type || "").replace(/^tenant\s*-\s*/i, "").toLowerCase() || "operators";
    await pool.query(
      `INSERT INTO insights (headline, detail, category, audience, company_id, source_kind, evidence)
       VALUES ($1, $2, 'market', 'client', $3, 'portfolio', $4)`,
      [`${s.n} viewings from ${cat} operators across your portfolio in 48 hours`,
       `Momentum cluster in ${cat} — worth reviewing which units they saw and following up while interest is warm.`,
       s.company_id,
       JSON.stringify([{ type: "activity", detail: `${s.n} viewings, tenant type ${s.tenant_type}` }])]);
    inserted++;
  }
  await setCursor("portfolio", new Date());
  if (inserted) console.log(`[insights] portfolio leg: ${inserted} client insights`);
  return inserted;
}

export function setupInsightsRoutes(app: Express): void {
  app.get("/api/insights", requireAuth, async (req: Request, res: Response) => {
    try {
      await ensureTables();
      const limit = Math.min(50, parseInt(String(req.query.limit || "30")) || 30);
      const { resolveCompanyScope } = await import("./company-scope");
      const scope = await resolveCompanyScope(req as any);
      const q = scope
        ? pool.query(
            `SELECT i.*, t.title AS theme_title, t.strength AS theme_strength, t.first_seen AS theme_first_seen
               FROM insights i LEFT JOIN insight_themes t ON t.id = i.theme_id
              WHERE (i.audience = 'all' AND i.category = ANY($2))
                 OR (i.audience = 'client' AND i.company_id = $3)
              ORDER BY i.created_at DESC LIMIT $1`,
            [limit, CLIENT_INSIGHT_CATEGORIES, scope])
        : pool.query(
            `SELECT i.*, t.title AS theme_title, t.strength AS theme_strength, t.first_seen AS theme_first_seen
               FROM insights i LEFT JOIN insight_themes t ON t.id = i.theme_id
              ORDER BY i.created_at DESC LIMIT $1`, [limit]);
      res.json({ insights: (await q).rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Manual trigger (staff) — run all three legs now.
  app.post("/api/insights/run", requireAuth, async (req: Request, res: Response) => {
    try {
      const { isClientRequestUser } = await import("./company-scope");
      if (await isClientRequestUser(req as any)) return res.status(403).json({ error: "Not available for client accounts" });
      const [news, reports, portfolio] = await Promise.all([
        runNewsLeg().catch(e => { console.warn("[insights] news leg:", e?.message); return 0; }),
        runReportLeg().catch(e => { console.warn("[insights] report leg:", e?.message); return 0; }),
        runPortfolioLeg().catch(e => { console.warn("[insights] portfolio leg:", e?.message); return 0; }),
      ]);
      res.json({ news, reports, portfolio });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}

// The 30-minute tick. Production only; each leg's cursor makes quiet ticks free.
export function startInsightsLoop(): void {
  if (process.env.NODE_ENV !== "production") return;
  setTimeout(() => { runAll(); }, 90_000);
  setInterval(() => { runAll(); }, 30 * 60 * 1000);
  async function runAll() {
    await runNewsLeg().catch(e => console.warn("[insights] news leg failed:", e?.message));
    await runReportLeg().catch(e => console.warn("[insights] report leg failed:", e?.message));
    await runPortfolioLeg().catch(e => console.warn("[insights] portfolio leg failed:", e?.message));
  }
}

// For the daily briefing / digest emails — the same stream, last 24h.
export async function latestInsightsForEmail(limit = 3): Promise<any[]> {
  await ensureTables();
  const r = await pool.query(
    `SELECT i.headline, i.detail, i.category, t.title AS theme_title, t.strength AS theme_strength
       FROM insights i LEFT JOIN insight_themes t ON t.id = i.theme_id
      WHERE i.audience = 'all' AND i.created_at > now() - interval '24 hours'
      ORDER BY i.created_at DESC LIMIT $1`, [limit]);
  return r.rows;
}
