import { test } from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import {
  isKyc4uRiskReportName, kyc4uPackPlace, kyc4uReferenceIn, kyc4uResultPrefill, kyc4uRiskLevel, readKyc4uAssessment, readKyc4uRiskReport, unwrapPackPaths, withKyc4uRiskTable,
} from "../shared/kyc4u-result-pack";
import { readKyc4uPack, unpackKyc4uFiles } from "./kyc4u-result-pack";

// The text of KYC4U's AML Risk Assessment Report as pdf-parse gives it (cells
// separated by tabs, long labels wrapped onto the next line, a footer on each
// page). Made-up company, people and addresses.
const TAB_TEXT = [
  "Disclaimer",
  "This AML risk assessment is for the sole use of KYC4U Ltd's (KYC4U) client and no responsibility is",
  "accepted to any party who is not a client of KYC4U.",
  "Job Details",
  "Job ID \tREQ100001",
  "Account Name \tEXAMPLE TOYS",
  "Property Address \tUNIT 9, EXAMPLE PLACE, LONDON",
  "Job Type \tCounter Party",
  "Agent Name \tBruce Gillingham Pollard",
  "Work Type \tLease Disposal",
  "Level of Risk \tLow",
  "Risk Details",
  "Risk Factor \tRisk Value \tDetails of Risk",
  "Client Risk Indicators Low",
  "Geographic Risk",
  "Indicators",
  "Low",
  "Other Risk Indicators Low",
  "PEP Involved Risk",
  "Indicators",
  "Low \tNo PEP Involved",
  "Standard/Enhanced Due Diligence",
  "Structure Chart \tNot required - simple structure",
  "Authority To Instruct",
  "© 2024 KYC4U. All rights reserved.",
  "Anti Money Laundering Risk Assessment Report",
  "",
  "-- 1 of 4 --",
  "",
  "Standard/Enhanced Due Diligence",
  "Adverse Media From Web",
  "Search",
  "No adverse media found",
  "Financial Statements \tStatements included in Creditsafe report",
  "Is This A Joint Agency? \tNo",
  "Are Documents Certified? \tNo",
  "Client Background",
  "Source Of Funds For",
  "Acquisitions",
  "NA as the client is Tenant.",
  "Is A Trading Company? \tYes",
  "Non Trading Risk Indicator Low",
  "Non Trading Risk",
  "Description",
  "Details of Client Structure, Ownership And Evidence",
  "Name \tLocation \tCountry Risk \tOrg Type",
  "Example Toys Limited \tUK \tStandard \tLimited company",
  "Details of Evidence",
  "- Incorporation Date: 01/02/1990",
  "- As per the credit safe report, the ultimate parent company is Example Holding AS.",
  "Example Holding A/S \tDenmark \tStandard \tLimited company",
  "Details of Evidence",
  "- As per the Central Business Register, Jane Example holds the highest share of votes",
  "(33.34% to 49.99%). Other shareholders hold less.",
  "- No compliance alert identified.",
  "© 2024 KYC4U. All rights reserved.",
  "Anti Money Laundering Risk Assessment Report",
  "-- 2 of 4 --",
  "Details of Ultimate Beneficial Owners (UBO's)",
  "Name \tNationality Residence ID verification Method UBO Risk PEPs",
  "Jane Example \tDenmark \tDenmark \tPublic figure \tLow \tNo",
  "Details of Evidence",
  "- Copies of publicly available sources attached are sufficient to establish public-figure status.",
  "Details of Certified Documents",
  "Name \tQualification \tOrganization",
  "Detailed Risk Assessment",
  "RISK IDENTIFIED",
  "No risk identified.",
  "MITIGATING FACTORS",
  "Not required, as no risk has been identified.",
  "OVERALL CONCLUSION",
  "The client and the activity is deemed to be lower risk as we have not identified any higher risk factors.",
  "Counterparty Details",
  "Name of Counterparty Agent No information available",
  "Is the agent registered with",
  "HMRC?",
  "No information available",
  "Does the agent have a",
  "compliance team?",
  "No information available",
  "© 2024 KYC4U. All rights reserved.",
  "Anti Money Laundering Risk Assessment Report",
  "-- 3 of 4 --",
  "Counterparty Details",
  "Is there any negative media",
  "around the agency?",
  "No information available",
  "Name of counterparty",
  "solicitors",
  "Example Law LLP",
  "What is the size and",
  "reputation of the solicitors?",
  "Mid-size firm, well regarded",
  "Is there any negative media",
  "around the solicitors?",
  "No negative media found",
  "Recommendation",
  "Team \tApprover \tDate",
  "KYC4U Internal Approval \treviewer@kyc4u.example \t29/07/2026",
  "Fee Earner/Job Director",
  "Approval",
  "agent@bgp.example \t30/07/2026",
  "Nominated Officer",
  "Approval for higher Risk",
  "Clients",
  "© 2024 KYC4U. All rights reserved.",
  "-- 4 of 4 --",
].join("\n");

