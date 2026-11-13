// The one write door for the tenant on a tenancy schedule row: the brand
// (tenant_company_id), the company on the lease (tenant_entity_id, a
// crm_trading_entities.id; NOT crm_deals.tenant_entity_id, which is a Xero
// ContactID), the lease name and the trading name. The rules are
// planTenantWrite in shared/tenant-entity.ts; this file reads the facts, acts
// on the answer and records every change to the company on the lease in
// investment_comp_migration_log (read only by staff back-fill and undo code).
// Apart from the admin back-fill and the two completion-revert clears, nothing
// else sets tenant_entity_id.
import {
  nextTenantText, planTenantWrite, TENANT_ENTITY_REFUSALS,
  type TenantRefusalCode, type TenantRowState, type TenantViewer, type TenantWriteFacts, type TenantWriteInput, type TenantWriteNote,
} from "@shared/tenant-entity";
import { brandNameKeySql, resolveBrandMatchSql } from "./tenant-brand-resolver";

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Db = Queryable & { connect?: () => Promise<Queryable & { release: () => void }>; release?: () => void };

export type TenantActor = { userId: string; name: string; viewer: TenantViewer } | { system: string };

export class TenantWriteRefused extends Error {
  constructor(public code: TenantRefusalCode, public status = TENANT_ENTITY_REFUSALS[code].status) {
    super(TENANT_ENTITY_REFUSALS[code].message);
  }
}

const TENANT_COLUMNS = "tenant_name, trading_name, tenant_company_id, tenant_entity_id";

