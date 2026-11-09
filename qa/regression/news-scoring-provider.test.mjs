import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { scoreNewsBatches } from '../../server/news-ingestion.ts';

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');

test('production scoring requests JSON in user input even when system instructions are separate', async () => {
  const source = find('server/news-feeds.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'scoreArticlesWithAI');
  const article = { id: 'article-1', title: 'Retail landlord announces a new letting', summary: 'A retailer agreed a new lease.', sourceName: 'Property publisher', category: 'Property' };
  const newsArticles = {}, teamNewsPreferences = {}, updates = [], errors = [], requests = [];
  const { run } = evaluate(source + '\nexports.run = scoreArticlesWithAI;', {
    newsArticles, teamNewsPreferences, scoreNewsBatches,
    TEAM_PROFILES: { Investment: { focus: 'Property investment' }, Leasing: { focus: 'Lettings' } },
    CHATBGP_HELPER_MODEL: 'fixture-model',
    runNewsScoringOnce: work => work(), newsScoringLimit: () => 1,
    newsArticleTitleFilter: () => true, publicNewsArticleFilter: () => true,
    eq() {}, and() {}, desc() {}, sql() {},
    getActiveTagVocabulary: async () => ['retail'], safeParseJSON: JSON.parse,
    console: { log() {}, warn: (...args) => errors.push(args) },
    db: {
      select: () => ({ from: table => table === teamNewsPreferences ? Promise.resolve([]) : {
        where() { return this; }, orderBy() { return this; }, limit: async () => [article],
      } }),
      update: table => { assert.equal(table, newsArticles); return { set: value => ({ where: async () => updates.push(value) }) }; },
    },
    callClaude: async request => {
      requests.push(request);
      assert.equal(request.response_format.type, 'json_object');
      // The Responses adapter moves system messages into instructions. Its
      // JSON-mode validation checks the remaining input messages themselves.
      const input = request.messages.filter(message => message.role !== 'system');
      if (!input.some(message => /json/i.test(message.content))) {
        throw new Error("Response input messages must contain word 'json'");
      }
      assert.ok(input.some(message => message.content.includes(article.title)));
      return { choices: [{ message: { content: JSON.stringify({ articles: [{
        index: 1, relevanceScores: { Investment: 70, Leasing: 90 }, tags: ['retail'], aiSummary: 'A retailer agreed a new lease.',
      }] }) } }] };
    },
  });

  assert.equal(await run(), 1);
  assert.equal(requests.length, 1);
  assert.equal(errors.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].processed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(updates[0].aiRelevanceScores)), { Investment: 70, Leasing: 90 });
});
