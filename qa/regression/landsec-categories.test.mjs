// The categories of Landsec's H&L agency brief (October 2026) and the map
// from a brand's company type to one (Woody, 2026-11-16: "go ahead with the
// catagories"). shared/landsec.ts holds the map; shared/tenant-categories.ts
// and client/src/lib/crm-options.ts hold the types a person can pick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LANDSEC_CATEGORIES, LANDSEC_BRIEF_CATEGORIES, LANDSEC_CATEGORY_TYPES,
  landsecCategoryOf, landsecCategoryLabel,
} from '../../shared/landsec.ts';
import { TENANT_CATEGORIES, CLIENT_CRM_CATEGORIES } from '../../shared/tenant-categories.ts';

test('every type a person can pick sorts into a category; only the bare leisure type is left over', () => {
  const unsorted = TENANT_CATEGORIES.filter(type => landsecCategoryOf(type) === 'other');
  assert.deepEqual(unsorted, ['Tenant - Leisure']);
  for (const type of TENANT_CATEGORIES) assert.notEqual(landsecCategoryOf(type), null, type);
});

test('each of the brief categories has a type a person can pick', () => {
  for (const c of LANDSEC_CATEGORIES) {
    assert.ok(TENANT_CATEGORIES.some(type => landsecCategoryOf(type) === c.key), `no pickable type for ${c.label}`);
  }
});

test('the new types land in the brief categories they were made for', () => {
  const cases = {
    'Tenant - Food Hall': 'food_halls',
    'Tenant - Competitive Socialising': 'competitive_socialising',
    'Tenant - Active Leisure': 'active_leisure',
    'Tenant - Soft Play': 'gyms_wellness_softplay',
    'Tenant - Theme & Water Park': 'major_leisure',
    'Tenant - Quick Service': 'cafe_qsr',
    'Tenant - Bakery': 'cafe_qsr',
    'Tenant - Casual Dining': 'restaurants_bars',
    'Tenant - Bar': 'restaurants_bars',
    'Tenant - Gaming': 'competitive_socialising',
    'Tenant - Family Entertainment': 'gyms_wellness_softplay',
    'Tenant - Cinema': 'cinema',
    'Tenant - Immersive Experience': 'immersive',
    'Tenant - Experiential': 'immersive',
    'Tenant - Fashion': 'retail',
    'Tenant - Grocery': 'retail',
  };
  for (const [type, key] of Object.entries(cases)) assert.equal(landsecCategoryOf(type), key, type);
});

test('a company that is not a tenant brand has no category; a tenant that names none is "other"', () => {
  for (const type of ['Landlord', 'Agent', 'Lender', 'Billing Entity', '', null, undefined]) assert.equal(landsecCategoryOf(type), null, String(type));
  assert.equal(landsecCategoryOf('Tenant'), 'other');
  assert.equal(landsecCategoryOf('Tenant - Hotel'), 'other');
  assert.equal(landsecCategoryOf('  tenant - quick service '), 'cafe_qsr', 'case and spaces do not matter');
});

test('a type the lists do not hold is read by its words', () => {
  assert.equal(landsecCategoryOf('Tenant - Padel Club'), 'active_leisure');
  assert.equal(landsecCategoryOf('Tenant - Bowling Alley'), 'competitive_socialising');
  assert.equal(landsecCategoryOf('Tenant - Coffee Shop'), 'cafe_qsr');
  assert.equal(landsecCategoryOf('Tenant - Street Food Market Hall'), 'food_halls');
  assert.equal(landsecCategoryOf('Tenant - Kids Play Centre'), 'gyms_wellness_softplay');
  assert.equal(landsecCategoryOf('Tenant - Toy Shop'), 'retail');
});

test('the type lists stay in step: the picker, the shared list and the Landsec slice', () => {
  const options = readFileSync(new URL('../../client/src/lib/crm-options.ts', import.meta.url), 'utf8');
  for (const type of TENANT_CATEGORIES) assert.ok(options.includes(`"${type}",`), `crm-options lacks ${type}`);
  // Every hospitality and leisure type is in the slice that reads as "hospitality, leisure or fitness".
  for (const type of TENANT_CATEGORIES) {
    const key = landsecCategoryOf(type);
    if (key && key !== 'retail') assert.ok(CLIENT_CRM_CATEGORIES.includes(type), `${type} is missing from CLIENT_CRM_CATEGORIES`);
  }
  // No type is in two categories.
  const seen = new Map();
  for (const [key, types] of Object.entries(LANDSEC_CATEGORY_TYPES)) for (const t of types) {
    assert.ok(!seen.has(t.toLowerCase()), `${t} is under ${seen.get(t.toLowerCase())} and ${key}`);
    seen.set(t.toLowerCase(), key);
  }
});

