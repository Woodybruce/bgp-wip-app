// The board report's market report (Woody, 2026-11-19: "we can use the app to
// provide a market report in each subsection"; "this is Me and Mark working
// together to provide overall analysis for him to present each quarter").
//
// WRITTEN BY PEOPLE. One box per section (Overall, and one per brief-category
// group). What is saved is what the board report prints; a section with
// nothing saved is not printed, and a draft is never printed until a person
// has saved it.
//
//  - Stored with no schema change: one JSON value in system_settings per
//    period and set of schemes (boardMarketSettingsKey), with who saved each
//    section and when.
//  - Who reads and saves: BGP staff and a Landsec login (the people the
//    reports are for; reportViewer). A joint agent, and any other client's
//    login, gets nothing: the gateway refuses /api/landsec/reports for a
//    joint agent and reportViewer refuses again here.
//  - Draft is for BGP staff signed in as themselves only. Anthropic, called
//    directly, one call a section, capped a day
//    (LANDSEC_BOARD_DRAFT_DAILY_CAP, default 40, 0 = off). It is sent the
//    lines the pack already prints for a Landsec login, dated public brand
//    signals with a source link, and dated competing-centre research with a
//    source link, and told to write nothing else (the request and its checks
//    are shared/landsec-board-report.ts). The draft only fills the box on the
//    screen: Save is the one write.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { contactViewer } from "./contact-viewer";
import { pickSchemes, reportSchemesFor, reportViewer, type ReportScheme } from "./landsec-reports";
import { resolveLandsecPortfolio } from "./landsec-schemes";
import type { LandsecViewer } from "./landsec-access";
import { parseReportPeriod, type ReportPeriod } from "@shared/landsec-reports";
import {
  BOARD_MARKET_SECTIONS, boardMarketSection, boardMarketSettingsKey, boardSchemeSet, cleanMarketDraft, cleanMarketText, draftFiguresNotSent, marketDraftPrompt,
  type BoardMarket, type BoardMarketKey, type BoardMarketReply, type BoardMarketSaved, type MarketDraftInput, type MarketResearch, type MarketSignal,
} from "@shared/landsec-board-report";

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };

export class BoardMarketError extends Error { constructor(public status: number, message: string) { super(message); } }

const USAGE_KEY = "landsec_board_draft_usage";
const FEATURE = "landsec-board-report";

export function boardDraftDailyCap(): number {
  const raw = process.env.LANDSEC_BOARD_DRAFT_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 40;
}

// ── The store ────────────────────────────────────────────────────────────

/** A short hash of the scheme set: the same schemes give the same key whoever asks. */
export const schemeDigest = (keys: string[]): string => crypto.createHash("sha256").update(boardSchemeSet(keys)).digest("hex").slice(0, 16);
export const marketKeyFor = (period: Pick<ReportPeriod, "from" | "to">, schemeKeys: string[]): string => boardMarketSettingsKey(period.from, period.to, schemeDigest(schemeKeys));

function savedOf(value: any): BoardMarket {
  const out: BoardMarket = {};
  const sections = value && typeof value === "object" && value.sections && typeof value.sections === "object" ? value.sections : {};
  for (const s of BOARD_MARKET_SECTIONS) {
    const row = sections[s.key];
    const text = cleanMarketText(row?.text);
    if (!text) continue;
    out[s.key] = { text, savedBy: String(row.savedBy || "").slice(0, 120), savedByFirm: row.savedByFirm === "Landsec" ? "Landsec" : "BGP", savedAt: String(row.savedAt || "") };
  }
  return out;
}

/** The saved sections for a period and a set of schemes. */
export async function loadBoardMarket(period: Pick<ReportPeriod, "from" | "to">, schemeKeys: string[], db: Queryable = pool): Promise<BoardMarket> {
  const row = (await db.query(`/* landsec-board-market:load */ SELECT value FROM system_settings WHERE key = $1`, [marketKeyFor(period, schemeKeys)])).rows[0];
  return savedOf(row?.value);
}

