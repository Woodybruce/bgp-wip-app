// The ONE front door for requirements (Woody, 2026-11-12;
// docs/requirements-review-2026-11-12.md). Every source calls this file:
// news, chat, meetings, viewings, a staff member asking ChatBGP.
//
//   suggest   anything a machine detected. Records the evidence and opens a
//             SUGGESTION. It never writes a requirement.
//   confirm   a named BGP person says it is real: creates a requirement, or
//             stamps an existing one as confirmed, and links the evidence.
//   attach    adds the evidence to an existing requirement without
//             confirming it.
//   dismiss   with a reason. A dismissed news suggestion quietens news
//             suggestions for that brand for 30 days.
//
// The brand is matched by the strongest clue (a contact's company, then a
// brand tag, then the brand's name and its recorded other names). A brand is
// never invented: an unmatched name stays a suggestion carrying the name,
// and a tie carries the candidates for the reviewer to pick.
//
// One open suggestion per brand and source kind: later evidence joins it. A
// question about an existing requirement ("mark as satisfied?", "still
// live?") is kept apart from the brand's other suggestions of that kind.
// Every action writes who and when. Staff only: nothing here is ever sent to
// a client login.
//
// No database import here: everything goes through an IntakeStore, so the
// rules run the same against Postgres (`pgIntakeStore`) and the in-memory
// store in the tests beside this file.
import { requirementLive, requirementClientVisible, CONFIRMED_HOW, REQUIREMENT_ORIGIN_BGP, type ConfirmedHow, type RequirementLive } from "@shared/requirement-live";
import { getBrandIdentity } from "./brand-identity";

export const EVIDENCE_KINDS = ["call", "meeting", "email", "chat", "team_chat", "gossip", "whatsapp", "viewing", "offer", "deal", "listing", "press", "note"] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];

export const DISMISS_REASONS = ["not_a_requirement", "wrong_brand", "duplicate", "out_of_date"] as const;
// A dismissal for one of these says nothing about the brand, so it does not start the quiet period.
const NOT_QUIETING_REASONS = ["wrong_brand", "duplicate"];
export const NEWS_QUIET_DAYS = 30;
/** On a suggestion's details: it asks whether a requirement is now satisfied (a deal reached solicitors), not whether one exists. */
export const PROPOSAL_MARK_SATISFIED = "mark_satisfied";
/** On a suggestion's details: it asks whether a live requirement is still live (a closure, CVA or administration story about the brand). */
export const PROPOSAL_STILL_LIVE = "still_live";
/** The status given when the answer to "still live?" is no: the Requirements page's Archived. */
const NOT_LIVE_STATUS = "Archived";
/** The status a satisfied requirement is given: the Requirements page's closed status. */
const SATISFIED_STATUS = "Past";
/** The marker on evidence a person recorded directly, as opposed to a suggestion that was reviewed. */
export const DIRECT_REASON = "direct";
const QUIET_REASON = "quiet";
const EXCERPT_MAX = 300;
const DAY_MS = 86400000;

export class IntakeError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) { super(message); }
}

/** The named BGP person behind an action. */
export interface Actor { id: string; name: string }

export interface BrandRef { id: string; name: string; hidden?: boolean; brandType?: boolean; companyType?: string | null }
export interface NamedBrand extends BrandRef { otherNames: string[] }

export interface BrandClue {
  /** CRM contacts on the message, or their email addresses: the strongest clue. */
  contactIds?: string[];
  emails?: string[];
  /** Brand tags on a chat post: crm_companies ids. */
  companyIds?: string[];
  /** The name as the source gave it. */
  name?: string | null;
}

export interface BrandMatch {
  companyId: string | null;
  /** The name to carry on the evidence: what the source said, else the matched brand's name. */
  brandName: string | null;
  by: "contact" | "tag" | "name" | "alias" | null;
  /** More than one brand is possible; the reviewer picks. */
  candidates: BrandRef[];
}

export interface EvidenceRow {
  id: string;
  requirement_id: string | null;
  company_id: string | null;
  brand_name: string | null;
  candidate_company_ids: string[] | null;
  kind: string;
  source_label: string | null;
  source_ref: string | null;
  evidence_date: Date | null;
  headline: string | null;
  excerpt: string | null;
  url: string | null;
  said_by: string | null;
  details: Record<string, any> | null;
  confidence: string | null;
  status: string;
  created_by_kind: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  resolved_at: Date | null;
  resolved_reason: string | null;
  dedupe_key: string | null;
  suggestion_id: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/** A crm_requirements_leasing row as pg returns it (snake_case). */
export type RequirementRow = Record<string, any> & { id: string; name: string; company_id: string | null; status: string | null };

export interface EvidenceInput {
  kind: EvidenceKind;
  brand: BrandClue;
  /** Shown to staff: "Propel", "ChatBGP", "Team chat". */
  sourceLabel?: string | null;
  /** The id of the record it came from. */
  sourceRef?: string | null;
  /** When it was said or published. */
  evidenceDate?: Date | string | null;
  headline?: string | null;
  /** A short quote. Cut to 300 characters: never a whole message. */
  excerpt?: string | null;
  url?: string | null;
  saidBy?: string | null;
  /** What was read out of it: sites, size, locations, use, timing. */
  details?: Record<string, any> | null;
  confidence?: "high" | "medium" | "low" | null;
  /** One per source record, so nothing is suggested twice. */
  dedupeKey?: string | null;
  /** The reader that detected it ("News reader"), for a machine detection. */
  detectedBy?: string | null;
}

/** What a reviewer may set on a requirement made from a confirmation. */
export interface RequirementFields {
  name?: string;
  use?: string[];
  requirementType?: string[];
  size?: string[];
  requirementLocations?: string[];
  comments?: string;
  principalContactId?: string | null;
  agentContactId?: string | null;
  bgpContactUserIds?: string[];
  /** Source labels shown on the row ("ChatBGP"). Set by server code only, never from a request body. */
  sources?: string[];
}

export interface SuggestionFilters {
  status?: string;
  kind?: string | null;
  companyId?: string | null;
  unmatched?: boolean;
  q?: string | null;
  limit?: number;
  offset?: number;
}

// The database seam. Methods are deliberately plain look-ups and writes; the
// rules live in the functions below.
export interface IntakeStore {
  /** Serialises two writers on the same key for the rest of the transaction. */
  lock(key: string): Promise<void>;
  brandsForContacts(contactIds: string[], emails: string[]): Promise<BrandRef[]>;
  /** By crm_companies id, following a merged brand to the record it was merged into. */
  brandsByIds(ids: string[]): Promise<BrandRef[]>;
  /** Brands whose name or recorded other names might be `name`; the caller compares exactly. */
  brandsNamedLike(name: string): Promise<NamedBrand[]>;
  staffByIds(ids: string[]): Promise<Actor[]>;
  /** Which of these crm_contacts ids exist. */
  contactsExist?(ids: string[]): Promise<string[]>;
  evidenceById(id: string): Promise<EvidenceRow | null>;
  evidenceByDedupeKey(key: string): Promise<EvidenceRow | null>;
  /** Open first lines of `kind` for the brand; `companyId` null = the ones with no matched brand. */
  openHeads(kind: string, companyId: string | null): Promise<EvidenceRow[]>;
  /** Lines of `kind` a PERSON dismissed since `since`; `companyId` null = the ones with no matched brand. */
  personDismissalsSince(kind: string, companyId: string | null, since: Date): Promise<EvidenceRow[]>;
  /** The first line and every line that joined it, whatever their status. */
  suggestionLines(headId: string): Promise<EvidenceRow[]>;
  /** Null when a line with this dedupe key already exists. */
  insertEvidence(values: Partial<EvidenceRow>): Promise<EvidenceRow | null>;
  updateEvidence(ids: string[], patch: Partial<EvidenceRow>): Promise<void>;
  requirementById(id: string): Promise<RequirementRow | null>;
  requirementsForCompanies(companyIds: string[]): Promise<RequirementRow[]>;
  insertRequirement(values: Record<string, any>): Promise<RequirementRow>;
  updateRequirement(id: string, patch: Record<string, any>): Promise<RequirementRow>;
  evidenceForRequirement(requirementId: string): Promise<EvidenceRow[]>;
  /** Confirmed viewings linked to the requirement, or by its brand and linked to no requirement, read live: { id, viewing_date, status, company_name, unit_name, property_name }. */
  viewingsForRequirement(requirementId: string): Promise<Array<Record<string, any>>>;
  /** Confirmed offers by the requirement's brand, read live: { id, offer_date, status, company_name, unit_name, property_name }. */
  offersForRequirement?(requirementId: string): Promise<Array<Record<string, any>>>;
  /** Points the brand's viewings that have no requirement yet at this one. */
  linkViewings?(viewingIds: string[], requirementId: string, companyId: string): Promise<void>;
  /** The link to the import record behind a market listing (external_requirements.source_url), when it kept one. */
  listingUrl?(externalRequirementId: string): Promise<string | null>;
  listHeads(filters: SuggestionFilters): Promise<EvidenceRow[]>;
  joinedLines(headIds: string[]): Promise<EvidenceRow[]>;
  openCounts(): Promise<Array<{ kind: string; count: number; unmatched: number }>>;
  draftRequirements(): Promise<RequirementRow[]>;
}

// ── Brand matching ─────────────────────────────────────────────────────────

/** The comparison form of a brand name: accents, case, punctuation and company suffixes removed. */
export function brandKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z\d]+/g, " ").trim()
    .replace(/(?:\s+(?:limited|ltd|plc|llp|incorporated|inc|corporation|corp))+$/, "").trim();
}

