// The tenant door for a tenancy schedule row (server/tenancy-tenant.ts), the
// brand resolver it reads (server/tenant-brand-resolver.ts) and the schedule
// routes that use it (server/tenancy-schedule.ts), against real SQL in a
// throwaway schema. Skipped unless PROPERTY_PAGE_DATABASE_URL names a LOCAL
// PostgreSQL database that holds the app's tables, for example:
//   PROPERTY_PAGE_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/<a database of your own> \
//     node --import tsx --test server/tenancy-tenant.test.ts
// The rules themselves are tested without a database in shared/tenant-entity.test.ts.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import pg from "pg";
import { TENANT_ENTITY_REFUSALS } from "@shared/tenant-entity";
import { tenancyCalendarDatesSql } from "./tenancy-calendar-dates";

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require("../qa/regression/source-harness.cjs");

let door: typeof import("./tenancy-tenant");
let resolver: typeof import("./tenant-brand-resolver");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";   // the resolver's pool is never asked a question here
  door = await import("./tenancy-tenant");
  resolver = await import("./tenant-brand-resolver");
});

const databaseUrl = process.env.PROPERTY_PAGE_DATABASE_URL;
const skip = !databaseUrl ? "set PROPERTY_PAGE_DATABASE_URL to a local PostgreSQL database that holds the app's tables to run the SQL checks"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "PROPERTY_PAGE_DATABASE_URL must be a local database" : false;

const TABLES = ["crm_companies", "crm_trading_entities", "tenancy_schedule_units", "investment_comp_migration_log", "users", "crm_deals", "available_units"];
type Pool = InstanceType<typeof pg.Pool>;
type Insert = (table: string, row: Record<string, any>) => Promise<void>;

