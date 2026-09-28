// Landlord leasing-minutes importer (CWG "Retail Leasing Minutes", 2026-09-28).
// The fixture copies the real workbook's shape: one tab per week (older weeks
// hidden), one sheet split by section rows, Yardi codes inside the Property
// cell, "As per above" offers, a stale repeat of a unit lower down, Wood
// Wharf's building sub-headings.
import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';
import {
  pickMinutesSheet, sectionScheme, splitUnitCell, unitPrefix, tidyUnitLabel, statusFromMinutes,
  parseLeasingMinutes, planMinutesImport, importLeasingMinutes,
} from '../../server/leasing-minutes.ts';
import { isLeasingMinutes, scheduleTier } from '../../server/sharepoint-property-files.ts';

process.env.DATABASE_URL ||= 'postgres://t:t@127.0.0.1:1/t';

const HEADER = [null, 'Property', ' Previous/Current Tenant', 'Unit Size\r\n(sqft)', '2026 ERVs & RF', 'Quoting Rents ', 'Business Rates \r\n26/27', 'Offers', 'Targets / Comments'];
const WEEK = [
  HEADER,
  [null, 'RETAIL LEASING MEETING - Live '],
  [null, 'Units to Let'],
  [null, 'Jubilee Place Voids'],
  [null, 'Jubilee Place\r\nFlagship', "Merge of Awak'n, IQOS", '7768', 'BP: £313,855\r\nRF: 12Months', 'TBC', 'TBC', 'Uniqlo - Exchanged\r\nTerm: 10 Years', 'UNIQLO – solicitors are instructed'],
  ['Jubilee Place \r\nUnit 1', 'Jubilee Place \r\nUnit 1\r\nYardi 29400001', "Vacant Former - Awak'n \r\nLeft: 17/02/2022", '4971', 'BP: £298,990', 'TBC ', 122892, 'As per above', 'As per above'],
  [null, 'Jubilee Place\r\nUnit 3\r\nYardi 29400003', 'Vacant- IQOS', '1,345', 'BP: £78,913', 85000, 53508, null, null],
  [null, 'Wharf Kitchen\r\nUnit Kiosk 1\r\nYardi 29400WK1', 'Vacant \r\nFormer Tenant: Argentinian Grill', '494', 'BP26: £55,000', 55000, 'TBC ', 'Maestro Asador \r\nRent : £55kp.a./10%', 'Crunch - met for general tour'],
  [null, 'Jubilee Place Opportunities (Upcoming Lease Events)'],
  [null, 'Jubilee Place \r\nUnit 58\r\nYardi 29400058', 'Rituals\r\nLEX: 31/12/2026', '798', 'BP26: £67,750', 67500, 41170, 'Rituals - Offer to Renew\r\nTerm: A new 5-year term', 'Rituals are also looking to expand'],
  [null, 'Jubilee Place\r\nUnit 31\r\nYardi 29400031', 'LK Bennett Fashion \r\nLEX: 30/06/2028', '2408', 'BP2026: £120,000', 'TBC ', 81420, null, 'Suitsupply'],
  [null, 'Jubilee Place\r\nUnit 58\r\nYardi 29400058', 'Rituals\r\nLEX:30/06/2025', '798', 'Passing: £97,500', 'TBC ', 34671, 'Ongoing discussion', null],
  [null, 'Cabot Place Voids'],
  [null, 'Cabot Place\r\nUnit 4\r\nYardi 29200004', 'Vacant', '890', 'BP26: £90,000', 90000, 60720, 'Facegym (Under Offer)', 'Facegym - HOTs agreed, sols instructed'],
  [null, 'Cabot Place\r\nUnit 3\r\nYardi: 29200003', 'Vacant\r\nFormer Tenant: Tom Davies', '1186', 'BP26: £118,200', 165000, 83260, null, null],
  [null, 'Crossrail Voids'],
  [null, 'Crossrail\r\nUnit 40\r\nYardi 12000040', 'Vacant- Platform\r\nADMIN', '4719', 'BP26: £185,000', 200000, 41170, '\r\nEnmei - hots in circulation', 'Enmei - toured with CEO'],
  [null, 'Churchill Place Voids'],
  [null, 'Churchill Unit 15\r\nYardi: 32300015', 'Rocket\r\nLEX: 30/09/2029', '4132', 'Passing Rent: £165,700', 'TBC ', 109000, null, 'Potential Tenants: Flatiron'],
  [null, 'WOOD WHARF'],
  [null, '60 Charter Street (J3)'],
  [null, 'Building J3\r\nUnit 1 (South)', 'PC: June 2026', '1798', 'BP: £71,903', 85000, 'TBA', null, null],
];
const OLD_WEEK = [HEADER, [null, 'Cabot Place Voids'], [null, 'Cabot Place\r\nUnit 4\r\nYardi 29200004', 'Vacant', '890', 'BP: old', 90000, 1, 'Old offer', 'Old comment']];

