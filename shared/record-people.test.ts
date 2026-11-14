// The one rule for what a login is sent about the people on a record
// (shared/record-people.ts). Pure: no database.
//   node --import tsx --test shared/record-people.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  actionPlaceFor, groupOf, peopleOnUnit, PEOPLE_GROUPS, PROPERTY_CLIENT_ROLES, recordPersonForViewer, roleOnRecord, sortRecordPeople, unplaced,
  type RecordPersonSource, type RecordRelationship,
} from "./record-people";

const rel = (over: Partial<RecordRelationship>): RecordRelationship => ({
  group: "units", role: "Tenant", roleSource: "derived", visibility: "all", source: "evidence",
  deal: null, scheduleRowId: null, trackerId: null, unitName: null, status: null, ...over,
});

const person = (over: Partial<RecordPersonSource> = {}): RecordPersonSource => ({
  id: "contact:c1", kind: "person", name: "Alex Agent", jobTitle: "Head of leasing", email: "alex@example.test", phone: "0207",
  contactId: "c1", company: { id: "co1", name: "Agency" }, canOpenContact: true, canOpenCompany: true,
  group: "units", side: "other", roleOnRecord: "Tenant", roleSource: "derived",
  relationships: [rel({ deal: { id: "d1", name: "Unit 1 letting" }, scheduleRowId: "s1", trackerId: "t1", unitName: "Unit 1", status: "NEG" })],
  companyKind: "brand", ownerPerson: false, source: "evidence", via: "canary-user-id",
  lastContactAt: "2031-01-01", lastContactPerson: { id: "canary-user-id", name: "Canary" },
  plan: { openCount: 1, hereCount: 1, next: { id: "a1", title: "CANARY-ACTION", dueAt: null, ownerName: "canary-user-id", here: true },
    strategies: [{ id: "s1", name: "CANARY-STRATEGY", contactIds: ["c1"] }] },
  addedBy: "canary-user-id", leftAt: "2031-01-01",
  ...over,
});

const CLIENT_KEYS = ["id", "kind", "name", "jobTitle", "email", "phone", "contactId", "company", "group", "side", "roleOnRecord", "roleSource", "relationships"];
const STAFF_ONLY = ["companyKind", "ownerPerson", "source", "via", "lastContactAt", "lastContactPerson", "plan", "addedBy", "leftAt"];

test("groups are in the agreed order", () => {
  assert.deepEqual(PEOPLE_GROUPS.map(g => g.key), ["bgp", "client", "owner", "units", "deals", "advisers", "added"]);
  assert.ok(PROPERTY_CLIENT_ROLES.includes("Asset Manager"));
});

test("a person sits in the first group any relationship puts them in", () => {
  // A deal's tenant contact who also has a crm_property_clients row is on the client's team.
  const both = [rel({ group: "units", role: "Tenant" }), rel({ group: "client", role: "Asset Manager", roleSource: "set" })];
  assert.equal(groupOf(both), "client");
  assert.equal(recordPersonForViewer(person({ relationships: both }), { staff: true })!.group, "client");
  // A pin alone is Added by the team.
  assert.equal(groupOf([rel({ group: "added", role: "Added by the team" })]), "added");
  assert.equal(groupOf([rel({ group: "added" }), rel({ group: "advisers" })]), "advisers");
});

test("a role someone set beats a derived one, in group order", () => {
  assert.deepEqual(roleOnRecord([rel({ group: "owner", role: "Director" }), rel({ group: "client", role: "Legal", roleSource: "set" })]), { role: "Legal", roleSource: "set" });
  assert.deepEqual(roleOnRecord([rel({ group: "units", role: "Tenant" }), rel({ group: "owner", role: "Director" })]), { role: "Director", roleSource: "derived" });
  assert.deepEqual(roleOnRecord([rel({ group: "deals", role: "Vendor" }), rel({ group: "added", role: "Pinned", roleSource: "set" })]), { role: "Pinned", roleSource: "set" });
});

test("a client login gets exactly the allow-list, and none of BGP's history or plan", () => {
  const out = recordPersonForViewer(person(), { staff: false })!;
  assert.deepEqual(Object.keys(out).sort(), [...CLIENT_KEYS].sort());
  for (const key of STAFF_ONLY) assert.ok(!(key in out), `${key} must be absent`);
  const json = JSON.stringify(out);
  for (const canary of ["2031-01-01", "CANARY-ACTION", "CANARY-STRATEGY", "canary-user-id"]) assert.ok(!json.includes(canary), canary);
  assert.deepEqual(Object.keys(out.relationships[0]).sort(), ["deal", "group", "role", "roleSource", "scheduleRowId", "status", "trackerId", "unitName"]);
  assert.deepEqual(out.relationships[0].deal, { id: "d1", name: "Unit 1 letting" });
});

test("the rule never hands back its input or shares nested objects", () => {
  const input = person();
  for (const staff of [true, false]) {
    const out = recordPersonForViewer(input, { staff })!;
    assert.notEqual(out, input);
    assert.notEqual(out.relationships, input.relationships);
    assert.notEqual(out.relationships[0], input.relationships[0]);
    assert.notEqual(out.company, input.company);
  }
  const extra = { ...person(), secretColumn: "CANARY-COLUMN" } as any;
  assert.ok(!JSON.stringify(recordPersonForViewer(extra, { staff: true })).includes("CANARY-COLUMN"));
});