test('the agreed brief can name every category, and labels read back', () => {
  for (const c of LANDSEC_CATEGORIES) assert.ok(LANDSEC_BRIEF_CATEGORIES.includes(c.brief), c.brief);
  assert.equal(landsecCategoryLabel('cafe_qsr'), 'Café, Grab & Go and QSR');
  assert.equal(landsecCategoryLabel('other'), 'Other');
  assert.equal(landsecCategoryLabel(null), null);
});

test('a scheme counts its trading units by brief category, by the one occupancy rule', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { find, evaluate, ts } = require('./source-harness.cjs');
  const { unitOccupancy } = await import('../../shared/property-units.ts');
  const fn = name => find('server/landsec-home.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  // brand_id is the brand the unit feed gives the row: stored, else found by name (by_name).
  const rows = [
    { property_id: 'p1', status: 'Occupied', brand_id: 'b1', company_type: 'Tenant - Quick Service', by_name: false },
    { property_id: 'p1', status: 'Let', brand_id: 'b2', company_type: 'Tenant - Casual Dining', by_name: true },
    { property_id: 'p1', status: 'Vacant', brand_id: 'b3', company_type: 'Tenant - Gym', by_name: false },
    { property_id: 'p1', status: '', tenant_name: 'Old Shop', brand_id: null, company_type: null, by_name: false },
    { property_id: 'p2', status: 'Opportunity', passing_rent_pa: 50000, brand_id: 'b4', company_type: 'Landlord', by_name: false },
    { property_id: 'p2', status: 'Occupied', brand_id: 'b5', company_type: 'Tenant - Padel', by_name: false },
  ];
  let sql = '';
  const pool = { query: async (text) => { sql = text; return { rows }; } };
  const { categoryMixByProperty, sumCategoryMixes } = evaluate(`${fn('categoryMixByProperty')}\n${fn('sumCategoryMixes')}`, {
    pool, unitOccupancy, landsecCategoryOf, BRAND_KEYS_CTE: 'brand_keys AS (SELECT 1)', brandNameKeySql: (x) => `key(${x})`,
  });
  const mixes = await categoryMixByProperty(['p1', 'p2']);
  assert.deepEqual(JSON.parse(JSON.stringify(mixes.get('p1'))), { counts: { cafe_qsr: 1, restaurants_bars: 1 }, trading: 3, notLinked: 1, byName: 1 });
  // A brand whose type names no category is "other"; a rent on the row reads it as let.
  assert.deepEqual(JSON.parse(JSON.stringify(mixes.get('p2'))), { counts: { other: 1, active_leisure: 1 }, trading: 2, notLinked: 0, byName: 0 });
  assert.match(sql, /<> 'archived'/, 'an archived schedule row is history, not a trading unit');
  // The same brand as the property page's unit feed: the stored brand, else the one its name matches.
  assert.match(sql, /COALESCE\(tc_fk\.id, tc_soft\.id\) AS brand_id/);
  assert.match(sql, /LEFT JOIN brand_keys bk ON t\.tenant_company_id IS NULL/);
  const feed = readFileSync(new URL('../../server/property-units.ts', import.meta.url), 'utf8');
  assert.match(feed, /LEFT JOIN brand_keys bk ON t\.tenant_company_id IS NULL\s+AND bk\.norm_key = \$\{brandNameKeySql\("coalesce\(nullif\(btrim\(t\.trading_name\), ''\), t\.tenant_name, ''\)"\)\}/,
    'the unit feed still finds a brand by name this way; keep the two in step');
  assert.deepEqual(JSON.parse(JSON.stringify(sumCategoryMixes([mixes.get('p1'), mixes.get('p2'), undefined]))),
    { counts: { cafe_qsr: 1, restaurants_bars: 1, other: 1, active_leisure: 1 }, trading: 5, notLinked: 1, byName: 1 });
  assert.equal((await categoryMixByProperty([])).size, 0);
});
