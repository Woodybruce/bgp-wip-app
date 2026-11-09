import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgres://unused@localhost:1/unused';
const { mergeEntityMentions } = await import('../../server/account-entities.ts');

const mention = (name, extra = {}) => ({ source: 'crm_trading_entities', name, companiesHouseNumber: null, entityId: name, relation: 'trading_entity', relationConfidence: 'unresolved', evidence: `row ${name}`, ...extra });

test('unnumbered entities that differ only by Ltd / Limited show once', () => {
  const out = mergeEntityMentions([mention('Lemon Pepper Holdings Limited'), mention('Lemon Pepper Holdings Ltd')]);
  assert.equal(out.length, 1);
  assert.ok(out[0].evidence.some(e => /also listed as "Lemon Pepper Holdings Ltd"$/.test(e)));
});

test('an unnumbered twin still folds into the numbered entity', () => {
  const out = mergeEntityMentions([
    mention('BRITISH LAND COMPANY PUBLIC LIMITED COMPANY', { companiesHouseNumber: '00621920' }),
    mention('The British Land Company PLC'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].companiesHouseNumber, '00621920');
});

test('different entities stay apart', () => {
  assert.equal(mergeEntityMentions([mention('Nando\'s Chickenland Limited'), mention('Lemon Pepper Holdings Ltd')]).length, 2);
});