test("staff get every field", () => {
  const out = recordPersonForViewer(person(), { staff: true })!;
  for (const key of [...CLIENT_KEYS, ...STAFF_ONLY]) assert.ok(key in out, key);
  assert.equal(out.lastContactAt, "2031-01-01");
  assert.equal(out.plan!.next!.title, "CANARY-ACTION");
  assert.equal(out.relationships[0].visibility, "all");
});

test("staff-only relationships are dropped for a client, and so is a person left with none", () => {
  const mixed = person({ relationships: [rel({ group: "owner", role: "In touch with BGP", visibility: "staff" }), rel({ group: "deals", role: "Vendor" })] });
  const out = recordPersonForViewer(mixed, { staff: false })!;
  assert.deepEqual(out.relationships.map(r => r.role), ["Vendor"]);
  // The group and role come from what the client may see.
  assert.equal(out.group, "deals");
  assert.equal(out.roleOnRecord, "Vendor");
  assert.equal(recordPersonForViewer(person({ relationships: [rel({ role: "Viewed", visibility: "staff" })] }), { staff: false }), null);
  assert.ok(recordPersonForViewer(person({ relationships: [rel({ role: "Viewed", visibility: "staff" })] }), { staff: true }));
});

test("a BGP relationship carries no deal, unit or source for a client", () => {
  const bgp = person({ id: "user:u1", contactId: null, company: null, relationships: [rel({ group: "bgp", role: "On deals", deal: { id: "d1", name: "Deal" }, source: "deals", scheduleRowId: "s1" })] });
  const out = recordPersonForViewer(bgp, { staff: false })!;
  assert.deepEqual(out.relationships, [{ group: "bgp", role: "On deals", roleSource: "derived" }]);
  assert.equal(out.side, "bgp");
});

test("the company id and the contact id are withheld where a client may not open them", () => {
  const out = recordPersonForViewer(person({ canOpenCompany: false, canOpenContact: false }), { staff: false })!;
  assert.deepEqual(out.company, { name: "Agency" });
  assert.ok(!("contactId" in out));
  assert.deepEqual(Object.keys(out).sort(), CLIENT_KEYS.filter(k => k !== "contactId").sort());
  const staff = recordPersonForViewer(person({ canOpenCompany: false, canOpenContact: false }), { staff: true })!;
  assert.deepEqual(staff.company, { id: "co1", name: "Agency" });
  assert.equal(staff.contactId, "c1");
});

test("side follows the group", () => {
  assert.equal(recordPersonForViewer(person({ relationships: [rel({ group: "client", role: "Leasing team", roleSource: "set" })] }), { staff: false })!.side, "client");
  assert.equal(recordPersonForViewer(person({ relationships: [rel({ group: "owner", role: "Director" })] }), { staff: false })!.side, "client");
  assert.equal(recordPersonForViewer(person(), { staff: false })!.side, "other");
});

test("order is set roles first, then names, never recency", () => {
  const people = [
    { id: "3", name: "Zed", group: "client" as const, roleSource: "derived" as const },
    { id: "1", name: "Bea", group: "client" as const, roleSource: "derived" as const },
    { id: "2", name: "Yan", group: "client" as const, roleSource: "set" as const },
    { id: "4", name: "Abe", group: "units" as const, roleSource: "set" as const },
  ];
  assert.deepEqual(sortRecordPeople(people).map(p => p.name), ["Yan", "Bea", "Zed", "Abe"]);
});

test("people on a unit are matched by schedule row or tracker row, never by name", () => {
  const onRow = person({ id: "a", relationships: [rel({ scheduleRowId: "s1", unitName: "Unit 1" })] });
  const onTracker = person({ id: "b", relationships: [rel({ trackerId: "t1", unitName: "Something else" })] });
  const sameName = person({ id: "c", relationships: [rel({ unitName: "Unit 1" })] });
  const nowhere = person({ id: "d", relationships: [rel({})] });
  const all = [onRow, onTracker, sameName, nowhere];
  assert.deepEqual(peopleOnUnit(all, { scheduleRowId: "s1", trackerId: "t1" }).map(p => p.id), ["a", "b"]);
  assert.deepEqual(peopleOnUnit(all, { scheduleRowId: "s1", trackerId: null }).map(p => p.id), ["a"]);
  // Two empty keys never match each other.
  assert.deepEqual(peopleOnUnit(all, { scheduleRowId: null, trackerId: null }).map(p => p.id), []);
  assert.deepEqual(unplaced(all, [{ scheduleRowId: "s1", trackerId: "t1" }]).map(p => p.id), ["c", "d"]);
  assert.deepEqual(unplaced(all, []).map(p => p.id), ["a", "b", "c", "d"]);
});

test("an action from a person carries a place only for a brand at a scheme property", () => {
  const partners = [{ schemes: [{ propertyIds: ["bluewater", "bluewater-sibling"] }] }];
  assert.deepEqual(actionPlaceFor("bluewater", "s1", partners, "landlord"), { propertyId: null, tenancyUnitId: null });
  assert.deepEqual(actionPlaceFor("high-street", "s1", partners, "brand"), { propertyId: null, tenancyUnitId: null });
  assert.deepEqual(actionPlaceFor("bluewater", "s1", partners, "brand"), { propertyId: "bluewater", tenancyUnitId: "s1" });
  assert.deepEqual(actionPlaceFor("bluewater", null, partners, "brand"), { propertyId: "bluewater", tenancyUnitId: null });
  assert.deepEqual(actionPlaceFor("bluewater", "s1", undefined, "brand"), { propertyId: null, tenancyUnitId: null });
});
