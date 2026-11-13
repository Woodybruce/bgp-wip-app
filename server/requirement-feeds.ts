// Requirements centre: the feeds from what the app already records
// (Woody, 2026-11-12; docs/requirements-review-2026-11-12.md). Each one runs
// at the moment its record is written (a viewing saved, a deal's status
// changed, a chat post sent, a transcript note made) and goes through the one
// intake, server/requirement-intake.ts. There is no sweep and no boot job.
//
//   viewingRecorded      two viewings in 90 days by a brand with no requirement
//   dealStatusChanged    a letting for the brand reached solicitors: "mark as satisfied?"
//   chatMessagePosted    a staff post that tags a brand in a staff-only thread
//   transcriptNoteSaved  the summary of a Teams meeting transcript
//
// Every one of them only ever SUGGESTS: a person confirms, attaches or
// dismisses in To confirm. Nothing here is sent to a client login, and none
// of it reads email.
//
// The reader (readStatedRequirements) is the one place that sends text to an
// AI. It calls Anthropic directly, never the switchable provider helpers,
// because a staff post or a meeting can be about a Landsec scheme. It is
// capped per day, logs its spend as "requirement-intake", and does nothing
// when no Anthropic key is set.
//
// The database is imported lazily so the plain rules below can be tested
// without one (server/requirement-feeds.test.ts).
import { legacyToCode, type DealStatusCode } from "@shared/deal-status";
import { LEGACY_LETTING_TYPES, TENANT_REP_TYPES } from "@shared/letting-rules";
import { requirementLive } from "@shared/requirement-live";
import { suggest, matchBrand, pgIntakeStore, brandKey, PROPOSAL_MARK_SATISFIED, type Actor, type IntakeStore, type Queryable, type RequirementRow } from "./requirement-intake";

const STAFF_DOMAIN = "@brucegillinghampollard.com";
const DAY_MS = 86400000;

export interface FeedOutcome { ran: boolean; reason?: string; suggestions?: number }
const skipped = (reason: string): FeedOutcome => ({ ran: false, reason });

const londonDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export async function withStore<T>(run: (store: IntakeStore, db: Queryable) => Promise<T>): Promise<T> {
  const { pool } = await import("./db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await run(pgIntakeStore(client), client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

const openRequirementsOf = async (store: IntakeStore, brandId: string, now: Date): Promise<RequirementRow[]> =>
  (await store.requirementsForCompanies([brandId])).filter(r => requirementLive(r, now).state !== "closed");

// ── Rule 1: two viewings in 90 days by a brand with no requirement ─────────

export const VIEWING_RULE_DAYS = 90;
export const VIEWING_RULE_COUNT = 2;

export interface RuleViewing {
  id: string;
  /** YYYY-MM-DD. */
  viewingDate: string;
  status: string | null;
  /** A person (or the diary match) confirmed the brand, unit and date. */
  confirmed: boolean;
  hasUnit: boolean;
  /** Already linked to a requirement. */
  linked: boolean;
  /** The status of the evidence line this viewing already has, if it was suggested before. */
  line: string | null;
}

/**
 * The viewings to raise as a suggestion, or none. Counts what the
 * Requirements page's "Recently viewing, 90 days" filter counts: a completed,
 * confirmed viewing of a unit in the last 90 days. A viewing a person already
 * dismissed, confirmed or attached does not count again, so a dismissed
 * suggestion comes back only after two new viewings.
 */
export function viewingsToSuggest(viewings: RuleViewing[], openRequirements: number, today: string): RuleViewing[] {
  if (openRequirements > 0) return [];
  const first = new Date(new Date(`${today}T12:00:00Z`).getTime() - (VIEWING_RULE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  const counted = viewings.filter(v => v.status === "completed" && v.confirmed && v.hasUnit && !v.linked
    && /^\d{4}-\d{2}-\d{2}$/.test(v.viewingDate) && v.viewingDate >= first && v.viewingDate <= today
    && (v.line == null || v.line === "open"));
  if (counted.length < VIEWING_RULE_COUNT) return [];
  return counted.filter(v => v.line == null).sort((a, b) => a.viewingDate.localeCompare(b.viewingDate) || a.id.localeCompare(b.id));
}

export async function viewingRecorded(companyId: string | null | undefined, now: Date = new Date()): Promise<FeedOutcome> {
  if (!companyId) return skipped("no brand");
  try {
    const today = londonDay(now);
    const first = new Date(new Date(`${today}T12:00:00Z`).getTime() - (VIEWING_RULE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
    return await withStore(async (store, db) => {
      const [brand] = await store.brandsByIds([companyId]);
      if (!brand) return skipped("brand not found");
      // Two saves for the same brand must not both raise it.
      await store.lock(`requirement-feed:viewings:${brand.id}`);
      const rows = (await db.query(
        `SELECT v.id, v.viewing_date, v.status, v.unit_id, v.requirement_id, (v.details_confirmed_at IS NOT NULL) AS confirmed,
                e.status AS line, au.unit_name, p.name AS property_name
           FROM unit_viewings v
           LEFT JOIN requirement_evidence e ON e.dedupe_key = 'viewing:' || v.id
           LEFT JOIN available_units au ON au.id = v.unit_id LEFT JOIN crm_properties p ON p.id = au.property_id
          WHERE v.company_id = ANY($1::text[]) AND v.deleted_at IS NULL AND v.viewing_date >= $2 AND v.viewing_date <= $3`,
        [[...new Set([companyId, brand.id])], first, today])).rows;
      const open = await openRequirementsOf(store, brand.id, now);
      const raise = viewingsToSuggest(rows.map((r: any) => ({ id: String(r.id), viewingDate: String(r.viewing_date), status: r.status, confirmed: !!r.confirmed,
        hasUnit: !!r.unit_id, linked: !!r.requirement_id, line: r.line || null })), open.length, today);
      let suggestions = 0;
      for (const v of raise) {
        const row = rows.find((r: any) => String(r.id) === v.id);
        const out = await suggest(store, {
          kind: "viewing", brand: { companyIds: [brand.id], name: brand.name }, sourceLabel: "Viewing", sourceRef: v.id, evidenceDate: `${v.viewingDate}T12:00:00Z`,
          headline: `Viewed: ${[row?.unit_name, row?.property_name].filter(Boolean).join(", ") || "a unit"}`,
          url: "/available?workspace=viewings",
          details: { rule: "two_viewings_90_days" }, dedupeKey: `viewing:${v.id}`, detectedBy: "Viewing rule",
        }, { now });
        if (out.outcome === "opened" || out.outcome === "joined") suggestions++;
      }
      return { ran: true, suggestions };
    });
  } catch (e: any) {
    console.warn("[requirement-feeds] viewing rule skipped:", e?.message || e);
    return skipped("error");
  }
}

// ── Rule 2: a letting for the brand reached solicitors ─────────────────────

// Deals in which the tenant on the deal is the brand TAKING the space: a
// landlord-side letting, or a tenant-rep acquisition. A Lease Disposal or
// Sub-Letting is left out: its tenant can be the party leaving.
const TAKING_SPACE_TYPES: readonly string[] = ["New Letting", "Temp Lease", "Licence", ...LEGACY_LETTING_TYPES, ...TENANT_REP_TYPES];
const AT_SOLICITORS_OR_LATER: DealStatusCode[] = ["SOL", "EXC", "COM"];
const ALREADY_PAST_SOLICITORS: DealStatusCode[] = ["SOL", "EXC", "COM", "INV"];

/** The status moved from before Solicitors to Solicitors (or straight past it). */
export function reachedSolicitors(oldStatus: string | null | undefined, newStatus: string | null | undefined): boolean {
  const before = legacyToCode(oldStatus), after = legacyToCode(newStatus);
  return !!after && AT_SOLICITORS_OR_LATER.includes(after) && !(before && ALREADY_PAST_SOLICITORS.includes(before));
}

export interface DealRuleInput {
  dealId?: string | null;
  dealType: string | null | undefined;
  oldStatus: string | null | undefined;
  newStatus: string | null | undefined;
  /** The brand taking the space (crm_deals.tenant_id). */
  tenantId: string | null | undefined;
  /** The brand's requirements that are not closed. */
  openRequirements: Array<{ id: string; dealId?: string | null }>;
}

/**
 * Whether to ask "mark as satisfied?", and of which requirement. Never
 * closes anything: a person answers. With several open requirements the
 * reviewer chooses, unless one of them is already linked to this deal.
 */
export function dealSatisfiedQuestion(input: DealRuleInput): { ask: boolean; requirementId: string | null; why: string } {
  const no = (why: string) => ({ ask: false, requirementId: null, why });
  if (!TAKING_SPACE_TYPES.includes(String(input.dealType ?? "").trim())) return no("not a deal in which the brand takes space");
  if (!reachedSolicitors(input.oldStatus, input.newStatus)) return no("did not just reach solicitors");
  if (!input.tenantId) return no("no brand on the deal");
  if (!input.openRequirements.length) return no("the brand has no open requirement");
  const linked = input.dealId ? input.openRequirements.find(r => r.dealId && r.dealId === input.dealId) : undefined;
  const only = input.openRequirements.length === 1 ? input.openRequirements[0] : undefined;
  return { ask: true, requirementId: (linked || only)?.id ?? null, why: "a letting for the brand reached solicitors" };
}

export async function dealStatusChanged(dealId: string, oldStatus: string | null | undefined, newStatus: string | null | undefined, now: Date = new Date()): Promise<FeedOutcome> {
  if (!dealId || !reachedSolicitors(oldStatus, newStatus)) return skipped("did not just reach solicitors");
  try {
    return await withStore(async (store, db) => {
      const deal = (await db.query(
        `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.tenant_id, d.status, p.name AS property_name, pu.unit_name
           FROM crm_deals d LEFT JOIN crm_properties p ON p.id = d.property_id LEFT JOIN property_units pu ON pu.id = d.unit_id
          WHERE d.id = $1`, [dealId])).rows[0];
      if (!deal?.tenant_id) return skipped("no brand on the deal");
      const [brand] = await store.brandsByIds([deal.tenant_id]);
      if (!brand) return skipped("brand not found");
      const open = await openRequirementsOf(store, brand.id, now);
      const rule = dealSatisfiedQuestion({ dealId, dealType: deal.deal_type, oldStatus, newStatus, tenantId: brand.id, openRequirements: open.map(r => ({ id: r.id, dealId: r.deal_id })) });
      if (!rule.ask) return skipped(rule.why);
      const where = [deal.unit_name, deal.property_name].filter(Boolean).join(", ") || deal.name || "a unit";
      const out = await suggest(store, {
        kind: "deal", brand: { companyIds: [brand.id], name: brand.name }, sourceLabel: "Deal", sourceRef: String(deal.id), evidenceDate: now,
        headline: `${deal.deal_ref ? `Deal #${deal.deal_ref}` : "A deal"} for ${brand.name} at ${where} reached solicitors. Mark the requirement as satisfied?`,
        url: `/deals/${encodeURIComponent(String(deal.id))}`,
        details: { proposal: PROPOSAL_MARK_SATISFIED, requirementId: rule.requirementId, dealId: String(deal.id), dealRef: deal.deal_ref ?? null, status: legacyToCode(newStatus) },
        dedupeKey: `deal-solicitors:${deal.id}`, detectedBy: "Deal status rule",
      }, { now });
      return { ran: true, suggestions: out.outcome === "opened" || out.outcome === "joined" ? 1 : 0 };
    });
  } catch (e: any) {
    console.warn("[requirement-feeds] deal rule skipped:", e?.message || e);
    return skipped("error");
  }
}

// ── The reader ─────────────────────────────────────────────────────────────

export interface StatedRequirement {
  brand: string;
  /** The writer's own words, checked to be in the text. */
  quote: string;
  sites: number | null;
  size: string | null;
  locations: string[];
  use: string | null;
  timing: string | null;
  confidence: "high" | "medium";
}

export interface ReaderInput {
  /** The one message, or the meeting summary. */
  text: string;
  /** What it is, for the prompt: "team chat post by Emily Stone, 2026-11-12". */
  what: string;
  /** The brands tagged in a post: only these are reported. Null = find the brands in the text (a meeting summary). */
  brands: string[] | null;
  /** Who the meeting was with, when known. */
  withCompany?: string | null;
}

export interface ReaderDeps {
  hasKey(): boolean;
  /** Takes one read from today's allowance; false when it is used up. */
  claim(): Promise<boolean>;
  call(system: string, user: string): Promise<{ text: string; model: string; usage?: any; refused?: boolean }>;
  log(model: string, usage: any): void;
}

const READER_FEATURE = "requirement-intake";
const READER_USAGE_KEY = "requirement_reader_usage";
const READER_DEFAULT_DAILY_CAP = 200;
const READER_MAX_CHARS = 6000;
const QUOTE_MAX = 200;

/** Reads a day. REQUIREMENT_READER_DAILY_CAP overrides it; 0 switches the reader off. */
export function readerDailyCap(): number {
  const raw = process.env.REQUIREMENT_READER_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : READER_DEFAULT_DAILY_CAP;
}

const memoryCounts = new Map<string, { day: string; calls: number }>();

// One row in system_settings holds today's count, so a restart does not hand
// out a fresh allowance. If that table cannot be reached the count is kept in
// memory instead. The news reader keeps its own count under its own key
// (server/requirement-news.ts).
export async function claimDailyRead(usageKey: string = READER_USAGE_KEY, cap: number = readerDailyCap()): Promise<boolean> {
  if (cap <= 0) return false;
  const day = londonDay();
  try {
    const { pool } = await import("./db");
    const claimed = await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, jsonb_build_object('day', $2::text, 'calls', 1))
       ON CONFLICT (key) DO UPDATE SET updated_at = now(), value = CASE
           WHEN system_settings.value->>'day' = $2::text
           THEN jsonb_build_object('day', $2::text, 'calls', coalesce((system_settings.value->>'calls')::int, 0) + 1)
           ELSE jsonb_build_object('day', $2::text, 'calls', 1) END
       WHERE system_settings.value->>'day' IS DISTINCT FROM $2::text OR coalesce((system_settings.value->>'calls')::int, 0) < $3
       RETURNING value`, [usageKey, day, cap]);
    return claimed.rows.length > 0;
  } catch {
    let count = memoryCounts.get(usageKey);
    if (!count || count.day !== day) { count = { day, calls: 0 }; memoryCounts.set(usageKey, count); }
    if (count.calls >= cap) return false;
    count.calls++;
    return true;
  }
}

const defaultReaderDeps: ReaderDeps = {
  hasKey: () => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY),
  claim: () => claimDailyRead(),
  // The Anthropic client, built the way server/teams-notes.ts builds it. Not
  // callClaude: that helper follows the firm-wide provider switch.
  async call(system, user) {
    const { getAnthropicClient, CHATBGP_HELPER_MODEL } = await import("./utils/anthropic-client");
    const response = await getAnthropicClient(true).messages.create({
      model: CHATBGP_HELPER_MODEL,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return { text, model: response.model || CHATBGP_HELPER_MODEL, usage: response.usage, refused: (response.stop_reason as string) === "refusal" };
  },
  log(model, usage) {
    console.log(`[requirement-feeds] reader call: ${model}, ${usage?.input_tokens ?? "?"} tokens in, ${usage?.output_tokens ?? "?"} out`);
    import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model, feature: READER_FEATURE, usage })).catch(() => {});
  },
};

const READER_SYSTEM = `You help BGP, a UK retail and leisure leasing agency, keep its list of occupier requirements current. You are given one internal note written by BGP staff: a team chat post, or the summary of a meeting. Decide whether it states that an occupier brand is looking for space.

A stated requirement says what a brand wants to take: a number of new sites, a size, towns or areas, a type of unit, or when. "Pret want 2,000 to 3,000 sq ft in Leeds and York next year" is one. News about people, trading results, closures, a viewing that took place, or a deal already agreed on a named unit is not one, and a brand simply being mentioned is not one either.

Your answer is shown to a colleague as a suggestion for them to confirm or dismiss, so report only what the note itself says and never fill gaps from what you know about the brand. The quote is shown beside the suggestion as the writer's own words, so copy it from the note exactly.

Reply with JSON only: an array holding one object for each brand that has a stated requirement, or [] when there is none. Each object has these keys:
"brand": the brand's name
"quote": the words in the note that state the requirement, copied exactly, at most ${QUOTE_MAX} characters
"sites": the number of sites wanted, or null
"size": the size as the note gives it, or null
"locations": an array of the places named, which may be empty
"use": the type of unit or use as the note gives it, or null
"timing": when, as the note gives it, or null
"confidence": "high" when the note gives a size, a place or a number of sites; "medium" when it says the brand wants space without those; "low" when it is unclear whether the brand is looking at all`;

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const text1 = (v: unknown, max = 120): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};

/** The reader's reply, checked: a result is kept only when its quote is in the text and (for a post) its brand was tagged. */
export function parseReaderReply(reply: string, input: ReaderInput): StatedRequirement[] {
  const start = reply.indexOf("["), end = reply.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(reply.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const haystack = norm(input.text);
  const tagged = input.brands ? new Map(input.brands.map(b => [brandKey(b), b])) : null;
  const out: StatedRequirement[] = [];
  for (const item of parsed.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const said = text1(r.brand, 200), quote = text1(r.quote, QUOTE_MAX + 100);
    if (!said || !quote || !brandKey(said)) continue;
    const brand = tagged ? tagged.get(brandKey(said)) : said;
    if (!brand) continue;
    if (r.confidence !== "high" && r.confidence !== "medium") continue;
    if (!haystack.includes(norm(quote).replace(/(?:…|\.\.\.)$/, "").trim())) continue;
    if (out.some(o => brandKey(o.brand) === brandKey(brand))) continue;
    const sites = Number(r.sites);
    out.push({
      brand, quote: quote.slice(0, QUOTE_MAX),
      sites: r.sites != null && Number.isFinite(sites) && sites > 0 ? Math.round(sites) : null,
      size: text1(r.size), use: text1(r.use), timing: text1(r.timing),
      locations: Array.isArray(r.locations) ? r.locations.map(x => text1(x, 80)).filter((x): x is string => !!x).slice(0, 20) : [],
      confidence: r.confidence,
    });
  }
  return out;
}

/**
 * Reads one staff post or meeting summary for a stated requirement. Returns
 * null when it did not read (no key, today's allowance used, the call
 * failed): the caller then does nothing.
 */
export async function readStatedRequirements(input: ReaderInput, deps: ReaderDeps = defaultReaderDeps): Promise<StatedRequirement[] | null> {
  const text = String(input.text || "").trim();
  if (!text || (input.brands && !input.brands.length)) return null;
  if (!deps.hasKey()) return null;
  try {
    if (!(await deps.claim())) return null;
    if (text.length > READER_MAX_CHARS) console.log(`[requirement-feeds] reader: ${input.what} is ${text.length} characters; reading the first ${READER_MAX_CHARS}`);
    const read = text.slice(0, READER_MAX_CHARS);
    const who = input.brands
      ? `Brands tagged in the post: ${input.brands.join("; ")}. Report only these brands, named exactly as listed here.`
      : `${input.withCompany ? `The meeting was with: ${input.withCompany}. ` : ""}Name each brand as the note writes it.`;
    const reply = await deps.call(READER_SYSTEM, `${who}\n\nThe note (${input.what}):\n<note>\n${read}\n</note>`);
    deps.log(reply.model, reply.usage);
    if (reply.refused) return null;
    return parseReaderReply(reply.text, { ...input, text: read });
  } catch (e: any) {
    console.warn("[requirement-feeds] reader skipped:", e?.message || e);
    return null;
  }
}

const readDetails = (r: StatedRequirement) => ({
  ...(r.sites ? { sites: r.sites } : {}), ...(r.size ? { size: [r.size] } : {}), ...(r.locations.length ? { locations: r.locations } : {}),
  ...(r.use ? { use: [r.use] } : {}), ...(r.timing ? { timing: r.timing } : {}),
});

// ── Team chat and the Gossip channel ───────────────────────────────────────

const COMPANY_TAG = /@\[([^\]]+)\]\(tag:company\/([^)\s]+)\)/g;
const ANY_TAG = /@\[([^\]]+)\]\(tag:[a-z]+\/[^)\s]+\)/g;

/** The companies tagged in a post: @[Name](tag:company/<id>). */
export function companyTags(content: unknown): Array<{ id: string; name: string }> {
  if (typeof content !== "string") return [];
  const seen = new Map<string, string>();
  for (const m of content.matchAll(COMPANY_TAG)) if (!seen.has(m[2])) seen.set(m[2], m[1]);
  return [...seen].map(([id, name]) => ({ id, name }));
}

export interface ThreadPerson { id: string; email: string | null; role: string | null }

const isBgpPerson = (p: ThreadPerson | undefined) => !!p && String(p.email || "").trim().toLowerCase().endsWith(STAFF_DOMAIN) && String(p.role || "").trim().toLowerCase() !== "client";

/**
 * A thread the reader may read: a team thread (never a one-to-one ChatBGP
 * thread) in which the creator and EVERY member is a BGP person. One client
 * login, or one member who cannot be found, and the thread is left alone.
 */
export function threadIsStaffOnly(thread: { isAiChat?: boolean | null; is_ai_chat?: boolean | null }, memberIds: Array<string | null | undefined>, people: ThreadPerson[]): boolean {
  if (thread.isAiChat ?? thread.is_ai_chat) return false;
  const ids = [...new Set(memberIds.filter((x): x is string => !!x))];
  if (!ids.length) return false;
  return ids.every(id => isBgpPerson(people.find(p => p.id === id)));
}

interface PostedThread { id: string; createdBy: string; isAiChat?: boolean | null; linkedType?: string | null; linkedId?: string | null }
interface PostedMessage { id: string; content: unknown; role?: string | null; createdAt?: Date | string | null }

/**
 * A chat post was saved. `req` is the poster's request: the post is read
 * only when they are a named BGP person who is not viewing as a client.
 */
export async function chatMessagePosted(req: any, thread: PostedThread, message: PostedMessage, deps?: ReaderDeps): Promise<FeedOutcome> {
  try {
    if (message.role && message.role !== "user") return skipped("not a person's post");
    const tags = companyTags(message.content);
    if (!tags.length) return skipped("no brand tagged");
    if (thread.isAiChat) return skipped("a ChatBGP thread");
    let poster: Actor;
    try { poster = await (await import("./requirement-intake-routes")).staffActor(req); } catch { return skipped("not posted by BGP staff"); }

    const { pool } = await import("./db");
    const members = (await pool.query(`SELECT user_id FROM chat_thread_members WHERE thread_id = $1`, [thread.id])).rows.map((r: any) => String(r.user_id));
    const memberIds = [thread.createdBy, poster.id, ...members];
    const people = (await pool.query(`SELECT id, email, role FROM users WHERE id = ANY($1::text[])`, [memberIds])).rows as ThreadPerson[];
    if (!threadIsStaffOnly(thread, memberIds, people)) return skipped("not a staff-only thread");

    // Only tenant brands: a tagged landlord or agent is not a brand looking for space.
    const brands = (await pgIntakeStore(pool).brandsByIds(tags.map(t => t.id))).filter(b => b.brandType).slice(0, 4);
    if (!brands.length) return skipped("no tenant brand tagged");
    const text = String(message.content).replace(ANY_TAG, "$1").trim();
    if (text.length < 20) return skipped("too short");

    const sent = message.createdAt ? new Date(message.createdAt) : null;
    const posted = sent && !isNaN(sent.getTime()) ? sent : new Date();
    const gossip = thread.linkedType === "channel" && thread.linkedId === "gossip";
    const found = await readStatedRequirements({ text, what: `${gossip ? "Gossip and market intel" : "team chat"} post by ${poster.name}, ${londonDay(posted)}`, brands: brands.map(b => b.name) }, deps);
    if (!found) return skipped("not read");
    if (!found.length) return { ran: true, suggestions: 0 };

    const suggestions = await withStore(async store => {
      let n = 0;
      for (const r of found) {
        const brand = brands.find(b => brandKey(b.name) === brandKey(r.brand));
        if (!brand) continue;
        const out = await suggest(store, {
          kind: gossip ? "gossip" : "team_chat", brand: { companyIds: [brand.id], name: brand.name },
          sourceLabel: gossip ? "Gossip & market intel" : "Team chat", sourceRef: String(message.id), evidenceDate: posted,
          headline: `${poster.name} in ${gossip ? "Gossip & market intel" : "team chat"}`, excerpt: r.quote, saidBy: poster.name,
          url: `/chatbgp?thread=${encodeURIComponent(thread.id)}`, details: readDetails(r), confidence: r.confidence,
          dedupeKey: `chat-message:${message.id}:${brand.id}`, detectedBy: "Chat reader",
        });
        if (out.outcome === "opened" || out.outcome === "joined") n++;
      }
      return n;
    });
    return { ran: true, suggestions };
  } catch (e: any) {
    console.warn("[requirement-feeds] chat post skipped:", e?.message || e);
    return skipped("error");
  }
}

// ── Teams meeting transcripts ──────────────────────────────────────────────

export interface TranscriptNote {
  noteId: string | number;
  title: string;
  /** The AI summary of the transcript: the only text that is read. */
  summary: string;
  /** The company most attendees belong to. It can be a landlord or an agent. */
  companyId?: string | null;
  meetingDate?: Date | string | null;
}

export async function transcriptNoteSaved(note: TranscriptNote, deps?: ReaderDeps): Promise<FeedOutcome> {
  try {
    const summary = String(note.summary || "").trim();
    if (summary.length < 20) return skipped("no summary");
    const { pool } = await import("./db");
    // The note's company fixes the brand only when it is a tenant brand and
    // the reader named that brand; otherwise the matcher decides by name.
    const company = note.companyId ? (await pgIntakeStore(pool).brandsByIds([note.companyId]))[0] : undefined;
    const given = note.meetingDate ? new Date(note.meetingDate) : null;
    const when = given && !isNaN(given.getTime()) ? given : new Date();
    const found = await readStatedRequirements({ text: summary, what: `summary of a meeting, ${londonDay(when)}`, brands: null, withCompany: company?.name || null }, deps);
    if (!found) return skipped("not read");
    if (!found.length) return { ran: true, suggestions: 0 };

    const suggestions = await withStore(async store => {
      let n = 0;
      for (const r of found) {
        const isNoteBrand = !!company?.brandType && brandKey(company.name) === brandKey(r.brand);
        // A name that matches a landlord or an agent in the CRM is not a brand looking for space.
        const match = isNoteBrand ? null : await matchBrand(store, { name: r.brand });
        if (match?.companyId && !(await store.brandsByIds([match.companyId]))[0]?.brandType) continue;
        const out = await suggest(store, {
          kind: "meeting", brand: { name: r.brand, ...(isNoteBrand ? { companyIds: [company!.id] } : {}) },
          sourceLabel: "Teams meeting", sourceRef: `note:${note.noteId}`, evidenceDate: when,
          headline: note.title, excerpt: r.quote, details: readDetails(r), confidence: r.confidence,
          dedupeKey: `note:${note.noteId}:${brandKey(r.brand)}`, detectedBy: "Meeting reader",
        });
        if (out.outcome === "opened" || out.outcome === "joined") n++;
      }
      return n;
    });
    return { ran: true, suggestions };
  } catch (e: any) {
    console.warn("[requirement-feeds] transcript note skipped:", e?.message || e);
    return skipped("error");
  }
}
