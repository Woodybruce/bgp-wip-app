import type { Express, Request } from "express";
import type { PoolClient } from "pg";
import { createHash } from "crypto";
import { z } from "zod";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { resolveCompanyScope, isPropertyInScope, isClientVisibleBrand, clientBrandSliceSql, getClientVisibleUserIds } from "./company-scope";
import { calendarDateValue } from "../shared/calendar-date";
import { VIEWING_STATUSES, VIEWING_OUTCOMES, viewingGapsForJointAgent, viewingMissingDetails, viewingTypedContact, type ViewingRecord } from "../shared/viewing-workflow";
import { buildViewingReport } from "../shared/viewing-report";
import { reconcileViewingFollowup } from "./viewing-followups";
import { roundChanges, type OfferStatus } from "../shared/unit-negotiation";
import { insertFirstRound, lockOffer, readOfferStatus, syncFirstRoundDate, syncNewestRoundToOffer, termsOfRow } from "./unit-negotiation";
import { isLandsecCompany, landsecCompanyId, resolveLandsecPortfolio } from "./landsec-schemes";

export class ViewingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const identifier = z.string().min(1).max(200);
const nullableId = identifier.nullable();
const day = z.string().refine(v => calendarDateValue(v) === v, "Use a valid calendar date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time");
const patchSchema = z.object({
  unitId: nullableId.optional(), companyId: nullableId.optional(), contactId: nullableId.optional(),
  agentContactId: nullableId.optional(), ownerUserId: nullableId.optional(), requirementId: nullableId.optional(),
  viewingDate: day.optional(), viewingTime: time.nullable().optional(), status: z.enum(VIEWING_STATUSES).optional(),
  outcome: z.string().max(200).nullable().optional(), notes: z.string().max(20000).nullable().optional(),
  attendees: z.string().max(10000).nullable().optional(),
  nextAction: z.string().max(2000).nullable().optional(), followUpDate: day.nullable().optional(),
  confirmDetails: z.boolean().optional(), expectedUpdatedAt: z.string().datetime().optional(),
  // Typed names. Read from a joint agent login only, which has no CRM
  // pickers; any other login sending one is refused, as it always was.
  companyName: z.string().max(200).nullable().optional(), contactName: z.string().max(200).nullable().optional(),
  agentContactName: z.string().max(200).nullable().optional(),
}).strict();
const toCamel = (row: any): any => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v instanceof Date ? v.toISOString() : v]));
const callerId = (req: Request): string => (req as any).session?.userId || (req as any).tokenUserId;
const todayLondon = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// $1 is the client company (null for BGP staff); $2 the properties of the
// schemes on a restricted Landsec login (null for everyone else). A booking
// with no unit has no property, so it passes for BGP staff only.
const scopeSql = `(($1::text IS NULL OR p.landlord_id = $1 OR EXISTS (SELECT 1 FROM crm_company_properties cp WHERE cp.property_id=p.id AND cp.company_id=$1))
  AND ($2::varchar[] IS NULL OR au.property_id = ANY($2::varchar[])))`;

// Who is asking. A Landsec asset manager or joint agent login is scoped to
// the whole Landsec company, so the company alone is never enough: their
// scheme set (propertyIds) is applied to every list, single row and write.
export interface ViewingScope { companyId: string | null; propertyIds: Set<string> | null; jointAgent: boolean }
type ScopeInput = ViewingScope | string | null;
const scopeOf = (scope: ScopeInput): ViewingScope => scope && typeof scope === "object" ? scope : { companyId: scope || null, propertyIds: null, jointAgent: false };
const scopeParams = (scope: ViewingScope) => [scope.companyId, scope.propertyIds ? [...scope.propertyIds] : null];
export async function viewingScope(req: Request): Promise<ViewingScope> {
  const companyId = await resolveCompanyScope(req);
  if (!companyId) return { companyId: null, propertyIds: null, jointAgent: false };
  const { briefSchemePropertyIds } = await import("./unit-brief-workspace");
  const propertyIds = await briefSchemePropertyIds(req);
  if (!propertyIds) return { companyId, propertyIds: null, jointAgent: false };
  const { landsecViewer } = await import("./landsec-access");
  return { companyId, propertyIds, jointAgent: (await landsecViewer(req))?.role === "joint_agent" };
}
// For the tracker's own viewing routes in server/routes.ts.
export async function viewingCallerIsJointAgent(req: Request): Promise<boolean> {
  return (await viewingScope(req)).jointAgent;
}

const selectViewings = `SELECT v.*, au.property_id, p.name AS property_name, au.unit_name, au.sqft,
  COALESCE(au.unit_id, au.tenancy_unit_id, au.id) AS physical_unit_id,
  co.name AS brand_name, ct.name AS brand_contact_name, ac.name AS agent_contact_name,
  u.name AS owner_name, u.team, r.name AS requirement_name
  FROM unit_viewings v LEFT JOIN available_units au ON au.id=v.unit_id
  LEFT JOIN crm_properties p ON p.id=au.property_id
  LEFT JOIN crm_companies co ON co.id=v.company_id
  LEFT JOIN crm_contacts ct ON ct.id=v.contact_id LEFT JOIN crm_contacts ac ON ac.id=v.agent_contact_id
  LEFT JOIN users u ON u.id=v.owner_user_id LEFT JOIN crm_requirements_leasing r ON r.id=v.requirement_id`;

// What a client login receives of a viewing. For a joint agent (jointAgent)
// the names stay, because they have to meet the person, and everything that
// points into BGP's CRM or diary goes: the contact, agent and requirement
// ids, the requirement's name, the diary event id and the BGP team.
export function serializeViewingForScope<T extends Record<string, any>>(record: T, scoped: boolean, jointAgent = false): T {
  if (!scoped) return record;
  const result: Record<string, any> = { ...record };
  const details = record.sourceDetails || record.source_details;
  // A contact a joint agent typed (the marker is the server's own).
  if (details && details.typedContact === true) result.typedContact = true;
  // The guest list of an Outlook invitation ("Name <email>") is BGP's diary,
  // like its subject and place.
  if (record.source === "diary" && "attendees" in result) result.attendees = null;
  // The units of one visit share a booking id, and for a visit captured from
  // the diary that id is the Outlook invitation's. A client login is sent a
  // stand-in worked out from it, the same for every unit of the visit, so
  // they still group; an id this app made itself ("manual:…") goes as it is.
  for (const key of ["bookingId", "booking_id"]) {
    const booking = result[key];
    if (typeof booking === "string" && booking && !booking.startsWith("manual:")) result[key] = `visit:${createHash("sha256").update(booking).digest("hex").slice(0, 16)}`;
  }
  if (jointAgent) {
    // No CRM contact id reaches a joint agent, so a contact behind the
    // viewing is reported as a named one.
    if (record.contactId || record.contact_id || record.agentContactId || record.agent_contact_id) result.typedContact = true;
    for (const key of ["contactId", "contact_id", "agentContactId", "agent_contact_id", "requirementId", "requirement_id",
      "requirementName", "requirement_name", "calendarEventId", "calendar_event_id", "team"]) if (key in result) result[key] = null;
  }
  if (record.source === "diary" && typeof record.notes === "string") {
    const subject = (record.sourceDetails || record.source_details)?.subject;
    const exactPrefix = typeof subject === "string" ? `Synced from Outlook: "${subject}"` : null;
    // Prefer the captured subject so quotes/newlines in the invitation
    // cannot confuse where provenance ends and an agent's own note starts.
    // Older records may lack the captured subject: their generated note
    // was a quoted first line, followed by any subsequently added notes.
    const prefix = exactPrefix && record.notes.startsWith(exactPrefix)
      ? exactPrefix : /^Synced from Outlook: "[^\r\n]*"/.exec(record.notes)?.[0];
    if (prefix) result.notes = `Captured from Outlook.${record.notes.slice(prefix.length)}`;
  }
  delete result.sourceDetails;
  delete result.source_details;
  return result as T;
}