// One throwaway schema per test, so each starts empty; dropped whatever happens.
async function withSchema(work: (db: Pool, insert: Insert, schema: string) => Promise<void>) {
  const schema = "tenancy_tenant_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: databaseUrl });
  const db = new pg.Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},pg_catalog` });
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) await admin.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    // The column this package adds, in case the database predates it.
    await admin.query(`ALTER TABLE ${schema}.tenancy_schedule_units ADD COLUMN IF NOT EXISTS tenant_entity_id varchar`);
    // Defaults that draw on the real tables' sequences: never move those.
    await admin.query(`ALTER TABLE ${schema}.crm_deals ALTER COLUMN deal_ref DROP DEFAULT`);
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
    await work(db, insert, schema);
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

const STAFF = { userId: "u-staff", name: "Woody", viewer: "staff" as const };
const CLIENT = { userId: "u-client", name: "Mark", viewer: "client" as const };
const tenant = async (db: Pool, id: string) =>
  (await db.query(`SELECT tenant_name, trading_name, tenant_company_id, tenant_entity_id FROM tenancy_schedule_units WHERE id = $1`, [id])).rows[0];
const auditRows = async (db: Pool) => (await db.query(`SELECT batch, table_name, record_id, action, prior, note FROM investment_comp_migration_log ORDER BY id`)).rows;
const refusedWith = async (work: Promise<unknown>, code: string) => {
  const error: any = await work.then(() => null, e => e);
  assert.ok(error, `expected ${code}, got success`);
  assert.equal(error.code, code, error.message);
  assert.equal(error.status, TENANT_ENTITY_REFUSALS[code as keyof typeof TENANT_ENTITY_REFUSALS].status);
};

async function seed(insert: Insert) {
  await insert("users", { id: "u-staff", username: "woody", name: "Woody" });
  await insert("users", { id: "u-client", username: "mark", name: "Mark" });
  await insert("crm_companies", { id: "zara", name: "Zara" });
  await insert("crm_companies", { id: "next", name: "Next", trading_entities: JSON.stringify([{ name: "Next Retail Ltd" }]) });
  // Two live brands with one key: the lower id wins for the resolver, the unique match says neither.
  await insert("crm_companies", { id: "costa-a", name: "Costa" });
  await insert("crm_companies", { id: "costa-b", name: "Costa Ltd" });
  // A brand merged into Zara: never matched itself.
  await insert("crm_companies", { id: "zara-old", name: "Zara Old", merged_into_id: "zara", trading_entities: JSON.stringify([{ name: "Inditex Old" }]) });
  await insert("crm_companies", { id: "nandos", name: "Nando's" });
  await insert("crm_trading_entities", { id: "itx-uk", parent_company_id: "zara", name: "ITX UK Limited", companies_house_number: "01234567", notes: "Keep this note" });
  await insert("crm_trading_entities", { id: "next-plc", parent_company_id: "next", name: "Next Plc" });
  const row = (id: string, over: Record<string, any>) => insert("tenancy_schedule_units", { id, property_id: "prop", unit_number: id, status: "Occupied", ...over });
  await row("r-zara", { tenant_name: "ITX UK Limited", trading_name: "Zara", tenant_company_id: "zara" });
  await row("r-hand", { tenant_name: "Some Lease Co", trading_name: "Pop-up", tenant_company_id: "nandos" });
  await row("r-blank-trading", { tenant_name: "Nando's", trading_name: "  " });
  await row("r-none", { tenant_name: "Costa Limited", trading_name: null });
}

test("resolveBrandIdSubquery names the same brand as BRAND_KEYS_CTE; resolveBrandMatchSql is NULL on a tie", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    for (const name of ["Costa", "COSTA LIMITED", "Next Retail Ltd", "Zara", "Inditex Old", "Zara Old", "Nobody"]) {
      const perRow = (await db.query(`SELECT ${resolver.resolveBrandIdSubquery("$1::text")} AS id`, [name])).rows[0].id;
      const set = (await db.query(`WITH ${resolver.BRAND_KEYS_CTE} SELECT brand_id FROM brand_keys WHERE norm_key = ${resolver.brandNameKeySql("$1::text")}`, [name])).rows[0]?.brand_id ?? null;
      assert.equal(perRow, set, name);
    }
    const match = async (name: string) => (await db.query(`SELECT ${resolver.resolveBrandMatchSql("$1::text")} AS id`, [name])).rows[0].id;
    assert.equal(await match("Costa"), null, "two brands share the key");
    assert.equal(await match("Next Retail Ltd"), "next", "a trading-entity alias");
    assert.equal(await match("Zara Old"), null, "a merged brand is never matched");
    assert.equal(await match(""), null);
  });
});

test("the door links, changes and clears the company on the lease, and logs each", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const linked = await door.setTenancyTenant(db, "r-zara", { entityId: "itx-uk" }, STAFF);
    assert.equal(linked.row.tenant_entity_id, "itx-uk");
    assert.deepEqual(linked.notes, ["entity_picked"]);
    // A brand change clears a company not under the new brand.
    const moved = await door.setTenancyTenant(db, "r-zara", { companyId: "next" }, STAFF);
    assert.equal(moved.row.tenant_company_id, "next");
    assert.equal(moved.row.tenant_entity_id, null);
    // A merged brand is set as its survivor.
    await door.setTenancyTenant(db, "r-zara", { companyId: "zara-old" }, STAFF);
    assert.equal((await tenant(db, "r-zara")).tenant_company_id, "zara");
    const log = await auditRows(db);
    assert.deepEqual(log.map((r: any) => [r.batch, r.table_name, r.record_id, r.action]), [
      ["tenant-entity-door", "tenancy_schedule_units", "r-zara", "entity_linked"],
      ["tenant-entity-door", "tenancy_schedule_units", "r-zara", "entity_cleared"],
    ]);
    assert.deepEqual(log[0].prior, { tenant_entity_id: null, tenant_company_id: "zara" });
    assert.equal(log[1].note, "Woody: entity_cleared_brand_changed");
    await door.setTenancyTenant(db, "r-zara", { entityId: "itx-uk" }, { system: "test" });
    assert.equal((await auditRows(db)).at(-1).batch, "tenant-entity-system");
  });
});

test("the door refuses, and a refusal writes nothing", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const before = await tenant(db, "r-zara");
    await refusedWith(door.setTenancyTenant(db, "r-zara", { entityId: "next-plc" }, STAFF), "ENTITY_NOT_UNDER_BRAND");
    await refusedWith(door.setTenancyTenant(db, "r-zara", { entityId: "itx-uk" }, CLIENT), "STAFF_ONLY");
    await refusedWith(door.setTenancyTenant(db, "r-zara", { createEntity: { name: "ITX" } }, CLIENT), "STAFF_ONLY");
    await refusedWith(door.setTenancyTenant(db, "r-zara", { companyId: "missing" }, STAFF), "BRAND_NOT_FOUND");
    await refusedWith(door.setTenancyTenant(db, "nope", { companyId: "zara" }, STAFF), "ROW_NOT_FOUND");
    assert.deepEqual(await tenant(db, "r-zara"), before);
    assert.equal((await auditRows(db)).length, 0);
  });
});

test("insertTradingEntity hands back an existing company unchanged; the door makes new ones off the brand's list", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const again = await door.insertTradingEntity(client, { parentCompanyId: "zara", name: "itx uk limited", companiesHouseNumber: "99999999" });
      await client.query("COMMIT");
      assert.deepEqual(again, { id: "itx-uk", created: false });
    } finally { client.release(); }
    const itx = (await db.query(`SELECT notes, companies_house_number, is_default FROM crm_trading_entities WHERE id = 'itx-uk'`)).rows[0];
    assert.deepEqual(itx, { notes: "Keep this note", companies_house_number: "01234567", is_default: false });

    const made = await door.setTenancyTenant(db, "r-hand", { createEntity: { name: "Some Lease Co", companiesHouseNumber: "07654321" } }, STAFF);
    const entityId = made.row.tenant_entity_id;
    assert.ok(entityId);
    const entity = (await db.query(`SELECT parent_company_id, name, companies_house_number, is_default FROM crm_trading_entities WHERE id = $1`, [entityId])).rows[0];
    assert.deepEqual(entity, { parent_company_id: "nandos", name: "Some Lease Co", companies_house_number: "07654321", is_default: false });
    assert.equal((await db.query(`SELECT trading_entities FROM crm_companies WHERE id = 'nandos'`)).rows[0].trading_entities, null, "the brand's list is not written");
    assert.deepEqual((await auditRows(db)).map((r: any) => [r.table_name, r.action]), [["crm_trading_entities", "entity_created"], ["tenancy_schedule_units", "entity_linked"]]);

    // Deleted, then the two boot copies run: it does not come back.
    await db.query(`UPDATE tenancy_schedule_units SET tenant_entity_id = NULL WHERE id = 'r-hand'`);
    await db.query(`DELETE FROM crm_trading_entities WHERE id = $1`, [entityId]);
    const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const bootCopies = [...indexSource.matchAll(/`(INSERT INTO crm_trading_entities \(parent_company_id, name, is_default\)[\s\S]*?)`/g)].map(m => m[1]);
    assert.equal(bootCopies.length, 2);
    for (const sql of bootCopies) await db.query(sql);
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM crm_trading_entities WHERE parent_company_id = 'nandos'`)).rows[0].n), 0);
  });
});

