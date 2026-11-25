// The code that works with SharePoint by path, on the folder engine (Woody,
// 24 November 2026: "go ahead with the folder suggestion";
// docs/folders-review-2026-11-20.md, step 5). The fences: ChatBGP's folder
// tools are one file that both of its tool paths run, BGP staff's only (on the
// client block list), on the person's own Microsoft 365 and never from an
// automated run; a path starts inside BGP - Share Drive; and the rest of the
// code that called SharePoint by itself (Model Studio, the MCP server,
// Pathway, the MLRO report, the comps reader, the client tree job) goes
// through the engine's one door. Behaviour is tested in
// server/folders-tools.test.ts.
//   node --import tsx --test qa/regression/folders-tools-guards.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const at = f => new URL(`../../${f}`, import.meta.url);
const read = f => readFileSync(at(f), 'utf8');
const noComments = text => text.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} is there`);
  const to = end ? text.indexOf(end, from + start.length) : -1;
  return text.slice(from, to > from ? to : undefined);
};
const names = list => [...list.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);

const chatbgp = read('server/chatbgp.ts');
const tools = read('server/chatbgp-folder-tools.ts');
const byPath = read('server/folders/by-path.ts');
const FOLDER_TOOLS = names(between(tools, 'export const FOLDER_TOOLS = [', '] as const;'));

test('the eight folder tools: the same list in both files, every one off client logins', () => {
  assert.equal(FOLDER_TOOLS.length, 8);
  assert.deepEqual(names(between(chatbgp, 'const FOLDER_TOOL_NAMES = new Set([', ']);')).sort(), [...FOLDER_TOOLS].sort());
  const blocked = names(between(chatbgp, 'export const CLIENT_BLOCKED_TOOLS = new Set([', ']);'));
  for (const tool of FOLDER_TOOLS) assert.ok(blocked.includes(tool), `${tool} is on CLIENT_BLOCKED_TOOLS`);
  assert.match(tools, /export const FOLDER_TOOL_DEFINITIONS = \[/);
  assert.match(chatbgp, /tools\.push\(\.\.\.\(await import\("\.\/chatbgp-folder-tools"\)\)\.FOLDER_TOOL_DEFINITIONS\);/);
});

test('both of ChatBGP\'s tool paths run the one file; chatbgp.ts does no folder work itself', () => {
  const raw = between(chatbgp, 'export async function executeCrmToolRaw(', '\nexport async function ');
  assert.match(raw, /if \(FOLDER_TOOL_NAMES\.has\(fnName\)\) \{\n\s+const \{ runFolderTool \} = await import\("\.\/chatbgp-folder-tools"\);\n\s+return runFolderTool\(fnName as any, fnArgs, req\);/);
  const single = between(chatbgp, 'export async function handleCrmToolCall(', '\nexport async function ');
  assert.match(single, /if \(FOLDER_TOOL_NAMES\.has\(fnName\)\) \{\n\s+const rawResult = await executeCrmToolRaw\(fnName, fnArgs, req\);/);
  for (const tool of FOLDER_TOOLS) {
    assert.doesNotMatch(chatbgp, new RegExp(`(fnName|tcName) === "${tool}"|case "${tool}"|name: "${tool}"`), `chatbgp.ts handles ${tool} itself`);
  }
  // An email attachment is saved through the same door on both paths.
  assert.equal([...chatbgp.matchAll(/await saveToShareDrive\(req, \{ folderPath: fnArgs\.folderPath, name, bytes: new Uint8Array\(buffer\), from: "email" \}\);/g)].length, 2);
  // The helpers that looked the library up on every call are gone.
  assert.doesNotMatch(chatbgp, /executeCreateSharePointFolder|executeUploadFileToSharePoint|executeMoveSharePointItem|executeReadSharePointFile|browseSharePointFolderByIds|\bbrowseSharePointFolder\(|sharepoint-operations/);
});

test('the tools run as the person asking, on their own Microsoft 365, never from an automated run', () => {
  assert.doesNotMatch(noComments(tools), /getValidMsToken|getAppToken|getAppGraphToken|graphRequest|msal_token_cache|getMsTokenFor|uploadFileToSharePoint|\bfetch\(|graph\.microsoft\.com/);
  assert.match(tools, /microsoft: userId => getOwnMsAccess\(userId\),/);
  const run = between(tools, 'export async function runFolderTool(', '\n}\n');
  assert.ok(run.indexOf('if (automated && tool !== "get_record_folders") return fail(AUTOMATED_REFUSAL);') < run.indexOf('personFor('), 'an automated run is refused first');
  assert.match(run, /if \(!who\.ms\) return fail\(CONNECT_FIRST, \{ connect: true \}\);/);
  const context = between(tools, 'async function contextFor(', '\n}\n');
  assert.match(context, /\{\n\s+if \(deps\.internal\(req\)\) return \{ error: AUTOMATED_REFUSAL \};/);
  const person = between(tools, 'async function personFor(', '\n}\n');
  assert.ok(person.indexOf('await deps.staff(req)') < person.indexOf('deps.microsoft('), 'staff first, then the token');
  const own = between(byPath, 'export async function ownMicrosoft(', '\n}\n');
  assert.match(own, /getOwnMsAccess\(userId\)/);
});

test('a path starts inside BGP - Share Drive; nothing is made in the old tree except below a record\'s own folder', () => {
  assert.match(byPath, /else if \(parts\.length && isOldTree\(parts\[0\]\)\) return \{ problem: OLD_TREE_REFUSAL \};/);
  assert.match(byPath, /if \(isOldTree\(parts\[0\]\) && !opts\.keep\) throw folderRefusal\(400,/);
  assert.match(byPath, /if \(i < \(opts\.keep \?\? 0\)\) throw folderRefusal\(404,/);
  assert.match(tools, /return folderAtPath\(ctx\.token, lib, \[SHARE_DRIVE_NAME, \.\.\.p\.parts\], \{ make: logOf\(ctx, detail\), keep: 2 \}\);/, 'a person\'s path never makes a new top-level folder');
  for (const d of between(tools, 'export const FOLDER_TOOL_DEFINITIONS = [').matchAll(/description: `([^`]*)`/g)) {
    assert.doesNotMatch(d[1], /London F&B|London Retail|National Leasing|Office - Corporate|Development & Re-purposing/, 'no retired team folder');
  }
});

