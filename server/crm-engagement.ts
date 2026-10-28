import { Router, type Express, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { EngagementData, EngagementOptions, StrategyInput, EventInput, ActionInput } from "../shared/crm-engagement";
import { LANDLORD_CATALOGUE_PREDICATE } from "./landlord-meeting-matching";
import { isPrivateMailboxAddress, isPrivateEmailRecord } from "./private-mail";

type Queryable = { query: (sql: string, values?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type TransactionPool = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };
type Actor = { id: string; name: string | null; email?: string; role?: string | null; is_active?: boolean; client_view_mode?: boolean };
const STAFF_DOMAIN = "@brucegillinghampollard.com";
// Additive only: Marketing and My Tasks remain the authoritative records.
export const CRM_ENGAGEMENT_MIGRATIONS = [
  `ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS starts_on DATE`,
  `ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS ends_on DATE`,
  `ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now()`,
  `ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS date_confirmed BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS outcome TEXT`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS assigned_by_user_id VARCHAR`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS assigned_by_name TEXT`,
  `CREATE TABLE IF NOT EXISTS crm_strategy_targets (
    strategy_id VARCHAR NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    company_id VARCHAR NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK(length(trim(reason))>0), contact_ids TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY(strategy_id,company_id))`,
  `CREATE INDEX IF NOT EXISTS crm_strategy_targets_company_idx ON crm_strategy_targets(company_id)`,
  `CREATE TABLE IF NOT EXISTS crm_event_companies (
    event_id VARCHAR NOT NULL REFERENCES marketing_events(id) ON DELETE CASCADE,
    company_id VARCHAR NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK(length(trim(reason))>0), PRIMARY KEY(event_id,company_id))`,
  `CREATE INDEX IF NOT EXISTS crm_event_companies_company_idx ON crm_event_companies(company_id)`,
  `CREATE TABLE IF NOT EXISTS crm_event_strategies (
    event_id VARCHAR NOT NULL REFERENCES marketing_events(id) ON DELETE CASCADE,
    strategy_id VARCHAR NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    PRIMARY KEY(event_id,strategy_id))`,
  `CREATE TABLE IF NOT EXISTS crm_event_guests (
    event_id VARCHAR NOT NULL REFERENCES marketing_events(id) ON DELETE CASCADE,
    contact_id VARCHAR NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN('suggested','invited','accepted','declined','attended','no_show')),
    PRIMARY KEY(event_id,contact_id))`,
  `CREATE TABLE IF NOT EXISTS crm_engagement_actions (
    task_id VARCHAR PRIMARY KEY REFERENCES user_tasks(id) ON DELETE CASCADE,
    company_id VARCHAR NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
    strategy_id VARCHAR REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
    event_id VARCHAR REFERENCES marketing_events(id) ON DELETE SET NULL)`,
  `CREATE INDEX IF NOT EXISTS crm_engagement_actions_company_idx ON crm_engagement_actions(company_id)`,
];
const id = z.string().trim().min(1).max(100);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const timestamp = z.string().datetime({ offset: true }).nullable();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a valid date").nullable();
const companyLink = z.object({ companyId: id, reason: z.string().trim().min(1, "Add a reason for linking this landlord").max(2000) }).strict();
const unique = <T>(values: T[], key: (value: T) => string) => new Set(values.map(key)).size === values.length;

export const strategyInputSchema = z.object({
  name: z.string().trim().min(1).max(200), objective: z.string().trim().min(1).max(4000),
  team: nullableText(100), ownerId: id.nullable(), status: z.enum(["active", "paused", "completed"]),
  startsOn: dateOnly, endsOn: dateOnly,
  targets: z.array(companyLink.extend({ contactIds: z.array(id).max(100).refine(values => unique(values, x => x), "Duplicate contact") })).max(100)
    .refine(values => unique(values, x => x.companyId), "Duplicate landlord"),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict().refine(value => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, { message: "End date must follow the start date", path: ["endsOn"] });

export const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(200), kind: nullableText(80), startsAt: timestamp, endsAt: timestamp,
  location: nullableText(500), description: nullableText(6000), ownerId: id.nullable(),
  status: z.enum(["draft", "planned", "cancelled", "completed"]),
  sourceUrl: z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value), "Use a website URL").nullable(),
  dateConfirmed: z.boolean(), outcome: nullableText(4000),
  strategyIds: z.array(id).max(50).refine(values => unique(values, x => x), "Duplicate strategy"),
  companies: z.array(companyLink).max(100).refine(values => unique(values, x => x.companyId), "Duplicate landlord"),
  guests: z.array(z.object({ contactId: id, status: z.enum(["suggested", "invited", "accepted", "declined", "attended", "no_show"]) }).strict())
    .max(500).refine(values => unique(values, x => x.contactId), "Duplicate guest"),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.dateConfirmed && !value.startsAt) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "Add a date before confirming it" });
  if (value.endsAt && (!value.startsAt || new Date(value.endsAt) < new Date(value.startsAt))) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End time must follow the start time" });
});

