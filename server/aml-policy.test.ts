// BGP's AML policy and risk assessment, Issue 2, as rules (Woody, 19
// November 2026; shared/aml-policy.ts).
import test from "node:test";
import assert from "node:assert/strict";
import {
  AML_HOTS_CLAUSE, AML_POLICY_DOCUMENTS, NOT_REQUIRED_REASONS, RECHECK_YEARS,
  MAX_AML_DEPUTIES, amlOfficerRole, amlPolicyDocument, amlRegime, countryOf, countryRisk, deputyNames, dueDiligenceLevel, inLondonOrSouthEast, isDealAgent,
  notRequiredInput, officerWords, policyFactorFlags, policyFactorsToWeigh, readDeputies, recheckDate, sectorMatches, sellsCitizenship,
  simplifiedBasis, superPrimeFlag,
} from "../shared/aml-policy";
import { STANDARD_HOTS_TEMPLATE, STANDARD_HOTS_TEMPLATE_37 } from "../shared/unit-hots";
import { dealRedFlags, partyRedFlags, redFlagNote } from "../shared/kyc-red-flags";
import { signOffDenial } from "../shared/party-kyc";
import { amlBucket, amlStage } from "../shared/aml-dashboard";

const officers = {
  nominated: { id: "jack", name: "Jack Barratt", email: "jack@brucegillinghampollard.com" },
  deputies: [{ id: "victoria", name: "Victoria Broadhead", email: "victoria@brucegillinghampollard.com" }],
};

test("the Nominated Officer and the Deputy both decide; admins only while no Nominated Officer is set", () => {
  assert.deepEqual(amlOfficerRole({ id: "jack" }, officers, false), { role: "nominated", appointed: true });
  assert.deepEqual(amlOfficerRole({ id: "x", email: "VICTORIA@brucegillinghampollard.com" }, officers, false), { role: "deputy", appointed: true });
  assert.deepEqual(amlOfficerRole({ id: "woody" }, officers, true), { role: null, appointed: true });
  assert.deepEqual(amlOfficerRole({ id: "woody" }, { nominated: null, deputies: [] }, true), { role: "admin", appointed: false });
  assert.deepEqual(amlOfficerRole({ id: "agent" }, { nominated: null, deputies: [] }, false), { role: null, appointed: false });
  assert.equal(officerWords(officers), "the Nominated Officer (Jack Barratt) or the Deputy (Victoria Broadhead)");
});

// Woody, 20 November 2026: "jack as officer and then layla and i as depituties".
test("more than one Deputy: each decides, and the stored single Deputy still reads", () => {
  const two = {
    nominated: officers.nominated,
    deputies: [
      { id: "layla", name: "Layla O'Driscoll", email: "layla@brucegillinghampollard.com" },
      { id: "woody", name: "Woody Bruce", email: "woody@brucegillinghampollard.com" },
    ],
  };
  assert.deepEqual(amlOfficerRole({ id: "layla" }, two, false), { role: "deputy", appointed: true });
  assert.deepEqual(amlOfficerRole({ id: "w", email: "Woody@brucegillinghampollard.com" }, two, false), { role: "deputy", appointed: true });
  assert.deepEqual(amlOfficerRole({ id: "victoria" }, two, true), { role: null, appointed: true });
  assert.equal(officerWords(two), "the Nominated Officer (Jack Barratt) or a Deputy (Layla O'Driscoll or Woody Bruce)");
  assert.equal(deputyNames(two), "Layla O'Driscoll and Woody Bruce");
  assert.equal(officerWords({ nominated: officers.nominated, deputies: [] }), "the Nominated Officer (Jack Barratt)");

  // Stored as a list since 20 November 2026; one officer before.
  assert.deepEqual(readDeputies({ deputies: two.deputies, setBy: "Woody Bruce" }), two.deputies);
  assert.deepEqual(readDeputies({ id: "victoria", name: "Victoria Broadhead", email: "victoria@brucegillinghampollard.com", setBy: "x" }), officers.deputies);
  assert.deepEqual(readDeputies({ id: null, name: null, email: null }), []);
  assert.deepEqual(readDeputies(null), []);
  assert.deepEqual(readDeputies("nonsense"), []);
  assert.deepEqual(readDeputies({ deputies: [{ id: "a" }, null, { email: "b@x.com" }, { id: "c" }, { id: "d" }] }).map(d => d.id || d.email), ["a", "b@x.com", "c"].slice(0, MAX_AML_DEPUTIES));
});

