import type { Express, Request } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { resolveCompanyScope, isPropertyInScope, isClientVisibleBrand, clientBrandSliceSql, getClientVisibleUserIds } from "./company-scope";
import { calendarDateValue } from "../shared/calendar-date";
import { VIEWING_STATUSES, VIEWING_OUTCOMES, viewingMissingDetails, type ViewingRecord } from "../shared/viewing-workflow";
import { buildViewingReport } from "../shared/viewing-report";
import { reconcileViewingFollowup } from "./viewing-followups";

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
  nextAction: z.string().max(2000).nullable().optional(), followUpDate: day.nullable().optional(),
  confirmDetails: z.boolean().optional(), expectedUpdatedAt: z.string().datetime().optional(),
}).strict();
const toCamel = (row: any): any => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v instanceof Date ? v.toISOString() : v]));
const callerId = (req: Request): string => (req as any).session?.userId || (req as any).tokenUserId;
const todayLondon = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const scopeSql = `($1::text IS NULL OR p.landlord_id = $1 OR EXISTS (SELECT 1 FROM crm_company_properties cp WHERE cp.property_id=p.id AND cp.company_id=$1))`;
const selectViewings = `SELECT v.*, au.property_id, p.name AS property_name, au.unit_name, au.sqft,
  COALESCE(au.unit_id, au.tenancy_unit_id, au.id) AS physical_unit_id,
  co.name AS brand_name, ct.name AS brand_contact_name, ac.name AS agent_contact_name,
  u.name AS owner_name, u.team, r.name AS requirement_name
  FROM unit_viewings v LEFT JOIN available_units au ON au.id=v.unit_id
  LEFT JOIN crm_properties p ON p.id=au.property_id
  LEFT JOIN crm_companies co ON co.id=v.company_id
  LEFT JOIN crm_contacts ct ON ct.id=v.contact_id LEFT JOIN crm_contacts ac ON ac.id=v.agent_contact_id
  LEFT JOIN users u ON u.id=v.owner_user_id LEFT JOIN crm_requirements_leasing r ON r.id=v.requirement_id`;

