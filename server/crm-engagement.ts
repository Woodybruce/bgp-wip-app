import { Router, type Express, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { EngagementAction, EngagementData, EngagementKind, EngagementOptions, StrategyInput, EventInput, ActionInput, ActionPlanInput } from "../shared/crm-engagement";
import { LANDSEC_WAITING_PARTIES } from "../shared/landsec";
import { LANDLORD_CATALOGUE_PREDICATE } from "./landlord-meeting-matching";
import { isPrivateMailboxAddress, isPrivateEmailRecord } from "./private-mail";
import { getLandlordInterviewMentions } from "./landlord-interview-links";

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
  `ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS source_interview_id VARCHAR`,
  `ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS source_question_id TEXT`,
  // Brand CRM (Woody, 2026-11-12): a brand action can sit at a scheme and
  // unit of the brand's plan, be shown to one client company, and say who it
  // is waiting on. Plain columns with no foreign keys: one failed statement
  // in this list takes CRM planning down for everyone.
  `ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS property_id VARCHAR`,
  `ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS tenancy_unit_id VARCHAR`,
  `ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS shared_with_company_id VARCHAR`,
  `ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS waiting_on_party TEXT`,
  `ALTER TABLE crm_engagement_actions ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMP`,
];
const id = z.string().trim().min(1).max(100);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const timestamp = z.string().datetime({ offset: true }).nullable();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a valid date").nullable();
const unique = <T>(values: T[], key: (value: T) => string) => new Set(values.map(key)).size === values.length;

// The Landlord CRM and the Brand CRM are two views of the same planning
// records (Woody, 2026-11-12: brands have their own CRM, worded "Brand",
// kept apart from the Landlord CRM). The form messages follow the view.
const kindSchema = z.enum(["landlord", "brand"]).optional();
function inputSchemasFor(kind: EngagementKind) {
  const companyLink = z.object({ companyId: id, reason: z.string().trim().min(1, `Add a reason for linking this ${kind}`).max(2000) }).strict();
  const strategy = z.object({
    name: z.string().trim().min(1).max(200), objective: z.string().trim().min(1).max(4000),
    team: nullableText(100), ownerId: id.nullable(), status: z.enum(["active", "paused", "completed"]),
    startsOn: dateOnly, endsOn: dateOnly,
    targets: z.array(companyLink.extend({ contactIds: z.array(id).max(100).refine(values => unique(values, x => x), "Duplicate contact") })).max(100)
      .refine(values => unique(values, x => x.companyId), `Duplicate ${kind}`),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  }).strict().refine(value => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, { message: "End date must follow the start date", path: ["endsOn"] });
  const event = z.object({
    title: z.string().trim().min(1).max(200), kind: nullableText(80), startsAt: timestamp, endsAt: timestamp,
    location: nullableText(500), description: nullableText(6000), ownerId: id.nullable(),
    status: z.enum(["draft", "planned", "cancelled", "completed"]),
    sourceUrl: z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value), "Use a website URL").nullable(),
    dateConfirmed: z.boolean(), outcome: nullableText(4000),
    strategyIds: z.array(id).max(50).refine(values => unique(values, x => x), "Duplicate strategy"),
    companies: z.array(companyLink).max(100).refine(values => unique(values, x => x.companyId), `Duplicate ${kind}`),
    guests: z.array(z.object({ contactId: id, status: z.enum(["suggested", "invited", "accepted", "declined", "attended", "no_show"]) }).strict())
      .max(500).refine(values => unique(values, x => x.contactId), "Duplicate guest"),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.dateConfirmed && !value.startsAt) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "Add a date before confirming it" });
    if (value.endsAt && (!value.startsAt || new Date(value.endsAt) < new Date(value.startsAt))) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End time must follow the start time" });
  });
  return { strategy, event };
}
const INPUT_SCHEMAS = { landlord: inputSchemasFor("landlord"), brand: inputSchemasFor("brand") };
export const strategyInputSchema = INPUT_SCHEMAS.landlord.strategy;
export const eventInputSchema = INPUT_SCHEMAS.landlord.event;

// A brand action's place on the plan, the client it is shown to and who it
// waits on. Left out = unchanged (or none on a new action); null = cleared.
const actionPlanFields = {
  propertyId: id.nullable().optional(), tenancyUnitId: id.nullable().optional(), sharedWithCompanyId: id.nullable().optional(),
  waitingOnParty: z.enum(LANDSEC_WAITING_PARTIES, { errorMap: () => ({ message: "Choose who the action is waiting on from the list" }) }).nullable().optional(),
};
export const actionInputSchema = z.object({
  title: z.string().trim().min(1).max(250), notes: nullableText(4000), dueAt: timestamp,
  status: z.enum(["todo", "in_progress", "done"]), ownerId: id, companyId: id,
  strategyId: id.nullable(), eventId: id.nullable(),
  sourceInterviewId: id.nullable().optional().default(null), sourceQuestionId: id.nullable().optional().default(null),
  ...actionPlanFields,
}).strict().refine(value => !!value.sourceInterviewId === !!value.sourceQuestionId, {
  path: ["sourceInterviewId"], message: "Select both the CRM interview and the question it came from",
});
const actionStatusSchema = z.object({ status: z.enum(["todo", "in_progress", "done"]) }).strict();
// BGP staff may also change the plan fields; a client login changes the status only.
const actionPatchSchema = z.object({ status: z.enum(["todo", "in_progress", "done"]).optional(), ...actionPlanFields }).strict()
  .refine(value => Object.values(value).some(field => field !== undefined), "Nothing to change");

export class EngagementError extends Error { constructor(public status: number, message: string) { super(message); } }
export function isEngagementStaff(user: Actor | null | undefined, scope: string | null): boolean {
  return !!user && user.is_active === true && !user.client_view_mode && String(user.role || "").toLowerCase() !== "client"
    && String(user.email || "").trim().toLowerCase().endsWith(STAFF_DOMAIN)
    && !isPrivateMailboxAddress(user.email) && scope === null;
}
const iso = (value: any): string | null => value ? new Date(value).toISOString() : null;
const day = (value: any): string | null => value ? (typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10)) : null;

// Brands joined the CRM plan on 2026-11-11 (Woody: "a CRM strategy for each
// brand similar to the landlord CRM"): a plan company is a landlord account
// or a tenant brand.
export const PLAN_COMPANY_PREDICATE = `((${LANDLORD_CATALOGUE_PREDICATE}) OR (c.merged_into_id IS NULL AND c.archived_at IS NULL AND LOWER(COALESCE(c.company_type, '')) LIKE 'tenant%'))`;
// A brand is a tenant company; everything else on a plan is on the landlord
// side, so no record the Landlord CRM held before the split can disappear.
const isBrandSql = (alias: string) => `(LOWER(COALESCE(${alias}.company_type,'')) LIKE 'tenant%')`;
// A strategy or event is in the brand view when it links at least one brand,
// and in the landlord view when it links no company at all or at least one
// company that is not a brand. `brand` is a boolean SQL expression.
const linkedInKind = (table: "crm_strategy_targets" | "crm_event_companies", column: "strategy_id" | "event_id", record: string, brand: string) =>
  `(EXISTS(SELECT 1 FROM ${table} kl JOIN crm_companies kc ON kc.id=kl.company_id WHERE kl.${column}=${record} AND ${isBrandSql("kc")}=${brand})
    OR (NOT ${brand} AND NOT EXISTS(SELECT 1 FROM ${table} kl WHERE kl.${column}=${record})))`;