test("approvals last 3 years, or 1 for enhanced due diligence", () => {
  assert.deepEqual(RECHECK_YEARS, { simplified: 3, standard: 3, enhanced: 1 });
  const from = new Date("2026-11-19T12:00:00Z");
  assert.equal(recheckDate("standard", from).toISOString().slice(0, 10), "2029-11-19");
  assert.equal(recheckDate("enhanced", from).toISOString().slice(0, 10), "2027-11-19");
});

test("the level: enhanced on any flag or factor that counts, simplified on a basis, else standard", () => {
  const flag = { label: "Possible match on the UK Sanctions List" };
  assert.equal(dueDiligenceLevel({ partyFlags: [flag], dealFlags: [], simplifiedBasis: "Listed" }).level, "enhanced");
  assert.equal(dueDiligenceLevel({ partyFlags: [], dealFlags: [{ label: "Super-prime sale", factor: true }], simplifiedBasis: null }).why[0], "On the deal: Super-prime sale");
  assert.equal(dueDiligenceLevel({ partyFlags: [], dealFlags: [], simplifiedBasis: "Listed on a regulated market" }).level, "simplified");
  const std = dueDiligenceLevel({ partyFlags: [], dealFlags: [], simplifiedBasis: null, toWeigh: ["Restaurants"] });
  assert.equal(std.level, "standard");
  assert.equal(std.recheckYears, 3);
  assert.deepEqual(std.toWeigh, ["Restaurants"]);
});

test("which checks a deal needs: sales full, lettings by rent, advisory work none", () => {
  assert.equal(amlRegime({ dealType: "Purchase", rentPa: 50_000 }).regime, "full");
  assert.equal(amlRegime({ dealType: "New Letting", rentPa: 120_000 }).regime, "full");
  assert.equal(amlRegime({ dealType: "New Letting", rentPa: 119_999 }).regime, "sanctions_only");
  assert.equal(amlRegime({ dealType: "Licence", rentPa: null }).regime, "full");
  assert.equal(amlRegime({ dealType: "Lease Acquisition", rentPa: 60_000 }).regime, "sanctions_only");
  assert.equal(amlRegime({ dealType: "Rent Review", rentPa: 500_000 }).regime, "advisory");
  assert.equal(amlRegime({ dealType: "New Letting", team: ["Investment"], rentPa: 10 }).regime, "full");
});

test("countries: names and nationalities, FATF's lists, the risk assessment's list, golden visas", () => {
  assert.equal(countryOf("Russian"), "Russia");
  assert.equal(countryOf("Virgin Islands, British"), "British Virgin Islands");
  assert.equal(countryOf("Road Town, Tortola"), "British Virgin Islands");
  assert.equal(countryOf("Korea, Republic of"), null);
  assert.equal(countryOf("United Kingdom"), null);
  assert.equal(countryOf("Dominican"), null, "the Dominican Republic sells no citizenship");
  assert.equal(countryRisk("Iran"), "fatf_call_for_action");
  assert.equal(countryRisk("British Virgin Islands"), "fatf_increased_monitoring");
  assert.equal(countryRisk("China"), "fwra_eurasia_africa");
  assert.equal(countryRisk("Bulgaria"), null, "off FATF's list in October 2026");
  assert.equal(sellsCitizenship(countryOf("Turkish")), true);
  assert.equal(sellsCitizenship(countryOf("French")), false);
});

test("sectors: the risk assessment's list is enhanced; restaurants and bars are to weigh (Woody's answer)", () => {
  const g = sectorMatches({ sicCodes: ["92000"] });
  assert.equal(g[0].key, "gambling");
  assert.equal(g[0].enhanced, true);
  const bar = sectorMatches({ companyType: "Tenant - Bar" });
  assert.equal(bar[0].key, "food_drink");
  assert.equal(bar[0].enhanced, false);
  assert.equal(sectorMatches({ companyType: "Tenant - Café" })[0]?.key, "food_drink");
  assert.equal(sectorMatches({ sicCodes: ["28131"] })[0]?.key, "dual_use");
  assert.equal(sectorMatches({ sicCodes: ["28230"] }).length, 0, "office machinery is not heavy machinery");
  assert.equal(sectorMatches({ sicCodes: ["96020"] })[0]?.key, "hair_beauty");
  assert.equal(sectorMatches({ companyType: "Tenant - Beauty" }).length, 0, "beauty retail is not a beauty parlour");
  assert.equal(sectorMatches({ sicCodes: ["06200"] })[0]?.key, "extractive");
});

