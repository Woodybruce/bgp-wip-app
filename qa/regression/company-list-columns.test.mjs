// GET /api/crm/companies after the list was slimmed (13 November 2026): the
// route itself, cut from the source, with storage and the login helpers
// stubbed. The rows a staff login and a client login are sent must be the
// rows they were sent before; only the heavy fields are left to ?full=1.
// The columns each mode reads are in server/company-list-columns.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isClientCrmCategory } from '../../shared/tenant-categories.ts';
import { parseCompanyListFields, companyListSelection } from '../../server/company-list-columns.ts';
const require = createRequire(import.meta.url);
const { route, evaluate } = require('./source-harness.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

const TABLE = [
  { id: 'landsec', name: 'Landsec', companyType: 'Landlord', conceptStatus: null, kycStatus: 'approved', companiesHouseData: { profile: { companyName: 'LAND SECURITIES' } }, amlChecklist: { a: 1 } },
  { id: 'cafe', name: 'Cafe Brand', companyType: 'Tenant - Café', conceptStatus: 'parked', kycStatus: null, companiesHouseData: { profile: { companyName: 'CAFE LTD' } }, amlChecklist: null },
  { id: 'fashion', name: 'Fashion Brand', companyType: 'Tenant - Fashion', conceptStatus: null, kycStatus: null, companiesHouseData: null, amlChecklist: null },
  { id: 'added', name: 'Added Fashion Brand', companyType: 'Tenant - Fashion', conceptStatus: null, kycStatus: null, companiesHouseData: null, amlChecklist: null },
  { id: 'rival', name: 'Rival Landlord', companyType: 'Landlord', conceptStatus: null, kycStatus: 'approved', companiesHouseData: { profile: {} }, amlChecklist: { a: 2 } },
  { id: 'untyped', name: 'No Type', companyType: null, conceptStatus: null, kycStatus: null, companiesHouseData: null, amlChecklist: null },
];
const HEAVY = ['companiesHouseData', 'amlChecklist'];

// Storage as the real one answers: the whole row, the list columns, or the
// named fields, for every company (the route does the client's cut).
function list(who, query = {}) {
  let handler; const asked = [];
  const storage = { getCrmCompanies: async filters => {
    asked.push(filters);
    const selection = companyListSelection({ fields: filters.fields, slim: filters.slim });
    const rows = TABLE.map(row => selection ? Object.fromEntries(Object.keys(row).filter(key => key in selection).map(key => [key, row[key]])) : { ...row });
    return filters.page && filters.limit ? { data: rows, total: rows.length } : rows;
  } };
  evaluate(route('server/crm.ts', 'get', '/api/crm/companies'), {
    app: { get: (_path, ...chain) => { handler = chain.at(-1); } }, storage, isClientCrmCategory, parseCompanyListFields, parseInt,
    resolveCompanyScope: async () => who.scope || null,
    require: name => { assert.equal(name, './company-scope'); return { getClientExtraBrandIds: async () => new Set(who.extra || []) }; },
  });
  const res = { code: 200, body: undefined, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return handler({ query }, res).then(() => ({ code: res.code, body: plain(res.body), asked: plain(asked[0]) }));
}
const STAFF = {}, LANDSEC = { scope: 'landsec', extra: ['added'] };
const ids = body => body.map(row => row.id);

test('the client category rule used below is the real one', () => {
  assert.equal(isClientCrmCategory('Tenant - Café'), true);
  assert.equal(isClientCrmCategory('Tenant - Fashion'), false);
  assert.equal(isClientCrmCategory('Landlord'), false);
});

test('a staff login is sent every company, without the heavy fields unless it asks', async () => {
  const usual = await list(STAFF);
  assert.deepEqual(ids(usual.body), ids(TABLE));
  assert.equal(usual.asked.slim, true);
  assert.equal(usual.asked.fields, null);
  for (const row of usual.body) for (const field of HEAVY) assert.equal(field in row, false, field);
  // Everything else on the row is as it was, On hold included (BGP's own flag).
  assert.deepEqual(usual.body[1], { id: 'cafe', name: 'Cafe Brand', companyType: 'Tenant - Café', conceptStatus: 'parked', kycStatus: null });

  const full = await list(STAFF, { full: '1' });
  assert.equal(full.asked.slim, false);
  assert.deepEqual(full.body, plain(TABLE));
  // The heavy fields come back only for exactly full=1.
  assert.equal((await list(STAFF, { full: 'true' })).asked.slim, true);
});

test('the filters and paging a staff login could ask for still reach storage', async () => {
  const paged = await list(STAFF, { search: 'brand', groupName: 'G', companyType: 'Landlord', includeBillingEntities: 'true', page: '2', limit: '25' });
  assert.deepEqual([paged.asked.search, paged.asked.groupName, paged.asked.companyType, paged.asked.includeBillingEntities, paged.asked.page, paged.asked.limit],
    ['brand', 'G', 'Landlord', true, 2, 25]);
  assert.deepEqual(ids(paged.body.data), ids(TABLE));
  // A limit with no page is still not paging (the lookups that send ?limit=5000 get the list).
  const lookup = await list(STAFF, { limit: '5000' });
  assert.equal(Array.isArray(lookup.body), true);
  assert.equal(lookup.asked.slim, true);
});

test('a client login is sent the same rows as before: its own company, its category slice and the brands it added', async () => {
  for (const query of [{}, { full: '1' }, { fields: 'id,name' }, { fields: 'id,name,companyType' }, { limit: '5000' }, { page: '1', limit: '2' }]) {
    const sent = await list(LANDSEC, query);
    assert.deepEqual(ids(sent.body), ['landsec', 'cafe', 'added'], JSON.stringify(query));
    // On hold is BGP's flag: never sent to a client, in any mode.
    for (const row of sent.body) assert.equal('conceptStatus' in row, false, JSON.stringify(query));
    // A client never pages: the cut is made on the whole list.
    assert.equal(sent.asked.page, undefined);
    assert.equal(sent.asked.limit, undefined);
  }
  // A client with no added brands loses only that brand.
  assert.deepEqual(ids((await list({ scope: 'landsec' })).body), ['landsec', 'cafe']);
  // Another client's own company row is its own, not Landsec's.
  assert.deepEqual(ids((await list({ scope: 'rival' })).body), ['cafe', 'rival']);
});

test('?full=1 gives a client exactly what the list gave it before', async () => {
  const before = TABLE.filter(row => ['landsec', 'cafe', 'added'].includes(row.id)).map(({ conceptStatus, ...row }) => row);
  assert.deepEqual((await list(LANDSEC, { full: '1' })).body, plain(before));
  // The usual list is those rows less the heavy fields, and nothing else.
  const usual = (await list(LANDSEC)).body;
  assert.deepEqual(usual, plain(before.map(({ companiesHouseData, amlChecklist, ...row }) => row)));
});

test('named fields: only real fields, the same rows, and nothing a client could not already read', async () => {
  const staff = await list(STAFF, { fields: 'name,companyType,bogus,company_type' });
  assert.deepEqual(staff.asked.fields, ['id', 'name', 'companyType']);
  assert.deepEqual(staff.body[0], { id: 'landsec', name: 'Landsec', companyType: 'Landlord' });
  assert.equal(staff.body.length, TABLE.length);

  // The client's cut needs the company type, so it is read and then left out
  // of what is sent when the caller did not ask for it.
  const client = await list(LANDSEC, { fields: 'name' });
  assert.deepEqual(client.asked.fields, ['id', 'name', 'companyType']);
  assert.deepEqual(client.body, [{ id: 'landsec', name: 'Landsec' }, { id: 'cafe', name: 'Cafe Brand' }, { id: 'added', name: 'Added Fashion Brand' }]);
  // Asking for On hold by name does not get a client On hold.
  const sneaky = await list(LANDSEC, { fields: 'name,conceptStatus' });
  assert.deepEqual(sneaky.body[1], { id: 'cafe', name: 'Cafe Brand' });
  assert.equal((await list(STAFF, { fields: 'name,conceptStatus' })).body[1].conceptStatus, 'parked');
  // full=1 wins over fields.
  assert.equal((await list(STAFF, { full: '1', fields: 'name' })).asked.fields, null);
});

test('the Letting Tracker\'s two field lists: the same rows for each login, five fields a row', async () => {
  // The lists the tracker and the brand pickers ask for (13 November 2026),
  // read from the screens themselves so a change there is tested here.
  const { readFileSync } = await import('node:fs');
  const read = (path, name) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').match(new RegExp(`const ${name} = "/api/crm/companies\\?fields=([A-Za-z,]+)"`))[1];
  const lists = [
    read('client/src/lib/tracker-reads.ts', 'TRACKER_COMPANIES_URL'),
    read('client/src/components/brand-search-input.tsx', 'COMPANIES_BASIC_URL'),
  ];
  for (const fields of lists) {
    const names = fields.split(',');
    assert.deepEqual(parseCompanyListFields(fields), names, fields);
    const staff = await list(STAFF, { fields });
    assert.deepEqual(ids(staff.body), ids(TABLE), fields);
    assert.deepEqual(ids(staff.body), ids((await list(STAFF, { limit: '5000' })).body), fields);
    const client = await list(LANDSEC, { fields });
    assert.deepEqual(ids(client.body), ['landsec', 'cafe', 'added'], fields);
    assert.deepEqual(ids(client.body), ids((await list(LANDSEC, { limit: '5000' })).body), fields);
    for (const row of [...staff.body, ...client.body]) {
      for (const key of Object.keys(row)) assert.ok(names.includes(key), `${key} was not asked for`);
      for (const field of [...HEAVY, 'conceptStatus', 'kycStatus']) assert.equal(field in row, false, field);
    }
    // The values are the list's own.
    assert.equal(client.body[1].name, 'Cafe Brand');
    assert.equal(client.body[1].companyType, 'Tenant - Café');
  }
});