const KIND_VIEW = { landlord: "Landlord CRM", brand: "Brand CRM" } as const;
async function companyNoun(q: Queryable, companyId: string): Promise<EngagementKind> {
  return (await q.query(`SELECT 1 FROM crm_companies c WHERE c.id=$1 AND ${isBrandSql("c")}`, [companyId])).rows.length ? "brand" : "landlord";
}
async function assertCompanies(q: Queryable, ids: string[], kind?: EngagementKind) {
  if (!ids.length) return;
  const rows = (await q.query(`SELECT c.id,${isBrandSql("c")} AS is_brand FROM crm_companies c WHERE c.id=ANY($1::text[]) AND ${PLAN_COMPANY_PREDICATE}`, [ids])).rows;
  if (rows.length !== new Set(ids).size) throw new EngagementError(400, kind === "brand" ? "Choose saved brands" : kind === "landlord" ? "Choose saved landlord accounts" : "Choose saved landlord accounts or brands");
  // A strategy or event is all brands or all landlords, never both.
  if (kind && rows.some(row => (row.is_brand === true) !== (kind === "brand")))
    throw new EngagementError(400, kind === "brand" ? "A brand strategy or event links brands only. Plan landlords on the CRM page." : "A landlord strategy or event links landlords only. Plan brands in the Brand CRM.");
}
async function assertOwner(q: Queryable, ownerId: string | null) {
  if (!ownerId) return;
  const user = (await q.query(`SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE id=$1`, [ownerId])).rows[0];
  if (!isEngagementStaff(user, null)) throw new EngagementError(400, "Choose an active BGP colleague as the owner");
}
async function assertContacts(q: Queryable, ids: string[], companyIds: string[], kind: EngagementKind = "landlord") {
  if (!ids.length) return;
  const rows = (await q.query(`SELECT id,company_id,email FROM crm_contacts WHERE id=ANY($1::text[]) AND company_id=ANY($2::text[])`, [ids, companyIds])).rows;
  if (rows.length !== new Set(ids).size || rows.some(row => isPrivateMailboxAddress(row.email))) throw new EngagementError(400, kind === "brand" ? "Choose contacts belonging to the linked brands" : "Choose contacts belonging to the linked landlord accounts");
}
async function assertStrategyIds(q: Queryable, ids: string[], kind: EngagementKind = "landlord") {
  if (!ids.length) return;
  if ((await q.query(`SELECT id FROM marketing_campaigns WHERE id=ANY($1::text[])`, [ids])).rows.length !== ids.length) throw new EngagementError(400, "A linked strategy no longer exists");
  if ((await q.query(`SELECT s.id FROM marketing_campaigns s WHERE s.id=ANY($1::text[]) AND ${linkedInKind("crm_strategy_targets", "strategy_id", "s.id", "$2::boolean")}`, [ids, kind === "brand"])).rows.length !== ids.length)
    throw new EngagementError(400, `Choose strategies from the ${KIND_VIEW[kind]}`);
}
// An edit made from one view only ever touches a record that view shows.
async function assertRecordInKind(q: Queryable, table: "crm_strategy_targets" | "crm_event_companies", column: "strategy_id" | "event_id", recordId: string, kind: EngagementKind) {
  const source = table === "crm_strategy_targets" ? "marketing_campaigns" : "marketing_events";
  if (!(await q.query(`SELECT 1 FROM ${source} r WHERE r.id=$1 AND ${linkedInKind(table, column, "r.id", "$2::boolean")}`, [recordId, kind === "brand"])).rows.length)
    throw new EngagementError(404, `This record is not in the ${KIND_VIEW[kind]}`);
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

// ── A brand action on the plan (Brand CRM, Woody 2026-11-12) ──────────────
// The clients BGP can show a brand action to (today Landsec), each with its
// schemes, and the brand slice test. Both come from the caller so the rules
// here can be tested without the app.
export type SharePartner = { id: string; name: string; schemes: Array<{ key: string; name: string; propertyId: string | null; propertyIds: string[] }> };
export type ActionPlanDeps = { sharePartners?: () => Promise<SharePartner[]>; isClientVisibleBrand?: (companyId: string, scope: string | null) => Promise<boolean> };
type ActionPlan = { propertyId: string | null; tenancyUnitId: string | null; sharedWithCompanyId: string | null; waitingOnParty: string | null };
const actionPlanOf = (input: ActionPlanInput): ActionPlan => ({ propertyId: input.propertyId || null, tenancyUnitId: input.tenancyUnitId || null,
  sharedWithCompanyId: input.sharedWithCompanyId || null, waitingOnParty: input.waitingOnParty || null });
const hasActionPlan = (plan: ActionPlan) => !!(plan.propertyId || plan.tenancyUnitId || plan.sharedWithCompanyId || plan.waitingOnParty);
const isClientRole = (role: any) => String(role || "").toLowerCase() === "client";

// Checks a plan before it is stored and returns it with the unit's own
// property as the place. A landlord action takes none of these fields. An
// action is shown only to a client that has a Brand CRM, only for a brand in
// that client's list, only at one of that client's schemes, and only when
// BGP raised it: a request another client typed is never passed on.
async function checkedActionPlan(q: Queryable, companyId: string, plan: ActionPlan, deps: ActionPlanDeps, raisedByClient = false, checkShare = true): Promise<ActionPlan> {
  if (!hasActionPlan(plan)) return plan;
  if (await companyNoun(q, companyId) !== "brand") throw new EngagementError(400, "A scheme, a unit, sharing and waiting on belong to brand actions in the Brand CRM");
  const partners = plan.sharedWithCompanyId || (plan.propertyId && plan.tenancyUnitId) ? await deps.sharePartners?.() || [] : [];
  let propertyId = plan.propertyId;
  if (plan.tenancyUnitId) {
    const unit = (await q.query("SELECT id,property_id FROM tenancy_schedule_units WHERE id=$1", [plan.tenancyUnitId])).rows[0];
    if (!unit) throw new EngagementError(400, "That unit is not on the tenancy schedule");
    // The unit sits on the property chosen, or on another record of the same scheme.
    if (propertyId && unit.property_id !== propertyId
      && !partners.some(partner => partner.schemes.some(scheme => scheme.propertyIds.includes(propertyId!) && scheme.propertyIds.includes(unit.property_id))))
      throw new EngagementError(400, "That unit is not in the scheme chosen");
    propertyId = unit.property_id;
  } else if (propertyId && !(await q.query("SELECT 1 FROM crm_properties WHERE id=$1", [propertyId])).rows.length) throw new EngagementError(400, "That scheme has no property record");
  if (plan.sharedWithCompanyId && checkShare) {
    const partner = partners.find(candidate => candidate.id === plan.sharedWithCompanyId);
    if (!partner) throw new EngagementError(400, "A CRM action can only be shown to a client that has the Brand CRM");
    if (raisedByClient) throw new EngagementError(400, "A client login raised this action. Only an action BGP raised can be shown to a client.");
    if (deps.isClientVisibleBrand && !await deps.isClientVisibleBrand(companyId, partner.id)) throw new EngagementError(400, `This brand is not on ${partner.name}'s brand list, so ${partner.name} could not see the action`);
    if (propertyId && !partner.schemes.some(scheme => scheme.propertyIds.includes(propertyId!))) throw new EngagementError(400, `An action shown to ${partner.name} can only sit at one of ${partner.name}'s schemes`);
  }
  return { ...plan, propertyId };
}
// The waiting clock starts when the party is first named or changes.
const WRITE_ACTION_PLAN = `UPDATE crm_engagement_actions SET property_id=$2,tenancy_unit_id=$3,shared_with_company_id=$4,waiting_on_party=$5,
  waiting_since=CASE WHEN $5::text IS NULL THEN NULL WHEN waiting_on_party IS DISTINCT FROM $5::text THEN now() ELSE waiting_since END WHERE task_id=$1`;
const actionPlanValues = (actionId: string, plan: ActionPlan) => [actionId, plan.propertyId, plan.tenancyUnitId, plan.sharedWithCompanyId, plan.waitingOnParty];

// The names that go with a brand action's plan: the scheme (or property),
// the unit and the client it is shown to. Read apart from the actions, and
// only when an action carries a plan, so a landlord's plan never touches
// these tables and a failed lookup costs the names, not the plan.
async function actionPlanNames(q: Queryable, rows: any[], deps: ActionPlanDeps) {
  const ids = (column: string) => Array.from(new Set(rows.map(row => row.action_plan?.[column]).filter((value): value is string => !!value)));
  const [propertyIds, unitIds, companyIds] = [ids("property_id"), ids("tenancy_unit_id"), ids("shared_with_company_id")];
  const names = async (wanted: string[], sql: string) => new Map<string, string>(!wanted.length ? [] : (await q.query(sql, [wanted]).catch(() => ({ rows: [] as any[] }))).rows.map(row => [row.id, row.name]));
  const [property, unit, company] = await Promise.all([
    names(propertyIds, "SELECT id,name FROM crm_properties WHERE id=ANY($1::text[])"),
    names(unitIds, "SELECT id,COALESCE(NULLIF(trim(premises),''),unit_number) AS name FROM tenancy_schedule_units WHERE id=ANY($1::text[])"),
    names(companyIds, "SELECT id,name FROM crm_companies WHERE id=ANY($1::text[])"),
  ]);
  if (propertyIds.length && deps.sharePartners) {
    const partners = await deps.sharePartners().catch(() => [] as SharePartner[]);
    for (const partner of partners) for (const scheme of partner.schemes) for (const propertyId of scheme.propertyIds) if (propertyIds.includes(propertyId)) property.set(propertyId, scheme.name);
  }
  return { property, unit, company };
}

const eventPrivacyColumns = `ARRAY(SELECT email FROM users WHERE id=ANY(COALESCE(e.attendee_user_ids,'{}')) OR id=e.created_by_user_id OR id=e.lead_user_id)
  || ARRAY(SELECT email FROM crm_contacts WHERE id=ANY(COALESCE(e.attendee_contact_ids,'{}'))) AS participants`;
async function assertEventVisible(q:Queryable,eventId:string,lock=false) {
  const row=(await q.query(`SELECT e.updated_at,${eventPrivacyColumns} FROM marketing_events e WHERE e.id=$1${lock?' FOR UPDATE OF e':''}`,[eventId])).rows[0];
  if(!row||isPrivateEmailRecord(row))throw new EngagementError(404,"This event is not available in CRM planning");
  return row;
}

// kind picks the Landlord CRM or the Brand CRM list. It is ignored when a
// companyId is given (a company page shows that company's whole plan) and
// when it is left out, so those answers are what they were before the split.
// A record that links both kinds shows in each view with only that view's
// companies, guests and strategy links.
export async function getCrmEngagementData(companyId?: string, deps: { pool?: Queryable; viewerId?: string; sharePartners?: ActionPlanDeps["sharePartners"] } = {}, kind?: EngagementKind): Promise<EngagementData> {
  const q = deps.pool || (await import("./db")).pool;
  if (companyId) await assertCompanies(q, [companyId]);
  const view = companyId ? null : kind || null;
  const params = [companyId || null, view];
  const brand = "($2::text='brand')";
  const inView = (alias: string) => `($2::text IS NULL OR ${isBrandSql(alias)}=${brand})`;
  const [strategyRows, targets, eventRows, companies, eventStrategies, guests, actionRows] = await Promise.all([
    q.query(`SELECT s.*,u.name AS owner_name FROM marketing_campaigns s LEFT JOIN users u ON u.id=s.lead_user_id
      WHERE ($1::text IS NULL OR EXISTS(SELECT 1 FROM crm_strategy_targets t WHERE t.strategy_id=s.id AND t.company_id=$1))
        AND ($2::text IS NULL OR ${linkedInKind("crm_strategy_targets", "strategy_id", "s.id", brand)})
      ORDER BY s.created_at DESC`, params),
    q.query(`SELECT t.*,c.name AS company_name FROM crm_strategy_targets t JOIN crm_companies c ON c.id=t.company_id
      WHERE ($1::text IS NULL OR t.strategy_id IN(SELECT strategy_id FROM crm_strategy_targets WHERE company_id=$1)) AND ${inView("c")}`, params),
    q.query(`SELECT e.*,u.name AS owner_name,${eventPrivacyColumns} FROM marketing_events e LEFT JOIN users u ON u.id=e.lead_user_id
      WHERE ($1::text IS NULL OR EXISTS(SELECT 1 FROM crm_event_companies c WHERE c.event_id=e.id AND c.company_id=$1))
        AND ($2::text IS NULL OR ${linkedInKind("crm_event_companies", "event_id", "e.id", brand)})
      ORDER BY e.starts_at ASC NULLS LAST,e.created_at DESC`, params),
    q.query(`SELECT l.*,c.name AS company_name FROM crm_event_companies l JOIN crm_companies c ON c.id=l.company_id
      WHERE ($1::text IS NULL OR l.event_id IN(SELECT event_id FROM crm_event_companies WHERE company_id=$1)) AND ${inView("c")}`, params),
    q.query(`SELECT l.* FROM crm_event_strategies l WHERE $1::text IS NULL OR l.event_id IN(SELECT event_id FROM crm_event_companies WHERE company_id=$1)`, [companyId || null]),
    q.query(`SELECT g.*,p.name,p.company_id,p.email,c.name AS company_name FROM crm_event_guests g JOIN crm_contacts p ON p.id=g.contact_id
      LEFT JOIN crm_companies c ON c.id=p.company_id WHERE ($1::text IS NULL OR g.event_id IN(SELECT event_id FROM crm_event_companies WHERE company_id=$1)) AND ${inView("c")}`, params),
    // The plan columns are read through to_jsonb so this holds on a database
    // that does not have them yet.
    q.query(`SELECT t.*,l.company_id,l.strategy_id,l.event_id,l.source_interview_id,l.source_question_id,c.name AS company_name,u.name AS owner_name,
      ${isBrandSql("c")} AS is_brand,to_jsonb(l) AS action_plan,ab.role AS raised_by_role,${eventPrivacyColumns} FROM crm_engagement_actions l
      JOIN user_tasks t ON t.id=l.task_id JOIN crm_companies c ON c.id=l.company_id LEFT JOIN users u ON u.id=t.user_id
      LEFT JOIN users ab ON ab.id=t.assigned_by_user_id
      LEFT JOIN marketing_events e ON e.id=l.event_id
      WHERE ($1::text IS NULL OR l.company_id=$1) AND ${inView("c")} ORDER BY t.due_date ASC NULLS LAST,t.created_at DESC`, params),
  ]);
  const privateEvents=new Set(eventRows.rows.filter(row=>isPrivateEmailRecord(row)).map(row=>row.id));
  if (view) {
    const shown = new Set(strategyRows.rows.map(row => row.id));
    eventStrategies.rows = eventStrategies.rows.filter(link => shown.has(link.strategy_id));
  }
  const planNames = await actionPlanNames(q, actionRows.rows.filter(row => row.is_brand === true), deps);
  // Only a brand action carries the plan fields: a landlord action is sent exactly as before.
  const brandActionPlan = (row: any): Partial<EngagementAction> => {
    if (row.is_brand !== true) return {};
    const plan = row.action_plan || {};
    return { propertyId: plan.property_id || null, schemeName: plan.property_id ? planNames.property.get(plan.property_id) || null : null,
      tenancyUnitId: plan.tenancy_unit_id || null, unitLabel: plan.tenancy_unit_id ? planNames.unit.get(plan.tenancy_unit_id) || null : null,
      sharedWithCompanyId: plan.shared_with_company_id || null, sharedWithName: plan.shared_with_company_id ? planNames.company.get(plan.shared_with_company_id) || null : null,
      waitingOnParty: plan.waiting_on_party || null, waitingSince: plan.waiting_on_party ? iso(plan.waiting_since) : null,
      raisedBy: isClientRole(row.raised_by_role) ? "client" : "bgp" };
  };
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
      source: row.source_interview_id && row.source_question_id ? {kind:"crm_interview" as const,interviewId:row.source_interview_id,questionId:row.source_question_id,
        label:"CRM strategy interview",url:`/contacts?tab=meetings&interview=${encodeURIComponent(row.source_interview_id)}`} : null,
      ownerId: row.user_id, ownerName: row.owner_name, companyId: row.company_id, companyName: row.company_name, strategyId: row.strategy_id, eventId: row.event_id,
      ...brandActionPlan(row) })),
  };
}

