import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
process.env.DATABASE_URL ||= 'postgres://test@127.0.0.1:1/test';
const positioningModule = await import('../../shared/scheme-positioning.ts');
const { brandTier, isHotelGroup, fitsPositioning, positioningFromTags, positioningFromTenants, exactPositioningTag, withPositioningTag } = positioningModule;
const centres = await import('../../shared/uk-centres.ts');
const { UK_CENTRES, TOP_25_CENTRES, peerCentresFor, benchmarkCentresFor, centreAt } = centres;
const { propertyResearchContext } = await import('../../shared/property-research.ts');
const { isClientCrmCategory } = await import('../../shared/tenant-categories.ts');
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');

// Descriptions as the CRM holds them (Sep 2026).
const BRANDS = {
  kfc: { name: 'KFC', companyType: 'Tenant - Restaurant', description: 'Global fried chicken QSR chain. 1,000+ UK restaurants.' },
  popeyes: { name: 'Popeyes', companyType: 'Tenant - Restaurant', description: 'Louisiana-inspired fried chicken chain. ~40 UK restaurants and accelerating.' },
  tacoBell: { name: 'Taco Bell', companyType: 'Tenant - Restaurant', industry: 'QSR restaurant', description: 'American-Mexican fast-food chain.' },
  burgerKing: { name: 'Burger King', companyType: 'Tenant - Restaurant', description: 'Global QSR fast food chain. 500+ UK restaurants.' },
  fiveGuys: { name: 'Five Guys', companyType: 'Tenant - Restaurant', description: 'American premium burger chain. 150+ UK locations.' },
  krispyKreme: { name: 'Krispy Kreme', companyType: 'Tenant - Restaurant', description: 'Krispy Kreme is a global doughnut company and coffeehouse chain.' },
  costa: { name: 'Costa Coffee', companyType: 'Tenant - Restaurant', description: "UK's largest coffee chain. 2,800+ UK stores.", storeCount: 2800 },
  ihg: { name: 'IHG', companyType: 'Tenant - Leisure', description: 'IHG (InterContinental Hotels Group) is a global hospitality company operating over 900,000 rooms across nearly 6,000 hotels.' },
  travelodge: { name: 'Travelodge', companyType: 'Tenant - Leisure', industry: 'Budget hotels / hospitality', description: "UK's largest independent hotel brand." },
  rolex: { name: 'Rolex', companyType: 'Tenant - Retail', description: 'Swiss luxury watchmaker.' },
  goldsmiths: { name: 'Goldsmiths', companyType: 'Tenant - Retail', description: 'Goldsmiths is a UK luxury jewellery and watch retailer.' },
  joMalone: { name: 'Jo Malone', companyType: 'Tenant - Retail', description: 'Luxury fragrance and candle brand.' },
  laduree: { name: 'Laduree', companyType: 'Tenant - Retail', description: 'Ladurée is a luxury French patisserie and confectionery brand renowned for its macarons.' },
  primark: { name: 'Primark', companyType: 'Tenant - Fashion', description: 'Value fashion retailer with 190 UK stores.' },
  next: { name: 'Next', companyType: 'Tenant - Retail', description: 'High street fashion and homeware retailer.' },
  gaucho: { name: 'Gaucho', companyType: 'Tenant - Restaurant', description: 'Gaucho is a luxury Argentine steakhouse restaurant group.' },
  grind: { name: 'Grind', companyType: 'Tenant - Restaurant', description: 'Premium coffee, cocktail bar and restaurant chain.' },
  wagamama: { name: 'Wagamama', companyType: 'Tenant - Restaurant', industry: 'Casual dining restaurant', description: 'Pan-Asian casual dining chain. Targets 2,500-5,000 sq ft in prime high streets.' },
};
const facts = key => ({ ...BRANDS[key], tier: brandTier(BRANDS[key]), hotel: isHotelGroup(BRANDS[key]) });

test('brand tiers: quick-service and mass chains, luxury houses, premium dining', () => {
  for (const k of ['kfc', 'popeyes', 'tacoBell', 'burgerKing', 'fiveGuys', 'krispyKreme', 'costa']) assert.equal(brandTier(BRANDS[k]), 'mass', k);
  for (const k of ['rolex', 'goldsmiths', 'joMalone', 'laduree', 'gaucho']) assert.equal(brandTier(BRANDS[k]), 'luxury', k);
  assert.equal(brandTier(BRANDS.grind), 'premium');
  assert.equal(brandTier(BRANDS.wagamama), null);
  assert.equal(brandTier(BRANDS.primark), 'mass');
  assert.ok(isHotelGroup(BRANDS.ihg) && isHotelGroup(BRANDS.travelodge));
  assert.ok(!isHotelGroup(BRANDS.grind) && !isHotelGroup(BRANDS.gaucho));
});

