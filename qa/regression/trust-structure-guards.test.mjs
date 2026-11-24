// A trust checked by BGP from its structure, never KYC4U (Jack, 23 November
// 2026: "Remove KYC4u on trusts. We need you to build the trust
// structuring"). Source guards; the rules are tested in server/trust-structure.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the structure is BGP staff's, kept per trust record, and a save screens everyone again", () => {
  const s = read("server/trust-structure.ts");
  assert.match(s, /router\.get\("\/api\/trust-structure\/:companyId"[\s\S]{0,120}if \(!\(await staffMe\(req\)\)\) return res\.status\(403\)/);
  assert.match(s, /router\.put\("\/api\/trust-structure\/:companyId"[\s\S]{0,160}const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  assert.match(s, /if \(!\(await isTrustRecord\(companyId\)\)\) return res\.status\(409\)/);
  assert.match(s, /checkTrustStructure\(req\.body\?\.structure\)/);
  assert.match(s, /startPrecheck\(companyId, \{ dealId, userId: me\.id, force: true, entityId: null \}\)/);
  const index = read("server/index.ts");
  assert.match(index, /CREATE TABLE IF NOT EXISTS kyc_trust_structures \(\s*company_id varchar PRIMARY KEY/);
  assert.match(index, /app\.use\(trustStructureRouter\);/);
});

test("a trust never goes to KYC4U: the Next line, the sign-off, the board and the Kick off AML step", () => {
  assert.match(read("shared/aml-box.ts"), /const f: AmlBoxFacts = input\.trust \? \{ \.\.\.input, inHouseEdd: true \} : input;/);
  assert.match(read("shared/party-kyc.ts"), /const f: SignOffFacts = input\.trust \? \{ \.\.\.input, inHouseEdd: true \} : input;/);
  const party = read("server/deal-party-aml.ts");
  assert.match(party, /signOffEnhanced\(facts\) && signOffInHouse\(facts\)/);
  assert.match(party, /trustGaps: trust \? \(await import\("\.\/trust-structure"\)/);
  assert.doesNotMatch(party, /signOffEnhanced\(facts\) && !!facts\.inHouseEdd/);
  const dash = read("server/aml-dashboard.ts");
  assert.match(dash, /const partyInHouse = inHouse \|\| isTrust;/);
  assert.match(dash, /inHouse: partyInHouse, jointAskedAt/);
  // KYC4U is no longer used for any party (23 November 2026): no red KYC4U
  // mark on the board, and Kick off AML sends every party the client checks.
  assert.doesNotMatch(read("client/src/pages/aml-dashboard.tsx"), /amlNeedsKyc4u/);
  const deals = read("client/src/pages/deals.tsx");
  assert.match(deals, /\{clientChecks && <SendClientChecksButton dealId=\{amlStep\.dealId\} companyId=\{p\.id\} partyName=\{p\.name\} label="Kick off AML" \/>\}/);
  assert.doesNotMatch(deals, /Kyc4uRequestButton/);
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.doesNotMatch(box, /Kyc4uRequestButton/);
  assert.match(box, /<TrustStructurePanel companyId=\{cp\.id\} dealId=\{dealId\}/);
});

test("the trust's people are the ones to check and to screen, read from its structure", () => {
  assert.match(read("server/kyc-people.ts"), /m\.trustStructureFor\(party\.companyId\)/);
  const pre = read("server/kyc-prechecks.ts");
  assert.match(pre, /=== "trust"\) \{\s*const \{ trustStructureFor \} = await import\("\.\/trust-structure"\);/);
  assert.match(pre, /trustPerson: true/);
  const portal = read("server/aml-portal.ts");
  assert.match(portal, /trust: trustAsk, publicBody: /);
  // The person acting may pass the trust's people their links, as they do an owner's.
  assert.match(portal, /TRUST_PERSON_ROLES as readonly string\[\]\)\.includes\(r\)/);
});

test("the dialog holds no form: it opens over the deal form", () => {
  assert.doesNotMatch(read("client/src/components/trust-structure.tsx"), /<form[\s>]/);
});

test("the second read and the AML file carry the structure", () => {
  assert.match(read("server/aml-second-read.ts"), /for \(const t of p\.trustStructure \|\| \[\]\) lines\.push\(`Trust structure: \$\{t\}`\);/);
  const file = read("server/aml-file.ts");
  assert.match(file, /trustStructure,\n\s*\}\);/);
  assert.match(file, /inHouse: !!data\.inHouse \|\| p\.trust,/);
});

