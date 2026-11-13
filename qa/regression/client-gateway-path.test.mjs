// The two gates in server/index.ts that judge an address against a list (the
// client gateway and the retired-AML switch), cut from the real source and
// mounted on a real Express app, then sent request lines as typed. Review of
// 13 November 2026: both read text cut out of the request line, which a "#"
// got round (the router stops the path there); the AML switch also missed an
// address spelled in capitals; and the gateway treated an asset manager's
// brand read as allowed outright. A change that undoes any of those fails
// here.
//   node --import tsx --test qa/regression/client-gateway-path.test.mjs
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import net from 'node:net';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const { find, evaluate, ts } = require('./source-harness.cjs');
const { routedApiPath, restrictedLandsecApiRule } = await import('../../shared/landsec.ts');

const INDEX = 'server/index.ts';
const declaration = name => find(INDEX, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === name));
const apiGate = marker => find(INDEX, n => ts.isCallExpression(n) && n.expression.getText() === 'app.use' && n.arguments[0]?.getText() === '"/api"' && n.getText().includes(marker));

const gatewaySource = apiGate('CLIENT_ALLOWED_WRITES');
const retiredSource = apiGate('RETIRED_AML.some');

// Who is asking, set by each test.
const who = { client: true, role: null };
let gateway, retired;
evaluate(['CLIENT_ALLOWED_API', 'CLIENT_ALLOWED_WRITES', 'CLIENT_BLOCKED_SUBPATHS'].map(declaration).join('\n') + '\n' + gatewaySource, {
  routedApiPath,
  app: { use: (_, fn) => { gateway = fn; } },
  pool: { query: async () => ({ rows: [] }) },
  process: { env: {} },
  require: () => ({
    isClientRequestUser: async () => who.client,
    resolveCompanyScope: async () => (who.client ? 'client-a' : null),
    isClientVisibleBrand: async id => id === 'visible-brand',
    // The real rule list, for the role under test; a full client has no role.
    restrictedLandsecApiDecision: async (req, path) => (who.role ? restrictedLandsecApiRule(who.role, req.method, path) : null),
  }),
});
evaluate(declaration('RETIRED_AML') + '\n' + retiredSource, { routedApiPath, process: { env: {} }, app: { use: (_, fn) => { retired = fn; } } });
// The front door: the first thing the app mounts.
const frontDoorSource = find(INDEX, n => ts.isFunctionDeclaration(n) && n.name?.text === 'refuseAmbiguousRequestLine');
const { frontDoor } = evaluate(frontDoorSource + '\nexports.frontDoor = refuseAmbiguousRequestLine;');

// Two copies of the stack: the gates alone (each must hold by itself), and
// the gates behind the front door, as the app mounts them.
let server, port, guarded, guardedPort;
const stack = withFrontDoor => {
  const app = express();
  if (withFrontDoor) app.use(frontDoor);
  app.use('/api', retired);
  app.use('/api', gateway);
  // Whatever gets past the gates: say which address the router matched.
  app.use((req, res) => res.status(200).json({ reached: req.path }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err?.message || err) }));
  return app;
};
before(async () => {
  await new Promise(resolve => { server = stack(false).listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  await new Promise(resolve => { guarded = stack(true).listen(0, '127.0.0.1', resolve); });
  guardedPort = guarded.address().port;
});
after(() => Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => guarded.close(resolve))]));

// A hand-built request, so the request line reaches the server as typed.
function send(target, method = 'GET', toPort = port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: toPort });
    let data = '';
    socket.setTimeout(10000, () => { socket.destroy(); reject(new Error(`timed out: ${target}`)); });
    socket.on('connect', () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    socket.on('data', chunk => { data += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      const status = Number(data.split('\r\n')[0].split(' ')[1]);
      const body = data.slice(data.indexOf('\r\n\r\n') + 4);
      let json = null;
      try { json = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)); } catch { /* not JSON */ }
      resolve({ status, reached: json?.reached ?? null });
    });
  });
}
const as = (role, client = true) => { who.role = role; who.client = client; };

test('neither gate cuts its path out of the request line any more', () => {
  for (const [name, text] of [['the client gateway', gatewaySource], ['the retired-AML switch', retiredSource]]) {
    assert.match(text, /routedApiPath\(req\)/, `${name} no longer reads the path the router matches on`);
    assert.doesNotMatch(text.replace(/\/\/[^\n]*/g, ''), /originalUrl/, `${name} reads req.originalUrl again`);
  }
});

test('a joint agent: the unit list stays shut however the request line is spelled', async () => {
  as('joint_agent');
  assert.deepEqual(await send('/api/available-units/u1/files'), { status: 200, reached: '/api/available-units/u1/files' }, 'a unit\'s files are on the joint agent\'s list');
  for (const target of [
    '/api/available-units',
    '/api/available-units#/files',
    '/api/available-units/#/files',
    '/api/available-units?x=1#/u1/files',
    '/api/available-units/all-offers#/files',
    '/API/Available-Units',
    '/api/available-units/',
  ]) {
    const r = await send(target);
    assert.equal(r.status, 403, `${target} answered ${r.status}${r.reached ? ` and reached ${r.reached}` : ''}`);
  }
});

