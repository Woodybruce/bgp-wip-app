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
  normaliseCommercials, commercialsHaveContent,
  type BriefPerson, type BriefComment, type BriefViewer, type BriefWorkspace, type BriefPeopleCandidates,
} from "@shared/unit-brief";

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";

interface BriefAccess {
  userId: string | null;
  name: string | null;
  email: string | null;
  isStaff: boolean;          // a BGP login (also when viewing as a client)
  scope: string | null;      // the client company the request is scoped to
  scopeName: string | null;
  landsecRole: string | null; // asset_manager | joint_agent | leasing_manager | null
  canEditTerms: boolean;
}

// Who is asking, and may they open a brief on this property? Returns null
// when they may not. BGP staff reach every brief; a client login reaches
// briefs on its own properties; a Landsec asset manager or joint agent only
// on the schemes on their login, and a joint agent cannot change the terms.
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
    return isClient ? null : { ...base, canEditTerms: true };
  }
  if (!propertyId || !(await isPropertyInScope(scope, propertyId))) return null;
  base.scopeName = (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [scope])).rows[0]?.name || null;
  if (!isClient) return { ...base, canEditTerms: true };
  // A Landsec login by role and scheme (server/landsec-access.ts).
  const { landsecViewer, viewerCanSeeScheme } = await import("./landsec-access");
  const viewer = await landsecViewer(req).catch(() => null);
  if (viewer && viewer.schemes) {
    const { resolveLandsecPortfolio } = await import("./landsec-schemes");
    const portfolio = await resolveLandsecPortfolio(viewer.companyId);
    const scheme = portfolio.schemes.find(s => s.properties.some(p => p.id === propertyId));
    if (!scheme || !viewerCanSeeScheme(viewer, scheme.key)) return null;
  }
  const landsecRole = viewer && viewer.role !== "landsec" && viewer.role !== "bgp" ? viewer.role : null;
  return { ...base, landsecRole, canEditTerms: landsecRole !== "joint_agent" };
}

// The properties a restricted Landsec login may see briefs on (null = no
// extra restriction). For the brief list on the tracker.
export async function briefSchemePropertyIds(req: Request): Promise<Set<string> | null> {
  if (!(await isClientRequestUser(req))) return null;
  const { landsecViewer } = await import("./landsec-access");
  const viewer = await landsecViewer(req).catch(() => null);
  if (!viewer || !viewer.schemes) return null;
  const { resolveLandsecPortfolio } = await import("./landsec-schemes");
  const portfolio = await resolveLandsecPortfolio(viewer.companyId);
  const ids = new Set<string>();
  for (const s of portfolio.schemes) if (viewer.schemes.has(s.key)) for (const p of s.properties) ids.add(p.id);
  return ids;
}

// What a joint agent may not receive on a target operator: BGP's brand
// contacts, relationship notes and comment log (decided 2026-11-11).
export function targetForViewer(t: any, access: Pick<BriefAccess, "landsecRole">) {
  if (access.landsecRole !== "joint_agent") return t;
  return { ...t, existingRelationship: null, feedback: null, comments: null, clientContactId: null, agentUserIds: null };
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

function commentOf(r: any): BriefComment {
  return {
    id: r.id, briefId: r.brief_id, userId: r.user_id, userName: r.user_name, roleLabel: r.role_label,
    kind: r.kind === "event" ? "event" : "comment", body: r.body, aiAssisted: !!r.ai_assisted,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at),
  };
}

