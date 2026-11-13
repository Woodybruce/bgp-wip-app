// The admin back-fill for the company on the lease (server/tenant-entity-backfill.ts)
// against real SQL in a throwaway schema. Skipped unless PROPERTY_PAGE_DATABASE_URL
// names a LOCAL PostgreSQL database that holds the app's tables, for example:
//   PROPERTY_PAGE_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/<a database of your own> \
//     node --import tsx --test server/tenant-entity-backfill.test.ts
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

let backfill: typeof import("./tenant-entity-backfill");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";   // the resolver's pool is never asked a question here
  backfill = await import("./tenant-entity-backfill");
});
const runTenantEntityBackfill: typeof import("./tenant-entity-backfill").runTenantEntityBackfill = (...a) => backfill.runTenantEntityBackfill(...a);
const undoTenantEntityBackfill: typeof import("./tenant-entity-backfill").undoTenantEntityBackfill = (...a) => backfill.undoTenantEntityBackfill(...a);
const DRY_RUN_KEY = "tenant_entity_backfill:dry_run";
const RUNS_KEY = "tenant_entity_backfill:runs";
const pairKey = (brandId: string, leaseKey: string) => `${brandId}::${leaseKey}`;

const databaseUrl = process.env.PROPERTY_PAGE_DATABASE_URL;
const skip = !databaseUrl ? "set PROPERTY_PAGE_DATABASE_URL to a local PostgreSQL database that holds the app's tables to run the SQL checks"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "PROPERTY_PAGE_DATABASE_URL must be a local database" : false;

const TABLES = ["crm_companies", "crm_trading_entities", "crm_properties", "tenancy_schedule_units", "investment_comp_migration_log", "system_settings", "users"];
type Pool = InstanceType<typeof pg.Pool>;
type Insert = (table: string, row: Record<string, any>) => Promise<void>;

// One throwaway schema per test, so each starts empty; dropped whatever happens.
async function withSchema(work: (db: Pool, insert: Insert) => Promise<void>) {
  const schema = "tenant_entity_backfill_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: databaseUrl });
  const db = new pg.Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},pg_catalog` });
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) await admin.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    await admin.query(`ALTER TABLE ${schema}.tenancy_schedule_units ADD COLUMN IF NOT EXISTS tenant_entity_id varchar`);
    // The audit log's id draws on the real table's sequence: never move that.
    await admin.query(`CREATE SEQUENCE ${schema}.audit_seq`);
    await admin.query(`ALTER TABLE ${schema}.investment_comp_migration_log ALTER COLUMN id SET DEFAULT nextval('${schema}.audit_seq')`);
    assert.deepEqual((await db.query(`SHOW search_path`)).rows, [{ search_path: `${schema},pg_catalog` }]);
    const insert: Insert = async (table, row) => {
      const cols = (await db.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_default IS NULL`, [schema, table])).rows;
      const full: Record<string, any> = { ...row };
      for (const c of cols) if (!(c.column_name in full)) {
        full[c.column_name] = /int|real|double|numeric/.test(c.data_type) ? 0 : c.data_type === "boolean" ? false : c.data_type === "ARRAY" ? [] : /json/.test(c.data_type) ? "{}" : /timestamp|date/.test(c.data_type) ? "2026-01-01" : `${table}-${c.column_name}`;
      }
      const keys = Object.keys(full);
      await db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map(k => full[k]));
    };
    await work(db, insert);
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

const ADMIN = "u-admin";
const row = (insert: Insert, id: string, over: Record<string, any>) =>
  insert("tenancy_schedule_units", { id, property_id: "p1", unit_number: id, status: "Occupied", ...over });

