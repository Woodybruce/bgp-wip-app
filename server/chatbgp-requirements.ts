// ChatBGP's door to the requirements centre (Woody, 2026-11-12;
// docs/requirements-review-2026-11-12.md, "Fix ChatBGP first").
//
//   create_requirement  a staff member tells ChatBGP a brand is looking. Their
//                       word is the confirmation: it goes through the intake's
//                       `confirm`, owned and confirmed by that person. An
//                       unmatched brand only raises a suggestion (To confirm).
//                       A brand that already has a requirement for the same
//                       area gets that one confirmed and added to, never a
//                       second row; where it is not clear which one is meant,
//                       nothing is saved and the user is asked.
//   update_requirement  edits a requirement. An edit is not a confirmation;
//                       `stillLive` is, and goes through the intake.
//   search / context    read crm_requirements_leasing with the one live rule
//                       and say how each row is known.
//   legacy rows         the old `requirements` table ChatBGP used to write is
//                       listed for an admin, who passes rows through the
//                       intake as SUGGESTIONS. Never straight to live.
//
// Staff only. Leasing only: investment requirements are not handled here.
import { createHash } from "node:crypto";
import { requirementLive, requirementStateSql, type ConfirmedHow } from "@shared/requirement-live";
import {
  confirm, suggest, stillLive, matchBrand, brandKey, pgIntakeStore, IntakeError,
  type Actor, type IntakeStore, type RequirementRow, type EvidenceInput, type EvidenceKind, type Queryable,
} from "./requirement-intake";

const INVESTMENT_REFUSAL = "Investment (buyer) requirements are not logged with this tool. Nothing was saved. Add it on the Requirements page (Investment view), or ask in that landlord's own chat thread, where it is saved to their Investment Requirements board.";
// How the user knows, as they told ChatBGP. "press" keeps the requirement press-reported until someone records speaking to the brand.
const CHAT_HOW: Record<string, EvidenceKind> = { chat: "chat", call: "call", meeting: "meeting", email: "email", viewing: "viewing", press: "press" };
const STATUS_WORDS: Record<string, string> = { active: "Active", fulfilled: "Past", past: "Past", withdrawn: "Archived", archived: "Archived", on_hold: "Archived", "on hold": "Archived" };

export interface ChatRequirementResult {
  success: boolean;
  /** Plain words for the user. Always present. */
  message: string;
  error?: string;
  [key: string]: any;
}

const text = (v: unknown, max = 500): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
  .map(x => text(x, 200)).filter((x): x is string => !!x).slice(0, 40);

/** "Mayfair, Soho" is two places. "Brighton & Hove" and "Elephant and Castle" stay whole. */
export function splitPlaces(v: unknown): string[] {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[;,\n]/) : [];
  const seen = new Set<string>();
  return parts.map(x => text(x, 200)).filter((x): x is string => !!x && !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase())).slice(0, 40);
}

const SQ_FT = /\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet|sf)\s*$/i;

/** The size as the Requirements page reads it: "2,000 - 5,000 sq ft". */
export function sizeText(min: unknown, max: unknown): string | null {
  const a = text(min, 80), b = text(max, 80);
  if (a && b) {
    if (a.toLowerCase() === b.toLowerCase()) return a;
    const bare = (s: string) => /^[\d,.]+$/.test(s);
    if ((SQ_FT.test(a) || bare(a)) && (SQ_FT.test(b) || bare(b))) return `${a.replace(SQ_FT, "")} - ${b.replace(SQ_FT, "")} sq ft`;
    return `${a} - ${b}`;
  }
  return a ? `From ${a}` : b ? `Up to ${b}` : null;
}

const placeKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z\d]+/g, " ").trim();

/** Whether two briefs could be the same search by area. With no area on either side there is nothing to tell them apart. */
export function sameArea(said: string[], saved: string[] | null | undefined): boolean {
  const a = said.map(placeKey).filter(Boolean), b = (saved || []).map(placeKey).filter(Boolean);
  if (!a.length || !b.length) return true;
  return a.some(x => b.some(y => x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)));
}

const sameList = (a: string[], b: string[] | null | undefined) =>
  a.map(placeKey).sort().join("|") === (b || []).map(placeKey).filter(Boolean).sort().join("|");

const ukDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

