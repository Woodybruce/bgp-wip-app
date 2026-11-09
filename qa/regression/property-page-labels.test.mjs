// The Royal Exchange property board (Woody, 2026-09-28: "what a mess"): the
// label rules behind the header alias, the Teams field, the BGP team people,
// the On deals & tracker chips and the investment comps order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bgpTeamsOnly, displayAliases, sameName, withoutPropertyName } from '../../shared/property-labels.ts';
import { DEAL_STATUS_LABELS, legacyToCode } from '../../shared/deal-status.ts';
import { assetClassesIn, assetIsCentralLondon, assetIsLondon, assetProfile, useDetailsIn } from '../../shared/investment-fit.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');

const serverFile = 'server/property-asset-brief.ts';
// Values built inside the vm context are other-realm arrays/objects.
const plain = value => JSON.parse(JSON.stringify(value));
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);

test('an alias that only differs by "The", case or punctuation is not another name', () => {
  assert.equal(sameName('The Royal Exchange', 'Royal Exchange'), true);
  assert.equal(sameName('royal exchange.', 'Royal  Exchange'), true);
  assert.deepEqual(displayAliases('Royal Exchange', ['The Royal Exchange']), []);
  assert.deepEqual(displayAliases('Lucent', ['Piccadilly Lights', 'piccadilly lights', 'The Lucent']), ['Piccadilly Lights']);
  assert.deepEqual(displayAliases('Lucent', ['1 Piccadilly Circus, London, W1J 0DA', 'Lucent, London, UK']), [], 'postal addresses stay out');
  assert.deepEqual(displayAliases('X', null), []);
});

test('the Teams field shows only BGP teams, whatever deal edits copied in', () => {
  assert.deepEqual(bgpTeamsOnly(['London Leasing', 'Landlord', 'BGP', 'Development', 'London Retail']), ['Development', 'London Retail']);
  assert.deepEqual(bgpTeamsOnly(['investment', ' Lease Advisory ', 'Investment']), ['Investment', 'Lease Advisory']);
  assert.deepEqual(bgpTeamsOnly(null), []);
  assert.deepEqual(bgpTeamsOnly('Tenant Rep'), ['Tenant Rep']);
});

test("a property's own name is dropped from deal and unit labels on its page", () => {
  assert.equal(withoutPropertyName('Royal Exchange - Inception T2', 'Royal Exchange'), 'Inception T2');
  assert.equal(withoutPropertyName('The Royal Exchange – Units 2-3', 'Royal Exchange'), 'Units 2-3');
  assert.equal(withoutPropertyName("Nando's – Bluewater Shopping Centre", 'Bluewater Shopping Centre'), "Nando's");
  assert.equal(withoutPropertyName('The Royal Exchange', 'Royal Exchange'), 'The Royal Exchange', 'nothing left → label kept');
  assert.equal(withoutPropertyName('Unit 16 & 17', 'Royal Exchange'), 'Unit 16 & 17');
  assert.equal(withoutPropertyName('Royal Exchange - X', null), 'Royal Exchange - X');
});

const { propertyBgpTeam } = evaluate(fn(serverFile, 'propertyBgpTeam') + '\nexports.propertyBgpTeam = propertyBgpTeam;');

