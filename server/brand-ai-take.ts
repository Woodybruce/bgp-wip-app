// ─────────────────────────────────────────────────────────────────────────
// AI "BGP take" strips — one synthesised paragraph per brand-profile tab.
//
// Each tab (brand / uk / activity / intel) has its own data slice and prompt.
// Output: 60-90 words, BGP-broker tone, actionable.
//
// Cached by (companyId, tab, dataHash) — refreshes only when the underlying
// data has materially changed. Uses Haiku for cost; falls back to Sonnet on
// 5xx, then Opus.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import Anthropic from "@anthropic-ai/sdk";
import { safeParseJSON } from "./utils/anthropic-client";
import crypto from "crypto";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tab-level summaries are quick reads — Haiku is fine. Sonnet/Opus only on retry.
const MODEL_PRIMARY = "claude-haiku-4-5-20251001";
const MODEL_FALLBACK_1 = "claude-sonnet-4-6";
const MODEL_FALLBACK_2 = "claude-opus-4-7";

type Tab = "brand" | "uk" | "activity" | "intel";

const cache = new Map<string, { text: string; generatedAt: number; expiresAt: number; dataHash: string }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

function dataHash(obj: any): string {
  return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
}

// ─── Data slicers ───────────────────────────────────────────────────────
// Each tab pulls only the fields it needs — keeps prompts small/cheap.

async function loadBrandSlice(companyId: string) {
  const { rows } = await pool.query(
    `SELECT name, description, brand_analysis, concept_pitch, store_count, rollout_status,
            backers, employee_count, founded_year, industry, hunter_flag, is_tracked_brand,
            tracking_reason, ai_generated_fields, parent_company_id
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  let parent: string | null = null;
  if (r.parent_company_id) {
    const p = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [r.parent_company_id]);
    parent = p.rows[0]?.name || null;
  }
  return { ...r, parent_name: parent, backers_detail: r.ai_generated_fields?.backers_detail || null };
}

async function loadUkSlice(companyId: string) {
  const { rows } = await pool.query(
    `SELECT name, uk_entity_name, companies_house_number, companies_house_data,
            kyc_status, aml_risk_level
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  const ch = r.companies_house_data || {};
  const profile = ch.profile || {};
  // House covenant score (free-data replacement for Experian/Red Flag) — cached
  // in covenant_reports by the covenant engine; read-only here, never computed inline.
  let covenant: any = null;
  if (r.companies_house_number) {
    const cov = await pool.query(
      `SELECT grade, score, report->'flags' AS flags, report->>'verdict' AS verdict, computed_at
         FROM covenant_reports WHERE company_number = $1`,
      [String(r.companies_house_number).trim().toUpperCase().padStart(8, "0")]
    ).catch(() => ({ rows: [] as any[] }));
    covenant = cov.rows[0] || null;
  }
  // Latest two years of turnover for trend
  const turnoverRows = await pool.query(
    `SELECT period, turnover, source FROM turnover_data
      WHERE company_id = $1 ORDER BY period DESC NULLS LAST LIMIT 3`,
    [companyId]
  ).catch((err: any) => { console.error("[brand-ai-take] turnover query failed:", err?.message); return { rows: [] }; });
  return {
    name: r.name,
    uk_entity: r.uk_entity_name,
    ch_number: r.companies_house_number,
    ch_status: profile.company_status || profile.companyStatus || null,
    incorporation_date: profile.date_of_creation || profile.incorporationDate || null,
    accounts_overdue: !!profile.accounts?.overdue,
    has_charges: !!ch.has_charges,
    insolvency_history: !!ch.has_insolvency_history,
    turnover_history: turnoverRows.rows,
    kyc_status: r.kyc_status,
    aml_risk: r.aml_risk_level,
    covenant: covenant ? {
      grade: covenant.grade,
      score: covenant.score,
      flags: (covenant.flags || []).map((f: any) => f.label),
      verdict: covenant.verdict,
    } : null,
  };
}

async function loadActivitySlice(companyId: string) {
  const company = await pool.query(`SELECT name, bgp_contact_crm FROM crm_companies WHERE id = $1`, [companyId]);
  if (!company.rows[0]) return null;
  const contacts = await pool.query(
    `SELECT name, role FROM crm_contacts WHERE company_id = $1 ORDER BY name ASC LIMIT 12`,
    [companyId]
  );
  const interactions = await pool.query(
    `SELECT COUNT(*)::int AS total,
            MAX(interaction_date) AS last_at,
            COUNT(*) FILTER (WHERE interaction_date >= now() - interval '90 days')::int AS last_90d
       FROM crm_interactions WHERE company_id = $1`,
    [companyId]
  ).catch(() => ({ rows: [{ total: 0, last_at: null, last_90d: 0 }] }));
  const deals = await pool.query(
    `SELECT name, status, deal_type
       FROM crm_deals
      WHERE tenant_id = $1 OR landlord_id = $1 OR vendor_id = $1 OR purchaser_id = $1
      ORDER BY updated_at DESC NULLS LAST LIMIT 10`,
    [companyId]
  );
  const reqs = await pool.query(
    `SELECT name, status, "use", size, requirement_locations
       FROM crm_requirements_leasing
      WHERE company_id = $1 AND status = 'Active' LIMIT 10`,
    [companyId]
  ).catch(() => ({ rows: [] }));
  const lastAt = interactions.rows[0]?.last_at;
  return {
    name: company.rows[0].name,
    lead_broker: company.rows[0].bgp_contact_crm,
    days_since_last_touch: lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000) : null,
    interactions_90d: interactions.rows[0]?.last_90d || 0,
    interactions_total: interactions.rows[0]?.total || 0,
    contacts: contacts.rows.map((r: any) => ({ name: r.name, role: r.role })),
    deals: deals.rows.map((r: any) => ({ name: r.name, status: r.status, type: r.deal_type })),
    active_requirements: reqs.rows,
  };
}

