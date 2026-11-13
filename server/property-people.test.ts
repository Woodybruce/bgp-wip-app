// The property page's People feed and the role at a property
// (server/property-people.ts), run against the real SQL in a throwaway schema.
// Skipped unless PROPERTY_PAGE_DATABASE_URL names a LOCAL PostgreSQL database
// that holds the app's tables, for example:
//   PROPERTY_PAGE_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpdev \
//     node --import tsx --test server/property-people.test.ts
// Nothing is written to the database's own tables: each test makes its own
// schema from the table shapes and drops it.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { RecordPeopleReply, RecordPerson } from "@shared/record-people";

let people: typeof import("./property-people");
before(async () => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  people = await import("./property-people");
});

const databaseUrl = process.env.PROPERTY_PAGE_DATABASE_URL;
const skip = !databaseUrl ? "set PROPERTY_PAGE_DATABASE_URL to a local PostgreSQL database that holds the app's tables to run the SQL checks"
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? "PROPERTY_PAGE_DATABASE_URL must be a local database" : false;

// Every table the feed, the BGP team reads, the CRM plan read and the role write touch.
const TABLES = ["crm_companies", "crm_properties", "crm_contacts", "users", "crm_property_agents", "crm_property_clients", "crm_contact_properties",
  "crm_company_properties", "tenancy_schedule_units", "available_units", "crm_deals", "property_units", "unit_briefs", "unit_brief_people",
  "unit_viewings", "unit_offers", "brand_agent_representations", "contact_left_companies", "crm_company_bgp_roles",
  "crm_engagement_actions", "user_tasks", "marketing_events", "marketing_campaigns", "crm_strategy_targets"];
type Pool = InstanceType<typeof pg.Pool>;
type Insert = (table: string, row: Record<string, any>) => Promise<void>;

