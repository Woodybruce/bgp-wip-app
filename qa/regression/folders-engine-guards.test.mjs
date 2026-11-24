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
  for (const [method, target] of ROUTES.slice(0, 9)) assert.equal(await send(target, method), 200, `staff: ${method} ${target}`);
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
  assert.match(routes, /microsoft: userId => getOwnMsAccess\(userId\)/);
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

test('the engine is mounted, and its two tables are made at boot', () => {
  const index = read(INDEX);
  assert.match(index, /const \{ appFoldersRouter \} = await import\("\.\/folders\/routes"\);\n\s+app\.use\(await appFoldersRouter\(\)\);/);
  assert.ok(index.indexOf('app.use(await appFoldersRouter());') > index.indexOf('const CLIENT_ALLOWED_WRITES'), 'mounted after the client gateway');
  assert.match(index, /CREATE TABLE IF NOT EXISTS record_folders \(/);
  assert.match(index, /CREATE UNIQUE INDEX IF NOT EXISTS record_folders_live_uq ON record_folders \(record_type, record_id, drive_id, item_id\) WHERE removed_at IS NULL/);
  assert.match(index, /CREATE INDEX IF NOT EXISTS record_folders_item_idx ON record_folders \(drive_id, item_id\)/);
  assert.match(index, /CREATE TABLE IF NOT EXISTS folder_actions \(/);
});