test('a luxury scheme drops QSR, mass chains and hotel groups and adds luxury retail', () => {
  for (const k of ['kfc', 'popeyes', 'tacoBell', 'burgerKing', 'fiveGuys', 'krispyKreme', 'costa', 'ihg', 'travelodge', 'primark', 'next']) {
    assert.equal(fitsPositioning('luxury', { companyType: BRANDS[k].companyType, ...facts(k) }), false, k);
  }
  for (const k of ['rolex', 'goldsmiths', 'joMalone', 'laduree', 'gaucho', 'grind', 'wagamama']) {
    assert.equal(fitsPositioning('luxury', { companyType: BRANDS[k].companyType, ...facts(k) }), true, k);
  }
});

test('a mainstream scheme keeps the hospitality slice exactly; a value scheme drops luxury brands', () => {
  for (const k of Object.keys(BRANDS)) {
    assert.equal(fitsPositioning('mainstream', { companyType: BRANDS[k].companyType, tier: null, hotel: false }), isClientCrmCategory(BRANDS[k].companyType), k);
  }
  assert.equal(fitsPositioning('value', { companyType: 'Tenant - Restaurant', ...facts('kfc') }), true);
  assert.equal(fitsPositioning('value', { companyType: 'Tenant - Restaurant', ...facts('gaucho') }), false);
});

test('positioning comes from the property tags, then the tenant mix', () => {
  const rex = 'luxury retail, gifting, jewellery, watches, City of London, Bank, arcade retail, F&B';
  assert.equal(positioningFromTags(rex), 'luxury');
  assert.equal(positioningFromTags('Brand List Spring 2026, Scheme, Estate, The Crown Estate'), null);
  assert.equal(positioningFromTags('landsec, shopping centre'), null);
  assert.equal(positioningFromTags(`${rex}, mainstream`), 'mainstream');
  assert.equal(exactPositioningTag(rex), null);
  assert.equal(withPositioningTag(rex, 'value'), `${rex}, value`);
  assert.equal(withPositioningTag(`${rex}, value`, null), rex);
  assert.equal(withPositioningTag('', 'luxury'), 'luxury');
  assert.equal(positioningFromTenants(['luxury', 'luxury', 'premium', null]), 'luxury');
  assert.equal(positioningFromTenants(['mass', 'mass', null, 'premium']), null);
  assert.equal(positioningFromTenants(['mass', 'mass', 'mass', null]), null);
  assert.equal(positioningFromTenants(['luxury', 'luxury']), null);
});

test('luxury peers are London luxury destinations, not regional malls; mainstream peers are unchanged', () => {
  const lux = peerCentresFor('luxury').map(c => c.name);
  for (const n of ['Burlington Arcade', 'Royal Arcade', 'Piccadilly Arcade', 'Bond Street', 'Sloane Street', 'Covent Garden', 'Coal Drops Yard']) assert.ok(lux.includes(n), n);
  for (const n of ['Trinity Leeds', 'Manchester Arndale', 'Liverpool ONE', "St David's Cardiff", 'Bullring', 'Victoria Centre Nottingham', 'Eldon Square', 'Chinatown London', 'Carnaby', 'Canary Wharf']) assert.ok(!lux.includes(n), n);
  assert.deepEqual(benchmarkCentresFor('luxury').map(c => c.name), lux);
  assert.deepEqual(benchmarkCentresFor('mainstream'), TOP_25_CENTRES);
  const main = peerCentresFor('mainstream').map(c => c.name);
  assert.deepEqual(main, UK_CENTRES.filter(c => !c.positioning || c.top25).map(c => c.name));
  for (const n of ['Burlington Arcade', 'Bond Street', 'Royal Exchange']) assert.ok(!main.includes(n), n);
  assert.ok(main.includes('Covent Garden') && main.includes('Bluewater'));
  assert.equal(centreAt(51.5136093, -0.0874577)?.name, 'Royal Exchange');
  assert.ok(centreAt(51.5136093, -0.0874577).radiusKm < 0.1);
});

