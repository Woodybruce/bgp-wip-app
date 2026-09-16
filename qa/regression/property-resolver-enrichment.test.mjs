import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planPropertyEnrichment, runPropertyEnrichment, exactVoaCandidate, propertyIdentityFingerprint } from '../../server/property-resolver-enrichment.ts';
const require = createRequire(import.meta.url);
const { source, find, route, evaluate, ts } = require('./source-harness.cjs');
const property = () => ({ id: 'property-a', name: '12 High Street', address: '12 High Street, London SW1A 1AA', postcode: 'SW1A 1AA', uprn: '100000123456' });
const title = (extra = {}) => ({ title_number: 'N12345', proprietor_name_1: 'Verified Owner Ltd', company_registration_no_1: '00123456', ...extra });
const titles = (extra = {}) => ({ ok: true, resolvedAddress: '12 High Street', resolvedPostcode: 'SW1A 1AA', buildingName: '', lat: null, lng: null, uprns: ['100000123456'], pdErrors: [], matched: { freeholds: [title()], leaseholds: [], exact: true }, fallback: { freeholds: [], leaseholds: [], usedStreetNumberMatch: false }, context: { freeholds: [], leaseholds: [] }, source: 'uprn', ...extra });
const noVoa = { available: true, rows: [] };
function harness(options = {}) {
  let saved = structuredClone(options.property || property()), history = [], transaction;
  const calls = [], lookups = [], releases = [];
  const connection = { release: value => releases.push(value), async query(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: options.locked !== false }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM crm_properties')) return { rows: [sql.includes('FOR UPDATE') && options.current ? options.current : saved] };
    if (sql.startsWith('SELECT id,intelligence')) return { rows: options.cached ? [{ id: 7, intelligence: { propertyEnrichment: { result: options.cached } } }] : [] };
    if (sql === 'BEGIN') { transaction = { saved: structuredClone(saved), history: structuredClone(history) }; return { rows: [] }; }
    if (sql === 'ROLLBACK') { saved = transaction.saved; history = transaction.history; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.startsWith('INSERT INTO land_registry_searches')) { history.push(values); return { rows: [{ id: 41 }] }; }
    if (sql.startsWith('UPDATE crm_properties')) {
      if (options.updateFails) throw new Error('simulated DB failure');
      const fields = sql.split(' SET ')[1].split(',updated_at')[0].split(',').map(part => part.split('=')[0]);
      fields.forEach((field, index) => saved[field] = values[index]);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const deps = { pool: { connect: async () => connection }, lookupTitles: async input => { lookups.push(input); return options.titles || titles(); }, lookupVoa: async () => options.voa || noVoa };
  return { deps, calls, lookups, releases, get saved() { return saved; }, get history() { return history; } };
}
test('only one exact canonical title can fill missing facts; IDs and KYC stay untouched', () => {
  const input = property();
  const result = planPropertyEnrichment(input, titles(), noVoa);
  assert.equal(result.result.status, 'ready');
  assert.equal(result.fields.title_number, 'N12345');
  assert.equal(result.fields.proprietor_name, 'Verified Owner Ltd');
  for (const field of ['landlord_id', 'freeholder_id', 'long_leaseholder_id', 'kyc_status']) assert.equal(field in result.fields, false);
  assert.equal(input.title_number, undefined);
});
test('manual title and any existing owner/link block automatic replacement', () => {
  for (const existing of [{ title_number: 'OTHER' }, { proprietor_name: 'Human owner' }, { landlord_id: 'manual-company' }, { proprietor_company_number: 'human-reg' }]) {
    const { fields } = planPropertyEnrichment({ ...property(), ...existing }, titles(), noVoa);
    for (const field of Object.keys(existing)) assert.equal(field in fields, false);
    assert.equal('proprietor_name' in fields, false);
  }
});
test('multiple titles, discovered UPRNs, provider errors, conflicting duplicates and wrong tenure require review', () => {
  const cases = [
    titles({ matched: { freeholds: [title(), title({ title_number: 'N999' })], leaseholds: [], exact: true } }),
    titles({ uprns: ['100000123456', '999'] }),
    titles({ source: 'street_number' }),
    titles({ pdErrors: [{ endpoint: 'uprn-title', status: 503 }] }),
    titles({ matched: { freeholds: [title(), title({ proprietor_name_1: 'Other Owner' })], leaseholds: [], exact: true } }),
  ];
  for (const candidate of cases) {
    const result = planPropertyEnrichment(property(), candidate, noVoa);
    assert.equal(result.result.status, 'needs_review');
    assert.deepEqual(result.fields, {});
  }
  assert.deepEqual(planPropertyEnrichment({ ...property(), tenure: 'Leasehold' }, titles(), noVoa).fields, {});
  assert.deepEqual(planPropertyEnrichment({ ...property(), uprn: null }, titles(), noVoa).fields, {});
});
test('VOA never picks the first postcode assessment or ambiguous full-address matches', () => {
  const exact = { address: '12 High Street, London', postcode: 'SW1A 1AA', baRef: 'correct' };
  const neighbour = { ...exact, address: '14 High Street, London', baRef: 'wrong' };
  assert.equal(exactVoaCandidate(property(), [neighbour, exact]).baRef, 'correct');
  assert.equal(exactVoaCandidate(property(), [neighbour]), null);
  assert.equal(exactVoaCandidate(property(), [exact, { ...exact, baRef: 'another' }]), null);
  assert.equal(exactVoaCandidate({ ...property(), postcode: '[', address: 'not a postcode' }, [exact]), null);
});
test('provider failure cannot report success or persist title/history', async () => {
  const h = harness({ titles: { ok: false, status: 503, error: 'No configured provider' } });
  const result = await runPropertyEnrichment(h.deps, 'property-a', 'actor-a');
  assert.equal(result.ok, false); assert.equal(result.status, 'unavailable'); assert.equal(result.httpStatus, 503);
  assert.equal(h.history.length, 0); assert.equal(h.saved.title_number, undefined);
  assert.equal(h.calls.some(c => c.sql === 'BEGIN'), false);
});
test('successful research uses canonical identity and authenticated actor, saving history to intended property atomically', async () => {
  const h = harness();
  const result = await runPropertyEnrichment(h.deps, 'property-a', 'actor-a');
  assert.equal(result.ok, true); assert.equal(result.historyId, 41);
  assert.equal(h.lookups[0].uprn, '100000123456'); assert.equal(h.lookups[0].exactUprnOnly, true);
  assert.equal(h.lookups[0].userId, 'actor-a'); assert.equal(h.lookups[0].skipPersist, true);
  assert.equal(h.history[0][0], 'actor-a'); assert.equal(h.history[0][8], 'property-a');
  assert.equal(JSON.parse(h.history[0][7]).propertyEnrichment.identity, propertyIdentityFingerprint(property()));
  assert.equal(h.saved.title_number, 'N12345');
  assert.ok(h.calls.findIndex(c => c.sql === 'BEGIN') < h.calls.findIndex(c => c.sql.startsWith('INSERT')));
  assert.equal(h.calls.filter(c => c.sql === 'COMMIT').length, 1);
});
test('failed property write rolls back the new research history as well', async () => {
  const h = harness({ updateFails: true });
  const result = await runPropertyEnrichment(h.deps, 'property-a', 'actor-a');
  assert.equal(result.ok, false); assert.equal(result.status, 'failed');
  assert.equal(h.history.length, 0); assert.equal(h.saved.title_number, undefined);
  assert.ok(h.calls.some(c => c.sql === 'ROLLBACK'));
});
test('a concurrent human title/owner edit is preserved and changed building identity aborts entirely', async () => {
  const h = harness({ current: { ...property(), title_number: 'MANUAL123', proprietor_name: 'Human owner' } });
  const result = await runPropertyEnrichment(h.deps, 'property-a', 'actor-a');
  assert.equal(result.status, 'needs_review'); assert.deepEqual(result.updatedFields, []);
  const moved = harness({ current: { ...property(), uprn: '999' } });
  const stopped = await runPropertyEnrichment(moved.deps, 'property-a', 'actor-a');
  assert.equal(stopped.httpStatus, 409); assert.equal(moved.history.length, 0);
});
test('successful recent research and a concurrent running lookup avoid repeat provider charges', async () => {
  const recent = planPropertyEnrichment(property(), titles(), noVoa).result;
  const h = harness({ cached: recent });
  assert.equal((await runPropertyEnrichment(h.deps, 'property-a', 'actor-a')).cached, true);
  assert.equal(h.lookups.length, 0);
  const busy = harness({ locked: false });
  const response = await runPropertyEnrichment(busy.deps, 'property-a', 'actor-a');
  assert.equal(response.status, 'running'); assert.equal(response.httpStatus, 202); assert.equal(busy.lookups.length, 0);
});
test('missing authentication, postcode or invalid UPRN never starts a provider lookup', async () => {
  const unauth = harness();
  assert.equal((await runPropertyEnrichment(unauth.deps, 'property-a', '')).httpStatus, 401);
  assert.equal(unauth.calls.length, 0);
  for (const p of [{ ...property(), postcode: 'A1', address: 'Unit A1, High Street' }, { ...property(), uprn: 'bad-id' }]) {
    const h = harness({ property: p });
    assert.equal((await runPropertyEnrichment(h.deps, 'property-a', 'actor-a')).httpStatus, 422);
    assert.equal(h.lookups.length, 0);
  }
});

test('resolver route preserves staff-only and company-scope gates before enrichment', async () => {
  let handler, called = 0;
  const script = route('server/property-resolver.ts', 'post', '/api/property-resolver/enrich/:propertyId');
  evaluate(script, {
    app: { post: (_path, _auth, callback) => handler = callback }, requireAuth() {},
    enrichResolvedPropertyAsync: async (_id, actor) => { called++; return { ok: false, status: 'unavailable', httpStatus: 503, actor }; },
    require: name => { assert.equal(name, './company-scope'); return { isClientRequestUser: async req => req.client, resolveCompanyScope: async req => req.scope, isPropertyInScope: async id => id === 'allowed' }; },
  });
  const invoke = async req => { let status = 200, body; const res = { status: value => { status = value; return res; }, json: value => { body = value; return res; } }; await handler({ params: { propertyId: 'denied' }, ...req }, res); return { status, body }; };
  assert.equal((await invoke({})).status, 401);
  assert.equal((await invoke({ session: { userId: 'actor' }, client: true })).status, 403);
  assert.equal((await invoke({ session: { userId: 'actor' }, scope: 'client-preview' })).status, 403);
  assert.equal(called, 0);
  const response = await invoke({ tokenUserId: 'token-actor' });
  assert.equal(response.status, 503); assert.equal(response.body.ok, false); assert.equal(response.body.actor, 'token-actor');
  assert.equal(response.body.httpStatus, undefined);
});

test('exact UPRN mode does not merge neighbouring discoveries or substitute address-only HMLR results', async () => {
  const fn = find('server/land-registry.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'resolveBuildingTitles');
  const fetched = [];
  const fail = () => { throw new Error('must not discover alternate identity'); };
  const { resolveBuildingTitles } = evaluate(fn, {
    process: { env: { PROPERTYDATA_API_KEY: 'fake-key' } }, URLSearchParams, AbortSignal, setTimeout,
    console: { log() {}, warn() {} },
    require: name => { assert.equal(name, './os-data'); return { osPlacesNearest: fail, osPlacesFind: fail }; },
    isHmlrProprietorsAvailable: fail, findProprietorsByAddress: fail, findFreeholdsByPostcode: fail,
    fetch: async url => { fetched.push(new URL(url)); return { ok: true, status: 200, json: async () => ({ data: { freeholds: [title()], leaseholds: [] } }) }; },
  });
  const result = await resolveBuildingTitles({ address: '12 High Street', postcode: 'SW1A 1AA', uprn: '100000123456', exactUprnOnly: true, skipPersist: true });
  assert.equal(result.ok, true); assert.equal(result.matched.freeholds.length, 1);
  assert.deepEqual([...result.uprns], ['100000123456']);
  assert.equal(fetched.length, 1); assert.equal(fetched[0].pathname, '/uprn-title'); assert.equal(fetched[0].searchParams.get('uprn'), '100000123456');
});

test('explicit title auto-fill leaves property unchanged when provider fails or returns no confirmed title', async () => {
  const script = find('server/companies-house.ts', (n, ast) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(ast) === 'router' && n.expression.name.text === 'post' && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === '/api/title-search/auto-fill/:propertyId');
  for (const response of ['throw', { data: {} }, { data: { ownership: {}, uprns: [] } }, { data: { title_number: 'WRONG' } }]) {
    let handler, writes = 0, status = 200;
    evaluate(script, { router: { post: (_p, _a, cb) => handler = cb }, requireAuth() {},
      pdFetch: async () => { if (response === 'throw') throw new Error('provider unavailable'); return response; },
      require: name => name === './db' ? { db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [property()] }) }) }), update: () => { writes++; throw new Error('must not write'); } } } : name === '@shared/schema' ? { crmProperties: { id: 'id' } } : { eq: () => null },
      console: { log() {}, error() {} },
    });
    const res = { status: s => { status = s; return res; }, json: () => res };
    await handler({ params: { propertyId: 'property-a' }, body: { title: 'N12345' } }, res);
    assert.equal(writes, 0); assert.ok(status >= 400);
  }
});