export function projectViewing(row: any, scoped = false, jointAgent = false): ViewingRecord {
  const v = toCamel(row);
  v.companyName = v.brandName || v.companyName;
  v.contactName = v.brandContactName || v.contactName;
  // Names a joint agent typed: the contact's is in contact_name, the
  // representing agent's beside the marker in source_details.
  v.typedContact = viewingTypedContact(v);
  if (v.typedContact && !v.agentContactId && !v.agentContactName) v.agentContactName = String(v.sourceDetails.typedAgentName || "").trim() || null;
  v.issues = viewingMissingDetails(v);
  if (!v.detailsConfirmedAt) {
    // What the diary match was unsure of is about the invitation, which a
    // joint agent is never shown.
    const sourceIssues = !jointAgent && Array.isArray(v.sourceDetails?.issues) ? v.sourceDetails.issues.filter((s: unknown) => typeof s === "string") : [];
    v.issues = [...new Set([...v.issues, ...sourceIssues, "Confirm the viewing details"] )];
  }
  delete v.brandName; delete v.brandContactName;
  return serializeViewingForScope(v, scoped, jointAgent);
}

export async function listLeasingViewings(scopeIn: ScopeInput): Promise<ViewingRecord[]> {
  const scope = scopeOf(scopeIn);
  const { rows } = await pool.query(`${selectViewings} WHERE v.deleted_at IS NULL AND ${scopeSql} ORDER BY v.viewing_date DESC, v.viewing_time, v.id`, scopeParams(scope));
  return rows.map(row => projectViewing(row, !!scope.companyId, scope.jointAgent));
}

async function getLockedViewing(db: PoolClient, id: string, scope: ScopeInput) {
  const row = (await db.query(`SELECT * FROM unit_viewings WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
  if (!row) throw new ViewingError(404, "Viewing not found");
  await assertViewingUnit(db, row.unit_id, scope);
  return row;
}

// Joint agent logins, each with the properties of the schemes they cover.
export async function jointAgentPeople(): Promise<{ id: string; name: string; team: null; firm: string | null; jointAgent: true; propertyIds: string[] }[]> {
  const rows = (await pool.query(`SELECT u.id,u.name,a.firm,a.schemes FROM users u JOIN landsec_access a ON a.user_id=u.id
    WHERE a.landsec_role='joint_agent' AND u.is_active IS NOT FALSE ORDER BY u.name`)).rows;
  if (!rows.length) return [];
  const companyId = await landsecCompanyId();
  if (!companyId) return [];
  const portfolio = await resolveLandsecPortfolio(companyId);
  return rows.map(row => ({
    id: row.id, name: row.name, team: null, firm: row.firm || null, jointAgent: true as const,
    propertyIds: portfolio.schemes.filter(s => (row.schemes || []).includes(s.key)).flatMap(s => s.properties.map(p => p.id)),
  }));
}

async function assertViewingUnit(db: PoolClient, unitId: string | null, scopeIn: ScopeInput) {
  const scope = scopeOf(scopeIn);
  if (!unitId) {
    if (scope.companyId) throw new ViewingError(403, "Unmatched diary bookings are only visible to BGP staff");
    return null;
  }
  const unit = (await db.query(`SELECT * FROM available_units WHERE id=$1`, [unitId])).rows[0];
  if (!unit) throw new ViewingError(404, "Tracker unit not found");
  if (scope.companyId && !(await isPropertyInScope(scope.companyId, unit.property_id))) throw new ViewingError(403, "Unit is outside your portfolio");
  // A Landsec asset manager or joint agent: the schemes on their login only.
  if (scope.propertyIds && !scope.propertyIds.has(unit.property_id)) throw new ViewingError(403, "Unit is outside your portfolio");
  return unit;
}

async function validateLinks(db: PoolClient, value: any, scopeIn: ScopeInput, existing?: any) {
  const viewer = scopeOf(scopeIn);
  const scope = viewer.companyId;
  await assertViewingUnit(db, value.unitId, viewer);
  let brand = null, contact = null;
  // Link validation runs on CHANGED links only: a legacy row whose stored
  // brand has since been retyped or merged must stay editable (notes, dates,
  // outcomes) without re-passing today's rules. The lookups still run so a
  // saved row carries the freshest linked names available.
  if (value.companyId) {
    brand = (await db.query(`SELECT id,name,company_type FROM crm_companies WHERE id=$1 AND merged_into_id IS NULL`, [value.companyId])).rows[0];
    const companyChanged = !existing || value.companyId !== existing.companyId;
    if (companyChanged && (!brand || !/^tenant(?:\s|-|$)/i.test(brand.company_type || ""))) throw new ViewingError(400, "Choose the brand being represented, rather than the agent's employer");
    if (scope && companyChanged && !(await isClientVisibleBrand(value.companyId, scope))) {
      // A joint agent may also pick a brand already named on this unit (its
      // interest, viewings, offers or targets): the id and name only.
      const { brandsOnUnit } = await import("./unit-negotiation");
      const onUnit = viewer.jointAgent && !!value.unitId && (await brandsOnUnit(value.unitId, db)).some(b => b.id === value.companyId);
      if (!onUnit) throw new ViewingError(403, viewer.jointAgent ? "Pick a brand from the list or one already named on this unit, or type the brand's name" : "Brand is outside your CRM");
    }
  }
  if (value.contactId) {
    contact = (await db.query(`SELECT id,name,company_id FROM crm_contacts WHERE id=$1`, [value.contactId])).rows[0];
    const contactChanged = !existing || value.contactId !== existing.contactId || value.companyId !== existing.companyId;
    if (contactChanged && (!contact || !value.companyId || contact.company_id !== value.companyId)) throw new ViewingError(400, "Choose a contact at this brand; use Representing agent for their agent");
  }
  if (value.agentContactId) {
    const agent = (await db.query(`SELECT id FROM crm_contacts WHERE id=$1`, [value.agentContactId])).rows[0];
    if ((!existing || value.agentContactId !== existing.agentContactId) && !agent) throw new ViewingError(400, "Agent contact not found");
    if (scope && (value.agentContactId !== existing?.agentContactId || value.companyId !== existing?.companyId)) {
      const eligible = await db.query(`SELECT 1 FROM brand_agent_representations ar WHERE ar.brand_company_id=$1 AND ar.primary_contact_id=$2
        AND ar.agent_type='tenant_rep' AND (ar.start_date IS NULL OR ar.start_date<=now()) AND ar.end_date IS NULL
        UNION ALL SELECT 1 FROM crm_requirements_leasing r WHERE r.company_id=$1 AND r.agent_contact_id=$2
        AND (r.status IS NULL OR btrim(r.status)='' OR lower(r.status)='active') LIMIT 1`, [value.companyId, value.agentContactId]);
      if (!eligible.rows.length) throw new ViewingError(403, "Choose an agent linked to this brand in your CRM");
    }
  }
  // The viewing's agent is a BGP agent or a joint agent. A joint agent only
  // takes viewings on the schemes they are instructed on, so theirs is
  // checked again when the unit changes.
  const ownerChanged = value.ownerUserId !== existing?.ownerUserId;
  if (value.ownerUserId && (ownerChanged || value.unitId !== existing?.unitId)) {
    const bgp = await db.query(`SELECT id FROM users WHERE id=$1 AND is_active IS NOT FALSE AND email ILIKE '%@brucegillinghampollard.com'`, [value.ownerUserId]);
    if (bgp.rows.length) {
      if (ownerChanged && scope && !(await getClientVisibleUserIds(scope)).has(value.ownerUserId)) throw new ViewingError(403, "Choose a member of your BGP team");
    } else {
      const jointAgent = (await jointAgentPeople()).find(person => person.id === value.ownerUserId);
      if (!jointAgent) {
        if (ownerChanged) throw new ViewingError(400, "Choose an active BGP agent or joint agent");
      } else {
        const unit = value.unitId ? (await db.query(`SELECT property_id FROM available_units WHERE id=$1`, [value.unitId])).rows[0] : null;
        if (!unit || !jointAgent.propertyIds.includes(unit.property_id)) throw new ViewingError(400, `${jointAgent.name} is not a joint agent on this unit's scheme`);
      }
    }
  }
  if (value.requirementId) {
    const req = (await db.query(`SELECT company_id FROM crm_requirements_leasing WHERE id=$1`, [value.requirementId])).rows[0];
    if (!req || !value.companyId || req.company_id !== value.companyId) throw new ViewingError(400, "The requirement must belong to the viewing brand");
  }
  return { brand, contact };
}

