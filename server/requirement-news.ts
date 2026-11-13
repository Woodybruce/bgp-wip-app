// Requirements centre: news that drives requirements (Woody, 2026-11-12;
// docs/requirements-review-2026-11-12.md, "News that drives requirements").
//
//   expandingBrands         the "Expanding now, nothing on our books" list:
//                           brands with recent expansion signals and no live
//                           or to-confirm requirement.
//   addRequirementFromNews  "Add requirement" from that list: a person
//                           confirms a press story through the intake, and
//                           the requirement is press-reported.
//   newsStoriesRead         called by the news readers after they write a
//                           brand signal. A strong story raises a To confirm
//                           suggestion; a closure, CVA or administration
//                           story about a brand with a live requirement
//                           raises a "still live?" suggestion.
//
// News only ever SUGGESTS. It never creates a requirement and never moves a
// confirmed date: a person does that. Staff only: nothing here is sent to a
// client login. A story keeps its signal type, so the expansion score and
// the maps do not move.
//
// The database is imported lazily so the plain rules below can be tested
// without one (server/requirement-news.test.ts).
import { requirementLive, requirementStateSql } from "@shared/requirement-live";
import { newsArticleUrl } from "./news-ingestion";
import { suggest, confirm, dismiss, NEWS_QUIET_DAYS, PROPOSAL_STILL_LIVE, type Actor, type ConfirmResult, type IntakeStore, type Queryable, type RequirementFields } from "./requirement-intake";

const DAY_MS = 86400000;

// ── What a reader reports about a story ────────────────────────────────────

/** The reader's answer to "does this story state what space the brand wants, or an expansion target?". Null = it does not. */
export interface StoryRead {
  /** The number of new sites stated. */
  sites: number | null;
  /** True when the story says the sites or space are in the UK, false when it says abroad, null when it does not say. */
  uk: boolean | null;
  size: string | null;
  places: string[];
  timing: string | null;
}

const text1 = (v: unknown, max = 120): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};

/** One item of a reader's reply: the extra answer, or null when the story states nothing. */
export function parseStoryRead(raw: unknown): StoryRead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if ((r.statesSpace ?? r.states_space) !== true) return null;
  const n = Number(r.sites);
  return {
    sites: r.sites != null && r.sites !== "" && Number.isFinite(n) && n >= 1 && n < 100000 ? Math.round(n) : null,
    uk: r.uk === true ? true : r.uk === false ? false : null,
    size: text1(r.size),
    places: Array.isArray(r.places) ? r.places.map(x => text1(x, 80)).filter((x): x is string => !!x).slice(0, 20) : [],
    timing: text1(r.timing),
  };
}

const NUMBER_WORDS: Record<number, string> = {
  1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve",
  13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty",
  30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety", 100: "hundred",
};

/**
 * Keeps only what the text itself supports: a number of sites that is
 * written in it, places that are named in it, a size or a date whose figures
 * are in it. The reader is never trusted to fill a gap from what it knows.
 */
export function checkStoryRead(read: StoryRead | null, text: string): StoryRead | null {
  if (!read) return null;
  const hay = String(text || "").toLowerCase().replace(/\s+/g, " ");
  const hasNumber = (n: number) => {
    const digits = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",?");
    if (new RegExp(`(?<![\\d,.])${digits}(?!\\d)`).test(hay)) return true;
    const word = NUMBER_WORDS[n];
    return !!word && new RegExp(`\\b${word}\\b`).test(hay);
  };
  const written = (v: string | null) => {
    if (!v) return null;
    const figures = v.match(/\d[\d,.]*\d|\d/g);
    return (figures ? figures.every(f => hay.includes(f)) : hay.includes(v.toLowerCase())) ? v : null;
  };
  return {
    sites: read.sites && hasNumber(read.sites) ? read.sites : null,
    uk: read.uk,
    size: written(read.size),
    places: read.places.filter(p => hay.includes(p.toLowerCase())),
    timing: written(read.timing),
  };
}

