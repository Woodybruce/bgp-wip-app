import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { isOnDemandInstagramEligible } from '../../server/instagram-card-state.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const source = find('server/news-brand-linking.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'ensureBrandInstagramFeed');

function fixture({ landlord = true, failFetch = false, fed = false } = {}) {
  const queries = [], fetched = [], inserted = [], warnings = []; let creates = 0;
  const { run } = evaluate(source + '\nexports.run=ensureBrandInstagramFeed;', {
    igFeedInFlight: new Set(), LANDLORD_CATALOGUE_PREDICATE: 'fixture_landlord', SOCIAL_TYPE: { instagram: 'rssapp_instagram' }, BRAND_CATEGORY_PREFIX: 'brand:',
    process: { env: { RSSAPP_FEED_QUOTA: '100' } }, cleanIgHandle: value => value, isOnDemandInstagramEligible,
    newsSources: { id: 'id' }, ensureFailureTable: async () => {},
    pool: { query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM crm_companies')) return { rows: [{ id: 'company', name: 'Fixture', company_type: landlord ? 'Landlord' : 'Tenant', instagram_handle: 'fixture', is_landlord: landlord, on_deal: !landlord, fed }] };
      return { rows: [] };
    } },
    rssappHealth: async () => ({ ok: true, feedCount: 1 }),
    createRssAppFeed: async () => { creates++; return { rss_feed_url: 'https://rss.app/feeds/example.xml' }; },
    db: { insert: () => ({ values: value => { inserted.push(value); return { returning: async () => [{ id: 'created-source' }] }; } }) },
    require: name => {
      assert.equal(name, './news-feeds');
      return { fetchNewsSourcesNow: async ids => { fetched.push(Array.from(ids)); if (failFetch) throw new Error('temporary RSS retrieval failure'); return { fetched: 3, errors: 0 }; } };
    },
    console: { warn: message => warnings.push(message) },
  });
  return { run, fetched, queries, inserted, warnings, creates: () => creates };
}

test('new explicitly opened Landlord Instagram feeds ingest only their newly created source', async () => {
  const f = fixture(), result = await f.run('company', { allowLandlord: true });
  assert.equal(result.status, 'created');
  assert.equal(f.creates(), 1); assert.equal(f.inserted.length, 1);
  assert.deepEqual(f.fetched, [['created-source']]);
});

test('Landlord first-retrieval failure remains a created feed and never records a creation failure', async () => {
  const f = fixture({ failFetch: true }), result = await f.run('company', { allowLandlord: true });
  assert.equal(result.status, 'created'); assert.equal(f.creates(), 1);
  assert.deepEqual(f.fetched, [['created-source']]);
  assert.equal(f.queries.some(query => /^INSERT INTO rssapp_feed_failures/.test(query.sql.trim())), false);
  assert.equal(f.warnings.length, 1); assert.match(f.warnings[0], /first retrieval remains pending/);
});

test('Brand creation and already-connected Landlord feeds retain their previous fetch behavior', async () => {
  const brand = fixture({ landlord: false });
  assert.equal((await brand.run('company', { allowLandlord: true })).status, 'created');
  assert.deepEqual(brand.fetched, []);
  const existing = fixture({ fed: true });
  assert.equal((await existing.run('company', { allowLandlord: true })).status, 'exists');
  assert.equal(existing.creates(), 0); assert.deepEqual(existing.fetched, []);
  const unrequested = fixture();
  assert.equal((await unrequested.run('company')).status, 'skipped');
  assert.equal(unrequested.creates(), 0); assert.deepEqual(unrequested.fetched, []);
});