export async function getCrmEngagementOptions(q: Queryable, companyId?: string | null, kind?: EngagementKind): Promise<EngagementOptions> {
  // Every landlord, plus the brands already on a plan and the brand whose
  // page is asking — not the whole brand directory. With a kind, only that
  // side: the Landlord CRM lists landlords, the Brand CRM lists brands.
  const landlords = `(${LANDLORD_CATALOGUE_PREDICATE})`;
  const brands = `(c.merged_into_id IS NULL AND LOWER(COALESCE(c.company_type, '')) LIKE 'tenant%' AND (c.id = $1
        OR EXISTS (SELECT 1 FROM crm_strategy_targets t WHERE t.company_id = c.id)
        OR EXISTS (SELECT 1 FROM crm_event_companies e WHERE e.company_id = c.id)
        OR EXISTS (SELECT 1 FROM crm_engagement_actions a WHERE a.company_id = c.id)))`;
  const companyPredicate = kind === "landlord" ? landlords : kind === "brand" ? brands : `(${landlords}
    OR ${brands})`;
  const params = kind === "landlord" ? [] : [companyId || null];
  const [staff, companies, contacts] = await Promise.all([
    q.query(`SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE is_active=true AND lower(trim(email)) LIKE '%@brucegillinghampollard.com' ORDER BY name`),
    q.query(`SELECT c.id,c.name FROM crm_companies c WHERE ${companyPredicate} ORDER BY c.name`, params),
    q.query(`SELECT p.id,p.name,p.company_id,p.role,p.email FROM crm_contacts p JOIN crm_companies c ON c.id=p.company_id WHERE ${companyPredicate} ORDER BY p.name`, params),
  ]);
  return { staff: staff.rows.filter(user => isEngagementStaff(user, null)).map(user => ({ id: user.id, name: user.name || user.id })),
    companies: companies.rows, contacts: contacts.rows.filter(contact => !isPrivateMailboxAddress(contact.email)).map(contact => ({ id: contact.id, name: contact.name, companyId: contact.company_id, role: contact.role })) };
}

