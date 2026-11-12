import test from "node:test";
import assert from "node:assert/strict";
import { buildOwnPeople, isSharedMailbox, ownEmailTest, type OwnContactRow } from "./client-own-contacts";

// The 14 scheme keys of server/landsec-schemes.ts, in its order (that file
// opens the database, so it is not imported here).
const schemes = ["liverpool-one", "trinity-leeds", "white-rose", "buchanan-galleries", "bluewater", "westgate-oxford", "st-davids",
  "gunwharf-quays", "clarks-village", "braintree-village", "one-new-change", "new-street-square", "lucent", "victoria",
].map(key => ({ key, name: key, group: "" }));
let n = 0;
const row = (name: string, extra: Partial<OwnContactRow> = {}): OwnContactRow => ({
  id: `c${++n}`, name, role: null, email: null, phone: null, updatedAt: null, companyId: "own", companyName: null, editable: true, ...extra,
});

test("shared mailboxes and system addresses are told from people", () => {
  for (const [name, email] of [
    ["Accountspayable", "accountspayable@landsec.com"], ["Accountsreceivable", null], ["Accountspayable Paymentrun", null],
    ["898 02 File", null], ["A1propertysmart (info@)", "info@a1propertysmart.co.uk"], ["Jane Smith", "no-reply@landsec.com"],
    ["jsmith", "jsmith@landsec.com"], ["0xsheetal", "0xsheetal@landsec.com"], ["12345", null], ["Leasing Team", null],
  ] as const) assert.equal(isSharedMailbox(name, email), true, name);
  for (const [name, email] of [
    ["Mark Warne", "mark.warne@landsec.com"], ["Adam", "adam.sawyer@landsec.com"], ["Adam", "adam@landsec.com"],
    ["mark.warne", "mark.warne@landsec.com"], ["abbie.copping@dlapiper.com", null], ["Na Do", null], ["John Sales", null],
    ["Abigail Kirkham", null],
  ] as const) assert.equal(isSharedMailbox(name, email), false, name);
});

test("a Landsec viewer's people are grouped from the team sheet", () => {
  const g = buildOwnPeople([
    row("Mark Warne", { email: "mark.warne@landsec.com", role: "Head of Leasing" }),
    row("Gemma", { email: "gemma.casey@landsec.com" }),
    row("Abigail Kirkham", { email: "abigail.kirkham@landsec.com" }),
    row("Accountspayable", { email: "accountspayable@landsec.com" }),
    row("Rob Hardie", { email: "rob.hardie@landsec.com", role: "Asset Manager" }),
    row("rob.hardie", { email: "rob.hardie@landsec.com", phone: "020 7946 0000" }),
  ], schemes);
  // Two records for one sheet name: one row, the typed name, details pooled.
  const rob = g.assetManagement.filter(p => /hardie/i.test(p.name));
  assert.deepEqual(rob.map(p => [p.name, p.title, p.phone]), [["Rob Hardie", "Asset Manager", "020 7946 0000"]]);
  const mark = g.leasing.find(p => p.name === "Mark Warne")!;
  assert.equal(mark.email, "mark.warne@landsec.com");
  assert.equal(mark.schemes.length, 14);
  assert.deepEqual(mark.roles, ["leasing"]);
  // Matched by her email address; the sheet's full name is shown.
  const gemma = g.assetManagement.find(p => p.name === "Gemma Casey")!;
  assert.equal(gemma.email, "gemma.casey@landsec.com");
  assert.deepEqual(gemma.schemes, ["bluewater"]);
  // On the sheet with no contact record: listed, no details invented.
  const viv = g.assetManagement.find(p => p.name === "Viv Lim")!;
  assert.equal(viv.contactId, null);
  assert.equal(viv.email, null);
  assert.equal(viv.phone, null);
  assert.deepEqual(viv.schemes, ["one-new-change", "new-street-square", "lucent", "victoria"]);
  assert.deepEqual(g.others.map(p => p.name), ["Abigail Kirkham"]);
  assert.deepEqual(g.mailboxes.map(p => p.name), ["Accountspayable"]);
  const all = [...g.leasing, ...g.assetManagement, ...g.others, ...g.mailboxes];
  assert.equal(new Set(all.map(p => p.key)).size, all.length);
});

test("another client gets one list and never the team sheet", () => {
  const g = buildOwnPeople([row("Mark Warne"), row("Sam Cole", { email: "sam.cole@hammerson.com" }), row("Info", { email: "info@hammerson.com" })], null);
  assert.equal(g.leasing.length, 0);
  assert.equal(g.assetManagement.length, 0);
  assert.deepEqual(g.others.map(p => p.name), ["Mark Warne", "Sam Cole"]);
  assert.ok(g.others.every(p => p.roles.length === 0 && p.schemes.length === 0));
  assert.deepEqual(g.mailboxes.map(p => p.name), ["Info"]);
});

test("records that are one person are listed once", () => {
  const g = buildOwnPeople([
    row("Adam", { email: "adam.sawyer@landsec.com", updatedAt: "2026-01-01" }),
    row("Adam Sawyer", { email: "Adam.Sawyer@landsec.com", phone: "020 7000 0000" }),
    row("Beth Hall", { updatedAt: "2026-01-01", role: "Old title" }),
    row("beth hall", { updatedAt: "2026-06-01", role: "New title" }),
  ], null);
  assert.deepEqual(g.others.map(p => [p.name, p.title, p.phone]), [["Adam Sawyer", null, "020 7000 0000"], ["beth hall", "New title", null]]);
});

test("a record with another organisation's email address is kept apart and is never a sheet person", () => {
  const rows = [
    row("Mark Warne", { email: "mark.warne@landsec.com" }),
    row("Priya Nair", { email: "priya.nair@landsec.com" }),
    row("Una Reid", { email: "una.reid@landsec-uandi.com" }),
    row("Oz Hart", { email: "oz.hart@landsec.com.au" }),
    row("Tom Whitfield"),
    row("Abbie Copping", { email: "abbie.copping@dlapiper.com" }),
    row("Rob Hardie", { email: "rob.hardie@barkerproudlove.co.uk", phone: "020 7946 0001" }),
    row("Info", { email: "info@a1propertysmart.co.uk" }),
    row("Sara Sub", { email: "sara@subsidiary.example", companyName: "Landsec Subsidiary Ltd", companyId: "sub" }),
  ];
  const own = ownEmailTest(rows, "landsec.com", ["Landsec", "landsec", "landsecurities"]);
  const g = buildOwnPeople(rows, schemes, own);
  assert.deepEqual(g.elsewhere.map(p => p.name), ["Abbie Copping", "Rob Hardie"]);
  assert.deepEqual(g.others.map(p => p.name), ["Oz Hart", "Priya Nair", "Sara Sub", "Tom Whitfield", "Una Reid"]);
  assert.deepEqual(g.mailboxes.map(p => p.name), ["Info"]);
  // The sheet's Rob Hardie is not the agent's record of that name.
  const rob = g.assetManagement.find(p => p.name === "Rob Hardie")!;
  assert.equal(rob.contactId, null);
  assert.equal(rob.phone, null);
  // With no recorded domain the commonest address on the row is the client's own.
  const guess = ownEmailTest(rows, null, ["Example Estates"]);
  assert.equal(guess("x@landsec.com"), true);
  assert.equal(guess("abbie.copping@dlapiper.com"), false);
  assert.equal(guess(null), true);
});
