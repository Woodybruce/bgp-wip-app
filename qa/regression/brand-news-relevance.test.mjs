import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { isBrandNewsRelevant, isBrandSignalRelevant } from '../../server/brand-news-relevance.ts';
import { rankCompanyHeroImages } from '../../shared/brand-image-selection.ts';
import { publishableBrandImage } from '../../server/brand-publishing.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const co = (overrides = {}) => ({ id: 'cook', name: 'COOK', industry: 'Food retail', domain: 'cookfood.net',
  ai_generated_fields: { brand_identity: { status: 'verified', domain: 'cookfood.net', aliases: ['COOK Trading Ltd'] } }, ...overrides });
const article = (title, overrides = {}) => ({ id: title, title, summary: null, url: 'https://trade.example/story', ...overrides });
const declaration = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);

test('COOK requires frozen-meal business context, not a keyword or feed name', () => {
  for (const title of ['Frozen food retailer COOK opens a new shop', 'Cook, the frozen meals retailer, grows sales',
    'COOK founder Edward Perry discusses expansion', 'COOK Trading Limited announces new investment']) {
    assert.equal(isBrandNewsRelevant(co(), article(title)), true, title);
  }
  for (const title of ['Cook Islands tourism grows', 'Thomas Cook opens new stores', 'Beryl Cook exhibition opens',
    'Tim Cook unveils new stores', 'Chef Cook opens a frozen meal shop', 'How to cook frozen meals from the shops',
    'COOK announces a new project', 'Mr Cook Fast Food opens a restaurant']) {
    assert.equal(isBrandNewsRelevant(co(), article(title)), false, title);
  }
  assert.equal(isBrandNewsRelevant(co(), article('Cook Islands frozen food stores report sales growth')), false);
  assert.equal(isBrandNewsRelevant(co(), article('Thomas Cook discusses frozen meals and retail expansion')), false);
});

test('context can identify COOK despite a legacy wrong industry, without trusting that wrong industry', () => {
  const company = co({ industry: 'Construction - General', ai_generated_fields: {} });
  assert.equal(isBrandNewsRelevant(company, article('Frozen meal retailer COOK opens a shop')), true);
  assert.equal(isBrandNewsRelevant(company, article('COOK construction company wins tower contract')), false);
});

test('only the current verified domain or approved alias supplies independent identity', () => {
  const company = co();
  assert.equal(isBrandNewsRelevant(company, article('Our latest shop', { url: 'https://www.cookfood.net/news/shop' })), true);
  assert.equal(isBrandNewsRelevant(company, article('Our latest shop', { summary: 'Read more at cookfood.net.' })), true);
  assert.equal(isBrandNewsRelevant(company, article('Our latest shop', { summary: 'Read more at https://cookfood.net/news.' })), true);
  assert.equal(isBrandNewsRelevant(company, article('COOK Trading announces expansion')), true);
  for (const changed of [co({ ai_generated_fields: {} }), co({ domain: 'cook.com' }), co({ website: 'https://cook.com' })]) {
    assert.equal(isBrandNewsRelevant(changed, article('Our latest shop', { url: 'https://cookfood.net/news' })), false);
    assert.equal(isBrandNewsRelevant(changed, article('COOK Trading announces expansion')), false);
  }
  assert.equal(isBrandNewsRelevant(co({ uk_entity_name: 'Random Construction Ltd', trading_entities: ['Another Builder'] }),
    article('Random Construction and Another Builder announce a contract')), false);
  const camelCase = { ...company, aiGeneratedFields: company.ai_generated_fields, ai_generated_fields: undefined };
  assert.equal(isBrandNewsRelevant(camelCase, article('COOK Trading grows')), true);
});