function uniqueBrands<T extends BrandRef>(refs: T[]): T[] {
  const seen = new Set<string>();
  return refs.filter(r => r && r.id && !seen.has(r.id) && !!seen.add(r.id));
}

// When several brands remain, a real tenant brand beats another kind of
// company, and a brand in the directory beats a hidden one. Anything still
// tied goes to the reviewer.
function narrow<T extends BrandRef>(refs: T[]): T[] {
  let out = refs;
  for (const keep of [(r: T) => !!r.brandType, (r: T) => !r.hidden]) {
    const kept = out.filter(keep);
    if (kept.length >= 1 && kept.length < out.length) out = kept;
  }
  return out;
}

export async function matchBrand(store: IntakeStore, clue: BrandClue): Promise<BrandMatch> {
  const said = String(clue?.name || "").trim() || null;
  const key = brandKey(said);
  const named = key.length >= 2 ? uniqueBrands(await store.brandsNamedLike(said!)) : [];
  const exact = narrow(named.filter(b => brandKey(b.name) === key));
  const alias = narrow(named.filter(b => brandKey(b.name) !== key && b.otherNames.some(n => brandKey(n) === key)));
  const nameIds = new Set((exact.length ? exact : alias).map(b => b.id));

  const settle = (refs: BrandRef[], by: BrandMatch["by"]): BrandMatch | null => {
    if (!refs.length) return null;
    if (refs.length === 1) return { companyId: refs[0].id, brandName: said || refs[0].name, by, candidates: [] };
    // A stronger clue pointed at several brands: a weaker one may still pick between them.
    const byName = refs.filter(r => nameIds.has(r.id));
    if (byName.length === 1) return { companyId: byName[0].id, brandName: said || byName[0].name, by, candidates: [] };
    const tied = narrow(refs);
    if (tied.length === 1) return { companyId: tied[0].id, brandName: said || tied[0].name, by, candidates: [] };
    return { companyId: null, brandName: said || tied.map(r => r.name).join(" or "), by, candidates: tied.slice(0, 6) };
  };

  const contactIds = [...new Set((clue?.contactIds || []).filter(Boolean))];
  const emails = [...new Set((clue?.emails || []).map(e => String(e || "").trim().toLowerCase()).filter(Boolean))];
  if (contactIds.length || emails.length) {
    const hit = settle(uniqueBrands(await store.brandsForContacts(contactIds, emails)), "contact");
    if (hit) return hit;
  }
  const tagIds = [...new Set((clue?.companyIds || []).filter(Boolean))];
  if (tagIds.length) {
    const hit = settle(uniqueBrands(await store.brandsByIds(tagIds)), "tag");
    if (hit) return hit;
  }
  return settle(exact, "name") || settle(alias, "alias") || { companyId: null, brandName: said, by: null, candidates: [] };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clip(text: unknown, max = EXCERPT_MAX): string | null {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function needActor(actor: Actor | null | undefined): Actor {
  const id = String(actor?.id || "").trim(), name = String(actor?.name || "").trim();
  if (!id || !name) throw new IntakeError(401, "NO_PERSON", "A named BGP person is needed for this");
  return { id, name };
}

function needKind(kind: unknown): EvidenceKind {
  if (!(EVIDENCE_KINDS as readonly string[]).includes(String(kind))) throw new IntakeError(400, "BAD_KIND", `Unknown kind of evidence: ${String(kind)}`);
  return kind as EvidenceKind;
}

const isClosed = (row: RequirementRow, now: Date) => requirementLive(row, now).state === "closed";

function sameBrand(row: EvidenceRow, match: { companyId: string | null; brandName: string | null }): boolean {
  if (match.companyId) return row.company_id === match.companyId;
  return !row.company_id && brandKey(row.brand_name) === brandKey(match.brandName);
}

/** How a person's confirmation of this kind of evidence is recorded on the requirement. */
export function confirmedHowFor(kind: string): ConfirmedHow {
  if (kind === "press") return "press";
  if (kind === "call" || kind === "meeting" || kind === "email") return kind;
  if (kind === "chat" || kind === "team_chat" || kind === "gossip" || kind === "whatsapp") return "chat";
  if (kind === "viewing" || kind === "offer") return "viewing";
  return "suggestion";
}

// A requirement confirmed from a press story stays press-reported until
// someone records speaking to the brand: "Still live" alone does not lift
// it, and a later press story never downgrades a conversation.
const CONVERSATION_HOWS = ["call", "meeting", "email", "chat"];
function nextHow(existing: RequirementRow, how: ConfirmedHow, now: Date): ConfirmedHow {
  const live = requirementLive(existing, now);
  if (how === "still_live" && live.pressReported) return "press";
  // "Still live" on a requirement someone has spoken to the brand about keeps that record of how it is known.
  if (how === "still_live" && live.confirmed && CONVERSATION_HOWS.includes(String(existing.confirmed_how || ""))) return existing.confirmed_how as ConfirmedHow;
  if (how === "press" && live.confirmed && !live.pressReported) return (existing.confirmed_how as ConfirmedHow) || "still_live";
  return how;
}

function confirmationPatch(existing: RequirementRow, actor: Actor, how: ConfirmedHow, now: Date): Record<string, any> {
  const patch: Record<string, any> = {
    last_confirmed_at: now, last_confirmed_by: actor.id, last_confirmed_by_name: actor.name,
    confirmed_how: nextHow(existing, how, now), updated_at: now,
  };
  // A person confirming a draft makes it a real requirement.
  if (String(existing.status || "").trim().toLowerCase() === "draft") patch.status = "Active";
  // Not on a row client logins are shown (a PIPnet listing): the date would tell them when BGP confirmed it.
  if (!String(existing.requirement_date || "").trim() && !requirementClientVisible({ sources: existing.sources })) patch.requirement_date = now.toISOString().slice(0, 10);
  // Nobody owns it yet: the person who confirms it does.
  if (!existing.bgp_contact_user_id && !(Array.isArray(existing.bgp_contact_user_ids) && existing.bgp_contact_user_ids.length)) {
    patch.bgp_contact_user_id = actor.id;
    patch.bgp_contact_user_ids = [actor.id];
  }
  return patch;
}

// What was detected fills the brief's EMPTY size, use and places on the
// requirement being confirmed; a saved value is never replaced. Not on a row
// client logins are shown (a PIPnet listing): staff words stay off those.
function emptyBriefFill(existing: RequirementRow, fields: RequirementFields | undefined, details: Record<string, any> | null | undefined): Record<string, any> {
  if (requirementClientVisible({ sources: existing.sources })) return {};
  const f = fields || {}, d = details || {};
  const empty = (v: unknown) => !(Array.isArray(v) && v.length);
  const out: Record<string, any> = {};
  const use = cleanList(f.use) || cleanList(d.use), size = cleanList(f.size) || cleanList(d.size), places = cleanList(f.requirementLocations) || cleanList(d.locations);
  if (use && empty(existing.use)) out.use = use;
  if (size && empty(existing.size)) out.size = size;
  if (places && empty(existing.requirement_locations)) out.requirement_locations = places;
  return out;
}

function evidenceValues(input: EvidenceInput, match: BrandMatch, by: Actor | null): Partial<EvidenceRow> {
  const details = { ...(input.details || {}) } as Record<string, any>;
  if (match.by) details._matchedBy = match.by;
  return {
    company_id: match.companyId,
    brand_name: clip(match.brandName, 200),
    candidate_company_ids: match.candidates.length ? match.candidates.map(c => c.id) : null,
    kind: input.kind,
    source_label: clip(input.sourceLabel, 80),
    source_ref: clip(input.sourceRef, 300),
    evidence_date: toDate(input.evidenceDate),
    headline: clip(input.headline),
    excerpt: clip(input.excerpt),
    url: clip(input.url, 1000),
    said_by: clip(input.saidBy, 200),
    details: Object.keys(details).length ? details : null,
    confidence: input.confidence || null,
    created_by_kind: by ? "person" : "machine",
    created_by_user_id: by ? by.id : null,
    created_by_name: by ? by.name : clip(input.detectedBy, 80),
    dedupe_key: clip(input.dedupeKey, 400),
  };
}

// What a suggestion asks about an existing requirement, if anything. A question is kept apart from the brand's other suggestions of the same kind.
const proposalOf = (row: { details?: Record<string, any> | null } | null | undefined): string | null => (row?.details?.proposal ? String(row.details.proposal) : null);

const suggestionKey = (kind: string, match: { companyId: string | null; brandName: string | null }) =>
  `requirement-suggestion:${kind}:${match.companyId ? `c:${match.companyId}` : `n:${brandKey(match.brandName)}`}`;

// ── suggest ────────────────────────────────────────────────────────────────

export interface SuggestResult {
  /** opened = a new suggestion; joined = added to the brand's open one; duplicate = this record was read before; quiet = recorded, but the brand's news was dismissed in the last 30 days. */
  outcome: "opened" | "joined" | "duplicate" | "quiet";
  evidence: EvidenceRow;
  suggestionId: string | null;
  match: BrandMatch | null;
}

/**
 * Anything detected, by a machine or raised by a person who is not vouching
 * for it. Never writes a requirement. `by` is set only when a person raised
 * it by hand.
 */
export async function suggest(store: IntakeStore, input: EvidenceInput, opts: { by?: Actor | null; now?: Date } = {}): Promise<SuggestResult> {
  const kind = needKind(input?.kind);
  const now = opts.now || new Date();
  const by = opts.by ? needActor(opts.by) : null;
  const dedupeKey = clip(input.dedupeKey, 400);
  if (dedupeKey) {
    const seen = await store.evidenceByDedupeKey(dedupeKey);
    if (seen) return { outcome: "duplicate", evidence: seen, suggestionId: seen.suggestion_id || seen.id, match: null };
  }
  const match = await matchBrand(store, input.brand || {});
  if (!match.companyId && !brandKey(match.brandName)) throw new IntakeError(400, "NO_BRAND", "A suggestion needs a brand: a name, a tag or a contact");
  await store.lock(suggestionKey(kind, match));

  const values = evidenceValues({ ...input, kind }, match, by);
  const proposal = proposalOf(input);
  // A person dismissed this brand's news recently: keep the line (so the
  // story is never read twice) but do not raise it again. A question about
  // an existing requirement is not quietened, and dismissing one quietens nothing.
  if (kind === "press" && !by && !proposal) {
    const since = new Date(now.getTime() - NEWS_QUIET_DAYS * DAY_MS);
    const dismissed = (await store.personDismissalsSince(kind, match.companyId, since))
      .filter(r => sameBrand(r, match) && !proposalOf(r) && !NOT_QUIETING_REASONS.includes(String(r.resolved_reason || "")));
    if (dismissed.length) {
      const quiet = await store.insertEvidence({ ...values, status: "dismissed", resolved_reason: QUIET_REASON, resolved_by_name: "Quiet period", resolved_at: now });
      if (!quiet) return { outcome: "duplicate", evidence: (await store.evidenceByDedupeKey(dedupeKey!))!, suggestionId: null, match };
      return { outcome: "quiet", evidence: quiet, suggestionId: null, match };
    }
  }

  const head = (await store.openHeads(kind, match.companyId)).find(r => sameBrand(r, match) && proposalOf(r) === proposal) || null;
  const row = await store.insertEvidence({ ...values, status: "open", suggestion_id: head ? head.id : null });
  if (!row) {
    const seen = (await store.evidenceByDedupeKey(dedupeKey!))!;
    return { outcome: "duplicate", evidence: seen, suggestionId: seen.suggestion_id || seen.id, match };
  }
  return { outcome: head ? "joined" : "opened", evidence: row, suggestionId: head ? head.id : row.id, match };
}

// ── The reviewer's answers ─────────────────────────────────────────────────

async function openSuggestion(store: IntakeStore, suggestionId: string): Promise<{ head: EvidenceRow; lines: EvidenceRow[] }> {
  const first = await store.evidenceById(String(suggestionId || ""));
  if (!first) throw new IntakeError(404, "NOT_FOUND", "Suggestion not found");
  const headId = first.suggestion_id || first.id;
  const all = await store.suggestionLines(headId);
  const head = all.find(r => r.id === headId);
  if (!head) throw new IntakeError(404, "NOT_FOUND", "Suggestion not found");
  if (head.status !== "open") throw new IntakeError(409, "ALREADY_ANSWERED", `This suggestion was already ${head.status}${head.resolved_by_name ? ` by ${head.resolved_by_name}` : ""}`, { status: head.status });
  return { head, lines: all.filter(r => r.status === "open") };
}

async function pickedBrand(store: IntakeStore, companyId: string): Promise<BrandRef> {
  const [brand] = await store.brandsByIds([companyId]);
  if (!brand) throw new IntakeError(400, "BRAND_NOT_FOUND", "That brand is not in the CRM");
  // A requirement belongs to a tenant brand, never to a landlord, agent or client company.
  const type = String(brand.companyType || "").trim();
  if (type && brand.brandType === false) throw new IntakeError(400, "NOT_A_BRAND", `${brand.name} is recorded as "${type}", not a tenant brand. Pick the brand the requirement is for.`);
  return brand;
}

// The suggestion's brand, or the one the reviewer picked for it. A brand is
// never made up here: with no match and no pick, the answer is refused.
async function settledBrand(store: IntakeStore, head: EvidenceRow, lines: EvidenceRow[], companyId: string | null | undefined, actor: Actor, now: Date): Promise<BrandRef> {
  const picked = String(companyId || "").trim();
  if (!picked) {
    if (!head.company_id) throw new IntakeError(409, "BRAND_NEEDED", head.candidate_company_ids?.length
      ? "More than one brand is possible. Pick the brand first."
      : `"${head.brand_name || "This name"}" is not matched to a brand in the CRM. Pick the brand first.`, { candidates: head.candidate_company_ids || [] });
    return pickedBrand(store, head.company_id);
  }
  const brand = await pickedBrand(store, picked);
  if (head.company_id !== brand.id) {
    await store.updateEvidence(lines.map(l => l.id), { company_id: brand.id, candidate_company_ids: null });
    await store.updateEvidence([head.id], { details: { ...(head.details || {}), _matchedBy: "reviewer", _brandPickedBy: actor.name, _brandPickedAt: now.toISOString() } });
    head.company_id = brand.id;
  }
  return brand;
}

function cleanList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map(x => String(x ?? "").trim()).filter(Boolean).slice(0, 40);
  return out.length ? out : undefined;
}

function newRequirementValues(brand: BrandRef, head: { kind: string; source_label: string | null; headline: string | null; evidence_date: Date | null; details: Record<string, any> | null },
  fields: RequirementFields | undefined, actor: Actor, how: ConfirmedHow, now: Date): Record<string, any> {
  const f = fields || {};
  const d = head.details || {};
  const owners = cleanList(f.bgpContactUserIds) || [actor.id];
  const pressLine = how === "press"
    ? `Press-reported${head.source_label ? ` (${head.source_label}${head.evidence_date ? `, ${head.evidence_date.toISOString().slice(0, 10)}` : ""})` : ""}${head.headline ? `: ${head.headline}` : ""}. Nobody at BGP has recorded speaking to the brand.`
    : null;
  return {
    name: clip(f.name, 200) || brand.name,
    company_id: brand.id,
    status: "Active",
    use: cleanList(f.use) || cleanList(d.use) || null,
    requirement_type: cleanList(f.requirementType) || null,
    size: cleanList(f.size) || cleanList(d.size) || null,
    requirement_locations: cleanList(f.requirementLocations) || cleanList(d.locations) || null,
    comments: String(f.comments ?? "").trim() || pressLine || null,
    principal_contact_id: f.principalContactId || null,
    agent_contact_id: f.agentContactId || null,
    bgp_contact_user_id: owners[0],
    bgp_contact_user_ids: owners,
    // A requirement made from a press story carries the News label whichever screen it was confirmed on.
    sources: cleanList(f.sources) || (how === "press" ? ["News"] : null),
    requirement_date: now.toISOString().slice(0, 10),
    // BGP's own record, confirmed by the person who answered.
    origin: REQUIREMENT_ORIGIN_BGP,
    last_confirmed_at: now, last_confirmed_by: actor.id, last_confirmed_by_name: actor.name, confirmed_how: how,
  };
}

// The people a reviewer names on a new requirement must be real: active BGP
// colleagues as owners, CRM contacts as contacts. The routes call this on a
// request body before `confirm`.
export async function checkPeople(store: IntakeStore, fields: RequirementFields | undefined): Promise<void> {
  const owners = cleanList(fields?.bgpContactUserIds) || [];
  if (owners.length && (await store.staffByIds(owners)).length !== new Set(owners).size) throw new IntakeError(400, "NOT_STAFF", "Choose active BGP colleagues as the owner");
  const contacts = [fields?.principalContactId, fields?.agentContactId].map(x => String(x || "").trim()).filter(Boolean);
  if (contacts.length && store.contactsExist && (await store.contactsExist(contacts)).length !== new Set(contacts).size) throw new IntakeError(400, "CONTACT_NOT_FOUND", "That contact is not in the CRM");
}

function needHow(how: unknown, fallback: ConfirmedHow): ConfirmedHow {
  if (how == null || how === "") return fallback;
  if (!(CONFIRMED_HOW as readonly string[]).includes(String(how)) || how === "created") throw new IntakeError(400, "BAD_HOW", `Unknown way of confirming: ${String(how)}`);
  return how as ConfirmedHow;
}

async function targetRequirement(store: IntakeStore, requirementId: string, brandId: string | null, now: Date): Promise<RequirementRow> {
  const existing = await store.requirementById(String(requirementId));
  if (!existing) throw new IntakeError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");
  if (brandId && existing.company_id && existing.company_id !== brandId) throw new IntakeError(409, "OTHER_BRAND", "That requirement belongs to a different brand");
  if (isClosed(existing, now)) throw new IntakeError(409, "REQUIREMENT_CLOSED", "That requirement is closed. Reopen it before adding to it.");
  return existing;
}

// A brand's requirements that are still open, for "is this one of these?".
async function openRequirements(store: IntakeStore, brandId: string, now: Date): Promise<RequirementRow[]> {
  return (await store.requirementsForCompanies([brandId])).filter(r => !isClosed(r, now));
}

const requirementBrief = (r: RequirementRow, now: Date) => {
  const live = requirementLive(r, now);
  return { id: r.id, name: r.name, status: r.status, state: live.state, stateLabel: live.stateLabel, dateLabel: live.dateLabel };
};

export interface ConfirmArgs {
  /** The suggestion being answered… */
  suggestionId?: string;
  /** …or evidence a person is recording and vouching for in one go (a staff member telling ChatBGP to log a requirement). */
  evidence?: EvidenceInput;
  /** The brand, when the suggestion has none or the reviewer says it is a different one. */
  companyId?: string | null;
  /** Confirm this existing requirement instead of making a new one. */
  requirementId?: string | null;
  /** Make a new requirement although the brand already has an open one. */
  createNew?: boolean;
  how?: ConfirmedHow | null;
  fields?: RequirementFields;
}

export interface ConfirmResult {
  /** suggested = the brand could not be settled, so nothing was confirmed: it waits as a suggestion carrying the name. */
  outcome: "created" | "confirmed_existing" | "suggested" | "duplicate";
  requirement: RequirementRow | null;
  evidenceIds: string[];
  suggestionId?: string | null;
  reason?: "unmatched" | "ambiguous";
}

/**
 * A named BGP person says it is real. Creates a requirement (BGP's own,
 * confirmed by that person) or stamps an existing one, and links the
 * evidence. Refuses to guess: with an open requirement already on the brand
 * the caller must say which one, or say `createNew`.
 */
export async function confirm(store: IntakeStore, args: ConfirmArgs, actorIn: Actor, now: Date = new Date()): Promise<ConfirmResult> {
  const actor = needActor(actorIn);
  let head: EvidenceRow | null = null;
  let lines: EvidenceRow[] = [];
  let brand: BrandRef;
  let direct: { input: EvidenceInput; match: BrandMatch } | null = null;

  if (args.suggestionId) {
    ({ head, lines } = await openSuggestion(store, args.suggestionId));
    // "Is it satisfied?" is not "is it real?": confirming would stamp the requirement as live.
    if (asksSatisfied(head)) throw new IntakeError(409, "SATISFIED_QUESTION", "This asks whether the requirement is now satisfied. Mark it satisfied, add it to the requirement, or dismiss it.");
    await store.lock(suggestionKey(head.kind, { companyId: head.company_id, brandName: head.brand_name }));
    brand = await settledBrand(store, head, lines, args.companyId, actor, now);
  } else if (args.evidence) {
    const input = { ...args.evidence, kind: needKind(args.evidence.kind) };
    const dedupeKey = clip(input.dedupeKey, 400);
    if (dedupeKey) {
      const seen = await store.evidenceByDedupeKey(dedupeKey);
      if (seen) {
        const prior = seen.requirement_id ? await store.requirementById(seen.requirement_id) : null;
        if (seen.status === "open" || (prior && !isClosed(prior, now))) return { outcome: "duplicate", requirement: prior, evidenceIds: [seen.id], suggestionId: seen.status === "open" ? (seen.suggestion_id || seen.id) : null };
        // The requirement it made has since been closed or deleted: this is recorded afresh, without the key.
        input.dedupeKey = null;
      }
    }
    const match = args.companyId
      ? await pickedBrand(store, String(args.companyId)).then(b => ({ companyId: b.id, brandName: String(input.brand?.name || "").trim() || b.name, by: "tag" as const, candidates: [] }))
      : await matchBrand(store, input.brand || {});
    if (!match.companyId) {
      // Never invent a brand: the person's note waits as a suggestion carrying the name.
      const raised = await suggest(store, input, { by: actor, now });
      return { outcome: "suggested", requirement: null, evidenceIds: [raised.evidence.id], suggestionId: raised.suggestionId, reason: match.candidates.length ? "ambiguous" : "unmatched" };
    }
    brand = await pickedBrand(store, match.companyId);
    direct = { input, match };
  } else {
    throw new IntakeError(400, "NOTHING_TO_CONFIRM", "Give the suggestion being confirmed, or the evidence");
  }

  const kind = head ? head.kind : direct!.input.kind;
  const stillLiveQuestion = !!head && asksStillLive(head);
  const how = needHow(args.how, stillLiveQuestion ? "still_live" : confirmedHowFor(kind));
  let existing: RequirementRow | null = null;
  if (stillLiveQuestion) {
    // "Yes, still live" confirms the requirement the question is about. A closure story never makes a new one.
    existing = await questionRequirement(store, head!, args.requirementId, now, "This brand has no open requirement to confirm. Dismiss the question.");
  } else if (args.requirementId) {
    existing = await targetRequirement(store, args.requirementId, brand.id, now);
  } else if (!args.createNew) {
    const open = await openRequirements(store, brand.id, now);
    if (open.length) throw new IntakeError(409, "EXISTING_REQUIREMENT",
      `${brand.name} already has ${open.length === 1 ? "a requirement" : `${open.length} requirements`}. Confirm the one this is about, or say it is a new search.`,
      { existing: open.map(r => requirementBrief(r, now)) });
  }

  const patchFor = (row: RequirementRow) => ({
    ...confirmationPatch(row, actor, how, now), ...(row.company_id ? {} : { company_id: brand.id }),
    ...(stillLiveQuestion ? {} : emptyBriefFill(row, args.fields, head ? head.details : direct!.input.details)),
  });
  let requirement: RequirementRow;
  let evidenceIds: string[];
  if (direct) {
    const values = evidenceValues(direct.input, direct.match, actor);
    requirement = existing
      ? await store.updateRequirement(existing.id, patchFor(existing))
      : await store.insertRequirement(newRequirementValues(brand, { kind, source_label: values.source_label ?? null, headline: values.headline ?? null, evidence_date: values.evidence_date ?? null, details: values.details ?? null }, args.fields, actor, how, now));
    const row = await store.insertEvidence({ ...values, requirement_id: requirement.id, status: "confirmed", resolved_reason: DIRECT_REASON, resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: now });
    if (!row) throw new IntakeError(409, "DUPLICATE", "This was already recorded");
    evidenceIds = [row.id];
  } else {
    requirement = existing
      ? await store.updateRequirement(existing.id, patchFor(existing))
      : await store.insertRequirement(newRequirementValues(brand, head!, args.fields, actor, how, now));
    evidenceIds = lines.map(l => l.id);
    await store.updateEvidence(evidenceIds, { requirement_id: requirement.id, status: "confirmed", resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: now });
    await linkViewingLines(store, lines, requirement);
  }
  return { outcome: existing ? "confirmed_existing" : "created", requirement, evidenceIds };
}

const asksSatisfied = (head: EvidenceRow) => head.details?.proposal === PROPOSAL_MARK_SATISFIED;
const asksStillLive = (head: EvidenceRow) => head.details?.proposal === PROPOSAL_STILL_LIVE;

// The requirement a question is about: the one the reviewer names, else the
// one the question named, else the brand's only open one. Never a guess.
async function questionRequirement(store: IntakeStore, head: EvidenceRow, requirementId: string | null | undefined, now: Date, noneMessage: string): Promise<RequirementRow> {
  if (!head.company_id) throw new IntakeError(409, "BRAND_NEEDED", "Pick the brand first.");
  let id = String(requirementId || "").trim();
  if (!id) {
    const open = await openRequirements(store, head.company_id, now);
    const named = open.find(r => r.id === head.details?.requirementId);
    if (!named && open.length !== 1) throw new IntakeError(409, "REQUIREMENT_NEEDED",
      open.length ? "This brand has more than one requirement. Say which one this is about." : noneMessage,
      { existing: open.map(r => requirementBrief(r, now)) });
    id = (named || open[0]).id;
  }
  return targetRequirement(store, id, head.company_id, now);
}

// The viewings a suggestion was raised from now belong to the requirement it became.
async function linkViewingLines(store: IntakeStore, lines: EvidenceRow[], requirement: RequirementRow): Promise<void> {
  const ids = lines.filter(l => l.kind === "viewing" && l.source_ref).map(l => String(l.source_ref));
  if (ids.length && requirement.company_id && store.linkViewings) await store.linkViewings(ids, requirement.id, requirement.company_id);
}

export interface AttachArgs {
  suggestionId?: string;
  evidence?: EvidenceInput;
  requirementId: string;
  companyId?: string | null;
}

/** Adds the evidence to an existing requirement. Not a confirmation: the requirement's confirmed date does not move. */
export async function attach(store: IntakeStore, args: AttachArgs, actorIn: Actor | null, now: Date = new Date()): Promise<{ requirement: RequirementRow; evidenceIds: string[]; outcome: "attached" | "duplicate" }> {
  if (args.suggestionId) {
    const actor = needActor(actorIn);
    const { head, lines } = await openSuggestion(store, args.suggestionId);
    await store.lock(suggestionKey(head.kind, { companyId: head.company_id, brandName: head.brand_name }));
    const requirement = await targetRequirement(store, args.requirementId, null, now);
    // Adding to a requirement settles the brand: the requirement's own, else
    // the reviewer's pick. A suggestion matched to another brand is refused
    // unless the reviewer says which brand it is really about.
    const picked = String(args.companyId || "").trim() || null;
    if (requirement.company_id && ((picked && picked !== requirement.company_id) || (!picked && head.company_id && head.company_id !== requirement.company_id))) {
      throw new IntakeError(409, "OTHER_BRAND", "That requirement belongs to a different brand. Pick the brand first if the suggestion named the wrong one.");
    }
    const brandId = requirement.company_id || picked;
    if (brandId && head.company_id !== brandId) await settledBrand(store, head, lines, brandId, actor, now);
    const ids = lines.map(l => l.id);
    await store.updateEvidence(ids, { requirement_id: requirement.id, status: "attached", resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: now });
    await linkViewingLines(store, lines, requirement);
    return { requirement, evidenceIds: ids, outcome: "attached" };
  }
  if (!args.evidence) throw new IntakeError(400, "NOTHING_TO_ATTACH", "Give the suggestion being added, or the evidence");
  // Evidence recorded straight onto a requirement: a viewing, a listing. A
  // machine may do this (the fact is not in doubt); it still confirms nothing.
  const actor = actorIn ? needActor(actorIn) : null;
  const input = { ...args.evidence, kind: needKind(args.evidence.kind) };
  const requirement = await targetRequirement(store, args.requirementId, null, now);
  const dedupeKey = clip(input.dedupeKey, 400);
  const seen = dedupeKey ? await store.evidenceByDedupeKey(dedupeKey) : null;
  if (seen) return { requirement, evidenceIds: [seen.id], outcome: "duplicate" };
  const brand = requirement.company_id ? (await store.brandsByIds([requirement.company_id]))[0] : null;
  const match: BrandMatch = { companyId: brand?.id || requirement.company_id || null, brandName: String(input.brand?.name || "").trim() || brand?.name || requirement.name, by: null, candidates: [] };
  const row = await store.insertEvidence({ ...evidenceValues(input, match, actor), requirement_id: requirement.id, status: "attached", resolved_reason: DIRECT_REASON,
    resolved_by_user_id: actor?.id || null, resolved_by_name: actor?.name || clip(input.detectedBy, 80), resolved_at: now });
  if (!row) return { requirement, evidenceIds: [], outcome: "duplicate" };
  return { requirement, evidenceIds: [row.id], outcome: "attached" };
}

export async function dismiss(store: IntakeStore, args: { suggestionId: string; reason: string }, actorIn: Actor, now: Date = new Date()): Promise<{ evidenceIds: string[]; reason: string; quietUntil: Date | null }> {
  const actor = needActor(actorIn);
  const reason = clip(args.reason, 200);
  if (!reason || reason === QUIET_REASON || reason === DIRECT_REASON) throw new IntakeError(400, "REASON_NEEDED", "Say why: not a requirement, wrong brand, duplicate or out of date");
  const { head, lines } = await openSuggestion(store, args.suggestionId);
  await store.lock(suggestionKey(head.kind, { companyId: head.company_id, brandName: head.brand_name }));
  const ids = lines.map(l => l.id);
  await store.updateEvidence(ids, { status: "dismissed", resolved_reason: reason, resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: now });
  const quiets = head.kind === "press" && !proposalOf(head) && !NOT_QUIETING_REASONS.includes(reason);
  return { evidenceIds: ids, reason, quietUntil: quiets ? new Date(now.getTime() + NEWS_QUIET_DAYS * DAY_MS) : null };
}

/**
 * The reviewer's "yes" to a "mark as satisfied?" suggestion (a deal for the
 * brand reached solicitors): the requirement is closed as Past and the deal
 * stays on it as evidence. Not a confirmation: the confirmed date does not move.
 */
export async function markSatisfied(store: IntakeStore, args: { suggestionId: string; requirementId?: string | null }, actorIn: Actor, now: Date = new Date()): Promise<{ requirement: RequirementRow; evidenceIds: string[] }> {
  const actor = needActor(actorIn);
  const { head, lines } = await openSuggestion(store, args.suggestionId);
  if (!asksSatisfied(head)) throw new IntakeError(409, "NOT_A_SATISFIED_QUESTION", "This suggestion does not ask whether a requirement is satisfied");
  await store.lock(suggestionKey(head.kind, { companyId: head.company_id, brandName: head.brand_name }));
  if (!head.company_id) throw new IntakeError(409, "BRAND_NEEDED", "Pick the brand first.");
  let requirementId = String(args.requirementId || "").trim();
  if (!requirementId) {
    const open = await openRequirements(store, head.company_id, now);
    const named = open.find(r => r.id === head.details?.requirementId);
    if (!named && open.length !== 1) throw new IntakeError(409, "REQUIREMENT_NEEDED",
      open.length ? "This brand has more than one requirement. Say which one the deal satisfies." : "This brand has no open requirement to mark as satisfied.",
      { existing: open.map(r => requirementBrief(r, now)) });
    requirementId = (named || open[0]).id;
  }
  const existing = await targetRequirement(store, requirementId, head.company_id, now);
  const requirement = await store.updateRequirement(existing.id, { status: SATISFIED_STATUS, updated_at: now });
  const ids = lines.map(l => l.id);
  await store.updateEvidence(ids, { requirement_id: requirement.id, status: "attached", resolved_reason: "satisfied", resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: now });
  await note(store, requirement, actor, `Marked satisfied${head.headline ? `: ${head.headline}` : ""}`, now);
  return { requirement, evidenceIds: ids };
}

/**
 * The reviewer's "no" to a "still live?" suggestion (a closure, CVA or
 * administration story about a brand with a live requirement): the
 * requirement is archived and the story stays on it as evidence. "Yes" is
 * `confirm`, which stamps the requirement as confirmed by that person.
 */
export async function markNotLive(store: IntakeStore, args: { suggestionId: string; requirementId?: string | null }, actorIn: Actor, now: Date = new Date()): Promise<{ requirement: RequirementRow; evidenceIds: string[] }> {
  const actor = needActor(actorIn);
  const { head, lines } = await openSuggestion(store, args.suggestionId);
  if (!asksStillLive(head)) throw new IntakeError(409, "NOT_A_STILL_LIVE_QUESTION", "This suggestion does not ask whether a requirement is still live");
  await store.lock(suggestionKey(head.kind, { companyId: head.company_id, brandName: head.brand_name }));
  const existing = await questionRequirement(store, head, args.requirementId, now, "This brand has no open requirement to close. Dismiss the question.");
  const requirement = await store.updateRequirement(existing.id, { status: NOT_LIVE_STATUS, updated_at: now });
  const ids = lines.map(l => l.id);
  await store.updateEvidence(ids, { requirement_id: requirement.id, status: "attached", resolved_reason: "not_live", resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: now });
  await note(store, requirement, actor, `Marked no longer live${head.headline ? `: ${head.headline}` : ""}`, now);
  return { requirement, evidenceIds: ids };
}

/** The reviewer says which brand a suggestion is about ("wrong brand", an unmatched name, a tie). */
export async function setSuggestionBrand(store: IntakeStore, args: { suggestionId: string; companyId: string }, actorIn: Actor, now: Date = new Date()): Promise<{ suggestionId: string; companyId: string; joined: boolean }> {
  const actor = needActor(actorIn);
  const { head, lines } = await openSuggestion(store, args.suggestionId);
  const brand = await settledBrand(store, head, lines, args.companyId, actor, now);
  await store.lock(suggestionKey(head.kind, { companyId: brand.id, brandName: null }));
  // One open suggestion per brand and kind: if the brand already has one, this joins it.
  const other = (await store.openHeads(head.kind, brand.id)).find(r => r.id !== head.id && proposalOf(r) === proposalOf(head));
  if (other) {
    await store.updateEvidence(lines.map(l => l.id), { suggestion_id: other.id });
    return { suggestionId: other.id, companyId: brand.id, joined: true };
  }
  return { suggestionId: head.id, companyId: brand.id, joined: false };
}

// ── On a requirement ───────────────────────────────────────────────────────

/** "Still live": the caller confirms the requirement today. */
export async function stillLive(store: IntakeStore, requirementId: string, actorIn: Actor, how?: ConfirmedHow | null, now: Date = new Date()): Promise<RequirementRow> {
  const actor = needActor(actorIn);
  const existing = await targetRequirement(store, requirementId, null, now);
  const asked = needHow(how, "still_live");
  const patch = confirmationPatch(existing, actor, asked, now);
  const updated = await store.updateRequirement(existing.id, patch);
  await note(store, updated, actor, patch.confirmed_how === "press" ? "Still live (press-reported: nobody has recorded speaking to the brand)" : `Confirmed still live${asked !== "still_live" ? ` (${asked})` : ""}`, now);
  return updated;
}

// The trail: each confirmation and owner change leaves a dated line with the person's name.
async function note(store: IntakeStore, requirement: RequirementRow, actor: Actor, headline: string, now: Date): Promise<void> {
  await store.insertEvidence({
    requirement_id: requirement.id, company_id: requirement.company_id, brand_name: requirement.name, kind: "note", source_label: "Requirements",
    headline, evidence_date: now, status: "attached", resolved_reason: DIRECT_REASON,
    created_by_kind: "person", created_by_user_id: actor.id, created_by_name: actor.name,
    resolved_by_user_id: actor.id, resolved_by_name: actor.name, resolved_at: now,
  });
}

/** The BGP people who own the requirement. Not a confirmation and not an edit of the brief: no dates move. */
export async function setOwner(store: IntakeStore, requirementId: string, userIds: string[], actorIn: Actor, now: Date = new Date()): Promise<RequirementRow> {
  const actor = needActor(actorIn);
  const existing = await store.requirementById(String(requirementId));
  if (!existing) throw new IntakeError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");
  const ids = [...new Set((userIds || []).map(x => String(x || "").trim()).filter(Boolean))].slice(0, 10);
  const staff = await store.staffByIds(ids);
  if (staff.length !== ids.length) throw new IntakeError(400, "NOT_STAFF", "Choose active BGP colleagues as the owner");
  const updated = await store.updateRequirement(existing.id, { bgp_contact_user_id: ids[0] || null, bgp_contact_user_ids: ids.length ? ids : null });
  await note(store, updated, actor, ids.length ? `Owner set to ${ids.map(id => staff.find(u => u.id === id)?.name || id).join(", ")}` : "Owner removed", now);
  return updated;
}

export type HowSureKey = "conversation" | "person" | "viewing" | "press" | "listing" | "unconfirmed";
export interface HowSure { key: HowSureKey; label: string; why: string }

/** The "how sure" label, worked out from the requirement and its evidence each time. Never stored. */
export function howSure(requirement: RequirementRow, evidence: Array<{ kind: string; status?: string | null }>, now: Date = new Date()): HowSure {
  const live = requirementLive(requirement, now);
  const lines = evidence.filter(e => e.status !== "dismissed" && e.status !== "open");
  const has = (...kinds: string[]) => lines.some(e => kinds.includes(e.kind));
  // "By conversation" only when a call, meeting, email or chat is what the confirmation recorded.
  const how = String(requirement.confirmed_how || "").trim().toLowerCase();
  const who = String(requirement.last_confirmed_by_name || "").trim().split(/\s+/)[0] || "a BGP person";
  if (live.confirmed && !live.pressReported && CONVERSATION_HOWS.includes(how)) return { key: "conversation", label: "Confirmed by conversation", why: live.dateLabel };
  if (live.confirmed && !live.pressReported && (how === "viewing" || has("viewing", "offer"))) return { key: "viewing", label: `Viewing-backed, confirmed by ${who}`, why: `${live.dateLabel}; no conversation with the brand is recorded` };
  if (live.confirmed && !live.pressReported) return { key: "person", label: `Confirmed by ${who}, no conversation recorded`, why: live.dateLabel };
  if (has("viewing", "offer")) return { key: "viewing", label: "Viewing-backed", why: "The brand has viewed or offered; nobody has confirmed the brief with them" };
  if (live.pressReported || has("press")) return { key: "press", label: "Press-reported", why: live.pressReported ? live.dateLabel : "Reported in the press; nobody at BGP has confirmed it" };
  if (live.importOnly || has("listing")) return { key: "listing", label: "Market listing only", why: live.dateLabel };
  return { key: "unconfirmed", label: "Not yet confirmed", why: live.dateLabel };
}

// ── Reading (staff only: the routes refuse any client scope) ───────────────

export function evidenceOut(row: EvidenceRow) {
  const { _matchedBy, _brandPickedBy, _brandPickedAt, ...details } = (row.details || {}) as Record<string, any>;
  return {
    id: row.id, requirementId: row.requirement_id, companyId: row.company_id, brandName: row.brand_name,
    kind: row.kind, sourceLabel: row.source_label, sourceRef: row.source_ref, evidenceDate: row.evidence_date,
    headline: row.headline, excerpt: row.excerpt, url: row.url, saidBy: row.said_by,
    details: Object.keys(details).length ? details : null, confidence: row.confidence, status: row.status,
    matchedBy: _matchedBy || null,
    createdBy: { kind: row.created_by_kind, userId: row.created_by_user_id, name: row.created_by_name },
    resolved: row.resolved_at ? { userId: row.resolved_by_user_id, name: row.resolved_by_name, at: row.resolved_at, reason: row.resolved_reason } : null,
    createdAt: row.created_at,
  };
}

export async function listSuggestions(store: IntakeStore, filters: SuggestionFilters = {}, now: Date = new Date()) {
  const status = ["open", "confirmed", "attached", "dismissed"].includes(String(filters.status)) ? String(filters.status) : "open";
  const heads = await store.listHeads({ ...filters, status, limit: Math.min(Math.max(Number(filters.limit) || 100, 1), 300), offset: Math.max(Number(filters.offset) || 0, 0) });
  const joined = heads.length ? await store.joinedLines(heads.map(h => h.id)) : [];
  const brandIds = [...new Set(heads.flatMap(h => [h.company_id, ...(h.candidate_company_ids || [])]).filter((x): x is string => !!x))];
  const brands = new Map((brandIds.length ? await store.brandsByIds(brandIds) : []).map(b => [b.id, b]));
  const matched = [...new Set(heads.map(h => h.company_id).filter((x): x is string => !!x))];
  const requirements = matched.length ? await store.requirementsForCompanies(matched) : [];

  const suggestions = heads.map(h => {
    const lines = [h, ...joined.filter(l => l.suggestion_id === h.id && l.status === h.status)];
    const existing = h.company_id ? requirements.filter(r => r.company_id === h.company_id && !isClosed(r, now)).map(r => requirementBrief(r, now)) : [];
    return {
      ...evidenceOut(h),
      brand: {
        companyId: h.company_id,
        name: (h.company_id && brands.get(h.company_id)?.name) || h.brand_name,
        saidAs: h.brand_name,
        matched: !!h.company_id,
        candidates: (h.candidate_company_ids || []).map(id => brands.get(id)).filter((b): b is BrandRef => !!b).map(b => ({ id: b.id, name: b.name })),
      },
      lineCount: lines.length,
      lines: lines.map(evidenceOut),
      existingRequirements: existing,
      // One requirement on the brand: this is probably about it. More: the reviewer chooses.
      proposed: !h.company_id ? "pick_brand" : asksSatisfied(h) ? PROPOSAL_MARK_SATISFIED : asksStillLive(h) ? PROPOSAL_STILL_LIVE : existing.length === 1 ? "confirm_existing" : existing.length > 1 ? "choose" : "new",
    };
  });
  return { status, suggestions, counts: await suggestionCounts(store, now) };
}

export async function suggestionCounts(store: IntakeStore, now: Date = new Date()) {
  const rows = await store.openCounts();
  const byKind: Record<string, number> = {};
  let open = 0, unmatched = 0;
  for (const r of rows) { byKind[r.kind] = Number(r.count) || 0; open += Number(r.count) || 0; unmatched += Number(r.unmatched) || 0; }
  const drafts = (await store.draftRequirements()).map(r => ({ ...requirementBrief(r, now), companyId: r.company_id, comments: r.comments ?? null, createdAt: r.created_at ?? null }));
  return { open, unmatched, byKind, drafts: drafts.length, suggestionsAndDrafts: open + drafts.length, draftRequirements: drafts };
}

// Which market listing a requirement row carries, if any: the import's own stamp, else the old source label.
function listingSource(requirement: RequirementRow): "PIPnet" | "The Requirement List" | null {
  const sources: string[] = Array.isArray(requirement.sources) ? requirement.sources : [];
  for (const raw of [requirement.last_listed_source, requirement.origin, ...sources]) {
    const v = String(raw || "").trim().toLowerCase();
    if (v === "pipnet") return "PIPnet";
    if (v === "trl" || v === "the requirement list" || v === "therequirementlist") return "The Requirement List";
  }
  return null;
}

export async function requirementEvidence(store: IntakeStore, requirementId: string, now: Date = new Date()) {
  const requirement = await store.requirementById(String(requirementId));
  if (!requirement) throw new IntakeError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");
  const stored = await store.evidenceForRequirement(requirement.id);
  let viewings: Array<Record<string, any>> = [];
  try { viewings = await store.viewingsForRequirement(requirement.id); } catch { viewings = []; }
  let offers: Array<Record<string, any>> = [];
  try { offers = store.offersForRequirement ? await store.offersForRequirement(requirement.id) : []; } catch { offers = []; }
  const recorded = new Set(stored.filter(e => e.kind === "viewing").map(e => e.source_ref));
  // Viewings are read live from the viewing record, so a cancelled one drops out by itself.
  const live = viewings.filter(v => !recorded.has(String(v.id))).map(v => ({
    id: `viewing:${v.id}`, requirementId: requirement.id, companyId: requirement.company_id, brandName: v.company_name || null,
    kind: "viewing", sourceLabel: "Viewing", sourceRef: String(v.id), evidenceDate: toDate(v.viewing_date),
    headline: `${v.status === "completed" ? "Viewed" : "Viewing booked"}: ${[v.unit_name, v.property_name].filter(Boolean).join(", ") || "a unit"}`,
    excerpt: null, url: null, saidBy: null, details: null, confidence: null, status: "attached", matchedBy: null,
    createdBy: { kind: "machine", userId: null, name: "Viewing record" }, resolved: null, createdAt: null,
  }));
  // Offers the same way: the brand's confirmed offers, read from the offer record. No terms are copied here.
  const liveOffers = offers.map(o => ({
    id: `offer:${o.id}`, requirementId: requirement.id, companyId: requirement.company_id, brandName: o.company_name || null,
    kind: "offer", sourceLabel: "Offer", sourceRef: String(o.id), evidenceDate: toDate(o.offer_date),
    headline: `Offer${o.status ? ` (${String(o.status).toLowerCase()})` : ""}: ${[o.unit_name, o.property_name].filter(Boolean).join(", ") || "a unit"}`,
    excerpt: null, url: null, saidBy: null, details: null, confidence: null, status: "attached", matchedBy: null,
    createdBy: { kind: "machine", userId: null, name: "Offer record" }, resolved: null, createdAt: null,
  }));
  const lines = [...stored.map(evidenceOut), ...live, ...liveOffers];
  const liveState: RequirementLive = requirementLive(requirement, now);
  // The label is worked out before the listing line is added: the live rule already knows whether the row is a market listing.
  const sure = howSure(requirement, lines, now);
  // The PIPnet or Requirement List listing, read from the row the import stamps. Shown as a line; it confirms nothing.
  const listedOn = listingSource(requirement);
  if (listedOn && !stored.some(e => e.kind === "listing")) {
    let url: string | null = null;
    try { url = requirement.external_requirement_id && store.listingUrl ? await store.listingUrl(String(requirement.external_requirement_id)) : null; } catch { url = null; }
    lines.push({
      id: `listing:${requirement.id}`, requirementId: requirement.id, companyId: requirement.company_id, brandName: requirement.name,
      kind: "listing", sourceLabel: listedOn, sourceRef: requirement.external_requirement_id ? String(requirement.external_requirement_id) : null,
      evidenceDate: toDate(requirement.last_listed_at),
      headline: requirement.last_listed_at ? `Listed on ${listedOn}` : `Listed on ${listedOn}; the import kept no date`,
      excerpt: null, url, saidBy: null, details: null, confidence: null, status: "attached", matchedBy: null,
      createdBy: { kind: "machine", userId: null, name: `${listedOn} import` }, resolved: null, createdAt: null,
    });
  }
  lines.sort((a, b) => (toDate(b.evidenceDate || b.createdAt)?.getTime() || 0) - (toDate(a.evidenceDate || a.createdAt)?.getTime() || 0));
  return {
    requirement: { id: requirement.id, name: requirement.name, companyId: requirement.company_id, status: requirement.status,
      ownerUserIds: requirement.bgp_contact_user_ids || (requirement.bgp_contact_user_id ? [requirement.bgp_contact_user_id] : []), live: liveState },
    howSure: sure,
    evidence: lines,
  };
}

// ── Postgres ───────────────────────────────────────────────────────────────

export interface Queryable { query(text: string, params?: any[]): Promise<{ rows: any[] }> }

const EVIDENCE_COLUMNS = ["requirement_id", "company_id", "brand_name", "candidate_company_ids", "kind", "source_label", "source_ref", "evidence_date", "headline", "excerpt", "url", "said_by", "details", "confidence", "status", "created_by_kind", "created_by_user_id", "created_by_name", "resolved_by_user_id", "resolved_by_name", "resolved_at", "resolved_reason", "dedupe_key", "suggestion_id"] as const;
const REQUIREMENT_COLUMNS = ["name", "company_id", "status", "use", "requirement_type", "size", "requirement_locations", "principal_contact_id", "agent_contact_id", "bgp_contact_user_id", "bgp_contact_user_ids", "comments", "sources", "requirement_date", "last_confirmed_at", "last_confirmed_by", "last_confirmed_by_name", "confirmed_how", "origin", "updated_at"] as const;
const STAFF_DOMAIN = "@brucegillinghampollard.com";
const BRAND_COLUMNS = `b.id, b.name, (b.archived_at IS NOT NULL) AS hidden, (lower(coalesce(b.company_type, '')) LIKE 'tenant%' OR lower(coalesce(b.company_type, '')) = 'brand') AS "brandType", b.company_type AS "companyType"`;

function columnsOf(values: Record<string, any>, allowed: readonly string[]) {
  const cols = allowed.filter(c => values[c] !== undefined);
  const params = cols.map(c => (c === "details" && values[c] != null ? JSON.stringify(values[c]) : values[c]));
  return { cols, params };
}

export function pgIntakeStore(db: Queryable): IntakeStore {
  const rows = async (text: string, params: any[] = []) => (await db.query(text, params)).rows;
  return {
    async lock(key) { await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]); },

    // The contact's own company when it is a brand; otherwise the brands the
    // contact acts for (a current tenant-rep representation, or named on a
    // live requirement). Same reading as the viewing sync.
    async brandsForContacts(contactIds, emails) {
      return rows(
        `WITH people AS (
           SELECT ct.id, ct.company_id FROM crm_contacts ct
            WHERE ct.id = ANY($1::text[]) OR (ct.email IS NOT NULL AND lower(btrim(ct.email)) = ANY($2::text[]))
         ), direct AS (
           SELECT DISTINCT ${BRAND_COLUMNS}
             FROM people p JOIN crm_companies c ON c.id = p.company_id
             JOIN crm_companies b ON b.id = coalesce(c.merged_into_id, c.id)
            WHERE b.merged_into_id IS NULL AND (lower(coalesce(b.company_type, '')) LIKE 'tenant%' OR lower(coalesce(b.company_type, '')) = 'brand')
         ), acting AS (
           SELECT DISTINCT ${BRAND_COLUMNS}
             FROM brand_agent_representations r JOIN crm_companies b ON b.id = r.brand_company_id
            WHERE r.primary_contact_id IN (SELECT id FROM people) AND r.agent_type = 'tenant_rep'
              AND r.end_date IS NULL AND (r.start_date IS NULL OR r.start_date <= now()) AND b.merged_into_id IS NULL
           UNION
           SELECT DISTINCT ${BRAND_COLUMNS}
             FROM crm_requirements_leasing q JOIN crm_companies b ON b.id = q.company_id
            WHERE (q.agent_contact_id IN (SELECT id FROM people) OR q.principal_contact_id IN (SELECT id FROM people))
              AND lower(btrim(coalesce(q.status, ''))) IN ('', 'active') AND b.merged_into_id IS NULL
         )
         SELECT * FROM direct
         UNION
         SELECT * FROM acting WHERE NOT EXISTS (SELECT 1 FROM direct)`, [contactIds, emails]);
    },

    async brandsByIds(ids) {
      if (!ids.length) return [];
      return rows(`SELECT DISTINCT ${BRAND_COLUMNS} FROM crm_companies c JOIN crm_companies b ON b.id = coalesce(c.merged_into_id, c.id) WHERE c.id = ANY($1::text[])`, [ids]);
    },

    // A wide net on the longest word of the name, over the brand's name and
    // its recorded other names (UK entity, trading entities, saved aliases);
    // matchBrand then compares exactly.
    async brandsNamedLike(name) {
      const word = brandKey(name).split(" ").sort((a, b) => b.length - a.length)[0] || "";
      if (word.length < 2) return [];
      const found = await rows(
        `SELECT ${BRAND_COLUMNS}, b.uk_entity_name, b.trading_entities, b.ai_generated_fields->'brand_identity' AS brand_identity
           FROM crm_companies b
          WHERE b.merged_into_id IS NULL AND (
                lower(b.name) LIKE $1 OR lower(coalesce(b.uk_entity_name, '')) LIKE $1
             OR lower(coalesce(b.trading_entities::text, '')) LIKE $1
             OR lower(coalesce((b.ai_generated_fields->'brand_identity'->'aliases')::text, '')) LIKE $1)
          LIMIT 500`, [`%${word}%`]);
      return found.map((b: any) => ({
        id: b.id, name: b.name, hidden: b.hidden, brandType: b.brandType,
        otherNames: getBrandIdentity({ name: b.name, uk_entity_name: b.uk_entity_name, trading_entities: b.trading_entities, ai_generated_fields: { brand_identity: b.brand_identity } }).aliases,
      }));
    },

    async staffByIds(ids) {
      if (!ids.length) return [];
      return rows(`SELECT id, name FROM users WHERE id = ANY($1::text[]) AND is_active IS NOT FALSE AND lower(coalesce(role, '')) <> 'client' AND lower(btrim(coalesce(email, ''))) LIKE $2`, [ids, `%${STAFF_DOMAIN}`]);
    },

    async contactsExist(ids) {
      if (!ids.length) return [];
      return (await rows(`SELECT id FROM crm_contacts WHERE id = ANY($1::text[])`, [ids])).map((r: any) => String(r.id));
    },

    async evidenceById(id) { return (await rows(`SELECT * FROM requirement_evidence WHERE id = $1`, [id]))[0] || null; },
    async evidenceByDedupeKey(key) { return (await rows(`SELECT * FROM requirement_evidence WHERE dedupe_key = $1`, [key]))[0] || null; },

    async openHeads(kind, companyId) {
      return rows(`SELECT * FROM requirement_evidence WHERE status = 'open' AND suggestion_id IS NULL AND kind = $1
                    AND (($2::text IS NULL AND company_id IS NULL) OR company_id = $2) ORDER BY created_at, id`, [kind, companyId]);
    },

    async personDismissalsSince(kind, companyId, since) {
      return rows(`SELECT * FROM requirement_evidence WHERE status = 'dismissed' AND resolved_by_user_id IS NOT NULL AND kind = $1
                    AND (($2::text IS NULL AND company_id IS NULL) OR company_id = $2) AND resolved_at >= $3`, [kind, companyId, since]);
    },

    async suggestionLines(headId) {
      return rows(`SELECT * FROM requirement_evidence WHERE id = $1 OR suggestion_id = $1 ORDER BY created_at, id FOR UPDATE`, [headId]);
    },

    async insertEvidence(values) {
      const { cols, params } = columnsOf(values, EVIDENCE_COLUMNS);
      const marks = cols.map((c, i) => (c === "details" ? `$${i + 1}::jsonb` : `$${i + 1}`));
      const made = await rows(`INSERT INTO requirement_evidence (${cols.join(", ")}) VALUES (${marks.join(", ")})
                               ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING *`, params);
      return made[0] || null;
    },

    async updateEvidence(ids, patch) {
      const { cols, params } = columnsOf(patch, EVIDENCE_COLUMNS);
      if (!ids.length || !cols.length) return;
      const sets = cols.map((c, i) => `${c} = ${c === "details" ? `$${i + 1}::jsonb` : `$${i + 1}`}`);
      await db.query(`UPDATE requirement_evidence SET ${sets.join(", ")}, updated_at = now() WHERE id = ANY($${cols.length + 1}::text[])`, [...params, ids]);
    },

    async requirementById(id) { return (await rows(`SELECT * FROM crm_requirements_leasing WHERE id = $1`, [id]))[0] || null; },
    async requirementsForCompanies(companyIds) {
      if (!companyIds.length) return [];
      return rows(`SELECT * FROM crm_requirements_leasing WHERE company_id = ANY($1::text[]) ORDER BY created_at DESC NULLS LAST`, [companyIds]);
    },

    async insertRequirement(values) {
      const { cols, params } = columnsOf(values, REQUIREMENT_COLUMNS);
      const made = await rows(`INSERT INTO crm_requirements_leasing (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, params);
      return made[0];
    },

    async updateRequirement(id, patch) {
      const { cols, params } = columnsOf(patch, REQUIREMENT_COLUMNS);
      if (!cols.length) return (await rows(`SELECT * FROM crm_requirements_leasing WHERE id = $1`, [id]))[0];
      const changed = await rows(`UPDATE crm_requirements_leasing SET ${cols.map((c, i) => `"${c}" = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1} RETURNING *`, [...params, id]);
      return changed[0];
    },

    async evidenceForRequirement(requirementId) {
      return rows(`SELECT * FROM requirement_evidence WHERE requirement_id = $1 AND status IN ('confirmed', 'attached') ORDER BY coalesce(evidence_date, created_at) DESC NULLS LAST`, [requirementId]);
    },

    // Viewings linked to this requirement, plus the brand's viewings linked
    // to no requirement at all (one linked to another search stays there).
    async viewingsForRequirement(requirementId) {
      return rows(`SELECT v.id, v.viewing_date, v.status, v.company_name, au.unit_name, p.name AS property_name
                     FROM crm_requirements_leasing q
                     JOIN unit_viewings v ON v.requirement_id = q.id OR (v.requirement_id IS NULL AND q.company_id IS NOT NULL AND v.company_id = q.company_id)
                     LEFT JOIN available_units au ON au.id = v.unit_id LEFT JOIN crm_properties p ON p.id = au.property_id
                    WHERE q.id = $1 AND v.deleted_at IS NULL AND v.details_confirmed_at IS NOT NULL
                      AND lower(coalesce(v.status, '')) NOT IN ('cancelled', 'canceled', 'no_show', 'not_leasing')
                    ORDER BY v.viewing_date DESC LIMIT 50`, [requirementId]);
    },

    // Confirmed offers only: the email detector's unconfirmed rows are not evidence.
    async offersForRequirement(requirementId) {
      return rows(`SELECT o.id, o.offer_date, o.status, o.company_name, au.unit_name, p.name AS property_name
                     FROM crm_requirements_leasing q
                     JOIN unit_offers o ON o.company_id = q.company_id
                     LEFT JOIN available_units au ON au.id = o.unit_id LEFT JOIN crm_properties p ON p.id = au.property_id
                    WHERE q.id = $1 AND q.company_id IS NOT NULL AND o.confirmed_at IS NOT NULL
                    ORDER BY o.offer_date DESC NULLS LAST LIMIT 50`, [requirementId]);
    },

    async linkViewings(viewingIds, requirementId, companyId) {
      if (!viewingIds.length) return;
      await db.query(`UPDATE unit_viewings SET requirement_id = $2, updated_at = clock_timestamp()
                       WHERE id = ANY($1::text[]) AND requirement_id IS NULL AND company_id = $3 AND deleted_at IS NULL`, [viewingIds, requirementId, companyId]);
    },

    async listingUrl(externalRequirementId) {
      const [row] = await rows(`SELECT source_url FROM external_requirements WHERE id = $1`, [externalRequirementId]);
      const url = String(row?.source_url || "").trim();
      return /^https?:\/\//i.test(url) ? url : null;
    },

    async listHeads(f) {
      const q = String(f.q || "").trim();
      return rows(
        `SELECT e.* FROM requirement_evidence e
          WHERE e.suggestion_id IS NULL AND e.status = $1 AND e.resolved_reason IS DISTINCT FROM '${DIRECT_REASON}' AND e.resolved_reason IS DISTINCT FROM '${QUIET_REASON}'
            AND ($2::text IS NULL OR e.kind = $2)
            AND ($3::text IS NULL OR e.company_id = $3)
            AND ($4::boolean IS NOT TRUE OR e.company_id IS NULL)
            AND ($5::text IS NULL OR e.brand_name ILIKE $5 OR EXISTS (SELECT 1 FROM crm_companies c WHERE c.id = e.company_id AND c.name ILIKE $5))
          ORDER BY coalesce(e.evidence_date, e.created_at) DESC NULLS LAST, e.id
          LIMIT $6 OFFSET $7`,
        [f.status || "open", f.kind || null, f.companyId || null, !!f.unmatched, q ? `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%` : null, f.limit || 100, f.offset || 0]);
    },

    async joinedLines(headIds) {
      return rows(`SELECT * FROM requirement_evidence WHERE suggestion_id = ANY($1::text[]) ORDER BY coalesce(evidence_date, created_at) DESC NULLS LAST`, [headIds]);
    },

    async openCounts() {
      return rows(`SELECT kind, count(*)::int AS count, (count(*) FILTER (WHERE company_id IS NULL))::int AS unmatched
                     FROM requirement_evidence WHERE status = 'open' AND suggestion_id IS NULL GROUP BY kind`);
    },

    async draftRequirements() {
      return rows(`SELECT * FROM crm_requirements_leasing WHERE lower(btrim(coalesce(status, ''))) = 'draft' ORDER BY created_at DESC NULLS LAST LIMIT 200`);
    },
  };
}
