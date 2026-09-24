import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/rssapp-prune.ts';
const decl = name => find(file, node => (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === name))
  || (ts.isFunctionDeclaration(node) && node.name?.text === name));
const { classifyRssAppFeeds } = evaluate([decl('norm'), decl('classifyRssAppFeeds')].join('\n').replace(/^export /gm, '') + '\nexports.classifyRssAppFeeds=classifyRssAppFeeds;');

const now = Date.parse('2026-09-24T12:00:00Z');
const src = (over) => ({ id: 's', name: 'x', url: 'https://www.instagram.com/x/', feed_url: 'https://rss.app/feeds/x.xml', type: 'instagram', category: 'brand:b',
  active: true, last_fetched_at: '2026-09-24T00:00:00Z', brand_exists: true, brand_on_deal: false, articles: 5, last_article: '2026-09-20T00:00:00Z', ...over });
const feed = (id, url) => ({ id, rss_feed_url: `https://rss.app/feeds/${id}.xml`, source_url: url || `https://www.instagram.com/${id}/`, title: id });

test('feeds are pruned only when unlinked, switched off, for a deleted brand, silent or quiet — never for a deal brand', () => {
  const sources = [
    src({ id: 'live', feed_url: 'https://rss.app/feeds/live.xml' }),
    src({ id: 'off', feed_url: 'https://rss.app/feeds/off.xml', active: false }),
    src({ id: 'gone', feed_url: 'https://rss.app/feeds/gone.xml', brand_exists: false }),
    src({ id: 'silent', feed_url: 'https://rss.app/feeds/silent.xml', articles: 0, last_article: null }),
    src({ id: 'quiet', feed_url: 'https://rss.app/feeds/quiet.xml', last_article: '2025-12-01T00:00:00Z' }),
    src({ id: 'deal', feed_url: 'https://rss.app/feeds/deal.xml', brand_on_deal: true, articles: 0, last_article: null }),
    src({ id: 'byurl', feed_url: 'https://rss.app/feeds/other.xml', url: 'https://www.instagram.com/byurl/' }),
  ];
  const out = classifyRssAppFeeds(['live', 'off', 'gone', 'silent', 'quiet', 'deal', 'orphan', 'byurl'].map(id => feed(id)), sources, now);
  const reasons = Object.fromEntries(out.map(r => [r.feedId, r.reason]));
  assert.deepEqual({ ...reasons }, { live: null, off: 'switched_off', gone: 'brand_deleted', silent: 'never_posted', quiet: 'quiet_180d', deal: null, orphan: 'unlinked', byurl: null });
});