test('the BGP team is never empty while BGP people work the property', () => {
  const deals = [
    { id: 'lizzie', name: 'Lizzie Knights', team: ['London Retail'] },
    { id: 'evie', name: 'Evie North', team: ['Landlord', 'London Retail'] },
    { id: 'lizzie', name: 'Lizzie Knights', team: ['London Retail'] },
  ];
  const account = [
    { id: 'jack', name: 'Jack Barratt', role: 'Investment', company_name: 'Ardent' },
    { id: 'lizzie', name: 'Lizzie Knights', role: 'Leasing', company_name: 'Ardent' },
    { id: 'pete', name: 'Peter Wood', role: 'Lease advisory', company_name: 'Ardent' },
    { id: 'woody', name: 'Woody Bruce', role: 'Relationship lead', company_name: 'Ardent' },
  ];
  const team = propertyBgpTeam([], deals, account);
  assert.deepEqual(plain(team.map(p => [p.name, p.role, p.source])), [
    ['Lizzie Knights', 'Leasing', 'deals'],
    ['Evie North', 'Leasing', 'deals'],
    ['Jack Barratt', 'Investment', 'account'],
    ['Peter Wood', 'Lease advisory', 'account'],
    ['Woody Bruce', 'Relationship lead', 'account'],
  ], 'one row per person; deal agents first, then the account team');
  assert.ok(team.every(p => p.side === 'bgp' && p.id === `u-${p.user_id}`));
  assert.equal(team.find(p => p.source === 'account').via, 'Ardent account team');

  const set = propertyBgpTeam([{ id: 'jack', name: 'Jack Barratt', agent_role: 'Lead' }], deals, account);
  assert.deepEqual(plain(set.map(p => [p.name, p.role, p.source])), [
    ['Jack Barratt', 'Lead', 'property'],
    ['Lizzie Knights', 'Leasing', 'deals'],
    ['Evie North', 'Leasing', 'deals'],
  ], 'once the property team is set, the account team no longer fills in');
  assert.deepEqual(plain(propertyBgpTeam([], [{ id: 'x', name: 'X', team: ['Investment'] }], []).map(p => p.role)), ['Investment']);
  assert.deepEqual(plain(propertyBgpTeam([], [{ id: 'x', name: 'X', team: ['Landlord'] }], []).map(p => p.role)), ['On deals']);
});

function linkedContacts(rowsFor) {
  let handler; const queries = [];
  const route = find(serverFile, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText() === 'router' && node.expression.name.text === 'get' && node.arguments[0]?.text === '/api/properties/:id/linked-contacts') + ';';
  evaluate(route, {
    requireAuth() {}, ensureContactOverrides: async () => {}, console: { error() {} },
    router: { get: (_path, _auth, fn) => { handler = fn; } },
    require: name => { assert.equal(name, './company-scope'); return { clientBlockedForProperty: async () => false }; },
    DEAL_STATUS_LABELS, legacyToCode, withoutPropertyName, propertyBgpTeam,
    pool: { query: async (sql, values) => { queries.push(sql); assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/); return { rows: rowsFor(sql, values) }; } },
  });
  return { queries, async run() {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ params: { id: 'rex' } }, res); return res;
  } };
}

