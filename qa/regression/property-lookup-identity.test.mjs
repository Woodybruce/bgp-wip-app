import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fullPropertyPostcode, postcodeFromPropertyAddress, propertyLookupIdentity } from '../../shared/property-lookup-identity.ts';
const require = createRequire(import.meta.url);
const { route, evaluate } = require('./source-harness.cjs');

test('unit identifiers and outward codes cannot masquerade as property postcodes', () => {
  for (const value of ['A1', 'D13', 'N14', 'W1B', '12345', '', null, {}]) assert.equal(fullPropertyPostcode(value), null);
  assert.equal(postcodeFromPropertyAddress('Unit A1, 12 Regent Street, London W1B 5AH'), 'W1B 5AH');
  assert.equal(postcodeFromPropertyAddress('Unit N14, London'), null);
  assert.equal(postcodeFromPropertyAddress({ street: 'Unit A1, High Street', postcode: 'sw1a1aa' }), 'SW1A 1AA');
  assert.equal(fullPropertyPostcode('gir0aa'), 'GIR 0AA');
});

test('canonical postcode and UPRN win without guessing a building number from a unit', () => {
  const property = { postcode: 'nw4 3fp', uprn: '100000123456', address: { street: 'Unit A1, Old Street W1B 5AH', streetNumber: '12-14' } };
  const before = structuredClone(property);
  assert.deepEqual(propertyLookupIdentity(property), { postcode: 'NW4 3FP', uprn: '100000123456', street: property.address.street, streetNumber: '12-14' });
  assert.deepEqual(property, before);
  assert.equal(propertyLookupIdentity({ address: 'Unit A1, High Street W1B 5AH' }).streetNumber, undefined);
  assert.equal(propertyLookupIdentity({ postcode: 'W1B', address: 'High Street SW1A 1AA', uprn: 'unverified' }).postcode, 'SW1A 1AA');
  assert.equal(propertyLookupIdentity({ uprn: '<invalid>' }).uprn, undefined);
});

test('property lookup route passes canonical identity to the provider service', async () => {
  let handler, input;
  evaluate(route('server/land-registry.ts', 'get', '/api/property-lookup'), {
    app: { get: (_url, _auth, callback) => { handler = callback; } }, requireAuth() {},
    require: name => {
      assert.equal(name, './property-lookup');
      return { performPropertyLookup: async args => { input = args; return { found: true }; } };
    },
  });
  let body;
  const res = { json: value => { body = value; }, status: () => res };
  await handler({ query: { postcode: 'NW4 3FP', uprn: '100000123456', streetNumber: '12-14', address: 'Unit A1, High Street' } }, res);
  assert.equal(body.found, true);
  assert.equal(input.uprn, '100000123456');
  assert.equal(input.streetNumber, '12-14');
  assert.equal(input.address, 'Unit A1, High Street');
});