// The same report as a layout text reader gives it: cells padded with spaces
// and long labels wrapped round their values.
const LAYOUT_TEXT = [
  "  Anti Money Laundering Risk Assessment Report",
  "                                                Job Details",
  "Job ID                         REQ100002",
  "Account Name                   EXAMPLE TOYS",
  "Level of Risk                  High",
  "                                               Risk Details",
  "         Risk Factor        Risk Value                                     Details of Risk",
  "  Client Risk Indicators   High           Complex structure",
  "  Geographic Risk          Low",
  "  Indicators",
  "  Other Risk Indicators    Low",
  "  PEP Involved Risk        Low            No PEP Involved",
  "  Indicators",
  "                                  Standard/Enhanced Due Diligence",
  "Adverse Media From Web          No adverse media found",
  "Search",
  "Source Of Funds For             NA as the client is Tenant.",
  "Acquisitions",
  "                                             Recommendation",
  "             Team                                          Approver               Date",
  " KYC4U Internal Approval        reviewer@kyc4u.example                       01/08/2026",
  " Nominated Officer",
  " Approval for higher Risk Clients",
  "© 2024 KYC4U. All rights reserved.",
].join("\n");

test("KYC4U's risk report is read from pdf-parse's text", () => {
  const r = readKyc4uRiskReport(TAB_TEXT)!;
  assert.ok(r);
  assert.equal(r.jobId, "REQ100001");
  assert.equal(r.accountName, "EXAMPLE TOYS");
  assert.equal(r.propertyAddress, "UNIT 9, EXAMPLE PLACE, LONDON");
  assert.equal(r.jobType, "Counter Party");
  assert.equal(r.workType, "Lease Disposal");
  assert.equal(r.levelOfRisk, "Low");
  assert.deepEqual(r.risks.map(x => [x.factor, x.value, x.details]), [
    ["client", "Low", null], ["geographic", "Low", null], ["other", "Low", null], ["pep", "Low", "No PEP Involved"],
  ]);
  const dil = Object.fromEntries(r.diligence.map(d => [d.label, d.value]));
  assert.equal(dil["Structure Chart"], "Not required - simple structure");
  assert.equal(dil["Authority To Instruct"], null);
  assert.equal(dil["Adverse Media From Web Search"], "No adverse media found");
  assert.equal(dil["Source Of Funds For Acquisitions"], "NA as the client is Tenant.");
  assert.equal(dil["Is A Trading Company?"], "Yes");
  assert.equal(dil["Non Trading Risk Indicator"], "Low");
  assert.equal(r.entities.length, 2);
  assert.deepEqual([r.entities[1].name, r.entities[1].location, r.entities[1].countryRisk], ["Example Holding A/S", "Denmark", "Standard"]);
  assert.match(r.entities[1].evidence[0], /highest share of votes \(33\.34% to 49\.99%\)\. Other shareholders hold less\.$/, "a wrapped evidence line joins its bullet");
  assert.equal(r.owners.length, 1);
  assert.deepEqual([r.owners[0].name, r.owners[0].idMethod, r.owners[0].risk, r.owners[0].pep], ["Jane Example", "Public figure", "Low", "No"]);
  assert.equal(r.certified.length, 0);
  assert.equal(r.riskIdentified, "No risk identified.");
  assert.match(r.conclusion || "", /deemed to be lower risk/);
  const counter = Object.fromEntries(r.counterparty.map(c => [c.label, c.value]));
  assert.equal(counter["Name of counterparty solicitors"], "Example Law LLP");
  assert.equal(counter["What is the size and reputation of the solicitors?"], "Mid-size firm, well regarded");
  assert.equal(counter["Is there any negative media around the solicitors?"], "No negative media found");
  assert.deepEqual(r.approvals.map(a => [a.team, a.approver, a.date]), [
    ["kyc4u", "reviewer@kyc4u.example", "2026-07-29"],
    ["fee_earner", "agent@bgp.example", "2026-07-30"],
    ["nominated_officer", null, null],
  ]);
});

