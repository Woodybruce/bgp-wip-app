import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planForCompanies } from "./crm-engagement";
import { PRIVATE_MAILBOX } from "../shared/private-mail";

type Call = { sql: string; values: any[] };
function stub(actions: any[], strategies: any[]) {
  const calls: Call[] = [];
  const q = {
    async query(sql: string, values: any[] = []) {
      calls.push({ sql, values });
      if (/FROM crm_engagement_actions/.test(sql)) return { rows: actions };
      if (/FROM crm_strategy_targets/.test(sql)) return { rows: strategies };
      throw new Error("unexpected query: " + sql);
    },
  };
  return { q, calls };
}
const here = { propertyId: "p1", tenancyUnitIds: ["u1", "u2"] };
const action = (id: string, companyId: string, extra: Record<string, any> = {}) => ({ id, title: "Title " + id, due_date: null, created_at: "2026-11-01T09:00:00Z",
  company_id: companyId, owner_name: "Owner " + id, here: false, participants: [], ...extra });

test("an empty list issues no query", async () => {
  const { q, calls } = stub([], []);
  const plans = await planForCompanies(q, [], here);
  assert.equal(plans.size, 0);
  assert.equal(calls.length, 0);
});

test("two queries however many companies are asked for, with the done filter, here and the plan columns read through to_jsonb", async () => {
  for (const count of [1, 50]) {
    const { q, calls } = stub([], []);
    await planForCompanies(q, Array.from({ length: count }, (_, i) => "c" + i), here);
    assert.equal(calls.length, 2);
  }
  const { q, calls } = stub([], []);
  await planForCompanies(q, ["c1", "c1", "c2"], here);
  const actionSql = calls.find(call => /crm_engagement_actions/.test(call.sql))!;
  assert.match(actionSql.sql, /t\.status IS DISTINCT FROM 'done'/);
  assert.match(actionSql.sql, /l\.company_id=ANY\(\$1::text\[\]\)/);
  assert.match(actionSql.sql, /to_jsonb\(l\)->>'property_id'\)=\$2/);
  assert.match(actionSql.sql, /to_jsonb\(l\)->>'tenancy_unit_id'\)=ANY\(\$3::text\[\]\)/);
  assert.doesNotMatch(actionSql.sql, /\bl\.(property_id|tenancy_unit_id)\b/);
  assert.match(actionSql.sql, /AS participants/);
  assert.match(actionSql.sql, /LEFT JOIN marketing_events e ON e\.id=l\.event_id/);
  assert.deepEqual(actionSql.values, [["c1", "c2"], "p1", ["u1", "u2"]]);
  const blank = stub([], []);
  await planForCompanies(blank.q, ["c1"], { propertyId: "", tenancyUnitIds: ["", "u1"] });
  assert.deepEqual(blank.calls.find(call => /crm_engagement_actions/.test(call.sql))!.values, [["c1"], null, ["u1"]], "an empty id never matches an empty column");
  const strategySql = calls.find(call => /crm_strategy_targets/.test(call.sql))!;
  assert.match(strategySql.sql, /s\.status='active'/);
  assert.deepEqual(strategySql.values, [["c1", "c2"]]);
});