// Client logins are shown requirement rows labelled PIPnet (server/crm.ts).
// What a staff member tells ChatBGP is BGP's own knowledge, so it is never
// copied onto such a row automatically.
const clientsCanSee = (r: RequirementRow) => Array.isArray(r.sources) && r.sources.includes("PIPnet");

interface Brief {
  investment: boolean;
  brandName: string | null;
  companyId: string | null;
  contactName: string | null;
  size: string[];
  locations: string[];
  use: string[];
  budget: string | null;
  priority: string | null;
  notes: string | null;
  how: string;
  requirementId: string | null;
  suggestionId: string | null;
  newSearch: boolean;
}

function readBrief(raw: any): Brief {
  const a = raw && typeof raw === "object" ? raw : {};
  const size = sizeText(a.sizeMin, a.sizeMax);
  const how = String(a.how || "").trim().toLowerCase();
  const priority = String(a.priority || "").trim().toLowerCase();
  return {
    investment: String(a.category || "").trim().toLowerCase() === "investment",
    brandName: text(a.companyName, 200),
    companyId: text(a.companyId, 100),
    contactName: text(a.contactName, 200),
    size: size ? [size] : [],
    locations: splitPlaces([...splitPlaces(a.locations), ...splitPlaces(a.location)]),
    use: list(a.use),
    budget: text(a.budget, 200),
    priority: priority === "high" || priority === "low" ? priority : null,
    notes: text(a.notes, 4000),
    how: CHAT_HOW[how] ? how : "chat",
    requirementId: text(a.requirementId, 100),
    suggestionId: text(a.suggestionId, 100),
    newSearch: a.newSearch === true,
  };
}

// The facts of the brief on one line: "2,000 - 5,000 sq ft; Leeds; budget £50 psf".
function briefLine(b: Brief): string {
  return [b.size.join(", "), b.locations.join(", "), b.use.join(" / "), b.budget ? `budget ${b.budget}` : "", b.priority ? `${b.priority} priority` : "", b.contactName ? `contact ${b.contactName}` : ""]
    .filter(Boolean).join("; ");
}

function describe(r: RequirementRow, now: Date) {
  const live = requirementLive(r, now);
  return {
    id: r.id, name: r.name, companyId: r.company_id, status: r.status, use: r.use || [], size: r.size || [], locations: r.requirement_locations || [],
    state: live.stateLabel, howKnown: live.dateLabel, marketListing: live.importOnly, pressReported: live.pressReported,
  };
}

function oneLine(r: RequirementRow, now: Date): string {
  const d = describe(r, now);
  const facts = [d.locations.join(", "), d.size.join(", "), d.use.join(" / ")].filter(Boolean).join("; ");
  return `${d.name}${facts ? ` (${facts})` : ""}: ${d.state}, ${d.howKnown}`;
}

const pageUrl = (companyId: string | null | undefined) => (companyId ? `/requirements?companyId=${encodeURIComponent(companyId)}` : "/requirements");
const fail = (message: string, extra: Record<string, any> = {}): ChatRequirementResult => ({ success: false, error: message, message, ...extra });

/**
 * A staff member told ChatBGP to log a requirement. Their word is the
 * confirmation. Never makes a second requirement for a brand and area that
 * already has one, never invents a brand, and saves nothing when it is not
 * clear which requirement is meant.
 */