/**
 * Save one section (empty text clears it). `loadedAt` is the section's saved
 * time as the editor read it ("" when it read none): a save over somebody
 * else's newer text is refused, so two people working on the same report do
 * not lose each other's words.
 */
export async function saveBoardMarketSection(
  input: { period: Pick<ReportPeriod, "from" | "to">; schemeKeys: string[]; key: BoardMarketKey; text: unknown; loadedAt: unknown; who: { name: string; firm: "BGP" | "Landsec" }; now?: Date },
  connect: () => Promise<{ query: Queryable["query"]; release: () => void }> = () => pool.connect() as any,
): Promise<BoardMarket> {
  const text = cleanMarketText(input.text);
  const settingsKey = marketKeyFor(input.period, input.schemeKeys);
  const db = await connect();
  try {
    await db.query("BEGIN");
    await db.query(
      `/* landsec-board-market:start */ INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
      [settingsKey, JSON.stringify({ from: input.period.from, to: input.period.to, schemes: boardSchemeSet(input.schemeKeys).split(",").filter(Boolean), sections: {} })]);
    const held = (await db.query(`/* landsec-board-market:lock */ SELECT value FROM system_settings WHERE key = $1 FOR UPDATE`, [settingsKey])).rows[0]?.value || {};
    const now = savedOf(held)[input.key];
    if ((now?.savedAt || "") !== String(input.loadedAt || "")) {
      throw new BoardMarketError(409, now ? `${now.savedBy || "Someone"} saved this section after you opened it. Reload to see their text before saving yours.` : "This section was cleared after you opened it. Reload before saving.");
    }
    const sections = { ...(held.sections && typeof held.sections === "object" ? held.sections : {}) };
    if (text) {
      const saved: BoardMarketSaved = { text, savedBy: input.who.name, savedByFirm: input.who.firm, savedAt: (input.now || new Date()).toISOString() };
      sections[input.key] = saved;
    } else delete sections[input.key];
    const value = { ...held, sections };
    await db.query(`/* landsec-board-market:save */ UPDATE system_settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`, [settingsKey, JSON.stringify(value)]);
    await db.query("COMMIT");
    return savedOf(value);
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

// ── The draft ────────────────────────────────────────────────────────────

const monthOf = (date: unknown): string | null => { const m = /^(\d{4}-\d{2})/.exec(String(date ?? "")); return m ? m[1] : null; };
const inMonths = (date: unknown, period: Pick<ReportPeriod, "from" | "to">): boolean => { const m = monthOf(date); return !!m && m >= period.from && m <= period.to; };

/** Dated public signals, each with a source link, for the brands given. Nothing typed by BGP and nothing marked a rumour. */
export async function marketSignals(brands: Map<string, string>, period: ReportPeriod, db: Queryable = pool): Promise<MarketSignal[]> {
  if (brands.size === 0) return [];
  const rows = (await db.query(
    `/* landsec-board-market:signals */
     SELECT s.brand_company_id, s.signal_type, s.headline, s.source, s.signal_date
       FROM brand_signals s
      WHERE s.brand_company_id = ANY($1::varchar[]) AND s.source ~* '^https?://'
        AND s.signal_date >= $2::date AND s.signal_date < $3::date
        AND COALESCE(s.signal_type, '') <> 'rumour' AND COALESCE(s.confidence, '') <> 'rumour'
      ORDER BY s.signal_date DESC LIMIT 300`, [Array.from(brands.keys()), period.start, period.end])).rows;
  const seen = new Set<string>();
  const out: MarketSignal[] = [];
  for (const r of rows) {
    const headline = String(r.headline || "").trim();
    const mark = headline.toLowerCase();
    if (!headline || seen.has(mark) || out.length >= 30) continue;
    seen.add(mark);
    out.push({ date: r.signal_date ? new Date(r.signal_date).toISOString().slice(0, 10) : null, brand: brands.get(r.brand_company_id) || "", kind: String(r.signal_type || "news"), headline, source: String(r.source) });
  }
  return out;
}

/** Dated research on the benchmark centres that are not Landsec's own, each item with a source link. `brandNames`: only items that name one of these brands (a category group's section). */
export async function marketResearch(period: ReportPeriod, ownPropertyIds: Set<string>, brandNames: Set<string> | null): Promise<MarketResearch[]> {
  const { benchmarkCentres, centreRecords } = await import("./benchmark-centres");
  const records = await centreRecords(benchmarkCentres());
  const out: MarketResearch[] = [];
  for (const [centre, record] of records) {
    if (ownPropertyIds.has(record.id)) continue;
    const items = Array.isArray(record.research?.items) ? record.research.items : [];
    for (const item of items) {
      if (!item?.source_url || !/^https?:\/\//i.test(String(item.source_url)) || !inMonths(item.date, period)) continue;
      if (brandNames && !(item.brand && brandNames.has(String(item.brand).trim().toLowerCase()))) continue;
      out.push({ date: String(item.date), centre, kind: String(item.kind || "other"), headline: String(item.headline || "").trim(), source: String(item.source_url) });
    }
  }
  return out.filter(r => r.headline).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20);
}

export interface BoardDraftDeps {
  ask?: (system: string, user: string) => Promise<{ text: string; model: string; usage?: any }>;
  claim?: () => Promise<boolean>;
  hasKey?: () => boolean;
}

async function askAnthropic(system: string, user: string) {
  const { getAnthropicClient, CHATBGP_MODEL } = await import("./utils/anthropic-client");
  const response = await getAnthropicClient(true).messages.create({
    model: CHATBGP_MODEL, max_tokens: 900, system,
    messages: [{ role: "user", content: user }],
  });
  return { text: response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(""), model: response.model || CHATBGP_MODEL, usage: response.usage };
}

/** One section's draft: one call, under the day's allowance. `check` lists figures in the draft that were not in what it was sent. */
export async function draftMarketSection(input: MarketDraftInput, deps: BoardDraftDeps = {}): Promise<{ text: string; check: string[]; sent: { facts: number; signals: number; research: number } }> {
  const hasKey = deps.hasKey || (() => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY));
  if (!hasKey()) throw new BoardMarketError(503, "Drafting is not switched on. Write the section by hand.");
  const claim = deps.claim || (async () => (await import("./requirement-feeds")).claimDailyRead(USAGE_KEY, boardDraftDailyCap()));
  if (!(await claim())) throw new BoardMarketError(429, "Today's allowance of drafts is used. Write the section by hand.");
  const prompt = marketDraftPrompt(input);
  const reply = await (deps.ask || askAnthropic)(prompt.system, prompt.user);
  if (!deps.ask) import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model: reply.model, feature: FEATURE, usage: reply.usage })).catch(() => {});
  const text = cleanMarketDraft(reply.text);
  if (!text) throw new BoardMarketError(502, "No draft came back. Write the section by hand, or try again.");
  return { text, check: draftFiguresNotSent(text, prompt.user), sent: { facts: input.facts.length, signals: input.signals.length, research: input.research.length } };
}

// ── Routes ───────────────────────────────────────────────────────────────

const REFUSED = { message: "Reports are for Landsec and BGP logins." };

async function who(req: Request, viewer: LandsecViewer): Promise<{ name: string; firm: "BGP" | "Landsec" }> {
  const userId = req.session?.userId || (req as any).tokenUserId;
  const row = userId ? (await pool.query(`/* landsec-board-market:who */ SELECT name FROM users WHERE id = $1`, [userId]).catch(() => ({ rows: [] as any[] }))).rows[0] : null;
  return { name: String(row?.name || "").trim() || (viewer.isClient ? "Landsec" : "BGP"), firm: viewer.isClient ? "Landsec" : "BGP" };
}

/** The period and the schemes a request names, out of those the caller may report on. */
async function scopeOf(viewer: LandsecViewer, from: unknown, to: unknown, asked: unknown): Promise<{ period: ReportPeriod; schemes: ReportScheme[] }> {
  const parsed = parseReportPeriod(from, to);
  if (!parsed.ok) throw new BoardMarketError(400, parsed.error);
  const schemes = pickSchemes(await reportSchemesFor(viewer), asked);
  if (schemes.length === 0) throw new BoardMarketError(400, "Pick at least one scheme.");
  return { period: parsed.period, schemes };
}

const fail = (res: Response, e: any, words: string) => {
  if (e instanceof BoardMarketError) return res.status(e.status).json({ message: e.message });
  console.error("[landsec-board-market]", e?.message);
  res.status(500).json({ message: words });
};

export function setupLandsecBoardMarketRoutes(app: Express) {
  // The editor: each section's saved text, who saved it and when.
  app.get("/api/landsec/reports/board-report/market", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      const { period, schemes } = await scopeOf(viewer, req.query.from, req.query.to, req.query.schemes);
      const saved = await loadBoardMarket(period, schemes.map(s => s.key));
      const reply: BoardMarketReply = {
        period: { from: period.from, to: period.to, label: period.label }, schemes: schemes.map(s => s.name),
        sections: BOARD_MARKET_SECTIONS.map(s => ({ key: s.key, title: s.title, saved: saved[s.key] || null })),
        canDraft: (await contactViewer(req)).staff && boardDraftDailyCap() > 0,
      };
      res.json(reply);
    } catch (e: any) { fail(res, e, "The market report could not be loaded."); }
  });

  // Save one section. BGP staff and a Landsec login; empty text clears it.
  app.put("/api/landsec/reports/board-report/market", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      const section = boardMarketSection(req.body?.key);
      if (!section) return res.status(400).json({ message: "There is no section of that name." });
      const { period, schemes } = await scopeOf(viewer, req.body?.from, req.body?.to, req.body?.schemes);
      const saved = await saveBoardMarketSection({ period, schemeKeys: schemes.map(s => s.key), key: section.key, text: req.body?.text, loadedAt: req.body?.loadedAt, who: await who(req, viewer) });
      res.json({ key: section.key, saved: saved[section.key] || null });
    } catch (e: any) { fail(res, e, "The section could not be saved."); }
  });

  // A draft to start from. BGP staff signed in as themselves only; nothing is saved.
  app.post("/api/landsec/reports/board-report/market/draft", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      if (!(await contactViewer(req)).staff) return res.status(403).json({ message: "Drafting is for BGP staff. Write the section, then save it." });
      const section = boardMarketSection(req.body?.key);
      if (!section) return res.status(400).json({ message: "There is no section of that name." });
      const { period, schemes } = await scopeOf(viewer, req.body?.from, req.body?.to, req.body?.schemes);
      const { boardData, boardFacts, boardBrandsIn } = await import("./landsec-board-report");
      const data = await boardData({ req, schemes, period, madeBy: "", madeAt: new Date(), cache: new Map() }, viewer);
      const brands = boardBrandsIn(data, section.group);
      const portfolio = await resolveLandsecPortfolio(viewer.companyId);
      const own = new Set(portfolio.schemes.flatMap(s => s.properties.map(p => p.id)));
      const [signals, research] = await Promise.all([
        marketSignals(brands, period).catch(() => [] as MarketSignal[]),
        marketResearch(period, own, section.group ? new Set(Array.from(brands.values()).map(n => n.toLowerCase())) : null).catch(() => [] as MarketResearch[]),
      ]);
      res.json(await draftMarketSection({ section, periodLabel: period.label, schemes: schemes.map(s => s.name), facts: boardFacts(data, section.group), signals, research }));
    } catch (e: any) { fail(res, e, "The draft could not be made."); }
  });
}