test("private-event rows are dropped; next is here first, then soonest due, undated last", async () => {
  const { q } = stub([
    action("undated-here", "c1", { here: true }),
    action("due-later-here", "c1", { here: true, due_date: "2026-12-20T09:00:00Z" }),
    action("due-soon-here", "c1", { here: true, due_date: "2026-12-10T09:00:00Z" }),
    action("due-sooner-elsewhere", "c1", { due_date: "2026-11-20T09:00:00Z" }),
    action("private-sooner-here", "c1", { here: true, due_date: "2026-11-15T09:00:00Z", participants: ["woody@brucegillinghampollard.com", PRIVATE_MAILBOX] }),
    action("elsewhere-undated", "c2"),
    action("elsewhere-dated", "c2", { due_date: "2027-01-05T09:00:00Z" }),
    action("private-only", "c3", { participants: [PRIVATE_MAILBOX] }),
  ], []);
  const plans = await planForCompanies(q, ["c1", "c2", "c3"], here);
  const c1 = plans.get("c1")!;
  assert.equal(c1.openCount, 4);
  assert.equal(c1.hereCount, 3);
  assert.deepEqual(c1.next, { id: "due-soon-here", title: "Title due-soon-here", dueAt: "2026-12-10T09:00:00.000Z", ownerName: "Owner due-soon-here", here: true });
  const c2 = plans.get("c2")!;
  assert.equal(c2.openCount, 2);
  assert.equal(c2.hereCount, 0);
  assert.equal(c2.next!.id, "elsewhere-dated");
  assert.equal(c2.next!.here, false);
  assert.equal(plans.has("c3"), false, "a company with only a private-event action is left out");
});

test("strategies come with their contact ids; a company with nothing is absent from the map", async () => {
  const { q } = stub([], [
    { id: "s1", name: "Autumn dinners", company_id: "c1", contact_ids: ["k1", "k2"] },
    { id: "s2", name: "Openings", company_id: "c1", contact_ids: null },
    { id: "s1", name: "Autumn dinners", company_id: "c2", contact_ids: ["k9"] },
  ]);
  const plans = await planForCompanies(q, ["c1", "c2", "nothing"], here);
  assert.deepEqual(plans.get("c1"), { openCount: 0, hereCount: 0, next: null, strategies: [
    { id: "s1", name: "Autumn dinners", contactIds: ["k1", "k2"] }, { id: "s2", name: "Openings", contactIds: [] }] });
  assert.deepEqual(plans.get("c2")!.strategies, [{ id: "s1", name: "Autumn dinners", contactIds: ["k9"] }]);
  assert.equal(plans.has("nothing"), false);
});

test("an action made from the plan never links its task to a property or a contact", () => {
  const source = readFileSync(new URL("./crm-engagement.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function createEngagementAction");
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const inserts = body.match(/INSERT INTO user_tasks\([^)]*\)/g) || [];
  assert.equal(inserts.length, 1);
  assert.doesNotMatch(inserts[0], /linked_property_id|linked_contact_id/);
  assert.doesNotMatch(body, /linked_property_id|linked_contact_id/);
});