test('research cache identity changes for a re-positioned scheme only', () => {
  const plain = propertyResearchContext({ assetClass: 'Retail', propertyView: 'centre' });
  assert.equal(plain.positioning, 'mainstream');
  assert.equal(plain.cacheKey, JSON.stringify(['property-research-v3', 'centre', 'Retail', []]));
  assert.equal(propertyResearchContext({ assetClass: 'Retail', propertyView: 'centre', positioning: 'mainstream', positioningSource: 'tag' }).cacheKey, plain.cacheKey);
  const lux = propertyResearchContext({ assetClass: 'Retail', propertyView: 'centre', positioning: 'luxury', positioningSource: 'tag' });
  assert.equal(lux.positioning, 'luxury'); assert.equal(lux.positioningSource, 'tag');
  assert.notEqual(lux.cacheKey, plain.cacheKey);
});

// The actual brand-gaps route against synthetic stores round the Royal Exchange.
const file = 'server/property-gap-analysis.ts';
const decl = name => find(file, node => (ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText() === name) || (ts.isFunctionDeclaration(node) && node.name?.text === name));
const routeSource = find(file, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === 'router' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/property/:propertyId/brand-gaps');
const REX = { lat: 51.5136093, lng: -0.0874577 };
const BURLINGTON = UK_CENTRES.find(c => c.name === 'Burlington Arcade');
const TRINITY = UK_CENTRES.find(c => c.name === 'Trinity Leeds');
let storeId = 0;
const store = (brand, at, extra = {}) => ({ brand_company_id: brand.id, store_name: `${brand.name} ${++storeId}`, address: extra.address || null, lat: at.lat + (extra.dLat || 0), lng: at.lng, status: 'open',
  brand_name: brand.name, domain: null, rollout_status: null, company_type: brand.companyType, store_count: brand.storeCount || 10, brand_group_id: null, industry: brand.industry || null, fnb_sector: null });
const withId = (key, id) => ({ ...BRANDS[key], id });

function runGapRoute(positioning) {
  const brands = { kfc: withId('kfc', 'kfc'), fiveGuys: withId('fiveGuys', 'fg'), rolex: withId('rolex', 'rolex'), goldsmiths: withId('goldsmiths', 'gold'), gaucho: withId('gaucho', 'gaucho'), grind: withId('grind', 'grind'), ihg: withId('ihg', 'ihg'), next: withId('next', 'next') };
  const stores = [
    store(brands.grind, REX, { address: 'The Royal Exchange, Bank, London EC3V 3LR' }),
    store(brands.kfc, REX, { dLat: 0.003 }), // ~330m away at Bank: not on the arcade
    store(brands.rolex, BURLINGTON), store(brands.goldsmiths, BURLINGTON), store(brands.gaucho, BURLINGTON), store(brands.ihg, BURLINGTON),
    store(brands.kfc, TRINITY), store(brands.fiveGuys, TRINITY), store(brands.next, TRINITY), store(brands.fiveGuys, BURLINGTON, { dLat: 0.02 }),
    // Manchester's Royal Exchange names the scheme but is 260km away.
    store(brands.fiveGuys, { lat: 53.4827, lng: -2.2452 }, { address: 'Royal Exchange, St Ann\'s Square, Manchester' }),
  ];
  const descriptions = Object.fromEntries(Object.values(brands).map(b => [b.id, b.description]));
  const pool = { query: async (sql, params) => {
    if (/FROM brand_stores s/.test(sql)) return { rows: stores };
    if (/SELECT id, description FROM crm_companies/.test(sql)) return { rows: params[0].map(id => ({ id, description: descriptions[id] })) };
    return { rows: [] };
  } };
  let handler;
  const context = propertyResearchContext({ assetClass: 'Retail', propertyView: 'centre', positioning, positioningSource: 'tag' });
  const bindings = {
    ...positioningModule, ...centres, isClientCrmCategory,
    router: { get: (_url, _auth, callback) => { handler = callback; } }, requireAuth() {},
    readPropertyResearchContext: async () => context, researchCacheMatches: async () => false,
    resolvePropertyLocation: async () => ({ ok: true, ...REX, postcode: 'EC3V 3LR', name: 'Royal Exchange' }),
    ensureGapColumns: async () => {}, sweepSectorClassification() {}, pool,
    require: name => { if (name === './company-scope') return { resolveCompanyScope: async () => null, isPropertyInScope: async () => true }; throw new Error(name); },
  };
  const helpers = ['PEER_PRESENCE_KM', 'NAME_MATCH_KM', 'FNB_SECTORS', 'SECTOR_LABELS', 'brandKey', 'namesScheme', 'heuristicSector', 'retailSector'].map(decl).join('\n');
  evaluate(`${helpers}\n${routeSource};`, bindings);
  return (async () => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler({ params: { propertyId: 'rex' }, query: {} }, res); return { code: res.code, body: JSON.parse(JSON.stringify(res.body)) }; })();
}