// What the CRM plan holds for each of these companies, for a page that lists
// people on a record (the property page's People tab). "Here" is that record:
// a brand action placed at the property or at one of its schedule rows.
// BGP staff only: the caller decides who is sent it.
export type CompanyPlanSummary = { openCount: number; hereCount: number;
  next: { id: string; title: string; dueAt: string | null; ownerName: string | null; here: boolean } | null;
  strategies: Array<{ id: string; name: string; contactIds: string[] }> };
// Two queries however many companies are asked for, none for an empty list. A
// company with no open action and no active strategy is left out of the map.
export async function planForCompanies(q: Queryable, companyIds: string[], here: { propertyId: string; tenancyUnitIds: string[] }): Promise<Map<string, CompanyPlanSummary>> {
  const plans = new Map<string, CompanyPlanSummary>();
  const ids = Array.from(new Set(companyIds.filter(Boolean)));
  if (!ids.length) return plans;
  const [actionRows, strategyRows] = await Promise.all([
    // The plan columns are read through to_jsonb so this holds on a database
    // that does not have them yet.
    q.query(`SELECT t.id,t.title,t.due_date,t.created_at,l.company_id,u.name AS owner_name,
      COALESCE((to_jsonb(l)->>'property_id')=$2::text OR (to_jsonb(l)->>'tenancy_unit_id')=ANY($3::text[]),false) AS here,
      ${eventPrivacyColumns} FROM crm_engagement_actions l
      JOIN user_tasks t ON t.id=l.task_id JOIN crm_companies c ON c.id=l.company_id LEFT JOIN users u ON u.id=t.user_id
      LEFT JOIN marketing_events e ON e.id=l.event_id
      WHERE l.company_id=ANY($1::text[]) AND t.status IS DISTINCT FROM 'done'`, [ids, here.propertyId || null, here.tenancyUnitIds.filter(Boolean)]),
    q.query(`SELECT s.id,s.name,t.company_id,t.contact_ids FROM crm_strategy_targets t JOIN marketing_campaigns s ON s.id=t.strategy_id
      WHERE t.company_id=ANY($1::text[]) AND s.status='active' ORDER BY s.name`, [ids]),
  ]);
  const planFor = (companyId: string) => {
    let plan = plans.get(companyId);
    if (!plan) plans.set(companyId, plan = { openCount: 0, hereCount: 0, next: null, strategies: [] });
    return plan;
  };
  const dueTime = (row: any) => row.due_date ? new Date(row.due_date).getTime() : Infinity;
  const createdTime = (row: any) => row.created_at ? new Date(row.created_at).getTime() : 0;
  const open = actionRows.rows.filter(row => !isPrivateEmailRecord(row)).sort((a, b) =>
    Number(b.here === true) - Number(a.here === true) || dueTime(a) - dueTime(b) || createdTime(b) - createdTime(a));
  for (const row of open) {
    const plan = planFor(row.company_id);
    plan.openCount++;
    if (row.here === true) plan.hereCount++;
    if (!plan.next) plan.next = { id: row.id, title: row.title, dueAt: iso(row.due_date), ownerName: row.owner_name || null, here: row.here === true };
  }
  for (const row of strategyRows.rows) planFor(row.company_id).strategies.push({ id: row.id, name: row.name, contactIds: row.contact_ids || [] });
  return plans;
}

