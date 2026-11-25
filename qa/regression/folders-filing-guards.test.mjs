// Filing the documents the app makes (Woody, 24 November 2026: "go ahead with
// the folder suggestion"; docs/folders-review-2026-11-20.md, decision 2:
// nothing new is made in the old "BGP share drive" tree). The fences: every
// document the app makes goes through the folder engine into its record's
// linked folder, on the app's own token handed in from server/document-filing.ts
// only, and with no folder linked it is not filed and the person is told;
// Document Studio and Legal & DD choose a folder in the engine's picker and act
// as the person, on their own Microsoft 365. The rules and the filing itself
// are tested in server/folders-filing.test.ts.
//   node --import tsx --test qa/regression/folders-filing-guards.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
// Comments say what the code must not do, so they are left out of the checks.
const code = f => read(f).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start > -1, `${from} is there`);
  const end = to ? text.indexOf(to, start + from.length) : -1;
  return text.slice(start, end > -1 ? end : undefined);
};

test('the documents the app makes are filed through the engine into a record\'s folder, never into the old tree', () => {
  for (const f of ['server/unit-brief-doc.ts', 'server/document-briefs.ts', 'server/why-buy-design.ts', 'server/pla-workbook-writer.ts', 'server/email-processor.ts', 'server/documents.ts', 'server/legal-dd.ts']) {
    assert.doesNotMatch(code(f), /uploadFileToSharePoint|SHAREPOINT_ROOT_FOLDER|BGP share drive/i, `${f} files into the old tree`);
  }
  assert.doesNotMatch(read('server/property-pathway.ts'), /uploadFileToSharePoint/);

  // The Targeting Brief: the unit's transaction, else its property, under Targeting Briefs.
  assert.match(code('server/unit-brief-doc.ts'), /fileAppDocument\(\{\n\s+record: unit\.dealId \? \{ type: "deal", id: unit\.dealId \} : \{ type: "property", id: brief\.propertyId \},\n\s+subfolder: "Targeting Briefs",/);
  // Document Briefs: the matter, transaction, run or property; HTML is refused before the brief is drawn when there is nowhere to put it.
  const briefs = code('server/document-briefs.ts');
  assert.equal((briefs.match(/record: briefRecord\(ctx\), subfolder: briefSubfolder\(brief\.briefId\)/g) || []).length, 2);
  const saveHtml = between(briefs, 'app.post("/api/document-briefs/:id/save-html"', 'app.post("/api/document-briefs/:id/render"');
  assert.ok(saveHtml.indexOf('appFilingNote(briefRecord(ctx))') > -1 && saveHtml.indexOf('appFilingNote(briefRecord(ctx))') < saveHtml.indexOf('runBrief('), 'checked before the brief is drawn');
  // A saved PDF stays in Document Studio either way, and the note goes back with it.
  assert.match(between(briefs, 'app.post("/api/document-briefs/:id/save-pdf"', 'app.post("/api/document-briefs/:id/save-html"'), /sharepointNote: filed\.filed \? null : filed\.note/);
  // Why Buy and the Pathway model: the run's folder, else its property's.
  assert.match(code('server/why-buy-design.ts'), /record: \{ type: "pathway_run", id: runId \}, subfolder: "Why Buy Deck"/);
  assert.match(between(read('server/property-pathway.ts'), '// File the generated workbook in SharePoint', '[pathway stage7] SharePoint upload skipped'), /record: \{ type: "pathway_run", id: runId \}, subfolder: "Models"/);
  // Lease Advisory workbooks: the matter's folder, else its property's.
  const writer = code('server/pla-workbook-writer.ts');
  assert.match(writer, /record: \{ type: "pla_matter", id: ids\.matterId \}, subfolder,/);
  assert.equal((writer.match(/uploadAndStamp\(wb, args, "Rent Review\/Valuation", filename\)/g) || []).length, 3);
  assert.equal((writer.match(/uploadAndStamp\(wb, args, "Rent Review\/Comparable Evidence", filename\)/g) || []).length, 1);
  // An emailed request names no record: the document goes back as the reply's attachment only, and the reply says so.
  const email = code('server/email-processor.ts');
  assert.match(email, /if \(deliver === "sharepoint"\) deliveryNote \+= ` \(\$\{NOT_FILED_FROM_EMAIL\}\)`;/);
  assert.doesNotMatch(email, /"put it in the folder" → deliver: "sharepoint"/);
});

test('the app\'s own token reaches the engine from one place, for filing only', () => {
  const wrapper = code('server/document-filing.ts');
  assert.match(wrapper, /return fileRecordDocument\(pool, getAppGraphToken, doc\);/);
  assert.doesNotMatch(wrapper, /getValidMsToken|getOwnMsAccess|getDelegatedGraphTokenForUser|getMsTokenFor/);
  // No other server file hands the filing a token, and the engine never reaches
  // for the wrapper. Model Studio's Save version files as the person saving, on
  // their own Microsoft 365 (24 November 2026), never with the app's token.
  for (const f of readdirSync(new URL('../../server/', import.meta.url)).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'document-filing.ts' && f !== 'models.ts')) {
    assert.doesNotMatch(code(`server/${f}`), /fileRecordDocument\(/, `server/${f} files with a token of its own`);
  }
  const models = code('server/models.ts');
  assert.equal([...models.matchAll(/fileRecordDocument\(/g)].length, 1);
  assert.match(models, /const filed = await fileRecordDocument\(pool, async \(\) => own\.token, \{/);
  assert.match(models, /userId: own\.userId, what: "Model version", account: own\.account,/);
  assert.doesNotMatch(models, /getAppGraphToken|getValidMsToken/);
  for (const f of readdirSync(new URL('../../server/folders/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
    assert.doesNotMatch(code(`server/folders/${f}`), /document-filing/, `server/folders/${f} reaches for the app's token`);
  }
});

test('filing: the record\'s first live link, else its property\'s; no token asked for until there is a folder; every folder made and file put is logged; nothing replaced', () => {
  const filing = code('server/folders/filing.ts');
  assert.match(filing, /WHERE record_type = \$1 AND record_id = \$2 AND removed_at IS NULL\n\s+ORDER BY position, linked_at, id`/);
  // Never into a folder shared with a client, or one inside it (24 November 2026).
  assert.match(filing, /SELECT drive_id, cached_path FROM record_folders WHERE removed_at IS NULL AND shared_with_company_id IS NOT NULL/);
  assert.match(filing, /if \(filingBlockedByShare\(\{ driveId: String\(row\.drive_id\), path, shared: !!row\.shared_with_company_id \}, shared\)\) continue;/);
  assert.match(filing, /note: \(blocked \? notFiledSharedWords : notFiledWords\)\(record, record\.propertyName\)/);
  assert.match(filing, /if \(SHOWS_PROPERTY_FOLDERS\.includes\(record\.type\) && record\.propertyId\)/);
  const run = between(filing, 'export async function fileRecordDocument(', null);
  assert.ok(run.indexOf('if (!place.link) return') > -1 && run.indexOf('if (!place.link) return') < run.indexOf('await token()'), 'the folder is found before a token is asked for');
  assert.match(run, /action: "create"/);
  assert.match(run, /action: "upload", itemId: file\.itemId/);
  assert.match(run, /action: "upload", ok: false/);
  assert.doesNotMatch(filing, /conflictBehavior/, 'uploads go through the engine\'s own calls, which never replace');
  assert.match(filing, /return uploadSmall\(token, driveId, parentId, name, bytes\);/);
  assert.match(filing, /await cancelUploadSession\(uploadUrl\);/);
});

test('Document Studio files a copy in the folder the person picks, as them, on their own Microsoft 365', () => {
  const server = code('server/documents.ts');
  const mirror = between(server, 'app.post("/api/documents/:id/mirror"', 'app.get("/api/documents/:id/editor-config"');
  assert.ok(mirror.indexOf('await folderStaff(req, pool)') > -1 && mirror.indexOf('await folderStaff(req, pool)') < mirror.indexOf('getOwnMsAccess('), 'staff first, then their own token');
  assert.match(mirror, /if \(!ms\) return res\.status\(428\)\.json\(\{ message: CONNECT_FIRST, connect: true \}\);/);
  assert.match(mirror, /if \(!isGraphId\(driveId\) \|\| !isGraphId\(itemId\)\)/);
  assert.match(mirror, /uploadToFolder\(ms\.token, driveId, itemId, name, file\.data\)/);
  assert.match(mirror, /action: "upload" as const/);
  assert.match(mirror, /sharepoint_web_url=\$2, sharepoint_item_id=\$3, sharepoint_path=\$4/);
  assert.doesNotMatch(server, /getAppGraphToken|sp-folders|folderPath|graph\.microsoft\.com/);
  const client = code('client/src/pages/document-studio.tsx');
  assert.match(client, /<FolderPicker\n/);
  assert.match(client, /folderApi<\{ webUrl: string \| null; path: string \}>\("POST", `\/api\/documents\/\$\{selected\.id\}\/mirror`, \{ driveId: folder\.driveId, itemId: folder\.itemId \}\)/);
  assert.doesNotMatch(client, /MirrorDialog|sp-folders|BGP share drive/);
});

test('Legal & DD makes the project folder where the person chooses, as them, says what was and was not made, and links it to its transaction', () => {
  const server = code('server/legal-dd.ts');
  const route = between(server, 'app.post("/api/legal-dd/create-project"', null);
  assert.ok(route.indexOf('await folderStaff(req, pool)') > -1 && route.indexOf('await folderStaff(req, pool)') < route.indexOf('getOwnMsAccess('), 'staff first, then their own token');
  assert.match(route, /if \(!ms\) return res\.status\(428\)\.json\(\{ message: CONNECT_FIRST, connect: true \}\);/);
  assert.match(route, /made = await createFolderTree\(ms\.token, driveId, parentId, name, paths\);/);
  assert.match(route, /SELECT crm_deal_id FROM data_room_analyses WHERE id = \$1 AND user_id = \$2/);
  assert.match(route, /await addFolderLink\(pool, record, \{ \.\.\.actor, token: ms\.token \}, \{ label: name \}, made\.root\);/);
  assert.match(route, /res\.json\(\{ folder: \{ name: made\.root\.name, path: made\.root\.path, webUrl: made\.root\.webUrl \}, made: made\.made, failed, linkedTo, linkProblem \}\);/);
  assert.doesNotMatch(server, /getValidMsToken|graph\.microsoft\.com|\bfetch\(/);
  const client = code('client/src/pages/document-templates.tsx');
  assert.match(client, /folderApi<DDProject>\("POST", "\/api\/legal-dd\/create-project", \{\n\s+dealName, folderMapping: ddResult\.folderMapping, analysisId: ddAnalysisId, driveId: where\.driveId, parentId: where\.itemId,/);
  assert.match(client, /onPick=\{\(\[where\]\) => makeProject\(where\)\}/);
  assert.match(client, /data-testid="dd-project-failed"/);
  assert.doesNotMatch(client, /Project folders created at/);
});

test('the person sees why a document was not filed: the Targeting Brief (BGP staff only), Document Briefs and the Schedule of Comps', () => {
  const route = between(read('server/routes.ts'), 'app.post("/api/unit-briefs/:id/generate-document"', 'res.status(500)');
  assert.match(route, /generateBriefDocument\(String\(req\.params\.id\), \{ userId: docViewer\.userId \}\)/);
  assert.match(route, /sharepointNote: docViewer\.isStaff \? result\.sharepointNote : undefined/);
  assert.match(read('client/src/components/unit-brief-dialog.tsx'), /data\.sharepointNote \? `Saved to the unit's files\. \$\{data\.sharepointNote\}`/);
  assert.match(read('client/src/pages/document-briefs.tsx'), /\{ title: "Kept in Document Studio", description: data\.sharepointNote \|\| data\.filename \}/);
  assert.match(read('server/pla-valuation.ts'), /const sharepointNote = await appFilingNote\(\{ type: "pla_matter", id: matterId \}\);/);
  assert.match(read('client/src/pages/pla-matters.tsx'), /\$\{data\.sharepointNote \|\| "uploading to SharePoint"\}/);
  assert.match(read('server/chatbgp-app-map.ts'), /Not filed in SharePoint: link a folder to/);
});