test('lookalike websites, query parameters and AI summaries do not corroborate news', () => {
  for (const url of ['https://cookfood.net.evil.test/story', 'https://news.example/cookfood.net',
    'https://news.example/?url=https://cookfood.net', 'https://cookfood.net@evil.test/story']) {
    assert.equal(isBrandNewsRelevant(co(), article('Unrelated news', { url })), false, url);
  }
  for (const summary of ['See cookfood.net.evil.test', 'Visit https://evil.test/cookfood.net',
    '<a href="https://cookfood.net">Unrelated story</a>']) {
    assert.equal(isBrandNewsRelevant(co(), article('Unrelated news', { summary })), false, summary);
  }
  assert.equal(isBrandNewsRelevant(co(), article('Beryl Cook exhibition', { aiSummary: 'Frozen food retailer COOK expands' })), false);
});

test('short and common names need their named sector, while distinctive names match whole words', () => {
  for (const [company, good, bad] of [
    [{ name: 'GAP', industry: 'Fashion' }, 'GAP fashion retailer opens a flagship', 'A gap in the fashion retail market'],
    [{ name: 'BP', industry: 'Retail' }, 'BP retail stores report sales growth', 'Blood pressure drops by 12 bp'],
    [{ name: 'AS', industry: 'Retail' }, 'AS retail chain opens a store', 'As retail sales rise, stores open'],
    [{ name: 'Mango', industry: 'Fashion' }, 'Mango fashion retailer expands', 'Mango harvest boosts food retail'],
    [{ name: "Bill’s", industry: 'Restaurant' }, "Bill's restaurant opens at Heathrow", 'Buffalo Bills open a restaurant'],
    [{ name: 'Next', industry: 'Fashion retail' }, 'Next fashion retailer posts record sales', 'Next week fashion retail opens'],
    [{ name: 'H&M', industry: 'Fashion' }, 'H&M opens new shops', 'HMRC changes rules'],
    [{ name: 'Zara', industry: 'Fashion' }, 'Zara fashion retailer grows', 'Zaragoza retail sales rise'],
    [{ name: 'Waterstones', industry: 'Retail' }, 'Waterstones opens in town', 'Waterstoneshire council announces plan'],
  ]) {
    assert.equal(isBrandNewsRelevant(company, article(good)), true, good);
    assert.equal(isBrandNewsRelevant(company, article(bad)), false, bad);
  }
  assert.equal(isBrandNewsRelevant({ name: 'Sky', industry: 'Retail' }, article('Retail sales rise - Sky News')), false);
  assert.equal(isBrandNewsRelevant({ name: 'UK', industry: 'Retail' }, article('UK retail grows')), false);
});

test('generic and dedicated feed ingestion both screen identity, without changing industry article storage', async () => {
  const companies = [co(), { id: 'bp', name: 'BP', industry: 'Retail' }];
  const articles = [
    article('Thomas Cook retail expansion', { sourceId: 'cook-feed' }),
    article('Beryl Cook frozen food retailer exhibit', { sourceId: 'cook-feed' }),
    article('Cook Islands food stores grow', { sourceId: 'trade-feed' }),
    article('COOK frozen food retailer expands', { sourceId: 'cook-feed' }),
    article('BP retail store opens', { sourceId: 'trade-feed' }),
    article('Our newest dish!', { sourceId: 'cook-social', url: 'https://instagram.com/p/example' }),
    article('Waterstones shops expand', { sourceId: 'deleted-brand-feed' }),
  ];
  const sources = [{ id: 'cook-feed', category: 'brand:cook', type: 'google_news' },
    { id: 'cook-social', category: 'brand:cook', type: 'rssapp_instagram' },
    { id: 'deleted-brand-feed', category: 'brand:deleted', type: 'google_news' }];
  const crmCompanies = {}, newsArticles = {}, newsSources = {}, linked = [];
  const db = { select: () => ({ from(table) {
    if (table === crmCompanies) return { where: async () => companies };
    if (table === newsSources) return Promise.resolve(sources);
    assert.equal(table, newsArticles);
    return { where: () => ({ orderBy: () => ({ limit: async () => articles }) }) };
  } }) };
  const compiled = evaluate(declaration('server/news-brand-linking.ts', 'linkArticleToBrands') + '\n'
    + declaration('server/news-brand-linking.ts', 'linkRecentArticlesToBrands'), {
    db, crmCompanies, newsArticles, newsSources, isBrandNewsRelevant,
    and: () => true, ilike: () => true, isNotNull: () => true, desc: () => true, sql: () => true,
    BRAND_CATEGORY_PREFIX: 'brand:', SOCIAL_TYPE: { instagram: 'rssapp_instagram', x: 'rssapp_x', linkedin: 'rssapp_linkedin' },
    upsertBrandSignal: async (id, name, row) => linked.push([id, row.title]),
  });
  const result = await compiled.linkRecentArticlesToBrands();
  assert.deepEqual(linked, [['cook', 'COOK frozen food retailer expands'], ['bp', 'BP retail store opens'], ['cook', 'Our newest dish!']]);
  assert.equal(result.articles, 7);
  assert.equal(articles.length, 7, 'rejected brand links do not delete general feed articles');
});

