import test from 'node:test';
import assert from 'node:assert/strict';
import { lotSizeIn, assetClassesIn, criteriaFit, assetIsLondon, assetProfile, approachesIn, useDetailsIn } from '../../shared/investment-fit.ts';

test('lot sizes are read from buyer notes', () => {
  assert.deepEqual(lotSizeIn('Commercial, hotel. £5-£25mn. M25 or crossrail'), { min: 5e6, max: 25e6 });
  assert.deepEqual(lotSizeIn('Distribution and Logistics £15m to £100m'), { min: 15e6, max: 100e6 });
  assert.deepEqual(lotSizeIn('Lot size: £3-15m+'), { min: 3e6, max: null });
  assert.deepEqual(lotSizeIn('happy up to £50m'), { min: null, max: 50e6 });
  assert.equal(lotSizeIn('Very BTR focused'), null);
});

test('uses, approaches and London are recognised', () => {
  assert.deepEqual(assetClassesIn('Commercial, hotel. £5-£25mn'), ['hotel']);
  assert.ok(assetClassesIn('Distribution and Logistics units').includes('industrial'));
  assert.deepEqual(useDetailsIn('Buys retail parks and supermarkets'), ['retail parks', 'supermarkets']);
  assert.deepEqual(approachesIn('Core-plus to value-add, some long income'), ['long income', 'core-plus', 'value-add']);
  assert.equal(assetIsLondon('Coldharbour Lane, Brixton, London SW9 8PS'), true);
  assert.equal(assetIsLondon('The Bridges, Market Square, Sunderland SR1 3LB'), false);
  assert.equal(assetIsLondon('Coventry London Rd CV3 4'), false, 'a London Road elsewhere is not London');
  assert.equal(assetIsLondon('London 522 Old Kent Rd SE1 5'), true);
});

test('the sale profile reads approach from its numbers', () => {
  const p = assetProfile({ assetType: 'Retail', name: 'The Bridges Shopping Centre', address: 'Sunderland SR1', occupancy: 78, waultExpiry: 4, guidePrice: 40e6 });
  assert.deepEqual(p.classes, ['retail']);
  assert.deepEqual(p.uses, ['shopping centres']);
  assert.ok(p.approaches.includes('value-add'));
  assert.equal(p.london, false);
  const li = assetProfile({ assetType: 'Retail', name: 'Supermarket', waultExpiry: 18, occupancy: 100 });
  assert.ok(li.approaches.includes('long income') && li.approaches.includes('core'));
});

test('use and approach outrank geography', () => {
  const centre = assetProfile({ assetType: 'Retail', name: 'The Bridges Shopping Centre', address: 'Sunderland SR1', occupancy: 78, waultExpiry: 4, guidePrice: 40e6 });
  const thematic = criteriaFit('Value-add shopping centres nationally, £20-80m', centre);
  const wrongUse = criteriaFit('Logistics in the North East, £20-80m', centre);
  const londonOnly = criteriaFit('Retail in London, £20-80m', centre);
  assert.ok(thematic.classHit && thematic.score >= 10, JSON.stringify(thematic));
  assert.deepEqual(thematic.reasons, ['buys retail', 'shopping centres', 'value-add', 'lot size £20m–£80m', 'national']);
  assert.ok(!wrongUse.classHit && wrongUse.score < 0, JSON.stringify(wrongUse));
  assert.ok(londonOnly.classHit && londonOnly.score < thematic.score, JSON.stringify(londonOnly));
});

test('"market" in a buyer note is not an F&B use', () => {
  assert.ok(!useDetailsIn('Logistics units with strong market demand').includes('F&B'));
  assert.deepEqual(useDetailsIn('Brixton Village food market and street food'), ['F&B']);
});