test('brand-gaps route: a luxury arcade compares with luxury peers on luxury brands and its own footprint', async () => {
  const { code, body } = await runGapRoute('luxury');
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.positioning.key, 'luxury');
  assert.deepEqual(body.onScheme.map(b => b.brand_name), ['Grind']);
  assert.equal(body.radii.onScheme, 0.08);
  const benchNames = body.benchmark.centres.map(c => c.name);
  assert.ok(benchNames.includes('Burlington Arcade') && !benchNames.includes('Trinity Leeds'));
  assert.equal(body.benchmark.here.brands, 1);
  const burlington = body.benchmark.centres.find(c => c.name === 'Burlington Arcade');
  assert.deepEqual(burlington.not_here_top.map(b => b.name).sort(), ['Gaucho', 'Goldsmiths', 'Rolex']);
  const everything = [...body.peerGaps, ...body.competitorGaps, ...body.localMarket, ...body.gap, ...body.wider].map(b => b.brand_name);
  for (const n of ['KFC', 'Five Guys', 'IHG', 'Next']) assert.ok(!everything.includes(n), n);
  assert.ok(body.peerGaps.map(b => b.brand_name).includes('Rolex'));
  assert.ok(body.sectors.some(s => s.key === 'jewellery_watches' && s.at_peers >= 2 && s.missing));
});

test('brand-gaps route: the same scheme read as mainstream keeps the hospitality slice and top-25 peers', async () => {
  const { body } = await runGapRoute('mainstream');
  assert.equal(body.positioning.key, 'mainstream');
  assert.ok(!body.benchmark.centres.some(c => c.name === 'Burlington Arcade'));
  assert.ok(body.benchmark.centres.some(c => c.name === 'Trinity Leeds'));
  const names = [...body.peerGaps, ...body.onScheme].map(b => b.brand_name);
  assert.ok(names.includes('KFC') && names.includes('Five Guys'));
  assert.ok(!names.includes('Rolex') && !names.includes('Next'));
  assert.ok(!body.sectors.some(s => s.key === 'jewellery_watches'));
  // The Manchester store naming "Royal Exchange" and the KFC at Bank aren't on the arcade.
  assert.deepEqual(body.onScheme.map(b => b.brand_name), ['Grind']);
});

test('target tenants: a luxury scheme never puts QSR, hotels or mainstream retail forward', async () => {
  const { unitCandidates } = await import('../../server/target-tenant-engine.ts');
  const brand = (key, category, companyId) => ({ key: companyId, companyId, name: BRANDS[key].name, category, stores: 20, rollout: null,
    signals: [{ text: 'BGP in active conversation with the brand', weight: 12 }], requirements: [], bgpClient: false, tier: brandTier(BRANDS[key]), hotel: isHotelGroup(BRANDS[key]) });
  const brands = new Map(['kfc', 'fiveGuys', 'ihg', 'next', 'rolex', 'gaucho', 'grind'].map(k => [k, brand(k, BRANDS[k].companyType, k)]));
  const ev = { propertyId: 'rex', property: { name: 'Royal Exchange', postcode: 'EC3V 3LR', address: 'Bank, London' }, client: false, positioning: 'luxury', mix: [], hereKeys: new Set(), hereIds: new Set(), brands, context: '' };
  const retailUnit = unitCandidates(ev, { id: 'u1', unit_name: 'Unit 12', sqft: 600, positioning: 'Retail' }).map(c => c.name);
  assert.deepEqual(retailUnit.sort(), ['Gaucho', 'Grind', 'Rolex']);
  const fnbUnit = unitCandidates(ev, { id: 'u2', unit_name: 'Unit 3', sqft: 1500, positioning: 'Restaurant' }).map(c => c.name);
  assert.deepEqual(fnbUnit.sort(), ['Gaucho', 'Grind']);
  const mainstream = unitCandidates({ ...ev, positioning: 'mainstream' }, { id: 'u2', unit_name: 'Unit 3', sqft: 1500, positioning: 'Restaurant' }).map(c => c.name);
  assert.ok(mainstream.includes('KFC') && mainstream.includes('Five Guys'));
});