function workbook({ latestHidden = false } = {}) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(OLD_WEEK), 'Units to let - Wc 15.12');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(OLD_WEEK), 'Units to let - Wc 05.01');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(WEEK), 'Units to let - Wc 12.01 ');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Brand', 'Notes']]), 'Pop Ups');
  wb.Workbook = { Sheets: [{ Hidden: 1 }, { Hidden: 0 }, { Hidden: latestHidden ? 1 : 0 }, { Hidden: 0 }] };
  return wb;
}
const bytes = (wb) => Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
const CW_SCHEMES = ['Jubilee Place', 'Cabot Place', 'Canada Place', 'Crossrail Place', 'One Canada Square', 'Wood Wharf', 'Wharf Kitchen'].map(name => ({ name }));

test('the latest visible weekly tab is picked, across the year end', () => {
  assert.deepEqual(pickMinutesSheet(workbook()), { name: 'Units to let - Wc 12.01 ', weekLabel: 'w/c 12.01', weeklySheets: 3 });
  assert.equal(pickMinutesSheet(workbook({ latestHidden: true })).name, 'Units to let - Wc 05.01', 'January beats a hidden week and an older December');
  assert.equal(pickMinutesSheet({ SheetNames: ['Pop Ups', 'Targets'] }), null);
});

test('section rows become schemes; sub-headings and meeting titles do not', () => {
  assert.deepEqual(sectionScheme('Jubilee Place Voids', []), { scheme: 'Jubilee Place', kind: 'scheme' });
  assert.deepEqual(sectionScheme('Cabot Place Opportunities (Upcoming Lease Events)', []), { scheme: 'Cabot Place', kind: 'scheme' });
  assert.deepEqual(sectionScheme('Crossrail Voids', CW_SCHEMES), { scheme: 'Crossrail Place', kind: 'scheme' }, 'short form maps onto the saved scheme');
  assert.deepEqual(sectionScheme('WOOD WHARF', []), { scheme: 'Wood Wharf', kind: 'scheme' });
  assert.deepEqual(sectionScheme('Additional/Street level unit Voids', []), { scheme: 'Additional/Street level', kind: 'scheme' });
  assert.equal(sectionScheme('60 Charter Street (J3)', CW_SCHEMES).kind, 'subheading');
  assert.equal(sectionScheme('RETAIL LEASING MEETING - Live ', []).kind, 'noise');
  assert.equal(sectionScheme('Units to Let', []).kind, 'noise');
});

test('the Property cell splits into the unit and its landlord codes', () => {
  assert.deepEqual(splitUnitCell('Jubilee Place \r\nUnit 1\r\nYardi 29400001'), { text: 'Jubilee Place Unit 1', codes: ['29400001'] });
  assert.deepEqual(splitUnitCell('10 Park Drive\r\nYardi: 22100010, 22101010'), { text: '10 Park Drive', codes: ['22100010', '22101010'] });
  assert.deepEqual(splitUnitCell('Canada Place \r\nUnit 27\r\n29300027'), { text: 'Canada Place Unit 27', codes: ['29300027'] });
  const aliases = new Map(CW_SCHEMES.map(s => [s.name.toLowerCase(), s.name]));
  assert.deepEqual(unitPrefix('Wharf Kitchen Unit Kiosk 1', aliases, CW_SCHEMES), { scheme: 'Wharf Kitchen', rest: 'Unit Kiosk 1' });
  assert.deepEqual(unitPrefix('Canada Place DS5 Link Kiosk 7', aliases, CW_SCHEMES), { scheme: 'Canada Place', rest: 'DS5 Link Kiosk 7' });
  assert.deepEqual(unitPrefix('Jubilee Unit 29/30 Combined', aliases, CW_SCHEMES), { scheme: 'Jubilee Place', rest: 'Unit 29/30 Combined' }, 'distinctive first word of one scheme');
  assert.equal(unitPrefix('Building G1 Unit 1', aliases, CW_SCHEMES).scheme, null);
  assert.equal(tidyUnitLabel('Unit Kiosk 1'), 'Kiosk 1');
  assert.equal(tidyUnitLabel('Kisok 3B'), 'Kiosk 3B');
});