const precheck = (ch: Record<string, unknown>): any => ({
  kind: "precheck", version: 9, ranAt: "2026-11-19T10:00:00Z",
  party: { companyId: "b1", name: "Party", subjectKind: "company", contactName: null },
  companiesHouse: { number: "01234567", name: "PARTY LTD", status: "active", type: "ltd", incorporatedOn: null, registeredOffice: "1 High Street, London, EC1A 1AA, United Kingdom",
    jurisdiction: "england-wales", sicCodes: [], accountsOverdue: false, confirmationOverdue: false, lastAccountsMadeUpTo: null, lastAccountsType: null,
    hasInsolvencyHistory: false, insolvencyCases: 0, officers: [], owners: [], statements: [], listing: null, chain: [], peopleUpChain: [], offshoreOwners: [],
    disqualified: [], covenant: null, documents: [], ...ch },
  notAtCompaniesHouse: null, sanctions: { ran: true, lists: [], lines: [], error: null }, web: { ran: false, lines: [], skipped: null },
  complyAdvantage: { ran: false, lines: [], skipped: null }, errors: [],
});

test("the policy's higher-risk factors, read from the register", () => {
  assert.deepEqual(policyFactorFlags({ precheck: precheck({}) }), [], "a plain UK company with UK owners has none");
  const trust = policyFactorFlags({ precheck: precheck({ owners: [{ name: "Smith Family Trustees Ltd", kind: "company", controls: ["ownership-of-shares-75-to-100-percent-as-trust"], notifiedOn: null, country: "England" }] }) });
  assert.equal(trust[0].kind, "policy_trust");
  assert.equal(trust[0].factor, true);
  const lp = policyFactorFlags({ precheck: precheck({ type: "limited-partnership", name: "PROPCO LP" }) });
  assert.equal(lp[0].kind, "policy_pooled");
  const bvi = policyFactorFlags({ precheck: precheck({ owners: [{ name: "Holdco Ltd", kind: "company", controls: [], notifiedOn: null, country: "British Virgin Islands" }] }) });
  assert.ok(bvi.some(f => f.kind === "policy_country" && f.key === "policy:country:british-virgin-islands"));
  const cbi = policyFactorFlags({ precheck: precheck({ owners: [{ name: "Ayse Kaya", kind: "individual", controls: [], notifiedOn: null, nationality: "Turkish", residence: "United Kingdom" }] }) });
  assert.ok(cbi.some(f => f.kind === "policy_cbi"));
  const sector = policyFactorFlags({ precheck: precheck({ sicCodes: ["92000"] }) });
  assert.ok(sector.some(f => f.kind === "policy_sector" && f.key === "policy:sector:gambling"));
  assert.deepEqual(policyFactorFlags({ precheck: precheck({ sicCodes: ["56101"] }) }), [], "a restaurant is not enhanced by itself");
  assert.deepEqual(policyFactorsToWeigh({ precheck: precheck({ sicCodes: ["56101"] }) }).length, 1);
});

test("the policy's basis for simplified due diligence", () => {
  assert.match(simplifiedBasis({ precheck: precheck({ listing: { market: "uk_regulated", since: null, company: "HAMMERSON PLC", companyNumber: "00360632", viaParent: false } }) })!, /regulated market/);
  assert.match(simplifiedBasis({ precheck: precheck({ type: "investment-company-with-variable-capital" }) })!, /FCA/);
  assert.match(simplifiedBasis({ precheck: null, partyName: "London Borough of Croydon" })!, /public body/);
  assert.equal(simplifiedBasis({ precheck: precheck({}) }), null);
});

test("super-prime sales: £5m in London and the South East, over £1m elsewhere", () => {
  assert.equal(inLondonOrSouthEast("SW1A 1AA"), true);
  assert.equal(inLondonOrSouthEast("M1 1AE"), false);
  assert.equal(inLondonOrSouthEast("EN6 1AA"), false, "Potters Bar is Hertfordshire");
  assert.equal(inLondonOrSouthEast("EN1 1AA"), true, "Enfield is London");
  assert.equal(inLondonOrSouthEast("MK9 1AA"), true, "Milton Keynes is Buckinghamshire");
  assert.equal(inLondonOrSouthEast("MK40 1AA"), false, "Bedford is Bedfordshire");
  assert.ok(superPrimeFlag({ dealType: "Sale", pricing: 6_000_000, postcode: "W1D 3QF" }));
  assert.equal(superPrimeFlag({ dealType: "Sale", pricing: 3_000_000, postcode: "W1D 3QF" }), null);
  assert.ok(superPrimeFlag({ dealType: "Purchase", pricing: 1_500_000, postcode: "M1 1AE" }));
  assert.equal(superPrimeFlag({ dealType: "New Letting", pricing: 9_000_000, postcode: "M1 1AE" }), null, "a letting has no sale price");
  assert.equal(superPrimeFlag({ dealType: "Sale", pricing: 1_000_000, postcode: "M1 1AE" }), null, "over £1m, not £1m itself");
});

