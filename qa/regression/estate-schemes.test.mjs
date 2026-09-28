// Estate schemes + "unit names don't make properties" (Canary Wharf,
// 2026-09-28). Pure helpers, the create-path resolver on a fake pool, and
// the scheme deal defaults / field validation.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  schemeKey, findScheme, schemeInName, unitScheme, estateCoreName, parseUnitLikeName, matchEstate, unitRefKey, estateUnitName,
} from '../../shared/property-schemes.ts';
import { findEstateForUnitName, attachEstateUnit, resolveEstateUnit, estateUnitMessage } from '../../server/estate-units.ts';

process.env.DATABASE_URL ||= 'postgres://t:t@127.0.0.1:1/t';

const CW = '4bf8b656-1f82-4d11-9d98-1dcc7e52bcea';
const CW_NAME = 'Canary Wharf Estate, London E14, UK';
const SCHEMES = ['Jubilee Place', 'Cabot Place', 'Canada Place', 'Crossrail Place', 'One Canada Square', 'Wood Wharf', 'North Quay', 'Wharf Kitchen'].map(name => ({ name }));

test('scheme labels compare by name, with a unique short form', () => {
  assert.equal(schemeKey('The Jubilee-Place '), 'jubilee place');
  assert.equal(findScheme(SCHEMES, 'JUBILEE PLACE')?.name, 'Jubilee Place');
  assert.equal(findScheme(SCHEMES, 'Crossrail')?.name, 'Crossrail Place', 'short form of exactly one scheme');
  assert.equal(findScheme(SCHEMES, 'Canada')?.name, 'Canada Place', '"One Canada Square" does not start with Canada');
  assert.equal(findScheme(SCHEMES, 'Wharf')?.name, 'Wharf Kitchen', 'Wood Wharf ends in Wharf, it does not start with it');
  assert.equal(findScheme([...SCHEMES, { name: 'Canada Water' }], 'Canada'), undefined, 'two schemes share the short form: no guess');
  assert.equal(findScheme(SCHEMES, 'Ground'), undefined);
  assert.equal(findScheme(SCHEMES, ''), undefined);
});

test("a unit's scheme is its label, else the scheme its own name mentions", () => {
  assert.equal(schemeInName(SCHEMES, 'Unit 4 Cabot Place')?.name, 'Cabot Place');
  assert.equal(schemeInName(SCHEMES, 'Unit 2 One Canada Square')?.name, 'One Canada Square', 'longest mention wins');
  assert.equal(schemeInName(SCHEMES, 'CR40'), undefined);
  assert.equal(unitScheme(SCHEMES, 'Crossrail Place', 'CR40')?.name, 'Crossrail Place');
  assert.equal(unitScheme(SCHEMES, null, 'Kiosk 3 Wharf Kitchen')?.name, 'Wharf Kitchen');
  assert.equal(unitScheme(SCHEMES, 'Ground', 'Unit 9'), undefined);
});

test('estate short names drop the address and generic suffixes', () => {
  assert.equal(estateCoreName(CW_NAME), 'Canary Wharf');
  assert.equal(estateCoreName('Bluewater Shopping Centre'), 'Bluewater');
  assert.equal(estateCoreName('The Royal Exchange'), 'Royal Exchange');
  assert.equal(estateCoreName('Estate'), 'Estate', 'never empties a name');
});

test('unit-like names split into the unit and the rest; ordinary names do not', () => {
  assert.deepEqual(parseUnitLikeName('Unit 48 Jubilee Place'), { kind: 'Unit', ref: '48', label: 'Unit 48', rest: 'Jubilee Place' });
  assert.deepEqual(parseUnitLikeName('Unit RS315 Canary Wharf'), { kind: 'Unit', ref: 'RS315', label: 'Unit RS315', rest: 'Canary Wharf' });
  assert.deepEqual(parseUnitLikeName('Kiosk 3 Wharf Kitchen'), { kind: 'Kiosk', ref: '3', label: 'Kiosk 3', rest: 'Wharf Kitchen' });
  assert.equal(parseUnitLikeName('Units 29/30, Jubilee Place')?.label, 'Units 29/30');
  assert.equal(parseUnitLikeName('Shop 4a at Cabot Place')?.rest, 'Cabot Place');
  assert.equal(parseUnitLikeName('Suite 3 and 4 Tower House')?.ref, '3 & 4');
  for (const name of ['Jubilee Place', 'Unit Street Market', '10 Grosvenor Street', 'Unit 5', 'Unit 5 X', 'Uniqlo Regent Street', '']) {
    assert.equal(parseUnitLikeName(name), null, name);
  }
});

const candidates = [
  { propertyId: CW, propertyName: CW_NAME, aliases: ['Canary Wharf'], schemes: SCHEMES },
  { propertyId: 'bw', propertyName: 'Bluewater Shopping Centre', aliases: null, schemes: [] },
  { propertyId: 'dup', propertyName: 'Unit 4 Cabot Place', aliases: null, schemes: [] },
];

