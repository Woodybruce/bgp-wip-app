import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPortfolioContactsQuery } from '../../server/portfolio-contacts.ts';

const golden = join(dirname(fileURLToPath(import.meta.url)), '__golden__', 'portfolio-contacts-query.txt');

function snapshot() {
  return [true, false].map((hasOverrides) => {
    const query = buildPortfolioContactsQuery('c', null, 'false', hasOverrides);
    return `=== hasOverrides=${hasOverrides}\n--- values\n${JSON.stringify(query.values)}\n--- text\n${query.text}\n`;
  }).join('');
}

test('the portfolio contacts query text and values are byte-identical to the golden copy', () => {
  if (process.env.UPDATE_PORTFOLIO_GOLDEN === '1') {
    mkdirSync(dirname(golden), { recursive: true });
    writeFileSync(golden, snapshot());
  }
  assert.ok(existsSync(golden), 'the golden copy is missing');
  assert.equal(snapshot(), readFileSync(golden, 'utf8'));
});
