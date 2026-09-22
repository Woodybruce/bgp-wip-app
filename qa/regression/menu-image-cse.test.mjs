import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/brand-profile.ts';
const functionSource = find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === 'enrichMenuItemImagesWithCse');
const denylist = find(file, node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(d => d.name.getText() === 'PRODUCT_HOST_DENYLIST'));
const result = (contextLink, overrides = {}) => ({
  title: 'COOK cookfood.net lasagne', link: 'https://cdn.example.com/lasagne.jpg',
  image: { contextLink, width: 1200, height: 800 }, ...overrides,
});

function fixture(rows, env = { GOOGLE_CSE_KEY: 'fixture-key', GOOGLE_CSE_ID: 'fixture-id' }) {
  const requests = [];
  const compiled = evaluate(denylist + '\n' + functionSource + '\nexports.run = enrichMenuItemImagesWithCse;', {
    URL, AbortSignal, process: { env }, console: { warn() {}, log() {} },
    fetch: async url => {
      requests.push(new URL(url));
      return { ok: true, json: async () => ({ items: rows }) };
    },
  });
  return { run: compiled.run, requests };
}

test('actual menu CSE fallback rejects domain text in offsite paths, titles, queries and lookalike hosts', async () => {
  const official = 'https://www.cookfood.net/products/lasagne';
  const rows = [
    result('https://other.example.com/cookfood.net/lasagne'),
    result('https://other.example.com/?source=https://cookfood.net'),
    result('https://cookfood.net.evil.example.com/products/lasagne'),
    result('https://cookfood.net@other.example.com/products/lasagne'),
    result('https://other.example.com/lasagne', { link: 'https://cookfood.net/lasagne.jpg' }),
    result(official, { link: 'https://cdn.example.com/COOKLogoDark.png' }),
    result(official, { image: { contextLink: official, width: 320, height: 200 } }),
    result(official, { link: 'https://cdn.example.com/official-lasagne.jpg' }),
  ];
  const { run, requests } = fixture(rows);
  const items = [{ name: 'Lasagne' }];
  await run('COOK', 'https://www.cookfood.net/', items);
  assert.equal(items[0].image, 'https://cdn.example.com/official-lasagne.jpg');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('q'), '"COOK" "Lasagne" site:cookfood.net');
  assert.equal(requests[0].searchParams.get('imgType'), 'photo');
});

test('actual fallback requires sufficient reported photo dimensions and rejects logos/private targets', async () => {
  const contextLink = 'https://shop.cookfood.net/products/lasagne';
  for (const row of [
    result(contextLink, { image: { contextLink } }),
    result(contextLink, { image: { contextLink, width: 'not-a-size', height: 800 } }),
    result(contextLink, { image: { contextLink, width: 639, height: 800 } }),
    result(contextLink, { image: { contextLink, width: 1200, height: 359 } }),
    result(contextLink, { link: 'https://cdn.example.com/cook-%6cogo.png' }),
    result(contextLink, { link: 'https://cdn.example.com/meal.svg' }),
    result(contextLink, { link: 'http://127.0.0.1/meal.jpg' }),
    result(contextLink, { link: 'https://user:secret@cdn.example.com/meal.jpg' }),
    result(contextLink, { link: 'https://www.shutterstock.com/meal.jpg' }),
  ]) {
    const items = [{ name: 'Lasagne' }];
    await fixture([row]).run('COOK', 'cookfood.net', items);
    assert.equal(items[0].image, undefined, JSON.stringify(row));
  }
  const items = [{ name: 'Lasagne' }];
  await fixture([result(contextLink, { image: { contextLink, width: 640, height: 360 } })]).run('COOK', 'cookfood.net', items);
  assert.equal(items[0].image, 'https://cdn.example.com/lasagne.jpg', 'official subdomain context can authenticate a CDN photo');
});

test('existing images are retained and fallback does not search without a usable official domain', async () => {
  const first = fixture([]);
  const items = [{ name: 'Lasagne', image: 'https://existing.example.com/manual.jpg' }];
  await first.run('COOK', 'cookfood.net', items);
  assert.equal(items[0].image, 'https://existing.example.com/manual.jpg');
  assert.equal(first.requests.length, 0);
  for (const domain of [null, '', 'localhost', '127.0.0.1', 'https://internal.local', 'ftp://cookfood.net']) {
    const next = fixture([]);
    await next.run('COOK', domain, [{ name: 'Lasagne' }]);
    assert.equal(next.requests.length, 0, String(domain));
  }
  const missingKey = fixture([], {});
  await missingKey.run('COOK', 'cookfood.net', [{ name: 'Lasagne' }]);
  assert.equal(missingKey.requests.length, 0);
});
