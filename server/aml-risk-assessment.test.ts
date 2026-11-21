import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRiskAssessment, riskHeadingOf, type RiskAssessmentInput } from "../shared/aml-risk-assessment";
import { checkMediaAnswer, checkRegisterAnswer, solicitorCheckWords, solicitorFirmName, type SolicitorCheck } from "../shared/solicitor-aml";
import type { KycRedFlag } from "../shared/kyc-red-flags";

const company = {
  name: "EXAMPLE TOYS LIMITED", number: "00412345", status: "Active", type: "Private limited company", incorporatedOn: "1941-07-19",
  registeredOffice: "1 Example Place, London", business: ["46499 Wholesale of household goods"], listing: null, listingNote: null,
  directors: ["DOE, Jane", "ROE, Richard"], owners: [], ownerNote: null, chain: [], accounts: "Made up to 2025-12-31, full", warnings: [],
  documents: [{ title: "EXAMPLE TOYS LIMITED accounts made up to 31 December 2025", onFile: true }],
  registerUrl: "https://find-and-update.company-information.service.gov.uk/company/00412345",
  ownersAbroad: [{ name: "EXAMPLE HOLDING A/S", country: "Denmark", foundAt: null }],
  identity: [], trading: { trading: true, words: null },
  ownerDetails: [{ name: "Mr Erik Example", nationality: "Danish", residence: "Denmark" }],
};

const input = (over: Partial<RiskAssessmentInput["party"]> = {}, extra: Partial<RiskAssessmentInput> = {}): RiskAssessmentInput => ({
  deal: { name: "Example Toys - Unit 3", ref: "4600", type: "Lease Disposal", property: "Unit 3, Example Place", agents: ["Charlotte Example"], regimeWhy: "Full checks: a letting of £10,000 a month or more" },
  party: {
    roleLabel: "Tenant", name: "EXAMPLE TOYS LIMITED", brandName: "Example Toys", client: false, individual: false,
    person: { name: "Jane Doe" }, company: company as any, precheckRan: true, webRan: true,
    flags: [], aside: [], level: { level: "standard", why: [], toWeigh: [], recheckYears: 3 },
    people: {
      basis: "owners_abroad", directors: [], loose: [], outstanding: [],
      people: [{
        key: "erik example", name: "Erik Example", roles: ["owner"], ownerDetail: "up the ownership chain", born: "May 1970",
        id: { state: "not_started", ref: null, elsewhere: null, someoneElse: null, asked: false },
        address: { done: false, ref: null, asked: false, proof: null }, sanctions: "clear",
        publicFigure: { id: "1", name: "Erik Example", note: "Owner named in the group's annual report and Forbes", by: "Jack Barratt", at: "2026-11-21T10:00:00Z", links: [], documents: 2 },
        own: null, outstanding: [], canSend: false,
      }],
    } as any,
    requests: [],
    state: null, notRequired: null, documents: [], kyc4u: null,
    ...over,
  },
  dealFlags: [],
  agents: [],
  solicitors: [],
  ...extra,
});

const flag = (over: Partial<KycRedFlag>): KycRedFlag => ({ kind: "web_adverse", label: "Possible adverse media for Jane Doe", detail: null, source: "web", at: null, key: "web:adverse_media:jane doe", evidence: [], ...over });

test("each flag sits under one of KYC4U's four risk headings", () => {
  assert.equal(riskHeadingOf(flag({ kind: "web_pep", label: "Possible public role for Jane Doe" })), "pep");
  assert.equal(riskHeadingOf(flag({ kind: "provider_screen", label: "ComplyAdvantage: possible PEP match for Jane Doe", key: "ca:jane doe" })), "pep");
  assert.equal(riskHeadingOf(flag({ kind: "provider_screen", label: "ComplyAdvantage: adverse media for Jane Doe", key: "ca:jane doe" })), "client");
  assert.equal(riskHeadingOf(flag({ kind: "offshore_owner" })), "geographic");
  assert.equal(riskHeadingOf(flag({ kind: "policy_country" })), "geographic");
  assert.equal(riskHeadingOf(flag({ kind: "super_prime" })), "other");
  assert.equal(riskHeadingOf(flag({ kind: "sanctions" })), "client");
});