export async function logRequirementFromChat(store: IntakeStore, raw: any, actor: Actor, now: Date = new Date()): Promise<ChatRequirementResult> {
  const b = readBrief(raw);
  if (b.investment) return fail(INVESTMENT_REFUSAL);
  if (!b.brandName && !b.companyId) return fail("Which brand is the requirement for? Nothing was saved.");
  const line = briefLine(b);
  const kind = CHAT_HOW[b.how];
  const evidence: EvidenceInput = {
    kind,
    brand: { name: b.brandName },
    sourceLabel: "ChatBGP",
    evidenceDate: now,
    headline: `${actor.name} told ChatBGP${line ? `: ${line}` : " the brand is looking for space"}`,
    excerpt: b.notes,
    saidBy: b.contactName,
    details: { size: b.size, locations: b.locations, use: b.use, budget: b.budget, priority: b.priority, contact: b.contactName },
    // A retry of the same instruction on the same day returns the record already saved.
    dedupeKey: `chatbgp:${createHash("sha256").update(JSON.stringify([actor.id, now.toISOString().slice(0, 10), { ...b, brandName: brandKey(b.brandName) }])).digest("hex").slice(0, 40)}`,
  };

  // The brand: the CRM record the user gave, else the strongest match on the name.
  let brand: { id: string; name: string } | null = null;
  let tied = false;
  if (b.companyId) {
    brand = (await store.brandsByIds([b.companyId]))[0] || null;
    if (!brand) return fail("That company id is not in the CRM. Search for the brand first. Nothing was saved.");
  } else {
    const match = await matchBrand(store, { name: b.brandName });
    tied = match.candidates.length > 0;
    if (match.companyId) brand = (await store.brandsByIds([match.companyId]))[0] || null;
  }

  if (!brand) {
    if (b.suggestionId) return fail(`"${b.brandName}" is still not matched to a brand in the CRM. The suggestion is still waiting in To confirm. Nothing else was saved.`);
    // Never invent a brand: the person's note waits as a suggestion carrying the name.
    const out = await confirm(store, { evidence }, actor, now);
    if (out.outcome === "duplicate" && out.requirement) return { success: true, action: "already_logged", entity: "requirement", ...describe(out.requirement, now), url: pageUrl(out.requirement.company_id), message: `This was already logged today: ${oneLine(out.requirement, now)}. Nothing new was saved.` };
    return {
      success: true, action: "suggested", entity: "requirement suggestion", requirementSaved: false, suggestionId: out.suggestionId || null,
      brandSaid: b.brandName, reason: tied ? "ambiguous" : "unmatched", url: "/requirements",
      message: `${tied ? `More than one brand in the CRM could be "${b.brandName}"` : `"${b.brandName}" is not matched to a brand in the CRM`}, so no requirement was made and nothing is live. `
        + `It is saved as a suggestion waiting in To confirm on the Requirements page, where someone picks the brand and confirms it.${out.suggestionId ? ` (suggestion id ${out.suggestionId})` : ""}`,
      next: "Tell the user exactly this. If they then give the right brand, call create_requirement again with that brand's companyId and this suggestionId.",
    };
  }

  const open = (await store.requirementsForCompanies([brand.id])).filter(r => requirementLive(r, now).state !== "closed");
  let targetId = b.requirementId;
  if (!targetId && !b.newSearch && open.length) {
    const same = open.filter(r => sameArea(b.locations, r.requirement_locations));
    if (same.length !== 1) {
      return fail(`${brand.name} already has ${open.length === 1 ? "a requirement" : `${open.length} requirements`} on the Requirements page: ${open.map(r => `${oneLine(r, now)} (id ${r.id})`).join(" | ")}. `
        + `Nothing was saved. Is this the same search as ${open.length === 1 ? "that one" : "one of those"}, or a separate new search?`,
      { needsChoice: true, brand: brand.name, companyId: brand.id, existing: open.map(r => describe(r, now)),
        next: "Ask the user, then call create_requirement again with requirementId (the same search: it is confirmed and added to) or newSearch: true (a separate search)." });
    }
    targetId = same[0].id;
  }

  const fields = {
    use: b.use.length ? b.use : undefined,
    size: b.size.length ? b.size : undefined,
    requirementLocations: b.locations.length ? b.locations : undefined,
    comments: [b.notes, b.budget ? `Budget: ${b.budget}` : "", b.priority ? `Priority: ${b.priority}` : "", b.contactName ? `Contact: ${b.contactName}` : ""].filter(Boolean).join("\n") || undefined,
    sources: ["ChatBGP"],
  };
  const out = await confirm(store, {
    ...(b.suggestionId ? { suggestionId: b.suggestionId } : { evidence }),
    companyId: brand.id, requirementId: targetId || null, createNew: b.newSearch, fields,
  }, actor, now);

  if (out.outcome === "duplicate" || !out.requirement) {
    if (out.requirement) return { success: true, action: "already_logged", entity: "requirement", ...describe(out.requirement, now), url: pageUrl(out.requirement.company_id), message: `This was already logged today: ${oneLine(out.requirement, now)}. Nothing new was saved.` };
    return { success: true, action: "already_logged", entity: "requirement suggestion", requirementSaved: false, suggestionId: out.suggestionId || null, url: "/requirements", message: "This was already recorded today and is waiting in To confirm on the Requirements page. Nothing new was saved." };
  }

  let requirement = out.requirement;
  const press = requirementLive(requirement, now).pressReported;
  const pressNote = press ? " It is marked press-reported until someone records speaking to the brand." : "";
  if (out.outcome === "created") {
    return {
      success: true, action: "created", entity: "requirement", category: "Leasing", brand: brand.name, ...describe(requirement, now), url: pageUrl(brand.id),
      message: `Logged a requirement for ${brand.name}${line ? ` (${line})` : ""}. It is on the Requirements page as Live, confirmed today by ${actor.name}.${pressNote}`,
    };
  }

  // The brand already had this requirement: confirmed above; now add what was said without overwriting what is saved.
  const filled: string[] = [];
  const notChanged: Array<{ field: string; saved: string[]; said: string[] }> = [];
  let keptOffRow = false;
  if (clientsCanSee(requirement)) {
    keptOffRow = true;
  } else {
    const patch: Record<string, any> = {};
    for (const [field, column, said] of [["size", "size", b.size], ["locations", "requirement_locations", b.locations], ["use", "use", b.use]] as const) {
      const saved: string[] = Array.isArray(requirement[column]) ? requirement[column].filter(Boolean) : [];
      if (!said.length || sameList(said, saved)) continue;
      if (!saved.length) { patch[column] = said; filled.push(field); }
      else notChanged.push({ field, saved, said });
    }
    const said = [line, b.notes].filter(Boolean).join(". ");
    if (said) {
      const entry = `[${ukDay(now)}, ${actor.name} via ChatBGP] ${said}`;
      patch.comments = requirement.comments ? `${requirement.comments}\n\n${entry}` : entry;
    }
    if (Object.keys(patch).length) requirement = await store.updateRequirement(requirement.id, { ...patch, updated_at: now });
  }
  return {
    success: true, action: "updated", entity: "requirement", category: "Leasing", brand: brand.name, ...describe(requirement, now), url: pageUrl(brand.id),
    alreadyExisted: true, filled, notChanged, briefKeptAsEvidenceOnly: keptOffRow,
    message: `${brand.name} already had this requirement, so I did not add a second one. It is confirmed as Live today by ${actor.name}.${pressNote}`
      + (keptOffRow ? " That row is the PIPnet listing, which client logins can see, so what you told me is kept as staff-only evidence on it and its text was not changed."
        : `${filled.length ? ` Filled in: ${filled.join(", ")}.` : ""}${line || b.notes ? " Your note is added to its comments." : ""}`)
      + notChanged.map(n => ` The saved ${n.field} (${n.saved.join(", ")}) differs from what you said (${n.said.join(", ")}); I left it as it was.`).join("")
      + (notChanged.length ? ` Say if the saved details should be replaced. (id ${requirement.id})` : ""),
    ...(notChanged.length ? { next: "Only if the user agrees, call update_requirement with this id, the new values and replaceSaved: true." } : {}),
  };
}

