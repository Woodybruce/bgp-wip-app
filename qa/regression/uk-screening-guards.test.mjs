// UK screening without KYC4U (21 November 2026: screening on GLEIF and
// foundations in the UK, so the checks can be done without KYC4U). Source
// guards; the rules are tested in server/uk-screening.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("a UK company is looked up in GLEIF by its Companies House number, on Companies House's registers only", () => {
  const s = read("server/kyc-prechecks.ts");
  assert.match(s, /traceGleif\(\{ name: companiesHouse\.name, country: "GB", registrationNumber: companiesHouse\.number, authorities: COMPANIES_HOUSE_AUTHORITIES \}\)/);
  // Its top parent abroad joins the owners abroad only by the shared rule (the register names no owner).
  assert.match(s, /const gleifParent = gleifOwnerAbroad\(companiesHouse, partyGleif\);/);
  // A party with no UK number: GLEIF by name; a UK company there is read at Companies House, a charity's number goes to the register.
  assert.match(s, /register\?\.register === "companies_house" && clean\(found\.registeredAs, 20\)\) \{\s+number = clean\(found\.registeredAs, 20\);\s+numberFromGleif = true;/);
  assert.match(s, /register\?\.register === "charity_commission" && clean\(found\.registeredAs, 20\)\) \{\s+gleifCharityNumber = /);
  // The party's own GLEIF record is kept apart from the owners-abroad trace, so a UK company opens no Owners abroad section.
  assert.match(read("shared/kyc-prechecks.ts"), /export function abroadTraceLines\(result: Pick<KycPrecheckResult, "abroad"> \| null \| undefined\): string\[\] \{\s+const a = result\?\.abroad;\s+if \(!a\) return \[\];/);
});

test("the Charity Commission's register is read from its public download, at most once a day, never at boot or on a timer", () => {
  const s = read("server/charity-register.ts");
  assert.match(s, /ccewuksprdoneregsadata1\.blob\.core\.windows\.net\/data\/json/);
  assert.match(s, /const FRESH_MS = 24 \* 3600_000;/);
  assert.match(s, /CHARITY_REGISTER \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== "off"/);
  assert.doesNotMatch(s, /setInterval|cron|schedule/i);
  for (const f of ["server/index.ts", "server/routes.ts"]) assert.doesNotMatch(read(f), /charity-register/, f);
  // The look-up runs for a trust or foundation, a charity GLEIF names, a UK
  // company that may be a charitable company or a trustee, and a party with
  // no UK record whose name reads as a charity.
  const p = read("server/kyc-prechecks.ts");
  assert.match(p, /\(isTrust \|\| !!gleifCharityNumber/);
  assert.match(p, /\|\| \(ukCompany && \(chTypeMayBeCharity\(companiesHouse!\.type\) \|\| /);
  assert.match(p, /\|\| \(!companiesHouse && !abroad\?\.party && partyNames\.some\(readsLikeCharity\)\)\)\)/);
});

test("a trust or foundation is checked on its own record: no company that signs is asked for", () => {
  assert.match(read("server/aml-compliance.ts"), /aml_subject_type, ''\)\) IN \('individual', 'trust'\)/);
  assert.match(read("server/aml-file.ts"), /aml_subject_type, ''\)\) IN \('individual', 'trust'\)/);
  assert.match(read("server/kyc-prechecks.ts"), /aml_subject_type, ''\)\) IN \('individual', 'trust'\)/);
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /if \(input\.kind === "company" && !party\.entityId && !party\.trust\)/);
  assert.match(portal, /if \(party\.kind === "company" && !party\.entityId && !party\.trust\)/);
});

test("in-house enhanced due diligence is on unless an officer switches it off (Jack, 23 November 2026), and only the officers sign it off", () => {
  assert.match(read("server/aml-authority.ts"), /on: v \? v\.on !== false : true/);
  const policy = read("server/aml-policy.ts");
  const route = policy.slice(policy.indexOf('router.put("/api/aml-policy/in-house-edd"'));
  assert.match(route.slice(0, 800), /if \(!actor\.isMlro\) return res\.status\(403\)/);
  assert.match(route.slice(0, 900), /typeof req\.body\?\.on !== "boolean"/);
  const aml = read("server/deal-party-aml.ts");
  assert.match(aml, /if \(edd && me\.as !== "officer"\) return res\.status\(403\)/);
  assert.match(aml, /const level = edd \? "enhanced" :/);
  // The screens: no Sign off for an agent on an in-house enhanced party, and no KYC4U mark while it is on.
  const ui = read("client/src/components/deal-party-aml.tsx");
  assert.match(ui, /const mayPress = canSignOff && !\(view\?\.edd && !decisions\.canDecide\);/);
  assert.match(ui, /view\.blocked \|\| \(view\.edd && !decisions\.canDecide\)\) return null;/);
  assert.match(read("client/src/pages/aml-dashboard.tsx"), /!inHouseEdd && !row\.trust && amlNeedsKyc4u\(/);
  // The red KYC4U mark is the Next line's own (22 November 2026), which never asks for KYC4U while the officers do it in-house.
  assert.match(read("client/src/components/deal-aml-status.tsx"), /const kyc4uNeeded = step\.lead === "Not yet with KYC4U";/);
  const rules = read("shared/aml-box.ts");
  assert.match(rules, /if \(f\.kyc4u === "queued" && !f\.inHouseEdd\) \{\s*return step\("flag", "bgp", "Not yet with KYC4U"/);
  assert.match(rules, /if \(!edd\) \{/);
});