const ENGINE_FILES = [
  'server/chatbgp-design-tools.ts', 'server/mcp-server.ts', 'server/models.ts', 'server/pathway-investigator.ts',
  'server/pathway-tenancy-extractor.ts', 'server/account-folder-inventory.ts', 'server/client-folder-jobs.ts',
  'server/aml-compliance.ts', 'server/news-feeds.ts', 'server/utils/sharepoint-operations.ts',
];

test('the rest of the code that worked with SharePoint by itself goes through the engine\'s one door', () => {
  for (const f of ENGINE_FILES.filter(f => existsSync(at(f)))) {
    const text = read(f);
    assert.doesNotMatch(text, /graph\.microsoft\.com\/v1\.0\/(drives|sites|shares)/, `${f} calls SharePoint itself`);
    assert.doesNotMatch(text, /getSharePointDriveId|executeUploadFileToSharePoint|sharepoint-operations"\)\.\w|from "\.\/utils\/sharepoint-operations"/, `${f} uses the old helpers`);
  }
  const pathway = read('server/property-pathway.ts');
  assert.doesNotMatch(pathway, /executeUploadFileToSharePoint|getSharePointDriveId|\/items\/\$\{bro\.ref\}\/content/);
  const oldImports = [...pathway.matchAll(/await import\("\.\/utils\/sharepoint-operations"\)/g)];
  assert.ok(oldImports.length <= 1, 'only the folder look-up is left on the old file');
  for (const m of pathway.matchAll(/const \{ ([^}]+) \} = await import\("\.\/utils\/sharepoint-operations"\)/g)) assert.equal(m[1].trim(), 'lookupSharePointFolderIfExists');
  if (existsSync(at('server/utils/sharepoint-operations.ts'))) {
    const left = read('server/utils/sharepoint-operations.ts');
    assert.deepEqual([...left.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(m => m[1]), ['lookupSharePointFolderIfExists']);
    assert.match(left, /const own = await ownMicrosoft\(req\);/);
    assert.doesNotMatch(left, /\bfetch\(|getValidMsToken/);
  }
});

test('a person\'s own action takes their own token; a background read keeps the app\'s', () => {
  // A person's own action.
  assert.doesNotMatch(read('server/models.ts'), /getValidMsToken/, 'Model Studio never uses a colleague\'s token');
  assert.doesNotMatch(read('server/models.ts'), /save-to-sharepoint|sync-to-sharepoint/, 'the three uncalled routes are gone');
  assert.match(between(read('server/pathway-investigator.ts'), 'case "sharepoint_search": {', 'case "land_registry_lookup"'), /const own = await ownMicrosoft\(req\);/);
  assert.match(read('server/pathway-tenancy-extractor.ts'), /const own = await ownMicrosoft\(req\);\n\s+if \(!own\) return \[\];/);
  assert.match(between(read('server/property-pathway.ts'), 'Download SharePoint brochures so the sweep', '8a. Bulk image sweep'), /const own = await ownMicrosoft\(req\);/);
  assert.match(between(read('server/aml-compliance.ts'), '"/api/aml/deal/:id/mlro-report/save"', '// ── Country risk admin'), /await saveToShareDrive\(/);
  assert.match(read('server/chatbgp-design-tools.ts'), /ownMicrosoft\(req\)/);
  // A background read, with nobody asking.
  const mcp = read('server/mcp-server.ts');
  assert.match(mcp, /async function mcpGraphToken\(\): Promise<string \| null> \{\n\s+const \{ getAppGraphToken \} = await import\("\.\/microsoft"\);/);
  const comps = between(read('server/news-feeds.ts'), 'async function extractCompsFromSharePoint(', 'async function updateTeamPreferencesFromEngagement(');
  assert.match(comps, /const token = await getAppToken\(\);/);
  assert.match(comps, /const lib = await bgpLibrary\(token\)/);
  assert.match(comps, /await downloadFile\(token, file\.driveId, file\.id, 10 \* 1024 \* 1024\)/);
});

test('ChatBGP\'s app map says how it works with folders', () => {
  const map = read('server/chatbgp-app-map.ts');
  const section = between(map, '### Folders through ChatBGP', '\n## ');
  assert.match(section, /own Microsoft 365 connection/);
  assert.match(section, /never uses a colleague's/);
  assert.match(section, /never from an automated run/);
  assert.match(section, /old "BGP share drive" folder is retired/);
});