async function loadIntelSlice(companyId: string) {
  const company = await pool.query(
    `SELECT name, hunter_flag, rollout_status, store_count FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  if (!company.rows[0]) return null;
  const signals = await pool.query(
    `SELECT signal_type, headline, signal_date, magnitude, sentiment
       FROM brand_signals WHERE brand_company_id = $1
      ORDER BY COALESCE(signal_date, created_at) DESC LIMIT 10`,
    [companyId]
  );
  const news = await pool.query(
    `SELECT n.title, n.source_name, n.published_at
       FROM news_articles n,
            (SELECT name FROM crm_companies WHERE id = $1) AS co
      WHERE (n.title ILIKE '%' || co.name || '%' OR n.summary ILIKE '%' || co.name || '%'
             OR n.ai_summary ILIKE '%' || co.name || '%')
      ORDER BY n.published_at DESC NULLS LAST LIMIT 6`,
    [companyId]
  ).catch(() => ({ rows: [] }));
  // Every firmographic API we pay for feeds the same read, with fetch
  // dates so the model can weigh freshness and call out stale feeds
  // (Woody, 2026-08-04: "include ai to manage the whole info feedback
  // including our current apis").
  const [apollo, rocketreach, covenant, expansion] = await Promise.all([
    pool.query(`SELECT payload, fetched_at FROM brand_apollo_data WHERE company_id = $1`, [companyId]).catch(() => ({ rows: [] as any[] })),
    pool.query(`SELECT payload, fetched_at FROM brand_rocketreach_data WHERE company_id = $1`, [companyId]).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT cr.grade, cr.computed_at FROM covenant_reports cr
        JOIN crm_companies co ON co.companies_house_number = cr.company_number
       WHERE co.id = $1 ORDER BY cr.computed_at DESC LIMIT 1`, [companyId]).catch(() => ({ rows: [] as any[] })),
    pool.query(`SELECT employee_count, industry, store_count FROM crm_companies WHERE id = $1`, [companyId]).catch(() => ({ rows: [] as any[] })),
  ]);
  const daysOld = (t: any) => t ? Math.floor((Date.now() - new Date(t).getTime()) / 86400000) : null;
  return {
    name: company.rows[0].name,
    hunter_flagged: company.rows[0].hunter_flag,
    rollout: company.rows[0].rollout_status,
    store_count: company.rows[0].store_count,
    signals: signals.rows,
    news_headlines: news.rows.slice(0, 5).map((r: any) => ({
      title: r.title, source: r.source_name,
      days_ago: r.published_at ? Math.floor((Date.now() - new Date(r.published_at).getTime()) / 86400000) : null,
    })),
    api_feeds: {
      apollo: apollo.rows[0] ? { ...apollo.rows[0].payload, days_old: daysOld(apollo.rows[0].fetched_at) } : "never fetched",
      rocketreach: rocketreach.rows[0] ? { ...rocketreach.rows[0].payload, days_old: daysOld(rocketreach.rows[0].fetched_at) } : "never fetched",
      covenant: covenant.rows[0] ? { grade: covenant.rows[0].grade, days_old: daysOld(covenant.rows[0].computed_at) } : "no covenant report",
      crm_record: expansion.rows[0] || null,
    },
  };
}