/** The stated figures as one line for a signal's detail text and a suggestion's excerpt: "Stated: 20 UK sites; 2,000 sq ft; Leeds, York; by 2027." */
export function statedText(read: StoryRead | null): string | null {
  if (!read) return null;
  const parts = [
    read.sites ? `${read.sites} ${read.uk === true ? "UK " : ""}site${read.sites === 1 ? "" : "s"}` : null,
    read.size, read.places.length ? read.places.join(", ") : null, read.timing,
  ].filter(Boolean);
  return parts.length ? `Stated: ${parts.join("; ")}.` : null;
}

// ── The strong-story rule ──────────────────────────────────────────────────

export const STORY_MAX_AGE_DAYS = 30;

export interface StoryRuleInput {
  /** A named brand matched to a tenant brand that was already in the CRM, and is not hidden. */
  matched: boolean;
  signalType: string;
  sentiment?: string | null;
  /** The nightly pass's rating: confirmed | reported | rumour. */
  confidence?: string | null;
  read: StoryRead | null;
}

/**
 * A strong story raises a To confirm suggestion: a named, matched brand with
 * a stated number of UK sites (two or more: one opening is not a requirement)
 * or a stated requirement (the story is a stated-requirement fact, or it
 * gives a size or names places). Never a rumour, a closure or a plan abroad.
 */
export function strongStory(s: StoryRuleInput): { strong: boolean; why: string; confidence: "high" | "medium" } {
  const no = (why: string) => ({ strong: false, why, confidence: "medium" as const });
  if (!s.matched) return no("the brand is not matched to a brand in the CRM");
  if (!s.read) return no("the story does not state what space the brand wants");
  const type = String(s.signalType || "").toLowerCase();
  if (type === "closure" || /^neg/i.test(String(s.sentiment || ""))) return no("a closure or a negative story");
  if (type === "rumour" || /^(rumour|rumor|low)$/i.test(String(s.confidence || ""))) return no("a rumour");
  if (s.read.uk === false) return no("the plan is outside the UK");
  if (s.read.sites != null && s.read.sites >= 2 && s.read.uk === true) return { strong: true, why: `states ${s.read.sites} UK sites`, confidence: "high" };
  if (s.read.size || s.read.places.length) return { strong: true, why: "states the space the brand wants", confidence: s.read.uk === true ? "high" : "medium" };
  if (type === "requirement") return { strong: true, why: "a stated requirement", confidence: "medium" };
  return no("no stated number of UK sites and no stated size or place");
}

/** A story old enough to have been seen already is never raised: only one dated within the last 30 days. */
export function storyIsRecent(storyDate: Date | null | undefined, now: Date): boolean {
  if (!storyDate || isNaN(storyDate.getTime())) return false;
  const age = now.getTime() - storyDate.getTime();
  return age >= -DAY_MS && age <= STORY_MAX_AGE_DAYS * DAY_MS;
}

// ── The "still live?" rule ─────────────────────────────────────────────────

const DISTRESS = /insolven|administrat|liquidat|\bcva\b|company voluntary arrangement|restructuring plan|receivership|wind(?:ing|s)?[- ]up|bankrupt|ceas(?:e|es|ed|ing) trading|collaps/i;

/** A closure, CVA or administration story: a closure that is more than one small branch, or a closure or negative story whose headline names insolvency. */
export function closureStory(s: { signalType: string; headline: string | null | undefined; magnitude?: string | null; sentiment?: string | null }): boolean {
  const closure = String(s.signalType || "").toLowerCase() === "closure";
  const negative = /^neg/i.test(String(s.sentiment || ""));
  if (DISTRESS.test(String(s.headline || ""))) return closure || negative;
  return closure && String(s.magnitude || "").toLowerCase() !== "small";
}

export interface StillLiveInput {
  story: { signalType: string; headline: string | null | undefined; magnitude?: string | null; sentiment?: string | null };
  storyDate: Date | null;
  now: Date;
  /** The brand's LIVE requirements (confirmed by a person within 90 days). */
  liveRequirements: Array<{ id: string; lastConfirmedAt: Date | null }>;
}

