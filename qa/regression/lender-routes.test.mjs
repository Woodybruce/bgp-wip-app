import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgres://unused@localhost:1/unused';
const { lenderNameWords, lenderAddressText } = await import('../../server/lender-routes.ts');

test('lender matching keeps the distinctive words only', () => {
  assert.deepEqual(lenderNameWords('Barclays Bank PLC'), ['barclays']);
  assert.deepEqual(lenderNameWords('Vahid Mirhadiyev'), ['vahid', 'mirhadiyev']);
  assert.deepEqual(lenderNameWords('OakNorth Bank'), ['oaknorth']);
  assert.deepEqual(lenderNameWords('Bank PLC'), []);
});

test('secured-property addresses reach the board as text', () => {
  assert.equal(lenderAddressText({ city: 'London', street: 'The Royal Exchange, Bank', postcode: 'EC3V 3LR' }), 'The Royal Exchange, Bank, London, EC3V 3LR');
  assert.equal(lenderAddressText(null, 'EC3V 3LR'), 'EC3V 3LR');
  assert.equal(lenderAddressText('1 High Street'), '1 High Street');
});
