// Fable's written view of a party's AML file (Woody, 24 November 2026: "an AI
// led commentary with fable 5 giving a proper view on whats been found and
// given to date and the risk profile given the rules"). The facts, the
// instructions and the checks on the answer: shared/aml-commentary.ts.
//
//   GET  /api/deals/:id/aml-commentary?role=   the latest view, and whether the file has changed since
//   POST /api/deals/:id/aml-commentary         { role, again? } write a view
//
// BGP staff signed in as themselves. Anthropic, called directly, on Fable 5.2
// with the API's refusal fallback, one call a view, capped a day
// (AML_COMMENTARY_DAILY_CAP, default 60, 0 = off). A view is kept against the
// facts it was written from and shown again until they change. It writes
// nothing else and decides nothing.
import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { DEAL_PARTY_LABEL, isDealPartyRole, type DealPartyRole } from "@shared/deal-parties";
import {
  COMMENTARY_SCHEMA, checkCommentary, commentaryFacts, commentaryMessage, commentaryRules, commentarySources, commentarySystem,
  type AmlCommentary, type CommentaryFact,
} from "@shared/aml-commentary";
import type { RiskAssessment } from "@shared/aml-risk-assessment";

export const COMMENTARY_MODEL = "claude-fable-5-2";
const USAGE_KEY = "aml_commentary_usage";
const FEATURE = "aml-commentary";
// Raised when the facts or the instructions change shape, so older views read as out of date.
const COMMENTARY_VERSION = 1;

export function commentaryDailyCap(): number {
  const raw = process.env.AML_COMMENTARY_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 60;
}

export class CommentaryRefusal extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "CommentaryRefusal"; }
}

export interface CommentaryDeps {
  hasKey?: () => boolean;
  claim?: () => Promise<boolean>;
  ask?: (system: string, message: string) => Promise<{ input: unknown; refused?: boolean; model: string; usage?: unknown }>;
}

/** The fingerprint of what a view was written from: the facts, the rules and the version. */
export function commentaryHash(facts: CommentaryFact[], rules: CommentaryFact[]): string {
  return crypto.createHash("sha256").update(JSON.stringify({ v: COMMENTARY_VERSION, f: facts.map(f => f.text), r: rules.map(r => r.text) })).digest("hex");
}

// Fable 5.2: thinking is always on and forced tool use is refused, so the
// answer comes back as structured JSON. A refusal is served again by the
// API's default fallback in the same call.
async function askFable(system: string, message: string) {
  const { getAnthropicClient } = await import("./utils/anthropic-client");
  const params: any = {
    model: COMMENTARY_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: COMMENTARY_SCHEMA } },
    system,
    messages: [{ role: "user", content: message }],
  };
  const response: any = await (getAnthropicClient(true) as any).beta.messages.create(params, { timeout: 180_000, maxRetries: 1 });
  const model = response.model || COMMENTARY_MODEL;
  if (response.stop_reason === "refusal") return { input: null, refused: true, model, usage: response.usage };
  if (response.stop_reason === "max_tokens") return { input: null, model, usage: response.usage };
  const text = (response.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let input: unknown = null;
  try { input = JSON.parse(text); } catch { input = null; }
  return { input, model, usage: response.usage };
}

// The facts and rules a view was written from are kept with it, so its sources read as they were.
interface StoredView { commentary: AmlCommentary; facts: CommentaryFact[]; rules: CommentaryFact[]; hash: string; model: string | null; by: string | null; at: string }

