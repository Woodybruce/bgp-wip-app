// Fable's written view of a party's AML file (Woody, 24 November 2026): the
// facts it is given, the checks on its answer, and the record's own fixes
// for a company owned through a listed one (Vodafone #4664).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRiskAssessment, type RiskAssessmentInput } from "../shared/aml-risk-assessment";
import { checkCommentary, commentaryFacts, commentaryMessage, commentaryRules, commentarySources, commentarySystem } from "../shared/aml-commentary";

// Vodafone Limited as BGP's checks read it on 24 November 2026: owned through
// one company at each level by Vodafone Group Plc, an Ofcom fine set aside.
const vodafone = {
  name: "VODAFONE LIMITED", number: "01471587", status: "Active", type: "Private limited company", incorporatedOn: "1980-01-07",
  registeredOffice: "Vodafone House, The Connection, Newbury", business: ["33200", "61900"],
  listing: "Owned through one company at each level by Vodafone Group Plc, which is listed on a UK regulated market",
  listingNote: "No individual owners to identify: the owner is the listed company. Standard due diligence (policy 4.2); the officers confirm the chain.",
  listedViaParent: true,
  directors: ["DOE, Jane"], owners: [{ name: "Vodafonethree Holdings Limited", control: "more than 75% of the shares" }], ownerNote: null,
  chain: ["Vodafonethree Holdings Limited (14903490)", "Vodafone International Operations Limited (02797438)", "Vodafone Group Plc (01833679)"],
  accounts: "Made up to 2026-03-31, full", warnings: [], documents: [], registerUrl: "https://find-and-update.company-information.service.gov.uk/company/01471587",
  ownersAbroad: [], identity: [], trading: { trading: true, words: null }, ownerDetails: [],
};

const input = (over: Partial<RiskAssessmentInput["party"]> = {}, extra: Partial<RiskAssessmentInput> = {}): RiskAssessmentInput => ({
  deal: { name: "Vodafone", ref: "4664", type: "Lease Renewal", property: "The Arndale Shopping Centre, LA4 5DH", agents: ["Peter Wood"], regimeWhy: "A letting at £25,000 a month: full checks on every party." },
  party: {
    roleLabel: "Tenant", name: "VODAFONE LIMITED", brandName: "Vodafone", client: false, individual: false,
    person: null, company: vodafone as any, precheckRan: true, webRan: true,
    flags: [], aside: [], level: { level: "standard", why: [], toWeigh: [], recheckYears: 3 } as any,
    people: { basis: "listed", directors: [], loose: [], outstanding: [], people: [] } as any,
    requests: [], state: null, notRequired: null, documents: [], kyc4u: null,
    ...over,
  },
  dealFlags: [], agents: [], solicitors: [],
  ...extra,
});

