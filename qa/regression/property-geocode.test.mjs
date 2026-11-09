import test from 'node:test';
import assert from 'node:assert/strict';
import { geocodeInputs, geocodeProperty, backfillPropertyCoordinates } from '../../server/property-geocode.ts';

// Ardent's board listed 19 properties but plotted 1 — imported rows carried a
// postcode and street but no latitude/longitude (Woody, 2026-09-28).
const ardent = [
  { id: 'rp', name: 'Royal Priors Shopping Centre, Leamington Spa', postcode: 'CV32 4XT', country: null,
    address: { city: 'Leamington Spa', street: 'Royal Priors Shopping Centre, Warwick Street', country: 'UK', postcode: 'CV32 4XT' } },
  { id: 'tw', name: 'Touchwood, Solihull', postcode: 'B91 3GJ', country: null, address: { street: 'Solihull' } },
  { id: 'np', name: 'Plaza 535', postcode: null, country: null, address: { street: "535 King's Road, Chelsea, London SW10 0SZ" } },
  { id: 'vg', name: 'Verdant', postcode: null, country: null, address: null },
  { id: 'ie', name: 'Dundrum Town Centre', postcode: null, country: 'IE', address: { formatted: 'Sandyford Road, Dundrum, Dublin 16' } },
];

test('a row yields its postcode, address text and country for the free geocoders', () => {
  assert.deepEqual(geocodeInputs(ardent[0]), {
    stored: null, country: 'GB', postcode: 'CV32 4XT',
    queries: ['Royal Priors Shopping Centre, Warwick Street, Leamington Spa, CV32 4XT', 'Royal Priors Shopping Centre, Leamington Spa'],
  });
  assert.equal(geocodeInputs(ardent[2]).postcode, 'SW10 0SZ', 'postcode found inside the street line');
  assert.deepEqual(geocodeInputs(ardent[3]).queries, [], 'a bare name is never sent to Nominatim');
  const ie = geocodeInputs(ardent[4]);
  assert.equal(ie.country, 'IE');
  assert.equal(ie.postcode, null, 'no postcodes.io lookup outside the UK');
  assert.deepEqual(geocodeInputs({ id: 'x', address: { lat: '51.51', lng: '-0.08' } }).stored, { lat: 51.51, lng: -0.08 });
});

test('backfill pins postcode rows, falls back to the address, and marks the rest unresolved', async () => {
  const updates = [];
  const pool = {
    async query(sql, params = []) {
      if (/^\s*SELECT/.test(sql)) {
        assert.match(sql, /geocode_status IS NULL/);
        return { rows: ardent };
      }
      if (/SET latitude/.test(sql)) { updates.push({ id: params[2], lat: params[0], lng: params[1] }); return { rowCount: 1 }; }
      if (/SET geocode_status = 'unresolved'/.test(sql)) { updates.push({ id: params[0], unresolved: true }); return { rowCount: 1 }; }
      throw new Error(`unexpected ${sql}`);
    },
  };
  const postcodes = [], addresses = [];
  const postcodeLookup = async pc => { postcodes.push(pc); return pc === 'CV32 4XT' ? { lat: 52.29, lng: -1.53 } : pc === 'B91 3GJ' ? { lat: 52.41, lng: -1.78 } : null; };
  const addressLookup = async (q, cc) => { addresses.push([q, cc]); return cc === 'IE' ? { lat: 53.29, lng: -6.24 } : null; };
  const out = await backfillPropertyCoordinates({ pool, postcodeLookup, addressLookup, delayMs: 0 });
  assert.deepEqual(out, { checked: 5, resolved: 3, unresolved: 2 });
  assert.deepEqual(updates.find(u => u.id === 'rp'), { id: 'rp', lat: '52.29', lng: '-1.53' });
  assert.deepEqual(updates.find(u => u.id === 'tw'), { id: 'tw', lat: '52.41', lng: '-1.78' });
  assert.ok(updates.find(u => u.id === 'np').unresolved);
  assert.ok(updates.find(u => u.id === 'vg').unresolved);
  assert.deepEqual(postcodes, ['CV32 4XT', 'B91 3GJ', 'SW10 0SZ']);
  assert.deepEqual(addresses, [["535 King's Road, Chelsea, London SW10 0SZ", 'GB'], ['Sandyford Road, Dundrum, Dublin 16', 'IE']]);
});

test('a row that already has a pin is never overwritten', async () => {
  let sql = '';
  const pool = { async query(s) { sql = s; return { rowCount: 0 }; } };
  const r = await geocodeProperty(ardent[0], { pool, postcodeLookup: async () => ({ lat: 1, lng: 1 }) });
  assert.equal(r, null);
  assert.match(sql, /WHERE id = \$3 AND \(latitude IS NULL OR latitude = ''/);
});
