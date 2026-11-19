// The board report's market report (Woody, 2026-11-19: "we can use the app to
// provide a market report in each subsection"; "this is Me and Mark working
// together to provide overall analysis for him to present each quarter").
//
// THE WORDS ARE WRITTEN BY PEOPLE. One box per section (Overall, and one per
// brief-category group). What is saved is the words the board report prints;
// a section with nothing saved prints no words, and a draft is never printed
// until a person has saved it. (The industry figures under each section are
// counted by the app, server/landsec-board-industry.ts, and print either way.)
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
import type { LandsecViewer } from "./landsec-access";
import { parseReportPeriod, type ReportPeriod } from "@shared/landsec-reports";
import { boardMarketSettingsKey, boardSchemeSet, cleanMarketDraft, cleanMarketText, draftFiguresNotSent, type BoardMarketSaved } from "@shared/landsec-board-report";
import {
  MARKET_WORD_SECTIONS, marketDraftRequest, marketStrip, marketWordSection, sectionMaterial, stripLines,
  type MarketData, type MarketDraftMaterial, type MarketTeamPost, type MarketWordKey, type MarketWords,
} from "@shared/landsec-market-report";

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

function savedOf(value: any): MarketWords {
  const out: MarketWords = {};
  const sections = value && typeof value === "object" && value.sections && typeof value.sections === "object" ? value.sections : {};
  for (const s of MARKET_WORD_SECTIONS) {
    const row = sections[s.key];
    const text = cleanMarketText(row?.text);
    if (!text) continue;
    out[s.key] = { text, savedBy: String(row.savedBy || "").slice(0, 120), savedByFirm: row.savedByFirm === "Landsec" ? "Landsec" : "BGP", savedAt: String(row.savedAt || "") };
  }
  return out;
}

/** The saved sections for a period and a set of schemes. */
export async function loadBoardMarket(period: Pick<ReportPeriod, "from" | "to">, schemeKeys: string[], db: Queryable = pool): Promise<MarketWords> {
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
  input: { period: Pick<ReportPeriod, "from" | "to">; schemeKeys: string[]; key: MarketWordKey; text: unknown; loadedAt: unknown; who: { name: string; firm: "BGP" | "Landsec" }; now?: Date },
  connect: () => Promise<{ query: Queryable["query"]; release: () => void }> = () => pool.connect() as any,
): Promise<MarketWords> {
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

// ── What a section is written from ───────────────────────────────────────

export interface SectionSheet extends Pick<MarketDraftMaterial, "facts" | "items" | "movers" | "research" | "themes"> { key: MarketWordKey; title: string }
export interface MarketSheet { sections: SectionSheet[]; posts: MarketTeamPost[] }

// A section's material is the same for a few minutes of editing: drafting six sections reads it once.
const sheets = new Map<string, { at: number; value: Promise<{ data: MarketData; facts: Map<MarketWordKey, string[]> }> }>();
const SHEET_MS = 3 * 60 * 1000;

/** The market report's items for a period and a set of schemes, with the figures the report prints for each section. */
async function materialFor(req: Request, viewer: LandsecViewer, period: ReportPeriod, schemes: ReportScheme[]): Promise<{ data: MarketData; facts: Map<MarketWordKey, string[]> }> {
  const key = `${marketKeyFor(period, schemes.map(s => s.key))}:${viewer.companyId}`;
  const hit = sheets.get(key);
  if (hit && Date.now() - hit.at < SHEET_MS) return hit.value;
  const value = (async () => {
    const { boardData, boardFacts } = await import("./landsec-board-report");
    const { marketData } = await import("./landsec-market-report");
    const ctx = { req, schemes, period, madeBy: "", madeAt: new Date(), cache: new Map() };
    const board = await boardData(ctx, viewer);
    const data = await marketData(ctx, viewer, board);
    const facts = new Map<MarketWordKey, string[]>();
    for (const s of MARKET_WORD_SECTIONS) {
      if (s.competition) { facts.set(s.key, [`Items about other landlords and competing centres in the period: ${data.competition.length}.`]); continue; }
      facts.set(s.key, [...boardFacts(board, s.group).filter(line => !/^(Brands with an opening story|Store counts|Net change in stores|Planning applications|Job adverts|Leasing requirements)/.test(line)), ...stripLines(marketStrip(data.items, s.group), s.title)]);
    }
    return { data, facts };
  })();
  sheets.set(key, { at: Date.now(), value });
  value.catch(() => sheets.delete(key));
  if (sheets.size > 40) for (const [k, v] of sheets) if (Date.now() - v.at > SHEET_MS) sheets.delete(k);
  return value;
}

const sheetOf = (m: { data: MarketData; facts: Map<MarketWordKey, string[]> }): SectionSheet[] =>
  MARKET_WORD_SECTIONS.map(s => ({ key: s.key, title: s.title, facts: m.facts.get(s.key) || [], ...sectionMaterial(m.data, s.key) }));

// ── The draft ────────────────────────────────────────────────────────────

export interface BoardDraftDeps {
  ask?: (system: string, user: string) => Promise<{ text: string; model: string; usage?: any }>;
  claim?: () => Promise<boolean>;
  hasKey?: () => boolean;
}

async function askAnthropic(system: string, user: string) {
  const { getAnthropicClient, CHATBGP_MODEL } = await import("./utils/anthropic-client");
  const response = await getAnthropicClient(true).messages.create({
    model: CHATBGP_MODEL, max_tokens: 1400, system,
    messages: [{ role: "user", content: user }],
  });
  return { text: response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(""), model: response.model || CHATBGP_MODEL, usage: response.usage };
}

/** One section's draft: one call, under the day's allowance. `check` lists figures in the draft that were not in what it was sent. */
export async function draftMarketSection(input: MarketDraftMaterial, deps: BoardDraftDeps = {}): Promise<{ text: string; check: string[]; sent: { facts: number; items: number; research: number; themes: number; posts: number } }> {
  const hasKey = deps.hasKey || (() => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY));
  if (!hasKey()) throw new BoardMarketError(503, "Drafting is not switched on. Write the section by hand.");
  const claim = deps.claim || (async () => (await import("./requirement-feeds")).claimDailyRead(USAGE_KEY, boardDraftDailyCap()));
  if (!(await claim())) throw new BoardMarketError(429, "Today's allowance of drafts is used. Write the section by hand.");
  const prompt = marketDraftRequest(input);
  const reply = await (deps.ask || askAnthropic)(prompt.system, prompt.user);
  if (!deps.ask) import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model: reply.model, feature: FEATURE, usage: reply.usage })).catch(() => {});
  const text = cleanMarketDraft(reply.text);
  if (!text) throw new BoardMarketError(502, "No draft came back. Write the section by hand, or try again.");
  return { text, check: draftFiguresNotSent(text, prompt.user), sent: { facts: input.facts.length, items: input.items.length, research: input.research.length, themes: input.themes.length, posts: input.posts.length } };
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