/**
 * Whether to ask "still live?", and of which requirement. Only of a live
 * requirement that was last confirmed BEFORE the story: a person who
 * confirmed it afterwards has already answered. Never closes anything.
 */
export function stillLiveQuestion(input: StillLiveInput): { ask: boolean; requirementId: string | null; why: string } {
  const no = (why: string) => ({ ask: false, requirementId: null, why });
  if (!closureStory(input.story)) return no("not a closure, CVA or administration story");
  if (!storyIsRecent(input.storyDate, input.now)) return no("the story is undated or more than 30 days old");
  const asked = input.liveRequirements.filter(r => !r.lastConfirmedAt || r.lastConfirmedAt.getTime() < input.storyDate!.getTime());
  if (!asked.length) return no(input.liveRequirements.length ? "the requirement was confirmed after the story" : "the brand has no live requirement");
  return { ask: true, requirementId: asked.length === 1 ? asked[0].id : null, why: "a closure story about a brand with a live requirement" };
}

// ── Reading a long newsletter in sections ──────────────────────────────────

export const SECTION_CHARS = 8000;
export const MAX_SECTIONS = 8;

/** A newsletter's HTML as text with one line per paragraph or table row, so a long edition can be cut between stories. */
export function newsletterStoryText(html: unknown, max = SECTION_CHARS * MAX_SECTIONS): string {
  return String(html || "")
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .trim().slice(0, max);
}