// ─── Prompt builders ────────────────────────────────────────────────────

function brandPrompt(d: any): string {
  return `You are a senior BGP retail-property broker writing a one-paragraph internal brief on a brand for our team.

Data:
${JSON.stringify(d, null, 2)}

Write a single 60-90 word paragraph covering:
- WHO this brand is (positioning, target customer, scale)
- Where they are in their lifecycle (scaling, mature, contracting, entering UK)
- WHY BGP should care right now (the angle for our team)

Tone: punchy, specific, broker-to-broker. No fluff, no generic phrases. No "this brand is" — go straight to the point. No bullet points, no headers. Plain text only.`;
}

function ukPrompt(d: any): string {
  return `You are a senior BGP retail-property broker writing a one-paragraph covenant verdict on a UK tenant for our team.

Data:
${JSON.stringify(d, null, 2)}

Write a single 60-90 word paragraph covering:
- The covenant verdict (strong / acceptable with conditions / weak)
- Key financial signal driving that verdict (the house covenant grade A-E and its flags if present, turnover trajectory, parent guarantee need, CCJs, etc.)
- A practical recommendation for landlord pitches (e.g. "insist on parent guarantee", "rent cap at X% of turnover", "fine for prime rents")

Tone: direct, broker-to-broker, decisive. Plain text, no bullets, no headers. Use £ for sterling.`;
}

function activityPrompt(d: any): string {
  return `You are a senior BGP retail-property broker writing a one-paragraph relationship read on a tenant for our team.

Data:
${JSON.stringify(d, null, 2)}

Write a single 60-90 word paragraph covering:
- The current relationship temperature (warm / cooling / cold / new)
- Who's the live contact and last touchpoint context
- The next best action (who to contact, what about, why now)

Tone: direct, broker-to-broker. Plain text. No bullets or headers.`;
}

function intelPrompt(d: any): string {
  return `You are a senior BGP retail-property broker writing a short intel read on a tracked brand for our team. You are also the data steward: the api_feeds block shows what each of our paid data feeds (Apollo firmographics, RocketReach, covenant engine) currently holds and how old it is.

Data:
${JSON.stringify(d, null, 2)}

Write ONE 60-90 word paragraph covering:
- What changed about this brand recently (signals + news + firmographic momentum like headcount growth or funding)
- The pattern (expansion mode / quiet / contracting / leadership shake-up)
- What it means for BGP (e.g. "good moment to pitch new sites", "watch for distressed exits")

Then, ONLY if warranted, add one final sentence starting "Data note:" flagging the single most important data problem — sources that disagree (e.g. Apollo employee count vs the CRM record), or a feed that is stale (90+ days) or never fetched. If the feeds agree and are fresh, no Data note.

Tone: direct, broker-to-broker, decisive. Plain text only.`;
}

// ─── Core call ──────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  const models = [MODEL_PRIMARY, MODEL_FALLBACK_1, MODEL_FALLBACK_2];
  let lastErr: any = null;
  for (const model of models) {
    try {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
      if (text) return text;
    } catch (e: any) {
      lastErr = e;
      console.warn(`[brand-ai-take] ${model} failed (${e?.message}), trying next`);
    }
  }
  throw new Error(`AI call failed: ${lastErr?.message || "unknown"}`);
}