// A save comes from one view (the Landlord CRM unless it says brand): every
// company on it is of that kind, and only that kind's links are replaced, so
// an older record linking both keeps what the other view put on it.
export async function saveEngagementStrategy(db: TransactionPool, input: StrategyInput, recordId?: string, kind: EngagementKind = "landlord") {
  return transaction(db, async q => {
    await assertOwner(q, input.ownerId); await assertCompanies(q, input.targets.map(target => target.companyId), kind);
    // With no brand on it the strategy would leave the Brand CRM.
    if (kind === "brand" && !input.targets.length) throw new EngagementError(400, "Add at least one brand to a brand strategy");
    for (const target of input.targets) await assertContacts(q, target.contactIds, [target.companyId], kind);
    if (recordId) {
      assertVersion((await q.query("SELECT updated_at FROM marketing_campaigns WHERE id=$1 FOR UPDATE", [recordId])).rows[0], input.expectedUpdatedAt);
      await assertRecordInKind(q, "crm_strategy_targets", "strategy_id", recordId, kind);
    }
    const values = [input.name, input.objective, input.team, input.ownerId, input.status, input.startsOn, input.endsOn];
    const saved = (await q.query(recordId ? `UPDATE marketing_campaigns SET name=$1,objective=$2,team=$3,lead_user_id=$4,status=$5,starts_on=$6,ends_on=$7,updated_at=now() WHERE id=$8 RETURNING id`
      : `INSERT INTO marketing_campaigns(name,objective,team,lead_user_id,status,starts_on,ends_on) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, recordId ? [...values,recordId] : values)).rows[0];
    await q.query(`DELETE FROM crm_strategy_targets t USING crm_companies c WHERE t.strategy_id=$1 AND c.id=t.company_id AND ${isBrandSql("c")}=$2::boolean`, [saved.id, kind === "brand"]);
    for (const target of input.targets) await q.query("INSERT INTO crm_strategy_targets(strategy_id,company_id,reason,contact_ids) VALUES($1,$2,$3,$4)", [saved.id,target.companyId,target.reason,target.contactIds]);
    return { ok: true, id: saved.id };
  });
}

export async function saveEngagementEvent(db: TransactionPool, input: EventInput, recordId?: string, kind: EngagementKind = "landlord") {
  return transaction(db, async q => {
    const brand=kind==="brand";
    await assertOwner(q,input.ownerId); await assertCompanies(q,input.companies.map(company=>company.companyId),kind);
    // With no brand on it the event would leave the Brand CRM.
    if (brand && !input.companies.length) throw new EngagementError(400, "Add at least one brand to a brand event");
    await assertContacts(q,input.guests.map(guest=>guest.contactId),input.companies.map(company=>company.companyId),kind);
    await assertStrategyIds(q,input.strategyIds,kind);
    if (recordId) {
      assertVersion(await assertEventVisible(q,recordId,true),input.expectedUpdatedAt);
      await assertRecordInKind(q,"crm_event_companies","event_id",recordId,kind);
    }
    const values=[input.title,input.kind,input.startsAt,input.endsAt,input.location,input.description,input.ownerId,input.status,input.sourceUrl,input.dateConfirmed,input.outcome];
    const saved=(await q.query(recordId ? `UPDATE marketing_events SET title=$1,kind=$2,starts_at=$3,ends_at=$4,location=$5,description=$6,lead_user_id=$7,status=$8,external_url=$9,date_confirmed=$10,outcome=$11,updated_at=now() WHERE id=$12 RETURNING id`
      : `INSERT INTO marketing_events(title,kind,starts_at,ends_at,location,description,lead_user_id,status,external_url,date_confirmed,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,recordId?[...values,recordId]:values)).rows[0];
    // CRM statuses are explicit. Legacy Marketing attendee IDs are preserved;
    // they do not imply acceptance or attendance and are not silently imported.
    // Only this view's companies, guests and strategy links are replaced.
    const guestInKind=`${isBrandSql("c")}=$2::boolean`;
    const formerGuests=(await q.query(`SELECT g.contact_id FROM crm_event_guests g JOIN crm_contacts p ON p.id=g.contact_id LEFT JOIN crm_companies c ON c.id=p.company_id WHERE g.event_id=$1 AND ${guestInKind}`,[saved.id,brand])).rows.map(row=>row.contact_id);
    await q.query(`UPDATE marketing_events SET attendee_contact_ids=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(attendee_contact_ids,'{}')||$2::text[]) value WHERE NOT(value=ANY($3::text[])) OR value=ANY($2::text[])) WHERE id=$1`,[saved.id,input.guests.map(guest=>guest.contactId),formerGuests]);
    await q.query(`DELETE FROM crm_event_strategies l USING marketing_campaigns s WHERE l.event_id=$1 AND s.id=l.strategy_id AND ${linkedInKind("crm_strategy_targets","strategy_id","s.id","$2::boolean")}`,[saved.id,brand]);
    await q.query(`DELETE FROM crm_event_guests g USING crm_contacts p LEFT JOIN crm_companies c ON c.id=p.company_id WHERE g.event_id=$1 AND p.id=g.contact_id AND ${guestInKind}`,[saved.id,brand]);
    await q.query(`DELETE FROM crm_event_companies l USING crm_companies c WHERE l.event_id=$1 AND c.id=l.company_id AND ${isBrandSql("c")}=$2::boolean`,[saved.id,brand]);
    for(const company of input.companies)await q.query("INSERT INTO crm_event_companies(event_id,company_id,reason) VALUES($1,$2,$3)",[saved.id,company.companyId,company.reason]);
    for(const strategyId of input.strategyIds)await q.query("INSERT INTO crm_event_strategies(event_id,strategy_id) VALUES($1,$2)",[saved.id,strategyId]);
    for(const guest of input.guests)await q.query("INSERT INTO crm_event_guests(event_id,contact_id,status) VALUES($1,$2,$3)",[saved.id,guest.contactId,guest.status]);
    return {ok:true,id:saved.id};
  });
}

export async function createEngagementAction(db: TransactionPool,input: ActionInput,actor:Actor,planDeps:ActionPlanDeps={}) {
  return transaction(db,async q=>{
    await assertOwner(q,input.ownerId);await assertCompanies(q,[input.companyId]);
    if(input.strategyId && !(await q.query("SELECT 1 FROM crm_strategy_targets WHERE strategy_id=$1 AND company_id=$2",[input.strategyId,input.companyId])).rows.length)throw new EngagementError(400,`Choose a strategy linked to this ${await companyNoun(q,input.companyId)}`);
    if(input.eventId){await assertEventVisible(q,input.eventId);if(!(await q.query("SELECT 1 FROM crm_event_companies WHERE event_id=$1 AND company_id=$2",[input.eventId,input.companyId])).rows.length)throw new EngagementError(400,`Choose an event linked to this ${await companyNoun(q,input.companyId)}`);}
    const sourceInterviewId=input.sourceInterviewId||null,sourceQuestionId=input.sourceQuestionId||null;
    if(!!sourceInterviewId!==!!sourceQuestionId)throw new EngagementError(400,"Select both the CRM interview and the question it came from");
    if(sourceInterviewId && sourceQuestionId){
      // A company mention is evidence for a proposed action, not an automatic
      // task. Recheck the current saved answer so stale or cross-company links
      // cannot be submitted merely by changing the IDs in a form.
      await q.query("SELECT id FROM crm_interviews WHERE id=$1 FOR SHARE",[sourceInterviewId]);
      const mentions=await getLandlordInterviewMentions(input.companyId,{pool:q});
      if(!mentions.some(mention=>mention.interviewId===sourceInterviewId && mention.questionId===sourceQuestionId && mention.companyId===input.companyId))
        throw new EngagementError(400,`This interview answer is no longer linked to the selected ${await companyNoun(q,input.companyId)}. Reopen the note before creating an action.`);
    }
    const plan=await checkedActionPlan(q,input.companyId,actionPlanOf(input),planDeps);
    const task=(await q.query(`INSERT INTO user_tasks(user_id,title,description,due_date,status,category,assigned_by_user_id,assigned_by_name,completed_at)
      VALUES($1,$2,$3,$4,$5,'crm',$6,$7,CASE WHEN $5='done' THEN now() ELSE NULL END) RETURNING id`,[input.ownerId,input.title,input.notes,input.dueAt,input.status,actor.id,actor.name])).rows[0];
    await q.query("INSERT INTO crm_engagement_actions(task_id,company_id,strategy_id,event_id,source_interview_id,source_question_id) VALUES($1,$2,$3,$4,$5,$6)",[task.id,input.companyId,input.strategyId,input.eventId,sourceInterviewId,sourceQuestionId]);
    // The task itself is never linked to the property or a deal: that would
    // put its title on the landlord's activity board whatever the share marker says.
    if(hasActionPlan(plan))await q.query(WRITE_ACTION_PLAN,actionPlanValues(task.id,plan));
    return {ok:true,id:task.id};
  });
}

// BGP changes where a brand action sits, who it is shown to and who it waits
// on. A field left out keeps its value; choosing another scheme without a
// unit clears the unit, and a unit on its own brings its scheme with it.
export async function saveEngagementActionPlan(db:TransactionPool,actionId:string,patch:ActionPlanInput,planDeps:ActionPlanDeps={}) {
  return transaction(db,async q=>{
    const row=(await q.query(`SELECT a.company_id,a.event_id,to_jsonb(a) AS action_plan,u.role AS raised_by_role FROM crm_engagement_actions a
      JOIN user_tasks t ON t.id=a.task_id LEFT JOIN users u ON u.id=t.assigned_by_user_id WHERE a.task_id=$1 FOR UPDATE OF a`,[actionId])).rows[0];
    if(!row)throw new EngagementError(404,"This action no longer exists");
    if(row.event_id)await assertEventVisible(q,row.event_id);
    const held=row.action_plan||{};
    const next:ActionPlan={
      propertyId:patch.propertyId!==undefined?patch.propertyId||null:patch.tenancyUnitId?null:held.property_id||null,
      tenancyUnitId:patch.tenancyUnitId!==undefined?patch.tenancyUnitId||null:patch.propertyId!==undefined?null:held.tenancy_unit_id||null,
      sharedWithCompanyId:patch.sharedWithCompanyId!==undefined?patch.sharedWithCompanyId||null:held.shared_with_company_id||null,
      waitingOnParty:patch.waitingOnParty!==undefined?patch.waitingOnParty||null:held.waiting_on_party||null,
    };
    // A change that leaves the sharing and the place alone (who it waits on) is not held up by them.
    const placeOrShareChanged=next.sharedWithCompanyId!==(held.shared_with_company_id||null)||next.propertyId!==(held.property_id||null)||next.tenancyUnitId!==(held.tenancy_unit_id||null);
    const plan=await checkedActionPlan(q,row.company_id,next,planDeps,isClientRole(row.raised_by_role),placeOrShareChanged);
    await q.query(WRITE_ACTION_PLAN,actionPlanValues(actionId,plan));
    return {ok:true,id:actionId};
  });
}

// The brand a client request is about: ?companyId on reads, body.companyId
// on a new action, the action's own company on a status change.
async function clientPlanCompany(pool:Queryable,req:Request):Promise<string|null>{
  if(req.method==="GET")return typeof req.query.companyId==="string"&&req.query.companyId?req.query.companyId:null;
  if(req.method==="POST")return typeof req.body?.companyId==="string"?req.body.companyId:null;
  const m=req.path.match(/^\/actions\/([^/]+)$/);
  if(!m)return null;
  return (await pool.query("SELECT company_id FROM crm_engagement_actions WHERE task_id=$1",[m[1]])).rows[0]?.company_id||null;
}

// What a client login may see of a brand's plan: the actions its own
// company's logins raised, and the actions BGP chose to show that company.
// Strategies, events and BGP's other actions are shared records across every
// client and carry BGP's free text, so none of them leave the staff view
// (review, 2026-11-12: Hammerson could read Landsec's actions and BGP's
// notes). An action BGP shared (its share marker names the viewer's company)
// arrives as title, due date, owner name, status, scheme and unit, marked as
// raised by BGP: never its notes, its strategy or event, who it waits on or
// any id of BGP's. A joint agent is given one only when it
// sits at one of their own schemes.
export interface ClientShare { companyId: string; properties: Set<string>; ownSchemesOnly: boolean }
export function clientPlanView(data:EngagementData,ownActionIds:Set<string>,share?:ClientShare):EngagementData{
  const actions:EngagementAction[]=[];
  for(const a of data.actions){
    if(ownActionIds.has(a.id)){
      // The client's own request, as it always was: nothing BGP added to it since.
      const {propertyId,schemeName,tenancyUnitId,unitLabel,sharedWithCompanyId,sharedWithName,waitingOnParty,waitingSince,raisedBy,...own}=a;
      actions.push({...own,source:null,strategyId:null,eventId:null});
      continue;
    }
    if(!share||a.raisedBy!=="bgp"||!a.sharedWithCompanyId||a.sharedWithCompanyId!==share.companyId)continue;
    const placed=!!a.propertyId&&share.properties.has(a.propertyId);
    if(share.ownSchemesOnly&&!placed)continue;
    actions.push({id:a.id,title:a.title,notes:null,dueAt:a.dueAt,status:a.status,canEdit:false,ownerId:"",ownerName:a.ownerName,
      companyId:a.companyId,companyName:a.companyName,strategyId:null,eventId:null,source:null,
      schemeName:placed?a.schemeName||null:null,unitLabel:placed?a.unitLabel||null:null,raisedBy:"bgp"});
  }
  return {strategies:[],events:[],actions};
}

// Which of BGP's shared actions this client login may be given. A login of a
// client with no Brand CRM gets none. If the schemes cannot be read, none.
async function clientShareFor(deps:ActionPlanDeps&{viewerSchemeKeys?:(req:Request)=>Promise<string[]|null>},req:Request,scope:string):Promise<ClientShare>{
  const none:ClientShare={companyId:scope,properties:new Set(),ownSchemesOnly:true};
  try {
    const partner=(await deps.sharePartners?.()||[]).find(candidate=>candidate.id===scope);
    if(!partner)return none;
    // null = every scheme (a full client login, an asset manager included); a list = a joint agent's own.
    const own=await deps.viewerSchemeKeys?.(req)??null;
    return {companyId:scope,ownSchemesOnly:!!own,properties:new Set(partner.schemes.filter(scheme=>!own||own.includes(scheme.key)).flatMap(scheme=>scheme.propertyIds))};
  }catch {return none;}
}

// The actions on a brand raised by the viewer or by another login of the
// viewer's own client company (author's team resolves to the same scope).
async function clientOwnActionIds(deps:{pool:Queryable;companyIdForClientTeam?:(team:string)=>Promise<string|null>},companyId:string,scope:string,viewerId:string):Promise<Set<string>>{
  const rows=(await deps.pool.query(`SELECT t.id,t.assigned_by_user_id,u.team,u.role FROM crm_engagement_actions a JOIN user_tasks t ON t.id=a.task_id
    LEFT JOIN users u ON u.id=t.assigned_by_user_id WHERE a.company_id=$1`,[companyId])).rows;
  const own=new Set<string>();const teamCompany=new Map<string,string|null>();
  for(const row of rows){
    // Only a client login's action is a client request: BGP staff viewing as
    // the client do not turn their own BGP actions into the client's.
    if(String(row.role||"").toLowerCase()!=="client")continue;
    if(row.assigned_by_user_id===viewerId){own.add(row.id);continue;}
    if(!row.team)continue;
    if(!teamCompany.has(row.team))teamCompany.set(row.team,(await deps.companyIdForClientTeam?.(row.team))??null);
    if(teamCompany.get(row.team)===scope)own.add(row.id);
  }
  return own;
}

export function createCrmEngagementRouter(deps:{pool:TransactionPool;requireAuth:RequestHandler;resolveScope:(req:Request)=>Promise<string|null>;isClientVisibleBrand?:(companyId:string,scope:string|null)=>Promise<boolean>;companyIdForClientTeam?:(team:string)=>Promise<string|null>;schemaReady?:Promise<boolean>;
  // The clients a brand action can be shown to, with their schemes, and the
  // schemes of the login asking when it is held to its own (null = all).
  sharePartners?:()=>Promise<SharePartner[]>;viewerSchemeKeys?:(req:Request)=>Promise<string[]|null>}) {
  const router=Router();
  router.use(deps.requireAuth);
  router.use(async(req,res,next)=>{
    try {
      const userId=req.session?.userId||(req as any).tokenUserId;
      const actor=userId?(await deps.pool.query("SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE id=$1",[userId])).rows[0]:null;
      const scope=await deps.resolveScope(req);
      if(!isEngagementStaff(actor,scope)){
        // A client login (Landsec) on a brand in its slice adds actions
        // for a BGP owner and sees the ones its own company raised (Woody,
        // 2026-11-11: "see it, add actions"); the rest of the plan is BGP's.
        const companyId=await clientPlanCompany(deps.pool,req);
        const allowed=!!actor&&actor.is_active===true&&!!scope&&!!companyId
          &&(await deps.isClientVisibleBrand?.(companyId,scope))===true
          &&((req.method==="GET"&&(req.path==="/"||req.path==="/options"))||(req.method==="POST"&&req.path==="/actions")||(req.method==="PATCH"&&/^\/actions\/[^/]+$/.test(req.path)));
        if(!allowed)return res.status(403).json({error:"CRM plans are available in the BGP staff view only"});
        res.locals.engagementClient=true;res.locals.engagementScope=scope;
      }
      if(deps.schemaReady && !await deps.schemaReady)return res.status(503).json({error:"CRM planning is not ready yet. Please try again later."});
      res.locals.engagementActor=actor;next();
    }catch {res.status(503).json({error:"Unable to check CRM planning access"});}
  });
  const handle=(work:(req:Request,actor:Actor)=>Promise<any>):RequestHandler=>async(req,res)=>{
    try {res.json(await work(req,res.locals.engagementActor));}
    catch(error:any){if(error instanceof z.ZodError)return res.status(400).json({error:error.issues[0]?.message||"Check the form"});res.status(error.status||500).json({error:error instanceof EngagementError?error.message:"CRM plans could not be saved or loaded"});}
  };
  // ?kind=landlord|brand picks the Landlord CRM or the Brand CRM. A client
  // login never chooses a view: its branch answers as it did before.
  const kindOf=(req:Request):EngagementKind|undefined=>(req as any).res?.locals?.engagementClient?undefined:kindSchema.parse(req.query.kind);
  router.get("/options",handle(async req=>{
    const companyId=typeof req.query.companyId==="string"?req.query.companyId:null;
    const options=await getCrmEngagementOptions(deps.pool,companyId,kindOf(req));
    // A client gets the BGP owner list and the one brand it asked about:
    // never the landlord catalogue or anyone's contacts.
    if((req as any).res?.locals?.engagementClient)return {staff:options.staff,companies:options.companies.filter(c=>c.id===companyId),contacts:[]};
    // BGP planning a brand also gets who an action can be shown to and the
    // schemes it can sit at. The Landlord CRM's answer is what it was.
    const kind=kindOf(req);
    if(deps.sharePartners&&(kind==="brand"||(!kind&&companyId&&await companyNoun(deps.pool,companyId)==="brand"))){
      try {
        options.sharePartners=(await deps.sharePartners()).map(partner=>({id:partner.id,name:partner.name,
          schemes:partner.schemes.filter(scheme=>!!scheme.propertyId).map(scheme=>({key:scheme.key,name:scheme.name,propertyId:scheme.propertyId!,propertyIds:scheme.propertyIds}))}));
      }catch {/* the form then has no scheme, sharing or waiting-on fields */}
    }
    return options;
  }));
  router.get("/",handle(async(req,actor)=>{
    const companyId=req.query.companyId===undefined?undefined:id.parse(req.query.companyId);
    const data=await getCrmEngagementData(companyId,{pool:deps.pool,viewerId:actor.id,sharePartners:deps.sharePartners},kindOf(req));
    const locals=(req as any).res?.locals;
    if(!locals?.engagementClient)return data;
    if(!companyId||!locals.engagementScope)return {strategies:[],events:[],actions:[]};
    return clientPlanView(data,await clientOwnActionIds(deps,companyId,locals.engagementScope,actor.id),await clientShareFor(deps,req,locals.engagementScope));
  }));
  // A strategy or event is saved from one view: the Landlord CRM unless the
  // request says ?kind=brand.
  const saveKind=(req:Request):EngagementKind=>kindOf(req)||"landlord";
  router.post("/strategies",handle(async req=>{const kind=saveKind(req);return saveEngagementStrategy(deps.pool,INPUT_SCHEMAS[kind].strategy.parse(req.body),undefined,kind);}));
  router.put("/strategies/:id",handle(async req=>{const kind=saveKind(req);return saveEngagementStrategy(deps.pool,INPUT_SCHEMAS[kind].strategy.parse(req.body),id.parse(req.params.id),kind);}));
  router.post("/events",handle(async req=>{const kind=saveKind(req);return saveEngagementEvent(deps.pool,INPUT_SCHEMAS[kind].event.parse(req.body),undefined,kind);}));
  router.put("/events/:id",handle(async req=>{const kind=saveKind(req);return saveEngagementEvent(deps.pool,INPUT_SCHEMAS[kind].event.parse(req.body),id.parse(req.params.id),kind);}));
  router.post("/actions",handle((req,actor)=>{
    const input=actionInputSchema.parse(req.body);
    // A client action never attaches to BGP's strategies, events or interviews,
    // and only BGP places an action on the plan, shares it or says who it waits on.
    if((req as any).res?.locals?.engagementClient)Object.assign(input,{strategyId:null,eventId:null,sourceInterviewId:null,sourceQuestionId:null,
      propertyId:null,tenancyUnitId:null,sharedWithCompanyId:null,waitingOnParty:null});
    return createEngagementAction(deps.pool,input,actor,deps);
  }));
  // The status is the owner's or the assigner's to change. The plan fields
  // (scheme, unit, shown to, waiting on) are any BGP colleague's; a client
  // login may send the status and nothing else.
  router.patch("/actions/:id",handle(async(req,actor)=>{
    const {status,...plan}=((req as any).res?.locals?.engagementClient?actionStatusSchema:actionPatchSchema).parse(req.body) as z.infer<typeof actionPatchSchema>;
    const actionId=id.parse(req.params.id);
    if(status!==undefined){
      const linked=(await deps.pool.query(`SELECT a.event_id FROM crm_engagement_actions a JOIN user_tasks t ON t.id=a.task_id WHERE t.id=$1 AND(t.user_id=$2 OR t.assigned_by_user_id=$2)`,[actionId,actor.id])).rows[0];
      if(!linked)throw new EngagementError(403,"Only the owner or person who assigned this action can update it");
      if(linked.event_id)await assertEventVisible(deps.pool,linked.event_id);
    }
    if(Object.values(plan).some(field=>field!==undefined))await saveEngagementActionPlan(deps.pool,actionId,plan,deps);
    if(status===undefined)return {ok:true,id:actionId};
    const row=(await deps.pool.query(`UPDATE user_tasks t SET status=$1,completed_at=CASE WHEN $1='done' THEN now() ELSE NULL END
      WHERE t.id=$2 AND (t.user_id=$3 OR t.assigned_by_user_id=$3) AND EXISTS(SELECT 1 FROM crm_engagement_actions a WHERE a.task_id=t.id) RETURNING t.id`,[status,actionId,actor.id])).rows[0];
    if(!row)throw new EngagementError(403,"Only the owner or person who assigned this action can update it");
    return {ok:true,id:row.id};
  }));
  return router;
}

export async function registerCrmEngagementRoutes(app:Express,schemaReady?:Promise<boolean>) {
  const [{pool},{requireAuth},{resolveCompanyScope}]=await Promise.all([import("./db"),import("./auth"),import("./company-scope")]);
  const {isClientVisibleBrand,getCompanyIdForClientTeam}=await import("./company-scope");
  const [{landsecCompanyId,resolveLandsecPortfolio},{getLandsecAccess},{RESTRICTED_LANDSEC_ROLES}]=await Promise.all([import("./landsec-schemes"),import("./landsec-access"),import("../shared/landsec")]);
  // Landsec is the one client with a Brand CRM, so the one a brand action can
  // be shown to; its schemes come from the registry (server/landsec-schemes.ts).
  const sharePartners=async():Promise<SharePartner[]>=>{
    const companyId=await landsecCompanyId();
    if(!companyId)return [];
    const [company,portfolio]=await Promise.all([pool.query("SELECT name FROM crm_companies WHERE id=$1",[companyId]),resolveLandsecPortfolio(companyId)]);
    return [{id:companyId,name:company.rows[0]?.name||"Landsec",schemes:portfolio.schemes.map(scheme=>({key:scheme.key,name:scheme.name,propertyId:scheme.canonicalId,propertyIds:scheme.properties.map(property=>property.id)}))}];
  };
  // A joint agent is held to their own schemes.
  const viewerSchemeKeys=async(req:Request)=>{
    const access=await getLandsecAccess(req);
    return access&&RESTRICTED_LANDSEC_ROLES.includes(access.role)?access.schemes||[]:null;
  };
  app.use("/api/crm/engagement",createCrmEngagementRouter({pool,requireAuth,resolveScope:resolveCompanyScope,isClientVisibleBrand,companyIdForClientTeam:getCompanyIdForClientTeam,schemaReady,sharePartners,viewerSchemeKeys}));
}