/**
 * Edits a requirement from chat. Notes are added, never erased. Saved size,
 * locations and use are replaced only with `replaceSaved`. An edit is not a
 * confirmation; `stillLive` is, and is recorded against the person.
 */
export async function updateRequirementFromChat(store: IntakeStore, raw: any, actor: Actor, now: Date = new Date()): Promise<ChatRequirementResult> {
  const a = raw && typeof raw === "object" ? raw : {};
  const id = text(a.id, 100);
  if (!id) return fail("Which requirement? Search for it first to get its id. Nothing was changed.");
  const existing = await store.requirementById(id);
  if (!existing) {
    return fail(`No leasing requirement has the id "${id}". Search for it first (search_crm, requirements). Investment (buyer) requirements are not changed with this tool: edit those on the Requirements page (Investment view) or in that landlord's own chat thread. Nothing was changed.`);
  }
  const b = readBrief({ ...a, companyName: null });
  const patch: Record<string, any> = {};
  const changed: string[] = [];
  const needsConfirmation: Array<{ field: string; saved: string[]; said: string[] }> = [];
  // What a staff member tells ChatBGP is not written onto a row client logins can see.
  const visible = clientsCanSee(existing);
  let withheld = false;
  for (const [field, column, said] of [["size", "size", b.size], ["locations", "requirement_locations", b.locations], ["use", "use", b.use]] as const) {
    const saved: string[] = Array.isArray(existing[column]) ? existing[column].filter(Boolean) : [];
    if (!said.length || sameList(said, saved)) continue;
    if (visible) withheld = true;
    else if (!saved.length || a.replaceSaved === true) { patch[column] = said; changed.push(field); }
    else needsConfirmation.push({ field, saved, said });
  }
  let statusNote = "";
  if (a.status != null && a.status !== "") {
    const word = String(a.status).trim().toLowerCase();
    const status = STATUS_WORDS[word];
    if (!status) return fail(`"${a.status}" is not a status a requirement can have (Active, Past or Archived). Nothing was changed.`);
    if (status !== existing.status) { patch.status = status; changed.push(`status (${status})`); }
    if (word === "on_hold" || word === "on hold") statusNote = "On hold";
  }
  const said = [statusNote, b.budget ? `budget ${b.budget}` : "", b.priority ? `${b.priority} priority` : "", b.contactName ? `contact ${b.contactName}` : "", b.notes || ""].filter(Boolean).join("; ");
  if (said && visible) withheld = true;
  else if (said) {
    const entry = `[${ukDay(now)}, ${actor.name} via ChatBGP] ${said}`;
    patch.comments = existing.comments ? `${existing.comments}\n\n${entry}` : entry;
    changed.push("comments");
  }
  const confirming = a.stillLive === true;
  const replaceLine = needsConfirmation.map(n => `The saved ${n.field} is ${n.saved.join(", ")}; you said ${n.said.join(", ")}.`).join(" ");
  const withheldLine = withheld ? "This row is the PIPnet listing, which client logins can see, so I did not write your details or note onto it. Edit it on the Requirements page if they should be there, or ask me to log BGP's own requirement for the brand as a new search. " : "";
  if (!changed.length && !confirming) {
    if (withheld) return fail(`${withheldLine}Nothing was changed.`, { withheldFromClientVisibleRow: true });
    if (needsConfirmation.length) return fail(`${replaceLine} Nothing was changed. Should the saved details be replaced? (id ${existing.id})`, { needsConfirmation, next: "Only if the user agrees, call update_requirement again with replaceSaved: true." });
    return fail("No changes were given. Nothing was changed.");
  }
  let requirement = changed.length ? await store.updateRequirement(existing.id, { ...patch, updated_at: now }) : existing;
  if (confirming) {
    const how = String(a.how || "").trim().toLowerCase();
    requirement = await stillLive(store, existing.id, actor, CHAT_HOW[how] && how !== "press" ? (how as ConfirmedHow) : null, now);
  }
  const d = describe(requirement, now);
  return {
    success: true, action: "updated", entity: "requirement", category: "Leasing", ...d, url: pageUrl(requirement.company_id), changed, confirmedStillLive: confirming, needsConfirmation,
    withheldFromClientVisibleRow: withheld,
    message: `Updated the requirement for ${requirement.name}${changed.length ? `: ${changed.join(", ")}` : ""}. `
      + (confirming ? `It is confirmed as still live today by ${actor.name}${d.pressReported ? " (still press-reported: nobody has recorded speaking to the brand)" : ""}. `
        : d.state === "Closed" ? "It is now closed. " : `It reads ${d.state}, ${d.howKnown}; an edit is not a confirmation. `)
      + (statusNote ? `The Requirements page has no On hold status, so it is saved as Archived${withheld ? "" : " with an On hold note"}. ` : "")
      + withheldLine
      + (needsConfirmation.length ? `${replaceLine} I left ${needsConfirmation.length === 1 ? "that" : "those"} as saved. Say if ${needsConfirmation.length === 1 ? "it" : "they"} should be replaced. (id ${requirement.id})` : ""),
    ...(needsConfirmation.length ? { next: "Only if the user agrees, call update_requirement again with replaceSaved: true." } : {}),
  };
}

