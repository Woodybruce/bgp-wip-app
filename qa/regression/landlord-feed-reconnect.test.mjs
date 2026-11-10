import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { BRAND_WEB_FEED_TYPES, BRAND_FEED_TABS } from '../../shared/brand-feed-types.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const source = find('server/brand-web-feeds.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'ensureBrandWebFeeds');

function fixture({ landlord = true, active = false, sourceUrl = 'https://www.linkedin.com/company/landsec', feedUrl = 'https://rss.app/feeds/existing.xml' } = {}) {
  const writes = [], fetches = []; let checks = 0;
  const { run } = evaluate(source + '\nexports.run=ensureBrandWebFeeds;', {
    LANDLORD_CATALOGUE_PREDICATE: 'fixture_landlord', BRAND_WEB_FEED_TYPES, BRAND_FEED_TABS,
    pool: { query: async (sql, params) => {
      if (sql.includes('FROM crm_companies')) return { rows: [{ id: 'landsec', name: 'Landsec', is_landlord: landlord }] };
      if (sql.includes('SELECT id, type')) return { rows: [{ id: 'existing-linkedin', type: 'rssapp_linkedin', url: sourceUrl, feed_url: feedUrl, active }] };
      assert.match(sql, /^UPDATE news_sources SET active=true/);
      writes.push({ sql, params }); return { rows: [] };
    } },
    discoverBrandFeedPages: async () => ({ domain: 'landsec.com', pages: { linkedin: 'https://www.linkedin.com/company/landsec/' } }),
    planRoom: async () => { checks++; return { free: 10 }; },
    createCheckedFeed: async () => assert.fail('Existing source must not create a duplicate provider feed'),
    insertSource: async () => assert.fail('Existing source must retain its ID'),
    fetchNow: async ids => fetches.push([...ids]), setTimeout: callback => callback(),
  });
  return { run: (opts = {}) => run('landsec', ['linkedin'], opts), writes, fetches, checks: () => checks };
}

test('Landlord reconnect reuses the confirmed inactive source and fetches it without a new provider feed', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.results[0].status, 'reconnected');
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Array.from(f.writes[0].params), ['existing-linkedin', 'brand:landsec']);
  assert.deepEqual(f.fetches, [['existing-linkedin']]);
  assert.equal(f.checks(), 0);
});

test('Landlord reconnect refuses a stale destination or missing feed rather than making duplicates', async () => {
  for (const options of [{ sourceUrl: 'https://www.linkedin.com/company/unrelated' }, { feedUrl: null }]) {
    const f = fixture(options), result = await f.run();
    assert.equal(result.results[0].status, 'not_found');
    assert.equal(f.writes.length, 0); assert.deepEqual(f.fetches, [[]]); assert.equal(f.checks(), 0);
  }
});

test('active Landlord feeds, dry runs and existing Brand behavior remain unchanged', async () => {
  for (const [options, dryRun, expected] of [[{ active: true }, false, 'exists'], [{}, true, 'would_create'], [{ landlord: false }, false, 'exists']]) {
    const f = fixture(options), result = await f.run({ dryRun });
    assert.equal(result.results[0].status, expected);
    assert.equal(f.writes.length, 0); assert.deepEqual(f.fetches, [[]]);
  }
});