// A pool gets its own transaction; a client is already inside the caller's.
async function inTransaction<T>(db: Db, work: (q: Queryable) => Promise<T>): Promise<T> {
  if (typeof db.release === "function" || typeof db.connect !== "function") return work(db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out = await work(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const aliasKeys = (company: string) => `SELECT ${brandNameKeySql("c.name")} AS k FROM crm_companies c WHERE c.id = ${company}
         UNION ALL
         SELECT ${brandNameKeySql("e->>'name'")} FROM crm_companies c,
                jsonb_array_elements(CASE WHEN jsonb_typeof(c.trading_entities) = 'array' THEN c.trading_entities ELSE '[]'::jsonb END) e
          WHERE c.id = ${company}`;

const entityWithBrand = (entity: string) => `SELECT json_build_object('id', te.id, 'parentId', CASE WHEN p.merged_into_id IS NULL THEN p.id ELSE s.id END)
         FROM crm_trading_entities te
         LEFT JOIN crm_companies p ON p.id = te.parent_company_id
         LEFT JOIN crm_companies s ON s.id = p.merged_into_id AND s.merged_into_id IS NULL
        WHERE te.id = ${entity}`;

// One query: the keys of the old and new names, the company already on the
// row, the brand and company picked, and the one brand the new names match
// (on the trading name, else the lease name, as the schedule's resolver reads
// them: a trading name that matches nothing never falls back to the lease name).
const FACTS_SQL = `SELECT
    ${brandNameKeySql("$1::text")} AS old_trading_key,
    ${brandNameKeySql("$2::text")} AS old_lease_key,
    ${brandNameKeySql("$3::text")} AS new_trading_key,
    ${brandNameKeySql("$4::text")} AS new_lease_key,
    (SELECT ${brandNameKeySql("te.name")} FROM crm_trading_entities te WHERE te.id = $6::text) AS entity_key,
    EXISTS (SELECT 1 FROM (${aliasKeys("$5::text")}) a WHERE a.k <> '' AND a.k IN (${brandNameKeySql("$1::text")}, ${brandNameKeySql("$2::text")})) AS stored_matches_old,
    EXISTS (SELECT 1 FROM (${aliasKeys("$5::text")}) a WHERE a.k <> '' AND a.k IN (${brandNameKeySql("$3::text")}, ${brandNameKeySql("$4::text")})) AS stored_matches_new,
    ${resolveBrandMatchSql("coalesce(nullif(btrim($3::text), ''), nullif(btrim($4::text), ''), '')")} AS name_match,
    EXISTS (SELECT 1 FROM crm_companies c WHERE c.id = $5::text AND c.merged_into_id IS NOT NULL) AS stored_brand_merged,
    (SELECT json_build_object('id', c.id, 'mergedInto', c.merged_into_id, 'survivor', s.id)
       FROM crm_companies c LEFT JOIN crm_companies s ON s.id = c.merged_into_id AND s.merged_into_id IS NULL
      WHERE c.id = $7::text) AS picked_brand,
    (${entityWithBrand("$8::text")}) AS entity,
    (${entityWithBrand("$6::text")}) AS current_entity`;

async function readFacts(q: Queryable, current: TenantRowState, input: TenantWriteInput): Promise<TenantWriteFacts> {
  const next = nextTenantText(current, input);
  const r = (await q.query(FACTS_SQL, [
    current.trading_name, current.tenant_name, next.trading_name, next.tenant_name,
    current.tenant_company_id, current.tenant_entity_id,
    input.companyId ?? null, input.entityId ?? null,
  ])).rows[0];
  return {
    pickedBrand: r.picked_brand ?? null,
    entity: r.entity ?? null,
    currentEntity: r.current_entity ?? null,
    oldLeaseKey: r.old_lease_key ?? "",
    newLeaseKey: r.new_lease_key ?? "",
    oldTradingKey: r.old_trading_key ?? "",
    newTradingKey: r.new_trading_key ?? "",
    entityKey: r.entity_key ?? "",
    storedBrandMatchesOldNames: r.stored_matches_old === true,
    storedBrandMatchesNewNames: r.stored_matches_new === true,
    nameMatch: r.name_match ?? null,
    storedBrandMerged: r.stored_brand_merged === true,
  };
}

const isPerson = (actor: TenantActor): actor is Extract<TenantActor, { userId: string }> => "userId" in actor;
const actorName = (actor: TenantActor) => (isPerson(actor) ? actor.name || actor.userId : actor.system);
const auditBatch = (actor: TenantActor) => (isPerson(actor) ? "tenant-entity-door" : "tenant-entity-system");

async function audit(q: Queryable, actor: TenantActor, table: string, recordId: string, action: string, prior: Record<string, unknown> | null, note: string) {
  await q.query(
    `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note) VALUES ($1, $2, $3, $4, $5, $6)`,
    [auditBatch(actor), table, recordId, action, prior ? JSON.stringify(prior) : null, `${actorName(actor)}: ${note}`],
  );
}

/** Make a company on the lease under a brand, or hand back the one already
 *  there by that name. Never changes an existing company's notes or Companies
 *  House number, never writes the brand's trading_entities list (so a lease
 *  name stays off client brand pages, and a deleted company stays deleted at
 *  boot), never sets is_default. */
export async function insertTradingEntity(db: Queryable, entity: { parentCompanyId: string; name: string; companiesHouseNumber?: string | null }): Promise<{ id: string; created: boolean }> {
  await db.query("SAVEPOINT insert_trading_entity");
  try {
    const made = await db.query(
      `INSERT INTO crm_trading_entities (parent_company_id, name, companies_house_number)
       VALUES ($1, $2, $3)
       ON CONFLICT (parent_company_id, LOWER(name)) DO NOTHING
       RETURNING id`,
      [entity.parentCompanyId, entity.name, entity.companiesHouseNumber || null],
    );
    await db.query("RELEASE SAVEPOINT insert_trading_entity");
    if (made.rows[0]) return { id: made.rows[0].id, created: true };
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT insert_trading_entity");
    throw e;
  }
  const existing = await db.query(
    `SELECT id FROM crm_trading_entities WHERE parent_company_id = $1 AND LOWER(name) = LOWER($2)`,
    [entity.parentCompanyId, entity.name],
  );
  return { id: existing.rows[0].id, created: false };
}

const ENTITY_NOTES: TenantWriteNote[] = ["entity_cleared_vacated", "entity_picked", "entity_unlinked", "entity_created", "entity_cleared_lease_name_changed", "entity_cleared_brand_changed"];

async function apply(q: Queryable, rowId: string, current: TenantRowState, input: TenantWriteInput, actor: TenantActor) {
  const viewer: TenantViewer = isPerson(actor) ? actor.viewer : "staff";
  const facts = await readFacts(q, current, input);
  const plan = planTenantWrite(current, input, facts, viewer);
  if (plan.refusal) throw new TenantWriteRefused(plan.refusal);
  const set = { ...plan.set };
  if (plan.create) {
    const made = await insertTradingEntity(q, plan.create);
    set.tenant_entity_id = made.id;
    if (made.created) {
      await audit(q, actor, "crm_trading_entities", made.id, "entity_created", null,
        `entity_created under ${plan.create.parentCompanyId} for schedule row ${rowId}`);
    }
  }
  const row = (await q.query(
    `UPDATE tenancy_schedule_units
        SET tenant_name = $2, trading_name = $3, tenant_company_id = $4, tenant_entity_id = $5, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [rowId, set.tenant_name, set.trading_name, set.tenant_company_id, set.tenant_entity_id],
  )).rows[0];
  if (set.tenant_entity_id !== current.tenant_entity_id) {
    const action = !current.tenant_entity_id ? "entity_linked" : !set.tenant_entity_id ? "entity_cleared" : "entity_changed";
    const why = plan.notes.filter(n => ENTITY_NOTES.includes(n)).join(", ") || action;
    await audit(q, actor, "tenancy_schedule_units", rowId, action,
      { tenant_entity_id: current.tenant_entity_id, tenant_company_id: current.tenant_company_id }, why);
  }
  return { row, notes: plan.notes };
}

async function lockRow(q: Queryable, rowId: string): Promise<TenantRowState> {
  const current = (await q.query(`SELECT ${TENANT_COLUMNS} FROM tenancy_schedule_units WHERE id = $1 FOR UPDATE`, [rowId])).rows[0];
  if (!current) throw new TenantWriteRefused("ROW_NOT_FOUND");
  return current;
}

/** Set a row's tenant: what a person picked or typed (input fields left out
 *  are unchanged, null clears). Throws TenantWriteRefused with the code and
 *  wording from TENANT_ENTITY_REFUSALS. */
export async function setTenancyTenant(db: Db, rowId: string, input: TenantWriteInput, actor: TenantActor): Promise<{ row: any; notes: TenantWriteNote[] }> {
  return inTransaction(db, async q => apply(q, rowId, await lockRow(q, rowId), input, actor));
}

/** For a caller that has already written the names itself: the same rules,
 *  from the row's four tenant columns as they were before that write. */
export async function relinkTenantAfterNameEdit(db: Db, rowId: string, before: TenantRowState, actor: TenantActor): Promise<{ row: any; notes: TenantWriteNote[] }> {
  return inTransaction(db, async q => {
    const now = await lockRow(q, rowId);
    const input: TenantWriteInput = { tenantName: now.tenant_name, tradingName: now.trading_name };
    return apply(q, rowId, { ...now, tenant_name: before.tenant_name, trading_name: before.trading_name }, input, actor);
  });
}