test("Not required: one of the policy's two reasons and a comment", () => {
  assert.ok("problem" in notRequiredInput({ reason: "other", comment: "A long enough comment" }));
  assert.ok("problem" in notRequiredInput({ reason: "joint_agent", comment: "short" }));
  const ok = notRequiredInput({ reason: "joint_agent", comment: "Savills found and negotiated the tenant." });
  assert.ok("reason" in ok && ok.reason === "joint_agent");
  assert.equal(Object.keys(NOT_REQUIRED_REASONS).length, 2);
  assert.equal(amlStage({ role: "tenant", dealStatus: "SOL", kyc: { status: null, expiresAt: null }, precheckAt: null, clientSentAt: null, clientFinishedAt: null, kyc4uOpen: false, kyc4uInReview: false, notRequired: true }), "not_required");
  assert.equal(amlBucket("not_required", true), "done");
  assert.equal(amlStage({ role: "tenant", dealStatus: "SOL", kyc: { status: "rejected", expiresAt: null }, precheckAt: null, clientSentAt: null, clientFinishedAt: null, kyc4uOpen: false, kyc4uInReview: false, notRequired: true }), "rejected", "a rejection stays a rejection");
});

test("a deal's agent is found by login or by name", () => {
  assert.equal(isDealAgent({ id: "u1", name: "Jack Barratt" }, { internal_agent_ids: ["u1"] }), true);
  assert.equal(isDealAgent({ id: "u2", name: "Jack Barratt" }, { internal_agent: ["jack barratt"] }), true);
  assert.equal(isDealAgent({ id: "u3", name: "Someone" }, { internal_agent_ids: ["u1"], internal_agent: ["Jack Barratt"] }), false);
});

test("a letting under £10,000 a month needs no client checks or note before sign-off", () => {
  const facts = { rejected: false, current: null, withKyc4u: false, redFlags: 0, dealRedFlags: 0, unchecked: [], higherRisk: false,
    precheck: { ranAt: new Date().toISOString() }, precheckRunning: false, clientChecksFinished: false, note: "" };
  assert.match(signOffDenial(facts)!, /client checks are not finished/);
  assert.equal(signOffDenial({ ...facts, sanctionsOnly: true }), null);
});

test("factors reach the red flags, the deal's flags and KYC4U's note, listed apart", () => {
  const flags = partyRedFlags({ company: { company_type: "Tenant - Bar" }, latestInvestigation: null, requests: [], idChecks: [],
    precheck: { result: precheck({ sicCodes: ["92000"] }), current: true } });
  assert.ok(flags.some(f => f.factor && f.kind === "policy_sector"));
  const deal = dealRedFlags({ deal_type: "Sale", pricing: 8_000_000, postcode: "SW1A 1AA" });
  assert.equal(deal[0].kind, "super_prime");
  const note = redFlagNote([{ ...flags[0] }], deal);
  assert.match(note, /Higher-risk factors in BGP's AML policy \(enhanced due diligence\):/);
  assert.match(note, /On the deal: Super-prime sale/);
});

test("BGP's standard heads of terms carry the AML clause; the 37-clause copy is kept to recognise", () => {
  assert.ok(STANDARD_HOTS_TEMPLATE.includes(`38. Anti-money laundering\n${AML_HOTS_CLAUSE}`));
  assert.ok(!STANDARD_HOTS_TEMPLATE_37.includes("38. Anti-money laundering"));
  assert.ok(STANDARD_HOTS_TEMPLATE.trimEnd().endsWith("Code for Leasing Business Premises in England & Wales."));
});

test("the two documents are listed by issue", () => {
  assert.equal(AML_POLICY_DOCUMENTS.length, 2);
  assert.equal(amlPolicyDocument("policy-issue-2")?.file, "bgp-aml-policy-issue-2.docx");
  assert.equal(amlPolicyDocument("../etc/passwd"), null);
});