export function serializeViewingForScope<T extends Record<string, any>>(record: T, scoped: boolean): T {
  if (!scoped) return record;
  const result: Record<string, any> = { ...record };
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

export function projectViewing(row: any, scoped = false): ViewingRecord {
  const v = toCamel(row);
  v.companyName = v.brandName || v.companyName;
  v.contactName = v.brandContactName || v.contactName;
  v.issues = viewingMissingDetails(v);
  if (!v.detailsConfirmedAt) {
    const sourceIssues = Array.isArray(v.sourceDetails?.issues) ? v.sourceDetails.issues.filter((s: unknown) => typeof s === "string") : [];
    v.issues = [...new Set([...v.issues, ...sourceIssues, "Confirm the viewing details"] )];
  }
  delete v.brandName; delete v.brandContactName;
  return serializeViewingForScope(v, scoped);
}

export async function listLeasingViewings(scope: string | null): Promise<ViewingRecord[]> {
  const { rows } = await pool.query(`${selectViewings} WHERE v.deleted_at IS NULL AND ${scopeSql} ORDER BY v.viewing_date DESC, v.viewing_time, v.id`, [scope]);
  return rows.map(row => projectViewing(row, !!scope));
}

async function getLockedViewing(db: PoolClient, id: string, scope: string | null) {
  const row = (await db.query(`SELECT * FROM unit_viewings WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
  if (!row) throw new ViewingError(404, "Viewing not found");
  await assertViewingUnit(db, row.unit_id, scope);
  return row;
}

async function assertViewingUnit(db: PoolClient, unitId: string | null, scope: string | null) {
  if (!unitId) {
    if (scope) throw new ViewingError(403, "Unmatched diary bookings are only visible to BGP staff");
    return null;
  }
  const unit = (await db.query(`SELECT * FROM available_units WHERE id=$1`, [unitId])).rows[0];
  if (!unit) throw new ViewingError(404, "Tracker unit not found");
  if (scope && !(await isPropertyInScope(scope, unit.property_id))) throw new ViewingError(403, "Unit is outside your portfolio");
  return unit;
}

async function validateLinks(db: PoolClient, value: any, scope: string | null, existing?: any) {
  await assertViewingUnit(db, value.unitId, scope);
  let brand = null, contact = null;
  if (value.companyId) {
    brand = (await db.query(`SELECT id,name,company_type FROM crm_companies WHERE id=$1 AND merged_into_id IS NULL`, [value.companyId])).rows[0];
    if (!brand || !/^tenant(?:\s|-|$)/i.test(brand.company_type || "")) throw new ViewingError(400, "Choose the brand being represented, rather than the agent's employer");
    if (scope && value.companyId !== existing?.companyId && !(await isClientVisibleBrand(value.companyId, scope))) throw new ViewingError(403, "Brand is outside your CRM");
  }
  if (value.contactId) {
    contact = (await db.query(`SELECT id,name,company_id FROM crm_contacts WHERE id=$1`, [value.contactId])).rows[0];
    if (!contact || !value.companyId || contact.company_id !== value.companyId) throw new ViewingError(400, "Choose a contact at this brand; use Representing agent for their agent");
  }
  if (value.agentContactId) {
    const agent = (await db.query(`SELECT id FROM crm_contacts WHERE id=$1`, [value.agentContactId])).rows[0];
    if (!agent) throw new ViewingError(400, "Agent contact not found");
    if (scope && (value.agentContactId !== existing?.agentContactId || value.companyId !== existing?.companyId)) {
      const eligible = await db.query(`SELECT 1 FROM brand_agent_representations ar WHERE ar.brand_company_id=$1 AND ar.primary_contact_id=$2
        AND ar.agent_type='tenant_rep' AND (ar.start_date IS NULL OR ar.start_date<=now()) AND ar.end_date IS NULL
        UNION ALL SELECT 1 FROM crm_requirements_leasing r WHERE r.company_id=$1 AND r.agent_contact_id=$2
        AND (r.status IS NULL OR btrim(r.status)='' OR lower(r.status)='active') LIMIT 1`, [value.companyId, value.agentContactId]);
      if (!eligible.rows.length) throw new ViewingError(403, "Choose an agent linked to this brand in your CRM");
    }
  }
  if (value.ownerUserId && value.ownerUserId !== existing?.ownerUserId) {
    const owner = await db.query(`SELECT id FROM users WHERE id=$1 AND is_active IS NOT FALSE AND email ILIKE '%@brucegillinghampollard.com'`, [value.ownerUserId]);
    if (!owner.rows.length) throw new ViewingError(400, "Choose an active BGP owner");
    if (scope && !(await getClientVisibleUserIds(scope)).has(value.ownerUserId)) throw new ViewingError(403, "Choose a member of your BGP team");
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

export async function patchLeasingViewing(req: Request, id: string, body: unknown) {
  const input = patchSchema.safeParse(body);
  if (!input.success) throw new ViewingError(400, input.error.issues.map(i => i.message).join("; "));
  const patch = input.data;
  const scope = await resolveCompanyScope(req);
  const saved = await transaction(async db => {
    const old = await getLockedViewing(db, id, scope);
    if (patch.expectedUpdatedAt && new Date(old.updated_at).getTime() !== new Date(patch.expectedUpdatedAt).getTime()) {
      throw new ViewingError(409, "This viewing changed. Refresh it before saving your changes.");
    }
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
    if (patch.confirmDetails && !terminal && viewingMissingDetails(value).length) throw new ViewingError(400, viewingMissingDetails(value).join("; "));
    if (value.status === "completed") {
      if (!value.outcome?.trim()) throw new ViewingError(400, "Choose the viewing outcome");
      if (!calendarDateValue(value.viewingDate) || value.viewingDate > todayLondon()) throw new ViewingError(400, "A future viewing cannot be reported as completed");
    }
    const identityChanged = ["unitId", "companyId", "contactId", "agentContactId", "ownerUserId", "viewingDate", "viewingTime"].some(k => k in patch && (patch as any)[k] !== toCamel(old)[k]);
    const confirmed = terminal ? old.details_confirmed_at : patch.confirmDetails ? new Date() : identityChanged ? null : old.details_confirmed_at;
    const recorded = "status" in patch || "outcome" in patch;
    const result = await db.query(`UPDATE unit_viewings SET unit_id=$2, company_id=$3, company_name=$4,
      contact_id=$5, contact_name=$6, agent_contact_id=$7, owner_user_id=$8, requirement_id=$9,
      viewing_date=$10, viewing_time=$11, status=$12, outcome=$13, notes=$14, next_action=$15, follow_up_date=$16,
      details_confirmed_at=$17, outcome_recorded_at=$18, outcome_by_user_id=$19, updated_at=clock_timestamp(),
      source_details=CASE WHEN $20 THEN COALESCE(source_details,'{}'::jsonb)||'{"issues":[]}'::jsonb ELSE source_details END
      WHERE id=$1 RETURNING *`, [id, value.unitId, value.companyId, brand?.name || (value.companyId ? value.companyName : null),
      value.contactId, contact?.name || null, value.agentContactId, value.ownerUserId, value.requirementId,
      value.viewingDate, value.viewingTime, value.status, value.outcome, value.notes, value.nextAction, value.followUpDate,
      confirmed, recorded ? new Date() : old.outcome_recorded_at, recorded ? callerId(req) : old.outcome_by_user_id, !!patch.confirmDetails]);
    return projectViewing(result.rows[0], !!scope);
  });
  await reconcileViewingFollowup(id).catch(e => console.warn("[viewing-followup] reconcile deferred:", e.message));
  return saved;
}

// The legacy tracker dialog uses the same service, so reports never become a separate data island.
export async function createTrackerViewing(req: Request, unitId: string, body: any) {
  const scope = await resolveCompanyScope(req);
  const date = day.safeParse(body.viewingDate);
  if (!date.success) throw new ViewingError(400, "Set a valid viewing date");
  if (body.viewingTime && !time.safeParse(body.viewingTime).success) throw new ViewingError(400, "Set a valid viewing time");
  return transaction(async db => {
    await assertViewingUnit(db, unitId, scope);
    const value = { unitId, companyId: body.companyId || null, contactId: body.contactId || null,
      agentContactId: body.agentContactId || null, ownerUserId: body.ownerUserId || (scope ? null : callerId(req)),
      requirementId: body.requirementId || null, viewingDate: date.data, viewingTime: body.viewingTime || null };
    const { brand, contact } = await validateLinks(db, value, scope);
    const outcome = String(body.outcome || "").trim();
    const status = body.status ?? (outcome === "No Show" ? "no_show" : outcome ? "completed" : "scheduled");
    if (!z.enum(VIEWING_STATUSES).safeParse(status).success) throw new ViewingError(400, "Choose a valid viewing status");
    if (outcome && outcome !== "No Show" && !(VIEWING_OUTCOMES as readonly string[]).includes(outcome)) throw new ViewingError(400, "Choose a valid outcome");
    if ((outcome || status === "completed" || status === "no_show") && date.data > todayLondon()) throw new ViewingError(400, "A future viewing cannot have an outcome");
    if (status === "completed" && !outcome) throw new ViewingError(400, "Choose the viewing outcome");
    if (body.followUpDate && !day.safeParse(body.followUpDate).success) throw new ViewingError(400, "Set a valid follow-up date");
    const result = await db.query(`INSERT INTO unit_viewings
      (unit_id,company_id,company_name,contact_id,contact_name,agent_contact_id,owner_user_id,requirement_id,
       viewing_date,viewing_time,attendees,notes,outcome,status,details_confirmed_at,outcome_recorded_at,outcome_by_user_id,next_action,follow_up_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [unitId,value.companyId,brand?.name || body.companyName || null,value.contactId,contact?.name || body.contactName || null,
      value.agentContactId,value.ownerUserId,value.requirementId,value.viewingDate,value.viewingTime,
      String(body.attendees || "").slice(0,10000) || null,String(body.notes || "").slice(0,20000) || null,
      outcome === "No Show" ? null : outcome || null,status,
      viewingMissingDetails(value).length ? null : new Date(),outcome ? new Date() : null,outcome ? callerId(req) : null,
      String(body.nextAction || "").slice(0,2000) || null,body.followUpDate || null]);
    return toCamel(result.rows[0]);
  });
}

export async function deleteTrackerViewing(req: Request, id: string) {
  const scope = await resolveCompanyScope(req);
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
  return transaction(db => lockedViewingOfferFields(db, unitId, viewingId, scope));
}

export async function createTrackerOffer(req: Request, unitId: string, body: any) {
  const scope = await resolveCompanyScope(req);
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { unitOffers, insertUnitOfferSchema } = await import("@shared/schema");
  return transaction(async db => {
    await assertViewingUnit(db, unitId, scope);
    const linked = body.viewingId ? await lockedViewingOfferFields(db, unitId, body.viewingId, scope) : {};
    const parsed = insertUnitOfferSchema.safeParse({ ...body, unitId, ...linked, confirmedAt: new Date() });
    if (!parsed.success) throw new ViewingError(400, parsed.error.issues.map(issue => issue.message).join("; "));
    const [offer] = await drizzle(db).insert(unitOffers).values(parsed.data).returning();
    return offer;
  });
}

export async function patchTrackerOffer(req: Request, offerId: string, body: any) {
  const scope = await resolveCompanyScope(req);
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { eq } = await import("drizzle-orm");
  const { unitOffers, insertUnitOfferSchema } = await import("@shared/schema");
  return transaction(async db => {
    const snapshot = (await db.query(`SELECT unit_id,viewing_id FROM unit_offers WHERE id=$1`, [offerId])).rows[0];
    if (!snapshot) throw new ViewingError(404, "Offer not found");
    await assertViewingUnit(db, snapshot.unit_id, scope);
    // Use the same viewing → offer lock order as the confirmation endpoint.
    const linked = snapshot.viewing_id ? await lockedViewingOfferFields(db, snapshot.unit_id, snapshot.viewing_id, scope) : {};
    const old = (await db.query(`SELECT * FROM unit_offers WHERE id=$1 FOR UPDATE`, [offerId])).rows[0];
    if (!old) throw new ViewingError(404, "Offer not found");
    if (old.unit_id !== snapshot.unit_id || old.viewing_id !== snapshot.viewing_id) throw new ViewingError(409, "The offer's viewing link changed. Refresh before saving.");
    const parsed = insertUnitOfferSchema.partial().omit({ unitId: true }).safeParse({ ...body,
      viewingId: old.viewing_id, ...linked, confirmedAt: old.confirmed_at });
    if (!parsed.success) throw new ViewingError(400, parsed.error.issues.map(issue => issue.message).join("; "));
    const [offer] = await drizzle(db).update(unitOffers).set(parsed.data).where(eq(unitOffers.id, offerId)).returning();
    return offer;
  });
}

export function registerLeasingViewingRoutes(app: Express) {
  const handle = (fn: (req: Request) => Promise<any>) => async (req: any, res: any) => {
    try { res.json(await fn(req)); }
    catch (e: any) { res.status(e instanceof ViewingError ? e.status : e instanceof z.ZodError ? 400 : 500).json({ message: e.message }); }
  };
  app.get("/api/leasing-viewings", requireAuth, handle(async req => {
    const scope = await resolveCompanyScope(req);
    let viewings = await listLeasingViewings(scope);
    if (typeof req.query.companyId === "string") viewings = viewings.filter(v => v.companyId === req.query.companyId);
    const offers = (await pool.query(`SELECT o.id,o.viewing_id,o.unit_id,o.company_id,o.offer_date,o.confirmed_at,o.status
      FROM unit_offers o JOIN available_units au ON au.id=o.unit_id JOIN crm_properties p ON p.id=au.property_id WHERE ${scopeSql}`, [scope])).rows;
    for (const v of viewings) v.offers = offers.filter(o => o.viewing_id === v.id || (!o.viewing_id && o.unit_id === v.unitId && o.company_id && o.company_id === v.companyId)).map(toCamel);
    return { viewings, emailRemindersEnabled: process.env.VIEWING_REMINDER_EMAILS_ENABLED === "true" };
  }));

  app.get("/api/leasing-viewings/options", requireAuth, handle(async req => {
    const scope = await resolveCompanyScope(req);
    const units = (await pool.query(`SELECT au.id,au.unit_name AS name,au.property_id,p.name AS property_name,au.sqft FROM available_units au JOIN crm_properties p ON p.id=au.property_id WHERE ${scopeSql} ORDER BY p.name,au.unit_name`, [scope])).rows.map(toCamel);
    const brandFilter = scope ? await clientBrandSliceSql(scope) : "TRUE";
    const brands = (await pool.query(`SELECT id,name FROM crm_companies WHERE company_type ~* '^tenant([[:space:]]|-|$)' AND merged_into_id IS NULL AND (${brandFilter}) ORDER BY name`)).rows;
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
    const owners = (await pool.query(`SELECT id,name,team FROM users WHERE is_active IS NOT FALSE AND email ILIKE '%@brucegillinghampollard.com'
      AND ($1::boolean OR id=ANY($2::varchar[])) ORDER BY name`, [!scope,allowedOwners])).rows.map(toCamel);
    const requirements = (await pool.query(`SELECT id,name,company_id FROM crm_requirements_leasing WHERE company_id=ANY($1::varchar[]) ORDER BY name`, [brandIds])).rows.map(toCamel);
    return { units, brands, contacts, owners, requirements };
  }));

  app.patch("/api/leasing-viewings/:id", requireAuth, handle(req => patchLeasingViewing(req, String(req.params.id), req.body)));

  app.post("/api/leasing-viewings/:id/units", requireAuth, handle(async req => {
    const { unitIds } = z.object({ unitIds: z.array(identifier).min(1).max(30) }).strict().parse(req.body);
    const scope = await resolveCompanyScope(req);
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
        created.push(...row.rows.map(row => projectViewing(row, !!scope)));
      }
      return { created };
    });
  }));

  app.post("/api/leasing-viewings/:id/requirement", requireAuth, handle(async req => {
    const input = z.union([z.object({ requirementId: identifier }).strict(), z.object({ create: z.literal(true) }).strict()]).parse(req.body);
    if ("requirementId" in input) return patchLeasingViewing(req, String(req.params.id), { requirementId: input.requirementId });
    const scope = await resolveCompanyScope(req);
    return transaction(async db => {
      const old = await getLockedViewing(db, String(req.params.id), scope);
      if (!old.company_id || !old.details_confirmed_at) throw new ViewingError(400, "Confirm the brand and viewing details before creating its requirement");
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
    const scope = await resolveCompanyScope(req);
    return transaction(async db => {
      const viewing = await getLockedViewing(db, String(req.params.id), scope);
      const offer = (await db.query(`SELECT * FROM unit_offers WHERE id=$1 FOR UPDATE`, [req.params.offerId])).rows[0];
      if (!offer) throw new ViewingError(404, "Offer not found");
      if (!viewing.details_confirmed_at || !viewing.company_id || offer.unit_id !== viewing.unit_id || offer.company_id !== viewing.company_id) throw new ViewingError(400, "Confirm the viewing and check that the offer belongs to the same brand and unit");
      if (offer.viewing_id && offer.viewing_id !== viewing.id) throw new ViewingError(409, "This offer is already linked to another viewing");
      if (!calendarDateValue(offer.offer_date)) throw new ViewingError(400, "Set a valid offer date before confirming it");
      const saved = await db.query(`UPDATE unit_offers SET viewing_id=$2,confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1 RETURNING *`, [offer.id,viewing.id]);
      return toCamel(saved.rows[0]);
    });
  }));

  app.get("/api/leasing-viewings/report", requireAuth, handle(async req => {
    const asOf = todayLondon();
    const from = day.parse(req.query.from || `${asOf.slice(0,4)}-01-01`);
    const to = day.parse(req.query.to || asOf);
    if (from > to) throw new ViewingError(400, "The report start must be before its end");
    const scope = await resolveCompanyScope(req);
    const viewings = await listLeasingViewings(scope);
    const offers = (await pool.query(`SELECT o.*,COALESCE(au.unit_id,au.tenancy_unit_id,au.id) AS physical_unit_id
      FROM unit_offers o JOIN available_units au ON au.id=o.unit_id JOIN crm_properties p ON p.id=au.property_id WHERE ${scopeSql}`, [scope])).rows.map(toCamel);
    return buildViewingReport({ viewings: viewings.map(v => ({ ...v, confirmed: !!v.detailsConfirmedAt && !v.issues.length })),
      offers: offers.map(o => ({ ...o, confirmed: !!o.confirmedAt })),from,to,asOf,conversionWindowDays:90,
      ownerUserId: typeof req.query.ownerUserId === "string" ? req.query.ownerUserId : undefined,
      team: typeof req.query.team === "string" ? req.query.team : undefined });
  }));
}
