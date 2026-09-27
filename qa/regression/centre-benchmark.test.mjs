import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL ||= 'postgres://test@127.0.0.1:1/test';
const { UK_CENTRES, TOP_25_CENTRES, centreAt } = await import('../../shared/uk-centres.ts');
const { isOpeningHeadline, brandNamed } = await import('../../server/centre-openings.ts');

test('benchmark set is the top 25 plus Battersea and the Shaftesbury Capital estates', () => {
  assert.equal(TOP_25_CENTRES.length, 29);
  for (const name of ['Bluewater', 'Trafford Centre', 'Battersea Power Station', 'Covent Garden', 'Carnaby', 'Chinatown London']) {
    assert.ok(TOP_25_CENTRES.some(c => c.name === name), name);
  }
  assert.equal(new Set(UK_CENTRES.map(c => c.name)).size, UK_CENTRES.length);
});

test('a property on a centre resolves to it; West End estates keep their own tight radius', () => {
  assert.equal(centreAt(51.4392, 0.271)?.name, 'Bluewater');
  assert.equal(centreAt(51.5129, -0.1387)?.name, 'Carnaby');
  assert.equal(centreAt(51.5117, -0.1233)?.name, 'Covent Garden');
  assert.equal(centreAt(51.52, -0.1)?.name ?? null, null);
});

test('opening headlines are kept; closures and property-market stories are not', () => {
  assert.ok(isOpeningHeadline('Danish fashion retailer Jack & Jones signs at Bluewater shopping centre'));
  assert.ok(isOpeningHeadline('Footasylum to open Trinity Leeds store'));
  assert.ok(isOpeningHeadline('Blue Note London Opens — New York’s Legendary Jazz Club Arrives In Covent Garden'));
  assert.ok(!isOpeningHeadline('Clearbell launches £80m Covent Garden office sale'));
  assert.ok(!isOpeningHeadline('Store at Bluewater to close next month'));
  assert.ok(!isOpeningHeadline('Covent Garden restaurant launches bottomless pasta brunch'));
});

test('brand names link whole-word, longest first, single words case-sensitive', () => {
  const list = [
    { id: '2', name: 'Five Guys', re: /(^|[^A-Za-z0-9])Five Guys('s)?([^A-Za-z0-9]|$)/i },
    { id: '1', name: 'Moida', re: /(^|[^A-Za-z0-9])Moida('s)?([^A-Za-z0-9]|$)/ },
  ];
  assert.equal(brandNamed('Moida opens at Trinity Leeds', list)?.id, '1');
  assert.equal(brandNamed('five guys to open at Bluewater', list)?.id, '2');
  assert.equal(brandNamed('Moidas opens', list), null);
});