// The schedule's routes, cut out of server/tenancy-schedule.ts and run with this schema's pool.
function loadRoutes(db: Pool, visible: Set<string>) {
  const file = "server/tenancy-schedule.ts";
  const routes: Record<string, any> = {};
  const routeSource = (method: string, path: string) => find(file, (node: any, ast: any) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(ast) === "router" && node.expression.name.text === method && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path);
  const fn = (name: string) => find(file, (node: any) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const constant = (name: string) => find(file, (node: any, ast: any) => ts.isVariableStatement(node) && node.declarationList.declarations.some((d: any) => d.name.getText(ast) === name));
  const script = [
    constant("TENANCY_FIELDS"), constant("NUMERIC_FIELDS"), constant("DATE_FIELDS"), constant("tenantRefusal"),
    fn("normaliseFieldValue"), fn("getUserInfo"), fn("tenantActor"), fn("brandSurvivorId"), fn("scheduleRowsSql"), fn("withComputedTerms"),
    routeSource("get", "/api/tenancy-schedule/property/:propertyId"), routeSource("put", "/api/tenancy-schedule/unit/:id"),
    routeSource("put", "/api/tenancy-schedule/unit/:id/tenant"), routeSource("post", "/api/tenancy-schedule/unit"),
  ].join(";\n") + ";";
  const register = (method: string) => (path: string, _auth: unknown, handler: any) => { routes[`${method} ${path}`] = handler; };
  evaluate(script, {
    router: { get: register("get"), put: register("put"), post: register("post") }, requireAuth() {},
    getPool: async () => db, tenancyCalendarDatesSql, fanOutTenancyStatus: async () => {},
    resolveBrandIdSubquery: resolver.resolveBrandIdSubquery, tenantNameForBrandSql: resolver.tenantNameForBrandSql, brandNameKeySql: resolver.brandNameKeySql,
    normUnitSql: resolver.normUnitSql, setTenancyTenant: door.setTenancyTenant, relinkTenantAfterNameEdit: door.relinkTenantAfterNameEdit,
    TenantWriteRefused: door.TenantWriteRefused, TENANT_ENTITY_REFUSALS,
    require: (name: string) => {
      assert.equal(name, "./company-scope");
      return {
        resolveCompanyScope: async (req: any) => req.scope || null,
        isPropertyInScope: async (scope: string, id: string) => scope === "landsec" && id === "prop",
        isClientVisibleBrand: async (id: string) => visible.has(id),
      };
    },
    console: { error() {}, warn() {} },
  });
  const call = async (key: string, params: Record<string, string>, body: any, as: { scope?: string; userId: string }) => {
    let status = 200, data: any;
    const res: any = { status: (s: number) => { status = s; return res; }, json: (d: any) => { data = d; return res; } };
    await routes[key]({ params, body, scope: as.scope, session: { userId: as.userId } }, res);
    return { status, data };
  };
  return {
    setTenant: (id: string, body: any, as = { userId: "u-staff" } as { scope?: string; userId: string }) => call("put /api/tenancy-schedule/unit/:id/tenant", { id }, body, as),
    put: (id: string, body: any, as = { userId: "u-staff" } as { scope?: string; userId: string }) => call("put /api/tenancy-schedule/unit/:id", { id }, body, as),
    post: (body: any, as = { userId: "u-staff" } as { scope?: string; userId: string }) => call("post /api/tenancy-schedule/unit", {}, body, as),
    schedule: (as = { userId: "u-staff" } as { scope?: string; userId: string }) => call("get /api/tenancy-schedule/property/:propertyId", { propertyId: "prop" }, {}, as),
  };
}
const AS_CLIENT = { scope: "landsec", userId: "u-client" };

test("the schedule PUT no longer wipes a brand, and a blank trading name lets the lease name match", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const api = loadRoutes(db, new Set());
    // Defect 2: a name that matches nothing used to write NULL over the hand-set brand.
    const edited = await api.put("r-hand", { trading_name: "Pop-up shop 2026" });
    assert.equal(edited.status, 200, edited.data?.error);
    assert.equal(edited.data.tenant_company_id, "nandos");
    assert.equal(edited.data.trading_name, "Pop-up shop 2026");
    assert.ok(edited.data.lease_expiry === null || typeof edited.data.lease_expiry === "string", "the reply keeps the calendar dates");
    // Defect 4: "  " as the trading name no longer hides the lease name.
    const rows = (await api.schedule()).data;
    assert.equal(rows.find((r: any) => r.id === "r-blank-trading").resolved_tenant_company_id, "nandos");
    const filled = await api.put("r-blank-trading", { tenant_name: "Nando's" });
    assert.equal(filled.status, 200, filled.data?.error);
    assert.equal((await tenant(db, "r-blank-trading")).tenant_company_id, "nandos");
    // VACANT clears brand and company.
    await door.setTenancyTenant(db, "r-zara", { entityId: "itx-uk" }, STAFF);
    assert.equal((await api.put("r-zara", { tenant_name: "VACANT", trading_name: "" })).status, 200);
    assert.deepEqual(await tenant(db, "r-zara"), { tenant_name: "VACANT", trading_name: null, tenant_company_id: null, tenant_entity_id: null });
  });
});