test('status moves only on what the week says', () => {
  assert.equal(statusFromMinutes('Kung Fu Mama- Completed\nTerm: 15 years', null), 'Occupied');
  assert.equal(statusFromMinutes('Uniqlo - Exchanged', null), 'Under Offer');
  assert.equal(statusFromMinutes(null, 'Facegym - HOTs agreed, sols instructed'), 'Under Offer');
  assert.equal(statusFromMinutes('Rituals - Offer to Renew', null), 'In Negotiation');
  assert.equal(statusFromMinutes(null, 'Suitsupply'), null);
  assert.equal(statusFromMinutes(null, null), null);
});

test('the latest week parses into schemes and units', async () => {
  const p = await parseLeasingMinutes(bytes(workbook()), { knownSchemes: CW_SCHEMES });
  assert.equal(p.sheetName, 'Units to let - Wc 12.01');
  assert.deepEqual(p.schemes.map(s => [s.name, s.code]), [['Jubilee Place', '294'], ['Wharf Kitchen', null], ['Cabot Place', '292'], ['Crossrail Place', null], ['Churchill Place', null], ['Wood Wharf', null]]);
  const by = Object.fromEntries(p.units.map(u => [u.unitName, u]));
  assert.deepEqual(Object.keys(by), ['Flagship Jubilee Place', 'Unit 1 Jubilee Place', 'Unit 3 Jubilee Place', 'Kiosk 1 Wharf Kitchen', 'Unit 58 Jubilee Place', 'Unit 31 Jubilee Place', 'Unit 4 Cabot Place', 'Unit 3 Cabot Place', 'Unit 40 Crossrail Place', 'Unit 15 Churchill Place', 'Building J3 Unit 1 (South) Wood Wharf']);
  assert.equal(by['Unit 1 Jubilee Place'].status, 'Under Offer', '"As per above" follows the flagship letting');
  assert.equal(by['Unit 1 Jubilee Place'].tenant, null);
  assert.deepEqual(by['Unit 1 Jubilee Place'].unitCodes, ['29400001']);
  assert.equal(by['Unit 3 Jubilee Place'].status, 'Vacant');
  assert.equal(by['Unit 3 Jubilee Place'].sqft, 1345);
  assert.equal(by['Unit 58 Jubilee Place'].tenant, 'Rituals');
  assert.equal(by['Unit 58 Jubilee Place'].leaseExpiry, '2026-12-31', 'the first listing, not the stale repeat');
  assert.equal(by['Unit 58 Jubilee Place'].status, 'In Negotiation');
  assert.equal(by['Unit 31 Jubilee Place'].status, 'Lease Event', 'a tenant in the opportunities block with no letting news');
  assert.equal(by['Unit 4 Cabot Place'].status, 'Under Offer');
  assert.equal(by['Building J3 Unit 1 (South) Wood Wharf'].building, '60 Charter Street (J3)');
  assert.equal(by['Building J3 Unit 1 (South) Wood Wharf'].vacant, true, 'a practical-completion date is no tenant');
  assert.match(by['Unit 3 Jubilee Place'].financials, /Business Rates 26\/27: £53,508/);
  assert.ok(p.warnings.some(w => /Unit 58 Jubilee Place is listed again/.test(w)));
});

const row = (id, unit_name, extra = {}) => ({ id, unit_name, zone: null, unit_code: null, tenant_name: null, sqft: null, status: 'Occupied', updates: null, financial_notes: null, lease_expiry: null, lease_break: null, ...extra });

test('matching: landlord code, then name, then a bare label only when unique', async () => {
  const p = await parseLeasingMinutes(bytes(workbook()), { knownSchemes: CW_SCHEMES });
  const existing = [
    row('code', 'Old name for JP1', { unit_code: '29400001' }),
    row('name', 'Unit 4 Cabot Place', { status: 'Vacant', sqft: 900 }),
    row('j3', 'Unit 1 Building J3'),
    row('bare3', 'Unit 3'),
  ];
  const { rows } = planMinutesImport(p, existing);
  const by = Object.fromEntries(rows.map(r => [r.unitId || r.unitName, r]));
  assert.equal(by.code.action, 'update');
  assert.equal(by.name.action, 'update');
  const fields = Object.fromEntries(by.name.changes.map(c => [c.field, c.to]));
  assert.equal(fields.zone, 'Cabot Place');
  assert.equal(fields.unit_code, '29200004');
  assert.equal(fields.status, 'Under Offer');
  assert.equal('sqft' in fields, false, 'a recorded area is kept');
  assert.match(fields.updates, /^Minutes w\/c 12\.01\nOffers: Facegym/);
  assert.equal(by.j3.action, 'update', 'Building J3 Unit 1 (South) finds Unit 1 Building J3');
  assert.equal(rows.some(r => r.unitId === 'bare3'), false, '"Unit 3" is in two schemes — never guessed');
  assert.equal(rows.filter(r => r.action === 'create').length, 8);
  // Re-importing the same week changes nothing.
  const applied = existing.map(e => {
    const r = rows.find(x => x.unitId === e.id);
    return r ? { ...e, ...Object.fromEntries(r.changes.map(c => [c.field, c.to])) } : e;
  });
  const again = planMinutesImport(p, applied).rows.filter(r => r.unitId);
  assert.deepEqual(again.map(r => r.action), ['unchanged', 'unchanged', 'unchanged']);
});

