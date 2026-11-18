import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The deploy smoke check failed on 16 and 17 November 2026 with a 504 from
// /api/property-lookup (Bluewater, DA9 9ST): outside calls with no time limit
// ran past the 45 second request limit. Every call now carries its own.
const source = readFileSync(new URL('../../server/property-lookup.ts', import.meta.url), 'utf8');

function fetchCalls(text) {
  const calls = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('fetch(', from);
    if (at < 0) return calls;
    let depth = 0;
    let end = at + 'fetch'.length;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')' && --depth === 0) break;
    }
    calls.push(text.slice(at, end + 1));
    from = end + 1;
  }
}

test('every outside call in the property lookup has its own time limit', () => {
  const calls = fetchCalls(source);
  assert.ok(calls.length >= 15, `expected the lookup's calls, found ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /signal:\s*AbortSignal\.timeout\(/, `no time limit on: ${call.slice(0, 120)}`);
  }
});

test('the time limits leave room inside the 45 second request limit', () => {
  const ms = name => Number(source.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
  const geocode = ms('GEOCODE_TIMEOUT_MS');
  const sourceLimit = ms('SOURCE_TIMEOUT_MS');
  const pricePaid = ms('PRICE_PAID_TIMEOUT_MS');
  assert.ok(geocode > 0 && sourceLimit > 0 && pricePaid > 0);
  // The longest chain: a geocode, then the two flood calls one after another.
  assert.ok(geocode + 2 * sourceLimit < 45000);
  assert.ok(pricePaid < 45000);
});

test('a price paid refusal or timeout is not cached for 30 days as no sales', () => {
  const fn = source.slice(source.indexOf('async function lookupPricePaid'), source.indexOf('async function lookupVOA'));
  assert.match(fn, /if \(!resp\.ok\) throw new Error\(/);
  assert.doesNotMatch(fn, /if \(!resp\.ok\) return \[\];/);
  // The catch that turns a failure into an empty list sits outside cached().
  assert.ok(fn.indexOf('return await cached(') < fn.lastIndexOf('} catch (e) {'));
});