test('ChatBGP creation reports saved but unenriched without an unauthenticated loopback request', async () => {
  const block = find('server/chatbgp.ts', n => ts.isIfStatement(n) && n.expression.getText().replace(/\s/g, '') === 'fnName==="create_property"' && n.getText().includes('const needsEnrichment'));
  let fetches = 0;
  const { create } = evaluate(`export async function create(fnArgs) { const fnName='create_property'; ${block} }`, {
    db: { insert: () => ({ values: () => ({ returning: async () => [{ id: 'new-property', name: 'Test' }] }) }) },
    require: name => { assert.equal(name, '@shared/schema'); return { crmProperties: {} }; },
    fetch: async () => { fetches++; throw new Error('must not call'); },
  });
  const result = await create({ name: 'Test', postcode: 'SW1A 1AA' });
  assert.equal(result.data.success, true); assert.equal(result.data.enrichment.status, 'needs_enrichment'); assert.equal(fetches, 0);
});

test('unavailable titles do not quietly apply an otherwise exact VOA candidate', async () => {
  const h = harness({ titles: titles({ matched: { freeholds: [], leaseholds: [], exact: false }, pdErrors: [{ endpoint: 'uprn-title', status: 502 }] }), voa: { available: true, rows: [{ address: '12 High Street, London', postcode: 'SW1A 1AA', baRef: 'exact-rating' }] } });
  const result = await runPropertyEnrichment(h.deps, 'property-a', 'actor-a');
  assert.equal(result.ok, false); assert.equal(result.status, 'unavailable'); assert.deepEqual(result.updatedFields, []);
  assert.equal(h.saved.voa_ba_reference, undefined); assert.equal(result.stages.voa, 'needs_review');
});