async function transaction<T>(fn: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try { await db.query("BEGIN"); const value = await fn(db); await db.query("COMMIT"); return value; }
  catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

const TYPED_NAME_KEYS = ["companyName", "contactName", "agentContactName"] as const;
const blankValue = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());
const sameWords = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const trimmedName = (v: unknown) => String(v ?? "").trim().slice(0, 200) || null;

// What a joint agent may put on a viewing (Woody, 2026-11-12: full control
// on their instructed schemes, no access to the brand pages). The brand is
// picked from the names-only list, or is one already named on the unit, or
// is typed; the brand's contact and its agent are typed names. No contact
// or requirement from BGP's CRM is linked from their login, and they are
// never sent those ids, so a link already on the viewing stays unless they
// change the brand or retype the name. `old` is the stored row (null for a
// new viewing). Mutates `fields` into what the write should use and returns
// the names and the marker to store.
async function jointAgentViewingFields(db: PoolClient, fields: Record<string, any>, old: any | null) {
  for (const key of ["contactId", "agentContactId", "requirementId"]) {
    if (!blankValue(fields[key])) throw new ViewingError(403, "Type the person's name. A joint agent login does not link records from BGP's CRM.");
    delete fields[key];
  }
  const crmName = async (table: "crm_companies" | "crm_contacts", id: string | null) =>
    id ? ((await db.query(`SELECT name FROM ${table} WHERE id=$1`, [id])).rows[0]?.name as string | undefined) || null : null;
  const out: { companyName?: string | null; contactName?: string | null; typedAgentName?: string | null; typedContact: boolean; changed: boolean } = { typedContact: false, changed: false };
  // The brand: an id from the picker, or a typed name, which unlinks.
  let brandChanged = false;
  if (!blankValue(fields.companyId)) {
    brandChanged = fields.companyId !== (old?.company_id || null);
  } else if ("companyId" in fields || "companyName" in fields) {
    const typed = trimmedName(fields.companyName);
    const keepLink = !!old?.company_id && !("companyId" in fields && !typed)
      && (!("companyName" in fields) || sameWords(typed, old.company_name) || sameWords(typed, await crmName("crm_companies", old.company_id)));
    if (keepLink) delete fields.companyId;
    else {
      fields.companyId = null;
      out.companyName = "companyName" in fields ? typed : old?.company_id ? null : old?.company_name ?? null;
      brandChanged = !!old?.company_id || !sameWords(out.companyName, old?.company_name);
    }
  }
  // The stored links belong to the brand they were made for.
  if (brandChanged && old) {
    if (old.requirement_id) fields.requirementId = null;
    if (old.contact_id) { fields.contactId = null; out.contactName = null; }
    if (old.agent_contact_id) { fields.agentContactId = null; out.typedAgentName = null; }
  }
  if ("contactName" in fields) {
    const typed = trimmedName(fields.contactName);
    // A blank never unlinks BGP's contact: only a different typed name does.
    const keepLink = !!old?.contact_id && !brandChanged
      && (!typed || sameWords(typed, old.contact_name) || sameWords(typed, await crmName("crm_contacts", old.contact_id)));
    if (!keepLink) {
      if (old?.contact_id) fields.contactId = null;
      out.contactName = typed;
      if (!sameWords(typed, old?.contact_name) || old?.contact_id) out.changed = true;
      if (typed) out.typedContact = true;
    }
  }
  if ("agentContactName" in fields) {
    const typed = trimmedName(fields.agentContactName);
    const keepLink = !!old?.agent_contact_id && !brandChanged && (!typed || sameWords(typed, await crmName("crm_contacts", old.agent_contact_id)));
    if (!keepLink) {
      if (old?.agent_contact_id) fields.agentContactId = null;
      out.typedAgentName = typed;
      if (!sameWords(typed, old?.source_details?.typedAgentName) || old?.agent_contact_id) out.changed = true;
      if (typed) out.typedContact = true;
    }
  }
  if (brandChanged) out.changed = true;
  for (const key of TYPED_NAME_KEYS) delete fields[key];
  return out;
}

// A client login is sent a diary-captured viewing's note with BGP's first
// line ('Synced from Outlook: "<the invitation's subject>"') reworded to
// "Captured from Outlook." (serializeViewingForScope), and its form sends
// the note back on every save. This is the note to store: the stored first
// line, found the same two ways, in front of whatever they sent, so that
// line is never overwritten or lost.
function diaryNoteToStore(sent: unknown, stored: unknown, details: any): unknown {
  if (typeof stored !== "string") return sent;
  const exact = typeof details?.subject === "string" ? `Synced from Outlook: "${details.subject}"` : null;
  const provenance = exact && stored.startsWith(exact) ? exact : /^Synced from Outlook: "[^\r\n]*"/.exec(stored)?.[0];
  if (!provenance) return sent;
  const reworded = "Captured from Outlook.";
  const note = typeof sent === "string" ? sent : "";
  return provenance + (note.startsWith(reworded) ? note.slice(reworded.length) : note.trim() ? `\n${note}` : "");
}