test("a trading name that matches nothing never moves the brand to the lease name's brand", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    await insert("tenancy_schedule_units", { id: "r-machine", property_id: "prop", unit_number: "r-machine", status: "Occupied", tenant_name: "Next Retail Ltd", trading_name: "Zara", tenant_company_id: "zara" });
    await insert("tenancy_schedule_units", { id: "r-empty", property_id: "prop", unit_number: "r-empty", status: "Occupied", tenant_name: "Next Retail Ltd", trading_name: "Pop-up" });
    const api = loadRoutes(db, new Set());
    assert.equal((await api.put("r-machine", { trading_name: "Zara Pop-up" })).status, 200);
    assert.equal((await tenant(db, "r-machine")).tenant_company_id, "zara", "the schedule matches on the trading name, not the lease name behind it");
    assert.equal((await api.put("r-empty", { trading_name: "Pop-up 2" })).status, 200);
    assert.equal((await tenant(db, "r-empty")).tenant_company_id, null);
    assert.equal((await api.put("r-empty", { trading_name: "" })).status, 200);
    assert.equal((await tenant(db, "r-empty")).tenant_company_id, "next", "with no trading name the lease name matches");
  });
});

test("a client login whose user row cannot be read is still logged as a client", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const api = loadRoutes(db, new Set());
    await door.setTenancyTenant(db, "r-zara", { entityId: "itx-uk" }, STAFF);
    const vacated = await api.put("r-zara", { tenant_name: "VACANT", trading_name: "" }, { scope: "landsec", userId: "u-gone" });
    assert.equal(vacated.status, 200, vacated.data?.error);
    assert.equal((await tenant(db, "r-zara")).tenant_entity_id, null);
    assert.equal((await auditRows(db)).at(-1).note, "unknown login (client login): entity_cleared_vacated");
  });
});