export const actionInputSchema = z.object({
  title: z.string().trim().min(1).max(250), notes: nullableText(4000), dueAt: timestamp,
  status: z.enum(["todo", "in_progress", "done"]), ownerId: id, companyId: id,
  strategyId: id.nullable(), eventId: id.nullable(),
}).strict();
const actionStatusSchema = z.object({ status: z.enum(["todo", "in_progress", "done"]) }).strict();

export class EngagementError extends Error { constructor(public status: number, message: string) { super(message); } }
export function isEngagementStaff(user: Actor | null | undefined, scope: string | null): boolean {
  return !!user && user.is_active === true && !user.client_view_mode && String(user.role || "").toLowerCase() !== "client"
    && String(user.email || "").trim().toLowerCase().endsWith(STAFF_DOMAIN)
    && !isPrivateMailboxAddress(user.email) && scope === null;
}
const iso = (value: any): string | null => value ? new Date(value).toISOString() : null;
const day = (value: any): string | null => value ? (typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10)) : null;

async function assertCompanies(q: Queryable, ids: string[]) {
  if (!ids.length) return;
  const rows = (await q.query(`SELECT c.id FROM crm_companies c WHERE c.id=ANY($1::text[]) AND ${LANDLORD_CATALOGUE_PREDICATE}`, [ids])).rows;
  if (rows.length !== new Set(ids).size) throw new EngagementError(400, "Choose saved landlord accounts; brands are not part of this plan");
}
async function assertOwner(q: Queryable, ownerId: string | null) {
  if (!ownerId) return;
  const user = (await q.query(`SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE id=$1`, [ownerId])).rows[0];
  if (!isEngagementStaff(user, null)) throw new EngagementError(400, "Choose an active BGP colleague as the owner");
}
async function assertContacts(q: Queryable, ids: string[], companyIds: string[]) {
  if (!ids.length) return;
  const rows = (await q.query(`SELECT id,company_id,email FROM crm_contacts WHERE id=ANY($1::text[]) AND company_id=ANY($2::text[])`, [ids, companyIds])).rows;
  if (rows.length !== new Set(ids).size || rows.some(row => isPrivateMailboxAddress(row.email))) throw new EngagementError(400, "Choose contacts belonging to the linked landlord accounts");
}
async function assertStrategyIds(q: Queryable, ids: string[]) {
  if (!ids.length) return;
  if ((await q.query(`SELECT id FROM marketing_campaigns WHERE id=ANY($1::text[])`, [ids])).rows.length !== ids.length) throw new EngagementError(400, "A linked strategy no longer exists");
}
function assertVersion(row: any, expected?: string) {
  if (!row) throw new EngagementError(404, "This record no longer exists");
  if (expected && iso(row.updated_at) !== iso(expected)) throw new EngagementError(409, "Someone else updated this record. Reopen it before saving your changes.");
}
async function transaction<T>(db: TransactionPool, work: (q: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

const eventPrivacyColumns = `ARRAY(SELECT email FROM users WHERE id=ANY(COALESCE(e.attendee_user_ids,'{}')) OR id=e.created_by_user_id OR id=e.lead_user_id)
  || ARRAY(SELECT email FROM crm_contacts WHERE id=ANY(COALESCE(e.attendee_contact_ids,'{}'))) AS participants`;
async function assertEventVisible(q:Queryable,eventId:string,lock=false) {
  const row=(await q.query(`SELECT e.updated_at,${eventPrivacyColumns} FROM marketing_events e WHERE e.id=$1${lock?' FOR UPDATE OF e':''}`,[eventId])).rows[0];
  if(!row||isPrivateEmailRecord(row))throw new EngagementError(404,"This event is not available in CRM planning");
  return row;
}

export async function getCrmEngagementData(companyId?: string, deps: { pool?: Queryable; viewerId?: string } = {}): Promise<EngagementData> {
  const q = deps.pool || (await import("./db")).pool;
  if (companyId) await assertCompanies(q, [companyId]);
  const params = [companyId || null];
  const [strategyRows, targets, eventRows, companies, eventStrategies, guests, actionRows] = await Promise.all([
    q.query(`SELECT s.*,u.name AS owner_name FROM marketing_campaigns s LEFT JOIN users u ON u.id=s.lead_user_id
      WHERE $1::text IS NULL OR EXISTS(SELECT 1 FROM crm_strategy_targets t WHERE t.strategy_id=s.id AND t.company_id=$1)
      ORDER BY s.created_at DESC`, params),
    q.query(`SELECT t.*,c.name AS company_name FROM crm_strategy_targets t JOIN crm_companies c ON c.id=t.company_id
      WHERE $1::text IS NULL OR t.strategy_id IN(SELECT strategy_id FROM crm_strategy_targets WHERE company_id=$1)`, params),
    q.query(`SELECT e.*,u.name AS owner_name,${eventPrivacyColumns} FROM marketing_events e LEFT JOIN users u ON u.id=e.lead_user_id
      WHERE $1::text IS NULL OR EXISTS(SELECT 1 FROM crm_event_companies c WHERE c.event_id=e.id AND c.company_id=$1)
      ORDER BY e.starts_at ASC NULLS LAST,e.created_at DESC`, params),
    q.query(`SELECT l.*,c.name AS company_name FROM crm_event_companies l JOIN crm_companies c ON c.id=l.company_id
      WHERE $1::text IS NULL OR l.event_id IN(SELECT event_id FROM crm_event_companies WHERE company_id=$1)`, params),
    q.query(`SELECT l.* FROM crm_event_strategies l WHERE $1::text IS NULL OR l.event_id IN(SELECT event_id FROM crm_event_companies WHERE company_id=$1)`, params),
    q.query(`SELECT g.*,p.name,p.company_id,p.email,c.name AS company_name FROM crm_event_guests g JOIN crm_contacts p ON p.id=g.contact_id
      LEFT JOIN crm_companies c ON c.id=p.company_id WHERE $1::text IS NULL OR g.event_id IN(SELECT event_id FROM crm_event_companies WHERE company_id=$1)`, params),
    q.query(`SELECT t.*,l.company_id,l.strategy_id,l.event_id,c.name AS company_name,u.name AS owner_name,${eventPrivacyColumns} FROM crm_engagement_actions l
      JOIN user_tasks t ON t.id=l.task_id JOIN crm_companies c ON c.id=l.company_id LEFT JOIN users u ON u.id=t.user_id
      LEFT JOIN marketing_events e ON e.id=l.event_id
      WHERE $1::text IS NULL OR l.company_id=$1 ORDER BY t.due_date ASC NULLS LAST,t.created_at DESC`, params),
  ]);
  const privateEvents=new Set(eventRows.rows.filter(row=>isPrivateEmailRecord(row)).map(row=>row.id));
  return {
    strategies: strategyRows.rows.map(row => ({ id: row.id, name: row.name, objective: row.objective || "", team: row.team,
      ownerId: row.lead_user_id, ownerName: row.owner_name, status: row.status, startsOn: day(row.starts_on), endsOn: day(row.ends_on), updatedAt: iso(row.updated_at)!,
      targets: targets.rows.filter(t => t.strategy_id === row.id).map(t => ({ companyId: t.company_id, companyName: t.company_name, reason: t.reason, contactIds: t.contact_ids || [] })) })),
    events: eventRows.rows.filter(row=>!privateEvents.has(row.id)).map(row => ({ id: row.id, title: row.title, kind: row.kind, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), location: row.location,
      description: row.description, ownerId: row.lead_user_id, ownerName: row.owner_name, status: ["draft","planned","cancelled","completed"].includes(row.status) ? row.status : "draft",
      sourceUrl: /^https?:\/\//i.test(row.external_url || "") ? row.external_url : null, dateConfirmed: row.date_confirmed === true, outcome: row.outcome,
      updatedAt: iso(row.updated_at)!, strategyIds: eventStrategies.rows.filter(s => s.event_id === row.id).map(s => s.strategy_id),
      companies: companies.rows.filter(c => c.event_id === row.id).map(c => ({ companyId: c.company_id, companyName: c.company_name, reason: c.reason })),
      guests: guests.rows.filter(g => g.event_id === row.id && !isPrivateMailboxAddress(g.email)).map(g => ({ contactId: g.contact_id, name: g.name, companyId: g.company_id, companyName: g.company_name, status: g.status })) })),
    actions: actionRows.rows.filter(row=>!isPrivateEmailRecord(row)).map(row => ({ id: row.id, title: row.title, notes: row.description, dueAt: iso(row.due_date), status: row.status,
      canEdit: !!deps.viewerId && (row.user_id===deps.viewerId || row.assigned_by_user_id===deps.viewerId),
      ownerId: row.user_id, ownerName: row.owner_name, companyId: row.company_id, companyName: row.company_name, strategyId: row.strategy_id, eventId: row.event_id })),
  };
}

export async function getCrmEngagementOptions(q: Queryable): Promise<EngagementOptions> {
  const [staff, companies, contacts] = await Promise.all([
    q.query(`SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE is_active=true AND lower(trim(email)) LIKE '%@brucegillinghampollard.com' ORDER BY name`),
    q.query(`SELECT c.id,c.name FROM crm_companies c WHERE ${LANDLORD_CATALOGUE_PREDICATE} ORDER BY c.name`),
    q.query(`SELECT p.id,p.name,p.company_id,p.role,p.email FROM crm_contacts p JOIN crm_companies c ON c.id=p.company_id WHERE ${LANDLORD_CATALOGUE_PREDICATE} ORDER BY p.name`),
  ]);
  return { staff: staff.rows.filter(user => isEngagementStaff(user, null)).map(user => ({ id: user.id, name: user.name || user.id })),
    companies: companies.rows, contacts: contacts.rows.filter(contact => !isPrivateMailboxAddress(contact.email)).map(contact => ({ id: contact.id, name: contact.name, companyId: contact.company_id, role: contact.role })) };
}

export async function saveEngagementStrategy(db: TransactionPool, input: StrategyInput, recordId?: string) {
  return transaction(db, async q => {
    await assertOwner(q, input.ownerId); await assertCompanies(q, input.targets.map(target => target.companyId));
    for (const target of input.targets) await assertContacts(q, target.contactIds, [target.companyId]);
    if (recordId) assertVersion((await q.query("SELECT updated_at FROM marketing_campaigns WHERE id=$1 FOR UPDATE", [recordId])).rows[0], input.expectedUpdatedAt);
    const values = [input.name, input.objective, input.team, input.ownerId, input.status, input.startsOn, input.endsOn];
    const saved = (await q.query(recordId ? `UPDATE marketing_campaigns SET name=$1,objective=$2,team=$3,lead_user_id=$4,status=$5,starts_on=$6,ends_on=$7,updated_at=now() WHERE id=$8 RETURNING id`
      : `INSERT INTO marketing_campaigns(name,objective,team,lead_user_id,status,starts_on,ends_on) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, recordId ? [...values,recordId] : values)).rows[0];
    await q.query("DELETE FROM crm_strategy_targets WHERE strategy_id=$1", [saved.id]);
    for (const target of input.targets) await q.query("INSERT INTO crm_strategy_targets(strategy_id,company_id,reason,contact_ids) VALUES($1,$2,$3,$4)", [saved.id,target.companyId,target.reason,target.contactIds]);
    return { ok: true, id: saved.id };
  });
}

export async function saveEngagementEvent(db: TransactionPool, input: EventInput, recordId?: string) {
  return transaction(db, async q => {
    await assertOwner(q,input.ownerId); await assertCompanies(q,input.companies.map(company=>company.companyId));
    await assertContacts(q,input.guests.map(guest=>guest.contactId),input.companies.map(company=>company.companyId));
    await assertStrategyIds(q,input.strategyIds);
    if (recordId) assertVersion(await assertEventVisible(q,recordId,true),input.expectedUpdatedAt);
    const values=[input.title,input.kind,input.startsAt,input.endsAt,input.location,input.description,input.ownerId,input.status,input.sourceUrl,input.dateConfirmed,input.outcome];
    const saved=(await q.query(recordId ? `UPDATE marketing_events SET title=$1,kind=$2,starts_at=$3,ends_at=$4,location=$5,description=$6,lead_user_id=$7,status=$8,external_url=$9,date_confirmed=$10,outcome=$11,updated_at=now() WHERE id=$12 RETURNING id`
      : `INSERT INTO marketing_events(title,kind,starts_at,ends_at,location,description,lead_user_id,status,external_url,date_confirmed,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,recordId?[...values,recordId]:values)).rows[0];
    // CRM statuses are explicit. Legacy Marketing attendee IDs are preserved;
    // they do not imply acceptance or attendance and are not silently imported.
    const formerGuests=(await q.query("SELECT contact_id FROM crm_event_guests WHERE event_id=$1",[saved.id])).rows.map(row=>row.contact_id);
    await q.query(`UPDATE marketing_events SET attendee_contact_ids=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(attendee_contact_ids,'{}')||$2::text[]) value WHERE NOT(value=ANY($3::text[])) OR value=ANY($2::text[])) WHERE id=$1`,[saved.id,input.guests.map(guest=>guest.contactId),formerGuests]);
    await q.query("DELETE FROM crm_event_companies WHERE event_id=$1",[saved.id]);
    await q.query("DELETE FROM crm_event_strategies WHERE event_id=$1",[saved.id]);
    await q.query("DELETE FROM crm_event_guests WHERE event_id=$1",[saved.id]);
    for(const company of input.companies)await q.query("INSERT INTO crm_event_companies(event_id,company_id,reason) VALUES($1,$2,$3)",[saved.id,company.companyId,company.reason]);
    for(const strategyId of input.strategyIds)await q.query("INSERT INTO crm_event_strategies(event_id,strategy_id) VALUES($1,$2)",[saved.id,strategyId]);
    for(const guest of input.guests)await q.query("INSERT INTO crm_event_guests(event_id,contact_id,status) VALUES($1,$2,$3)",[saved.id,guest.contactId,guest.status]);
    return {ok:true,id:saved.id};
  });
}

export async function createEngagementAction(db: TransactionPool,input: ActionInput,actor:Actor) {
  return transaction(db,async q=>{
    await assertOwner(q,input.ownerId);await assertCompanies(q,[input.companyId]);
    if(input.strategyId && !(await q.query("SELECT 1 FROM crm_strategy_targets WHERE strategy_id=$1 AND company_id=$2",[input.strategyId,input.companyId])).rows.length)throw new EngagementError(400,"Choose a strategy linked to this landlord");
    if(input.eventId){await assertEventVisible(q,input.eventId);if(!(await q.query("SELECT 1 FROM crm_event_companies WHERE event_id=$1 AND company_id=$2",[input.eventId,input.companyId])).rows.length)throw new EngagementError(400,"Choose an event linked to this landlord");}
    const task=(await q.query(`INSERT INTO user_tasks(user_id,title,description,due_date,status,category,assigned_by_user_id,assigned_by_name,completed_at)
      VALUES($1,$2,$3,$4,$5,'crm',$6,$7,CASE WHEN $5='done' THEN now() ELSE NULL END) RETURNING id`,[input.ownerId,input.title,input.notes,input.dueAt,input.status,actor.id,actor.name])).rows[0];
    await q.query("INSERT INTO crm_engagement_actions(task_id,company_id,strategy_id,event_id) VALUES($1,$2,$3,$4)",[task.id,input.companyId,input.strategyId,input.eventId]);
    return {ok:true,id:task.id};
  });
}

export function createCrmEngagementRouter(deps:{pool:TransactionPool;requireAuth:RequestHandler;resolveScope:(req:Request)=>Promise<string|null>;schemaReady?:Promise<boolean>}) {
  const router=Router();
  router.use(deps.requireAuth);
  router.use(async(req,res,next)=>{
    try {
      const userId=req.session?.userId||(req as any).tokenUserId;
      const actor=userId?(await deps.pool.query("SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE id=$1",[userId])).rows[0]:null;
      if(!isEngagementStaff(actor,await deps.resolveScope(req)))return res.status(403).json({error:"CRM plans are available in the BGP staff view only"});
      if(deps.schemaReady && !await deps.schemaReady)return res.status(503).json({error:"CRM planning is not ready yet. Please try again later."});
      res.locals.engagementActor=actor;next();
    }catch {res.status(503).json({error:"Unable to check CRM planning access"});}
  });
  const handle=(work:(req:Request,actor:Actor)=>Promise<any>):RequestHandler=>async(req,res)=>{
    try {res.json(await work(req,res.locals.engagementActor));}
    catch(error:any){if(error instanceof z.ZodError)return res.status(400).json({error:error.issues[0]?.message||"Check the form"});res.status(error.status||500).json({error:error instanceof EngagementError?error.message:"CRM plans could not be saved or loaded"});}
  };
  router.get("/options",handle(()=>getCrmEngagementOptions(deps.pool)));
  router.get("/",handle((req,actor)=>getCrmEngagementData(req.query.companyId===undefined?undefined:id.parse(req.query.companyId),{pool:deps.pool,viewerId:actor.id})));
  router.post("/strategies",handle(req=>saveEngagementStrategy(deps.pool,strategyInputSchema.parse(req.body))));
  router.put("/strategies/:id",handle(req=>saveEngagementStrategy(deps.pool,strategyInputSchema.parse(req.body),id.parse(req.params.id))));
  router.post("/events",handle(req=>saveEngagementEvent(deps.pool,eventInputSchema.parse(req.body))));
  router.put("/events/:id",handle(req=>saveEngagementEvent(deps.pool,eventInputSchema.parse(req.body),id.parse(req.params.id))));
  router.post("/actions",handle((req,actor)=>createEngagementAction(deps.pool,actionInputSchema.parse(req.body),actor)));
  router.patch("/actions/:id",handle(async(req,actor)=>{
    const input=actionStatusSchema.parse(req.body);
    const linked=(await deps.pool.query(`SELECT a.event_id FROM crm_engagement_actions a JOIN user_tasks t ON t.id=a.task_id WHERE t.id=$1 AND(t.user_id=$2 OR t.assigned_by_user_id=$2)`,[id.parse(req.params.id),actor.id])).rows[0];
    if(!linked)throw new EngagementError(403,"Only the owner or person who assigned this action can update it");
    if(linked.event_id)await assertEventVisible(deps.pool,linked.event_id);
    const row=(await deps.pool.query(`UPDATE user_tasks t SET status=$1,completed_at=CASE WHEN $1='done' THEN now() ELSE NULL END
      WHERE t.id=$2 AND (t.user_id=$3 OR t.assigned_by_user_id=$3) AND EXISTS(SELECT 1 FROM crm_engagement_actions a WHERE a.task_id=t.id) RETURNING t.id`,[input.status,id.parse(req.params.id),actor.id])).rows[0];
    if(!row)throw new EngagementError(403,"Only the owner or person who assigned this action can update it");
    return {ok:true,id:row.id};
  }));
  return router;
}

export async function registerCrmEngagementRoutes(app:Express,schemaReady?:Promise<boolean>) {
  const [{pool},{requireAuth},{resolveCompanyScope}]=await Promise.all([import("./db"),import("./auth"),import("./company-scope")]);
  app.use("/api/crm/engagement",createCrmEngagementRouter({pool,requireAuth,resolveScope:resolveCompanyScope,schemaReady}));
}