test('a request line that reads two ways is refused by the gateway, never judged as its shorter reading', async () => {
  // Below the mount the slower URL reader turns "\\" into "/" and takes
  // "//a@b" for a host, leaving "/landsec/home", which a joint agent may
  // open, while the routes are matched on the whole line.
  as('joint_agent');
  assert.equal((await send('/api/landsec/home')).status, 200);
  for (const target of ['/api\\a@b/landsec/home#', '/api//a@b/landsec/home#', '/api\\a@b/landsec/home#/x?y=1']) {
    const r = await send(target);
    assert.equal(r.status, 403, `${target} answered ${r.status}${r.reached ? ` and reached ${r.reached}` : ''}`);
  }
});

test('the front door refuses a "#" or a "\\" in the path before any gate reads the line', async () => {
  const through = (target) => send(target, 'GET', guardedPort);
  as(null, false); // BGP staff: nobody is let through with one
  for (const target of ['/api/available-units#/files', '/api/available-units/#', '/api\\a@b/landsec/home#', '/api//a@b/landsec/home#', '/api/aml/status#x', '/api\\crm/deals', '/index.html#top', '/api/crm/deals?x=1#y']) {
    assert.equal((await through(target)).status, 400, target);
  }
  // What a browser does send is untouched: a query, a "\\" inside the query, any ordinary path.
  assert.deepEqual(await through('/api/crm/deals?q=a\\b'), { status: 200, reached: '/api/crm/deals' });
  assert.deepEqual(await through('/api/crm/deals'), { status: 200, reached: '/api/crm/deals' });
  assert.equal((await through('/')).status, 200);
  assert.equal((await through('/api/aml/status')).status, 410, 'and the gates behind it still answer');
  as('joint_agent');
  assert.equal((await through('/api/available-units')).status, 403);
  assert.equal((await through('/api/available-units#/files')).status, 400);
});

test('an asset manager reads a brand address only where a full Landsec login can', async () => {
  as('asset_manager');
  assert.equal((await send('/api/brand/visible-brand/profile')).status, 200);
  assert.equal((await send('/api/brand/client-a/profile')).status, 200, 'its own company');
  // The rule answers "client" for these; the gateway must carry on into the
  // ordinary checks, never read that answer as allowed.
  for (const target of ['/api/brand/rival-landlord/profile', '/api/brand/rival-landlord/pack.pdf', '/api/brand/tracked', '/api/brand/dedupe/candidates']) {
    assert.equal((await send(target)).status, 403, target);
  }
  as(null);
  assert.equal((await send('/api/brand/visible-brand/profile')).status, 200, 'a full client login, the same brand');
  assert.equal((await send('/api/brand/rival-landlord/profile')).status, 403, 'a full client login, the same rival');
});

test('the mapping-key address: the maps key only, for both restricted roles', async () => {
  for (const role of ['asset_manager', 'joint_agent']) {
    as(role);
    assert.equal((await send('/api/config/maps-key')).status, 200, `${role} maps key`);
    assert.equal((await send('/api/config/os-key')).status, 403, `${role} Ordnance Survey key`);
    assert.equal((await send('/api/config/os-key#/api/config/maps-key')).status, 403, `${role} with a # after it`);
  }
});

test('a request line the router cannot read is refused, not a server error', async () => {
  for (const role of ['joint_agent', 'asset_manager', null]) {
    as(role);
    const r = await send('/api//x@y[/foo#');
    assert.ok(r.status === 403 || r.status === 404 || r.status === 400, `${role || 'full client'}: answered ${r.status}`);
  }
});

test('BGP staff are not gated', async () => {
  as(null, false);
  assert.deepEqual(await send('/api/available-units'), { status: 200, reached: '/api/available-units' });
  assert.equal((await send('/api/brand/rival-landlord/profile')).status, 200);
});

test('the retired-AML switch reads every spelling of a retired address as that address', async () => {
  as(null, false);
  for (const target of ['/api/aml/status', '/api/AML/status', '/api/Kyc-Clouseau/x', '/api//aml/status', '/api/aml/status#x', '/api/kyc-clouseau/x?y=1#z', '/api/kyc/run-all-checks', '/api/KYC/Run-All-Checks', '/api/sanctions']) {
    assert.equal((await send(target)).status, 410, target);
  }
  // Kept: the deal's KYC status read, and everything that is not AML.
  assert.equal((await send('/api/kyc/deal/d1/status')).status, 200);
  assert.equal((await send('/api/kyc4u/requests')).status, 200);
  assert.equal((await send('/api/crm/deals')).status, 200);
});