/** Cuts a long text into sections, between stories where the text shows a break: a line break, else the end of a sentence, else a space. */
export function splitIntoSections(text: string, size = SECTION_CHARS, max = MAX_SECTIONS): string[] {
  const out: string[] = [];
  let rest = String(text || "").trim();
  const floor = Math.floor(size * 0.6);
  while (rest && out.length < max) {
    if (rest.length <= size) { out.push(rest); break; }
    const window = rest.slice(0, size);
    let cut = window.lastIndexOf("\n");
    if (cut < floor) { const stop = window.lastIndexOf(". "); cut = stop >= floor ? stop + 1 : -1; }
    if (cut < floor) cut = window.lastIndexOf(" ");
    if (cut < floor) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return out.filter(Boolean);
}

/** A reader's JSON array. A reply cut off part-way keeps the complete items before the cut, not nothing. */
export function parseReaderItems(raw: string): any[] | null {
  const text = String(raw || "");
  const start = text.indexOf("[");
  if (start < 0) return null;
  const end = text.lastIndexOf("]");
  if (end > start) {
    try { const parsed = JSON.parse(text.slice(start, end + 1)); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  const cut = text.lastIndexOf("}");
  if (cut > start) {
    try { const parsed = JSON.parse(`${text.slice(start, cut + 1)}]`); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  return null;
}

const NEWS_USAGE_KEY = "requirement_news_reader_usage";
const NEWS_DEFAULT_DAILY_CAP = 150;

/** The extra newsletter sections read a day (the first section of each email is read as before). REQUIREMENT_NEWS_READER_DAILY_CAP overrides it; 0 = first section only. */
export function newsReaderDailyCap(): number {
  const raw = process.env.REQUIREMENT_NEWS_READER_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : NEWS_DEFAULT_DAILY_CAP;
}

/** Takes one extra section from today's allowance; false when it is used up. */
export async function claimNewsSection(): Promise<boolean> {
  const { claimDailyRead } = await import("./requirement-feeds");
  return claimDailyRead(NEWS_USAGE_KEY, newsReaderDailyCap());
}

// ── Where a signal came from, in words ─────────────────────────────────────

/** A brand signal's source as a label and a link. A newsletter item has no link: the label is the publisher. */
export function signalSource(source: string | null | undefined, detail?: string | null, articleSource?: string | null): { label: string | null; url: string | null } {
  const src = String(source || "").trim();
  if (/^https?:\/\//i.test(src)) {
    const url = newsArticleUrl(src);
    let host: string | null = null;
    try { host = new URL(src).hostname.replace(/^www\./i, ""); } catch {}
    return { label: text1(articleSource, 80) || host, url };
  }
  if (/^newsletter:/i.test(src)) {
    const subject = src.replace(/^newsletter:[^:]*:/i, "").trim();
    if (/propel/i.test(`${src} ${detail || ""}`)) return { label: "Propel", url: null };
    return { label: subject ? `Newsletter: ${subject.slice(0, 60)}` : "Newsletter", url: null };
  }
  if (!src) return { label: null, url: null };
  return { label: src === "apollo" ? "Apollo" : src.slice(0, 80), url: null };
}

/** The publisher of a trade newsletter, for a suggestion's source label. */
export function newsletterPublisher(from: string | null | undefined, subject?: string | null): string {
  const f = String(from || "").toLowerCase();
  if (/propel/.test(`${f} ${String(subject || "").toLowerCase()}`)) return "Propel";
  const domain = f.split("@")[1] || "";
  const name = domain.replace(/^(?:email|mail|news|newsletter|e|info)\./, "").split(".")[0];
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} newsletter` : "Newsletter";
}

// ── The "Expanding now, nothing on our books" list ─────────────────────────

/** Opening = a new site, funding, a stated requirement, and store-level hiring: the expansion signals the score reads. */
export const EXPANDING_SIGNAL_TYPES = ["opening", "funding", "requirement", "hiring"] as const;
export const EXPANDING_WINDOW_MONTHS = 12;

// One brand signal `s` that counts: an expansion type, inside the 12-month
// window, about the brand, not negative, not a rumour, not abroad, and not
// one small branch opening. BGP's own deal learnings are not news.
// $1 = today, $2 = the signal types.
const EXPANDING_SIGNAL_SQL = `s.signal_type = ANY($2::text[])
     AND s.ai_relevant IS DISTINCT FROM FALSE
     AND lower(coalesce(s.sentiment, '')) NOT LIKE 'neg%'
     AND lower(coalesce(s.geography, '')) NOT IN ('europe', 'row')
     AND lower(coalesce(s.confidence, '')) <> 'rumour'
     AND NOT (s.signal_type = 'opening' AND lower(coalesce(s.magnitude, '')) = 'small')
     AND (s.source IS NULL OR s.source NOT LIKE 'bgp-deal:%')
     AND coalesce(s.signal_date, s.created_at) >= ($1)::timestamp - interval '${EXPANDING_WINDOW_MONTHS} months'`;
// A planned date in the future sorts as today, so it does not sit at the top for months.
const SIGNAL_AT_SQL = `least(coalesce(s.signal_date, s.created_at), ($1)::timestamp)`;

export interface ExpandingSignal { id: string; type: string; headline: string; detail: string | null; date: Date | null; source: string | null; link: string | null; magnitude: string | null; confidence: string | null; geography: string | null }
export interface ExpandingBrand { companyId: string; name: string; companyType: string | null; signalCount: number; /** Requirements that are only background: a market listing nobody confirmed, or one last confirmed over a year ago. */ backgroundRequirements: number; latest: ExpandingSignal; signals: ExpandingSignal[] }

/**
 * Brands with a recent expansion signal and nothing on BGP's books: no live
 * or to-confirm requirement, nothing already waiting in To confirm, and no
 * press suggestion a person dismissed in the last 30 days. Newest story
 * first. A brand with only a background requirement (an unconfirmed market
 * listing, say) is still listed, and says so (`backgroundRequirements`).
 * Staff only: the route refuses a client login.
 */
export async function expandingBrands(db: Queryable, opts: { limit?: number; offset?: number; q?: string | null; now?: Date } = {}) {
  const now = opts.now || new Date();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const q = String(opts.q || "").trim();
  const state = requirementStateSql("r", "$1");
  const brands = (await db.query(
    `WITH sig AS (
       SELECT s.brand_company_id, ${SIGNAL_AT_SQL} AS at
         FROM brand_signals s
        WHERE ${EXPANDING_SIGNAL_SQL}
     ), brands AS (
       SELECT c.id, c.name, c.company_type, max(sig.at) AS latest_at, count(*)::int AS signal_count
         FROM sig JOIN crm_companies c ON c.id = sig.brand_company_id
        WHERE c.merged_into_id IS NULL AND c.archived_at IS NULL
          AND (lower(coalesce(c.company_type, '')) LIKE 'tenant%' OR lower(coalesce(c.company_type, '')) = 'brand')
          AND ($3::text IS NULL OR c.name ILIKE $3)
          AND NOT EXISTS (SELECT 1 FROM crm_requirements_leasing r WHERE r.company_id = c.id AND ${state} IN ('live', 'to_confirm'))
          AND NOT EXISTS (SELECT 1 FROM requirement_evidence e WHERE e.company_id = c.id AND e.status = 'open')
          AND NOT EXISTS (SELECT 1 FROM requirement_evidence e
                           WHERE e.company_id = c.id AND e.kind = 'press' AND e.status = 'dismissed' AND e.resolved_by_user_id IS NOT NULL
                             AND e.resolved_at >= ($1)::timestamp - interval '${NEWS_QUIET_DAYS} days'
                             AND coalesce(e.resolved_reason, '') NOT IN ('wrong_brand', 'duplicate') AND e.details->>'proposal' IS NULL)
        GROUP BY c.id, c.name, c.company_type
     )
     SELECT b.id, b.name, b.company_type, b.latest_at, b.signal_count, (count(*) OVER ())::int AS total,
            (SELECT count(*)::int FROM crm_requirements_leasing r WHERE r.company_id = b.id AND ${state} = 'background') AS background_requirements
       FROM brands b
      ORDER BY b.latest_at DESC, b.name, b.id
      LIMIT $4 OFFSET $5`,
    [now, [...EXPANDING_SIGNAL_TYPES], q ? `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%` : null, limit, offset])).rows;

  const ids = brands.map((b: any) => String(b.id));
  const signals = ids.length ? (await db.query(
    `SELECT * FROM (
       SELECT s.id, s.brand_company_id, s.signal_type, s.headline, s.detail, s.source, s.magnitude, s.confidence, s.geography,
              coalesce(s.signal_date, s.created_at) AS at, a.source_name AS article_source,
              row_number() OVER (PARTITION BY s.brand_company_id ORDER BY ${SIGNAL_AT_SQL} DESC, s.id) AS rn
         FROM brand_signals s
         LEFT JOIN LATERAL (SELECT na.source_name FROM news_articles na WHERE na.url = s.source LIMIT 1) a ON true
        WHERE s.brand_company_id = ANY($3::text[]) AND ${EXPANDING_SIGNAL_SQL}
     ) t WHERE t.rn <= 3 ORDER BY t.brand_company_id, t.rn`,
    [now, [...EXPANDING_SIGNAL_TYPES], ids])).rows : [];

  const signalOut = (s: any): ExpandingSignal => {
    const src = signalSource(s.source, s.detail, s.article_source);
    return { id: String(s.id), type: s.signal_type, headline: s.headline, detail: text1(s.detail, 300), date: s.at ? new Date(s.at) : null,
      source: src.label, link: src.url, magnitude: s.magnitude ?? null, confidence: s.confidence ?? null, geography: s.geography ?? null };
  };
  const list: ExpandingBrand[] = [];
  for (const b of brands) {
    const own = signals.filter((s: any) => s.brand_company_id === b.id).map(signalOut);
    if (!own.length) continue;
    list.push({ companyId: String(b.id), name: b.name, companyType: b.company_type ?? null, signalCount: Number(b.signal_count) || own.length,
      backgroundRequirements: Number(b.background_requirements) || 0, latest: own[0], signals: own });
  }
  return { generatedAt: now, windowMonths: EXPANDING_WINDOW_MONTHS, signalTypes: [...EXPANDING_SIGNAL_TYPES], total: Number(brands[0]?.total) || 0, limit, offset, brands: list };
}

const slug = (v: unknown, max = 80) => String(v ?? "").toLowerCase().replace(/[^a-z\d]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);

export interface AddFromNewsArgs {
  companyId: string;
  headline: string;
  url?: string | null;
  /** The publisher as the list showed it: "Propel", "thecaterer.com". */
  source?: string | null;
  date?: string | Date | null;
  /** The brand already has a requirement (a market listing, say): confirm that one as press-reported… */
  requirementId?: string | null;
  /** …or say this is a new search. */
  createNew?: boolean;
  fields?: RequirementFields;
}

/**
 * "Add requirement" on the Expanding list. A named person vouches for the
 * story, so it goes through the intake's confirm: the requirement is BGP's
 * own, confirmed by that person as PRESS (press-reported until someone
 * records speaking to the brand), with the story kept as its evidence.
 */
export async function addRequirementFromNews(store: IntakeStore, args: AddFromNewsArgs, actor: Actor, now: Date = new Date()): Promise<ConfirmResult> {
  const url = newsArticleUrl(args.url);
  const given = args.date ? new Date(args.date) : null;
  return confirm(store, {
    evidence: {
      kind: "press", brand: { companyIds: [args.companyId] }, sourceLabel: text1(args.source, 80) || "News", headline: args.headline, url,
      evidenceDate: given && !isNaN(given.getTime()) ? given : null,
      dedupeKey: `press-added:${args.companyId}:${url || `h:${slug(args.headline)}`}`,
    },
    companyId: args.companyId, requirementId: args.requirementId || null, createNew: !!args.createNew, how: "press",
    fields: { ...(args.fields || {}), sources: ["News"] },
  }, actor, now);
}

/**
 * "Dismiss" on the Expanding list: a named person says the brand's news is
 * not a requirement. The story is kept as a dismissed press line, which takes
 * the brand off the list and quietens its news suggestions for 30 days.
 */
export async function dismissFromNews(store: IntakeStore, args: Pick<AddFromNewsArgs, "companyId" | "headline" | "url" | "source" | "date">, actor: Actor, now: Date = new Date()): Promise<{ evidenceIds: string[]; quietUntil: Date | null }> {
  const given = args.date ? new Date(args.date) : null;
  const raised = await suggest(store, {
    kind: "press", brand: { companyIds: [args.companyId] }, sourceLabel: text1(args.source, 80) || "News", headline: args.headline, url: newsArticleUrl(args.url),
    evidenceDate: given && !isNaN(given.getTime()) ? given : null,
    dedupeKey: `press-dismissed:${args.companyId}:${now.toISOString().slice(0, 10)}`,
  }, { by: actor, now });
  // Pressed twice on the same day: the first press already dismissed it.
  if (raised.outcome === "duplicate" && raised.evidence.status !== "open") return { evidenceIds: [raised.evidence.id], quietUntil: null };
  const out = await dismiss(store, { suggestionId: raised.suggestionId || raised.evidence.id, reason: "not_a_requirement" }, actor, now);
  return { evidenceIds: out.evidenceIds, quietUntil: out.quietUntil };
}

// ── What the news readers call after they write a signal ───────────────────

export interface NewsStory {
  /** The crm_companies id the reader attached the signal to. */
  companyId: string;
  /** The brand was already in the CRM before this story was read (the newsletter reader can add a brand: such a story is not "matched"). */
  knownBrand: boolean;
  signalType: string;
  headline: string;
  detail?: string | null;
  magnitude?: string | null;
  sentiment?: string | null;
  confidence?: string | null;
  read: StoryRead | null;
  /** When it was published. */
  storyDate: Date | null;
  /** "Propel", "thecaterer.com". */
  sourceLabel: string | null;
  url?: string | null;
  sourceRef?: string | null;
  /** The same for the same story however often it is read: the article link, the newsletter edition and type, the fact's fingerprint. */
  storyKey: string;
  /** The nightly pass reads old stories again: do not raise one within 30 days of a person answering this brand's news. */
  reread?: boolean;
}

export interface NewsFeedOutcome { suggestions: number; questions: number }

async function answeredSince(db: Queryable, companyId: string, proposal: string | null, since: Date): Promise<boolean> {
  return (await db.query(
    `SELECT 1 FROM requirement_evidence
      WHERE company_id = $1 AND kind = 'press' AND status <> 'open' AND resolved_by_user_id IS NOT NULL AND resolved_at >= $2
        AND (details->>'proposal') IS NOT DISTINCT FROM $3::text LIMIT 1`, [companyId, since, proposal])).rows.length > 0;
}

/**
 * The news readers hand over the stories they have just written as brand
 * signals. Never throws and never writes a requirement: at most it raises
 * suggestions through the intake.
 */
export async function newsStoriesRead(stories: NewsStory[], now: Date = new Date()): Promise<NewsFeedOutcome> {
  const out: NewsFeedOutcome = { suggestions: 0, questions: 0 };
  // Most stories are neither: only those that could pass a rule open a transaction.
  const candidates = stories.filter(s => s && s.companyId && s.headline && storyIsRecent(s.storyDate, now)
    && (closureStory(s) || strongStory({ matched: s.knownBrand, signalType: s.signalType, sentiment: s.sentiment, confidence: s.confidence, read: s.read }).strong));
  if (!candidates.length) return out;
  const { withStore } = await import("./requirement-feeds");
  const since = new Date(now.getTime() - NEWS_QUIET_DAYS * DAY_MS);
  for (const story of candidates) {
    try {
      await withStore(async (store, db) => {
        const [brand] = await store.brandsByIds([story.companyId]);
        // Only a tenant brand in the directory: never a landlord, an agent or a hidden brand.
        if (!brand || brand.hidden || !brand.brandType) return;
        await store.lock(`requirement-news:${brand.id}`);
        const base = {
          kind: "press" as const, brand: { companyIds: [brand.id], name: brand.name }, sourceLabel: story.sourceLabel || "News", sourceRef: story.sourceRef || null,
          evidenceDate: story.storyDate, headline: story.headline, url: newsArticleUrl(story.url), detectedBy: "News reader",
        };

        const rule = strongStory({ matched: story.knownBrand, signalType: story.signalType, sentiment: story.sentiment, confidence: story.confidence, read: story.read });
        if (rule.strong && story.read && !(story.reread && await answeredSince(db, brand.id, null, since))) {
          const r = story.read;
          const raised = await suggest(store, {
            ...base, excerpt: statedText(r) || story.detail || null, confidence: rule.confidence,
            details: { rule: "strong_story", why: rule.why, signalType: story.signalType, ...(r.sites ? { sites: r.sites } : {}), ...(r.uk != null ? { uk: r.uk } : {}),
              ...(r.size ? { size: [r.size] } : {}), ...(r.places.length ? { locations: r.places } : {}), ...(r.timing ? { timing: r.timing } : {}) },
            dedupeKey: `press:${brand.id}:${story.storyKey}`,
          }, { now });
          if (raised.outcome === "opened" || raised.outcome === "joined") out.suggestions++;
        }

        if (closureStory(story)) {
          const live = (await store.requirementsForCompanies([brand.id])).filter(q => requirementLive(q, now).state === "live")
            .map(q => ({ id: String(q.id), lastConfirmedAt: q.last_confirmed_at ? new Date(q.last_confirmed_at) : null }));
          const question = stillLiveQuestion({ story, storyDate: story.storyDate, now, liveRequirements: live });
          if (question.ask && !(await answeredSince(db, brand.id, PROPOSAL_STILL_LIVE, since))) {
            const raised = await suggest(store, {
              ...base, headline: `Still live? ${brand.name}: ${story.headline}`, excerpt: story.detail || null,
              details: { proposal: PROPOSAL_STILL_LIVE, requirementId: question.requirementId, signalType: story.signalType, story: story.headline },
              dedupeKey: `still-live:${brand.id}:${story.storyKey}`,
            }, { now });
            if (raised.outcome === "opened" || raised.outcome === "joined") out.questions++;
          }
        }
      });
    } catch (e: any) {
      console.warn("[requirement-news] story skipped:", e?.message || e);
    }
  }
  if (out.suggestions || out.questions) console.log(`[requirement-news] ${out.suggestions} suggestion(s), ${out.questions} "still live?" question(s) raised from ${candidates.length} stor${candidates.length === 1 ? "y" : "ies"}`);
  return out;
}