async function seed(insert: Insert) {
  await insert("users", { id: ADMIN, username: "woody", name: "Woody" });
  await insert("crm_properties", { id: "p1", name: "Bluewater" });
  await insert("crm_properties", { id: "p2", name: "Trinity Leeds" });
  await insert("crm_companies", { id: "zara", name: "Zara", company_type: "Tenant - Fashion" });
  await insert("crm_companies", { id: "next", name: "Next", company_type: "Tenant - Fashion" });
  await insert("crm_companies", { id: "costa", name: "Costa", company_type: "Tenant - Café" });
  await insert("crm_companies", { id: "pret", name: "Pret", company_type: "Tenant - Café" });
  await insert("crm_companies", { id: "pret-old", name: "Pret A Manger Old", company_type: "Tenant - Café", merged_into_id: "pret" });
  await insert("crm_companies", { id: "landsec", name: "Landsec Properties Ltd", company_type: "Landlord" });
  await insert("crm_companies", { id: "boots", name: "Boots", company_type: "Tenant - Retail" });
  await insert("crm_companies", { id: "fenwick", name: "Fenwick", company_type: "Tenant - Retail" });
  // Verified: a Companies House number, or the brand's default.
  await insert("crm_trading_entities", { id: "itx-uk", parent_company_id: "zara", name: "ITX UK Limited", companies_house_number: "01234567" });
  await insert("crm_trading_entities", { id: "zara-default", parent_company_id: "zara", name: "Zara Retail", is_default: true });
  // Not verified: a name only (a boot copy of the brand's list, say).
  await insert("crm_trading_entities", { id: "next-retail", parent_company_id: "next", name: "Next Retail Ltd" });
  // Two companies under one brand with one key.
  await insert("crm_trading_entities", { id: "costa-1", parent_company_id: "costa", name: "Costa Coffee Ltd", companies_house_number: "11111111" });
  await insert("crm_trading_entities", { id: "costa-2", parent_company_id: "costa", name: "Costa Coffee Limited", companies_house_number: "22222222" });
  // Filed under a brand that was merged into Pret: it counts as Pret's.
  await insert("crm_trading_entities", { id: "pret-eu", parent_company_id: "pret-old", name: "Pret A Manger (Europe) Ltd", companies_house_number: "33333333" });
  // The brand key drops a legal ending: "Boots Holdings plc" and "Boots Holdings
  // Limited" share "boots holdings", and "Fenwick Retail Group" and "Fenwick
  // Retail UK" share "fenwick retail", though each pair is two companies.
  await insert("crm_trading_entities", { id: "boots-hold", parent_company_id: "boots", name: "Boots Holdings Limited", companies_house_number: "44444444" });
  await insert("crm_trading_entities", { id: "fenwick-group", parent_company_id: "fenwick", name: "Fenwick Retail Group", companies_house_number: "55555555" });

  await row(insert, "r-link", { tenant_name: "ITX UK Limited", trading_name: "Zara", tenant_company_id: "zara" });
  await row(insert, "r-link2", { property_id: "p2", tenant_name: "ITX UK Ltd", trading_name: "ZARA", tenant_company_id: "zara" });
  await row(insert, "r-default", { tenant_name: "Zara Retail", trading_name: "Zara", tenant_company_id: "zara" });
  await row(insert, "r-pret", { tenant_name: "Pret A Manger (Europe) Limited", trading_name: "Pret", tenant_company_id: "pret" });
  await row(insert, "r-unverified", { tenant_name: "Next Retail Ltd", trading_name: "Next", tenant_company_id: "next" });
  // Same brand and lease name as r-link, but the trading name does not confirm the brand.
  await row(insert, "r-unconfirmed", { tenant_name: "ITX UK Limited", trading_name: "Pop-up", tenant_company_id: "zara" });
  await row(insert, "r-ambiguous", { tenant_name: "Costa Coffee Ltd", trading_name: "Costa", tenant_company_id: "costa" });
  await row(insert, "r-create", { tenant_name: "Bloggs Trading Ltd", trading_name: "Zara", tenant_company_id: "zara" });
  await row(insert, "r-person", { tenant_name: "Mr John Smith", trading_name: "Zara", tenant_company_id: "zara" });
  await row(insert, "r-landlord", { tenant_name: "Landsec Properties Limited", trading_name: "Zara", tenant_company_id: "zara" });
  await row(insert, "r-inbrand", { tenant_name: "Zara Limited", trading_name: "Zara", tenant_company_id: "zara" });
  await row(insert, "r-boots-ltd", { tenant_name: "Boots Holdings Ltd.", trading_name: "Boots", tenant_company_id: "boots" });
  await row(insert, "r-boots-plc", { tenant_name: "Boots Holdings PLC", trading_name: "Boots", tenant_company_id: "boots" });
  await row(insert, "r-fenwick", { tenant_name: "Fenwick Retail UK", trading_name: "Fenwick", tenant_company_id: "fenwick" });
  await row(insert, "r-nobrand", { tenant_name: "Someone Ltd", trading_name: "Someone" });
  // Not considered: no real lease name, archived, or already linked.
  await row(insert, "r-vacant", { tenant_name: "VACANT", trading_name: null });
  await row(insert, "r-archived", { status: "Archived", tenant_name: "ITX UK Limited", trading_name: "Zara", tenant_company_id: "zara" });
  await row(insert, "r-linked", { tenant_name: "ITX UK Limited", trading_name: "Zara", tenant_company_id: "zara", tenant_entity_id: "itx-uk" });
  // Linked to a company under another brand.
  await row(insert, "r-drift", { tenant_name: "Next Retail Ltd", trading_name: "Zara", tenant_company_id: "zara", tenant_entity_id: "next-retail" });
}