test("a clean, standard party reads as KYC4U's report would, with the owner verified from public sources", () => {
  const ra = buildRiskAssessment(input());
  assert.equal(ra.levelOfRisk.value, "Standard");
  assert.ok(ra.job.some(r => r.label === "Job type" && /Counterparty/.test(r.value)));
  assert.deepEqual(ra.risks.map(r => [r.factor, r.value]), [["client", "Low"], ["geographic", "Low"], ["other", "Low"], ["pep", "Low"]]);
  assert.match(ra.risks.find(r => r.factor === "geographic")!.details.join(" "), /Owned through EXAMPLE HOLDING A\/S, registered in Denmark: KYC4U to identify the owners behind it/);
  const dil = Object.fromEntries(ra.diligence.map(r => [r.label, r.value]));
  assert.match(dil["Structure chart"], /^Needed: owned through EXAMPLE HOLDING A\/S \(Denmark\)/);
  assert.equal(dil["Authority to instruct"], "Jane Doe is a director at Companies House");
  assert.equal(dil["Adverse media (web search)"], "No adverse media found (copies of any sources are on the KYC record)");
  assert.match(dil["Financial statements"], /^Made up to 2025-12-31, full, downloaded from Companies House/);
  assert.equal(dil["Trading company"], "Yes: it files trading accounts");
  assert.deepEqual(ra.structure.map(e => [e.name, e.location]), [["EXAMPLE TOYS LIMITED (00412345)", "UK"], ["EXAMPLE HOLDING A/S", "Denmark"]]);
  assert.equal(ra.owners.length, 1);
  assert.equal(ra.owners[0].nationality, "Danish");
  assert.match(ra.owners[0].idMethod, /^Public figure: verified from public sources by Jack Barratt/);
  assert.match(ra.conclusion[0], /^Owned through a company registered abroad: it goes to KYC4U/);
  assert.ok(ra.counterparty.some(r => r.label === "Solicitors" && /Not checked yet/.test(r.value)));
  assert.ok(ra.mitigating.some(m => /Erik Example verified from public sources by Jack Barratt/.test(m)));
});

test("red flags make it higher risk, under their headings, and set aside ones are mitigating factors", () => {
  const ra = buildRiskAssessment(input({
    company: { ...company, ownersAbroad: [] } as any,
    flags: [flag({}), flag({ kind: "offshore_owner", label: "Owned through Shell Co (British Virgin Islands)", key: "offshore:shell co", factor: true })],
    aside: [{ flag: flag({ kind: "web_pep", label: "Possible public role for Richard Roe", key: "web:public_role:richard roe" }), review: { id: 1, by: "Jack Barratt", at: "2026-11-20T10:00:00Z", comment: "A namesake: different date of birth on the profile" } } as any],
    level: { level: "enhanced", why: ["a red flag"], toWeigh: [], recheckYears: 1 },
  }));
  assert.equal(ra.levelOfRisk.value, "Higher");
  assert.equal(ra.risks.find(r => r.factor === "client")!.value, "Higher");
  assert.equal(ra.risks.find(r => r.factor === "geographic")!.value, "Higher");
  assert.equal(ra.risks.find(r => r.factor === "pep")!.value, "Low", "a set aside flag does not count");
  assert.match(ra.conclusion[0], /^Higher risk: 2 red flags or higher-risk factors/);
  assert.ok(ra.mitigating.some(m => /Possible public role for Richard Roe: set aside by Jack Barratt/.test(m)));
  assert.ok(ra.approvals.some(r => r.label.startsWith("Nominated Officer") && /^Needed/.test(r.value)));
});

test("KYC4U's own reading and an approval show in the conclusion and the approvals", () => {
  const ra = buildRiskAssessment(input({
    company: { ...company, ownersAbroad: [] } as any,
    state: { status: "approved", approvedBy: "KYC4U", approvedAt: "2026-07-29T12:00:00Z", expiresAt: "2029-07-29T12:00:00Z" },
    kyc4u: { status: "Approved", at: "2026-07-29T12:00:00Z", recordedBy: "Jack Barratt", assessment: { jobId: "REQ100001", levelOfRisk: "Low", conclusion: "Lower risk.", approvals: [{ team: "kyc4u", label: "KYC4U Internal Approval", approver: "reviewer@kyc4u.example", date: "2026-07-29" }] } },
  }), { now: new Date("2026-11-21T12:00:00Z") });
  assert.match(ra.conclusion[0], /^Approved by KYC4U on 29 Jul 2026, valid until 29 Jul 2029\./);
  assert.equal(ra.conclusion[1], "KYC4U's conclusion (REQ100001): Lower risk.");
  assert.equal(ra.approvals[0].value, "reviewer@kyc4u.example, 29 Jul 2026");
  assert.ok(ra.mitigating.some(m => m === "KYC4U rated the party low risk (REQ100001)"));
});

