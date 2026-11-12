// The Targeting Brief workspace (Woody, 2026-11-12; shared/unit-brief.ts,
// migration 0050). One brief per letting-tracker unit, across the whole app
// and every client: who is involved (BGP agents, a joint agent, the
// client's leasing team and asset managers), the commercials, the plans and
// marketing material, each person's attributed comments with AI help, and
// the sign-off — every person involved presses Agree brief and the date is
// kept. A change to the terms raises the brief's version, and a signature
// given on an earlier version no longer counts.
import type { Express, Request } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { resolveCompanyScope, isClientRequestUser, isPropertyInScope, getClientVisibleUserIds } from "./company-scope";
import {
  BRIEF_PERSON_ROLES, BRIEF_TERM_FIELDS, briefApproval, briefApprovalLabel, briefRoleLabel,
  normaliseCommercials, commercialsHaveContent, isPlainObject, targetForJointAgent, jointAgentTargetBody, targetHasBgpNotes,
  type BriefPerson, type BriefComment, type BriefViewer, type BriefWorkspace, type BriefPeopleCandidates,
} from "@shared/unit-brief";

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";

export interface BriefAccess {
  userId: string | null;
  name: string | null;
  email: string | null;
  isStaff: boolean;          // a BGP login (also when viewing as a client)
  scope: string | null;      // the client company the request is scoped to
  scopeName: string | null;
  landsecRole: string | null; // asset_manager | joint_agent | leasing_manager | null
  canEditTerms: boolean;
  // Runs the letting like BGP does: BGP staff, and a joint agent on a scheme
  // they are instructed on (Woody, 2026-11-12: "joint agents should have full
  // control like us", "only on their instructed properties"). Use this for
  // ACTIONS (issue, convert, record an agreement, share). It never opens
  // BGP's own records: keep isStaff for the staff directory and CRM pickers.
  agentControl: boolean;
  // BGP's notes on target brands, brand contacts and email history. Never for
  // a joint agent, whatever else they can do.
  seesBgpNotes: boolean;
}

// Who is asking, and may they open a brief on this property? Returns null
// when they may not. BGP staff reach every brief; a client login reaches
// briefs on its own properties; a Landsec asset manager or joint agent only
// on the schemes on their login. A joint agent on their scheme has the same
// control as BGP (agentControl) but is never isStaff: the staff branches skip
// the property check and open BGP's directory and CRM.
export async function briefAccess(req: Request, propertyId: string | null | undefined): Promise<BriefAccess | null> {
  const userId = req.session?.userId || (req as any).tokenUserId || null;
  if (!userId) return null;
  const u = (await pool.query(`SELECT name, email FROM users WHERE id = $1`, [userId])).rows[0];
  if (!u) return null;
  const scope = await resolveCompanyScope(req);
  const isClient = await isClientRequestUser(req);
  const isStaff = !isClient && String(u.email || "").toLowerCase().endsWith(BGP_EMAIL_DOMAIN);
  const base = { userId, name: u.name || u.email || null, email: u.email || null, isStaff, scope: scope || null, scopeName: null as string | null, landsecRole: null as string | null };
  if (!scope) {
    // No client scope: BGP staff only. Anything else has no business here.
    return isClient ? null : { ...base, canEditTerms: true, agentControl: true, seesBgpNotes: true };
  }
  if (!propertyId || !(await isPropertyInScope(scope, propertyId))) return null;
  base.scopeName = (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [scope])).rows[0]?.name || null;
  if (!isClient) return { ...base, canEditTerms: true, agentControl: isStaff, seesBgpNotes: true };
  // A Landsec login by role and scheme (server/landsec-access.ts).
  const { landsecViewer, viewerCanSeeScheme } = await import("./landsec-access");
  // No catch: if the role cannot be read the request fails, rather than a
  // restricted login being treated as a full one.
  const viewer = await landsecViewer(req);
  if (viewer && viewer.schemes) {
    const { resolveLandsecPortfolio } = await import("./landsec-schemes");
    const portfolio = await resolveLandsecPortfolio(viewer.companyId);
    const scheme = portfolio.schemes.find(s => s.properties.some(p => p.id === propertyId));
    if (!scheme || !viewerCanSeeScheme(viewer, scheme.key)) return null;
  }
  const landsecRole = viewer && viewer.role !== "landsec" && viewer.role !== "bgp" ? viewer.role : null;
  const jointAgent = landsecRole === "joint_agent";
  return { ...base, landsecRole, canEditTerms: true, agentControl: jointAgent, seesBgpNotes: !jointAgent };
}

// The properties a restricted Landsec login may see briefs on (null = no
// extra restriction). For the brief list on the tracker.
export async function briefSchemePropertyIds(req: Request): Promise<Set<string> | null> {
  if (!(await isClientRequestUser(req))) return null;
  const { landsecViewer } = await import("./landsec-access");
  const viewer = await landsecViewer(req);
  if (!viewer || !viewer.schemes) return null;
  const { resolveLandsecPortfolio } = await import("./landsec-schemes");
  const portfolio = await resolveLandsecPortfolio(viewer.companyId);
  const ids = new Set<string>();
  for (const s of portfolio.schemes) if (viewer.schemes.has(s.key)) for (const p of s.properties) ids.add(p.id);
  return ids;
}

// What a joint agent may not receive on a target operator: BGP's brand
// contacts, relationship notes and comment log (decided 2026-11-11), and the
// link to the brand's CRM record (no brand pages for a joint agent). The
// field lists are in shared/unit-brief.ts.
export function targetForViewer(t: any, access: Pick<BriefAccess, "landsecRole">) {
  return access.landsecRole === "joint_agent" ? targetForJointAgent(t) : t;
}

// What a target write may carry. From a joint agent only their own fields
// are read; whatever they send for BGP's fields is dropped, so the stored
// values stay as they are.
export function targetBodyForWriter(body: any, access: Pick<BriefAccess, "landsecRole">): Record<string, any> {
  if (access.landsecRole === "joint_agent") return jointAgentTargetBody(body);
  return isPlainObject(body) ? body : {};
}

export { targetHasBgpNotes };

// A brief row as a joint agent may have it. The generated brief document is
// not theirs, so neither is its file id.
export function briefForViewer<T extends Record<string, any>>(b: T, access: Pick<BriefAccess, "seesBgpNotes">): T {
  if (access.seesBgpNotes) return b;
  return { ...b, ...("documentFileId" in b ? { documentFileId: null } : {}), ...("document_file_id" in b ? { document_file_id: null } : {}) };
}

const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);

function personOf(r: any): BriefPerson {
  return {
    id: r.id, briefId: r.brief_id, role: r.role, userId: r.user_id, contactId: r.contact_id, companyId: r.company_id,
    name: r.name, email: r.email, firm: r.firm, agreedAt: iso(r.agreed_at), agreedVersion: r.agreed_version,
    agreedByName: r.agreed_by_name,
    agreedOnBehalf: !!r.agreed_at && !!r.agreed_by_user_id && r.agreed_by_user_id !== r.user_id,
    sortOrder: r.sort_order ?? 0,
  };
}

// A person row as the caller may have it. A joint agent gets the name, firm,
// email and sign-off, not the ids of BGP's CRM records behind the row.
function personFor(r: any, access: Pick<BriefAccess, "seesBgpNotes">): BriefPerson {
  const p = personOf(r);
  return access.seesBgpNotes ? p : { ...p, contactId: null, companyId: null };
}

function commentOf(r: any): BriefComment {
  return {
    id: r.id, briefId: r.brief_id, userId: r.user_id, userName: r.user_name, roleLabel: r.role_label,
    kind: r.kind === "event" ? "event" : "comment", body: r.body, aiAssisted: !!r.ai_assisted,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at),
  };
}