const entityOf = async (db: Pool, id: string) => (await db.query(`SELECT tenant_entity_id FROM tenancy_schedule_units WHERE id = $1`, [id])).rows[0].tenant_entity_id;
const tenantOf = async (db: Pool, id: string) =>
  (await db.query(`SELECT tenant_name, trading_name, tenant_company_id, tenant_entity_id FROM tenancy_schedule_units WHERE id = $1`, [id])).rows[0];
const refused = async (work: Promise<unknown>, status: number) => {
  const error: any = await work.then(() => null, e => e);
  assert.ok(error, `expected a refusal with ${status}`);
  assert.equal(error.status, status, error.message);
  return error;
};
const ITX = pairKey("zara", "itx uk");
const DEFAULT = pairKey("zara", "zara retail");
const PRET = pairKey("pret", "pret a manger europe");
const BOOTS = pairKey("boots", "boots holdings");
const apply = (db: any, over: Record<string, any>) => runTenantEntityBackfill(db, { dryRun: false, by: ADMIN, ...over });

test("every group is worked out as the plan's table says, in a fixed number of queries", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    let queries = 0;
    const counting: any = { query: (...a: any[]) => { queries += 1; return (db.query as any)(...a); } };
    const preview: any = await runTenantEntityBackfill(counting, { dryRun: true, by: ADMIN });
    const firstCount = queries;
    const grouped = Object.fromEntries(Object.entries(preview.groups).map(([g, v]: [string, any]) => [g, v.pairs.flatMap((p: any) => p.rows.map((r: any) => r.id)).sort()]));
    assert.deepEqual(grouped, {
      link_existing: ["r-boots-ltd", "r-default", "r-link", "r-link2", "r-pret"],
      entity_unverified: ["r-unverified"],
      brand_unconfirmed: ["r-unconfirmed"],
      create_candidates: ["r-create"],
      lease_in_brand_name: ["r-inbrand"],
      ambiguous: ["r-ambiguous", "r-boots-plc", "r-fenwick"],
      looks_like_person_or_landlord: ["r-landlord", "r-person"],
      no_brand: ["r-nobrand"],
      entity_drift: ["r-drift"],
    });
    assert.equal(preview.counts.considered, 15);
    assert.equal(preview.counts.link_existing, 5);
    const itx = preview.groups.link_existing.pairs.find((p: any) => p.key === ITX);
    assert.deepEqual([itx.rowCount, itx.brandName, itx.entities.map((e: any) => [e.id, e.companiesHouseNumber, e.verified])], [2, "Zara", [["itx-uk", "01234567", true]]]);
    assert.equal(preview.groups.link_existing.pairs.find((p: any) => p.key === PRET).entities[0].id, "pret-eu", "a company filed under a merged brand counts as the survivor's");
    assert.equal(preview.groups.ambiguous.pairs.find((p: any) => p.key === pairKey("costa", "costa coffee")).entities.length, 2);
    assert.equal(preview.groups.entity_drift.pairs[0].rows[0].entityId, "next-retail");
    // Recorded: the link_existing rows exactly as shown, nothing written to a row.
    const dry = (await db.query(`SELECT value FROM system_settings WHERE key = $1`, [DRY_RUN_KEY])).rows[0].value;
    assert.deepEqual(Object.keys(dry.pairs).sort(), [BOOTS, DEFAULT, ITX, PRET].sort());
    assert.deepEqual(dry.pairs[BOOTS].rows.map((r: any) => r.id), ["r-boots-ltd"], "a plc is not the Limited company that shares its key");
    assert.deepEqual(dry.pairs[ITX].rows.map((r: any) => r.id).sort(), ["r-link", "r-link2"]);
    assert.equal(await entityOf(db, "r-link"), null);
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM investment_comp_migration_log`)).rows[0].n), 0);

    // Fifty more rows cost no more queries.
    for (let i = 0; i < 50; i++) await row(insert, `extra-${i}`, { property_id: i % 2 ? "p1" : "p2", tenant_name: `Lease Co ${i} Ltd`, trading_name: "Zara", tenant_company_id: "zara" });
    queries = 0;
    await runTenantEntityBackfill(counting, { dryRun: true, by: ADMIN });
    assert.equal(queries, firstCount);

    // One property only.
    const scoped: any = await runTenantEntityBackfill(db, { dryRun: true, by: ADMIN, propertyId: "p2" });
    assert.deepEqual(scoped.groups.link_existing.pairs.flatMap((p: any) => p.rows.map((r: any) => r.id)), ["r-link2"]);
  });
});

test("Apply is refused without a preview in the last hour, and without ticked pairs", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    await refused(apply(db, { pairs: [ITX] }), 409);
    const mine: any = await runTenantEntityBackfill(db, { dryRun: true, by: ADMIN });
    await refused(apply(db, { pairs: [], previewedAt: mine.previewedAt }), 400);
    // Ticks from another admin's preview, from an earlier preview, or with no preview named.
    await refused(apply(db, { by: "u-other", pairs: [ITX], previewedAt: mine.previewedAt }), 409);
    await refused(apply(db, { pairs: [ITX] }), 409);
    await refused(apply(db, { pairs: [ITX], previewedAt: "2026-01-01T00:00:00.000Z" }), 409);
    await new Promise(r => setTimeout(r, 5));
    const theirs: any = await runTenantEntityBackfill(db, { dryRun: true, by: "u-other" });
    await refused(apply(db, { pairs: [ITX], previewedAt: mine.previewedAt }), 409);
    await refused(apply(db, { pairs: [ITX], previewedAt: theirs.previewedAt }), 409);
    const again: any = await runTenantEntityBackfill(db, { dryRun: true, by: ADMIN });
    await db.query(`UPDATE system_settings SET value = jsonb_set(value, '{at}', to_jsonb($2::text)) WHERE key = $1`, [DRY_RUN_KEY, new Date(Date.now() - 2 * 60 * 60_000).toISOString()]);
    await refused(apply(db, { pairs: [ITX], previewedAt: again.previewedAt }), 409);
    assert.equal(await entityOf(db, "r-link"), null);
  });
});

test("Apply links only the ticked pairs, never an unconfirmed brand or an unverified company, and records each link", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const before = await tenantOf(db, "r-link");
    const p: any = await runTenantEntityBackfill(db, { dryRun: true, by: ADMIN });
    const out: any = await apply(db, { previewedAt: p.previewedAt, pairs: [ITX, PRET, BOOTS, pairKey("next", "next retail"), pairKey("costa", "costa coffee"), pairKey("fenwick", "fenwick retail"), pairKey("zara", "bloggs trading")] });
    assert.deepEqual(out.linked.map((x: any) => [x.id, x.entityId]).sort(), [["r-boots-ltd", "boots-hold"], ["r-link", "itx-uk"], ["r-link2", "itx-uk"], ["r-pret", "pret-eu"]]);
    assert.deepEqual(out.notPreviewed.sort(), [pairKey("costa", "costa coffee"), pairKey("fenwick", "fenwick retail"), pairKey("next", "next retail"), pairKey("zara", "bloggs trading")]);
    assert.equal(await entityOf(db, "r-boots-plc"), null, "the plc row in a ticked pair is not linked to the Limited company");
    assert.equal(await entityOf(db, "r-fenwick"), null);
    assert.deepEqual(await tenantOf(db, "r-link"), { ...before, tenant_entity_id: "itx-uk" }, "names and brand untouched");
    assert.equal((await tenantOf(db, "r-pret")).tenant_company_id, "pret", "the brand stays as it was");
    for (const id of ["r-default", "r-unconfirmed", "r-unverified", "r-ambiguous", "r-create", "r-archived", "r-person", "r-landlord", "r-inbrand", "r-nobrand"]) assert.equal(await entityOf(db, id), null, id);
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM crm_trading_entities`)).rows[0].n), 8, "no company made");

    const log = (await db.query(`SELECT batch, table_name, record_id, action, prior, note FROM investment_comp_migration_log ORDER BY record_id`)).rows;
    assert.deepEqual(log.map((r: any) => r.record_id), ["r-boots-ltd", "r-link", "r-link2", "r-pret"]);
    assert.ok(log.every((r: any) => r.batch === out.batch && /^tenant-entity-backfill-\d{4}-/.test(r.batch) && r.table_name === "tenancy_schedule_units" && r.action === "entity_linked"));
    assert.deepEqual(log[1].prior, { tenant_entity_id: null, tenant_company_id: "zara" });
    assert.equal(log[1].note, "link_existing: ITX UK Limited (itx-uk, CH 01234567) for lease name 'ITX UK Limited'");

    const runs = (await db.query(`SELECT value FROM system_settings WHERE key = $1`, [RUNS_KEY])).rows[0].value;
    assert.deepEqual([runs.length, runs[0].kind, runs[0].batch, runs[0].by, runs[0].byName, runs[0].counts.linked], [1, "apply", out.batch, ADMIN, "Woody", 4]);
    assert.equal((await db.query(`SELECT 1 FROM system_settings WHERE key = $1`, [DRY_RUN_KEY])).rowCount, 0, "a preview is used once");
    await refused(apply(db, { pairs: [DEFAULT], previewedAt: p.previewedAt }), 409);
  });
});