/** The create and update tools, as both ChatBGP executors call them: a named BGP person, one transaction, one audit row. */
export async function runChatRequirementTool(tool: "create_requirement" | "update_requirement", args: any, req: any): Promise<{ data: ChatRequirementResult; action?: any }> {
  // A server-originated ChatBGP run (the Friday report, the activity curator,
  // a property sweep: askChatBgp sends X-BGP-Internal) has no person asking.
  // Only a person makes a requirement live, so both tools are refused there.
  if ((await import("./chatbgp-internal")).isInternalStaffRequest(req)) {
    return { data: fail("Requirements are logged and confirmed only when a BGP person asks in their own chat, never from an automated run. Nothing was saved.") };
  }
  let actor: Actor;
  try {
    actor = await (await import("./requirement-intake-routes")).staffActor(req);
  } catch (e) {
    return { data: fail(e instanceof IntakeError
      ? "Requirements are logged and changed by BGP staff signed in as themselves, not from a client account or while viewing the app as a client. Nothing was saved."
      : "Your account could not be verified. Nothing was saved.") };
  }
  const { pool } = await import("./db");
  const client = await pool.connect();
  let data: ChatRequirementResult;
  try {
    await client.query("BEGIN");
    const store = pgIntakeStore(client);
    data = tool === "create_requirement" ? await logRequirementFromChat(store, args, actor) : await updateRequirementFromChat(store, args, actor);
    await client.query(data.success ? "COMMIT" : "ROLLBACK");
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    if (e instanceof IntakeError) data = fail(`${e.message} Nothing was saved.`, e.code === "EXISTING_REQUIREMENT" ? { needsChoice: true, existing: e.extra?.existing || [] } : {});
    else {
      console.error("[chatbgp-requirements]", e?.message || e);
      data = fail("The requirement could not be saved. Nothing was saved.");
    }
  } finally {
    client.release();
  }
  const wrote = data.success && (data.action === "created" || data.action === "updated");
  try {
    const { logAudit } = await import("./sql-tools");
    await logAudit({
      tableName: data.action === "suggested" ? "requirement_evidence" : "crm_requirements_leasing",
      op: tool === "create_requirement" && data.action !== "updated" ? "INSERT" : "UPDATE", data: args,
      where: { id: data.id || data.suggestionId || args?.id || null, companyId: data.companyId || null, outcome: data.action || null },
      affectedRows: wrote || data.action === "suggested" ? 1 : 0, userId: actor.id, threadId: req?.body?.threadId, success: data.success, error: data.error,
    });
  } catch {}
  return wrote ? { data, action: { type: data.action === "created" ? "crm_created" : "crm_updated", entityType: "requirement", id: data.id, name: data.name } } : { data };
}