test("a private individual: no company rows, the person verified", () => {
  const ra = buildRiskAssessment(input({ individual: true, company: null, people: { basis: "individual", directors: [], loose: [], outstanding: ["Sam Example: identity check and proof of address"], people: [{
    key: "example sam", name: "Sam Example", roles: ["acting"], ownerDetail: null, born: null,
    id: { state: "passed", ref: "ABC123", elsewhere: null, someoneElse: null, asked: false },
    address: { done: false, ref: null, asked: true, proof: null }, sanctions: "clear", publicFigure: null, own: null, outstanding: ["proof of address"], canSend: false,
  }] } as any }));
  assert.equal(ra.structure.length, 0);
  assert.equal(ra.owners[0].idMethod, "Online identity check (Veriff)");
  assert.equal(ra.diligence.find(r => r.label === "Structure chart")!.value, "Not applicable: a private individual");
  assert.match(ra.conclusion[0], /^Not concluded: still to come: Sam Example: identity check and proof of address/);
});

test("the solicitors: register pages only from the SRA's or the Law Society's site, media only from pages read", () => {
  assert.equal(solicitorFirmName("  Example Law LLP "), "Example Law LLP");
  assert.equal(solicitorFirmName("ab"), null);
  const reg = checkRegisterAnswer({ found: "yes", firmName: "Example Law LLP", sraNumber: "SRA 612345", authorisation: "Authorised", office: "London", url: "https://www.sra.org.uk/consumers/register/organisation/?sraNumber=612345" },
    [{ url: "https://www.sra.org.uk/consumers/register/organisation/?sraNumber=612345" }]);
  assert.deepEqual([reg.status, reg.sraNumber, reg.authorisation], ["found", "612345", "Authorised"]);
  // A "found" whose page is not on a register site, or not among the pages read, is not believed.
  assert.equal(checkRegisterAnswer({ found: "yes", url: "https://example-law.co.uk/about" }, [{ url: "https://example-law.co.uk/about" }]).status, "unsure");
  assert.equal(checkRegisterAnswer({ found: "yes", url: "https://www.sra.org.uk/x" }, []).status, "unsure");
  assert.equal(checkRegisterAnswer({ found: "no" }, []).status, "not_found");
  const media = checkMediaAnswer({ adverseMedia: { status: "found", findings: [
    { summary: "SRA intervened in the firm", url: "https://www.sra.org.uk/news/x", source: "SRA" },
    { summary: "Unsourced claim", url: "https://made-up.example/y" },
  ] } }, [{ url: "https://www.sra.org.uk/news/x" }]);
  assert.equal(media.findings.length, 1);
  assert.equal(media.unsourced, 1);
  const check: SolicitorCheck = { firm: "Example Law LLP", ranAt: "2026-11-21T12:00:00Z", register: reg, media: { ran: true, ...media }, errors: [] };
  const w = solicitorCheckWords(check);
  assert.equal(w.tone, "attention");
  assert.match(w.words, /^Example Law LLP: on the SRA register \(SRA 612345, authorised\) · 1 report of regulatory action or misconduct to read$/);
  const clean = solicitorCheckWords({ ...check, media: { ran: true, status: "none_found", findings: [], unsourced: 0 } });
  assert.deepEqual(clean, { tone: "ok", words: "Example Law LLP: on the SRA register (SRA 612345, authorised) · no negative media found" });
  assert.equal(solicitorCheckWords({ ...check, register: { ...reg, authorisation: "Closed" }, media: { ran: true, status: "none_found", findings: [], unsourced: 0 } }).tone, "attention");
  assert.equal(solicitorCheckWords({ ...check, register: { ...reg, status: "not_found", firmName: null } }).tone, "attention");
});