test("a company owned through a listed one is not called listed, and simplified due diligence is not offered for it (#4664)", () => {
  const ra = buildRiskAssessment(input());
  const chart = ra.diligence.find(r => r.label === "Structure chart")!;
  assert.match(chart.value, /^Not required: owned through one company at each level by a listed company \(VODAFONE LIMITED > Vodafonethree Holdings Limited/);
  assert.doesNotMatch(chart.value, /listed on a regulated market \(MLR 2017 reg 28\(5\)\)/);
  assert.match(ra.ownersNote || "", /^Owned through a listed company: no individual owners to identify/);
  assert.ok(!ra.mitigating.some(m => /simplified due diligence/i.test(m)), "no simplified due diligence for a subsidiary");
  // A company listed itself keeps the regulation's words.
  const listed = buildRiskAssessment(input({ company: { ...vodafone, listedViaParent: false, listing: "Listed on a UK regulated market", chain: [] } as any }));
  assert.match(listed.diligence.find(r => r.label === "Structure chart")!.value, /listed on a regulated market \(MLR 2017 reg 28\(5\)\)/);
  assert.ok(listed.mitigating.some(m => /simplified due diligence may apply/.test(m)));
});

test("the record does not say the checks are in when no one has been asked anything (#4664)", () => {
  assert.match(buildRiskAssessment(input()).conclusion[0], /^Not concluded: no one is named yet who acts for the company with BGP/);
  assert.match(buildRiskAssessment(input({ person: { name: "Stuart Wright" } })).conclusion[0], /^No higher-risk factors identified so far\. The client checks have not been sent yet\./);
  assert.match(buildRiskAssessment(input({ person: { name: "Stuart Wright" }, requests: [{ docs: [{ key: "authority", title: "Authority", done: true }] }] })).conclusion[0], /checks asked for are in/);
  // A letting under £10,000 a month asks no one for anything.
  assert.match(buildRiskAssessment(input({}, { sanctionsOnly: true })).conclusion[0], /sanctions checks only/);
});

test("the facts are every line of the record, numbered, and the rules are BGP's rules in short", () => {
  const facts = commentaryFacts(buildRiskAssessment(input()));
  assert.equal(facts[0].id, "F1");
  assert.ok(facts.every((f, i) => f.id === `F${i + 1}` && f.text.length > 0));
  assert.ok(facts.some(f => /^Transaction: Vodafone \(Ref 4664\)/.test(f.text)));
  assert.ok(facts.some(f => /^Structure: VODAFONE LIMITED \(01471587\)/.test(f.text)));
  const rules = commentaryRules();
  assert.ok(rules.length > 10 && rules.every((r, i) => r.id === `R${i + 1}`));
  const message = commentaryMessage("Tenant: VODAFONE LIMITED (Vodafone)", facts, rules);
  assert.match(message, /^The party: Tenant: VODAFONE LIMITED \(Vodafone\)/);
  assert.match(message, /\nF1\. Transaction: Vodafone/);
  assert.match(message, /\nR1\. /);
  // The instructions keep it to the facts and leave the decision to a person.
  const system = commentarySystem();
  assert.match(system, /Use only these\. Never add a name, figure, date, finding or rule that is not in them/);
  assert.match(system, /You decide nothing\. Never say a party is approved, cleared or signed off unless a fact says so/);
  assert.match(system, /Say transaction, not deal\./);
});

test("the answer is checked: only the facts and rules given, a paragraph citing no fact is dropped, the sections in order", () => {
  const facts = [{ id: "F1", text: "a" }, { id: "F2", text: "b" }, { id: "F3", text: "c" }];
  const rules = [{ id: "R1", text: "rule" }];
  const c = checkCommentary({
    headline: "  Standard checks, waiting on the person acting.  ",
    profile: "standard",
    paragraphs: [
      { section: "next", text: "Name who acts for Vodafone.", facts: ["F2"], rules: ["R1", "R9"] },
      { section: "found", text: "The register was read.", facts: ["F1", "F9", "f3"], rules: [] },
      { section: "found", text: "A second found paragraph.", facts: ["F1"], rules: [] },
      { section: "profile", text: "Rests on nothing.", facts: ["F7"], rules: ["R1"] },
      { section: "made-up", text: "Not a section.", facts: ["F1"], rules: [] },
    ],
    queries: [{ text: "The rent looks high for the town.", facts: ["F3"] }, { text: "No facts.", facts: [] }],
  }, facts, rules)!;
  assert.equal(c.headline, "Standard checks, waiting on the person acting.");
  assert.deepEqual(c.paragraphs.map(p => p.section), ["found", "next"]);
  assert.deepEqual(c.paragraphs[0].facts, ["F1", "F3"]);
  assert.deepEqual(c.paragraphs[1].rules, ["R1"]);
  assert.deepEqual(c.queries, [{ text: "The rent looks high for the town.", facts: ["F3"] }]);
  assert.deepEqual(commentarySources(c, facts, rules).map(s => s.id), ["F1", "F2", "F3", "R1"]);
  // An unknown profile reads as unclear; no headline or no paragraph is no view.
  assert.equal(checkCommentary({ headline: "x", profile: "fine", paragraphs: [{ section: "found", text: "y", facts: ["F1"], rules: [] }], queries: [] }, facts, rules)!.profile, "unclear");
  assert.equal(checkCommentary({ headline: "", profile: "lower", paragraphs: [{ section: "found", text: "y", facts: ["F1"], rules: [] }], queries: [] }, facts, rules), null);
  assert.equal(checkCommentary({ headline: "x", profile: "lower", paragraphs: [], queries: [] }, facts, rules), null);
  assert.equal(checkCommentary("not an object", facts, rules), null);
});