const sameEmail = (a: any, b: any) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Is this person row the login that is asking? A row linked to a login is
// that login and no other; a row with no login is matched by email.
function isSelfPerson(p: any, access: BriefAccess): boolean {
  return p.user_id ? p.user_id === access.userId : sameEmail(p.email, access.email);
}
function myPeople(people: any[], access: BriefAccess): any[] {
  return people.filter(p => isSelfPerson(p, access));
}

function roleLabelFor(people: any[], access: BriefAccess): string {
  const mine = myPeople(people, access)[0];
  if (mine) return mine.role === "joint_agent" && mine.firm ? `Joint agent · ${mine.firm}` : briefRoleLabel(mine.role);
  if (access.isStaff) return "BGP";
  if (access.landsecRole === "asset_manager") return "Asset manager";
  if (access.landsecRole === "joint_agent") return "Joint agent";
  return access.scopeName || "Client";
}

async function loadBrief(briefId: string): Promise<any | null> {
  return (await pool.query(`SELECT * FROM unit_briefs WHERE id = $1`, [briefId])).rows[0] || null;
}

async function logEvent(briefId: string, access: BriefAccess, roleLabel: string, body: string) {
  await pool.query(
    `INSERT INTO unit_brief_comments (brief_id, user_id, user_name, role_label, kind, body) VALUES ($1, $2, $3, $4, 'event', $5)`,
    [briefId, access.userId, access.name, roleLabel, body]
  ).catch((e: any) => console.warn("[unit-brief] event log failed:", e?.message));
}

// unit_briefs.agreed_at follows the people rows: set while everyone on the
// brief has agreed the current version and both sides are on it (a BGP agent
// and one of the client's people), cleared otherwise. One statement, so a
// change to the terms cannot slip between the read and the write.
async function refreshAgreed(briefId: string): Promise<void> {
  await pool.query(
    `UPDATE unit_briefs b SET agreed_at = CASE
        WHEN EXISTS (SELECT 1 FROM unit_brief_people p WHERE p.brief_id = b.id AND p.role = 'bgp_agent')
         AND EXISTS (SELECT 1 FROM unit_brief_people p WHERE p.brief_id = b.id AND p.role IN ('client_leasing', 'senior_asset_manager', 'asset_manager'))
         AND NOT EXISTS (SELECT 1 FROM unit_brief_people p WHERE p.brief_id = b.id AND (p.agreed_at IS NULL OR p.agreed_version IS DISTINCT FROM COALESCE(b.version, 1)))
        THEN COALESCE(b.agreed_at, (SELECT MAX(p.agreed_at) FROM unit_brief_people p WHERE p.brief_id = b.id))
        ELSE NULL END
      WHERE b.id = $1`, [briefId]);
}

// The agents' fee split in words, for the timeline: who has what.
const feeSplitWords = (jointAgentPct: number | null): string =>
  jointAgentPct === null ? "not set" : `BGP ${Math.round((100 - jointAgentPct) * 100) / 100}%, joint agent ${Math.round(jointAgentPct * 100) / 100}%`;

const hasBriefContent = (b: any): boolean =>
  !!(b.objective || b.target_criteria || b.priority_categories || b.location_context || b.agent_instruction || b.success_measures || commercialsHaveContent(b.commercials));