export async function patchLeasingViewing(req: Request, id: string, body: unknown) {
  const input = patchSchema.safeParse(body);
  if (!input.success) throw new ViewingError(400, input.error.issues.map(i => i.message).join("; "));
  const scope = await viewingScope(req);
  const patch: Record<string, any> = { ...input.data };
  if (!scope.jointAgent && TYPED_NAME_KEYS.some(key => key in patch)) throw new ViewingError(400, "Pick the brand and the contact from the lists");
  const saved = await transaction(async db => {
    const old = await getLockedViewing(db, id, scope);
    if (patch.expectedUpdatedAt && new Date(old.updated_at).getTime() !== new Date(patch.expectedUpdatedAt).getTime()) {
      throw new ViewingError(409, "This viewing changed. Refresh it before saving your changes.");
    }
    // A client login is never sent the guest list of an Outlook invitation,
    // so whatever its form sends back for it is dropped and the stored list
    // stays.
    if (scope.companyId && old.source === "diary") delete patch.attendees;
    // Nor are they sent the first line of its note as BGP stored it.
    if (scope.companyId && old.source === "diary" && "notes" in patch) patch.notes = diaryNoteToStore(patch.notes, old.notes, old.source_details);
    const typed = scope.jointAgent ? await jointAgentViewingFields(db, patch, old) : null;
    const value = { ...toCamel(old), ...patch };
    const terminal = ["cancelled", "no_show", "not_leasing"].includes(value.status);
    const linksChanged = ["unitId", "companyId", "contactId", "agentContactId", "ownerUserId", "requirementId"].some(k => k in patch && (patch as any)[k] !== toCamel(old)[k]);
    // An old employer/brand mistake must not stop someone excluding a cancelled or technical visit.
    const { brand, contact } = terminal && !linksChanged
      ? { brand: { name: old.company_name }, contact: { name: old.contact_name } }
      : await validateLinks(db, value, scope, toCamel(old));
    if (patch.outcome && patch.outcome !== old.outcome && !(VIEWING_OUTCOMES as readonly string[]).includes(patch.outcome)) throw new ViewingError(400, "Choose a valid viewing outcome");
    if ((value.unitId !== old.unit_id || value.companyId !== old.company_id)
      && (await db.query(`SELECT 1 FROM unit_offers WHERE viewing_id=$1 LIMIT 1`, [id])).rows.length) {
      throw new ViewingError(409, "This viewing has a linked offer. Keep its brand and unit, or record a separate viewing.");
    }
    // Free-text names (no CRM link) survive unrelated edits: a name is only
    // cleared when this patch explicitly UNLINKS a previously linked record.
    // (The workbench dialog sends every key on every save, so key presence
    // alone cannot mean "clear".) A joint agent's typed names stand as sent.
    const companyUnlinked = "companyId" in patch && !patch.companyId && !!old.company_id;
    const contactUnlinked = "contactId" in patch && !patch.contactId && !!old.contact_id;
    const companyName = typed && typed.companyName !== undefined ? typed.companyName : brand?.name || (companyUnlinked ? null : old.company_name);
    const contactName = typed && typed.contactName !== undefined ? typed.contactName : contact?.name || (contactUnlinked ? null : old.contact_name);
    // The marker that lets a typed contact fill the contact gap is written
    // only here and in createTrackerViewing, from a joint agent's save.
    const marker: Record<string, unknown> = {};
    if (typed && typed.typedAgentName !== undefined) marker.typedAgentName = typed.typedAgentName;
    if (typed?.typedContact) marker.typedContact = true;
    value.typedContact = viewingTypedContact({ sourceDetails: { ...(old.source_details || {}), ...marker }, contactName });
    // A joint agent may confirm a viewing whose brand they had to type: the
    // link to BGP's list is BGP's to make. Everyone else's save needs it.
    const gaps = scope.jointAgent ? viewingGapsForJointAgent({ ...value, companyName }) : viewingMissingDetails(value);
    if (patch.confirmDetails && !terminal && gaps.length) throw new ViewingError(400, gaps.join("; "));
    if (value.status === "completed") {
      if (!value.outcome?.trim()) throw new ViewingError(400, "Choose the viewing outcome");
      if (!calendarDateValue(value.viewingDate) || value.viewingDate > todayLondon()) throw new ViewingError(400, "A future viewing cannot be reported as completed");
    }
    const identityChanged = !!typed?.changed || ["unitId", "companyId", "contactId", "agentContactId", "ownerUserId", "viewingDate", "viewingTime"].some(k => k in patch && (patch as any)[k] !== toCamel(old)[k]);
    const confirmed = terminal ? old.details_confirmed_at : patch.confirmDetails ? new Date() : identityChanged ? null : old.details_confirmed_at;
    const recorded = "status" in patch || "outcome" in patch;
    const result = await db.query(`UPDATE unit_viewings SET unit_id=$2, company_id=$3, company_name=$4,
      contact_id=$5, contact_name=$6, agent_contact_id=$7, owner_user_id=$8, requirement_id=$9,
      viewing_date=$10, viewing_time=$11, status=$12, outcome=$13, notes=$14, next_action=$15, follow_up_date=$16,
      details_confirmed_at=$17, outcome_recorded_at=$18, outcome_by_user_id=$19, attendees=$21, updated_at=clock_timestamp(),
      source_details=CASE WHEN $20 OR $22::jsonb IS NOT NULL
        THEN COALESCE(source_details,'{}'::jsonb) || (CASE WHEN $20 THEN '{"issues":[]}'::jsonb ELSE '{}'::jsonb END) || COALESCE($22::jsonb,'{}'::jsonb)
        ELSE source_details END
      WHERE id=$1 RETURNING *`, [id, value.unitId, value.companyId, companyName,
      value.contactId, contactName, value.agentContactId, value.ownerUserId, value.requirementId,
      value.viewingDate, value.viewingTime, value.status, value.outcome, value.notes, value.nextAction, value.followUpDate,
      confirmed, recorded ? new Date() : old.outcome_recorded_at, recorded ? callerId(req) : old.outcome_by_user_id, !!patch.confirmDetails,
      "attendees" in patch ? value.attendees : old.attendees, Object.keys(marker).length ? JSON.stringify(marker) : null]);
    return projectViewing(result.rows[0], !!scope.companyId, scope.jointAgent);
  });
  await reconcileViewingFollowup(id).catch(e => console.warn("[viewing-followup] reconcile deferred:", e.message));
  return saved;
}