// One throwaway schema per test, so each starts empty; dropped whatever happens.
async function withSchema(work: (db: Pool, insert: Insert) => Promise<void>) {
  const schema = "property_people_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: databaseUrl });
  const db = new pg.Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema},pg_catalog` });
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) await admin.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    // The default draws on the real table's sequence: never move it.
    await admin.query(`ALTER TABLE ${schema}.crm_deals ALTER COLUMN deal_ref DROP DEFAULT`);
    // As server/property-asset-brief.ts makes it at runtime.
    await admin.query(`CREATE TABLE ${schema}.property_contact_overrides (
      property_id varchar NOT NULL, contact_id varchar NOT NULL, kind text NOT NULL, created_by varchar,
      created_at timestamptz DEFAULT now(), PRIMARY KEY (property_id, contact_id))`);
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

const P = "prop-bluewater", OTHER = "prop-other";
const STAFF = { staff: true, scopeCompanyId: null, brandSliceSql: "(FALSE)" };
// A Landsec login on its own property: scoped to the landlord.
const CLIENT = { staff: false, scopeCompanyId: "co-landsec", brandSliceSql: "(company_type ILIKE ANY(ARRAY['Tenant - Restaurant']))" };
const byId = (reply: RecordPeopleReply, id: string) => reply.people.find(p => p.id === id);
const ids = (reply: RecordPeopleReply) => reply.people.map(p => p.id);
const failsWith = async (work: Promise<unknown>, status: number, pattern?: RegExp) => {
  const error: any = await work.then(() => null, e => e);
  assert.ok(error, `expected a ${status}, got success`);
  assert.equal(error.status, status, error.message);
  if (pattern) assert.match(error.message, pattern);
};

async function seed(insert: Insert) {
  await insert("crm_companies", { id: "co-landsec", name: "Landsec", company_type: "Landlord" });
  await insert("crm_companies", { id: "co-agent", name: "Shopping Agents LLP", company_type: "Agent" });
  await insert("crm_companies", { id: "co-consult", name: "Plan & Co", company_type: "Planning consultant" });
  await insert("crm_companies", { id: "co-tenant", name: "Pret A Manger", company_type: "Tenant - Restaurant" });
  await insert("crm_companies", { id: "co-brand", name: "Jersey Mike's", company_type: "Tenant - Restaurant" });
  await insert("crm_companies", { id: "co-other", name: "Elsewhere Tenant", company_type: "Tenant - Retail" });
  await insert("crm_properties", { id: P, name: "Bluewater", landlord_id: "co-landsec" });
  await insert("crm_properties", { id: OTHER, name: "Elsewhere", landlord_id: "co-landsec" });
  await insert("crm_company_properties", { company_id: "co-agent", property_id: P });
  await insert("crm_company_properties", { company_id: "co-consult", property_id: P });

  const contact = (id: string, company_id: string | null, over: Record<string, any> = {}) => insert("crm_contacts", { id, name: id, company_id, ...over });
  await contact("ct-director", "co-landsec", { name: "Dana Director", role: "Managing Director", email: "dana@landsec.example" });
  await contact("ct-intouch", "co-landsec", { name: "Ian Intouch", role: "Analyst", last_interaction: "2026-10-01" });
  await contact("ct-am", "co-landsec", { name: "Amy Asset", role: "Asset manager" });
  await contact("ct-agent-director", "co-agent", { name: "Alan Agent", role: "Director" });
  await contact("ct-consult-director", "co-consult", { name: "Cara Consultant", role: "Director" });
  for (let i = 1; i <= 5; i++) await contact(`ct-t${i}`, "co-tenant", { name: `Pret person ${i}`, last_interaction: `2026-0${i}-01` });
  await contact("ct-hidden", "co-brand", { name: "Hugo Hidden" });
  await contact("ct-unitdeal", "co-brand", { name: "Uma Unitdeal" });
  await contact("ct-viewer", null, { name: "Vic Viewer" });
  await contact("ct-offer", null, { name: "Olly Offer" });
  await contact("ct-other", "co-other", { name: "Otto Other" });
  await contact("ct-pin", null, { name: "Pat Pinned" });

  await insert("users", { id: "u-bgp", username: "u-bgp", name: "Bea BGP", email: "bea@brucegillinghampollard.com", role: "Agent", is_active: true });
  await insert("users", { id: "u-bgp2", username: "u-bgp2", name: "Ben BGP", email: "ben@brucegillinghampollard.com", role: "Agent", is_active: true });
  await insert("users", { id: "u-gone", username: "u-gone", name: "Gary Gone", email: "gary@brucegillinghampollard.com", role: "Agent", is_active: false });
  await insert("users", { id: "u-landsec", username: "u-landsec", name: "Lara Landsec", email: "lara@landsec.example", role: "Client", is_active: true });
  await insert("crm_property_agents", { property_id: P, user_id: "u-bgp", role: "Lead" });

  await insert("property_units", { id: "pu-2", property_id: P, unit_name: "L002" });
  const ts = (id: string, property_id: string, unit_number: string, over: Record<string, any> = {}) => insert("tenancy_schedule_units", { id, property_id, unit_number, ...over });
  await ts("ts-1", P, "L001", { tenant_name: "Pret A Manger", tenant_company_id: "co-tenant", status: "Occupied" });
  await ts("ts-2", P, "L002", { status: "Vacant", property_unit_id: "pu-2" });
  await ts("ts-3", P, "L003", { status: "Vacant" });
  await ts("ts-x", OTHER, "X001", { tenant_name: "Elsewhere Tenant", tenant_company_id: "co-other", status: "Occupied" });
  // Two tracker rows on one schedule row; the brief is on the older one.
  await insert("available_units", { id: "au-old", property_id: P, unit_name: "L003", tenancy_unit_id: "ts-3", marketing_status: "AVA", created_at: "2026-01-01" });
  await insert("available_units", { id: "au-new", property_id: P, unit_name: "L003", tenancy_unit_id: "ts-3", marketing_status: "AVA", created_at: "2026-06-01" });
  await insert("unit_briefs", { id: "b-1", unit_id: "au-old", property_id: P });
  await insert("unit_brief_people", { id: "bp-landsec", brief_id: "b-1", role: "client_leasing", user_id: "u-landsec", name: "Lara Landsec" });
  await insert("unit_brief_people", { id: "bp-bgp", brief_id: "b-1", role: "bgp_agent", user_id: "u-bgp2", name: "Ben BGP" });
  await insert("unit_brief_people", { id: "bp-joint", brief_id: "b-1", role: "joint_agent", name: "Jo Joint", firm: "Joint & Co" });

  // Property id empty: reaches the property through its schedule row only.
  await insert("crm_deals", { id: "d-hidden", name: "L001 letting", property_id: null, tenancy_unit_id: "ts-1", tenant_contact_id: "ct-hidden", status: "NEG",
    internal_agent_ids: ["u-gone"] });
  // Linked to the physical unit only.
  await insert("crm_deals", { id: "d-unit", name: "L002 letting", property_id: null, unit_id: "pu-2", tenant_contact_id: "ct-unitdeal", tenant_id: "co-brand", status: "NEG" });
  await insert("crm_deals", { id: "d-other", name: "Elsewhere deal", property_id: OTHER, tenant_contact_id: "ct-other", status: "NEG" });
  await insert("property_contact_overrides", { property_id: P, contact_id: "ct-hidden", kind: "hide" });
  await insert("property_contact_overrides", { property_id: P, contact_id: "ct-pin", kind: "pin", created_by: "u-bgp" });
  await insert("crm_property_clients", { property_id: P, contact_id: "ct-director", role: null });

  await insert("unit_viewings", { id: "v-1", unit_id: "au-new", contact_id: "ct-viewer", viewing_date: "2026-10-01", status: "completed" });
  await insert("unit_offers", { id: "o-1", unit_id: "au-new", contact_id: "ct-offer", offer_date: "2026-10-02" });
}

test("the feed: groups, units, hides and the other property", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const reply = await people.loadPropertyPeople(db, P, STAFF);
    const group = (id: string) => byId(reply, id)?.group;

    // A contact hidden here stays hidden though its deal reaches the property only through its unit.
    assert.equal(byId(reply, "contact:ct-hidden"), undefined);
    assert.equal(reply.hiddenCount, 1);
    // A deal linked by its physical unit only is on that unit's schedule row.
    const unitDeal = byId(reply, "contact:ct-unitdeal")!;
    assert.equal(unitDeal.group, "units");
    assert.equal(unitDeal.relationships[0].scheduleRowId, "ts-2");
    assert.equal(unitDeal.relationships[0].deal?.id, "d-unit");
    // The brief on the older of two tracker rows: its people are on that unit.
    const landsec = byId(reply, "user:u-landsec")!;
    assert.equal(landsec.group, "client");
    assert.equal(landsec.side, "client");
    assert.equal(landsec.roleOnRecord, "Leasing team");
    assert.deepEqual([landsec.relationships[0].scheduleRowId, landsec.relationships[0].trackerId], ["ts-3", "au-old"]);
    const joint = byId(reply, "brief:bp-joint")!;
    assert.equal(joint.group, "units");
    assert.equal(joint.kind, "person");
    assert.deepEqual(joint.company, { name: "Joint & Co" });
    assert.equal(joint.relationships[0].trackerId, "au-old");
    assert.equal(group("user:u-bgp2"), "bgp");
    assert.match(byId(reply, "user:u-bgp2")!.roleOnRecord, /BGP agent on L003 brief/);
    // The assigned BGP agent, marked so the board draws it once (InlineAgents).
    assert.equal(byId(reply, "user:u-bgp")!.source, "assigned");
    assert.equal(byId(reply, "user:u-bgp")!.roleSource, "set");
    // An inactive BGP user on a deal is not listed.
    assert.equal(byId(reply, "user:u-gone"), undefined);
    // Owners: the landlord's director, its in-touch person; never the agent firm's director.
    assert.equal(group("contact:ct-director"), "client");
    assert.equal(group("contact:ct-intouch"), "owner");
    assert.equal(byId(reply, "contact:ct-intouch")!.ownerPerson, true);
    assert.equal(byId(reply, "contact:ct-agent-director"), undefined);
    assert.equal(group("company:co-agent"), "deals");
    assert.equal(byId(reply, "company:co-agent")!.roleOnRecord, "Agent firm");
    // A consultancy's director is an adviser.
    assert.equal(group("contact:ct-consult-director"), "advisers");
    // A tenant company is one entry with its freshest contact; its people are not listed.
    const pret = byId(reply, "company:co-tenant")!;
    assert.equal(pret.group, "units");
    assert.deepEqual(pret.lastContactPerson, { id: "ct-t5", name: "Pret person 5" });
    for (let i = 1; i <= 5; i++) assert.equal(byId(reply, `contact:ct-t${i}`), undefined);
    assert.equal(pret.relationships.find(r => r.scheduleRowId === "ts-1")?.role, "Tenant");
    // Viewings, offers and the pin.
    assert.equal(byId(reply, "contact:ct-viewer")!.roleOnRecord, "Viewed");
    assert.equal(byId(reply, "contact:ct-offer")!.roleOnRecord, "Offer");
    assert.equal(group("contact:ct-pin"), "added");
    assert.equal(byId(reply, "contact:ct-pin")!.addedBy, "Bea BGP");
    // Nothing from the other property.
    for (const id of ["contact:ct-other", "company:co-other"]) assert.equal(byId(reply, id), undefined, id);
    assert.ok(!JSON.stringify(reply).includes("ts-x"));
    assert.deepEqual(reply.viewer, { staff: true, canSetRoles: true, canAddActions: true, canPinHide: true });
    assert.equal(reply.plan, "ok");
  });
});

test("the role at a property: update, insert, clear, remove, refuse, and one row under a race", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    const rows = async (contactId: string) => (await db.query("SELECT role FROM crm_property_clients WHERE property_id = $1 AND contact_id = $2", [P, contactId])).rows;
    // Updates the row that is there.
    await people.setPropertyClientRole(db, P, "ct-director", "Asset Manager");
    assert.deepEqual(await rows("ct-director"), [{ role: "Asset Manager" }]);
    // Inserts one where there is none.
    await people.setPropertyClientRole(db, P, "ct-am", "Property Manager");
    assert.deepEqual(await rows("ct-am"), [{ role: "Property Manager" }]);
    // null keeps the person on the client's team with no role.
    await people.setPropertyClientRole(db, P, "ct-am", null);
    assert.deepEqual(await rows("ct-am"), [{ role: null }]);
    // Remove takes them off it.
    assert.equal((await people.removePropertyClientRole(db, P, "ct-am")).removed, 1);
    assert.deepEqual(await rows("ct-am"), []);
    // A tenant's person, an agent and a role off the list are refused.
    await failsWith(people.setPropertyClientRole(db, P, "ct-t1", "Legal"), 400, /owner's own people/);
    await failsWith(people.setPropertyClientRole(db, P, "ct-agent-director", "Legal"), 400, /owner's own people/);
    await failsWith(people.setPropertyClientRole(db, P, "ct-am", "Chief"), 400, /from the list/);
    await failsWith(people.setPropertyClientRole(db, P, "ct-am", undefined), 400);
    assert.deepEqual(await rows("ct-t1"), []);
    // Two at once leave one row.
    await Promise.all([people.setPropertyClientRole(db, P, "ct-intouch", "Legal"), people.setPropertyClientRole(db, P, "ct-intouch", "Accounts")]);
    assert.equal((await rows("ct-intouch")).length, 1);
    // The role shows as set, on the client's team.
    const reply = await people.loadPropertyPeople(db, P, STAFF);
    assert.equal(byId(reply, "contact:ct-director")!.roleOnRecord, "Asset Manager");
    assert.equal(byId(reply, "contact:ct-director")!.roleSource, "set");
  });
});

test("a client login: the allow-list only, no viewings, offers or in-touch-only people", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    await insert("crm_contacts", { id: "ct-canary", name: "Cathy Canary", company_id: "co-landsec", role: "Director", last_interaction: "2031-01-01" });
    // An occupier outside the client's brand slice: named, never by its id.
    await insert("crm_companies", { id: "co-retail-canary", name: "Retail Occupier", company_type: "Tenant - Retail" });
    await insert("tenancy_schedule_units", { id: "ts-4", property_id: P, unit_number: "L004", tenant_name: "Retail Occupier", tenant_company_id: "co-retail-canary", status: "Occupied" });
    const staffReply = await people.loadPropertyPeople(db, P, STAFF);
    assert.ok(byId(staffReply, "company:co-retail-canary"));
    const reply = await people.loadPropertyPeople(db, P, CLIENT);
    const retail = reply.people.find(p => p.name === "Retail Occupier")!;
    assert.deepEqual(retail.company, { name: "Retail Occupier" });
    assert.match(retail.id, /^company-entry:\d+$/);
    assert.ok(!JSON.stringify(reply).includes("co-retail-canary"));
    for (const id of ["contact:ct-viewer", "contact:ct-offer", "contact:ct-intouch"]) assert.equal(byId(reply, id), undefined, id);
    assert.ok(byId(reply, "contact:ct-canary"));
    const allowed = ["id", "kind", "name", "jobTitle", "email", "phone", "contactId", "company", "group", "side", "roleOnRecord", "roleSource", "relationships"];
    for (const person of reply.people) for (const key of Object.keys(person)) assert.ok(allowed.includes(key), `${person.id}: ${key}`);
    const json = JSON.stringify(reply);
    for (const banned of ["2031-01-01", "lastContact", "companyKind", "ownerPerson", "\"plan\"", "addedBy", "visibility", "\"source\"", "\"via\""]) assert.ok(!json.includes(banned), banned);
    // A BGP person keeps only the group and role.
    assert.deepEqual(byId(reply, "user:u-bgp2")!.relationships, [{ group: "bgp", role: "BGP agent on L003 brief", roleSource: "set" }]);
    // The client opens its own people and a brand in its slice, and only the name of a company outside it.
    assert.equal(byId(reply, "contact:ct-director")!.contactId, "ct-director");
    assert.deepEqual(byId(reply, "company:co-tenant")!.company, { id: "co-tenant", name: "Pret A Manger" });
    assert.deepEqual(byId(reply, "contact:ct-consult-director")!.company, { name: "Plan & Co" });
    assert.ok(!("contactId" in byId(reply, "contact:ct-consult-director")!));
    assert.equal(reply.hiddenCount, 1);
    assert.deepEqual(reply.viewer, { staff: false, canSetRoles: false, canAddActions: false, canPinHide: true });
    assert.ok(!("plan" in reply));
  });
});

test("without the CRM plan tables the people still load and the plan says unavailable", { skip }, async () => {
  await withSchema(async (db, insert) => {
    await seed(insert);
    await insert("user_tasks", { id: "task-1", user_id: "u-bgp", title: "Call Landsec", status: "todo" });
    await insert("crm_engagement_actions", { task_id: "task-1", company_id: "co-landsec" });
    const before = await people.loadPropertyPeople(db, P, STAFF);
    assert.equal(before.plan, "ok");
    assert.equal(byId(before, "contact:ct-director")!.plan?.next?.title, "Call Landsec");
    await db.query("DROP TABLE crm_engagement_actions");
    const reply = await people.loadPropertyPeople(db, P, STAFF);
    assert.equal(reply.plan, "unavailable");
    assert.ok(reply.people.length > 5);
    assert.equal(byId(reply, "contact:ct-director")!.plan, null);
  });
});

// The same number of queries for 3 and 300 schedule rows, and the 300-row staff read under a second.
test("a fixed number of queries whatever the size, and 300 units read in under a second", { skip }, async () => {
  const run = async (units: number) => {
    let queries = 0, ms = 0, reply: RecordPeopleReply | null = null;
    await withSchema(async (db, insert) => {
      await seed(insert);
      for (let i = 0; i < units; i++) {
        const n = String(i).padStart(3, "0");
        await insert("crm_companies", { id: `co-occ-${n}`, name: `Occupier ${n}`, company_type: "Tenant - Retail" });
        await insert("crm_contacts", { id: `ct-occ-${n}`, name: `Person ${n}`, company_id: `co-occ-${n}`, last_interaction: "2026-09-01" });
        await insert("tenancy_schedule_units", { id: `ts-big-${n}`, property_id: P, unit_number: `B${n}`, tenant_name: `Occupier ${n}`, status: "Occupied" });
        await insert("available_units", { id: `au-big-${n}`, property_id: P, unit_name: `B${n}`, marketing_status: i % 3 ? "AVA" : "NEG", tenant_company_id: `co-occ-${n}` });
      }
      await db.query("ANALYZE");
      const counted = { query: (sql: string, values?: any[]) => { queries++; return db.query(sql, values); } };
      await people.loadPropertyPeople(db, P, STAFF);
      queries = 0;
      const started = performance.now();
      reply = await people.loadPropertyPeople(counted, P, STAFF);
      ms = performance.now() - started;
    });
    return { queries, ms, reply: reply! as RecordPeopleReply };
  };
  const small = await run(3);
  const large = await run(300);
  console.log(`[property-people] 3 rows: ${small.queries} queries, ${small.ms.toFixed(0)} ms; 300 rows: ${large.queries} queries, ${large.ms.toFixed(0)} ms, ${large.reply.people.length} people`);
  assert.equal(large.queries, small.queries);
  assert.ok(large.ms < 1000, `300-row staff read took ${large.ms.toFixed(0)} ms`);
  // Every occupier is one company entry on its own row, matched to it by the tenancy schedule.
  const occupier = large.reply.people.find((p: RecordPerson) => p.id === "company:co-occ-150")!;
  assert.ok(occupier.relationships.some(r => r.scheduleRowId === "ts-big-150"));
  assert.ok(occupier.relationships.some(r => r.trackerId === "au-big-150" && r.scheduleRowId === "ts-big-150"));
});
