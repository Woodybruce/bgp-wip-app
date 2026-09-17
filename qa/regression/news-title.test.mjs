import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { sql, notInArray, and, eq, desc } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { newsArticles, newsSources } from '../../shared/schema.ts';
import { NEWS_ERROR_TITLES, isNewsErrorTitle } from '../../shared/news-title.ts';
const require = createRequire(import.meta.url);
const { find, route, evaluate, ts } = require('./source-harness.cjs');
const titleFilterSource = find('server/news-feeds.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'newsArticleTitleFilter');
const { newsArticleTitleFilter } = evaluate(titleFilterSource + '\nexports.newsArticleTitleFilter = newsArticleTitleFilter;', { sql, notInArray, newsArticles, NEWS_ERROR_TITLES });

test('challenge and error page titles match whole titles after whitespace and punctuation normalization', () => {
  for (const title of NEWS_ERROR_TITLES) assert.equal(isNewsErrorTitle(title), true, title);
  for (const title of [' Verifying Device ', 'VERIFYING\n YOUR\tDEVICE...', 'Just a moment…', 'Checking your browser!', '404 Not Found.']) assert.equal(isNewsErrorTitle(title), true, title);
});

test('real news discussing verification, captcha, blocked requests or errors stays visible', () => {
  for (const title of ['Retailers prepare for age verification', 'Verifying Device sales before opening new stores', 'How CAPTCHAs are changing shopping',
    'Access denied: why shops are closing early', 'Just a moment with the new chief executive', '403 forbidden errors disrupted online sales',
    'The cost of a bad gateway', 'Request blocked by council after residents object', 'Attention required for landlords']) assert.equal(isNewsErrorTitle(title), false, title);
});

test('RSS challenge entries are rejected before URL/image retrieval and article insertion', async () => {
  const inserted = [], fetchedUrls = [];
  const source = { id: 'source', name: 'The Times', type: 'rss', feedUrl: 'https://fixture.test/rss', category: 'Property' };
  const fn = find('server/news-feeds.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'fetchRssFeeds');
  const { run } = evaluate(fn + '\nexports.run = fetchRssFeeds;', {
    newsArticles, newsSources, eq, and, sql, isNewsErrorTitle, setTimeout: callback => callback(),
    require: name => { assert.equal(name, 'rss-parser'); return { default: class { async parseURL(url) { fetchedUrls.push(url); return { items: [
      { title: 'Verifying Device', link: 'https://news.google.com/blocked' },
      { title: 'Just a moment...', link: 'https://fixture.test/challenge' },
      { title: 'Retailers prepare for age verification', link: 'https://fixture.test/real' },
    ] }; } } }; },
    db: {
      select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [source], limit: async () => [] }) }) }),
      insert: table => { assert.equal(table, newsArticles); return { values: async row => inserted.push(row) }; },
      update: table => { assert.equal(table, newsSources); return { set: () => ({ where: async () => {} }) }; },
    },
    extractImageUrl: () => 'https://fixture.test/photo.jpg', resolveGoogleNewsUrl: () => assert.fail('A challenge URL must not be fetched'),
    fetchOgImage: () => assert.fail('A challenge page must not be fetched for an image'), faviconForUrl: () => null,
  });
  const result = await run();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { fetched: 1, errors: 0 });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].title, 'Retailers prepare for age verification');
  assert.deepEqual(fetchedUrls, ['https://fixture.test/rss']);
});

test('legacy challenge titles are excluded by the feed SQL before its limit, with no deletes', async () => {
  let handler, where, response;
  const { text, params } = (() => { const query = new PgDialect().sqlToQuery(newsArticleTitleFilter()); return { text: query.sql, params: query.params }; })();
  assert.match(text, /lower\(btrim\(regexp_replace/);
  assert.match(text, /not in/);
  assert.deepEqual(params, [...NEWS_ERROR_TITLES]);
  const article = { id: 'real', title: 'Verifying Device sales before opening new stores', aiRelevanceScores: null };
  evaluate(route('server/news-feeds.ts', 'get', '/api/news-feed/articles'), {
    requireAuth() {}, app: { get: (_path, _auth, fn) => { handler = fn; } }, newsArticles, newsArticleTitleFilter, sql, and, desc,
    db: { select: () => ({ from: () => ({ where: value => { where = value; return { orderBy: () => ({ limit: async () => {
      const query = new PgDialect().sqlToQuery(where);
      assert.ok(query.params.includes('verifying device'), 'filter must run in the DB before limiting');
      return [article];
    } }) }; } }) }) },
  });
  await handler({ query: { limit: '12' } }, { json: value => { response = value; }, status: () => assert.fail('feed failed') });
  assert.deepEqual(response, [article]);
});