// Text from a request: a string or a number, trimmed; anything else (an
// object, an array) is not text and reads as blank.
const txt = (v: any): string | null => (typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null);
const camelToSnake = (k: string) => k.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
const sameSet = (a: any, b: any) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// The one write door for a brief's fields. Only the named fields can be
// written (never the unit, property, author, version or agreed date). A real
// change to the terms raises the version and is written to the timeline.
export async function saveBriefFields(briefId: string, body: any, access: BriefAccess): Promise<{ ok: true; brief: any; termsChanged: boolean } | { ok: false; status: number; message: string }> {
  const brief = await loadBrief(briefId);
  if (!brief) return { ok: false, status: 404, message: "Brief not found" };
  const sets: string[] = [];
  const params: any[] = [briefId];
  const put = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  const changed: string[] = [];

  const figureChanged = { quotingRentPa: false, serviceChargePa: false, ratesPayablePa: false };
  for (const key of BRIEF_TERM_FIELDS) {
    if (!(key in body)) continue;
    const col = camelToSnake(key);
    const raw = body[key];
    if (raw !== null && raw !== undefined && typeof raw !== "string" && typeof raw !== "number") return { ok: false, status: 400, message: `${key} must be text` };
    if (typeof raw === "string" && raw.length > 20000) return { ok: false, status: 400, message: `${key} is too long` };
    let next = txt(raw);
    if (key === "agencyBasis" && next && !["sole", "joint"].includes(next)) return { ok: false, status: 400, message: "Agency basis is sole or joint" };
    if ((brief[col] ?? null) !== next) { put(col, next); changed.push(key); }
  }
  if ("commercials" in body) {
    if (!isPlainObject(body.commercials)) return { ok: false, status: 400, message: "Commercials must be a set of named figures" };
    // Merged onto what is saved: a figure that was not sent stays as it is,
    // so two people editing different figures do not blank each other's.
    const before = normaliseCommercials(brief.commercials).value;
    const { value, invalid } = normaliseCommercials({ ...before, ...body.commercials });
    if (invalid.length) return { ok: false, status: 400, message: `Check the figure for: ${invalid.join(", ")}. Use a yearly figure as a number, for example 95000 or 95k.` };
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      put("commercials", JSON.stringify(value)); changed.push("commercials");
      for (const k of Object.keys(figureChanged) as (keyof typeof figureChanged)[]) figureChanged[k] = before[k] !== value[k];
    }
  }
  const termsChanged = changed.length > 0;

  // Not terms: targets and KPIs, the status, images, attached plans and brochures.
  for (const key of ["minTargets", "priorityTargets"] as const) {
    if (key in body) {
      const n = body[key] === null || body[key] === "" ? null : Number(body[key]);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 1000)) return { ok: false, status: 400, message: `${key === "minTargets" ? "Targets wanted" : "Priority A wanted"} is a whole number from 0 to 1000` };
      put(camelToSnake(key), n);
    }
  }
  if ("status" in body) {
    const s = txt(body.status);
    if (s && !["Active", "Complete", "Withdrawn"].includes(s)) return { ok: false, status: 400, message: "Status is Active, Complete or Withdrawn" };
    put("status", s || "Active");
  }
  // Images come from Image Studio, which a joint agent has no reach into:
  // they add photos on Plans & files, and an image list from them is ignored.
  if ("imageIds" in body && access.landsecRole !== "joint_agent") put("image_ids", Array.isArray(body.imageIds) ? body.imageIds.filter((x: any) => typeof x === "string").slice(0, 200) : null);
  let filesNote: string | null = null;
  if ("planIds" in body) {
    const ids: string[] = Array.isArray(body.planIds) ? Array.from(new Set(body.planIds.map(String))) : [];
    const ok = ids.length ? (await pool.query(`SELECT id::text AS id FROM property_plans WHERE id::text = ANY($1::text[]) AND property_id::text = $2`, [ids, brief.property_id])).rows.map((r: any) => r.id) : [];
    if (ok.length !== ids.length) return { ok: false, status: 400, message: "A plan is not on this property" };
    if (!sameSet(brief.plan_ids, ids)) { put("plan_ids", ids); filesNote = "changed the plans on the brief"; }
  }
  if ("brochureIds" in body) {
    const ids: string[] = Array.isArray(body.brochureIds) ? Array.from(new Set(body.brochureIds.map(String))) : [];
    const ok = ids.length ? (await pool.query(`SELECT id::text AS id FROM property_brochures WHERE id::text = ANY($1::text[]) AND property_id::text = $2`, [ids, brief.property_id]).catch(() => ({ rows: [] as any[] }))).rows.map((r: any) => r.id) : [];
    if (ok.length !== ids.length) return { ok: false, status: 400, message: "A brochure is not on this property" };
    if (!sameSet(brief.brochure_ids, ids)) { put("brochure_ids", ids); filesNote = filesNote ? "changed the plans and brochures on the brief" : "changed the brochures on the brief"; }
  }
  if (sets.length === 0) return { ok: true, brief, termsChanged: false };

  if (termsChanged) {
    sets.push(`version = COALESCE(version, 1) + 1`, `terms_updated_at = NOW()`, `agreed_at = NULL`);
    put("terms_updated_by_name", access.name);
  }
  sets.push(`updated_at = NOW()`);
  let updated = (await pool.query(`UPDATE unit_briefs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params)).rows[0];
  // A sole agent has the whole fee: a split set while the basis was joint
  // does not survive the change back to sole.
  let clearedSplit: number | null = null;
  if (changed.includes("agencyBasis") && updated.agency_basis !== "joint" && updated.joint_agent_fee_pct != null) {
    clearedSplit = Number(updated.joint_agent_fee_pct);
    updated = (await pool.query(`UPDATE unit_briefs SET joint_agent_fee_pct = NULL WHERE id = $1 RETURNING *`, [briefId])).rows[0];
    await pool.query(`UPDATE crm_deals SET joint_agent_fee_pct = NULL WHERE id = (SELECT deal_id FROM available_units WHERE id = $1)`, [updated.unit_id]).catch(() => undefined);
  }

  const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [briefId])).rows;
  const label = roleLabelFor(people, access);
  if (clearedSplit !== null) {
    await logEvent(briefId, access, label, `changed the agency basis away from joint agents, which cleared the fee split between the agents (it was ${feeSplitWords(clearedSplit)})`);
  }
  if (termsChanged) {
    const signed = people.filter((p: any) => p.agreed_at && p.agreed_version === (brief.version || 1)).length;
    const what = changed.includes("commercials") && changed.length === 1 ? "the commercials" : changed.includes("commercials") ? "the brief and the commercials" : "the brief";
    await logEvent(briefId, access, label, `changed ${what}${signed ? `. ${signed === 1 ? "The signature" : `The ${signed} signatures`} already given ${signed === 1 ? "is" : "are"} on the earlier version, so sign-off starts again` : ""}`);
    // The tracker row carries the quoting rent, service charge and rates
    // (the tracker columns, the website and the brief PDF read them there).
    // Only a figure this save changed is written through, so editing the
    // break clause does not put an older rent back over the tracker's.
    if (figureChanged.quotingRentPa || figureChanged.serviceChargePa || figureChanged.ratesPayablePa) {
      const c = normaliseCommercials(updated.commercials).value;
      await pool.query(
        `UPDATE available_units SET asking_rent = COALESCE($2, asking_rent), service_charge_pa = COALESCE($3, service_charge_pa), rates_pa = COALESCE($4, rates_pa), updated_at = NOW() WHERE id = $1`,
        [brief.unit_id, figureChanged.quotingRentPa ? c.quotingRentPa : null, figureChanged.serviceChargePa ? c.serviceChargePa : null, figureChanged.ratesPayablePa ? c.ratesPayablePa : null]
      ).catch((e: any) => console.warn("[unit-brief] tracker write-through failed:", e?.message));
      // The Deals board and the WIP read the rent off the backing deal. While
      // the letting is still at Marketing the deal's rent IS the quoting rent
      // (the tracker's own rent edit writes it there too); past that the deal
      // carries the rent under negotiation and is left alone.
      if (figureChanged.quotingRentPa && c.quotingRentPa != null) {
        const { statusSpellingsFor } = await import("@shared/deal-status");
        await pool.query(
          `UPDATE crm_deals SET rent_pa = $2, updated_at = NOW()
            WHERE id = (SELECT deal_id FROM available_units WHERE id = $1)
              AND lower(trim(coalesce(status, 'ava'))) = ANY($3::text[])`,
          [brief.unit_id, c.quotingRentPa, [...statusSpellingsFor(["AVA"]), ""]]
        ).catch((e: any) => console.warn("[unit-brief] deal rent write-through failed:", e?.message));
      }
    }
  } else if (filesNote) {
    await logEvent(briefId, access, label, filesNote);
  }
  return { ok: true, brief: updated, termsChanged };
}

function briefJson(b: any) {
  return {
    id: b.id, unitId: b.unit_id, propertyId: b.property_id, clientCompany: b.client_company, clientCompanyId: b.client_company_id,
    title: b.title, objective: b.objective, locationContext: b.location_context, targetCriteria: b.target_criteria,
    priorityCategories: b.priority_categories, agentInstruction: b.agent_instruction, successMeasures: b.success_measures,
    instructedDate: b.instructed_date, deadline1Date: b.deadline1_date, deadline1Deliverables: b.deadline1_deliverables,
    deadline2Date: b.deadline2_date, deadline2Deliverables: b.deadline2_deliverables, minTargets: b.min_targets, priorityTargets: b.priority_targets,
    status: b.status, sourceFileId: b.source_file_id, documentFileId: b.document_file_id, imageIds: b.image_ids || [],
    agencyBasis: b.agency_basis || null, jointAgentFeePct: b.joint_agent_fee_pct ?? null, commercials: normaliseCommercials(b.commercials).value,
    planIds: b.plan_ids || [], brochureIds: b.brochure_ids || [], version: b.version || 1,
    termsUpdatedAt: iso(b.terms_updated_at), termsUpdatedByName: b.terms_updated_by_name, agreedAt: iso(b.agreed_at),
    createdByUserId: b.created_by_user_id, createdByName: b.created_by_name, createdAt: iso(b.created_at), updatedAt: iso(b.updated_at),
  };
}

// One brief per unit. Returns the unit's brief, making it when there is
// none; the check and the insert run under a lock on the unit, so two
// requests at once cannot both insert. `fields` are extra unit_briefs
// columns for a new brief (snake_case), already validated by the caller.
// A tracker unit re-pointed at another property takes its brief along: the
// brief's property decides who can read it, so leaving it behind would keep
// the old landlord in and lock the new one out. The plans and brochures picked
// from the old property no longer apply and are dropped; the people stay for
// BGP to tidy (their signatures are on the record).
export async function moveBriefsToProperty(unitId: string, propertyId: string, db: { query: (sql: string, params?: any[]) => Promise<any> } = pool): Promise<any | null> {
  const r = await db.query(
    `UPDATE unit_briefs b
        SET property_id = $2,
            client_company_id = p.landlord_id,
            client_company = c.name,
            plan_ids = NULL, brochure_ids = NULL, updated_at = NOW()
       FROM crm_properties p LEFT JOIN crm_companies c ON c.id = p.landlord_id
      WHERE b.unit_id = $1 AND p.id = $2 AND b.property_id IS DISTINCT FROM $2
      RETURNING b.*`, [unitId, propertyId]);
  return r.rows[0] || null;
}

export async function ensureBriefForUnit(
  unit: { id: string; propertyId: string; unitName?: string | null },
  access: { userId: string | null; name: string | null },
  opts: { title?: string | null; fields?: Record<string, any> } = {},
): Promise<{ brief: any; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`unit_brief:${unit.id}`]);
    const existing = (await client.query(`SELECT * FROM unit_briefs WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 1`, [unit.id])).rows[0];
    if (existing) {
      // A unit moved to another property takes its brief with it (the unit
      // edit does this too; this heals a brief left behind by an older move).
      if (existing.property_id !== unit.propertyId) {
        const moved = await moveBriefsToProperty(unit.id, unit.propertyId, client);
        await client.query("COMMIT");
        return { brief: moved || existing, created: false };
      }
      await client.query("COMMIT");
      return { brief: existing, created: false };
    }
    const prop = (await client.query(`SELECT p.name, p.landlord_id, c.name AS landlord_name FROM crm_properties p LEFT JOIN crm_companies c ON c.id = p.landlord_id WHERE p.id = $1`, [unit.propertyId])).rows[0];
    const base: Record<string, any> = {
      client_company: prop?.landlord_name || null, client_company_id: prop?.landlord_id || null,
      title: opts.title || `Targeting Brief: ${unit.unitName || "Unit"}${prop?.name ? `, ${prop.name}` : ""}`,
      instructed_date: new Date().toISOString().slice(0, 10),
      ...(opts.fields || {}),
      // Never from a caller: the unit, the property, the author, the sign-off state.
      unit_id: unit.id, property_id: unit.propertyId, version: 1, agreed_at: null,
      created_by_user_id: access.userId, created_by_name: access.name,
    };
    const cols = Object.keys(base);
    const brief = (await client.query(
      `INSERT INTO unit_briefs (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      cols.map(c => (c === "commercials" && base[c] ? JSON.stringify(base[c]) : base[c])))).rows[0];
    await client.query("COMMIT");
    return { brief, created: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// The client's people who can be put on a brief: its logins and its CRM
// contacts. A joint agent is offered the people for this brief's scheme only
// (the leasing team, the asset managers on the scheme, the contacts linked to
// it). One list for the people picker and for the check on the write, so a
// joint agent cannot add by id someone the picker would not have shown them.
// Emails are as stored: the caller decides who is sent them.
async function briefClientCandidates(brief: any, access: BriefAccess): Promise<{ clientId: string | null; clientName: string | null; client: BriefPeopleCandidates["client"] }> {
  const jointAgent = access.landsecRole === "joint_agent";
  // The client is the brief's client for BGP staff; for a client login it
  // is always that login's own company, whatever the brief row says.
  let clientId: string | null = access.scope && !access.isStaff ? access.scope : brief.client_company_id || null;
  if (!clientId) clientId = (await pool.query(`SELECT landlord_id FROM crm_properties WHERE id = $1`, [brief.property_id])).rows[0]?.landlord_id || null;
  const clientName = clientId ? (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [clientId])).rows[0]?.name || null : access.isStaff ? brief.client_company || null : null;
  const client: BriefPeopleCandidates["client"] = [];
  if (clientId) {
    let schemeKey: string | null = null;
    let schemePropertyIds: string[] = [brief.property_id];
    if (jointAgent) {
      const { resolveLandsecPortfolio } = await import("./landsec-schemes");
      const scheme = (await resolveLandsecPortfolio(clientId)).schemes.find(s => s.properties.some(p => p.id === brief.property_id));
      schemeKey = scheme?.key || null;
      if (scheme) schemePropertyIds = scheme.properties.map(p => p.id);
    }
    const logins = (await pool.query(
      `SELECT u.id, u.name, u.email, a.landsec_role, a.schemes FROM users u LEFT JOIN landsec_access a ON a.user_id = u.id
        WHERE COALESCE(u.is_active, true) AND u.role = 'Client' AND lower(u.team) = lower($1) AND COALESCE(a.landsec_role, '') <> 'joint_agent' ORDER BY u.name`, [clientName || ""]).catch(() => ({ rows: [] as any[] }))).rows;
    for (const u of logins) {
      if (jointAgent && u.landsec_role === "asset_manager" && !(schemeKey && Array.isArray(u.schemes) && u.schemes.includes(schemeKey))) continue;
      client.push({ contactId: null, userId: u.id, name: u.name || u.email, role: u.landsec_role === "asset_manager" ? "Asset manager (login)" : "Login", email: u.email });
    }
    const contacts = jointAgent
      ? (await pool.query(
          `SELECT c.id, c.name, c.role, c.email FROM crm_contacts c
            WHERE c.company_id = $1 AND COALESCE(c.name, '') <> '' AND (
              c.id IN (SELECT contact_id FROM crm_contact_properties WHERE property_id = ANY($2::text[]))
              OR c.id IN (SELECT report_to_contact_id FROM landsec_units WHERE property_id = ANY($2::text[]))
              OR c.id IN (SELECT hots_checker_contact_id FROM landsec_units WHERE property_id = ANY($2::text[])))
            ORDER BY c.name LIMIT 400`, [clientId, schemePropertyIds]).catch(() => ({ rows: [] as any[] }))).rows
      : (await pool.query(`SELECT id, name, role, email FROM crm_contacts WHERE company_id = $1 AND COALESCE(name, '') <> '' ORDER BY name LIMIT 400`, [clientId])).rows;
    for (const c of contacts) {
      const dupe = client.find(x => sameEmail(x.email, c.email) || x.name.trim().toLowerCase() === String(c.name).trim().toLowerCase());
      if (dupe) { dupe.contactId = c.id; if (c.role) dupe.role = c.role; continue; }
      client.push({ contactId: c.id, userId: null, name: c.name, role: c.role, email: c.email });
    }
  }
  return { clientId, clientName, client };
}

export function setupUnitBriefWorkspaceRoutes(app: Express) {
  // The fee split between the agents (Woody, 2026-11-12): on a joint
  // instruction, the joint agent's share of the fee; BGP has the rest. A sole
  // instruction is BGP 100% and carries no figure. This is the split between
  // the firms the client has instructed, not BGP's own internal split, which
  // stays on the deal page for BGP staff. A joint agent on the scheme can
  // change it as BGP and the client can (Woody, 2026-11-12: "joint agents
  // should have full control like us"), so every change is written to the
  // brief's timeline: who made it, and the figure before and after. It does
  // not restart sign-off: it is between the client and its agents, not part
  // of who to target or on what terms.
  app.put("/api/unit-briefs/:id/agent-fee-split", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Your login cannot change the fee split" });
      const raw = req.body?.jointAgentPct;
      let pct: number | null = null;
      if (raw !== null && raw !== undefined && raw !== "") {
        if (typeof raw !== "number" && typeof raw !== "string") return res.status(400).json({ message: "Give the joint agent's share as a percentage" });
        pct = Number(String(raw).replace(/%\s*$/, "").trim());
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ message: "The joint agent's share is a percentage from 0 to 100" });
        pct = Math.round(pct * 100) / 100;
        if (brief.agency_basis !== "joint") return res.status(400).json({ message: "Set the agency basis to joint agents first. A sole agent has the whole fee." });
      }
      const before: number | null = brief.joint_agent_fee_pct === null || brief.joint_agent_fee_pct === undefined ? null : Number(brief.joint_agent_fee_pct);
      if (before === pct) return res.json({ ok: true, jointAgentFeePct: pct });
      await pool.query(`UPDATE unit_briefs SET joint_agent_fee_pct = $2, updated_at = NOW() WHERE id = $1`, [brief.id, pct]);
      // The deal carries it too, for the deal page and the WIP.
      await pool.query(`UPDATE crm_deals SET joint_agent_fee_pct = $2 WHERE id = (SELECT deal_id FROM available_units WHERE id = $1)`, [brief.unit_id, pct])
        .catch((e: any) => console.warn("[unit-brief] deal fee split write-through failed:", e?.message));
      const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows;
      // Who, and the figure before and after (the name and role are on the line).
      await logEvent(brief.id, access, roleLabelFor(people, access),
        pct === null ? `cleared the fee split between the agents (it was ${feeSplitWords(before)})`
          : before === null ? `set the fee split between the agents: ${feeSplitWords(pct)} (it was not set)`
          : `changed the fee split between the agents from ${feeSplitWords(before)} to ${feeSplitWords(pct)}`);
      res.json({ ok: true, jointAgentFeePct: pct });
    } catch (e: any) { res.status(500).json({ message: e?.message || "Could not save the fee split" }); }
  });

  // Everything the brief dialog shows, in one read.
  app.get("/api/unit-briefs/:id/workspace", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      const [unitQ, peopleQ, commentsQ, filesQ, plansQ, brochuresQ, tenancyQ] = await Promise.all([
        pool.query(`SELECT au.id, au.unit_name, au.property_id, au.floor, au.sqft, au.marketing_status, au.asking_rent, au.service_charge_pa, au.rates_pa, au.use_class, au.available_date, au.tenancy_unit_id, p.name AS property_name
                      FROM available_units au LEFT JOIN crm_properties p ON p.id = au.property_id WHERE au.id = $1`, [brief.unit_id]),
        pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1 ORDER BY sort_order, created_at`, [brief.id]),
        pool.query(`SELECT * FROM unit_brief_comments WHERE brief_id = $1 ORDER BY created_at DESC LIMIT 300`, [brief.id]),
        // The generated brief document carries BGP's notes on the targets: not for a joint agent.
        pool.query(`SELECT id, file_name, file_path, category, mime_type, created_at FROM unit_marketing_files WHERE unit_id = $1 AND ($2::boolean OR COALESCE(file_type, 'upload') <> 'targeting_brief') ORDER BY sort_order ASC NULLS LAST, created_at`, [brief.unit_id, access.seesBgpNotes]),
        pool.query(`SELECT id, floor, source FROM property_plans WHERE property_id = $1 AND COALESCE(is_geo, false) = false ORDER BY display_order, floor`, [brief.property_id]).catch(() => ({ rows: [] as any[] })),
        pool.query(`SELECT id, original_name, type FROM property_brochures WHERE property_id = $1 AND COALESCE(archived, false) = false ORDER BY created_at DESC`, [brief.property_id]).catch(() => ({ rows: [] as any[] })),
        pool.query(`SELECT id, erv_pa, coalesce(nullif(trim(unit_number), ''), premises) AS unit_name, status, coalesce(nullif(trim(trading_name), ''), tenant_name) AS tenant, lease_expiry FROM tenancy_schedule_units WHERE id = (SELECT tenancy_unit_id FROM available_units WHERE id = $1)`, [brief.unit_id]).catch(() => ({ rows: [] as any[] })),
      ]);
      const unit = unitQ.rows[0];
      if (!unit) return res.status(404).json({ message: "The brief's unit is no longer on the tracker" });
      const mine = myPeople(peopleQ.rows, access);
      const approval = briefApproval(brief.version || 1, peopleQ.rows.map((p: any) => ({ agreedAt: p.agreed_at, agreedVersion: p.agreed_version, role: p.role })));
      const viewer: BriefViewer = {
        userId: access.userId, name: access.name, isStaff: access.isStaff, canEditTerms: access.canEditTerms, canComment: true,
        agentControl: access.agentControl, seesBgpNotes: access.seesBgpNotes,
        personIds: mine.map((p: any) => p.id), roleLabel: roleLabelFor(peopleQ.rows, access),
      };
      const planIds = new Set<string>(brief.plan_ids || []);
      const brochureIds = new Set<string>(brief.brochure_ids || []);
      const out: BriefWorkspace = {
        brief: briefForViewer(briefJson(brief), access) as any,
        unit: { id: unit.id, unitName: unit.unit_name, propertyId: unit.property_id, propertyName: unit.property_name, floor: unit.floor, sqft: unit.sqft, marketingStatus: unit.marketing_status,
          // The row on the property's tenancy schedule this unit is.
          tenancy: tenancyQ.rows[0] ? { id: tenancyQ.rows[0].id, unitName: tenancyQ.rows[0].unit_name, status: tenancyQ.rows[0].status, tenant: tenancyQ.rows[0].tenant, leaseExpiry: iso(tenancyQ.rows[0].lease_expiry) } : null },
        unitDefaults: {
          quotingRentPa: unit.asking_rent ?? null, serviceChargePa: unit.service_charge_pa ?? null, ratesPayablePa: unit.rates_pa ?? null,
          permittedUse: unit.use_class || null, availableFrom: unit.available_date || null, ervPa: tenancyQ.rows[0]?.erv_pa ?? null,
        },
        people: peopleQ.rows.map((p: any) => personFor(p, access)),
        comments: commentsQ.rows.map(commentOf),
        approval: { ...approval, label: briefApprovalLabel(approval) },
        files: filesQ.rows.map((f: any) => ({ id: f.id, name: f.file_name, url: f.file_path, category: f.category, mimeType: f.mime_type, createdAt: iso(f.created_at) })),
        plans: plansQ.rows.map((p: any) => ({ id: p.id, floor: p.floor, source: p.source, imageUrl: `/api/plans/${p.id}/image`, attached: planIds.has(p.id) })),
        brochures: brochuresQ.rows.map((b: any) => ({ id: b.id, name: b.original_name, type: b.type, url: `/api/properties/${brief.property_id}/brochures/${b.id}/file`, attached: brochureIds.has(b.id) })),
        viewer,
      };
      res.json(out);
    } catch (e: any) {
      console.error("[unit-brief workspace]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to load the brief" });
    }
  });

  // Save the brief's fields, commercials, attached plans and brochures.
  app.patch("/api/unit-briefs/:id", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Your login can comment on and agree the brief, not change it" });
      const r = await saveBriefFields(brief.id, req.body || {}, access);
      if (!r.ok) return res.status(r.status).json({ message: r.message });
      if (r.termsChanged) await refreshAgreed(brief.id);
      res.json({ ...briefForViewer(briefJson(r.brief), access), termsChanged: r.termsChanged });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to save the brief" });
    }
  });

  // Who can be added: BGP staff, the client's people, and agent firms.
  app.get("/api/unit-briefs/:id/people-candidates", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Your login cannot change who is on the brief" });
      // A joint agent adds the client's people and joint agents. BGP's own
      // agents are picked by BGP from its staff list, which is not theirs to see.
      const jointAgent = access.landsecRole === "joint_agent";
      const { clientId, clientName, client } = await briefClientCandidates(brief, access);

      // BGP: every active staff login for staff; for a client login, the BGP
      // people on its account only (the same rule as the user directory); for
      // a joint agent, no one.
      let bgp: BriefPeopleCandidates["bgp"] = [];
      if (!jointAgent) {
        const staff = (await pool.query(
          `SELECT id, name, email FROM users WHERE COALESCE(is_active, true) AND lower(email) LIKE $1 AND COALESCE(role, '') <> 'Client' ORDER BY name`, [`%${BGP_EMAIL_DOMAIN}`])).rows;
        const visible = access.scope && !access.isStaff ? await getClientVisibleUserIds(access.scope) : null;
        bgp = staff.filter((u: any) => !visible || visible.has(u.id)).map((u: any) => ({ userId: u.id, name: u.name, email: visible ? null : u.email }));
      }

      // The client's people: its logins, and its CRM contacts. A joint agent
      // is offered the people for this brief's scheme only, by name and role,
      // with no email addresses.
      if (jointAgent) for (const c of client) c.email = null;

      // Agent firms: the firm names for everyone; the firm's named people
      // for BGP staff only (they are BGP's CRM contacts).
      const firms = (await pool.query(
        `SELECT id, name FROM crm_companies WHERE company_type ILIKE 'agent%' AND archived_at IS NULL ORDER BY name LIMIT 1000`).catch(() =>
        pool.query(`SELECT id, name FROM crm_companies WHERE company_type ILIKE 'agent%' ORDER BY name LIMIT 1000`))).rows;
      let firmContacts: any[] = [];
      if (access.isStaff && firms.length) {
        firmContacts = (await pool.query(`SELECT id, company_id, name, role, email FROM crm_contacts WHERE company_id = ANY($1) AND COALESCE(name, '') <> '' ORDER BY name`, [firms.map((f: any) => f.id)])).rows;
      }
      const out: BriefPeopleCandidates = {
        bgp, client, clientCompany: { id: clientId, name: clientName },
        agentFirms: firms.map((f: any) => ({ companyId: f.id, name: f.name, contacts: firmContacts.filter((c: any) => c.company_id === f.id).map((c: any) => ({ contactId: c.id, name: c.name, role: c.role, email: c.email })) })),
      };
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load the people list" });
    }
  });

  // Add a person to the brief. Who a person IS comes from the records, never
  // from the request: a login's name and email are the login's own, a CRM
  // contact's are the contact's. A BGP agent is a BGP staff login. A client
  // login may add only people it is allowed to know about: its own company's
  // logins and contacts, the BGP people on its account, an agent firm by
  // name, or someone typed in by name.
  app.post("/api/unit-briefs/:id/people", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Your login cannot change who is on the brief" });
      const b = req.body || {};
      const role = String(b.role || "");
      if (!BRIEF_PERSON_ROLES.some(r => r.key === role)) return res.status(400).json({ message: "Pick what this person is on the brief" });
      // A joint agent adds the client's people and joint agents; BGP's own
      // agents are added and removed by BGP.
      if (role === "bgp_agent" && access.landsecRole === "joint_agent") return res.status(403).json({ message: "BGP's agents are added and removed by BGP" });
      const clientCaller = !access.isStaff;
      const clientCompanyId: string | null = clientCaller ? access.scope : brief.client_company_id || null;
      let name = txt(b.name), email = txt(b.email), firm = txt(b.firm);
      let userId = txt(b.userId), contactId = txt(b.contactId), companyId = txt(b.companyId);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "That email address does not look right" });
      if ((name && name.length > 200) || (email && email.length > 200) || (firm && firm.length > 200)) return res.status(400).json({ message: "That is too long" });

      // A typed email that belongs to a login is that login. Not for a joint
      // agent: an address they type stays as typed, so it never tells them
      // whose login it is. Their own address is their own login.
      const jointAgent = access.landsecRole === "joint_agent";
      if (!userId && !contactId && email && !jointAgent) userId = (await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) AND COALESCE(is_active, true) LIMIT 1`, [email])).rows[0]?.id || null;
      if (jointAgent) {
        if (!userId && !contactId && sameEmail(email, access.email)) userId = access.userId;
        if (userId && userId === access.userId) {
          // A joint agent is on a brief as a joint agent, never as the client.
          if (role !== "joint_agent") return res.status(403).json({ message: "Your login can be on the brief only as a joint agent" });
        } else if (userId || contactId) {
          // By id, only the people the picker offers them for this scheme.
          const offered = (await briefClientCandidates(brief, access)).client;
          if ((userId && !offered.some(c => c.userId === userId)) || (!userId && contactId && !offered.some(c => c.contactId === contactId))) {
            return res.status(400).json({ message: "Pick the person from the list for this scheme, or type their name" });
          }
        } else if (email && email.toLowerCase().endsWith(BGP_EMAIL_DOMAIN)) {
          return res.status(403).json({ message: "BGP's agents are added and removed by BGP" });
        }
      }

      if (userId) {
        const u = (await pool.query(`SELECT id, name, email, role, team FROM users WHERE id = $1 AND COALESCE(is_active, true)`, [userId])).rows[0];
        if (!u) return res.status(400).json({ message: "That login was not found" });
        // Checked before anything is said about the login, so a typed email
        // does not tell a client login whose it is.
        if (clientCaller) {
          const visible = await getClientVisibleUserIds(access.scope);
          if (!visible.has(u.id) && u.id !== access.userId) return res.status(400).json({ message: "That person is not on your account" });
        }
        const isBgpLogin = String(u.email || "").toLowerCase().endsWith(BGP_EMAIL_DOMAIN) && u.role !== "Client";
        if (role === "bgp_agent" && !isBgpLogin) return res.status(400).json({ message: "A BGP agent on the brief is someone at BGP" });
        if (role !== "bgp_agent" && isBgpLogin) return res.status(400).json({ message: access.landsecRole === "joint_agent" ? "That person is at BGP. BGP's agents are added and removed by BGP." : `${u.name || "That person"} is at BGP: add them as a BGP agent` });
        // The login's own name and email, whatever the request said.
        name = u.name || u.email; email = u.email || null;
        if (role === "bgp_agent") { firm = "BGP"; companyId = null; }
        contactId = null;
      } else if (role === "bgp_agent") {
        return res.status(400).json({ message: "Pick the BGP agent from the list" });
      }
      if (contactId) {
        const c = (await pool.query(`SELECT c.id, c.name, c.email, c.company_id, co.name AS company_name, co.company_type FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE c.id = $1`, [contactId])).rows[0];
        if (!c) return res.status(400).json({ message: "That contact was not found" });
        if (clientCaller && c.company_id !== clientCompanyId) return res.status(400).json({ message: "That contact is not one of your company's people" });
        if (role === "joint_agent" && !/^agent/i.test(c.company_type || "")) return res.status(400).json({ message: "That contact is not at an agent firm" });
        name = c.name; email = c.email || null; companyId = c.company_id; firm = c.company_name || null;
      }
      if (role === "joint_agent" && companyId && !contactId) {
        // A firm picked from the list is an agent firm (also when the person
        // typed turned out to have a login).
        const co = (await pool.query(`SELECT name, company_type FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
        if (!co || !/^agent/i.test(co.company_type || "")) return res.status(400).json({ message: "Pick the joint agent's firm from the agents list, or type its name" });
        firm = co.name;
      }
      if (!name) return res.status(400).json({ message: "A name is needed" });
      if (role === "joint_agent" && !firm) return res.status(400).json({ message: "Name the joint agent's firm" });
      if (role !== "bgp_agent" && role !== "joint_agent") {
        // The client's people belong to the client.
        companyId = clientCompanyId;
        firm = clientCompanyId ? (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [clientCompanyId])).rows[0]?.name || null : brief.client_company || null;
      }
      // One person, once: the same login, the same email or (with neither) the same name is not added twice.
      const dupe = (await pool.query(
        `SELECT id, role FROM unit_brief_people WHERE brief_id = $1 AND (($2::text IS NOT NULL AND user_id = $2) OR ($3::text IS NOT NULL AND lower(email) = lower($3)) OR (role = $4 AND lower(name) = lower($5))) LIMIT 1`,
        [brief.id, userId, email, role, name])).rows[0];
      if (dupe) return res.status(409).json({ message: `${name} is already on the brief${dupe.role !== role ? ` as ${briefRoleLabel(dupe.role).toLowerCase()}` : " in that role"}` });
      const order = (await pool.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows[0].n;
      const row = (await pool.query(
        `INSERT INTO unit_brief_people (brief_id, role, user_id, contact_id, company_id, name, email, firm, sort_order, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [brief.id, role, userId, contactId, companyId, name, email, firm, order, access.name])).rows[0];
      const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows;
      await logEvent(brief.id, access, roleLabelFor(people, access), `added ${name} (${briefRoleLabel(role)}${firm && role === "joint_agent" ? `, ${firm}` : ""}) to the brief`);
      await refreshAgreed(brief.id);
      // A joint agent is not sent the email of a login or contact they
      // picked: the picker does not show it to them either.
      const added = personFor(row, access);
      res.json(jointAgent && (row.user_id || row.contact_id) && row.user_id !== access.userId ? { ...added, email: null } : added);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to add the person" });
    }
  });

  async function personAndAccess(req: Request, personId: string) {
    const person = (await pool.query(`SELECT * FROM unit_brief_people WHERE id = $1`, [personId])).rows[0];
    if (!person) return { person: null, brief: null, access: null };
    const brief = await loadBrief(person.brief_id);
    const access = brief ? await briefAccess(req, brief.property_id) : null;
    return { person, brief, access };
  }

  // Remove a person from the brief.
  app.delete("/api/unit-briefs/people/:personId", requireAuth, async (req, res) => {
    try {
      const { person, brief, access } = await personAndAccess(req, String(req.params.personId));
      if (!person || !brief) return res.status(404).json({ message: "Not found" });
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Your login cannot change who is on the brief" });
      if (person.role === "bgp_agent" && !access.isStaff) return res.status(403).json({ message: "BGP's agents are added and removed by BGP" });
      await pool.query(`DELETE FROM unit_brief_people WHERE id = $1`, [person.id]);
      const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows;
      await logEvent(brief.id, access, roleLabelFor(people, access), `removed ${person.name} (${briefRoleLabel(person.role)}) from the brief, ${person.agreed_at && person.agreed_version === (brief.version || 1) ? "who had agreed it" : "who had not agreed it"}`);
      await refreshAgreed(brief.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to remove the person" });
    }
  });

  // Agree the brief (or take the agreement back). A person agrees as
  // themselves; the agents running the letting (BGP staff, and a joint agent
  // on the scheme) may record an agreement given outside the app, and the
  // brief then says who recorded it.
  app.post("/api/unit-briefs/people/:personId/agree", requireAuth, async (req, res) => {
    try {
      const { person, brief, access } = await personAndAccess(req, String(req.params.personId));
      if (!person || !brief) return res.status(404).json({ message: "Not found" });
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      const isSelf = isSelfPerson(person, access);
      if (!isSelf && !access.agentControl) return res.status(403).json({ message: `Only ${person.name} can agree the brief as ${person.name}` });
      // An agreement is recorded only for someone with no login.
      if (!isSelf && person.user_id) return res.status(403).json({ message: `${person.name} has a login and agrees the brief themselves` });
      const withdraw = !!req.body?.withdraw;
      const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows;
      const label = roleLabelFor(people, access);
      if (withdraw) {
        if (!person.agreed_at) return res.json({ ok: true });
        await pool.query(`UPDATE unit_brief_people SET agreed_at = NULL, agreed_version = NULL, agreed_by_user_id = NULL, agreed_by_name = NULL, updated_at = NOW() WHERE id = $1`, [person.id]);
        await logEvent(brief.id, access, label, isSelf ? "withdrew their agreement to the brief" : `withdrew ${person.name}'s agreement to the brief`);
      } else {
        if (!hasBriefContent(brief)) return res.status(400).json({ message: "The brief is empty. Fill in the brief or the commercials before anyone agrees it." });
        // The version the signer saw must be the current one.
        const seen = Number(req.body?.version);
        if (!Number.isFinite(seen) || seen !== (brief.version || 1)) return res.status(409).json({ message: "The brief changed while you had it open. Read the latest version, then agree it." });
        // Already agreed on this version: the date given then is the date kept.
        if (person.agreed_at && person.agreed_version === (brief.version || 1)) return res.json(personFor(person, access));
        // A person matched by email is linked to their login here, so the
        // signature reads as their own.
        await pool.query(
          `UPDATE unit_brief_people SET agreed_at = NOW(), agreed_version = $2, agreed_by_user_id = $3, agreed_by_name = $4,
                  user_id = CASE WHEN $5::boolean THEN $3 ELSE user_id END, updated_at = NOW() WHERE id = $1`,
          [person.id, brief.version || 1, access.userId, access.name, !!isSelf]);
        await logEvent(brief.id, access, label, isSelf ? "agreed the brief" : `recorded that ${person.name} (${briefRoleLabel(person.role)}) agreed the brief`);
      }
      await refreshAgreed(brief.id);
      const after = (await pool.query(`SELECT * FROM unit_brief_people WHERE id = $1`, [person.id])).rows[0];
      res.json(personFor(after, access));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to record the agreement" });
    }
  });

  // Add a comment. Anyone who can open the brief can comment; it is shown
  // with their name, what they are on the brief, and the date.
  app.post("/api/unit-briefs/:id/comments", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      const body = txt(req.body?.body);
      if (!body) return res.status(400).json({ message: "Write a comment first" });
      if (body.length > 8000) return res.status(400).json({ message: "That comment is too long" });
      const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows;
      const row = (await pool.query(
        `INSERT INTO unit_brief_comments (brief_id, user_id, user_name, role_label, kind, body, ai_assisted) VALUES ($1, $2, $3, $4, 'comment', $5, $6) RETURNING *`,
        [brief.id, access.userId, access.name, roleLabelFor(people, access), body, !!req.body?.aiAssisted])).rows[0];
      res.json(commentOf(row));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to save the comment" });
    }
  });

  async function commentAndAccess(req: Request, commentId: string) {
    const comment = (await pool.query(`SELECT * FROM unit_brief_comments WHERE id = $1`, [commentId])).rows[0];
    if (!comment) return { comment: null, access: null };
    const brief = await loadBrief(comment.brief_id);
    const access = brief ? await briefAccess(req, brief.property_id) : null;
    return { comment, access };
  }

  // Edit your own comment.
  app.patch("/api/unit-briefs/comments/:commentId", requireAuth, async (req, res) => {
    try {
      const { comment, access } = await commentAndAccess(req, String(req.params.commentId));
      if (!comment) return res.status(404).json({ message: "Not found" });
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (comment.kind !== "comment" || comment.user_id !== access.userId) return res.status(403).json({ message: "You can edit your own comments only" });
      const body = txt(req.body?.body);
      if (!body) return res.status(400).json({ message: "A comment cannot be empty. Delete it instead." });
      if (body.length > 8000) return res.status(400).json({ message: "That comment is too long" });
      const row = (await pool.query(`UPDATE unit_brief_comments SET body = $2, ai_assisted = (ai_assisted OR $3), updated_at = NOW() WHERE id = $1 RETURNING *`, [comment.id, body, !!req.body?.aiAssisted])).rows[0];
      res.json(commentOf(row));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to save the comment" });
    }
  });

  // Delete your own comment (the timeline's own lines cannot be deleted).
  app.delete("/api/unit-briefs/comments/:commentId", requireAuth, async (req, res) => {
    try {
      const { comment, access } = await commentAndAccess(req, String(req.params.commentId));
      if (!comment) return res.status(404).json({ message: "Not found" });
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (comment.kind !== "comment" || comment.user_id !== access.userId) return res.status(403).json({ message: "You can delete your own comments only" });
      await pool.query(`DELETE FROM unit_brief_comments WHERE id = $1`, [comment.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to delete the comment" });
    }
  });

  // AI help with a person's own comment: drafts it from the brief, what the
  // person is on it, and any rough notes they typed. Nothing is saved; the
  // person edits the draft and saves it themselves.
  app.post("/api/unit-briefs/:id/comments/draft-ai", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      const notes = txt(req.body?.notes) || "";
      const [unitQ, peopleQ, commentsQ, targetsQ] = await Promise.all([
        pool.query(`SELECT au.unit_name, au.floor, au.sqft, p.name AS property_name FROM available_units au LEFT JOIN crm_properties p ON p.id = au.property_id WHERE au.id = $1`, [brief.unit_id]),
        pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id]),
        pool.query(`SELECT user_name, role_label, body FROM unit_brief_comments WHERE brief_id = $1 AND kind = 'comment' ORDER BY created_at DESC LIMIT 12`, [brief.id]),
        pool.query(`SELECT operator_name, category, priority FROM unit_target_operators WHERE brief_id = $1 ORDER BY sort_order LIMIT 30`, [brief.id]),
      ]);
      const { draftBriefComment } = await import("./unit-brief-doc");
      const draft = await draftBriefComment({
        roleLabel: roleLabelFor(peopleQ.rows, access), personName: access.name, notes,
        unit: unitQ.rows[0] || {}, brief: briefJson(brief),
        targets: targetsQ.rows, earlierComments: commentsQ.rows,
      });
      res.json({ body: draft });
    } catch (e: any) {
      if (/api ?key|authentication|not configured/i.test(e?.message || "")) return res.status(503).json({ message: "AI help is unavailable: the AI service is not configured" });
      res.status(500).json({ message: e?.message || "AI could not draft the comment" });
    }
  });

  // Add Brief: the one step that puts a unit on the tracker (with its
  // backing deal, through the letting service) and starts its brief. Used
  // by the Add brief button on the tracker; a unit already listed is
  // reused, and so is its brief. Safe to repeat: the whole step holds a
  // lock on the property and unit name, so two presses at once cannot make
  // two tracker rows or two briefs.
  app.post("/api/unit-briefs/start", requireAuth, async (req, res) => {
    const lock = await pool.connect();
    let locked = false;
    try {
      const b = req.body || {};
      let propertyId = txt(b.propertyId);
      let unitName = txt(b.unitName);
      const trackerUnitId = txt(b.trackerUnitId);
      const tenancyUnitId = txt(b.tenancyUnitId);
      let unit: any = null;
      if (trackerUnitId) {
        unit = await storage.getAvailableUnit(trackerUnitId);
        if (!unit) return res.status(404).json({ message: "That unit is not on the tracker" });
      }
      // A unit picked from the property's tenancy schedule: the brief's unit
      // IS that row. Its name and property come from the schedule, and the
      // tracker row is tied to it by id, not by matching names.
      let tenancy: any = null;
      if (!unit && tenancyUnitId) {
        tenancy = (await pool.query(
          `SELECT id, property_id, coalesce(nullif(trim(unit_number), ''), premises) AS unit_name, floor_level, coalesce(nia_sqft, gia_sqft) AS sqft
             FROM tenancy_schedule_units WHERE id = $1`, [tenancyUnitId])).rows[0];
        if (!tenancy || !tenancy.unit_name) return res.status(404).json({ message: "That unit is not on the tenancy schedule" });
        if (propertyId && propertyId !== tenancy.property_id) return res.status(400).json({ message: "That unit is on a different property's tenancy schedule" });
        propertyId = tenancy.property_id;
        unitName = String(tenancy.unit_name).trim();
      }
      const targetPropertyId = unit?.propertyId || propertyId;
      if (!targetPropertyId) return res.status(400).json({ message: "Pick the scheme or property" });
      const access = await briefAccess(req, targetPropertyId);
      if (!access) return res.status(403).json({ message: "That property is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Your login cannot start a brief" });
      if (!unit && !unitName) return res.status(400).json({ message: "Name the unit" });
      if (unitName && unitName.length > 200) return res.status(400).json({ message: "That unit name is too long" });
      const sqft = tenancy ? (tenancy.sqft ?? null) : b.sqft === "" || b.sqft === null || b.sqft === undefined ? null : Number(String(b.sqft).replace(/,/g, ""));
      if (sqft !== null && (!Number.isFinite(sqft) || sqft < 0 || sqft > 100_000_000)) return res.status(400).json({ message: "Size must be a number of square feet" });

      await lock.query("BEGIN");
      locked = true;
      await lock.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`unit_brief_start:${targetPropertyId}:${unit ? unit.id : unitName!.toLowerCase()}`]);

      const { statusSpellingsFor, TERMINAL_STATUSES } = await import("@shared/deal-status");
      let alreadyListed = !!unit;
      let dealRef: number | null = null;
      if (!unit && tenancy) {
        // The tracker row already tied to this tenancy schedule row, if any.
        const tied = (await pool.query(
          `SELECT id FROM available_units WHERE tenancy_unit_id = $1 AND lower(trim(coalesce(marketing_status, ''))) <> ALL($2::text[]) ORDER BY created_at LIMIT 1`,
          [tenancy.id, statusSpellingsFor(TERMINAL_STATUSES)])).rows[0];
        if (tied) { unit = await storage.getAvailableUnit(tied.id); alreadyListed = true; }
      }
      if (!unit) {
        // A live tracker row with exactly this name on the property is the
        // unit (the letting service's own guard skips one-character names).
        const live = (await pool.query(
          `SELECT id FROM available_units WHERE property_id = $1 AND lower(trim(unit_name)) = lower($2)
              AND lower(trim(coalesce(marketing_status, ''))) <> ALL($3::text[])
            ORDER BY created_at LIMIT 1`, [targetPropertyId, unitName, statusSpellingsFor(TERMINAL_STATUSES)])).rows[0];
        if (live) { unit = await storage.getAvailableUnit(live.id); alreadyListed = true; }
      }
      if (!unit) {
        const { createListing } = await import("./letting-service");
        const result = await createListing(
          { propertyId: targetPropertyId, unitName, floor: tenancy ? tenancy.floor_level || null : txt(b.floor), sqft, useClass: txt(b.useClass), marketingStatus: "Available",
            ...(tenancy ? { tenancyUnitId: tenancy.id } : {}) },
          { userId: access.userId, source: access.scope ? "client-add" : "add-unit", scope: access.scope },
        );
        if (result.kind === "already_listed") { alreadyListed = true; unit = await storage.getAvailableUnit(result.row.id); dealRef = result.row.deal_ref ?? null; }
        else { unit = result.unit; dealRef = (result.unit as any).dealRef ?? null; }
      }
      // Both ways: the tenancy schedule row points back at its tracker row.
      if (tenancy && unit) {
        await pool.query(`UPDATE available_units SET tenancy_unit_id = $2 WHERE id = $1 AND tenancy_unit_id IS NULL`, [unit.id, tenancy.id]);
        await pool.query(`UPDATE tenancy_schedule_units SET letting_tracker_unit_id = $1 WHERE id = $2 AND letting_tracker_unit_id IS NULL`, [unit.id, tenancy.id]);
      }
      if (dealRef === null && unit?.dealId) dealRef = (await pool.query(`SELECT deal_ref FROM crm_deals WHERE id = $1`, [unit.dealId])).rows[0]?.deal_ref ?? null;

      const started = await ensureBriefForUnit(unit, access, { title: txt(b.title) });
      // A joint agent's start is logged as a joint agent's, not the client's.
      if (started.created) await logEvent(started.brief.id, access, access.isStaff ? "BGP" : access.landsecRole === "joint_agent" ? "Joint agent" : access.scopeName || "Client", alreadyListed ? "started the brief" : "added the unit to the tracker and started the brief");
      await lock.query("COMMIT");
      locked = false;
      // A client login never receives BGP's fee or agent assignments; a joint
      // agent not the link to BGP's deal or to the tenant brand's CRM record either.
      const unitOut = !access.scope ? unit
        : access.landsecRole === "joint_agent" ? { ...unit, fee: null, agentUserIds: null, dealId: null, tenantCompanyId: null }
        : { ...unit, fee: null, agentUserIds: null };
      res.json({ unit: unitOut, briefId: started.brief.id, briefCreated: started.created, alreadyListed, dealRef });
    } catch (e: any) {
      if (locked) await lock.query("ROLLBACK").catch(() => undefined);
      if (e?.name === "ZodError") return res.status(400).json({ message: "Check the unit details", errors: e.errors });
      console.error("[unit-brief start]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to start the brief" });
    } finally {
      lock.release();
    }
  });
}