// The legacy tracker dialog uses the same service, so reports never become a separate data island.
export async function createTrackerViewing(req: Request, unitId: string, input: any) {
  const scope = await viewingScope(req);
  const body: Record<string, any> = input && typeof input === "object" ? { ...input } : {};
  const date = day.safeParse(body.viewingDate);
  if (!date.success) throw new ViewingError(400, "Set a valid viewing date");
  if (body.viewingTime && !time.safeParse(body.viewingTime).success) throw new ViewingError(400, "Set a valid viewing time");
  const created = await transaction(async db => {
    await assertViewingUnit(db, unitId, scope);
    // A joint agent's typed names (the brand's contact and its agent) and
    // the marker that lets them stand for the contact on this viewing.
    const typed = scope.jointAgent ? await jointAgentViewingFields(db, body, null) : null;
    if (typed) { body.companyName = typed.companyName ?? null; body.contactName = typed.contactName ?? null; }
    const marker = typed?.typedContact ? { typedContact: true, ...(typed.typedAgentName ? { typedAgentName: typed.typedAgentName } : {}) } : null;
    // BGP staff and a joint agent are the agent on a viewing they add; a
    // client login's viewing waits for an agent to be assigned.
    const value: Record<string, any> = { unitId, companyId: body.companyId || null, contactId: body.contactId || null,
      agentContactId: body.agentContactId || null, ownerUserId: body.ownerUserId || (scope.companyId && !scope.jointAgent ? null : callerId(req)),
      requirementId: body.requirementId || null, viewingDate: date.data, viewingTime: body.viewingTime || null, typedContact: !!marker };
    const { brand, contact } = await validateLinks(db, value, scope);
    const outcome = String(body.outcome || "").trim();
    const status = body.status ?? (outcome === "No Show" ? "no_show" : outcome ? "completed" : "scheduled");
    if (!z.enum(VIEWING_STATUSES).safeParse(status).success) throw new ViewingError(400, "Choose a valid viewing status");
    if (outcome && outcome !== "No Show" && !(VIEWING_OUTCOMES as readonly string[]).includes(outcome)) throw new ViewingError(400, "Choose a valid outcome");
    if ((outcome || status === "completed" || status === "no_show") && date.data > todayLondon()) throw new ViewingError(400, "A future viewing cannot have an outcome");
    if (status === "completed" && !outcome) throw new ViewingError(400, "Choose the viewing outcome");
    if (body.followUpDate && !day.safeParse(body.followUpDate).success) throw new ViewingError(400, "Set a valid follow-up date");
    // A complete viewing is confirmed as it is added. For a joint agent a
    // brand they had to type does not hold that back (BGP matches it to its
    // list); for everyone else the brand must be linked, as before.
    const gaps = scope.jointAgent ? viewingGapsForJointAgent({ ...value, companyName: brand?.name || body.companyName }) : viewingMissingDetails(value);
    const result = await db.query(`INSERT INTO unit_viewings
      (unit_id,company_id,company_name,contact_id,contact_name,agent_contact_id,owner_user_id,requirement_id,
       viewing_date,viewing_time,attendees,notes,outcome,status,details_confirmed_at,outcome_recorded_at,outcome_by_user_id,next_action,follow_up_date,source_details)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb) RETURNING *`,
      [unitId,value.companyId,brand?.name || body.companyName || null,value.contactId,contact?.name || body.contactName || null,
      value.agentContactId,value.ownerUserId,value.requirementId,value.viewingDate,value.viewingTime,
      String(body.attendees || "").slice(0,10000) || null,String(body.notes || "").slice(0,20000) || null,
      outcome === "No Show" ? null : outcome || null,status,
      gaps.length ? null : new Date(),outcome ? new Date() : null,outcome ? callerId(req) : null,
      String(body.nextAction || "").slice(0,2000) || null,body.followUpDate || null,marker ? JSON.stringify(marker) : null]);
    // A joint agent gets the viewing as the calendar shows it: the typed
    // names, and no CRM id.
    return scope.jointAgent ? projectViewing(result.rows[0], true, true) : toCamel(result.rows[0]);
  });
  // The agent's follow-up task is made now, not at the next sweep.
  if (created?.id) await reconcileViewingFollowup(created.id).catch(e => console.warn("[viewing-followup] reconcile deferred:", e.message));
  return created;
}

export async function deleteTrackerViewing(req: Request, id: string) {
  const scope = await viewingScope(req);
  await transaction(async db => {
    await getLockedViewing(db, id, scope);
    await db.query(`UPDATE unit_viewings SET deleted_at=now(),updated_at=clock_timestamp() WHERE id=$1`, [id]);
  });
  await reconcileViewingFollowup(id).catch(e => console.warn("[viewing-followup] reconcile deferred:", e.message));
}

async function lockedViewingOfferFields(db: PoolClient, unitId: string, viewingId: string, scope: string | null) {
  const viewing = await getLockedViewing(db, viewingId, scope);
  if (viewing.unit_id !== unitId || !viewing.company_id) throw new ViewingError(400, "Choose the viewing's unit and confirm its brand first");
  if (!viewing.details_confirmed_at) throw new ViewingError(400, "Confirm the viewing details before linking an offer");
  const contactId = viewing.contact_id || viewing.agent_contact_id;
  const contactName = contactId ? (await db.query(`SELECT name FROM crm_contacts WHERE id=$1`, [contactId])).rows[0]?.name : null;
  return { viewingId: viewing.id, companyId: viewing.company_id, companyName: viewing.company_name,
    contactId, contactName: contactName || viewing.contact_name, confirmedAt: new Date() };
}

// Read-only preview. Writes use the helpers below so the viewing lock lasts
// until its offer has been inserted or updated in the same transaction.
export async function viewingOfferFields(req: Request, unitId: string, viewingId: string) {
  const scope = await resolveCompanyScope(req);
  return transaction(async db => {
    const access = await offerAccess(req, await assertViewingUnit(db, unitId, scope));
    const fields = await lockedViewingOfferFields(db, unitId, viewingId, scope);
    // A joint agent is given the names on a viewing, never a CRM contact id.
    return access.landsecRole === "joint_agent" ? { ...fields, contactId: null } : fields;
  });
}

// Who is logging this, for the negotiation log's "logged by".
async function callerStamp(db: PoolClient, req: Request): Promise<{ userId: string | null; name: string | null }> {
  const userId = callerId(req) || null;
  const user = userId ? (await db.query(`SELECT name, email FROM users WHERE id=$1`, [userId])).rows[0] : null;
  return { userId, name: user?.name || user?.email || null };
}

// Who is asking, checked against the unit's property and, for a Landsec
// asset manager or joint agent, its scheme. Company scope alone is not
// enough for them: it covers every Landsec scheme.
async function offerAccess(req: Request, unit: any) {
  const { briefAccess } = await import("./unit-brief-workspace");
  const access = await briefAccess(req, unit?.property_id);
  if (!access) throw new ViewingError(403, "Unit is outside your portfolio");
  return access;
}

// What a joint agent may put on an offer (Woody, 2026-11-12: full control on
// their instructed schemes, no access to the brand pages). The brand is a
// typed name, or a brand already named on the unit; the contact is a typed
// name; no other CRM record is linked from their login. On an offer their
// login did not log (`old` set, `own` false) the contact name and the
// comments are BGP's: they were never sent to the joint agent, so whatever
// the form sends back for them is dropped and the stored values stay.
const JOINT_AGENT_OFFER_FIELDS = ["companyName", "companyId", "contactName", "offerDate", "rentPa", "rentFreeMonths", "termYears",
  "breakOption", "incentives", "premium", "fittingOutContribution", "rentReview", "rentDeposit", "turnoverRentPct", "comments", "viewingId"];
