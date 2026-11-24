// Ownership & KYC on the property page, and the full checks on a small letting
// (Woody, 23 November 2026). Source guards; the rules are tested in
// server/property-ownership.test.ts and server/deal-parties.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the ownership routes are BGP staff's and read only the free Land Registry lists", () => {
  const s = read("server/property-ownership.ts");
  for (const route of ['"/api/properties/:id/ownership"', '"/api/properties/:id/ownership/use"', '"/api/properties/:id/ownership/check"']) {
    const at = s.indexOf(`router.${route.endsWith('ownership"') ? "get" : "post"}(${route}`);
    assert.ok(at > 0, route);
    assert.match(s.slice(at, at + 400), /await staffMe\(req\)/, route);
  }
  // Never PropertyData, which charges per title (the comments say so; the code never calls it).
  const code = s.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /pdFetch|propertydata/i);
  assert.match(s, /FROM hmlr_proprietors/);
  // Use reads the title again on the server: nothing about the owner is taken from the request.
  assert.match(s, /findProprietorsByTitle\(titleNumber\)/);
  assert.doesNotMatch(s, /req\.body\??\.(name|number|proprietor)/);
  // A role a person set is never changed; a long lease's owner is never filed under the Owner.
  assert.match(s, /WHERE id = \$1 AND freeholder_id IS NULL RETURNING id/);
  assert.match(s, /WHERE id = \$1 AND long_leaseholder_id IS NULL RETURNING id/);
  assert.match(read("shared/property-ownership.ts"), /if \(text\(input\.tenure\)\.toLowerCase\(\) === "leasehold"\) \{\n\s+return input\.roles\.longLeaseholderId \? null : \{ kind: "long_leaseholder"/);
  // BGP's checks run only when a person presses for them, on a company filed under the Owner.
  assert.match(s, /parent_company_id = \$2`, \[entityId, ownerId\]/);
  assert.doesNotMatch(read("server/property-ownership.ts").split('router.get("/api/properties/:id/ownership"')[1].split("router.post")[0], /startPrecheck/);
  assert.match(read("server/index.ts"), /app\.use\(propertyOwnershipRouter\);/);
});

test("the property page: Ownership & KYC, investment beside the BGP take, no Property intelligence card", () => {
  const s = read("client/src/components/property-detail.tsx");
  assert.match(s, /data-testid="property-tab-details">Ownership &amp; KYC<\/Pill>/);
  assert.doesNotMatch(s, /<PropertyIntelligencePanel/);
  // Not in the Landsec view (Woody, 2026-11-24): the tab, the card and the AML pills.
  assert.match(s, /\{pdViewer\?\.isAdmin && !landsecView && <Pill active=\{phoneSection === "overview"\}/);
  assert.match(s, /\{planLayout && !isClientViewer && !landsecView && \(\s*<ErrorBoundary compact name="Ownership">/);
  assert.match(s, /\{!isClientViewer && !landsecView && amlDeals\.slice\(0, 4\)/);
  assert.match(s, /data-testid="property-intro-investment">Investment<\/Pill>/);
  assert.match(s, /<PropertyOwnershipCard propertyId=\{property\.id\} onOpenAml=\{setAmlDeal\} \/>/);
  // The plan-led page's news is in News & social only.
  assert.match(s, /\{!uiJointAgent && !planLayout && <ErrorBoundary compact name="Property news \(top-strip preview\)">/);
  // The card's AML list is the AML board's own rows for the building.
  assert.match(read("client/src/components/property-page/ownership-card.tsx"), /\/api\/aml-dashboard\?propertyId=/);
  assert.match(read("server/aml-dashboard.ts"), /AND d\.property_id = \$1/);
});

test("the AML box offers the building's registered owner for a landlord or a seller, never sets it", () => {
  const s = read("server/deal-parties.ts");
  assert.match(s, /const registered = \(role === "landlord" \|\| role === "vendor"\) && kind === "company" && !company \? landRegistry : null;/);
  assert.match(s, /companyOffer\(filed, role === "tenant" \? lease : null, registered\)/);
  // The contracting entity is worked out by itself only from the unit's lease.
  assert.doesNotMatch(read("client/src/components/deal-parties.tsx"), /why === "land_registry"[^\n]*mutate/);
});

test("the full checks on a small letting: asked for by name, signed off as full", () => {
  const s = read("server/deal-party-aml.ts");
  assert.match(s, /const fullOnSmall = !!opts\.full && natural === "sanctions_only";/);
  assert.match(s, /loadAmlParty\(pool, String\(req\.params\.id\), role, \{ full: req\.body\?\.full === true \}\)/);
  assert.match(read("server/aml-compliance.ts"), /parties\[c\.id\]\.full = aml\.signOffView\(fullFacts\);/);
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.match(box, /const sanctionsOnly = smallLetting && !fullOnSmall;/);
  assert.match(box, /get\("full"\) === cp\.role/);
  assert.match(read("client/src/components/deal-party-aml.tsx"), /\.\.\.\(full \? \{ full: true \} : \{\}\)/);
  // Group entities say a sanctions-only approval is one, and start the full checks on its transaction.
  assert.match(read("server/account-entities.ts"), /scope: row\.kyc_status === "approved" \? entitySignOffScope\(/);
  const panel = read("client/src/components/account-entities-panel.tsx");
  assert.match(panel, /Sanctions only · under £10k a month/);
  assert.match(panel, /\?section=parties&full=\$\{encodeURIComponent\(/);
});