test("reading the deed is BGP staff's, checked before the file is taken, and saves no structure", () => {
  const s = read("server/trust-structure.ts");
  assert.match(s, /router\.post\("\/api\/trust-structure\/:companyId\/read-deed", async \(req: Request, res: Response, next\) => \{\s*if \(!\(await staffMe\(req\)\.catch\(\(\) => null\)\)\) return res\.status\(403\)[\s\S]{0,40}next\(\);\s*\}, deedUpload\.single\("file"\)/);
  assert.match(s, /claimDailyRead\(DEED_USAGE_KEY, trustDeedReaderDailyCap\(\)\)/);
  assert.match(s, /return checkTrustDeedRead\(reply\.input, text\);/);
  const route = s.slice(s.indexOf('"/api/trust-structure/:companyId/read-deed"'));
  assert.doesNotMatch(route.slice(0, route.indexOf("\nrouter.", 10)), /INSERT INTO kyc_trust_structures|UPDATE kyc_trust_structures/);
  assert.match(read("client/src/components/trust-structure.tsx"), /<DeedReadBack reading=\{reading\} \/>/);
});

test("Request trust structure: staff only, a client checks request marked for the trust, finished once everything is in", () => {
  const s = read("server/trust-structure.ts");
  assert.match(s, /router\.post\("\/api\/trust-structure\/:companyId\/request", async \(req: Request, res: Response\) => \{\s*try \{\s*const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  assert.match(s, /if \(!clientChecksOn\(\)\) return res\.status\(410\)/);
  assert.match(s, /\{ purpose: "trust_structure" \}\);/);
  const portal = read("server/aml-portal.ts");
  // One ready note however many uploads finish it together.
  assert.match(portal, /UPDATE kyc_upload_tokens SET completed_at = now\(\) WHERE token = \$1 AND completed_at IS NULL RETURNING token/);
  assert.match(portal, /if \(isTrustDocsRequest\(request\)\) \{\s*const deedFiles/);
  assert.match(portal, /m\.amlOfficerEmails\(\)/);
  assert.match(portal, /if \(fresh\.request!\.docs\.every\(k => progress\.docsDone\.includes\(k\)\)\) await finishRequest\(fresh\);/);
  // The deed a client sends is read into a draft, never saved as the structure.
  const readFn = s.slice(s.indexOf("export async function readDeedDocument"), s.indexOf("export async function ensureRequestDeedRead"));
  assert.doesNotMatch(readFn, /kyc_trust_structures/);
  assert.match(read("server/index.ts"), /CREATE TABLE IF NOT EXISTS kyc_trust_deed_readings/);
  const ui = read("client/src/components/trust-structure.tsx");
  assert.match(ui, /\/>Ask for trust information\n/);
  assert.match(ui, /\/>Add trust information yourself\n/);
  assert.doesNotMatch(ui, /<form[\s>]/);
});

test("a red flag is raised with the AML Officer by name while the officers check in-house (Jack, 23 November 2026)", () => {
  // Worded once, for the transaction and the client KYC window (aml-red-flags.tsx, 24 November 2026).
  const box = read("client/src/components/aml-red-flags.tsx");
  // Always in-house since KYC4U's retirement (23 November 2026): no KYC4U branch.
  assert.match(box, /title=\{`Red flag: raise with \$\{officer\}`\}/);
  assert.doesNotMatch(box, /Red flag: raise with KYC4U/);
  assert.doesNotMatch(read("client/src/components/deal-aml-status.tsx"), /Red flag: raise with KYC4U/);
  assert.match(read("shared/aml-policy.ts"), /return first \? `AML Officer \(\$\{first\}\)` : "the AML Officer";/);
});

test("a trust stays a trust when a company signs for it (Fortis Green, 23 November 2026)", () => {
  const people = read("server/kyc-people.ts");
  assert.match(people, /const ownRecord = \(trustRecord \|\| publicBody\) && !party\.entityId;/);
  assert.match(people, /const trust = trustRecord \? /);
  assert.match(read("server/deal-party-aml.ts"), /const trust = String\(held\?\.aml_subject_type \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "trust";/);
  assert.match(read("server/aml-dashboard.ts"), /const isTrust = String\(companyRow\?\.aml_subject_type \|\| ""\)\.toLowerCase\(\) === "trust";/);
});

test("certified copies are offered on every request and accepted only by the officers (Jack, 23 November 2026)", () => {
  const portal = read("server/aml-portal.ts");
  // Optional: never one of the request's own documents, so it never holds a request open.
  assert.match(portal, /\.\.\.\(isJointRequest\(request\) \? \{\} : \{\s*certifiedWords:/);
  assert.match(portal, /optionalDocs: TRUST_OPTIONAL_DOCS\.filter\(k => !request\.docs\.includes\(k\)\)/);
  const shared = read("shared/kyc-request.ts");
  assert.doesNotMatch(shared.match(/export const TRUST_REQUEST_DOCS[^\n]*/)[0], /certified_ids/);
  // Accepting is the officers' and takes only documents on that party's record.
  const route = read("server/deal-party-aml.ts");
  assert.match(route, /router\.post\(\["\/api\/deals\/:id\/parties\/:role\/certified-documents", "[^"]+"\], deciderFirst, takeFiles, \(req: Request, res: Response\) => recordPersonVerified\(req, res, true\)\);/);
  // The method comes from the route, never the request: the admin-only public route cannot record a certified one.
  assert.doesNotMatch(route, /req\.body\?\.method/);
  assert.match(route, /FROM kyc_documents WHERE id::text = ANY\(\$1::text\[\]\) AND company_id = \$2/);
  assert.match(read("server/index.ts"), /ALTER TABLE kyc_public_figure_checks ADD COLUMN IF NOT EXISTS method text/);
  assert.doesNotMatch(read("client/src/components/kyc-client-checks.tsx").split("function CertifiedDocsDialog")[1].split("function PublicFigureLine")[0], /<form[\s>]/);
});

test("a certified copy a client sends is read and checked by the app, never taken on trust (Jack, 23 November 2026)", () => {
  const portal = read("server/aml-portal.ts");
  const block = portal.slice(portal.indexOf('if (docKey === "certified_ids" && row.company_id)'), portal.indexOf('if (isTrustDocsRequest(request) || docKey === "trust_deed")'));
  // Filed for the reader, never as seen in the original, and never marked accepted.
  assert.match(block, /INSERT INTO kyc_document_readings \(document_id, deal_id, company_id, trading_entity_id, seen_original, uploaded_by_name\)\s*VALUES \(\$1, \$2, \$3, \$4, false, \$5\)/);
  assert.match(block, /m\.readUpload\(pool, documentId\)/);
  assert.doesNotMatch(block, /accepted_/);
  // An identity copy counts only with the certifier's name, profession or firm, and date.
  const rule = read("shared/kyc-documents.ts");
  assert.match(rule, /if \(!reading\.certified\) reasons\.push\("Not a certified copy, and no agent saw the original"\);/);
  assert.match(rule, /return check\.ok \|\| upload\.accepted \? check\.use : null;/);
});