async function jointAgentOfferBody(db: PoolClient, unitId: string, body: any, old: any | null, own: boolean): Promise<Record<string, unknown>> {
  const sent: Record<string, unknown> = body && typeof body === "object" ? body : {};
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());
  const words = (v: unknown) => String(v ?? "").trim().toLowerCase();
  if (!blank(sent.contactId)) throw new ViewingError(403, "Type the contact's name. A joint agent login does not link contacts from BGP's CRM.");
  const out: Record<string, unknown> = {};
  for (const key of JOINT_AGENT_OFFER_FIELDS) if (key in sent) out[key] = sent[key];
  if (!blank(out.companyId)) {
    const { brandsOnUnit } = await import("./unit-negotiation");
    const brand = (await brandsOnUnit(unitId, db)).find(b => b.id === out.companyId);
    if (!brand) throw new ViewingError(403, "Pick a brand already named on this unit, or type the brand's name.");
    out.companyName = brand.name;
  } else {
    // No brand picked. A new offer, or one whose brand name has been
    // retyped, carries the typed name only; otherwise the stored link stays
    // (its id is never sent to a joint agent, so the form cannot send it back).
    const renamed = !!old && "companyName" in out && words(out.companyName) !== words(old.company_name);
    if (!old || renamed) out.companyId = null;
    else {
      delete out.companyId;
      // The same name in other capitals or spacing is not a rename: a brand
      // linked to BGP's record keeps the name stored with it.
      if (old.company_id) delete out.companyName;
    }
  }
  if (old && !own) { delete out.contactName; delete out.comments; }
  return out;
}

export async function createTrackerOffer(req: Request, unitId: string, body: any) {
  const scope = await resolveCompanyScope(req);
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { unitOffers, insertUnitOfferSchema } = await import("@shared/schema");
  // Every offer starts at Pending. Its status changes only through its
  // negotiation (POST /api/unit-offers/:offerId/status), which holds the
  // one-agreed-offer-per-unit rule; a status in the body is ignored.
  const status = "Pending" as OfferStatus;
  return transaction(async db => {
    const access = await offerAccess(req, await assertViewingUnit(db, unitId, scope));
    const jointAgent = access.landsecRole === "joint_agent";
    const fields = jointAgent ? await jointAgentOfferBody(db, unitId, body, null, true) : body;
    const linked = fields.viewingId ? await lockedViewingOfferFields(db, unitId, fields.viewingId, scope) : {};
    const parsed = insertUnitOfferSchema.safeParse({ ...fields, status, unitId, ...linked, confirmedAt: new Date() });
    if (!parsed.success) throw new ViewingError(400, parsed.error.issues.map(issue => issue.message).join("; "));
    const by = await callerStamp(db, req);
    const { actorNameOf, offerForJointAgent } = await import("./unit-negotiation");
    if (jointAgent) by.name = await actorNameOf(access, db);
    const [offer] = await drizzle(db).insert(unitOffers).values(parsed.data).returning();
    // Round 1 of the negotiation log: the tenant's first offer, as logged.
    const row = (await db.query(`SELECT * FROM unit_offers WHERE id=$1`, [offer.id])).rows[0];
    await insertFirstRound(db, row, by);
    // A joint agent gets their own offer back without its CRM ids.
    return jointAgent ? offerForJointAgent(offer, true) : offer;
  });
}

export async function patchTrackerOffer(req: Request, offerId: string, body: any) {
  const scope = await resolveCompanyScope(req);
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { eq } = await import("drizzle-orm");
  const { unitOffers, insertUnitOfferSchema } = await import("@shared/schema");
  // An offer's status changes only through its negotiation
  // (POST /api/unit-offers/:offerId/status), never from the offer form.
  const fields: Record<string, unknown> = { ...(body && typeof body === "object" ? body : {}) };
  delete fields.status;
  return transaction(async db => {
    const snapshot = (await db.query(`SELECT unit_id,viewing_id FROM unit_offers WHERE id=$1`, [offerId])).rows[0];
    if (!snapshot) throw new ViewingError(404, "Offer not found");
    // The unit's property and, for a Landsec asset manager or joint agent,
    // its scheme: an offer on a scheme they are not on is refused here.
    const access = await offerAccess(req, await assertViewingUnit(db, snapshot.unit_id, scope));
    const jointAgent = access.landsecRole === "joint_agent";
    const { actorNameOf, offerForJointAgent, offersLoggedBy } = await import("./unit-negotiation");
    // The negotiation log's lock on this offer, taken before any row lock
    // (the same order as server/unit-negotiation.ts).
    await lockOffer(db, offerId);
    // Use the same viewing → offer lock order as the confirmation endpoint.
    const linked = snapshot.viewing_id ? await lockedViewingOfferFields(db, snapshot.unit_id, snapshot.viewing_id, scope) : {};
    const old = (await db.query(`SELECT * FROM unit_offers WHERE id=$1 FOR UPDATE`, [offerId])).rows[0];
    if (!old) throw new ViewingError(404, "Offer not found");
    if (old.unit_id !== snapshot.unit_id || old.viewing_id !== snapshot.viewing_id) throw new ViewingError(409, "The offer's viewing link changed. Refresh before saving.");
    // The offer form cannot go round the negotiation log. An agreed,
    // rejected or withdrawn offer is reopened there before anything about
    // it changes, and once a bid has more than one position its terms move
    // only by logging the next one (this form would rewrite the last
    // position in place and lose how the bid moved).
    const statusNow = readOfferStatus(old.status);
    if (statusNow !== "Pending" && statusNow !== "Negotiating") {
      throw new ViewingError(409, `This offer is ${statusNow.toLowerCase()}. Reopen it in its negotiation log before changing it.`);
    }
    const roundCount = Number((await db.query(`SELECT COUNT(*)::int AS n FROM unit_offer_rounds WHERE offer_id=$1`, [offerId])).rows[0]?.n || 0);
    // A joint agent's own offer is one their login logged (round 1's author).
    const own = jointAgent && (await offersLoggedBy([offerId], access.userId, db)).has(offerId);
    const sent = jointAgent ? await jointAgentOfferBody(db, snapshot.unit_id, fields, old, own) : fields;
    const parsed = insertUnitOfferSchema.partial().omit({ unitId: true }).safeParse({ ...sent,
      viewingId: old.viewing_id, ...linked, confirmedAt: old.confirmed_at });
    if (!parsed.success) throw new ViewingError(400, parsed.error.issues.map(issue => issue.message).join("; "));
    const [offer] = await drizzle(db).update(unitOffers).set({ ...parsed.data, updatedAt: new Date() }).where(eq(unitOffers.id, offerId)).returning();
    // The newest round of the negotiation log is the offer's current
    // position: an edit to the terms here is written onto it too.
    const saved = (await db.query(`SELECT * FROM unit_offers WHERE id=$1`, [offerId])).rows[0];
    if (roundChanges(termsOfRow(old), termsOfRow(saved)).length) {
      if (roundCount > 1) throw new ViewingError(409, "This bid has moved since the first offer. Add the next position in its negotiation log to change the terms.");
      // An offer with no round yet gets its round 1 here. When a joint agent
      // is the one editing, that round is written without their login: they
      // did not log the offer, so it must not become "theirs" (which would
      // show them the contact and the comments on it).
      const by = await callerStamp(db, req);
      await syncNewestRoundToOffer(db, saved, jointAgent ? { userId: null, name: await actorNameOf(access, db) } : by);
    }
    await syncFirstRoundDate(db, offerId, old.offer_date, saved.offer_date);
    // A joint agent gets the offer back without its CRM ids, and without
    // the contact and comments unless the offer is their own.
    return jointAgent ? offerForJointAgent(offer, own) : offer;
  });
}

