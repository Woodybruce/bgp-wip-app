// Upload documents on a party (Woody, 23 November 2026: "the documents upload
// button ... can that be just upload documents but also add the drag and drop
// function ... so can upload certified documents, the app must read these and
// check they are acceptable"). Source guards; the rules are tested in
// server/kyc-documents.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("every route is BGP staff's, signed in as themselves; accepting is the officers'; the router is mounted", () => {
  const s = read("server/kyc-documents.ts");
  // Each route's first address (the transaction's); a client file's sits beside it (24 November 2026).
  const routes = [...s.matchAll(/kycDocumentsRouter\.(get|post)\(\[?"([^"]+)"/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(routes.sort(), [
    "get /api/deals/:id/parties/:role/documents", "post /api/deals/:id/parties/:role/documents",
    "post /api/deals/:id/parties/:role/documents/:docId/accept", "post /api/deals/:id/parties/:role/documents/:docId/read",
  ].sort());
  // Who it is is known before multer reads a file.
  assert.match(s, /"\/api\/deals\/:id\/parties\/:role\/documents", "\/api\/client-kyc\/:companyId\/subjects\/:entity\/documents"\], staffFirst, takeFiles,/);
  assert.match(s, /if \(!\(await staff\(req\)\)\) return res\.status\(403\)[\s\S]{0,200}"\/api\/deals\/:id\/parties\/:role\/documents\/:docId\/read"|"\/api\/deals\/:id\/parties\/:role\/documents\/:docId\/read"(?:, "[^"]+"\])?, async \(req: Request, res: Response\) => \{\s*try \{\s*if \(!\(await staff\(req\)\)\)/);
  assert.match(s, /documents\/:docId\/accept"\]?, async \(req: Request, res: Response\) => \{\s*try \{\s*const \{ decider \} = await import\("\.\/deal-party-aml"\);\s*const me = await decider\(req\);/);
  const index = read("server/index.ts");
  assert.match(index, /app\.use\(kycDocumentsRouter\);/);
  assert.match(index, /CREATE TABLE IF NOT EXISTS kyc_document_readings \(/);
});

test("the reader is Anthropic, called directly with a forced tool, under a daily allowance, and sent the file alone", () => {
  const s = read("server/kyc-documents.ts");
  assert.match(s, /getAnthropicClient\(true\)\.messages\.create\(/);
  assert.match(s, /tool_choice: \{ type: "tool", name: KYC_DOCUMENT_TOOL\.name \}/);
  assert.match(s, /claimDailyRead\(USAGE_KEY, kycDocumentReaderDailyCap\(\)\)/);
  assert.match(s, /process\.env\.KYC_DOCUMENT_READER_DAILY_CAP/);
  assert.match(s, /\[\.\.\.parts, \{ type: "text", text: "Read this document\." \}\]/);
  assert.doesNotMatch(s, /callClaude\(/);
});

test("an upload counts for a person only through the one rule, and is kept, deleted and merged with the party's records", () => {
  const people = read("shared/kyc-people.ts");
  assert.match(people, /const uploads = \(input\.uploads \|\| \[\]\)\.flatMap\(u => uploadCountsFor\(u, \{ name: d\.name, dob: d\.dob \}, input\.today \|\| new Date\(\)\)\);/);
  assert.match(read("server/kyc-people.ts"), /uploads: await import\("\.\/kyc-documents"\)\.then\(m => m\.uploadsFor\(party\.companyId, party\.entityId\)\)/);
  assert.match(read("server/aml-records-retention.ts"), /\{ table: "kyc_document_readings", party: "company_id"/);
  assert.match(read("server/aml-records-retention.ts"), /DELETE FROM kyc_document_readings WHERE company_id = \$1/);
  assert.match(read("server/brand-dedupe.ts"), /\{ table: "kyc_document_readings",\s+column: "company_id" \}/);
});

test("the box is on each party's Documents step, with drag and drop", () => {
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.match(box, /<PartyDocumentsBox dealId=\{dealId\} role=\{cp\.role\} partyName=\{partyName\} canDecide=\{canDecide\} \/>/);
  const c = read("client/src/components/kyc-documents.tsx");
  assert.match(c, /onDrop=\{e => \{/);
  // Its address is the transaction's party, or a client file's (client/src/lib/aml-scope.tsx, 24 November 2026).
  assert.match(c, /\$\{urls\.party\(dealId, role\)\}\/documents/);
  assert.match(read("client/src/lib/aml-scope.tsx"), /party: \(dealId, role\) => `\/api\/deals\/\$\{dealId\}\/parties\/\$\{role\}`/);
  assert.match(c, /An agent saw the originals/);
});

// A file dropped on a box of its own never reaches the app-wide "Drop to
// import" (GlobalDropZone listens on window): found in a browser check on
// 23 November 2026, when a drop on the Upload documents box also opened
// Import Anything and posted the file to /api/ingest.
test("the Upload documents and Describe the transaction boxes keep their own drops", () => {
  for (const f of ["client/src/components/kyc-documents.tsx", "client/src/components/deal-hots.tsx"]) {
    const c = read(f);
    for (const ev of ["onDragEnter", "onDragOver", "onDrop"]) {
      assert.match(c, new RegExp(`${ev}=\\{e => \\{ (?:if \\(!?hasFiles\\(e\\)\\)[^\\n]*?)?e\\.preventDefault\\(\\); e\\.stopPropagation\\(\\);`), `${f} ${ev}`);
    }
    assert.match(c, /onDragLeave=\{e => \{ if \(hasFiles\(e\)\) e\.stopPropagation\(\);/, `${f} onDragLeave`);
  }
});

test("the same file dropped twice is filed once; dropped again with the tick, it is marked as seen in the original", () => {
  const s = read("server/kyc-documents.ts");
  assert.match(s, /held\.set\(`\$\{r\.file_name\}\|\$\{r\.file_size\}`/);
  assert.match(s, /const same = held\.get\(`\$\{f\.name\}\|\$\{f\.buffer\.length\}`\);/);
  assert.match(s, /UPDATE kyc_document_readings SET seen_original = true WHERE document_id = \$1/);
  assert.match(s, /refused\.push\(`\$\{f\.name\} \(already uploaded\)`\)/);
});