// The real SQL, in a throwaway schema made from the app's table shapes
// (PROPERTY_PAGE_DATABASE_URL, as in server/property-page.test.ts).
const databaseUrl = process.env.PROPERTY_PAGE_DATABASE_URL;
const skip = !databaseUrl ? "set PROPERTY_PAGE_DATABASE_URL to a local PostgreSQL database that holds the app's tables to run the SQL checks"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "PROPERTY_PAGE_DATABASE_URL must be a local database" : false;
const TABLES = ["crm_engagement_actions", "user_tasks", "crm_companies", "users", "marketing_events", "crm_strategy_targets", "marketing_campaigns", "crm_contacts"];
async function withSchema(work: (db: any) => Promise<void>) {
  const pg = (await import("pg")).default;
  const { randomUUID } = await import("node:crypto");
  const schema = "crm_plan_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: databaseUrl });
  const db = new pg.Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},pg_catalog` });
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) await admin.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    await db.query(`INSERT INTO users(id,username,password,name,email) VALUES('owner','owner','x','Olive Owner','olive@brucegillinghampollard.com'),('private','private','x','Private','${PRIVATE_MAILBOX}')`);
    await db.query(`INSERT INTO crm_companies(id,name,company_type) VALUES('c1','Brand one','Tenant - Restaurant'),('c2','Landlord two','Landlord'),('c3','Brand three','Tenant - Leisure')`);
    await db.query(`INSERT INTO marketing_events(id,title,lead_user_id) VALUES('e-private','Private dinner','private')`);
    const task = (id: string, status: string | null, due: string | null, created: string) =>
      db.query(`INSERT INTO user_tasks(id,user_id,title,status,due_date,created_at) VALUES($1,'owner',$2,$3,$4,$5)`, [id, "Title " + id, status, due, created]);
    await task("here-later", "todo", "2026-12-20", "2026-11-01");
    await task("here-unit", "in_progress", "2026-12-10", "2026-11-01");
    await task("elsewhere-soonest", "todo", "2026-11-20", "2026-11-01");
    await task("done-here", "done", "2026-11-14", "2026-11-01");
    await task("null-status", null, null, "2026-11-02");
    await task("private-here", "todo", "2026-11-15", "2026-11-01");
    await task("c2-undated-new", "todo", null, "2026-11-10");
    await task("c2-undated-old", "todo", null, "2026-11-01");
    const link = (taskId: string, companyId: string, propertyId: string | null, unitId: string | null, eventId: string | null = null) =>
      db.query(`INSERT INTO crm_engagement_actions(task_id,company_id,property_id,tenancy_unit_id,event_id) VALUES($1,$2,$3,$4,$5)`, [taskId, companyId, propertyId, unitId, eventId]);
    await link("here-later", "c1", "p1", null);
    await link("here-unit", "c1", null, "u1");
    await link("elsewhere-soonest", "c1", "p-other", "u-other");
    await link("done-here", "c1", "p1", null);
    await link("null-status", "c1", "", "");
    await link("private-here", "c3", "p1", null, "e-private");
    await link("c2-undated-new", "c2", null, null);
    await link("c2-undated-old", "c2", null, null);
    await db.query(`INSERT INTO marketing_campaigns(id,name,status) VALUES('s-active','Openings','active'),('s-paused','Paused push','paused')`);
    await db.query(`INSERT INTO crm_strategy_targets(strategy_id,company_id,reason,contact_ids) VALUES('s-active','c1','why',ARRAY['k1','k2']),('s-paused','c1','why','{}'),('s-active','c2','why','{}')`);
    await work(db);
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

test("the SQL: open, non-private actions, here by property or schedule row, active strategies", { skip }, async () => {
  await withSchema(async db => {
    const plans = await planForCompanies(db, ["c1", "c2", "c3", "missing"], { propertyId: "p1", tenancyUnitIds: ["u1"] });
    const c1 = plans.get("c1")!;
    assert.equal(c1.openCount, 4, "done is not counted; a task with no status is");
    assert.equal(c1.hereCount, 2);
    assert.equal(c1.next!.id, "here-unit");
    assert.equal(c1.next!.here, true);
    assert.equal(c1.next!.ownerName, "Olive Owner");
    assert.deepEqual(c1.strategies, [{ id: "s-active", name: "Openings", contactIds: ["k1", "k2"] }]);
    const c2 = plans.get("c2")!;
    assert.equal(c2.next!.id, "c2-undated-new", "equal (null) due dates: the newest first");
    assert.deepEqual(c2.strategies, [{ id: "s-active", name: "Openings", contactIds: [] }]);
    assert.equal(plans.has("c3"), false, "a private-event action is not counted");
    assert.equal(plans.has("missing"), false);

    for (const nowhere of [{ propertyId: "p-none", tenancyUnitIds: [] }, { propertyId: "", tenancyUnitIds: [""] }]) {
      const none = await planForCompanies(db, ["c1"], nowhere);
      assert.equal(none.get("c1")!.hereCount, 0, `nothing is here for ${JSON.stringify(nowhere)}`);
      assert.equal(none.get("c1")!.next!.id, "elsewhere-soonest");
    }

    await db.query(`ALTER TABLE crm_engagement_actions DROP COLUMN property_id, DROP COLUMN tenancy_unit_id`);
    const old = await planForCompanies(db, ["c1"], { propertyId: "p1", tenancyUnitIds: ["u1"] });
    assert.equal(old.get("c1")!.openCount, 4, "a database without the plan columns still reads");
    assert.equal(old.get("c1")!.hereCount, 0);
  });
});