async function generateTake(companyId: string, tab: Tab, force = false): Promise<{ text: string; cached: boolean; generatedAt: number }> {
  let slice: any = null;
  let prompt = "";
  switch (tab) {
    case "brand":    slice = await loadBrandSlice(companyId);    prompt = slice ? brandPrompt(slice)    : ""; break;
    case "uk":       slice = await loadUkSlice(companyId);       prompt = slice ? ukPrompt(slice)       : ""; break;
    case "activity": slice = await loadActivitySlice(companyId); prompt = slice ? activityPrompt(slice) : ""; break;
    case "intel":    slice = await loadIntelSlice(companyId);    prompt = slice ? intelPrompt(slice)    : ""; break;
  }
  if (!slice) throw new Error("Company not found");

  const hash = dataHash(slice);
  const cacheKey = `${companyId}:${tab}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && cached.dataHash === hash && Date.now() < cached.expiresAt) {
    return { text: cached.text, cached: true, generatedAt: cached.generatedAt };
  }

  const text = await callClaude(prompt);
  const now = Date.now();
  cache.set(cacheKey, { text, dataHash: hash, generatedAt: now, expiresAt: now + CACHE_TTL_MS });
  return { text, cached: false, generatedAt: now };
}

// ─── Endpoint ───────────────────────────────────────────────────────────

router.get("/api/brand/:companyId/ai-take/:tab", requireAuth, async (req: Request, res: Response) => {
  try {
    const tab = String(req.params.tab) as Tab;
    if (!["brand", "uk", "activity", "intel"].includes(tab)) {
      return res.status(400).json({ error: "invalid tab" });
    }
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    const out = await generateTake(String(req.params.companyId), tab, force);
    res.json(out);
  } catch (err: any) {
    // No AI credentials = environment state, not a server fault.
    if (/api ?key|authentication|authToken/i.test(err.message || "")) {
      return res.status(503).json({ error: "AI take unavailable — AI service is not configured" });
    }
    res.status(500).json({ error: err.message });
  }
});

// Per-brand expansion score — Expansion Intelligence v2 (Woody, 2026-08-03):
// four evidence sub-scores with time decay and why-lines, BGP ground truth
// included. The payload is a superset of the old {expansionScore,
// expansionFlags} shape so existing consumers keep working.
router.get("/api/brand/:companyId/hunter-score", requireAuth, async (req: Request, res: Response) => {
  try {
    const { scoreBrandExpansion } = await import("./expansion-intel");
    const result = await scoreBrandExpansion(String(req.params.companyId));
    if (!result) return res.status(404).json({ error: "not found" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Suggested BGP units ─────────────────────────────────────────────────
// Returns leasing schedule units that could be a good pitch for this brand:
// void/available units not already targeting the brand, ranked by whether
// they're already on a shortlist, size fit, and proximity to requirements.

router.get("/api/brand/:companyId/suggested-units", requireAuth, async (req: Request, res: Response) => {
  const companyId = String(req.params.companyId);
  try {
    const brandQ = await pool.query(
      `SELECT name FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!brandQ.rows[0]) return res.status(404).json({ error: "not found" });
    const brandName = brandQ.rows[0].name as string;

    // Brand's active requirements (locations, sizes). Wrapped in its own
    // try so a missing requirements table doesn't 500 the whole endpoint.
    let reqLocations: string[] = [];
    try {
      const reqQ = await pool.query(
        `SELECT requirement_locations FROM crm_requirements_leasing
          WHERE company_id = $1 AND (status IS NULL OR status ILIKE '%active%')
          LIMIT 5`,
        [companyId]
      );
      reqLocations = reqQ.rows.flatMap((r: any) => r.requirement_locations || []).map((l: string) => l.toLowerCase());
    } catch (e: any) {
      console.warn(`[suggested-units] requirements lookup failed: ${e.message}`);
    }

    // Available leasing schedule units not already targeting this brand.
    // Wrap individually — leasing_schedule_units may lag schema migrations,
    // and we'd rather return [] than 500 the whole brand profile.
    let unitsRows: any[] = [];
    try {
      const unitsQ = await pool.query(
        `SELECT u.id, u.unit_name, u.sqft, u.rent_pa, u.status, u.zone, u.positioning,
                u.optimum_target, u.target_brands, u.priority,
                p.id AS property_id, p.name AS property_name, p.address AS property_address, p.asset_class
           FROM leasing_schedule_units u
           JOIN crm_properties p ON p.id = u.property_id
          WHERE
            (u.status IS NULL
             OR u.status ILIKE '%void%'
             OR u.status ILIKE '%available%'
             OR u.status ILIKE '%vacant%'
             OR (u.status NOT ILIKE '%let%' AND u.status NOT ILIKE '%sold%' AND u.status NOT ILIKE '%complete%'))
            AND NOT ($1 = ANY(COALESCE(u.target_company_ids, '{}'::text[])))
            AND (u.target_brands IS NULL OR u.target_brands NOT ILIKE $2)
          ORDER BY u.rent_pa ASC NULLS LAST
          LIMIT 50`,
        [companyId, `%${brandName}%`]
      );
      unitsRows = unitsQ.rows;
    } catch (e: any) {
      console.warn(`[suggested-units] units lookup failed for ${companyId}: ${e.message}`);
      // Soft-fail with an empty list rather than 500 — the caller treats
      // a missing/empty response as "no suggestions".
      return res.json([]);
    }

    const scored = unitsRows.map((u: any) => {
      let score = 0;
      // crm_properties.address is jsonb — could be { formatted, line1,
      // postcode } (resolver shape) or { city, street, country,
      // postcode } (Apollo shape) or a flat string (legacy). Coerce to
      // a printable string here so the client doesn't have to. Without
      // this React #31 fires when the object lands in JSX directly.
      const addrSrc = u.property_address;
      const addrStr = typeof addrSrc === "string"
        ? addrSrc
        : (addrSrc?.formatted
          || addrSrc?.line1
          || [addrSrc?.street, addrSrc?.city, addrSrc?.postcode, addrSrc?.country].filter(Boolean).join(", ")
          || null);
      const addr = (addrStr || "").toLowerCase();
      const zone = (u.zone || "").toLowerCase();
      if (reqLocations.some(loc => addr.includes(loc) || zone.includes(loc))) score += 10;
      if (u.optimum_target) score += 5;
      if (u.target_brands) score += 3;
      if (u.priority && ["high", "a", "1"].includes(u.priority.toLowerCase())) score += 4;
      return { ...u, property_address: addrStr, matchScore: score };
    });

    scored.sort((a: any, b: any) => b.matchScore - a.matchScore);

    // Diversify across properties — the raw ranking loved to fill every
    // slot from one scheme (O2 Centre × 4). Max two units per property.
    const perProperty = new Map<string, number>();
    const diversified: any[] = [];
    for (const u of scored) {
      const key = String(u.property_id || u.property_address || "?");
      const n = perProperty.get(key) || 0;
      if (n >= 2) continue;
      perProperty.set(key, n + 1);
      diversified.push(u);
      if (diversified.length >= 6) break;
    }

    res.json(diversified);
  } catch (err: any) {
    console.error(`[suggested-units] ${companyId}: ${err.message}`);
    res.json([]);
  }
});