const sameEmail = (a: any, b: any) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// The people rows that ARE this login: linked by user id, or by the same
// email address.
function myPeople(people: any[], access: BriefAccess): any[] {
  return people.filter(p => (p.user_id && p.user_id === access.userId) || sameEmail(p.email, access.email));
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

// Sign-off is "agreed" when every person involved has agreed the current
// version. Keeps unit_briefs.agreed_at in step.
async function refreshAgreed(briefId: string): Promise<void> {
  const brief = await loadBrief(briefId);
  if (!brief) return;
  const people = (await pool.query(`SELECT agreed_at, agreed_version FROM unit_brief_people WHERE brief_id = $1`, [briefId])).rows;
  const a = briefApproval(brief.version || 1, people.map((p: any) => ({ agreedAt: p.agreed_at, agreedVersion: p.agreed_version })));
  if (a.state === "agreed") {
    await pool.query(`UPDATE unit_briefs SET agreed_at = COALESCE(agreed_at, (SELECT MAX(agreed_at) FROM unit_brief_people WHERE brief_id = $1)) WHERE id = $1`, [briefId]);
  } else {
    await pool.query(`UPDATE unit_briefs SET agreed_at = NULL WHERE id = $1 AND agreed_at IS NOT NULL`, [briefId]);
  }
}

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

  for (const key of BRIEF_TERM_FIELDS) {
    if (!(key in body)) continue;
    const col = camelToSnake(key);
    let next = txt(body[key]);
    if (key === "agencyBasis" && next && !["sole", "joint"].includes(next)) return { ok: false, status: 400, message: "Agency basis is sole or joint" };
    if ((brief[col] ?? null) !== next) { put(col, next); changed.push(key); }
  }
  if ("commercials" in body) {
    const { value, invalid } = normaliseCommercials(body.commercials);
    if (invalid.length) return { ok: false, status: 400, message: `Check the figure for: ${invalid.join(", ")}. Use numbers, for example 95000 or 95k.` };
    const before = normaliseCommercials(brief.commercials).value;
    if (JSON.stringify(before) !== JSON.stringify(value)) { put("commercials", JSON.stringify(value)); changed.push("commercials"); }
  }
  const termsChanged = changed.length > 0;

  // Not terms: targets and KPIs, the status, images, attached plans and brochures.
  for (const key of ["minTargets", "priorityTargets"] as const) {
    if (key in body) { const n = body[key] === null || body[key] === "" ? null : Number(body[key]); if (n !== null && !Number.isFinite(n)) return { ok: false, status: 400, message: `${key} must be a number` }; put(camelToSnake(key), n); }
  }
  if ("status" in body) {
    const s = txt(body.status);
    if (s && !["Active", "Complete", "Withdrawn"].includes(s)) return { ok: false, status: 400, message: "Status is Active, Complete or Withdrawn" };
    put("status", s || "Active");
  }
  if ("imageIds" in body) put("image_ids", Array.isArray(body.imageIds) ? body.imageIds.map(String) : null);
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
  const updated = (await pool.query(`UPDATE unit_briefs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params)).rows[0];

  const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [briefId])).rows;
  const label = roleLabelFor(people, access);
  if (termsChanged) {
    const signed = people.filter((p: any) => p.agreed_at && p.agreed_version === (brief.version || 1)).length;
    const what = changed.includes("commercials") && changed.length === 1 ? "the commercials" : changed.includes("commercials") ? "the brief and the commercials" : "the brief";
    await logEvent(briefId, access, label, `changed ${what}${signed ? `. ${signed === 1 ? "The signature" : `The ${signed} signatures`} already given ${signed === 1 ? "is" : "are"} on the earlier version, so sign-off starts again` : ""}`);
    // The tracker row carries the quoting rent, service charge and rates
    // (the tracker columns, the website and the brief PDF read them there).
    if (changed.includes("commercials")) {
      const c = normaliseCommercials(updated.commercials).value;
      await pool.query(
        `UPDATE available_units SET asking_rent = COALESCE($2, asking_rent), service_charge_pa = COALESCE($3, service_charge_pa), rates_pa = COALESCE($4, rates_pa), updated_at = NOW() WHERE id = $1`,
        [brief.unit_id, c.quotingRentPa, c.serviceChargePa, c.ratesPayablePa]
      ).catch((e: any) => console.warn("[unit-brief] tracker write-through failed:", e?.message));
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
    agencyBasis: b.agency_basis || null, commercials: normaliseCommercials(b.commercials).value,
    planIds: b.plan_ids || [], brochureIds: b.brochure_ids || [], version: b.version || 1,
    termsUpdatedAt: iso(b.terms_updated_at), termsUpdatedByName: b.terms_updated_by_name, agreedAt: iso(b.agreed_at),
    createdByUserId: b.created_by_user_id, createdByName: b.created_by_name, createdAt: iso(b.created_at), updatedAt: iso(b.updated_at),
  };
}

export function setupUnitBriefWorkspaceRoutes(app: Express) {
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
        pool.query(`SELECT id, file_name, file_path, category, mime_type, created_at FROM unit_marketing_files WHERE unit_id = $1 AND ($2::boolean OR COALESCE(file_type, 'upload') <> 'targeting_brief') ORDER BY sort_order ASC NULLS LAST, created_at`, [brief.unit_id, access.canEditTerms]),
        pool.query(`SELECT id, floor, source FROM property_plans WHERE property_id = $1 AND COALESCE(is_geo, false) = false ORDER BY display_order, floor`, [brief.property_id]).catch(() => ({ rows: [] as any[] })),
        pool.query(`SELECT id, original_name, type FROM property_brochures WHERE property_id = $1 AND COALESCE(archived, false) = false ORDER BY created_at DESC`, [brief.property_id]).catch(() => ({ rows: [] as any[] })),
        pool.query(`SELECT erv_pa FROM tenancy_schedule_units WHERE id = (SELECT tenancy_unit_id FROM available_units WHERE id = $1)`, [brief.unit_id]).catch(() => ({ rows: [] as any[] })),
      ]);
      const unit = unitQ.rows[0];
      if (!unit) return res.status(404).json({ message: "The brief's unit is no longer on the tracker" });
      const mine = myPeople(peopleQ.rows, access);
      const approval = briefApproval(brief.version || 1, peopleQ.rows.map((p: any) => ({ agreedAt: p.agreed_at, agreedVersion: p.agreed_version })));
      const viewer: BriefViewer = {
        userId: access.userId, name: access.name, isStaff: access.isStaff, canEditTerms: access.canEditTerms, canComment: true,
        personIds: mine.map((p: any) => p.id), roleLabel: roleLabelFor(peopleQ.rows, access),
      };
      const planIds = new Set<string>(brief.plan_ids || []);
      const brochureIds = new Set<string>(brief.brochure_ids || []);
      const out: BriefWorkspace = {
        brief: briefJson(brief) as any,
        unit: { id: unit.id, unitName: unit.unit_name, propertyId: unit.property_id, propertyName: unit.property_name, floor: unit.floor, sqft: unit.sqft, marketingStatus: unit.marketing_status },
        unitDefaults: {
          quotingRentPa: unit.asking_rent ?? null, serviceChargePa: unit.service_charge_pa ?? null, ratesPayablePa: unit.rates_pa ?? null,
          permittedUse: unit.use_class || null, availableFrom: unit.available_date || null, ervPa: tenancyQ.rows[0]?.erv_pa ?? null,
        },
        people: peopleQ.rows.map(personOf),
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
      if (!access.canEditTerms) return res.status(403).json({ message: "Joint agents can comment on and agree the brief, not change it" });
      const r = await saveBriefFields(brief.id, req.body || {}, access);
      if (!r.ok) return res.status(r.status).json({ message: r.message });
      if (r.termsChanged) await refreshAgreed(brief.id);
      res.json({ ...briefJson(r.brief), termsChanged: r.termsChanged });
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
      let clientId: string | null = brief.client_company_id || null;
      if (!clientId) clientId = (await pool.query(`SELECT landlord_id FROM crm_properties WHERE id = $1`, [brief.property_id])).rows[0]?.landlord_id || null;
      const clientName = clientId ? (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [clientId])).rows[0]?.name || null : brief.client_company || null;

      // BGP: every active staff login for staff; for a client login, the BGP
      // people on its account only (the same rule as the user directory).
      const staff = (await pool.query(
        `SELECT id, name, email FROM users WHERE COALESCE(is_active, true) AND lower(email) LIKE $1 AND COALESCE(role, '') <> 'Client' ORDER BY name`, [`%${BGP_EMAIL_DOMAIN}`])).rows;
      const visible = access.scope && !access.isStaff ? await getClientVisibleUserIds(access.scope) : null;
      const bgp = staff.filter((u: any) => !visible || visible.has(u.id)).map((u: any) => ({ userId: u.id, name: u.name, email: visible ? null : u.email }));

      // The client's people: its logins, and its CRM contacts.
      const client: BriefPeopleCandidates["client"] = [];
      if (clientId) {
        const logins = (await pool.query(
          `SELECT u.id, u.name, u.email, a.landsec_role FROM users u LEFT JOIN landsec_access a ON a.user_id = u.id
            WHERE COALESCE(u.is_active, true) AND u.role = 'Client' AND lower(u.team) = lower($1) AND COALESCE(a.landsec_role, '') <> 'joint_agent' ORDER BY u.name`, [clientName || ""]).catch(() => ({ rows: [] as any[] }))).rows;
        for (const u of logins) client.push({ contactId: null, userId: u.id, name: u.name || u.email, role: u.landsec_role === "asset_manager" ? "Asset manager (login)" : "Login", email: u.email });
        const contacts = (await pool.query(`SELECT id, name, role, email FROM crm_contacts WHERE company_id = $1 AND COALESCE(name, '') <> '' ORDER BY name LIMIT 400`, [clientId])).rows;
        for (const c of contacts) {
          const dupe = client.find(x => sameEmail(x.email, c.email) || x.name.trim().toLowerCase() === String(c.name).trim().toLowerCase());
          if (dupe) { dupe.contactId = c.id; if (c.role) dupe.role = c.role; continue; }
          client.push({ contactId: c.id, userId: null, name: c.name, role: c.role, email: c.email });
        }
      }

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

  // Add a person to the brief.
  app.post("/api/unit-briefs/:id/people", requireAuth, async (req, res) => {
    try {
      const brief = await loadBrief(String(req.params.id));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const access = await briefAccess(req, brief.property_id);
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Joint agents cannot change who is on the brief" });
      const b = req.body || {};
      const role = String(b.role || "");
      if (!BRIEF_PERSON_ROLES.some(r => r.key === role)) return res.status(400).json({ message: "Pick what this person is on the brief" });
      let name = txt(b.name), email = txt(b.email), firm = txt(b.firm);
      let userId = txt(b.userId), contactId = txt(b.contactId), companyId = txt(b.companyId);
      if (userId) {
        const u = (await pool.query(`SELECT name, email, role, team FROM users WHERE id = $1`, [userId])).rows[0];
        if (!u) return res.status(400).json({ message: "That login was not found" });
        name = name || u.name || u.email; email = email || u.email;
        if (role === "bgp_agent") firm = "BGP";
      }
      if (contactId) {
        const c = (await pool.query(`SELECT c.name, c.email, c.company_id, co.name AS company_name FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id WHERE c.id = $1`, [contactId])).rows[0];
        if (!c) return res.status(400).json({ message: "That contact was not found" });
        name = name || c.name; email = email || c.email; companyId = companyId || c.company_id; firm = firm || c.company_name;
      }
      if (companyId && !firm) firm = (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId])).rows[0]?.name || null;
      if (!name) return res.status(400).json({ message: "A name is needed" });
      if (role !== "bgp_agent" && role !== "joint_agent" && !firm) firm = brief.client_company || null;
      // The same person twice in the same role is a mistake, not a second signature.
      const dupe = (await pool.query(
        `SELECT id FROM unit_brief_people WHERE brief_id = $1 AND role = $2 AND (($3::text IS NOT NULL AND user_id = $3) OR ($4::text IS NOT NULL AND lower(email) = lower($4)) OR lower(name) = lower($5)) LIMIT 1`,
        [brief.id, role, userId, email, name])).rows[0];
      if (dupe) return res.status(409).json({ message: `${name} is already on the brief in that role` });
      // A login that matches the email is linked, so that person can sign for themselves.
      if (!userId && email) userId = (await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) AND COALESCE(is_active, true) LIMIT 1`, [email])).rows[0]?.id || null;
      const order = (await pool.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows[0].n;
      const row = (await pool.query(
        `INSERT INTO unit_brief_people (brief_id, role, user_id, contact_id, company_id, name, email, firm, sort_order, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [brief.id, role, userId, contactId, companyId, name, email, firm, order, access.name])).rows[0];
      if (role === "joint_agent" && brief.agency_basis !== "joint") await pool.query(`UPDATE unit_briefs SET agency_basis = 'joint', updated_at = NOW() WHERE id = $1`, [brief.id]);
      const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows;
      await logEvent(brief.id, access, roleLabelFor(people, access), `added ${name} (${briefRoleLabel(role)}${firm && role === "joint_agent" ? `, ${firm}` : ""}) to the brief`);
      await refreshAgreed(brief.id);
      res.json(personOf(row));
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
      if (!access.canEditTerms) return res.status(403).json({ message: "Joint agents cannot change who is on the brief" });
      await pool.query(`DELETE FROM unit_brief_people WHERE id = $1`, [person.id]);
      const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1`, [brief.id])).rows;
      await logEvent(brief.id, access, roleLabelFor(people, access), `removed ${person.name} (${briefRoleLabel(person.role)}) from the brief${person.agreed_at ? ", who had agreed it" : ""}`);
      await refreshAgreed(brief.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to remove the person" });
    }
  });

  // Agree the brief (or take the agreement back). A person agrees as
  // themselves; BGP staff may record an agreement given outside the app,
  // and the brief then says who recorded it.
  app.post("/api/unit-briefs/people/:personId/agree", requireAuth, async (req, res) => {
    try {
      const { person, brief, access } = await personAndAccess(req, String(req.params.personId));
      if (!person || !brief) return res.status(404).json({ message: "Not found" });
      if (!access) return res.status(403).json({ message: "This brief is outside your access" });
      const isSelf = (person.user_id && person.user_id === access.userId) || sameEmail(person.email, access.email);
      if (!isSelf && !access.isStaff) return res.status(403).json({ message: `Only ${person.name} can agree the brief as ${person.name}` });
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
      res.json(personOf(after));
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
  // reused, and so is its brief.
  app.post("/api/unit-briefs/start", requireAuth, async (req, res) => {
    try {
      const b = req.body || {};
      const propertyId = txt(b.propertyId);
      let unitName = txt(b.unitName);
      const trackerUnitId = txt(b.trackerUnitId);
      let unit: any = null;
      if (trackerUnitId) {
        unit = await storage.getAvailableUnit(trackerUnitId);
        if (!unit) return res.status(404).json({ message: "That unit is not on the tracker" });
      }
      const targetPropertyId = unit?.propertyId || propertyId;
      if (!targetPropertyId) return res.status(400).json({ message: "Pick the scheme or property" });
      const access = await briefAccess(req, targetPropertyId);
      if (!access) return res.status(403).json({ message: "That property is outside your access" });
      if (!access.canEditTerms) return res.status(403).json({ message: "Joint agents cannot start a brief" });
      let alreadyListed = !!unit;
      let dealRef: number | null = null;
      if (!unit) {
        if (!unitName) return res.status(400).json({ message: "Name the unit" });
        const { createListing } = await import("./letting-service");
        const sqft = b.sqft === "" || b.sqft === null || b.sqft === undefined ? null : Number(String(b.sqft).replace(/,/g, ""));
        if (sqft !== null && !Number.isFinite(sqft)) return res.status(400).json({ message: "Size must be a number of square feet" });
        const result = await createListing(
          { propertyId: targetPropertyId, unitName, floor: txt(b.floor), sqft, useClass: txt(b.useClass), marketingStatus: "Available" },
          { userId: access.userId, source: access.scope ? "client-add" : "add-unit", scope: access.scope },
        );
        if (result.kind === "already_listed") { alreadyListed = true; unit = await storage.getAvailableUnit(result.row.id); dealRef = result.row.deal_ref ?? null; }
        else { unit = result.unit; dealRef = (result.unit as any).dealRef ?? null; }
      }
      let brief = (await pool.query(`SELECT * FROM unit_briefs WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 1`, [unit.id])).rows[0];
      let briefCreated = false;
      if (!brief) {
        const prop = (await pool.query(`SELECT p.name, p.landlord_id, c.name AS landlord_name FROM crm_properties p LEFT JOIN crm_companies c ON c.id = p.landlord_id WHERE p.id = $1`, [unit.propertyId])).rows[0];
        brief = (await pool.query(
          `INSERT INTO unit_briefs (unit_id, property_id, client_company, client_company_id, title, instructed_date, version, created_by_user_id, created_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8) RETURNING *`,
          [unit.id, unit.propertyId, prop?.landlord_name || null, prop?.landlord_id || null,
           txt(b.title) || `Targeting Brief: ${unit.unitName}${prop?.name ? `, ${prop.name}` : ""}`, new Date().toISOString().slice(0, 10), access.userId, access.name])).rows[0];
        briefCreated = true;
        await logEvent(brief.id, access, access.isStaff ? "BGP" : access.scopeName || "Client", alreadyListed ? "started the brief" : "added the unit to the tracker and started the brief");
      }
      res.json({ unit, briefId: brief.id, briefCreated, alreadyListed, dealRef });
    } catch (e: any) {
      if (e?.name === "ZodError") return res.status(400).json({ message: "Check the unit details", errors: e.errors });
      console.error("[unit-brief start]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to start the brief" });
    }
  });
}