test('enrich button rejects HTTP 200 failure, handles lost connection and invalidates only after saved result', async () => {
  const fn = find('client/src/components/property-resolver-bar.tsx', n => ts.isVariableDeclaration(n) && n.name.getText() === 'enrich');
  for (const scenario of ['body-failure', 'connection', 'review', 'ready', 'running']) {
    const messages = [], results = [], invalidated = [];
    const { enrich } = evaluate(`const ${fn}; export { enrich };`, {
      propertyId: 'property-a', busy: false, active: { current: true }, setBusy() {},
      getAuthHeaders: () => ({}), setResult: result => results.push(result), toast: message => messages.push(message),
      queryClient: { invalidateQueries: query => invalidated.push(query) },
      fetch: async () => { if (scenario === 'connection') throw new Error('offline'); return { ok: true, json: async () => ({ ok: scenario !== 'body-failure', status: scenario === 'review' ? 'needs_review' : scenario, message: 'Result' }) }; },
    });
    await enrich();
    if (['body-failure', 'connection'].includes(scenario)) {
      assert.equal(messages[0].variant, 'destructive'); assert.equal(invalidated.length, 0);
      assert.equal(results.some(result => result?.ok), false);
    } else {
      assert.equal(messages[0].variant, undefined); assert.equal(results[0].ok, true);
      assert.equal(invalidated.length, scenario === 'running' ? 0 : 2);
    }
  }
});

test('candidate discovery links existing properties without renaming human records', async () => {
  const fn = find('server/property-resolver.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'annotateCandidates');
  let writes = 0;
  const existing = [{ id: 'human-property', uprn: '100000123456', name: 'Brent Cross' }];
  const { annotateCandidates } = evaluate(`${fn}; export { annotateCandidates };`, {
    db: { select: () => ({ from: () => ({ where: async () => existing }) }), update: () => { writes++; throw new Error('must not rename'); } },
    crmProperties: { id: 'id', uprn: 'uprn', name: 'name' }, inArray: () => null,
    derivePropertyNameFromDpa: () => '12 Street',
  });
  const result = await annotateCandidates([{ uprn: '100000123456', address: '12 Street', postcode: 'NW4 3FP' }]);
  assert.equal(result[0].existingPropertyId, 'human-property'); assert.equal(writes, 0); assert.equal(existing[0].name, 'Brent Cross');
});