test("a row edited after the preview, or a company no longer verified, is skipped", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const p: any = await runTenantEntityBackfill(db, { dryRun: true, by: ADMIN });
    await db.query(`UPDATE tenancy_schedule_units SET trading_name = 'Zara ' WHERE id = 'r-link2'`);
    await db.query(`UPDATE crm_trading_entities SET is_default = false WHERE id = 'zara-default'`);
    // A brand that stops confirming moves the row out of the group.
    await db.query(`UPDATE tenancy_schedule_units SET trading_name = 'Pret Express' WHERE id = 'r-pret'`);
    const out: any = await apply(db, { previewedAt: p.previewedAt, pairs: [ITX, DEFAULT, PRET] });
    assert.deepEqual(out.linked.map((x: any) => x.id), ["r-link"]);
    assert.deepEqual(out.skipped.map((x: any) => x.id).sort(), ["r-default", "r-link2", "r-pret"]);
    for (const id of ["r-link2", "r-default", "r-pret"]) assert.equal(await entityOf(db, id), null, id);
  });
});

test("undo puts back the rows the batch linked that still hold that link, and nothing else", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const p: any = await runTenantEntityBackfill(db, { dryRun: true, by: ADMIN });
    const applied: any = await apply(db, { previewedAt: p.previewedAt, pairs: [ITX, PRET] });
    // A person has since moved r-link2 to another company: the undo leaves it.
    await db.query(`UPDATE tenancy_schedule_units SET tenant_entity_id = 'zara-default' WHERE id = 'r-link2'`);
    await refused(undoTenantEntityBackfill(db, { batch: "tenant-entity-backfill-nope", by: ADMIN }), 404);
    await refused(undoTenantEntityBackfill(db, { batch: "", by: ADMIN }), 400);
    const undone: any = await undoTenantEntityBackfill(db, { batch: applied.batch, by: ADMIN });
    assert.deepEqual(undone.restored.sort(), ["r-link", "r-pret"]);
    assert.deepEqual(undone.counts, { restored: 2, changedSince: 1 });
    assert.deepEqual(await tenantOf(db, "r-link"), { tenant_name: "ITX UK Limited", trading_name: "Zara", tenant_company_id: "zara", tenant_entity_id: null });
    assert.equal(await entityOf(db, "r-link2"), "zara-default");
    assert.equal(await entityOf(db, "r-linked"), "itx-uk", "a link the batch did not make is never touched");
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM crm_trading_entities`)).rows[0].n), 8);
    const undoLog = (await db.query(`SELECT record_id, action, prior, note FROM investment_comp_migration_log WHERE batch = $1 ORDER BY record_id`, [undone.batch])).rows;
    assert.deepEqual(undoLog.map((r: any) => [r.record_id, r.action, r.prior.tenant_entity_id]), [["r-link", "entity_cleared", "itx-uk"], ["r-pret", "entity_cleared", "pret-eu"]]);
    const runs = (await db.query(`SELECT value FROM system_settings WHERE key = $1`, [RUNS_KEY])).rows[0].value;
    assert.ok(runs[0].undoneAt);
    assert.deepEqual([runs[1].kind, runs[1].undoOf], ["undo", applied.batch]);
    await refused(undoTenantEntityBackfill(db, { batch: applied.batch, by: ADMIN }), 409);
  });
});

test("a company moved to another brand, or no longer verified, while Apply runs is not linked", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const p: any = await runTenantEntityBackfill(db, { dryRun: true, by: ADMIN });
    // The change lands after Apply has re-read the live data and before it writes.
    const racing: any = { query: async (text: string, ...rest: any[]) => {
      if (/UPDATE tenancy_schedule_units/.test(text)) {
        await db.query(`UPDATE crm_trading_entities SET parent_company_id = 'next' WHERE id = 'itx-uk'`);
        await db.query(`UPDATE crm_trading_entities SET companies_house_number = NULL WHERE id = 'pret-eu'`);
      }
      return (db.query as any)(text, ...rest);
    } };
    const out: any = await apply(racing, { previewedAt: p.previewedAt, pairs: [ITX, PRET] });
    assert.deepEqual(out.linked, []);
    for (const id of ["r-link", "r-link2", "r-pret"]) assert.equal(await entityOf(db, id), null, id);
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM investment_comp_migration_log`)).rows[0].n), 0);
  });
});
