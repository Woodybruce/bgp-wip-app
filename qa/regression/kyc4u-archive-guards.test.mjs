// Every file on KYC4U's site, kept in the app (Woody, 21 November 2026: "yes
// build it so we keep all documents in the app"), and KYC4U moved into
// Subscriptions & APIs ("Move KYC4U into subscriptions and APIS when done as
// we shouldn't need it again really"). Source guards; the rules are tested
// in server/kyc4u-archive.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("every archive route is the admins' own", () => {
  const s = read("server/kyc4u-archive.ts");
  const routes = [...s.matchAll(/app\.(get|post)\("(\/api\/kyc4u\/archive[^"]*)",\s*([^)]*?)async/g)];
  assert.ok(routes.length >= 7, `found ${routes.length} routes`);
  for (const [, , path, guards] of routes) assert.match(guards, /requireAuth, requireAdmin/, `${path} is admin only`);
  assert.match(read("server/kyc4u.ts"), /registerKyc4uArchiveRoutes\(app, requireAuth, requireAdmin\);/);
});

test("a file is kept only when the bookmark listed it, and a kept file is never shown as a page", () => {
  const s = read("server/kyc4u-archive.ts");
  const file = s.slice(s.indexOf('app.post("/api/kyc4u/archive/file"'), s.indexOf('app.post("/api/kyc4u/archive/missed"'));
  assert.match(file, /SELECT \* FROM kyc4u_archive_files WHERE file_key = \$1/);
  assert.match(file, /if \(!row\) return res\.status\(404\)/);
  assert.match(s, /limits: \{ fileSize: KYC4U_ARCHIVE_MAX_BYTES, files: 1 \}/);
  const dl = s.slice(s.indexOf('app.get("/api/kyc4u/archive/files/:id"'));
  assert.match(dl, /X-Content-Type-Options", "nosniff"/);
  assert.match(dl, /if \(!uploadShownInline\(file\.contentType\)\)/);
  // Listed files must be on KYC4U's own site.
  assert.match(s, /listedFileProblem\(f\)/);
});

test("the bookmark only reads KYC4U's site, and talks only to the app's window", () => {
  const src = read("client/src/components/kyc4u-panel.tsx");
  const start = src.indexOf("  const code = `");
  const end = src.indexOf("`;", start);
  const template = src.slice(start + "  const code = `".length, end).replace("${JSON.stringify(app)}", '"https://chatbgp.app"');
  const code = eval("`" + template + "`").replace(/\n/g, "");
  assert.doesNotThrow(() => new Function(code));
  const archive = code.slice(code.indexOf("var libs="));
  assert.match(archive, /if\(e\.origin!==APP\|\|e\.source!==w\|\|!e\.data\)return;/);
  assert.doesNotMatch(archive, /method:/, "no write to KYC4U's site");
  assert.match(archive, /GetFileByServerRelativePath/);
  assert.match(code, /type:'kyc4u-data',v:2,/);
  // The window checks who it hears from too.
  const win = read("client/src/pages/kyc4u-import.tsx");
  assert.match(win, /if \(ev\.origin !== KYC4U_ORIGIN \|\| ev\.source !== opener \|\| !ev\.data\) return;/);
});

test("kept files follow their request's match, the five-year deletion and company merges", () => {
  const k = read("server/kyc4u.ts");
  assert.match(k, /await refileKyc4uArchive\(\{ reqRef: String\(req\.params\.itemId\) \}\)/);
  assert.match(k, /Files already copied from KYC4U's site follow their requests' matches\.\n  await refileKyc4uArchive\(\)/);
  assert.match(read("server/aml-records-retention.ts"), /\{ table: "kyc4u_archive_files", party: "company_id"/);
  assert.match(read("server/aml-records-retention.ts"), /DELETE FROM kyc4u_archive_files WHERE company_id = \$1/);
  assert.match(read("server/brand-dedupe.ts"), /\{ table: "kyc4u_archive_files",\s+column: "company_id" \}/);
  assert.match(read("server/index.ts"), /CREATE TABLE IF NOT EXISTS kyc4u_archive_files/);
});

test("KYC4U is in Subscriptions & APIs, and the client check emails are on the AML dashboard", () => {
  assert.match(read("client/src/pages/subscriptions.tsx"), /<Kyc4uPanel \/>/);
  assert.doesNotMatch(read("client/src/pages/hr.tsx"), /Kyc4uPanel/);
  assert.match(read("server/kyc4u.ts"), /res\.redirect\(`\/subscriptions\?section=kyc4u&kyc4u=/);
  assert.doesNotMatch(read("client/src/components/kyc4u-panel.tsx"), /KycEmailsAdmin/);
  const dash = read("client/src/pages/aml-dashboard.tsx");
  assert.match(dash, /\{ key: "emails", label: "Client check emails", admin: true \}/);
  assert.match(dash, /\{shownSection === "emails" && <KycEmailsAdmin \/>\}/);
});