export function registerLeasingViewingRoutes(app: Express) {
  const handle = (fn: (req: Request) => Promise<any>) => async (req: any, res: any) => {
    try { res.json(await fn(req)); }
    catch (e: any) { res.status(e instanceof ViewingError ? e.status : e instanceof z.ZodError ? 400 : 500).json({ message: e.message }); }
  };
  app.get("/api/leasing-viewings", requireAuth, handle(async req => {
    const scope = await viewingScope(req);
    let viewings = await listLeasingViewings(scope);
    if (typeof req.query.companyId === "string") viewings = viewings.filter(v => v.companyId === req.query.companyId);
    const offers = (await pool.query(`SELECT o.id,o.viewing_id,o.unit_id,o.company_id,o.offer_date,o.confirmed_at,o.status
      FROM unit_offers o JOIN available_units au ON au.id=o.unit_id JOIN crm_properties p ON p.id=au.property_id WHERE ${scopeSql}`, scopeParams(scope))).rows;
    for (const v of viewings) v.offers = offers.filter(o => o.viewing_id === v.id || (!o.viewing_id && o.unit_id === v.unitId && o.company_id && o.company_id === v.companyId)).map(toCamel);
    return { viewings, emailRemindersEnabled: process.env.VIEWING_REMINDER_EMAILS_ENABLED === "true" };
  }));

  app.get("/api/leasing-viewings/options", requireAuth, handle(async req => {
    const viewer = await viewingScope(req);
    const scope = viewer.companyId;
    const units = (await pool.query(`SELECT au.id,au.unit_name AS name,au.property_id,p.name AS property_name,au.sqft FROM available_units au JOIN crm_properties p ON p.id=au.property_id WHERE ${scopeSql} ORDER BY p.name,au.unit_name`, scopeParams(viewer))).rows.map(toCamel);
    const brandFilter = scope ? await clientBrandSliceSql(scope) : "TRUE";
    const brands = (await pool.query(`SELECT id,name FROM crm_companies WHERE company_type ~* '^tenant([[:space:]]|-|$)' AND merged_into_id IS NULL AND (${brandFilter}) ORDER BY name`)).rows;
    if (viewer.jointAgent) {
      // A joint agent: the units on their schemes, the brand list as names
      // only, and no contact or requirement from BGP's CRM (they type who is
      // coming). As agents, BGP's people on the account and the joint
      // agents who share a scheme with them, each cut to those schemes.
      const mine = viewer.propertyIds || new Set<string>();
      const team = [...await getClientVisibleUserIds(scope)];
      const bgp = (await pool.query(`SELECT id,name FROM users WHERE is_active IS NOT FALSE AND email ILIKE '%@brucegillinghampollard.com'
        AND id=ANY($1::varchar[]) ORDER BY name`, [team])).rows.map(u => ({ id: u.id, name: u.name, team: null }));
      const joint = (await jointAgentPeople()).map(p => ({ ...p, propertyIds: p.propertyIds.filter(id => mine.has(id)) })).filter(p => p.propertyIds.length);
      return { units, brands, contacts: [], owners: [...bgp, ...joint], requirements: [] };
    }
    const brandIds = brands.map(b => b.id);
    const contacts = (await pool.query(`SELECT ct.id,ct.name,ct.email,ct.company_id FROM crm_contacts ct
      WHERE $1::boolean OR ct.company_id=ANY($2::varchar[]) OR EXISTS (
        SELECT 1 FROM brand_agent_representations ar WHERE ar.primary_contact_id=ct.id AND ar.brand_company_id=ANY($2::varchar[])
        AND ar.agent_type='tenant_rep' AND (ar.start_date IS NULL OR ar.start_date<=now()) AND ar.end_date IS NULL
      ) OR EXISTS(SELECT 1 FROM crm_requirements_leasing r WHERE r.agent_contact_id=ct.id AND r.company_id=ANY($2::varchar[])
        AND (r.status IS NULL OR btrim(r.status)='' OR lower(r.status)='active')) ORDER BY ct.name`, [!scope,brandIds])).rows.map(toCamel);
    const representations = (await pool.query(`SELECT primary_contact_id AS contact_id,brand_company_id AS brand_id FROM brand_agent_representations
      WHERE brand_company_id=ANY($1::varchar[]) AND agent_type='tenant_rep' AND end_date IS NULL AND (start_date IS NULL OR start_date<=now())
      UNION SELECT agent_contact_id,company_id FROM crm_requirements_leasing WHERE company_id=ANY($1::varchar[])
      AND (status IS NULL OR btrim(status)='' OR lower(status)='active')`, [brandIds])).rows;
    for (const c of contacts) c.representedBrandIds = representations.filter(r => r.contact_id === c.id).map(r => r.brand_id);
    const allowedOwners = scope ? [...await getClientVisibleUserIds(scope)] : [];
    const bgpAgents = (await pool.query(`SELECT id,name,team FROM users WHERE is_active IS NOT FALSE AND email ILIKE '%@brucegillinghampollard.com'
      AND ($1::boolean OR id=ANY($2::varchar[])) ORDER BY name`, [!scope,allowedOwners])).rows.map(toCamel);
    // Joint agents are Landsec's: BGP staff and the Landsec login see them,
    // another client's login does not.
    const jointAgents = !scope || await isLandsecCompany(scope) ? await jointAgentPeople() : [];
    const owners = [...bgpAgents, ...jointAgents];
    const requirements = (await pool.query(`SELECT id,name,company_id FROM crm_requirements_leasing WHERE company_id=ANY($1::varchar[]) ORDER BY name`, [brandIds])).rows.map(toCamel);
    return { units, brands, contacts, owners, requirements };
  }));

  app.patch("/api/leasing-viewings/:id", requireAuth, handle(req => patchLeasingViewing(req, String(req.params.id), req.body)));

  app.post("/api/leasing-viewings/:id/units", requireAuth, handle(async req => {
    const { unitIds } = z.object({ unitIds: z.array(identifier).min(1).max(30) }).strict().parse(req.body);
    // The viewing's own unit and every unit added to the visit are checked
    // against the caller's properties and, for a restricted Landsec login,
    // schemes.
    const scope = await viewingScope(req);
    return transaction(async db => {
      const old = await getLockedViewing(db, String(req.params.id), scope);
      const bookingId = old.booking_id || old.calendar_event_id || `manual:${old.id}`;
      await db.query(`UPDATE unit_viewings SET booking_id=$2,updated_at=clock_timestamp() WHERE id=$1`, [old.id,bookingId]);
      const created = [];
      for (const unitId of new Set(unitIds)) {
        await assertViewingUnit(db, unitId, scope);
        if ((await db.query(`SELECT 1 FROM unit_viewings WHERE booking_id=$1 AND unit_id=$2 AND deleted_at IS NULL`, [bookingId,unitId])).rows.length) continue;
        const key = `${bookingId}::unit:${unitId}`;
        const row = await db.query(`INSERT INTO unit_viewings (unit_id,company_id,company_name,contact_id,contact_name,agent_contact_id,owner_user_id,requirement_id,
          viewing_date,viewing_time,attendees,source,source_details,calendar_event_id,booking_id,status,details_confirmed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'scheduled',$16)
          ON CONFLICT (calendar_event_id) WHERE calendar_event_id IS NOT NULL DO NOTHING RETURNING *`,
          [unitId,old.company_id,old.company_name,old.contact_id,old.contact_name,old.agent_contact_id,old.owner_user_id,old.requirement_id,
          old.viewing_date,old.viewing_time,old.attendees,old.source,old.source_details,key,bookingId,old.details_confirmed_at]);
        created.push(...row.rows.map(row => projectViewing(row, !!scope.companyId, scope.jointAgent)));
      }
      return { created };
    });
  }));

  app.post("/api/leasing-viewings/:id/requirement", requireAuth, handle(async req => {
    const input = z.union([z.object({ requirementId: identifier }).strict(), z.object({ create: z.literal(true) }).strict()]).parse(req.body);
    // A requirement is a record in BGP's CRM: a joint agent neither links
    // nor creates one. The gateway refuses this path for them too.
    const viewer = await viewingScope(req);
    if (viewer.jointAgent) throw new ViewingError(403, "Requirements are kept by BGP");
    if ("requirementId" in input) return patchLeasingViewing(req, String(req.params.id), { requirementId: input.requirementId });
    const scope = viewer.companyId;
    return transaction(async db => {
      const old = await getLockedViewing(db, String(req.params.id), scope);
      if (!old.company_id || !old.details_confirmed_at) throw new ViewingError(400, "Confirm the brand and viewing details before creating its requirement");
      // Client logins may only raise requirements for brands inside their
      // CRM slice — and may not probe whether an out-of-slice requirement
      // exists, so this gate sits before the existence lookup.
      if (scope && !(await isClientVisibleBrand(old.company_id, scope))) throw new ViewingError(403, "Brand is outside your CRM");
      await validateLinks(db, toCamel(old), scope, toCamel(old));
      if (old.requirement_id) return { requirementId: old.requirement_id };
      await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`viewing-requirement:${old.company_id}`]);
      const existing = await db.query(`SELECT id FROM crm_requirements_leasing WHERE company_id=$1 LIMIT 1`, [old.company_id]);
      if (existing.rows.length) throw new ViewingError(409, "This brand already has a requirement. Choose the relevant one to avoid a duplicate.");
      const unit = (await db.query(`SELECT au.unit_name,au.sqft,p.name FROM available_units au JOIN crm_properties p ON p.id=au.property_id WHERE au.id=$1`, [old.unit_id])).rows[0];
      const r = await db.query(`INSERT INTO crm_requirements_leasing (name,company_id,status,principal_contact_id,agent_contact_id,bgp_contact_user_id,sources,comments,requirement_date)
        VALUES ($1,$2,'Draft',$3,$4,$5,ARRAY['Viewing'],$6,$7) RETURNING id`,
        [`${old.company_name || "Brand"} — viewing requirement`,old.company_id,old.contact_id,old.agent_contact_id,old.owner_user_id,
        `Draft for review. ${old.status === "completed" ? "Viewed" : "Viewing booked"}: ${unit?.unit_name || "Unit"}, ${unit?.name || "Property"} on ${old.viewing_date}${unit?.sqft != null ? ` (${unit.sqft} sq ft)` : ""}. This is observed activity, not a confirmed size or location requirement.`,old.viewing_date]);
      await db.query(`UPDATE unit_viewings SET requirement_id=$2,updated_at=clock_timestamp() WHERE id=$1`, [old.id,r.rows[0].id]);
      return { requirementId: r.rows[0].id };
    });
  }));

  app.post("/api/leasing-viewings/:id/offers/:offerId/confirm", requireAuth, handle(async req => {
    const scope = await viewingScope(req);
    return transaction(async db => {
      const viewing = await getLockedViewing(db, String(req.params.id), scope);
      const offer = (await db.query(`SELECT * FROM unit_offers WHERE id=$1 FOR UPDATE`, [req.params.offerId])).rows[0];
      if (!offer) throw new ViewingError(404, "Offer not found");
      if (!viewing.details_confirmed_at || !viewing.company_id || offer.unit_id !== viewing.unit_id || offer.company_id !== viewing.company_id) throw new ViewingError(400, "Confirm the viewing and check that the offer belongs to the same brand and unit");
      if (offer.viewing_id && offer.viewing_id !== viewing.id) throw new ViewingError(409, "This offer is already linked to another viewing");
      if (!calendarDateValue(offer.offer_date)) throw new ViewingError(400, "Set a valid offer date before confirming it");
      const saved = await db.query(`UPDATE unit_offers SET viewing_id=$2,confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1 RETURNING *`, [offer.id,viewing.id]);
      if (!scope.jointAgent) return toCamel(saved.rows[0]);
      // A joint agent gets the offer without its CRM ids or the email
      // thread, and its contact and comments only when their login logged it.
      const { offerForJointAgent, offersLoggedBy } = await import("./unit-negotiation");
      return offerForJointAgent(toCamel(saved.rows[0]), (await offersLoggedBy([offer.id], callerId(req), db)).has(offer.id));
    });
  }));

  app.get("/api/leasing-viewings/report", requireAuth, handle(async req => {
    const asOf = todayLondon();
    const from = day.parse(req.query.from || `${asOf.slice(0,4)}-01-01`);
    const to = day.parse(req.query.to || asOf);
    if (from > to) throw new ViewingError(400, "The report start must be before its end");
    const scope = await viewingScope(req);
    const viewings = await listLeasingViewings(scope);
    const offers = (await pool.query(`SELECT o.*,COALESCE(au.unit_id,au.tenancy_unit_id,au.id) AS physical_unit_id
      FROM unit_offers o JOIN available_units au ON au.id=o.unit_id JOIN crm_properties p ON p.id=au.property_id WHERE ${scopeSql}`, scopeParams(scope))).rows.map(toCamel);
    return buildViewingReport({ viewings: viewings.map(v => ({ ...v, confirmed: !!v.detailsConfirmedAt && !v.issues.length })),
      offers: offers.map(o => ({ ...o, confirmed: !!o.confirmedAt })),from,to,asOf,conversionWindowDays:90,
      ownerUserId: typeof req.query.ownerUserId === "string" ? req.query.ownerUserId : undefined,
      team: typeof req.query.team === "string" ? req.query.team : undefined });
  }));
}