// ─── Per-brand Intel refresh ─────────────────────────────────────────────
// Fetches the brand's Google News RSS feed, inserts new articles, links them
// as brand_signals, then busts the intel AI-take cache so the next GET
// returns a fresh paragraph.

router.post("/api/brand/:companyId/refresh-intel", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);

    // 1. Get brand
    const brandQ = await pool.query(
      `SELECT name, industry FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!brandQ.rows[0]) return res.status(404).json({ error: "not found" });
    const { name, industry } = brandQ.rows[0];

    // 2. Build the same Google News RSS URL the nightly job uses
    const { googleNewsRssUrl } = await import("./rssapp");
    const ind = (industry || "").toLowerCase();
    const industryHint =
      /fashion|apparel|retail|streetwear|luxury|denim/.test(ind) ? " (fashion OR retail OR store OR shop)"
      : /food|restaurant|qsr|hospitality|coffee|cafe/.test(ind) ? " (restaurant OR cafe OR food OR menu)"
      : /beauty|skincare|cosmetic/.test(ind) ? " (beauty OR skincare OR cosmetics)"
      : /fitness|gym|wellness/.test(ind) ? " (gym OR fitness OR studio)"
      : "";
    const shortName = name.trim();
    const queryStr = shortName.length <= 3 ? `"${shortName}" (retail OR store OR UK)` : `"${shortName}" UK${industryHint}`;
    const feedUrl = googleNewsRssUrl(queryStr);

    // 3. Fetch RSS
    const Parser = (await import("rss-parser")).default;
    const parser = new Parser({ timeout: 12000, headers: { "User-Agent": "BGP-Dashboard/1.0" } });
    let items: any[] = [];
    try {
      const feed = await parser.parseURL(feedUrl);
      items = feed.items?.slice(0, 20) || [];
    } catch (e: any) {
      return res.json({ added: 0, signalsLinked: 0, warning: `Google News fetch failed: ${e.message}` });
    }

    // 4. Insert new articles
    let added = 0;
    const newArticleIds: string[] = [];
    for (const item of items) {
      if (!item.title || !item.link) continue;
      const existingR = await pool.query(`SELECT id FROM news_articles WHERE url = $1`, [item.link]);
      if (existingR.rows.length > 0) continue;
      const pub = item.isoDate || item.pubDate ? new Date(item.isoDate || item.pubDate) : null;
      const ins = await pool.query(
        `INSERT INTO news_articles (title, summary, url, source_name, published_at, category)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          item.title,
          item.contentSnippet || item.content || null,
          item.link,
          "Google News",
          pub,
          "general",
        ]
      );
      if (ins.rows[0]?.id) { newArticleIds.push(ins.rows[0].id); added++; }
    }

    // 5. Link new articles as brand_signals for this brand. The name-regex
    //    alone was a disaster for short/ambiguous names — "Bill's" (the
    //    restaurant) collected Buffalo Bills scores from ESPN — so candidates
    //    now pass a Haiku relevance gate before they become signals.
    const normalizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9& ]+/g, "")
      .replace(/\b(ltd|limited|plc|uk|holdings|group)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const candidates: { id: string; title: string; summary: string | null; url: string; published_at: any }[] = [];
    for (const articleId of newArticleIds) {
      const aR = await pool.query(
        `SELECT title, summary, ai_summary, url, published_at FROM news_articles WHERE id = $1`,
        [articleId]
      );
      const a = aR.rows[0];
      if (!a) continue;
      const hay = [a.title, a.summary || "", a.ai_summary || ""].join(" ").toLowerCase();
      const re = new RegExp(
        `(^|[^a-z0-9])${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
        "i"
      );
      if (!re.test(hay)) continue;
      candidates.push({ id: articleId, title: a.title, summary: a.summary, url: a.url, published_at: a.published_at });
    }

    const relevant = await screenArticlesForBrand(name, industry, candidates.map(c => ({ title: c.title, summary: c.summary })));
    let signalsLinked = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (!relevant.has(i)) continue;
      const a = candidates[i];
      const dup = await pool.query(
        `SELECT id FROM brand_signals WHERE brand_company_id = $1 AND source = $2`,
        [companyId, a.url]
      );
      if (dup.rows.length > 0) continue;
      await pool.query(
        `INSERT INTO brand_signals (brand_company_id, signal_type, headline, detail, signal_date, source, sentiment, magnitude, ai_generated)
         VALUES ($1, 'news', $2, $3, $4, $5, 'neutral', 'low', true)`,
        [companyId, a.title, a.summary || null, a.published_at || null, a.url]
      );
      signalsLinked++;
    }

    // 5b. Re-screen the brand's existing recent signals so junk that got in
    //     before the gate (sports scores, other companies) cleans itself up
    //     on the next intel refresh.
    const purged = await rescreenBrandSignals(companyId, name, industry).catch(() => 0);

    // 6. Bust intel AI-take cache so next GET regenerates
    cache.delete(`${companyId}:intel`);

    res.json({ added, signalsLinked, purged });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Signal relevance screening ──────────────────────────────────────────
// One Haiku call answering "which of these items are actually about THIS
// brand?" — the defence against ambiguous names (Bill's the restaurant vs
// the Buffalo Bills, O2 the venue vs O2 the telco).

async function screenArticlesForBrand(
  brandName: string,
  industry: string | null,
  items: { title: string; summary?: string | null }[]
): Promise<Set<number>> {
  if (items.length === 0) return new Set();
  const listing = items.map((a, i) => `${i}. ${a.title}${a.summary ? ` — ${String(a.summary).slice(0, 140)}` : ""}`).join("\n");
  const prompt = `"${brandName}" is a UK ${industry || "retail/hospitality"} brand tracked by a commercial property agency.

Which of these news items are genuinely about ${brandName} the ${industry || "retail/hospitality"} BRAND (its stores, sites, trading, funding, people)?

DISCARD items about anything else that shares the name — sports teams and fixtures, people, places, songs, US chains, or other companies. DISCARD items where ${brandName} is only mentioned in passing and the story is about a different company.

Items:
${listing}

Return ONLY a JSON array of the relevant item numbers, e.g. [0,3]. If none are relevant return [].`;
  try {
    const r = await anthropic.messages.create({ model: MODEL_PRIMARY, max_tokens: 200, messages: [{ role: "user", content: prompt }] });
    const text = r.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    const arr = safeParseJSON(text);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((n: any) => Number.isInteger(n) && n >= 0 && n < items.length));
  } catch (e: any) {
    // Screening unavailable → keep nothing rather than let junk through;
    // the next refresh retries.
    console.warn(`[signal-screen] ${brandName}: ${e?.message}`);
    return new Set();
  }
}

// Re-screen a brand's stored signals and delete the ones that aren't about
// the brand. Deal learnings (source bgp-deal:*) and hand-entered rows with
// no source are never touched. Returns how many were purged.
export async function rescreenBrandSignals(companyId: string, brandName: string, industry: string | null): Promise<number> {
  const sq = await pool.query(
    `SELECT id, headline, detail FROM brand_signals
      WHERE brand_company_id = $1
        AND (source IS NULL OR source NOT LIKE 'bgp-deal:%')
        AND ai_generated IS NOT FALSE
      ORDER BY created_at DESC
      LIMIT 40`,
    [companyId]
  );
  const rows = sq.rows;
  if (rows.length === 0) return 0;
  const keep = await screenArticlesForBrand(brandName, industry, rows.map((r: any) => ({ title: r.headline, summary: r.detail })));
  // A failed screen returns an empty set — treat "keep nothing" as "screen
  // unavailable" when there were candidates, to avoid wiping real signals.
  if (keep.size === 0 && rows.length > 3) return 0;
  const toDelete = rows.filter((_: any, i: number) => !keep.has(i)).map((r: any) => r.id);
  if (toDelete.length === 0) return 0;
  await pool.query(`DELETE FROM brand_signals WHERE id = ANY($1)`, [toDelete]);
  console.log(`[signal-screen] ${brandName}: purged ${toDelete.length} irrelevant signals`);
  return toDelete.length;
}

// Manual re-screen — staff can clean a polluted brand immediately.
router.post("/api/brand/:companyId/signals/rescreen", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const bq = await pool.query(`SELECT name, industry FROM crm_companies WHERE id = $1`, [companyId]);
    if (!bq.rows[0]) return res.status(404).json({ error: "not found" });
    const purged = await rescreenBrandSignals(companyId, bq.rows[0].name, bq.rows[0].industry);
    invalidateBrandAiTake(companyId);
    res.json({ purged });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function invalidateBrandAiTake(companyId: string): void {
  for (const tab of ["brand", "uk", "activity", "intel"] as Tab[]) {
    cache.delete(`${companyId}:${tab}`);
  }
}

export default router;