// ── Reading ────────────────────────────────────────────────────────────────

const LIVE_COLUMNS = `r.status, r.origin, r.sources, r.last_confirmed_at, r.last_confirmed_by, r.last_confirmed_by_name, r.confirmed_how, r.last_listed_at, r.last_listed_source, r.requirement_date, r.created_at, r.updated_at`;
const STATE_RANK = (state: string) => `(CASE ${state} WHEN 'live' THEN 0 WHEN 'to_confirm' THEN 1 WHEN 'background' THEN 2 ELSE 3 END)`;

export const REQUIREMENT_SEARCH_NOTE = "Requirements: only state 'Live' is a live requirement (a named BGP person confirmed it within 90 days). 'To confirm' has not been confirmed recently, 'Background' is old or a PIPnet / Requirement List market listing nobody at BGP has confirmed, 'Closed' is past or archived. Say the state and howKnown for each one you quote; never call a row live or confirmed unless its state is Live.";

/** ChatBGP's requirement search (staff only): the Requirements page's rows, Live first, each with how it is known. */
export async function searchRequirementsForChat(db: Queryable, rawQuery: string, limit = 100, now: Date = new Date()) {
  const q = String(rawQuery || "").trim();
  if (q.length < 2) return [];
  const patterns = [...new Set([q, ...q.split(/\s+/).filter(w => w.length >= 2)])].map(p => `%${p.replace(/[\\%_]/g, m => `\\${m}`)}%`);
  const { rows } = await db.query(
    `SELECT x.* FROM (
       SELECT r.id, r.name, r.company_id, c.name AS company_name, r.use, r.size, r.requirement_locations, r.under_offer, r.deal_id, ${LIVE_COLUMNS},
              ${requirementStateSql("r")} AS state
         FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON c.id = r.company_id
        WHERE concat_ws(' ', r.name, c.name, array_to_string(r.requirement_locations, ' '), array_to_string(r.use, ' '), r.comments) ILIKE ANY($1::text[])
     ) x
     ORDER BY ${STATE_RANK("x.state")}, coalesce(x.last_confirmed_at, x.last_listed_at, x.updated_at, x.created_at) DESC NULLS LAST
     LIMIT $2`, [patterns, Math.min(Math.max(Number(limit) || 100, 1), 100)]);
  return rows.map((r: any) => {
    const live = requirementLive(r, now);
    return {
      id: r.id, category: "Leasing", brand: r.company_name || r.name, companyId: r.company_id, name: r.name,
      use: r.use || [], size: r.size || [], locations: r.requirement_locations || [], status: r.status, underOffer: !!r.under_offer, dealLinked: !!r.deal_id,
      state: live.stateLabel, howKnown: live.dateLabel, why: live.why,
      lastConfirmed: live.confirmed && live.date ? live.date.toISOString().slice(0, 10) : null,
      marketListing: live.importOnly, pressReported: live.pressReported,
    };
  });
}