const signalRows = () => [
  { headline: 'Cook Islands tourism grows', source: 'https://travel.example/news' },
  { headline: 'Thomas Cook opens a store', source: 'https://travel.example/news2', ai_relevant: true },
  { headline: 'Discussed a new site with their agent', detail: 'Follow up next week', source: null },
  { headline: 'Team relationship note', source: 'manual' },
  { headline: 'COOK frozen food retailer opens a shop', source: 'https://retail.example/news' },
];

test('actual profile signal filter hides old wrong links but preserves manual notes and provider trust gate', () => {
  const source = find('server/brand-profile.ts', node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(d => d.name.getText() === 'filteredSignals'));
  const rows = signalRows().concat({ headline: 'Company headcount increased', source: 'apollo' });
  const run = trustedApollo => evaluate(source + '\nexports.rows = filteredSignals;', {
    signals: { rows }, c: co(), isBrandSignalRelevant, trustedApollo,
  }).rows;
  assert.deepEqual(Array.from(run(false), row => row.headline), signalRows().slice(2).map(row => row.headline));
  assert.equal(run(true).at(-1).source, 'apollo');
  assert.equal(rows.length, 6, 'read does not mutate historical rows');
});

test('actual brand PDF loader applies the same read filter and retains staff notes without requiring a name', async () => {
  const rows = signalRows();
  const queries = [];
  const { loadBrandPackData } = evaluate(declaration('server/brand-pack.ts', 'loadBrandPackData')
    + '\nexports.loadBrandPackData = loadBrandPackData;', {
    isBrandSignalRelevant, rankCompanyHeroImages, publishableBrandImage,
    pool: { query: async sql => {
      queries.push(sql);
      if (sql.includes('FROM crm_companies WHERE')) return { rows: [co()] };
      if (sql.includes('FROM brand_signals')) return { rows };
      return { rows: [] };
    } },
  });
  const result = await loadBrandPackData('cook');
  assert.deepEqual(Array.from(result.signals, row => row.headline), rows.slice(2).map(row => row.headline));
  assert.ok(queries.every(sql => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql)), 'display keeps historical data unchanged');
});

test('actual profile news output filters before applying its visible limit', () => {
  const output = find('server/brand-profile.ts', (node, ast) => ts.isPropertyAssignment(node)
    && node.name.getText(ast) === 'news' && node.initializer.getText(ast).includes('isBrandNewsRelevant'));
  const rows = [...Array.from({ length: 40 }, (_, i) => article(`Cook Islands story ${i}`)),
    ...Array.from({ length: 30 }, (_, i) => article(`COOK frozen meal retailer opens shop ${i}`))];
  const result = evaluate(`exports.result = ({ ${output} }).news;`, { news: { rows }, c: co(), isBrandNewsRelevant }).result;
  assert.equal(result.length, 20);
  assert.equal(result[0].title, 'COOK frozen meal retailer opens shop 0');
  assert.equal(rows.length, 70);
});
