import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL ||= 'postgres://test@127.0.0.1:1/test';
const { UK_CENTRES, TOP_25_CENTRES, centreAt } = await import('../../shared/uk-centres.ts');
const { isOpeningHeadline, brandNamed } = await import('../../server/centre-openings.ts');

test('benchmark set is the top 25 plus Battersea and the Shaftesbury Capital estates', () => {
  assert.equal(TOP_25_CENTRES.length, 29);
  for (const name of ['Bluewater', 'Trafford Centre', 'Battersea Power Station', 'Covent Garden', 'Carnaby', 'Chinatown London']) {
    assert.ok(TOP_25_CENTRES.some(c => c.name === name), name);
  }
  assert.equal(new Set(UK_CENTRES.map(c => c.name)).size, UK_CENTRES.length);
});

test('a property on a centre resolves to it; West End estates keep their own tight radius', () => {
  assert.equal(centreAt(51.4392, 0.271)?.name, 'Bluewater');
  assert.equal(centreAt(51.5129, -0.1387)?.name, 'Carnaby');
  assert.equal(centreAt(51.5117, -0.1233)?.name, 'Covent Garden');
  assert.equal(centreAt(51.52, -0.1)?.name ?? null, null);
});

test('opening headlines are kept; closures and property-market stories are not', () => {
  assert.ok(isOpeningHeadline('Danish fashion retailer Jack & Jones signs at Bluewater shopping centre'));
  assert.ok(isOpeningHeadline('Footasylum to open Trinity Leeds store'));
  assert.ok(isOpeningHeadline('Blue Note London Opens — New York’s Legendary Jazz Club Arrives In Covent Garden'));
  assert.ok(!isOpeningHeadline('Clearbell launches £80m Covent Garden office sale'));
  assert.ok(!isOpeningHeadline('Store at Bluewater to close next month'));
  assert.ok(!isOpeningHeadline('Covent Garden restaurant launches bottomless pasta brunch'));
});

test('brand names link whole-word, longest first, single words case-sensitive', () => {
  const list = [
    { id: '2', name: 'Five Guys', re: /(^|[^A-Za-z0-9])Five Guys('s)?([^A-Za-z0-9]|$)/i },
    { id: '1', name: 'Moida', re: /(^|[^A-Za-z0-9])Moida('s)?([^A-Za-z0-9]|$)/ },
  ];
  assert.equal(brandNamed('Moida opens at Trinity Leeds', list)?.id, '1');
  assert.equal(brandNamed('five guys to open at Bluewater', list)?.id, '2');
  assert.equal(brandNamed('Moidas opens', list), null);
});

test('target-tenant engine: evidenced candidates exclude brands trading here and rank a fitting requirement first', async () => {
  const { unitCandidates } = await import('../../server/target-tenant-engine.ts');
  const brand = (name, companyId, extra = {}) => ({ key: companyId || `name:${name.toLowerCase()}`, companyId, name, category: 'Tenant - Restaurant', stores: 20, rollout: null, signals: [], requirements: [], bgpClient: false, ...extra });
  const brands = new Map([
    ['a', brand('Wingstop', 'a', { requirements: [{ size: '1,500-2,500', use: ['Restaurant'], requirement_locations: ['Kent'], created_at: null }], signals: [{ text: 'BGP in conversation: 4 emails in 90 days', weight: 8 }] })],
    ['b', brand("Nando's", 'b', { signals: [{ text: 'at 12 of the top UK centres, not here', weight: 20 }] })],
    ['c', brand('Five Guys', 'c', { signals: [{ text: 'trades at Lakeside (competing centre), not here', weight: 20 }] })],
    ['d', brand('Screwfix', 'd', { category: 'Tenant - Retail', signals: [{ text: 'BGP in conversation', weight: 8 }] })],
  ]);
  const ev = { propertyId: 'p', property: { name: 'Bluewater', postcode: 'DA9 9ST', address: 'Greenhithe, Kent' }, client: false, mix: [],
    hereKeys: new Set(['nandos']), hereIds: new Set(), brands, context: '' };
  const out = unitCandidates(ev, { id: 'u', unit_name: 'SVL09', sqft: 2000, positioning: 'Quick Refuel' });
  assert.deepEqual(out.map(c => c.name), ['Wingstop', 'Five Guys']);
  assert.match(out[0].evidence[0], /live requirement that fits this unit/);
  const withTracker = unitCandidates(ev, { id: 'u', unit_name: 'SVL09', sqft: 2000, positioning: 'Quick Refuel', target_brands: '1. Five Guys\n2. Dishoom' });
  assert.ok(withTracker.find(c => c.name === 'Dishoom')?.evidence[0].includes("landlord's leasing tracker"));
  assert.ok(withTracker.find(c => c.name === 'Five Guys').evidence[0].includes("landlord's leasing tracker"));
});

test('storage and other ancillary space gets no target tenants', async () => {
  const { isAncillaryUnit } = await import('../../server/target-tenant-engine.ts');
  for (const n of ['KL10 & STOL8 Storage', 'BWREST Portakabin Bluewater', 'ATM 3', 'Car Park Level 2', 'Plant room']) assert.ok(isAncillaryUnit({ unit_name: n }), n);
  for (const n of ['L022 Bluewater', 'T12 Thames Walk Bluewater', 'The Blue Lagoon', 'KL04 Bluewater', 'Spotlight 3 Bluewater']) assert.ok(!isAncillaryUnit({ unit_name: n }), n);
});

test('duplicate schedule rows for one physical unit share a plan key', async () => {
  const { physicalUnitKey } = await import('../../server/target-tenant-engine.ts');
  const k = (unit_name, sqft) => physicalUnitKey({ id: 'x', unit_name, sqft }, 'Bluewater');
  assert.equal(k('U062 Bluewater - Upper Level', 1408), k('U062 Bluewater - Upper Level', 1408));
  assert.equal(k('The Blue Lagoon Bluewater - Lower Level', 1076), k('The Blue Lagoon', 1076));
  assert.equal(k('WVL15 & External Seating Area Bluewater - Lower Level', 3708), k('WVL15 & External Seating Area', 3708));
  assert.notEqual(k('U124 Bluewater', 4803), k('U124/U125/U126 Bluewater', 9307));
  assert.notEqual(k('U062 Bluewater - Upper Level', 1408), k('U062/U063 Bluewater', 2706));
});

test('legal entity names reduce to the brand key the trading-name finder matches on', async () => {
  const { legalKey } = await import('../../server/trading-names.ts');
  assert.equal(legalKey('Hotel Chocolat Stores Limited'), 'hotel chocolat');
  assert.equal(legalKey('Krispy Kreme U.K. Limited'), 'krispy kreme');
  assert.equal(legalKey('Pho Trading Limited'), 'pho');
  assert.equal(legalKey('HWS Restaurants Limited (in Administration)'), 'hws');
  assert.equal(legalKey('Caffè Nero Group Holdings Ltd'), 'caffe nero');
  assert.equal(legalKey('Five Guys'), 'five guys');
});

test('trading names drop the legal suffix a CRM brand row may carry', async () => {
  const { displayTradingName } = await import('../../server/trading-names.ts');
  assert.equal(displayTradingName('Pizza Hut UK Ltd'), 'Pizza Hut');
  assert.equal(displayTradingName('Marks & Spencer Plc'), 'Marks & Spencer');
  assert.equal(displayTradingName('Côte'), 'Côte');
  assert.equal(displayTradingName('The Ivy Collection'), 'The Ivy Collection');
});
