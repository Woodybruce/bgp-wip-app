// Ownership & KYC on the property page, and the full checks on a small letting
// (Woody, 23 November 2026). Source guards; the rules are tested in
// server/property-ownership.test.ts and server/deal-parties.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the ownership routes are BGP staff's and read only the free Land Registry lists", () => {
  const s = read("server/property-ownership.ts");
  for (const route of ['"/api/properties/:id/ownership"', '"/api/properties/:id/ownership/use"']) {
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
  assert.match(s, /SET \$\{column\} = \$2, updated_at = now\(\) WHERE id = \$1 AND \$\{column\} IS NULL RETURNING id/);
  assert.match(s, /const column = plan\.kind === "long_leaseholder" \? "long_leaseholder_id" : "freeholder_id";/);
  // A head lease's owner is filed under the Long leaseholder, never the Owner; a unit's lease is never the building's.
  const rules = read("shared/property-ownership.ts");
  assert.match(rules, /if \(text\(input\.tenure\)\.toLowerCase\(\) === "leasehold"\) \{\n\s+if \(input\.unitLease\) return null;/);
  assert.match(rules, /if \(!input\.roles\.longLeaseholderId\) return \{ kind: "long_leaseholder", company: input\.proprietor\.crm \? "existing" : "create", files: true \};/);
  assert.match(s, /const accountId = leasehold \? leaseholderId : asFreeholder \? freeholderId : ownerId;/);
  // The KYC on a company filed here is the shared client KYC window (one build for AML, 24 November 2026): the
  // card has no checks route of its own. BGP's checks start by themselves once Use has filed a company and the
  // change is saved (Woody, 24 November 2026), never inside the transaction and never on a read.
  assert.doesNotMatch(s, /ownership\/check/);
  const commitAt = s.indexOf('await client.query("COMMIT");');
  const startAt = s.indexOf("startPrecheck(filedFor.accountId");
  assert.ok(commitAt > 0 && startAt > commitAt, "the checks start after the commit");
  assert.equal((s.match(/startPrecheck\(/g) || []).length, 1);
  assert.match(s, /startPrecheck\(filedFor\.accountId, \{ entityId: filedFor\.entityId, userId: actor\.id \}\)/);
  assert.match(read("client/src/components/property-page/ownership-card.tsx"), /<ClientKycDialog companyId=\{owner\.account\.id\} entityId=\{owner\.filed\.entityId\}/);
  // Beyond the postcode only with no freehold among the building's titles; a title a person typed is read from the lists.
  assert.match(s, /if \(landRegistry\.available && !here\.some\(f => isFreehold\(f\.t\)\)\) \{/);
  assert.match(s, /WHERE lower\(property_address\) LIKE \$1 AND lower\(tenure\) = 'freehold' AND \$\{near\}/);
  assert.match(s, /if \(typed && !\/\^\[A-Z\]\{0,4\}\\d\{1,9\}\$\/\.test\(typed\)\) return res\.status\(400\)/);
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
  // The owners' KYC is the shared Companies and KYC card; the older company checks card is a client login's only.
  assert.match(s, /<PropertyOwnersKyc property=\{property as any\} \/>/);
  assert.match(s, /\{!uiJointAgent && isClientViewer && <PropertySection name=\{planLayout \? "overview" : "kyc"\}/);
  assert.match(read("client/src/components/property-page/owners-kyc.tsx"), /<AccountEntitiesPanel key=\{id\} companyId=\{id\} label=\{joinRoles\(labels\)\} \/>/);
  // The plan-led page's news is in News & social only.
  assert.match(s, /\{!uiJointAgent && !planLayout && <ErrorBoundary compact name="Property news \(top-strip preview\)">/);
  // The card's AML list is the AML board's own rows for the building.
  assert.match(read("client/src/components/property-page/ownership-card.tsx"), /\/api\/aml-dashboard\?propertyId=/);
  assert.match(read("server/aml-dashboard.ts"), /AND d\.property_id = \$1/);
});

test("the AML box offers the building's registered owner for a landlord or a seller, never sets it", () => {
  const s = read("server/deal-parties.ts");
  assert.match(s, /const registered = \(role === "landlord" \|\| role === "vendor"\) && kind === "company" && !company \? landRegistry : null;/);
  // From the companies filed under it, less one filed from a wrong Companies House link (25 November 2026).
  assert.match(s, /companyOffer\(offerable, role === "tenant" \? lease : null, registered\)/);
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
  assert.match(panel, /amlBoardHref\(t\.id, t\.role\)\}&full=\$\{encodeURIComponent\(/);
});