async function latestView(dealId: string, role: DealPartyRole): Promise<StoredView | null> {
  const row = (await pool.query(
    `SELECT facts_hash, commentary, facts, model, created_by_name, created_at FROM aml_risk_commentaries
      WHERE deal_id = $1 AND role = $2 ORDER BY created_at DESC, id DESC LIMIT 1`, [dealId, role]).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (!row) return null;
  return {
    commentary: row.commentary, facts: Array.isArray(row.facts?.facts) ? row.facts.facts : [], rules: Array.isArray(row.facts?.rules) ? row.facts.rules : [],
    hash: row.facts_hash, model: row.model || null, by: row.created_by_name || null, at: new Date(row.created_at).toISOString(),
  };
}

/** The view written from these facts, if one is kept (the AML file prints it first). */
export async function currentCommentary(dealId: string, role: DealPartyRole, ra: RiskAssessment): Promise<(StoredView & { sources: CommentaryFact[] }) | null> {
  const facts = commentaryFacts(ra);
  const rules = commentaryRules();
  const view = await latestView(dealId, role);
  if (!view || view.hash !== commentaryHash(facts, rules)) return null;
  return { ...view, sources: commentarySources(view.commentary, view.facts, view.rules) };
}

export interface CommentaryReply {
  commentary: AmlCommentary | null;
  current: boolean;
  at: string | null;
  by: string | null;
  model: string | null;
  sources: CommentaryFact[];
  canWrite: boolean;
  why: string | null;
}

const hasKey = () => !!process.env.ANTHROPIC_API_KEY;
const writing = new Map<string, Promise<CommentaryReply>>();

async function readFile(dealId: string, role: DealPartyRole, me: { id: string; name: string }) {
  const { gatherAmlFile } = await import("./aml-file");
  const data = await gatherAmlFile(dealId, [role], me);
  if (!data) throw new CommentaryRefusal("No such transaction.", 404);
  const p = data.parties[0];
  if (!p) throw new CommentaryRefusal("The transaction has no such party.", 404);
  if (!p.riskAssessment) throw new CommentaryRefusal("The file could not be read for a view.", 409);
  return { ra: p.riskAssessment, partyWords: `${DEAL_PARTY_LABEL[role]}: ${p.company?.name || p.brand.name}${p.company && p.company.name !== p.brand.name ? ` (${p.brand.name})` : ""}` };
}

function reply(view: StoredView | null, hash: string, canWrite: boolean, why: string | null): CommentaryReply {
  return {
    commentary: view?.commentary || null,
    current: !!view && view.hash === hash,
    at: view?.at || null,
    by: view?.by || null,
    model: view?.model || null,
    sources: view ? commentarySources(view.commentary, view.facts, view.rules) : [],
    canWrite,
    why,
  };
}

/** The latest view and whether it was written from the file as it is now. */
export async function readCommentary(dealId: string, role: DealPartyRole, me: { id: string; name: string }, deps: CommentaryDeps = {}): Promise<CommentaryReply> {
  const { ra } = await readFile(dealId, role, me);
  const facts = commentaryFacts(ra);
  const rules = commentaryRules();
  const keyed = (deps.hasKey || hasKey)();
  const cap = commentaryDailyCap();
  return reply(await latestView(dealId, role), commentaryHash(facts, rules), keyed && cap > 0,
    !keyed ? "The written view is not set up: no Anthropic key." : cap <= 0 ? "The written view is switched off." : null);
}

/** Write a view of the file as it is now (or hand back the one already written from it). */
export async function writeCommentary(dealId: string, role: DealPartyRole, me: { id: string; name: string }, opts: { again?: boolean } = {}, deps: CommentaryDeps = {}): Promise<CommentaryReply> {
  const { ra, partyWords } = await readFile(dealId, role, me);
  const facts = commentaryFacts(ra);
  const rules = commentaryRules();
  const hash = commentaryHash(facts, rules);
  const existing = await latestView(dealId, role);
  if (existing && existing.hash === hash && !opts.again) return reply(existing, hash, true, null);
  if (!(deps.hasKey || hasKey)()) throw new CommentaryRefusal("The written view is not set up: no Anthropic key.", 503);
  const key = `${dealId}|${role}|${hash}`;
  const going = writing.get(key);
  if (going) return going;
  const run = (async (): Promise<CommentaryReply> => {
    const claim = deps.claim || (async () => (await import("./requirement-feeds")).claimDailyRead(USAGE_KEY, commentaryDailyCap()));
    if (!(await claim())) throw new CommentaryRefusal("Today's allowance of written views is used up. It starts again tomorrow.", 429);
    const asked = await (deps.ask || askFable)(commentarySystem(), commentaryMessage(partyWords, facts, rules));
    if (!deps.ask) import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model: asked.model, feature: FEATURE, usage: asked.usage as any })).catch(() => {});
    if (asked.refused) throw new CommentaryRefusal("Fable declined to write a view of this file.", 422);
    const commentary = checkCommentary(asked.input, facts, rules);
    if (!commentary) throw new CommentaryRefusal("The view could not be written from this file. Try again.", 502);
    const row = (await pool.query(
      `INSERT INTO aml_risk_commentaries (deal_id, role, facts_hash, commentary, facts, model, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING created_at`,
      [dealId, role, hash, JSON.stringify(commentary), JSON.stringify({ facts, rules }), asked.model, me.id, me.name])).rows[0];
    const view: StoredView = { commentary, facts, rules, hash, model: asked.model, by: me.name, at: new Date(row?.created_at || Date.now()).toISOString() };
    return reply(view, hash, true, null);
  })().finally(() => writing.delete(key));
  writing.set(key, run);
  return run;
}

// ── Routes ──────────────────────────────────────────────────────────────────

const router = Router();

async function staff(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return { id: String(userId), name: String(u?.name || u?.email || "BGP") };
}

router.get("/api/deals/:id/aml-commentary", async (req: Request, res: Response) => {
  try {
    const me = await staff(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const role = String(req.query.role || "");
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Which party?" });
    res.json(await readCommentary(String(req.params.id), role as DealPartyRole, me));
  } catch (err: any) {
    if (err instanceof CommentaryRefusal) return res.status(err.status).json({ message: err.message });
    console.error("[aml-commentary] read failed:", err?.message);
    res.status(500).json({ message: "The written view could not be read." });
  }
});

router.post("/api/deals/:id/aml-commentary", async (req: Request, res: Response) => {
  try {
    const me = await staff(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const role = String(req.body?.role || "");
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Which party?" });
    res.json(await writeCommentary(String(req.params.id), role as DealPartyRole, me, { again: req.body?.again === true }));
  } catch (err: any) {
    if (err instanceof CommentaryRefusal) return res.status(err.status).json({ message: err.message });
    console.error("[aml-commentary] write failed:", err?.message);
    res.status(500).json({ message: "The written view could not be written. Try again in a moment." });
  }
});

export default router;