function fakePool() {
  const queries = [];
  const q = async (sql, params = []) => {
    queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/FROM crm_properties WHERE id/.test(sql)) return { rows: [{ id: 'cw', name: 'Canary Wharf Estate' }] };
    if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
    if (/FROM property_schemes WHERE property_id/.test(sql)) return { rows: [{ id: 's1', property_id: 'cw', name: 'Cabot Place', code: null, sort_order: 1 }] };
    if (/FROM leasing_schedule_units WHERE property_id/.test(sql)) return { rows: [row('name', 'Unit 4 Cabot Place')] };
    if (/max\(sort_order\)/.test(sql)) return { rows: [{ next: 2, n: 5 }] };
    if (/INSERT INTO property_schemes/.test(sql)) return { rows: [{ id: `s-${params[1]}`, name: params[1], code: params[2] }] };
    if (/INSERT INTO leasing_schedule_units/.test(sql)) return { rows: [{ id: `new-${params[1]}` }] };
    return { rows: [], rowCount: 1 };
  };
  const client = { query: q, release: () => { queries.push({ sql: 'RELEASE' }); } };
  return { queries, query: q, connect: async () => client };
}

test('preview writes nothing; apply writes in one transaction with an audit trail', async () => {
  const buf = bytes(workbook());
  const dry = fakePool();
  const preview = await importLeasingMinutes(dry, 'cw', buf, { dryRun: true, user: { id: 'u1', username: 'woody' }, fileName: 'Retail Leasing Minutes Canary Wharf – 22.04.2026.xlsx' });
  assert.equal(preview.dryRun, true);
  assert.equal(dry.queries.some(x => /^(INSERT|UPDATE|BEGIN)/.test(x.sql)), false);
  assert.deepEqual(preview.counts, { create: 10, update: 1, unchanged: 0, statusChanges: 1 });
  assert.equal(preview.schemes.find(s => s.name === 'Cabot Place').exists, true);
  assert.equal(preview.schemes.find(s => s.name === 'Jubilee Place').exists, false);
  assert.match(preview.message, /10 new units · 1 updated · 0 unchanged · 4 new schemes/);

  const live = fakePool();
  const done = await importLeasingMinutes(live, 'cw', buf, { dryRun: false, user: { id: 'u1', username: 'woody' }, fileName: 'minutes.xlsx' });
  assert.equal(done.dryRun, false);
  const sqls = live.queries.map(x => x.sql);
  const begin = sqls.indexOf('BEGIN'), commit = sqls.indexOf('COMMIT');
  assert.ok(begin >= 0 && commit > begin, 'one transaction');
  const inTx = live.queries.slice(begin, commit);
  assert.equal(inTx.filter(x => /^INSERT INTO property_schemes/.test(x.sql)).length, 4, 'only the new schemes are added');
  assert.equal(inTx.filter(x => /^INSERT INTO leasing_schedule_units/.test(x.sql)).length, 10);
  const upd = inTx.find(x => /^UPDATE leasing_schedule_units SET/.test(x.sql));
  assert.match(upd.sql, /zone = \$2/);
  assert.equal(upd.params[0], 'name');
  assert.ok(inTx.some(x => /INSERT INTO leasing_schedule_audit/.test(x.sql) && x.params[4] === 'minutes_update' && x.params[5] === 'status'));
  assert.ok(sqls.includes('RELEASE'));
});

test('SharePoint picker marks a minutes workbook and ranks it with schedules', () => {
  assert.equal(isLeasingMinutes('Retail Leasing Minutes Canary Wharf – 22.04.2026.xlsx'), true);
  assert.equal(isLeasingMinutes('Minutes of letting meeting.xlsm'), true);
  assert.equal(isLeasingMinutes('Board minutes.xlsx'), false);
  assert.equal(isLeasingMinutes('Retail Leasing Minutes.pdf'), false);
  assert.equal(scheduleTier('Retail Leasing Minutes Canary Wharf – 22.04.2026.xlsx', ''), 2);
});
