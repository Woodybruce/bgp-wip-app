import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientContactRow, clientContactWrite } from "./client-contact-row";

const NOTE = "Auto-added from email — Charlotte Roberts, 2026-10-06\nJob title read from their signature in the email \"City Tower\" (2026-10-06, Charlotte Roberts's mailbox).";
const stored = {
  id: "c1", name: "Toby Whitehead", role: "Property Manager", companyId: "co1", companyName: "Bakehouse Ltd",
  email: "toby.whitehead@bakehouse.co.uk", phone: "0191 496 0101", phoneMobile: "07700 900456", avatarUrl: null,
  linkedinUrl: null, groupName: null, contactType: null, agentSpecialty: null, createdAt: "2026-10-06", updatedAt: "2026-10-06",
  notes: NOTE, bgpAllocation: "[\"London Leasing\"]", nextMeetingDate: "2026-12-01", bgpClient: true, isFavourite: true,
  enrichmentSource: "email-sync", lastEnrichedAt: "2026-10-07", mondayItemId: "m1", subGroup: "x",
  weeklyReportEnabled: true, weeklyReportLastSentAt: "2026-11-01",
};

test("a client login is sent a person's own details and none of BGP's working fields", () => {
  const sent = clientContactRow(stored)!;
  assert.deepEqual(Object.keys(sent).sort(), ["agentSpecialty", "avatarUrl", "companyId", "companyName", "contactType", "createdAt", "email",
    "groupName", "id", "linkedinUrl", "name", "phone", "phoneMobile", "role", "updatedAt"]);
  const text = JSON.stringify(sent);
  for (const secret of ["Auto-added", "Charlotte Roberts", "City Tower", "mailbox", "email-sync", "London Leasing", "2026-12-01"]) {
    assert.ok(!text.includes(secret), `${secret} must not reach a client`);
  }
  assert.equal(sent.role, "Property Manager");
  assert.equal(clientContactRow(null), null);
});

test("a column added later is closed to a client until it is listed", () => {
  assert.equal("sourceEmailId" in clientContactRow({ ...stored, sourceEmailId: "AAMk" })!, false);
});

test("a client's save cannot set or blank BGP's fields", () => {
  const body = { name: "Toby Whitehead", role: "Head of Property", notes: "", bgpAllocation: "[]", nextMeetingDate: "", bgpClient: false,
    enrichmentSource: "manual", isFavourite: false, avatarUrl: "x", phone: "0191" };
  assert.deepEqual(clientContactWrite(body), { name: "Toby Whitehead", role: "Head of Property", phone: "0191" });
  assert.deepEqual(clientContactWrite(null), {});
});

test("every contact reply to a client goes through the filter, and the source email route is staff only", () => {
  const crm = readFileSync(new URL("./crm.ts", import.meta.url), "utf8");
  const routes = crm.slice(crm.indexOf('app.get("/api/crm/contacts", async'), crm.indexOf('app.post("/api/crm/contacts/import-vcf"'));
  assert.ok(routes.length > 1000);
  // The list, the single read, create and update: each reply to a scoped caller is filtered.
  assert.equal((routes.match(/clientContactRow\(/g) || []).length, 4);
  assert.equal((routes.match(/clientContactWrite\(req\.body\)/g) || []).length, 2);
  assert.ok(!/res\.json\(contact\);\s*\} catch[^]*?app\.delete\("\/api\/crm\/contacts\/:id"/.test(routes.slice(routes.indexOf('app.put("/api/crm/contacts/:id"'))),
    "the update reply is not the raw row");
  const favourite = routes.slice(routes.indexOf('app.patch("/api/crm/contacts/:id/favourite"'));
  assert.match(favourite, /requireAuth/);
  assert.match(favourite, /if \(await resolveCompanyScope\(req\)\) return res\.status\(403\)/);

  const interactions = readFileSync(new URL("./interactions.ts", import.meta.url), "utf8");
  const route = interactions.slice(interactions.indexOf('app.get("/api/crm/contacts/:id/source-email"'));
  assert.match(route.slice(0, 500), /requireAuth[^]*canReadLandlordMeetings\(req\)\)\) return res\.status\(403\)/);

  const profile = readFileSync(new URL("./brand-profile.ts", import.meta.url), "utf8");
  assert.match(profile, /bpScope \? \{ left_note: null, enrichment_source: null, last_enriched_at: null \} : \{\}/);
  // The same people are sent a second time as decisionMakers: the same cut.
  assert.match(profile, /decisionMakers: bpScope\s*\? \(decisionMakers\.rows as any\[\]\)\.map\(\(d: any\) => \(\{ \.\.\.d, enrichment_source: null, last_enriched_at: null \}\)\)\s*: decisionMakers\.rows,/);
  assert.doesNotMatch(profile, /decisionMakers: decisionMakers\.rows,/);
});
