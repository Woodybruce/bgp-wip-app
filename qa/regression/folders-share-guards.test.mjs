// Folders shared with a client, following a folder, and files on your own
// Microsoft 365 (Woody, 24 November 2026: decisions 6 and 7 of
// docs/folders-review-2026-11-20.md). The fences: sharing and following stay
// BGP staff's at the client gateway (run here on the real gateway source),
// while a client login and a joint agent read what is shared with them
// through the data room only, by a link id and names below it, never a drive
// or item id; a share is checked against the record's client and the folder
// read again as the person; the SharePoint page's routes use the person's own
// Microsoft 365, never a colleague's. The rules and the SQL are tested in
// server/folders-share.test.ts.
//   node --import tsx --test qa/regression/folders-share-guards.test.mjs
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import net from 'node:net';
import { readFileSync } from 'node:fs';
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
evaluate(['CLIENT_ALLOWED_API', 'CLIENT_ALLOWED_WRITES', 'CLIENT_BLOCKED_SUBPATHS'].map(declaration).join('\n') + '\n' + gatewaySource, {
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

test('sharing and following stay BGP staff\'s at the gateway; a client and a joint agent read what is shared with them, and write nothing there', async () => {
  const staffOnly = [
    ['GET', '/api/folders/links/l1/share'], ['POST', '/api/folders/links/l1/share'],
    ['POST', '/api/folders/items/d/i/follow'], ['POST', '/api/folders/items/d/i/unfollow'],
  ];
  const reads = ['/api/client/sharepoint/shared', '/api/client/sharepoint/shared?propertyId=p1', '/api/client/sharepoint/shared/l1/list?path=Leases', '/api/client/sharepoint/shared/l1/content?path=Leases%2Fa.pdf'];
  for (const role of [null, 'joint_agent']) {
    who.client = true; who.role = role;
    for (const [method, target] of staffOnly) assert.equal(await send(target, method), 403, `${role || 'client'}: ${method} ${target}`);
    for (const target of reads) assert.equal(await send(target), 200, `${role || 'client'}: GET ${target} reaches its handler`);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(await send('/api/client/sharepoint/shared/l1/list', method), 403, `${role || 'client'}: ${method} is refused`);
  }
  who.client = false; who.role = null;
  for (const [method, target] of staffOnly) assert.equal(await send(target, method), 200, `staff: ${method} ${target}`);
});

const sharepointRoutes = read('server/client-sharepoint.ts');
const sharedSection = sharepointRoutes.slice(sharepointRoutes.indexOf('// ── Folders BGP staff shared with the client'));
test('the data room reads a shared folder by the link and names below it, scope first, never a drive or item id the client sends', () => {
  const routes = [...sharedSection.matchAll(/router\.(get|post|put|patch|delete)\("(\/api\/client\/sharepoint\/shared[^"]*)", requireAuth, async \(req, res\) => \{([\s\S]*?)\n\}\);/g)];
  assert.deepEqual(routes.map(r => `${r[1]} ${r[2]}`), [
    'get /api/client/sharepoint/shared', 'get /api/client/sharepoint/shared/:linkId/list', 'get /api/client/sharepoint/shared/:linkId/content',
  ], 'reads only');
  for (const [, , path, body] of routes) {
    assert.match(body, /^\s+try \{\n\s+const scope = await requireClientScope\(req, res\);\n\s+if \(!scope\) return;/, `${path}: the client's scope first`);
    assert.doesNotMatch(body, /req\.(query|body|params)\.(driveId|itemId)/, `${path}: never a drive or item id from the client`);
  }
  for (const [, , path, body] of routes.slice(1)) {
    assert.ok(body.indexOf('await sharedLinkFor(req, scope,') < body.indexOf('sharedPathParts(req.query.path)'), `${path}: the link is checked first`);
    assert.ok(body.indexOf('sharedPathParts(req.query.path)') < body.indexOf('await sharedFolderItem('), `${path}: the path is checked before SharePoint is asked`);
  }
  // The list sends what a client may see of a share: never its drive, item, path or address.
  assert.match(routes[0][3], /res\.json\(\{ folders: links\.map\(l => l\.shown\) \}\)/);
  const share = read('server/folders/share.ts');
  const shown = share.slice(share.indexOf('shown: {'), share.indexOf('driveId: String(r.drive_id)'));
  assert.doesNotMatch(shown, /drive_id|item_id|web_url|cached_path/);
  // Below the folder only, and the folder itself never a drive's top or the whole of BGP - Share Drive.
  const item = sharedSection.slice(sharedSection.indexOf('export async function sharedFolderItem('), sharedSection.indexOf('async function shareChecks('));
  assert.match(item, /if \(!item \|\| sharedRootProblem\(item, link\.driveId\)\)/);
  assert.match(item, /if \(!item\?\.id \|\| !insideSharedFolder\(root, item\)\) return null;/);
  assert.match(item, /parts\.map\(encodeURIComponent\)\.join\("\/"\)/);
  // A joint agent is held to its schemes, failing closed; a company's own folder never shows to it.
  assert.match(sharedSection, /const limit = await schemeLimitedPropertyIdsOrNone\(req, "client-sharepoint"\);/);
  assert.match(sharedSection, /if \(limit !== null && !limit\.includes\(propertyId\)\) return false;\n\s+return isPropertyInScope\(scope, propertyId\);/);
  assert.match(read('shared/folder-share.ts'), /if \(link\.recordType === "company"\) return link\.recordId === viewer\.scope && !viewer\.limited;/);
  // The data room's other reads are as they were.
  assert.match(sharepointRoutes, /router\.get\("\/api\/client\/sharepoint\/list", requireAuth,[\s\S]{0,400}?const item = await itemInJail\(req, scope, root, itemId\);/);
});

test('a share is the record\'s client only, read again as the person in BGP\'s library, and logged; stopping needs no Microsoft 365', () => {
  const share = read('server/folders/share.ts');
  assert.doesNotMatch(share.replace(/\/\/[^\n]*/g, ''), /getValidMsToken|getAppToken|getAppGraphToken|graphRequest|msal_token_cache|\bfetch\(/, 'no app or colleague token, and Graph only through graph.ts');
  // The companies isPropertyInScope gives the property to, with client logins, not merged away.
  assert.match(share, /SELECT landlord_id FROM crm_properties WHERE id = \$1 AND landlord_id IS NOT NULL\n\s+UNION SELECT company_id FROM crm_company_properties WHERE property_id = \$1/);
  assert.match(share, /c\.merged_into_id IS NULL/);
  assert.match(share, /const clients = tied\.length \? await clientCompanyIds\(db, deps\) : new Set<string>\(\);/);
  const shareFn = share.slice(share.indexOf('export async function shareFolderLink('), share.indexOf('export async function withSharing('));
  const order = ['const company = candidates.find(c => c.id === companyId);', 'if (!actor.token) throw folderRefusal(428', 'await itemForChange(actor.token,', 'await bgpLibrary(actor.token)', 'linkTopProblem(', 'link.drive_id !== library.driveId', 'SET shared_with_company_id = $2'];
  for (let i = 1; i < order.length; i++) assert.ok(shareFn.indexOf(order[i - 1]) >= 0 && shareFn.indexOf(order[i - 1]) < shareFn.indexOf(order[i]), `${order[i - 1]} before ${order[i]}`);
  const stop = shareFn.slice(shareFn.indexOf('if (companyId === null || companyId === "")'), shareFn.indexOf('if (typeof companyId !== "string"'));
  assert.doesNotMatch(stop, /token/, 'stopping does not need Microsoft 365');
  assert.match(stop, /action: "unshare_client"/);
  assert.match(shareFn, /action: "share_client"/);
  const routes = read('server/folders/routes.ts');
  assert.match(routes, /router\.get\("\/api\/folders\/links\/:id\/share", auth, handle\("staff",/);
  assert.match(routes, /router\.post\("\/api\/folders\/links\/:id\/share", auth, handle\("maybe", async \(req, res, ctx\) => \{\n[^\n]*\n\s+if \(companyId !== null && companyId !== "" && !ctx\.ms\) return res\.status\(428\)\.json\(\{ message: CONNECT_FIRST, connect: true \}\);/);
  assert.match(routes, /res\.json\(await withSharing\(db, await readRecordFolders\(/);
  for (const action of ['follow', 'unfollow']) {
    assert.match(routes, new RegExp(`router\\.post\\("/api/folders/items/:driveId/:itemId/${action}", auth, handle\\("microsoft",[\\s\\S]{0,200}?action: "${action}"`), `${action}: the person's own Microsoft 365, logged`);
  }
  // The share columns are made at boot.
  const index = read(INDEX);
  for (const col of ['shared_with_company_id text', 'shared_by varchar', 'shared_at timestamptz']) assert.match(index, new RegExp(`ALTER TABLE record_folders ADD COLUMN IF NOT EXISTS ${col}`));
});

test('the screens: staff share from the chip, a client reads its shares in the data room and never calls the engine', () => {
  const chip = read('client/src/components/folders/record-folders.tsx');
  assert.match(chip, /<FolderShareMenuItems link=\{f\} onShare=\{setSharing\} \/>/);
  assert.match(chip, /<SharedMark link=\{f\} \/>/);
  assert.match(chip, /<ShareWithClientDialog link=\{sharing\} recordType=\{recordType\} onClose=\{\(\) => setSharing\(null\)\} \/>/);
  assert.match(chip, /<FolderFollowMenuItem driveId=\{f\.driveId\} itemId=\{f\.itemId\}/);
  // The client branch still returns before anything of the engine's is reached.
  const top = chip.slice(chip.indexOf('export function RecordFolders('), chip.indexOf('function StaffRecordFolders('));
  assert.doesNotMatch(top, /FolderShare|FolderFollow|SharedMark/);
  assert.match(read('client/src/components/folders/folder-browser.tsx'), /\{item\.isFolder && <FolderFollowMenuItem driveId=\{item\.driveId\} itemId=\{item\.itemId\}/);
  const client = read('client/src/components/folders/client-shared-folders.tsx');
  assert.doesNotMatch(client.replace(/\/\/[^\n]*/g, ''), /\/api\/folders|folderApi|driveId|itemId/);
  assert.match(client, /\/api\/client\/sharepoint\/shared\/\$\{encodeURIComponent\(folder\.id\)\}\/list\?path=\$\{encodeURIComponent\(path\)\}/);
  const pages = read('client/src/pages/properties.tsx');
  const panel = pages.slice(pages.indexOf('export function ClientPropertyFoldersPanel('), pages.indexOf('export function LinkedDealsPanel('));
  assert.equal((panel.match(/<ClientSharedFolders\b/g) || []).length, 2, 'with a root, and with none');
  assert.match(panel, /data-testid="client-property-folders-panel"/);
  assert.match(read('client/src/components/client-sharepoint-browser.tsx'), /<ClientSharedFolders title="Shared with you by BGP" \/>/);
});

test('a company merge takes its folder links and its shares with it', () => {
  const dedupe = read('server/brand-dedupe.ts');
  const merge = dedupe.slice(dedupe.indexOf('export async function mergeCompanyInto('), dedupe.indexOf('// ─── Dismiss a candidate'));
  assert.ok(merge.indexOf('await repointCompanyRefs(client, secondaryId, primaryId)') < merge.indexOf('await moveCompanyFolders(client, secondaryId, primaryId)'), 'after the references, inside the merge');
  assert.ok(merge.indexOf('await moveCompanyFolders(') < merge.indexOf('SET merged_into_id = $1'));
  const m = read('server/folders/merge.ts');
  assert.match(m, /await q\.query\("SAVEPOINT company_folders"\);/);
  assert.match(m, /UPDATE record_folders SET record_id = \$2 WHERE record_type = 'company' AND record_id = \$1/);
  assert.match(m, /UPDATE record_folders SET shared_with_company_id = \$2 WHERE shared_with_company_id = \$1/);
});

test('the SharePoint page, the widget and the add-in open files on the person\'s own Microsoft 365; dead routes are gone', () => {
  const ms = read('server/microsoft.ts');
  const routeBody = (method, path) => {
    const start = ms.indexOf(`app.${method}("${path}"`);
    assert.ok(start >= 0, `${method} ${path} is there`);
    return ms.slice(start, ms.indexOf('\n  });\n', start));
  };
  for (const [method, path] of [['get', '/api/microsoft/files'], ['get', '/api/microsoft/files/content'], ['get', '/api/microsoft/files/thumbnail'],
    ['patch', '/api/microsoft/files/item'], ['post', '/api/microsoft/files/folder'], ['delete', '/api/microsoft/files/item'], ['post', '/api/microsoft/files/upload']]) {
    const body = routeBody(method, path);
    assert.match(body, /const token = await ownFileToken\(req, res\);\n\s+if \(!token\) return;/, `${method} ${path}: own token`);
    assert.doesNotMatch(body, /getValidMsToken/, `${method} ${path}: never a colleague's`);
  }
  const helper = ms.slice(ms.indexOf('const ownFileToken = async'), ms.indexOf('app.get("/api/microsoft/files"'));
  assert.match(helper, /const own = await getOwnMsAccess\(String\(userId\)\);/);
  assert.match(helper, /res\.status\(428\)\.json\(\{ message: CONNECT_OWN, connect: true \}\)/);
  assert.doesNotMatch(routeBody('get', '/api/microsoft/files'), /\$expand=thumbnails/, 'a folder listing does not ask for thumbnails');
  for (const gone of ['/api/microsoft/team-folders', '/api/microsoft/company-folder-templates', '/api/microsoft/shared-folder-probe', '/api/microsoft/sharepoint/debug', '/api/microsoft/sharepoint/sites']) {
    assert.doesNotMatch(ms, new RegExp(`app\\.(get|post)\\("${gone.replace(/\//g, '\\/')}`), `${gone} is gone`);
  }
  const studio = read('server/image-studio.ts');
  const capture = studio.slice(studio.indexOf('app.post("/api/image-studio/capture-pdf"'), studio.indexOf('// Save base64 image'));
  assert.match(capture, /const own = await getOwnMsAccess\(/);
  assert.doesNotMatch(capture, /getValidMsToken/);
  assert.doesNotMatch(studio, /export function startImageSync\(/);
  const page = read('client/src/pages/sharepoint.tsx');
  assert.doesNotMatch(page, /team-folders|TeamFoldersSection/);
  assert.match(page, /if \(\(filesError as any\)\?\.connect\) \{\n\s+return <ConnectPrompt own \/>;/);
  assert.match(read('client/src/components/dashboard/sharepoint-widget.tsx'), /res\.status === 428 \? "own"/);
});