/** BGP's team posts of the period, for BGP staff signed in as themselves and nobody else. A failed read is no posts. */
async function postsFor(req: Request, period: ReportPeriod): Promise<MarketTeamPost[]> {
  if (!(await contactViewer(req)).staff) return [];
  return (await import("./landsec-market-posts")).teamPosts(period).catch((e: any) => { console.warn(`[landsec-board-market] team posts: ${e?.message}`); return []; });
}

export function setupLandsecBoardMarketRoutes(app: Express) {
  // The editor: each section's saved text, who saved it and when.
  app.get("/api/landsec/reports/board-report/market", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      const { period, schemes } = await scopeOf(viewer, req.query.from, req.query.to, req.query.schemes);
      const saved = await loadBoardMarket(period, schemes.map(s => s.key));
      res.json({
        period: { from: period.from, to: period.to, label: period.label }, schemes: schemes.map(s => s.name),
        sections: MARKET_WORD_SECTIONS.map(s => ({ key: s.key, title: s.title, saved: saved[s.key] || null })),
        canDraft: (await contactViewer(req)).staff && boardDraftDailyCap() > 0,
      });
    } catch (e: any) { fail(res, e, "The market report could not be loaded."); }
  });

  // What each section is written from: the items the report lists, and (BGP staff only) the team's own posts to add by hand.
  app.get("/api/landsec/reports/board-report/market/material", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      const { period, schemes } = await scopeOf(viewer, req.query.from, req.query.to, req.query.schemes);
      const [material, posts] = await Promise.all([materialFor(req, viewer, period, schemes), postsFor(req, period)]);
      const reply: MarketSheet = { sections: sheetOf(material), posts };
      res.json(reply);
    } catch (e: any) { fail(res, e, "What the sections are written from could not be loaded."); }
  });

  // Save one section. BGP staff and a Landsec login; empty text clears it.
  app.put("/api/landsec/reports/board-report/market", requireAuth, async (req: Request, res: Response) => {
    try {
      const viewer = await reportViewer(req);
      if (!viewer) return res.status(403).json(REFUSED);
      const section = marketWordSection(req.body?.key);
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
      const section = marketWordSection(req.body?.key);
      if (!section) return res.status(400).json({ message: "There is no section of that name." });
      const { period, schemes } = await scopeOf(viewer, req.body?.from, req.body?.to, req.body?.schemes);
      const [material, posts] = await Promise.all([materialFor(req, viewer, period, schemes), postsFor(req, period)]);
      const sheet = sheetOf(material).find(s => s.key === section.key)!;
      // The team's posts about the section's brands (every post, for the overall section). None for the competition: they tag brands.
      const about = section.competition ? [] : posts.filter(p => section.key === "overall" || p.section === section.key).slice(0, 25).map(p => `${p.day || "undated"} | ${p.brands.join(", ")} | ${p.text}`);
      res.json(await draftMarketSection({ section: { key: section.key, title: section.title }, periodLabel: period.label, schemes: schemes.map(s => s.name), facts: sheet.facts, items: sheet.items, movers: sheet.movers, research: sheet.research, themes: sheet.themes, posts: about }));
    } catch (e: any) { fail(res, e, "The draft could not be made."); }
  });
}