test('the rest of the name finds the estate by name, short name, alias or scheme', () => {
  assert.deepEqual(matchEstate(parseUnitLikeName('Unit 48 Jubilee Place'), candidates), { propertyId: CW, propertyName: CW_NAME, scheme: 'Jubilee Place' });
  assert.deepEqual(matchEstate(parseUnitLikeName('Unit RS315 Canary Wharf'), candidates), { propertyId: CW, propertyName: CW_NAME, scheme: null });
  assert.deepEqual(matchEstate(parseUnitLikeName('Kiosk 3 Wharf Kitchen'), candidates), { propertyId: CW, propertyName: CW_NAME, scheme: 'Wharf Kitchen' });
  assert.equal(matchEstate(parseUnitLikeName('Unit 48, Jubilee Place, London E14'), candidates)?.scheme, 'Jubilee Place', 'first comma part');
  assert.equal(matchEstate(parseUnitLikeName('Unit 12 Bluewater'), candidates)?.propertyId, 'bw');
  assert.equal(matchEstate(parseUnitLikeName('Unit 4 Cabot Place'), [candidates[2]]), null, 'a unit-named record is never the estate');
  assert.equal(matchEstate(parseUnitLikeName('Unit 1 Somewhere Else'), candidates), null);
  // Two estates both claiming the name: no guess.
  const twin = [...candidates, { propertyId: 'other', propertyName: 'Jubilee Place', schemes: [] }];
  assert.equal(matchEstate(parseUnitLikeName('Unit 48 Jubilee Place'), twin), null);
});

test('unit references compare across naming styles; estate names carry the scheme', () => {
  assert.equal(unitRefKey('Unit 4 Cabot Place'), unitRefKey('Cabot Place Unit 04'));
  assert.equal(unitRefKey('Unit 1 Building J3'), unitRefKey('Building J3 Unit 1'));
  assert.notEqual(unitRefKey('Unit 4 Cabot Place'), unitRefKey('Unit 4 Canada Place'));
  assert.equal(unitRefKey('Unit R:S:315 Cabot Place'), unitRefKey('Unit RS315 Cabot Place'));
  assert.equal(unitRefKey('Cabot Place Unit RS 155'), unitRefKey('Unit RS155 Cabot Place'));
  assert.notEqual(unitRefKey('Kiosk 3 Wharf Kitchen'), unitRefKey('Kiosk3 Wharf Kitchen'), 'a word is not a ref prefix');
  assert.equal(estateUnitName('Unit 48', 'Jubilee Place'), 'Unit 48 Jubilee Place');
  assert.equal(estateUnitName('Jubilee Place Unit 48', 'Jubilee Place'), 'Jubilee Place Unit 48');
  assert.equal(estateUnitName('Unit RS315', null), 'Unit RS315');
});

function fakePool({ tenancy = [] } = {}) {
  const queries = [];
  const rows = tenancy.map(r => ({ ...r }));
  return {
    queries, rows,
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/FROM crm_properties WHERE name ILIKE/.test(sql)) {
        const like = String(params[0]).replace(/%/g, '').toLowerCase();
        return { rows: [{ id: CW, name: CW_NAME, aliases: ['Canary Wharf'] }, { id: 'bw', name: 'Bluewater Shopping Centre', aliases: null }].filter(p => p.name.toLowerCase().includes(like) || JSON.stringify(p.aliases || '').toLowerCase().includes(like)) };
      }
      if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
      if (/FROM property_schemes s JOIN crm_properties/.test(sql)) return { rows: SCHEMES.map(s => ({ property_id: CW, name: s.name, property_name: CW_NAME, aliases: ['Canary Wharf'] })) };
      if (/FROM tenancy_schedule_units WHERE property_id/.test(sql)) return { rows: rows.filter(r => r.property_id === params[0]) };
      if (/INSERT INTO tenancy_schedule_units/.test(sql)) {
        const row = { id: `new-${rows.length + 1}`, property_id: params[0], unit_number: params[1], grouping: params[2] };
        rows.push(row);
        return { rows: [{ id: row.id }] };
      }
      throw new Error(`unexpected query ${sql}`);
    },
  };
}

test('create paths: an existing unit on the estate is found, never duplicated', async () => {
  const pool = fakePool({ tenancy: [{ id: 't4', property_id: CW, unit_number: 'Unit 4 Cabot Place', premises: null, grouping: null }] });
  const unit = await resolveEstateUnit(pool, 'Unit 04 Cabot Place');
  assert.deepEqual(unit, { propertyId: CW, propertyName: CW_NAME, scheme: 'Cabot Place', unitId: 't4', unitName: 'Unit 4 Cabot Place', created: false });
  assert.equal(pool.queries.some(q => /INSERT/.test(q.sql)), false);
  assert.match(estateUnitMessage(unit), /already on/);
});

