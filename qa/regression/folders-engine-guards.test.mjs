// Folders: one engine (Woody, 24 November 2026: "go ahead with the folder
// suggestion"; docs/folders-review-2026-11-20.md). The fences around it:
// the client gateway refuses /api/folders/ to client logins and joint agents
// (run here on the real gateway source), every route is BGP staff's before a
// token is touched, folder actions use the person's own Microsoft 365 and
// never a colleague's or the app's, and only server/folders/graph.ts talks to
// Microsoft. The rules and the SQL are tested in server/folders.test.ts and
// server/folders-postgres.test.ts.
//   node --import tsx --test qa/regression/folders-engine-guards.test.mjs
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import net from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const { find, evaluate, ts } = require('./source-harness.cjs');
const { routedApiPath, restrictedLandsecApiRule, jointAgentApiDenied } = await import('../../shared/landsec.ts');

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const INDEX = 'server/index.ts';
const declaration = name => find(INDEX, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === name));
const gatewaySource = find(INDEX, n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api"' && n.getText().includes('CLIENT_ALLOWED_WRITES'));

const who = { client: true, role: null };
let gateway;
const lists = evaluate(['CLIENT_ALLOWED_API', 'CLIENT_ALLOWED_WRITES', 'CLIENT_BLOCKED_SUBPATHS'].map(declaration).join('\n')
  + '\nexports.api = CLIENT_ALLOWED_API; exports.writes = CLIENT_ALLOWED_WRITES;\n' + gatewaySource, {
  routedApiPath,
  app: { use: (_, fn) => { gateway = fn; } },
  pool: { query: async () => ({ rows: [] }) },
  process: { env: {} },
  require: () => ({
    isClientRequestUser: async () => who.client,
    resolveCompanyScope: async () => (who.client ? 'client-a' : null),
    isClientVisibleBrand: async () => false,
    isClientReadableCompanyPage: async () => false,
    restrictedLandsecApiDecision: async (req, path) => (who.role === 'joint_agent'
      ? (restrictedLandsecApiRule('joint_agent', req.method, path) === 'allow' ? 'allow' : jointAgentApiDenied(req.method, path) ? 'deny' : null)
      : null),
  }),
});

let server, port;
before(async () => {
  const app = express();
  app.use('/api', gateway);
  app.use((req, res) => res.status(200).json({ reached: req.path }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));

function send(target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let data = '';
    socket.setTimeout(10000, () => { socket.destroy(); reject(new Error(`timed out: ${target}`)); });
    socket.on('connect', () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`));
    socket.on('data', chunk => { data += chunk; });
    socket.on('error', reject);
    socket.on('end', () => resolve(Number(data.split('\r\n')[0].split(' ')[1])));
  });
}

const ROUTES = [
  ['GET', '/api/folders/places'], ['GET', '/api/folders/browse?driveId=d&itemId=i'], ['GET', '/api/folders/search?q=blue'],
  ['GET', '/api/folders/property/p1'], ['GET', '/api/folders/deal/d1'],
  ['POST', '/api/folders/property/p1/links'], ['POST', '/api/folders/deal/d1/create'],
  ['PATCH', '/api/folders/links/l1'], ['DELETE', '/api/folders/links/l1'],
  ['POST', '/api/folders/items/d/i/rename'], ['DELETE', '/api/folders/items/d/i'], ['POST', '/api/folders/items/d/i/upload'],
  ['PUT', '/api/folders/uploads/s1'], ['GET', '/api/folders/copies/j1'], ['POST', '/api/folders/items/d/i/share'],
  ['GET', '/api/admin/folders/migration'], ['POST', '/api/admin/folders/migration/apply'],
  ['GET', '/API/Folders/property/p1'], ['GET', '/api/folders//property/p1'],
];

test('no client list opens /api/folders/ (only /api/folders/client/ ever may)', () => {
  for (const entry of [...lists.api, ...lists.writes]) {
    if (entry.toLowerCase().startsWith('/api/folders')) assert.equal(entry, '/api/folders/client/', `${entry} is on a client list`);
  }
});

test('a client login and a joint agent are refused every folder route at the gateway; BGP staff pass to the routes', async () => {
  for (const role of [null, 'joint_agent']) {
    who.client = true; who.role = role;
    for (const [method, target] of ROUTES) assert.equal(await send(target, method), 403, `${role || 'client'}: ${method} ${target}`);
  }
  who.client = false; who.role = null;
  for (const [method, target] of ROUTES.slice(0, 17)) assert.equal(await send(target, method), 200, `staff: ${method} ${target}`);
});

const routes = read('server/folders/routes.ts');
test('every route is BGP staff\'s, checked before any Microsoft token is asked for', () => {
  const registrations = [...routes.matchAll(/router\.(get|post|patch|put|delete)\("(\/api\/[^"]+)",\s*([^\n]+)/g)];
  assert.ok(registrations.length >= 8, 'the routes are there');
  for (const [, method, path, rest] of registrations) {
    assert.ok(path.startsWith('/api/folders/') || path.startsWith('/api/admin/folders/'), `${method} ${path} is under /api/folders/`);
    assert.match(rest, /^auth, handle\("(staff|maybe|microsoft)"/, `${method} ${path} goes through the staff gate`);
  }
  const gate = routes.slice(routes.indexOf('const handle = '), routes.indexOf('const actorOf'));
  assert.ok(gate.indexOf('await deps.staff(req)') > 0 && gate.indexOf('await deps.staff(req)') < gate.indexOf('deps.microsoft('), 'staff first, then the token');
  assert.match(gate, /if \(!staff\) return res\.status\(403\)/);
  assert.match(gate, /if \(need === "microsoft" && !ms\) return res\.status\(428\)\.json\(\{ message: CONNECT_FIRST, connect: true \}\)/);
});

test('folder actions use the person\'s own Microsoft 365: no colleague\'s token, no app token', () => {
  const dir = new URL('../../server/folders/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const text = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(text, /getValidMsToken|getAppToken|getAppGraphToken|graphRequest|uploadFileToSharePoint|msal_token_cache|getMsTokenFor/, `${f} reaches for another token`);
  }
  assert.match(routes, /microsoft: \(userId: string\) => getOwnMsAccess\(userId\)/);
  const ms = read('server/microsoft.ts');
  const own = ms.slice(ms.indexOf('export async function getOwnMsAccess('), ms.indexOf('function getRedirectUri('));
  assert.doesNotMatch(own, /FROM msal_token_cache mt|ORDER BY mt\.updated_at/, 'no colleague fallback');
  assert.match(own, /delegatedAccountBelongsToUser\(user, account\)/, 'the account must be the person\'s own');
});

test('only server/folders/graph.ts talks to Microsoft, and never sends a token off Graph', () => {
  const dir = new URL('../../server/folders/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'graph.ts')) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /\bfetch\(|graph\.microsoft\.com|sharepoint\.com\/_api/, `${f} calls Microsoft itself`);
  }
  const graph = read('server/folders/graph.ts');
  assert.match(graph, /const res = await transport\(\{ \.\.\.r, url: target\.url, token: target\.withToken \? r\.token : null \}\);/);
  assert.match(graph, /if \(TENANT_HOST\.test\(u\.hostname\)\) return \{ url, withToken: false \};/);
});

test('inside a folder: bodies are read after the staff check, Microsoft\'s signed addresses stay on the server, safe things stay safe', () => {
  assert.match(routes, /router\.post\("\/api\/folders\/items\/:driveId\/:itemId\/upload", auth, handle\("microsoft", async \(req, res, ctx\) => \{\n\s+const \{ driveId, itemId \} = itemIds\(req\);\n[^\n]*\n\s+await new Promise<void>\(\(done, fail\) => smallUpload\(req, res,/);
  assert.match(routes, /router\.put\("\/api\/folders\/uploads\/:sessionId", auth, handle\("staff", async \(req, res, ctx\) => \{[\s\S]{0,400}?if \(!session \|\| session\.userId !== ctx\.staff\.userId\) throw folderRefusal\(404,[\s\S]{0,300}?pieceBody\(req, res,/);
  // The upload address and a copy's monitor are Microsoft's signed addresses: never sent to the browser.
  for (const m of routes.matchAll(/res\.json\(([^;]*)\);/g)) assert.doesNotMatch(m[1], /uploadUrl|monitor/, `res.json(${m[1]}) sends a signed address`);
  const graph = read('server/folders/graph.ts');
  assert.match(graph, /export async function uploadPiece\([\s\S]{0,200}?\n\s+const res = await graph\(\{ method: "PUT", url: uploadUrl, token: null,/);
  assert.match(graph, /const res = await graph\(\{ method: "GET", url: monitorUrl, token: null \}\);/);
  // A name already there is never replaced: new folders fail, uploads and copies get a number.
  assert.match(graph, /conflictBehavior=rename`, token, bytes/);
  assert.match(graph, /"@microsoft\.graph\.conflictBehavior": "rename", name/);
  assert.doesNotMatch(graph, /conflictBehavior[^\n]*replace/);
  // The top of a library and "BGP - Share Drive" are never renamed, moved or deleted; a linked folder is unlinked first.
  for (const route of ['rename', 'move']) assert.match(routes, new RegExp(`/api/folders/items/:driveId/:itemId/${route}", auth, handle\\("microsoft"[\\s\\S]{0,900}?await changeable\\(`));
  assert.match(routes, /router\.delete\("\/api\/folders\/items\/:driveId\/:itemId", auth, handle\("microsoft"[\s\S]{0,300}?await changeable\([\s\S]{0,300}?FROM record_folders WHERE drive_id = \$1 AND item_id = \$2 AND removed_at IS NULL[\s\S]{0,200}?folderRefusal\(409,/);
  assert.match(routes, /if \(body\.toDriveId !== undefined && body\.toDriveId !== driveId\) throw folderRefusal\(400, "A move stays in the same library/);
  // Every change is logged with who did it and the Microsoft account Graph saw.
  for (const action of ['create', 'rename', 'move', 'copy', 'delete', 'upload', 'share', 'invite', 'preview']) assert.match(routes, new RegExp(`action: "${action}"`), `${action} is logged`);
});

test('the six folder colours are design tokens, light and dark, and the browser\'s dialogs are the app\'s own', () => {
  const css = read('client/src/index.css');
  for (const c of ['slate', 'sage', 'sky', 'sand', 'rose', 'plum']) assert.equal((css.match(new RegExp(`--folder-${c}: \\d+ \\d+% \\d+%;`, 'g')) || []).length, 2, `--folder-${c} in light and dark`);
  assert.match(read('tailwind.config.ts'), /folder: \{\n\s+slate: "hsl\(var\(--folder-slate\) \/ <alpha-value>\)"/);
  const browser = read('client/src/components/folders/folder-browser.tsx');
  for (const piece of ['RenameItemDialog', 'DeleteItemsDialog', 'ShareItemDialog', 'PreviewItemDialog', 'NewFolderDialog', 'UploadProgress', 'CopyProgress']) assert.match(browser, new RegExp(`<${piece} `));
  // A drop on an open folder is its own: the app-wide Drop to import never sees it.
  assert.match(browser, /onDrop = \(e: DragEvent\) => \{\n\s+if \(!hasFiles\(e\)\) return;\n\s+e\.preventDefault\(\); e\.stopPropagation\(\);/);
  assert.match(browser, /driveId=\{here\.driveId\}\n\s+start=\{stack\}/, 'a move picks only in the same library');
});

test('the migration report is admins\' only, on their own Microsoft 365, never at boot or on a timer', () => {
  const m = read('server/folders/migration.ts');
  const registrations = [...m.matchAll(/router\.(get|post|patch|put|delete)\("(\/api\/[^"]+)",\s*([^\n]+)/g)];
  assert.equal(registrations.length, 4);
  for (const [, method, path, rest] of registrations) {
    assert.ok(path.startsWith('/api/admin/folders/migration'), `${method} ${path}`);
    assert.match(rest, /^auth, admin, handle\((true|false), /, `${method} ${path} is admins' only`);
  }
  const gate = m.slice(m.indexOf('const handle = '), m.indexOf('router.get("/api/admin/folders/migration"'));
  assert.ok(gate.indexOf('await deps.staff(req)') < gate.indexOf('deps.microsoft('), 'signed in as themselves before any token');
  assert.match(m, /router\.get\("\/api\/admin\/folders\/migration", auth, admin, handle\(true,/);
  assert.doesNotMatch(m, /setInterval|setTimeout|getValidMsToken|getAppToken/);
  // Nothing outside the routes runs it: not at boot, not on a timer.
  for (const f of ['server/index.ts', 'server/routes.ts']) assert.doesNotMatch(read(f), /buildMigrationPreview|applyMigration|undoMigration/);
  assert.match(read('server/folders/routes.ts'), /router\.use\(foldersMigrationRouter\(\{ \.\.\.deps, admin: requireAdmin \}\)\);/);
  // Apply takes only the same admin's preview, within the hour; the old columns are never written.
  assert.match(m, /const refusal = migrationApplyRefusal\(/);
  assert.doesNotMatch(m, /UPDATE (crm_properties|crm_companies|crm_deals|property_schemes|pla_matters|property_pathway_runs)/);
  assert.match(m, /const source = `migrated:\$\{row\.column\}`;/);
});

test('the engine is mounted, and its two tables are made at boot', () => {
  const index = read(INDEX);
  assert.match(index, /const \{ appFoldersRouter \} = await import\("\.\/folders\/routes"\);\n\s+app\.use\(await appFoldersRouter\(\)\);/);
  assert.ok(index.indexOf('app.use(await appFoldersRouter());') > index.indexOf('const CLIENT_ALLOWED_WRITES'), 'mounted after the client gateway');
  assert.match(index, /CREATE TABLE IF NOT EXISTS record_folders \(/);
  assert.match(index, /CREATE UNIQUE INDEX IF NOT EXISTS record_folders_live_uq ON record_folders \(record_type, record_id, drive_id, item_id\) WHERE removed_at IS NULL/);
  assert.match(index, /CREATE INDEX IF NOT EXISTS record_folders_item_idx ON record_folders \(drive_id, item_id\)/);
  assert.match(index, /CREATE TABLE IF NOT EXISTS folder_actions \(/);
});

test('client mode: a client login (or staff viewing as one) gets its data room and never touches the engine', () => {
  const r = read('client/src/components/folders/record-folders.tsx');
  const top = r.slice(r.indexOf('export function RecordFolders('), r.indexOf('function StaffRecordFolders('));
  // The client branch returns before the staff component (and every /api/folders/ read) is reached.
  assert.match(top, /if \(props\.client\) \{[\s\S]*<ClientPropertyFoldersPanel [\s\S]*Documents are managed by the BGP team\.[\s\S]*\}\n\s+return <StaffRecordFolders \{\.\.\.props\} \/>;/);
  assert.doesNotMatch(top, /use(Query|State|Effect|Memo)\(|folderApi|\/api\/folders/);
  // The data room keeps its own reads and the test id the smoke suite waits for.
  const pages = read('client/src/pages/properties.tsx');
  const panel = pages.slice(pages.indexOf('export function ClientPropertyFoldersPanel('), pages.indexOf('export function LinkedDealsPanel('));
  assert.match(panel, /data-testid="client-property-folders-panel"/);
  assert.match(panel, /\/api\/client\/sharepoint\/root/);
  assert.doesNotMatch(panel, /\/api\/folders\//);
  assert.match(read('qa/smoke.mjs'), /client-property-folders-panel/);
});

test('both pages pass their client test, and wait for the sign-in before drawing folders', () => {
  const property = read('client/src/components/property-detail.tsx');
  const drawn = [...property.matchAll(/<RecordFolders [^\n]*\/>/g)].map(m => m[0]);
  assert.equal(drawn.length, 2, 'the plan-led popover and the classic Folders card');
  for (const d of drawn) assert.match(d, /recordType="property" recordId=\{property\.id\} recordName=\{property\.name\} client=\{isClientViewer\}/);
  assert.equal((property.match(/\{pdViewer \? <RecordFolders /g) || []).length, 2);
  assert.match(property, /aria-label="Property folders" data-testid="button-property-folders"/);
  assert.doesNotMatch(property, /PropertyFoldersPanel|PropertySharepointLink|SetUpFoldersDialog/);
  const deal = read('client/src/components/deal-detail.tsx');
  assert.match(deal, /\{!ddUser \? null : jointAgent \? \(/);
  assert.match(deal, /<RecordFolders\n\s+recordType="deal"\n\s+recordId=\{id\}[\s\S]*?client=\{isClientDeal\}\n\s+propertyId=\{linkedProperty\?\.id \|\| null\}/);
  assert.doesNotMatch(deal, /PropertyFoldersPanel/);
});

test('the staff component reads one record\'s folders, and a transaction offers its property as the other place', () => {
  const r = read('client/src/components/folders/record-folders.tsx');
  assert.match(r, /queryFn: \(\) => folderApi\("GET", `\/api\/folders\/\$\{recordType\}\/\$\{recordId\}`\)/);
  assert.match(r, /alt=\{recordType === "deal" && propertyId \? \{ type: "property", id: propertyId, name: propertyName \|\| "the property" \} : null\}/);
  assert.match(r, /Put it on \{alt\.name\} instead, so every transaction there shows it/);
  // No browser prompt or confirm anywhere in the engine's screens.
  const dir = new URL('../../client/src/components/folders/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /window\.(prompt|confirm|alert)\(|\b(prompt|confirm)\(/, `${f} uses a browser dialog`);
  }
});
