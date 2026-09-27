import test from 'node:test';
import assert from 'node:assert/strict';
import { lotSizeIn, assetClassesIn, criteriaFit, assetIsLondon } from '../../shared/investment-fit.ts';

test('lot sizes are read from buyer notes', () => {
  assert.deepEqual(lotSizeIn('Commercial, hotel. £5-£25mn. M25 or crossrail'), { min: 5e6, max: 25e6 });
  assert.deepEqual(lotSizeIn('Distribution and Logistics £15m to £100m'), { min: 15e6, max: 100e6 });
  assert.deepEqual(lotSizeIn('Lot size: £3-15m+'), { min: 3e6, max: null });
  assert.deepEqual(lotSizeIn('happy up to £50m'), { min: null, max: 50e6 });
  assert.equal(lotSizeIn('Very BTR focused'), null);
});

test('asset classes and London are recognised', () => {
  assert.deepEqual(assetClassesIn('Commercial, hotel. £5-£25mn'), ['hotel']);
  assert.ok(assetClassesIn('Distribution and Logistics units').includes('industrial'));
  assert.equal(assetIsLondon('Coldharbour Lane, Brixton, London SW9 8PS'), true);
  assert.equal(assetIsLondon('The Bridges, Market Square, Sunderland SR1 3LB'), false);
});

test('a buyer fits on class, lot size and location, with reasons', () => {
  const brixton = { classes: ['retail'], guidePrice: 50e6, address: 'Brixton Village, London SW9 8PS' };
  const good = criteriaFit('Retail and leisure in London, £20-80m', brixton);
  assert.ok(good.score >= 7, JSON.stringify(good));
  assert.deepEqual(good.reasons, ['buys retail', 'lot size £20m–£80m', 'London']);
  const wrong = criteriaFit('Distribution and Logistics £15m to £100m', brixton);
  assert.ok(wrong.score < 3, JSON.stringify(wrong));
});