test("On deals & tracker: short chips, the deal on the name's line, never the owner's people as bidders", async () => {
  const app = linkedContacts(sql => {
    if (/SELECT name FROM crm_properties WHERE id/.test(sql)) return [{ name: 'Royal Exchange' }];
    if (/AS brand_id/.test(sql)) return [{ brand_id: 'inception', brand_name: 'Inception T2', deal_name: 'Royal Exchange - Inception T2', deal_status: 'SOL' }];
    if (/WITH touches/.test(sql)) return [{ id: 'noxy-contact', name: 'Sam Noxy', role: 'Director', company_id: 'noxy', company_name: 'Noxy Brothers', kind: 'offered', unit_name: 'Units 2-3 The Royal Exchange' }];
    if (/FROM crm_contacts c JOIN owner_cos o[\s\S]*director/.test(sql)) return [{ id: 'andrew', name: 'Andrew Hilston', role: 'Director', company_id: 'ardent', company_name: null, owner_name: 'Ardent' }];
    if (/bgp_contact_user_ids/.test(sql)) return [{ id: 'jack', name: 'Jack Barratt', role: 'Investment', company_name: 'Ardent' }];
    return [];
  });
  const res = await app.run();
  assert.equal(res.code, 200);
  const brand = res.body.deals.find(d => d.id === 'co-inception');
  assert.equal(brand.via, 'Solicitors', 'the chip is the stage, not the deal name');
  assert.equal(brand.context, null, 'the brand-only row does not repeat its own name');
  const offer = res.body.interest[0];
  assert.equal(offer.via, 'Offer');
  assert.equal(offer.context, 'Units 2-3');
  assert.equal(res.body.internal.find(p => p.id === 'andrew').company_name, 'Ardent', 'client people carry their company');
  assert.deepEqual(plain(res.body.internal.filter(p => p.side === 'bgp').map(p => p.name)), ['Jack Barratt']);
  const interestSql = app.queries.find(sql => /WITH touches/.test(sql));
  assert.match(interestSql, /NOT EXISTS[\s\S]*c\.company_id IN \(op\.landlord_id, op\.freeholder_id, op\.long_leaseholder_id\)/,
    "an offer logged against the owner's own director (Andrew Hilston at Ardent) is not a bidder");
  const trackerSql = app.queries.find(sql => /WITH active_units/.test(sql) && /parties/.test(sql));
  assert.match(trackerSql, /NOT EXISTS[\s\S]*p\.company_id IN \(op\.landlord_id/);
});

test("the lease-expiry gap message counts the units instead of saying 'some'", () => {
  const { summariseBriefSchedule } = evaluate(['briefOccupancy', 'summariseBriefSchedule'].map(name => fn(serverFile, name)).join('\n') + '\nexports.summariseBriefSchedule = summariseBriefSchedule;');
  const row = (patch = {}) => ({ id: String(Math.random()), status: 'Occupied', lease_expiry: '2040-01-01', rent_pa: 100, schedule_source: 'tenancy', ...patch });
  assert.equal(summariseBriefSchedule([row({ lease_expiry: null })]).message, 'The occupied unit has no lease expiry recorded, so lease risk checks are incomplete.');
  assert.equal(summariseBriefSchedule([row({ lease_expiry: null }), row()]).message, '1 of 2 occupied units has no lease expiry recorded, so lease risk checks are incomplete.');
  assert.equal(summariseBriefSchedule([row({ lease_expiry: null }), row({ lease_expiry: 'bad' })]).message, 'All 2 occupied units have no lease expiry recorded, so lease risk checks are incomplete.');
});

test('investment comps: a City arcade ranks central shops above retail parks elsewhere in London', async () => {
  const file = 'server/investment-buyers.ts';
  const compClasses = find(file, node => ts.isVariableStatement(node) && node.getText().startsWith('const compClasses'));
  const { getPropertyInvestmentComps } = evaluate([fn(file, 'rows'), compClasses, fn(file, 'getPropertyInvestmentComps')].join('\n') + '\nexports.getPropertyInvestmentComps = getPropertyInvestmentComps;',
    { assetClassesIn, assetIsCentralLondon, assetIsLondon, assetProfile, useDetailsIn });
  const comp = (id, property_name, subtype, city, address, postal_code, price) => ({ id, property_name, transaction_type: 'Retail', subtype, city, address, postal_code, price, transaction_date: '2025-10-01', status: 'Sold' });
  const comps = [
    comp('cantium', 'Cantium Retail Park', 'Centers', 'London', '522 Old Kent Rd', 'SE1 5', 48.5e6),
    comp('standbrook', 'Standbrook House', 'Shops', 'London', '2-5 Old Bond St', 'W1S 4', 118e6),
    comp('kensington', '129 Kensington High St', 'Shops', 'London', '129 Kensington High St', 'W8 6', 22e6),
    comp('monks', 'Monks Cross shopping park', 'Centers', 'York', 'Monks Cross Dr', 'YO32 9', 70e6),
  ];
  const pool = { query: async sql => ({ rows:
    /FROM crm_properties WHERE id/.test(sql) ? [{ id: 'rex', name: 'Royal Exchange', address: '{"street":"The Royal Exchange, Bank","city":"London"}', postcode: 'EC3V 3LR', asset_class: 'Retail', tags: 'luxury retail, gifting, jewellery, watches, City of London, Bank, arcade retail, F&B' }]
    : /FROM investment_tracker/.test(sql) ? [{ guide_price: 60e6 }]
    : /WHERE property_id = \$1 OR/.test(sql) ? [] : comps }) };
  const r = await getPropertyInvestmentComps('rex', { pool });
  assert.deepEqual(r.property.classes, ['retail'], 'tenant-mix tags do not make the building leisure');
  assert.ok(r.property.uses.includes('high street'));
  assert.deepEqual(r.similar.map(c => c.id), ['standbrook', 'kensington', 'cantium', 'monks']);
  assert.ok(r.similar[0].reasons.includes('central London'));
  assert.ok(r.similar.find(c => c.id === 'cantium').reasons.includes('London'), 'Old Kent Road is London — labelled as such, just ranked lower');
});

test('central London is the City, West End and SW1 — not every London postcode', () => {
  for (const a of ['EC3V 3LR', 'W1S 4', 'WC2E 9', 'SW1X 7', 'The Royal Exchange, City of London']) assert.equal(assetIsCentralLondon(a), true, a);
  for (const a of ['SE1 5', 'W8 6', 'W10 5', 'SW10 0', 'Sevenoaks TN13 1']) assert.equal(assetIsCentralLondon(a), false, a);
});