/** The "open requirements" block of ChatBGP's CRM context: Live and To confirm only, Live first. */
export const OPEN_REQUIREMENTS_CONTEXT_SQL = `SELECT r.name, r.use, r.size, r.requirement_locations, r.under_offer, c.name as company_name, ${LIVE_COLUMNS}
  FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON r.company_id = c.id
 WHERE r.deal_id IS NULL AND ${requirementStateSql("r")} IN ('live', 'to_confirm')
 ORDER BY ${STATE_RANK(requirementStateSql("r"))}, coalesce(r.last_confirmed_at, r.updated_at, r.created_at) DESC NULLS LAST LIMIT 25`;

/** Requirements whose locations name a property, for a property chat thread. Never closed ones; a client login gets only rows it can already see. */
export const propertyRequirementsContextSql = (forClient: boolean) => `SELECT r.name, r.use, r.size, c.name as company_name, ${LIVE_COLUMNS}
  FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON r.company_id = c.id
 WHERE r.requirement_locations IS NOT NULL AND EXISTS (SELECT 1 FROM crm_properties p WHERE p.id = $1 AND (r.requirement_locations && ARRAY[p.name]))
   AND ${requirementStateSql("r")} <> 'closed'${forClient ? ` AND 'PIPnet' = ANY(r.sources)` : ""}
 ORDER BY ${STATE_RANK(requirementStateSql("r"))} LIMIT 5`;

/** " [Live: confirmed 12 Nov by Emily]" for a context line. Staff only. */
export function requirementContextTag(row: Record<string, any>, now: Date = new Date()): string {
  const live = requirementLive(row, now);
  return ` [${live.stateLabel}: ${live.dateLabel}]`;
}

// ── The old `requirements` table (admin Preview then Apply) ────────────────

const legacyKey = (id: string) => `legacy-requirement:${id}`;

function legacyPlan(row: any, passed: Set<string>): { plan: "suggestion" | "skip"; reason: string } {
  if (passed.has(legacyKey(row.id))) return { plan: "skip", reason: "Already passed through the intake" };
  if (String(row.category || "").trim().toLowerCase() !== "leasing") return { plan: "skip", reason: "Investment requirements are out of scope for the requirements centre" };
  const status = String(row.status || "").trim().toLowerCase();
  if (status === "fulfilled" || status === "withdrawn") return { plan: "skip", reason: `Marked ${status} in the old table` };
  if (!brandKey(row.company_name)) return { plan: "skip", reason: "No company name" };
  return { plan: "suggestion", reason: status === "on_hold" ? "Marked on hold in the old table" : "" };
}

async function legacyRows(db: Queryable) {
  const { rows } = await db.query(`SELECT id, category, company_name, contact_name, size_min, size_max, budget, location, status, notes, priority FROM requirements ORDER BY company_name, id LIMIT 2000`);
  const passed = new Set<string>((rows.length ? (await db.query(`SELECT dedupe_key FROM requirement_evidence WHERE dedupe_key = ANY($1::text[])`, [rows.map((r: any) => legacyKey(r.id))])).rows : []).map((r: any) => r.dedupe_key));
  return rows.map((r: any) => ({ row: r, ...legacyPlan(r, passed) }));
}