test("KYC4U's risk report is read when its labels wrap round their values", () => {
  const r = readKyc4uRiskReport(LAYOUT_TEXT)!;
  assert.equal(r.jobId, "REQ100002");
  assert.equal(r.levelOfRisk, "High");
  assert.deepEqual(r.risks.map(x => [x.value, x.details]), [["High", "Complex structure"], ["Low", null], ["Low", null], ["Low", "No PEP Involved"]]);
  const dil = Object.fromEntries(r.diligence.map(d => [d.label, d.value]));
  assert.equal(dil["Adverse Media From Web Search"], "No adverse media found");
  assert.equal(dil["Source Of Funds For Acquisitions"], "NA as the client is Tenant.");
  assert.equal(r.approvals[0].date, "2026-08-01");
});

test("anything that is not KYC4U's report reads as none", () => {
  assert.equal(readKyc4uRiskReport("Heads of terms\nLandlord: Example Ltd"), null);
  assert.equal(readKyc4uRiskReport(""), null);
});

test("the report fills the result: approved only when KYC4U's own approval is dated", () => {
  const p = kyc4uResultPrefill(readKyc4uRiskReport(TAB_TEXT));
  assert.equal(p.verdict, "approved");
  assert.equal(p.date, "2026-07-29");
  assert.equal(p.reference, "REQ100001");
  assert.match(p.note, /^KYC4U's risk assessment REQ100001: Low risk\. The client and the activity/);
  assert.equal(p.highRisk, false);
  const high = kyc4uResultPrefill(readKyc4uRiskReport(LAYOUT_TEXT));
  assert.equal(high.highRisk, true);
  const undated = kyc4uResultPrefill(readKyc4uRiskReport(TAB_TEXT.replace("\t29/07/2026", "")));
  assert.equal(undated.verdict, null, "no date on KYC4U's approval: the officer chooses");
  assert.equal(undated.date, "2026-07-30", "the latest dated approval");
  assert.ok(undated.lines.some(l => /not dated/.test(l)));
  assert.deepEqual(kyc4uResultPrefill(null, "REQ5"), { verdict: null, date: null, reference: "REQ5", note: "", highRisk: false, lines: [] });
});

test("KYC4U's level of risk reads as low, medium or high", () => {
  assert.equal(kyc4uRiskLevel("Low"), "low");
  assert.equal(kyc4uRiskLevel("Medium"), "medium");
  assert.equal(kyc4uRiskLevel("High"), "high");
  assert.equal(kyc4uRiskLevel("Very High"), "high");
  assert.equal(kyc4uRiskLevel(""), null);
  assert.equal(kyc4uRiskLevel("Unclear"), null);
});

test("each file in KYC4U's pack is filed under its folder", () => {
  const place = (p: string) => { const x = kyc4uPackPlace(p); return [x.heading, x.kind, x.docType]; };
  assert.deepEqual(place("AMLRiskAssessmentReport-REQ100001.pdf"), ["KYC4U's risk assessment", "report", "kyc4u_report"]);
  assert.deepEqual(place("KYC4U approval.msg"), ["KYC4U's pack", "other", "kyc4u_report"]);
  assert.deepEqual(place("1.0 HOTs/HoTs Example 20.07.2026.docx"), ["Heads of terms", "hots", "heads_of_terms"]);
  assert.deepEqual(place("2.0 Example Toys Limited/Example Toys Limited - Credit Safe Report.pdf"), ["Example Toys Limited", "company", "credit_report"]);
  assert.deepEqual(place("2.0 Example Toys Limited/Example Toys Limited - Compliance alert.pdf"), ["Example Toys Limited", "company", "screening_report"]);
  assert.deepEqual(place("3.0 Holding Cos/1.0 Example Holding AS/Example Holding AS - Central Business Register.pdf"), ["Holding companies · Example Holding AS", "holding", "register_extract"]);
  assert.deepEqual(place("3.0 Holding Cos/1.0 Example Holding AS/Example Fonden.pdf"), ["Holding companies · Example Holding AS", "holding", "other"]);
  assert.deepEqual(place("4.0 UBOs/1.0 Jane Example/Jane Example - Wikipedia.pdf"), ["Owners · Jane Example", "owner", "public_source"]);
  assert.deepEqual(place("4.0 UBOs/1.0 Jane Example/Jane Example - Passport.jpg"), ["Owners · Jane Example", "owner", "passport"]);
  assert.deepEqual(place("4.0 UBOs/1.0 Jane Example/Jane Example - Compliance alert.pdf"), ["Owners · Jane Example", "owner", "screening_report"]);
});

test("a zip wrapped in one folder is unwrapped; KYC4U's numbered folders are not", () => {
  assert.deepEqual(unwrapPackPaths(["Example/1.0 HOTs/a.docx", "Example/Report.pdf"]), ["1.0 HOTs/a.docx", "Report.pdf"]);
  assert.deepEqual(unwrapPackPaths(["1.0 HOTs/a.docx", "Report.pdf"]), ["1.0 HOTs/a.docx", "Report.pdf"]);
  assert.deepEqual(unwrapPackPaths(["2.0 Co/a.pdf", "2.0 Co/b.pdf"]), ["2.0 Co/a.pdf", "2.0 Co/b.pdf"]);
});

test("a pack downloaded from KYC4U's site is wrapped twice, and both wrappers come off (21 November 2026)", () => {
  assert.deepEqual(unwrapPackPaths([
    "REQ100002  Example Trading Limited/REQ100002/AMLRiskAssessmentReport-REQ100002.pdf",
    "REQ100002  Example Trading Limited/REQ100002/1.0 HOTs/HOTs Example.docx",
    "REQ100002  Example Trading Limited/REQ100002/3.0 UBOs/Jane Example - Compliance Report.pdf",
  ]), ["AMLRiskAssessmentReport-REQ100002.pdf", "1.0 HOTs/HOTs Example.docx", "3.0 UBOs/Jane Example - Compliance Report.pdf"]);
  // Files all in one older-style folder come out loose.
  assert.deepEqual(unwrapPackPaths(["REQ100003  Example Ltd/REQ100003/a.pdf", "REQ100003  Example Ltd/REQ100003/b.xlsx"]), ["a.pdf", "b.xlsx"]);
});

test("KYC4U's electronic checks, advisers, agent's confirmations and filings each have their own type", () => {
  const place = (p: string) => { const x = kyc4uPackPlace(p); return [x.heading, x.kind, x.docType]; };
  const ubo = "2.0 UBOs/1.0 Jane Example";
  assert.deepEqual(place(`${ubo}/AML check/Document Check.pdf`), ["Owners · Jane Example", "owner", "id_check_report"]);
  assert.deepEqual(place(`${ubo}/AML check/Multi-Bureau Check.pdf`), ["Owners · Jane Example", "owner", "electronic_id_check"]);
  assert.deepEqual(place(`${ubo}/AML check/Proof of Address Check.pdf`), ["Owners · Jane Example", "owner", "proof_of_address"]);
  assert.deepEqual(place(`${ubo}/AML check/Extensive Screening.pdf`), ["Owners · Jane Example", "owner", "screening_report"]);
  assert.deepEqual(place(`${ubo}/Jane Example - Client AML Report.pdf`), ["Owners · Jane Example", "owner", "screening_report"]);
  assert.deepEqual(place(`${ubo}/Jane Example - bank statement.pdf`), ["Owners · Jane Example", "owner", "proof_of_address"]);
  assert.deepEqual(place("3.0 Holding Cos/Example Holdings Limited/Example Holdings Limited - annual accounts.pdf"), ["Holding companies · Example Holdings Limited", "holding", "company_accounts"]);
  assert.deepEqual(place("3.0 Holding Cos/Example Holdings Limited/Example Holdings Limited - confirmation statement.pdf"), ["Holding companies · Example Holdings Limited", "holding", "confirmation_statement"]);
  assert.deepEqual(place("2.0 KYC Entity/Example Ltd - Agent's Confirmation on Request Type and Entity Name.pdf"), ["KYC Entity", "company", "agent_confirmation"]);
  assert.deepEqual(place("2.0 KYC Entity/Example Limited - Agent on Company Background.pdf"), ["KYC Entity", "company", "agent_confirmation"]);
  assert.deepEqual(place("2.0 KYC Entity/Jane EXAMPLE personal appointments - Find and update company information - GOV.UK.pdf"), ["KYC Entity", "company", "register_extract"]);
  assert.deepEqual(place("5.0 Advisors/Example Law LLP - The Law Society.pdf"), ["Advisers", "adviser", "adviser_check"]);
  assert.deepEqual(place("4.0 Advisors/Example LLP - SRA Regulation Proof.pdf"), ["Advisers", "adviser", "adviser_check"]);
  // KYC4U's older packs (2023) kept every document loose: each is filed by its name, never all as KYC4U's report.
  assert.deepEqual(place("Example Limited - Incorporation Certificate.pdf"), ["KYC4U's pack", "other", "company_cert"]);
  assert.deepEqual(place("Example Growth LLP - FCA Regulation.pdf"), ["KYC4U's pack", "other", "regulator_register"]);
  assert.deepEqual(place("Example Founders News Report.pdf"), ["KYC4U's pack", "other", "public_source"]);
  assert.deepEqual(place("Example Ltd - KYC verification form Standard 1 (1).xlsx"), ["KYC4U's pack", "other", "kyc4u_report"]);
  assert.deepEqual(place("Example HOT's 26.03.2023.doc"), ["KYC4U's pack", "other", "heads_of_terms"]);
  assert.deepEqual(place("Something else.pdf"), ["KYC4U's pack", "other", "other"]);
});

test("KYC4U's assessment is read in each of its three layouts, and a heading never inside a sentence", () => {
  // One under another (the first layout read, July 2026).
  assert.deepEqual(readKyc4uAssessment(["RISK IDENTIFIED", "No risk identified.", "MITIGATING FACTORS", "Not required, as no risk has been identified.", "OVERALL CONCLUSION", "The client is deemed to be lower risk."]),
    { riskIdentified: "No risk identified.", mitigatingFactors: "Not required, as no risk has been identified.", conclusion: "The client is deemed to be lower risk.", table: false });
  // A two-column table: plain text runs the columns together, so they are kept as one until the server splits them,
  // and "the mitigating factors" inside the conclusion is not taken for a heading.
  const table = readKyc4uAssessment(["Risk Identified \tMitigation", "The client is a restaurant, a cash", "intensive business.", "We have mitigated the risk factor as", "there is no alert. \\nIn addition, the owner is well known.",
    "Overall Conclusion", "Since no other high-risk factor has been identified. Considering the mitigating factors, the client is assessed as low risk."]);
  assert.equal(table.table, true);
  assert.equal(table.mitigatingFactors, null);
  assert.equal(table.conclusion, "Since no other high-risk factor has been identified. Considering the mitigating factors, the client is assessed as low risk.");
  assert.match(table.riskIdentified!, /^Risk and mitigation, as KYC4U's table gives them: The client is a restaurant/);
  assert.doesNotMatch(table.riskIdentified!, /\\n/, "KYC4U's written \\n is taken out");
  // A sanctions-only check: one paragraph and no headings is the conclusion.
  assert.deepEqual(readKyc4uAssessment(["No sanctions alerts were identified for the entity or its connected parties."]),
    { riskIdentified: null, mitigatingFactors: null, conclusion: "No sanctions alerts were identified for the entity or its connected parties.", table: false });
  assert.deepEqual(readKyc4uAssessment(undefined), { riskIdentified: null, mitigatingFactors: null, conclusion: null, table: false });

  // The server's columns, read by position, go in their own fields.
  const report: any = { assessmentTable: true, riskIdentified: "Risk and mitigation, as KYC4U's table gives them: x", mitigatingFactors: null, conclusion: "c" };
  const split = withKyc4uRiskTable(report, { risk: "The client is a restaurant.", mitigation: "We have mitigated it. \\nNo alert." });
  assert.equal(split.riskIdentified, "The client is a restaurant.");
  assert.equal(split.mitigatingFactors, "We have mitigated it. No alert.");
  assert.equal(withKyc4uRiskTable(report, null), report, "no columns: the reading stands, said as one");
  assert.equal(withKyc4uRiskTable({ ...report, assessmentTable: false }, { risk: "a", mitigation: "b" }).riskIdentified, report.riskIdentified);
});

test("the report's name and reference are recognised", () => {
  assert.ok(isKyc4uRiskReportName("AMLRiskAssessmentReport-REQ112444.pdf"));
  assert.ok(isKyc4uRiskReportName("AML Risk Assessment Report.pdf"));
  assert.ok(!isKyc4uRiskReportName("Credit Safe Report.pdf"));
  assert.equal(kyc4uReferenceIn("AMLRiskAssessmentReport-REQ112444.pdf"), "REQ112444");
  assert.equal(kyc4uReferenceIn("no reference"), null);
});

test("a zip is opened: junk, programs and zips inside are not filed", async () => {
  const zip = new AdmZip();
  zip.addFile("Example/AMLRiskAssessmentReport-REQ100001.pdf", Buffer.from("%PDF-1.4 not really"));
  zip.addFile("Example/1.0 HOTs/HoTs.docx", Buffer.from("docx"));
  zip.addFile("Example/4.0 UBOs/1.0 Jane Example/Jane Example - Wikipedia.pdf", Buffer.from("pdf"));
  zip.addFile("Example/__MACOSX/._HoTs.docx", Buffer.from("junk"));
  zip.addFile("Example/.DS_Store", Buffer.from("junk"));
  zip.addFile("Example/run.exe", Buffer.from("MZ"));
  zip.addFile("Example/inner.zip", new AdmZip().toBuffer());
  const out = await unpackKyc4uFiles([
    { originalname: "pack.zip", buffer: zip.toBuffer() },
    { originalname: "KYC4U email.msg", buffer: Buffer.from("email") },
    { originalname: "notes.html", buffer: Buffer.from("<p>") },
  ]);
  assert.deepEqual(out.entries.map(e => [e.path, e.place.heading]).sort(), [
    ["1.0 HOTs/HoTs.docx", "Heads of terms"],
    ["4.0 UBOs/1.0 Jane Example/Jane Example - Wikipedia.pdf", "Owners · Jane Example"],
    ["AMLRiskAssessmentReport-REQ100001.pdf", "KYC4U's risk assessment"],
    ["KYC4U email.msg", "KYC4U's pack"],
  ]);
  assert.deepEqual(out.skipped.map(s => s.path).sort(), ["inner.zip", "notes.html", "run.exe"]);
  assert.ok(out.skipped.find(s => s.path === "inner.zip")!.reason.includes("zip inside the zip"));
});

test("a file over 25MB is not filed, and a broken zip says so", async () => {
  const big = Buffer.alloc(26 * 1024 * 1024);
  const out = await unpackKyc4uFiles([
    { originalname: "huge.pdf", buffer: big },
    { originalname: "broken.zip", buffer: Buffer.from("not a zip at all") },
  ]);
  assert.equal(out.entries.length, 0);
  assert.deepEqual(out.skipped.map(s => s.reason), ["over 25MB", "the zip could not be opened"]);
});

test("the report inside a pack is read from its PDF", async () => {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>(r => doc.on("end", () => r()));
  for (const line of ["Anti Money Laundering Risk Assessment Report", "Job Details", "Job ID REQ100003", "Level of Risk Medium",
    "Recommendation", "KYC4U Internal Approval reviewer@kyc4u.example 02/08/2026", "© 2024 KYC4U. All rights reserved."]) doc.text(line);
  doc.end();
  await done;
  const { entries } = await unpackKyc4uFiles([{ originalname: "Report.pdf", buffer: Buffer.concat(chunks) }]);
  const read = await readKyc4uPack(entries);
  assert.equal(read.report?.jobId, "REQ100003");
  assert.equal(read.report?.levelOfRisk, "Medium");
  assert.equal(read.report?.approvals[0].date, "2026-08-02");
  assert.equal(entries[0].place.docType, "kyc4u_report", "a PDF found to be the report is filed as it");
});