test('create paths: a new unit is added to the estate schedule with its scheme and no status', async () => {
  const pool = fakePool();
  const unit = await resolveEstateUnit(pool, 'Unit 48 Jubilee Place');
  assert.equal(unit.created, true);
  assert.equal(unit.unitName, 'Unit 48 Jubilee Place');
  const insert = pool.queries.find(q => /INSERT INTO tenancy_schedule_units/.test(q.sql));
  assert.deepEqual(insert.params, [CW, 'Unit 48 Jubilee Place', 'Jubilee Place']);
  assert.doesNotMatch(insert.sql, /status/);
  const rs = await resolveEstateUnit(fakePool(), 'Unit RS315 Canary Wharf');
  assert.equal(rs.unitName, 'Unit RS315');
  assert.equal(rs.scheme, null);
});

test('create paths: ordinary names and unmatched estates fall through to a normal create', async () => {
  const pool = fakePool();
  assert.equal(await resolveEstateUnit(pool, '10 Grosvenor Street'), null);
  assert.equal(pool.queries.length, 0, 'an ordinary name costs no lookup');
  assert.equal(await findEstateForUnitName(fakePool(), 'Unit 9 Nowhere Park'), null);
  const broken = { query: async () => { throw new Error('db down'); } };
  assert.equal(await resolveEstateUnit(broken, 'Unit 48 Jubilee Place'), null, 'a failed lookup never blocks the create');
});

test('a unit ref repeated across schemes matches only within its scheme', async () => {
  const pool = fakePool({ tenancy: [
    { id: 'jp1', property_id: CW, unit_number: 'Unit 1', premises: null, grouping: 'Jubilee Place' },
    { id: 'cp1', property_id: CW, unit_number: 'Unit 1', premises: null, grouping: 'Cabot Place' },
  ] });
  const match = await findEstateForUnitName(pool, 'Unit 1 Cabot Place');
  const unit = await attachEstateUnit(pool, match, 'Unit 1 Cabot Place');
  assert.equal(unit.unitId, 'cp1');
});

test('scheme deal defaults fill only what the deal left blank', async () => {
  const { schemeDealDefaults, schemeFields } = await import('../../server/property-schemes.ts');
  const db = {
    query: async (sql, params = []) => {
      if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
      if (/FROM property_schemes WHERE property_id/.test(sql)) return { rows: [
        { id: 's1', property_id: CW, name: 'Jubilee Place', billing_entity_id: 'cwr', invoicing_email: 'invoices@cwg.com', sort_order: 1 },
        { id: 's2', property_id: CW, name: 'Crossrail Place', billing_entity_id: 'rt5', invoicing_email: null, sort_order: 2 },
      ] };
      if (/SELECT grouping FROM tenancy_schedule_units/.test(sql)) return { rows: [{ grouping: 'Crossrail' }] };
      if (/SELECT name FROM crm_companies/.test(sql)) return { rows: [{ name: params[0] === 'cwr' ? 'Canary Wharf Retail Limited' : 'Canary Wharf Properties (RT5) Limited' }] };
      throw new Error(`unexpected ${sql}`);
    },
  };
  assert.deepEqual(await schemeDealDefaults(db, { propertyId: CW, scheme: 'jubilee place' }), { scheme: 'Jubilee Place', xeroContactName: 'Canary Wharf Retail Limited', invoicingEmail: 'invoices@cwg.com' });
  assert.deepEqual(await schemeDealDefaults(db, { propertyId: CW, scheme: 'Jubilee Place', xeroContactId: 'x', invoicingEmail: 'me@x.com' }), { scheme: 'Jubilee Place' });
  assert.deepEqual(await schemeDealDefaults(db, { propertyId: CW, tenancyUnitId: 't1' }), { scheme: 'Crossrail Place', xeroContactName: 'Canary Wharf Properties (RT5) Limited' }, 'from the unit grouping');
  assert.deepEqual(await schemeDealDefaults(db, { propertyId: CW, scheme: 'Mars' }), {});
  assert.deepEqual(await schemeDealDefaults(db, { propertyId: null, scheme: 'Jubilee Place' }), {});

  assert.deepEqual(schemeFields({ name: '  Jubilee   Place ', invoicingEmail: '', code: '294' }, { requireName: true }), { name: 'Jubilee Place', code: '294', invoicing_email: null });
  assert.throws(() => schemeFields({}, { requireName: true }), e => e.status === 400);
  assert.throws(() => schemeFields({ invoicingEmail: 'not an email' }, { requireName: false }), e => e.status === 400);
  assert.throws(() => schemeFields({ sharepointFolderUrl: 'https://evil.example.com/x' }, { requireName: false }), e => e.status === 400);
});

test('renaming a scheme relabels every board on the property', async () => {
  const { relabelScheme } = await import('../../server/property-schemes.ts');
  const updates = [];
  const db = { query: async (sql, params) => { updates.push({ sql, params }); return { rows: [], rowCount: 2 }; } };
  assert.equal(await relabelScheme(db, CW, 'Crossrail', 'Crossrail Place'), 8);
  assert.deepEqual(updates.map(u => u.sql.match(/UPDATE (\w+) SET (\w+)/).slice(1).join('.')), ['tenancy_schedule_units.grouping', 'leasing_schedule_units.zone', 'available_units.scheme', 'crm_deals.scheme']);
  for (const u of updates) assert.deepEqual(u.params, [CW, 'crossrail', 'Crossrail Place']);
});
