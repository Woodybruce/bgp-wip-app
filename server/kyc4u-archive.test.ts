// Every file on KYC4U's site, kept in the app (Woody, 21 November 2026). The
// shared rules: where a file sits, its key, and which listings are refused.
import test from "node:test";
import assert from "node:assert/strict";
import { archiveFileFacts, archiveKey, archiveSummaryWords, listedFileProblem } from "../shared/kyc4u-archive";

const SITE = "/sites/customers/CST1092";

test("a file in a request folder is that request's, filed under KYC4U's own headings", () => {
  const hots = archiveFileFacts(`${SITE}/Shared Documents/REQ112444 LEGO Company Limited/1.0 HOTs/HoTs Lego 20.07.2026.docx`);
  assert.equal(hots.reqRef, "REQ112444");
  assert.equal(hots.entity, "LEGO Company Limited");
  assert.equal(hots.relPath, "1.0 HOTs/HoTs Lego 20.07.2026.docx");
  assert.equal(hots.place.heading, "Heads of terms");
  assert.equal(hots.place.docType, "heads_of_terms");
  const owner = archiveFileFacts(`${SITE}/Shared Documents/REQ112444 LEGO Company Limited/4.0 UBOs/1.0 Thomas Kirk Kristiansen/Thomas Kirk Kristiansen - Article 1.pdf`);
  assert.equal(owner.place.heading, "Owners · Thomas Kirk Kristiansen");
  const report = archiveFileFacts(`${SITE}/Shared Documents/REQ112444 LEGO Company Limited/AMLRiskAssessmentReport-REQ112444.pdf`);
  assert.equal(report.place.docType, "kyc4u_report");
  // A request folder one folder down, and a folder named just the REQ number inside it.
  const nested = archiveFileFacts(`${SITE}/Shared Documents/2026/REQ113355  Iris Ave Ltd/REQ113355/2.0 KYC Entity/cert.pdf`);
  assert.equal(nested.reqRef, "REQ113355");
  assert.equal(nested.entity, "Iris Ave Ltd");
  assert.equal(nested.relPath, "2.0 KYC Entity/cert.pdf");
});

test("a file outside a request folder is kept, with no request", () => {
  const loose = archiveFileFacts(`${SITE}/Shared Documents/Templates/BGP onboarding form.docx`);
  assert.equal(loose.reqRef, null);
  assert.equal(loose.place.heading, "Not in a request folder");
  // A file whose own name starts REQ is not a request folder.
  assert.equal(archiveFileFacts(`${SITE}/Shared Documents/REQ114000 notes.pdf`).reqRef, null);
});

test("one key per file version: its SharePoint id when given, else its place, with the time it changed", () => {
  const a = archiveKey({ uniqueId: "{A1B2C3D4-0000-1111-2222-333344445555}", path: "/x/a.pdf", modified: "2026-07-29T10:00:00Z" });
  assert.equal(a, "uid:a1b2c3d4-0000-1111-2222-333344445555|2026-07-29T10:00:00.000Z");
  // Moved or renamed, the same file keeps its key; changed, it is a new version.
  assert.equal(archiveKey({ uniqueId: "a1b2c3d4-0000-1111-2222-333344445555", path: "/y/b.pdf", modified: "2026-07-29T10:00:00Z" }), a);
  assert.notEqual(archiveKey({ uniqueId: "a1b2c3d4-0000-1111-2222-333344445555", path: "/x/a.pdf", modified: "2026-08-01T10:00:00Z" }), a);
  assert.equal(archiveKey({ uniqueId: null, path: "/x/a.pdf", modified: null }), "path:/x/a.pdf|");
});

test("only a file on KYC4U's own site is listed", () => {
  const web = `https://kyc4ultd.sharepoint.com${SITE}`;
  assert.equal(listedFileProblem({ path: `${SITE}/Shared Documents/REQ1 A/x.pdf`, web }), null);
  assert.equal(listedFileProblem({ path: `${SITE}/Shared Documents/REQ1 A/x.pdf` }), null);
  assert.equal(listedFileProblem({ path: "/sites/other/x.pdf", web }), "not on the site it was listed from");
  assert.equal(listedFileProblem({ path: `${SITE}/x.pdf`, web: `https://evil.example.com${SITE}` }), "not KYC4U's site");
  assert.equal(listedFileProblem({ path: "x.pdf", web }), "no file path");
});

test("the KYC4U page says how much of KYC4U's site is in the app", () => {
  assert.match(archiveSummaryWords({ listed: 0, copied: 0, toGo: 0, tooLarge: 0, failed: 0, filed: 0, notMatched: 0, noRequest: 0, bytes: 0 }), /No KYC4U files in the app yet/);
  const words = archiveSummaryWords({ listed: 7400, copied: 7000, toGo: 398, tooLarge: 2, failed: 3, filed: 4100, notMatched: 2850, noRequest: 50, bytes: 4e9 });
  assert.match(words, /^7,000 files of 7,400 kept in the app · 398 still to copy · 4,100 filed on companies · 2,850 in request folders not matched to a company yet/);
  assert.match(words, /2 files too large to copy/);
});