/** Read-only: every row of the old chat-only table, what Apply would do with it, and which brand it would land on. */
export async function legacyRequirementsPreview(db: Queryable, now: Date = new Date()) {
  const store = pgIntakeStore(db);
  const out = [];
  for (const { row, plan, reason } of await legacyRows(db)) {
    let brand: Record<string, any> | null = null;
    if (plan === "suggestion") {
      const match = await matchBrand(store, { name: row.company_name });
      const existing = match.companyId ? (await store.requirementsForCompanies([match.companyId])).filter(r => requirementLive(r, now).state !== "closed") : [];
      brand = { matched: !!match.companyId, companyId: match.companyId, candidates: match.candidates.map(c => ({ id: c.id, name: c.name })), existingRequirements: existing.map(r => oneLine(r, now)) };
    }
    out.push({
      id: row.id, category: row.category, companyName: row.company_name, contactName: row.contact_name, size: sizeText(row.size_min, row.size_max),
      location: row.location, budget: row.budget, status: row.status, priority: row.priority, notes: row.notes, plan, reason, brand,
    });
  }
  return {
    generatedAt: now.toISOString(),
    note: "Rows ChatBGP saved to the old requirements table, which no page reads. The old table keeps no dates. Apply passes the chosen rows through the intake as suggestions for a person to confirm, attach or dismiss in To confirm; nothing goes live, and the old rows are left where they are.",
    total: out.length,
    wouldSuggest: out.filter(r => r.plan === "suggestion").length,
    wouldSkip: out.filter(r => r.plan === "skip").length,
    rows: out,
  };
}

/** Passes the chosen old rows through the intake as suggestions. Each row is its own transaction; a row is never passed twice. */
export async function legacyRequirementsApply(pool: { connect(): Promise<any> } & Queryable, ids: string[], appliedBy: Actor, now: Date = new Date()) {
  const wanted = new Set((ids || []).map(x => String(x || "").trim()).filter(Boolean));
  const outcomes: Array<Record<string, any>> = [];
  for (const { row, plan, reason } of await legacyRows(pool)) {
    if (!wanted.has(row.id)) continue;
    wanted.delete(row.id);
    if (plan === "skip") { outcomes.push({ id: row.id, companyName: row.company_name, outcome: "skipped", reason }); continue; }
    const size = sizeText(row.size_min, row.size_max);
    const locations = splitPlaces(row.location);
    const facts = [size, locations.join(", "), row.budget ? `budget ${row.budget}` : ""].filter(Boolean).join("; ");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await suggest(pgIntakeStore(client), {
        kind: "chat", brand: { name: row.company_name }, sourceLabel: "ChatBGP (old log)", sourceRef: row.id,
        headline: `Logged through ChatBGP before the requirements centre, no date kept${facts ? `: ${facts}` : ""}${reason ? ` (${reason.toLowerCase()})` : ""}`,
        excerpt: row.notes, saidBy: row.contact_name,
        details: { size: size ? [size] : [], locations, budget: row.budget, priority: row.priority, contact: row.contact_name, oldStatus: row.status, backfilledBy: appliedBy.name },
        dedupeKey: legacyKey(row.id), detectedBy: "Old ChatBGP log",
      }, { now });
      await client.query("COMMIT");
      outcomes.push({ id: row.id, companyName: row.company_name, outcome: res.outcome, suggestionId: res.suggestionId, brandMatched: !!res.evidence.company_id });
    } catch (e: any) {
      try { await client.query("ROLLBACK"); } catch {}
      outcomes.push({ id: row.id, companyName: row.company_name, outcome: "failed", reason: e?.message || "failed" });
    } finally {
      client.release();
    }
  }
  for (const id of wanted) outcomes.push({ id, outcome: "skipped", reason: "Not in the old table" });
  const count = (o: string) => outcomes.filter(x => x.outcome === o).length;
  return { appliedBy: appliedBy.name, appliedAt: now.toISOString(), suggestionsOpened: count("opened"), joinedExistingSuggestion: count("joined"), skipped: count("skipped") + count("duplicate"), failed: count("failed"), outcomes };
}