test("a company is never made or picked under a brand that was merged away", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    await insert("tenancy_schedule_units", { id: "r-merged", property_id: "prop", unit_number: "r-merged", status: "Occupied", tenant_name: "Lease Co", trading_name: "Zara Old", tenant_company_id: "zara-old" });
    await refusedWith(door.setTenancyTenant(db, "r-merged", { createEntity: { name: "Lease Co" } }, STAFF), "BRAND_MERGED");
    await refusedWith(door.setTenancyTenant(db, "r-merged", { entityId: "itx-uk" }, STAFF), "BRAND_MERGED");
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM crm_trading_entities WHERE parent_company_id = 'zara-old'`)).rows[0].n), 0);
    const repicked = await door.setTenancyTenant(db, "r-merged", { companyId: "zara-old", entityId: "itx-uk" }, STAFF);
    assert.deepEqual([repicked.row.tenant_company_id, repicked.row.tenant_entity_id], ["zara", "itx-uk"]);
  });
});

test("a client's vacate, re-brand or lease rename on a row BGP linked goes through, clears the company and logs the client", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const api = loadRoutes(db, new Set(["next"]));
    const relink = () => door.setTenancyTenant(db, "r-zara", { companyId: "zara", entityId: "itx-uk" }, STAFF);
    const lastLog = async () => (await auditRows(db)).at(-1);

    await relink();
    const renamed = await api.put("r-zara", { tenant_name: "H&M Hennes Ltd", comments: "changed" }, AS_CLIENT);
    assert.equal(renamed.status, 200, renamed.data?.error);
    assert.equal(renamed.data.tenant_entity_id, null);
    assert.ok(renamed.data.tenant_notes.includes("entity_cleared_lease_name_changed"), "the client is told the company came off");
    assert.equal(renamed.data.comments, "changed");
    const log = await lastLog();
    assert.deepEqual([log.batch, log.action, log.note], ["tenant-entity-door", "entity_cleared", "Mark (client login): entity_cleared_lease_name_changed"]);
    assert.deepEqual(log.prior, { tenant_entity_id: "itx-uk", tenant_company_id: "zara" });

    await door.setTenancyTenant(db, "r-zara", { tenantName: "ITX UK Limited" }, STAFF);
    await relink();
    const vacated = await api.put("r-zara", { tenant_name: "VACANT", trading_name: "" }, AS_CLIENT);
    assert.equal(vacated.status, 200, vacated.data?.error);
    assert.deepEqual(await tenant(db, "r-zara"), { tenant_name: "VACANT", trading_name: null, tenant_company_id: null, tenant_entity_id: null });
    assert.equal((await lastLog()).note, "Mark (client login): entity_cleared_vacated");

    await door.setTenancyTenant(db, "r-zara", { tenantName: "ITX UK Limited", tradingName: "Zara" }, STAFF);
    await relink();
    const rebranded = await api.setTenant("r-zara", { companyId: "next" }, AS_CLIENT);
    assert.equal(rebranded.status, 200, rebranded.data?.error);
    assert.equal(rebranded.data.row.tenant_company_id, "next");
    assert.equal(rebranded.data.row.tenant_entity_id, null);
    assert.ok(rebranded.data.notes.includes("entity_cleared_brand_changed"));
    assert.equal((await lastLog()).note, "Mark (client login): entity_cleared_brand_changed");

    // A client still cannot set the company itself.
    assert.equal((await api.setTenant("r-zara", { entityId: "next-plc" }, AS_CLIENT)).data.code, "STAFF_ONLY");
    assert.equal((await api.setTenant("r-zara", { createEntity: { name: "Next Retail Ltd" } }, AS_CLIENT)).data.code, "STAFF_ONLY");
  });
});

test("the tenant route: staff link and see the company, a client is refused setting it and sees it", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const api = loadRoutes(db, new Set(["next"]));
    assert.equal((await api.setTenant("vacant-au1", { companyId: "zara" })).status, 400);

    const staff = await api.setTenant("r-zara", { entityId: "itx-uk" });
    assert.equal(staff.status, 200, staff.data?.error);
    assert.equal(staff.data.row.tenant_entity_name, "ITX UK Limited");
    assert.equal(staff.data.row.tenant_entity_ch, "01234567");
    assert.equal(staff.data.row.lease_in_brand_name, false);
    assert.equal(staff.data.matchesLease, "itx-uk");
    assert.deepEqual(staff.data.notes, ["entity_picked"]);

    const entity = await api.setTenant("r-zara", { entityId: "itx-uk" }, AS_CLIENT);
    assert.equal(entity.status, 403);
    assert.equal(entity.data.code, "STAFF_ONLY");
    const outOfList = await api.setTenant("r-none", { companyId: "zara" }, AS_CLIENT);
    assert.equal(outOfList.status, 403);
    assert.equal(outOfList.data.code, "BRAND_NOT_IN_LIST");
    // A merged-away record is checked as the brand it was merged into, which is what would be stored.
    const mergedApi = loadRoutes(db, new Set(["zara-old"]));
    const merged = await mergedApi.setTenant("r-none", { companyId: "zara-old" }, AS_CLIENT);
    assert.equal(merged.status, 403);
    assert.equal(merged.data.code, "BRAND_NOT_IN_LIST");
    const foreign = await api.setTenant("r-none", { companyId: "next" }, { scope: "another-landlord", userId: "u-client" });
    assert.equal(foreign.status, 403);
    const inList = await api.setTenant("r-none", { companyId: "next", tradingName: "Next" }, AS_CLIENT);
    assert.equal(inList.status, 200, inList.data?.error);
    assert.equal(inList.data.row.tenant_company_id, "next");
    assert.equal(inList.data.matchesLease, undefined);
    for (const key of ["tenant_entity_id", "tenant_entity_name", "tenant_entity_ch"]) assert.ok(key in inList.data.row, key);
    const clientRows = (await api.schedule(AS_CLIENT)).data;
    const clientZara = clientRows.find((r: any) => r.id === "r-zara");
    assert.deepEqual([clientZara.tenant_entity_id, clientZara.tenant_entity_name, clientZara.tenant_entity_ch], ["itx-uk", "ITX UK Limited", "01234567"]);
    const staffRows = (await api.schedule()).data;
    assert.equal(staffRows.find((r: any) => r.id === "r-zara").tenant_entity_name, "ITX UK Limited");
  });
});

test("the add form's brand goes through the door, and a client may add only a brand in its list", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const api = loadRoutes(db, new Set(["next"]));
    const made = await api.post({ property_id: "prop", unit_number: "New 1", tenant_name: "Something Ltd", tenant_company_id: "zara" });
    assert.equal(made.status, 200, made.data?.error);
    assert.equal(made.data.tenant_company_id, "zara");
    assert.equal((await tenant(db, made.data.id)).tenant_company_id, "zara");
    const count = async () => Number((await db.query(`SELECT count(*) AS n FROM tenancy_schedule_units`)).rows[0].n);
    const n = await count();
    const refused = await api.post({ property_id: "prop", unit_number: "New 2", tenant_company_id: "zara" }, AS_CLIENT);
    assert.equal(refused.status, 403);
    assert.equal(await count(), n);
    const missing = await api.post({ property_id: "prop", unit_number: "New 3", tenant_company_id: "missing" });
    assert.equal(missing.status, 404);
    assert.equal(await count(), n, "a refused brand leaves no row behind");
  });
});
