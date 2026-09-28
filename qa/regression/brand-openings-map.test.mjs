import test from 'node:test';
import assert from 'node:assert/strict';
import { withoutOpenedPlans, metresApart, syncOpeningStores } from '../../server/brand-openings-map.ts';

test('a planned opening beside a mapped store is dropped; elsewhere it stays', () => {
  const stores = [
    { id: 'open', lat: 51.4456, lng: -2.5662, status: 'open', source_type: 'google_places_verified' },
    { id: 'same-site', lat: 51.4459, lng: -2.5660, status: 'coming_soon', source_type: 'news_signal' },
    { id: 'new-site', lat: 51.5074, lng: -0.1278, status: 'coming_soon', source_type: 'news_signal' },
    { id: 'deal', lat: 51.5075, lng: -0.1279, status: 'coming_soon', source_type: 'bgp_deal' },
  ];
  assert.deepEqual(withoutOpenedPlans(stores).map(s => s.id), ['open', 'new-site', 'deal']);
  assert.ok(metresApart({ lat: 51.4456, lng: -2.5662 }, { lat: 51.4459, lng: -2.5660 }) < 150);
});

test('opening signals become coming-soon stores once; town-only and opened sites are skipped', async () => {
  const writes = [];
  const settings = new Map();
  const pool = {
    async query(sql, params = []) {
      if (/FROM crm_companies/.test(sql)) return { rows: [{ id: 'b1', name: 'Wingstop' }] };
      if (/SELECT value FROM system_settings/.test(sql)) return { rows: settings.has(params[0]) ? [{ value: settings.get(params[0]) }] : [] };
      if (/FROM brand_signals/.test(sql)) return { rows: [
        { id: 's1', headline: 'Wingstop to open at Castlepoint, Bournemouth', detail: null, source: 'news', at: '2026-09-01' },
        { id: 's2', headline: 'Wingstop eyes more sites in Leeds', detail: null, source: 'news', at: '2026-09-02' },
        { id: 's3', headline: 'Wingstop opens in Cardiff Queen Street', detail: null, source: 'news', at: '2026-08-01' },
      ] };
      if (/FROM brand_stores/.test(sql)) return { rows: [] };
      if (/INSERT INTO brand_stores/.test(sql)) { writes.push(params); return { rowCount: 1 }; }
      if (/INSERT INTO system_settings/.test(sql)) { settings.set(params[0], JSON.parse(params[1])); return { rowCount: 1 }; }
      throw new Error(`unexpected ${sql}`);
    },
  };
  const read = async () => ({ s1: { venue: 'Castlepoint', town: 'Bournemouth', planned: true }, s3: { street: 'Queen Street', town: 'Cardiff', planned: false } });
  const geocode = async () => ({ lat: 50.75, lng: -1.83, formattedAddress: 'Castlepoint Shopping Centre, Castle Ln W, Bournemouth BH8 9UW, UK' });
  const first = await syncOpeningStores('b1', { pool, read, geocode });
  assert.equal(first.added, 1);
  assert.equal(writes[0][1], 'Wingstop Castlepoint');
  assert.equal(writes[0][5], 'signal:s1');
  const again = await syncOpeningStores('b1', { pool, read, geocode });
  assert.equal(again.read, 0, 'each signal is read once');
});

test('a website venue named after the brand in a town with one mapped store is that store', async () => {
  const deleted = [], updated = [];
  const pool = {
    async query(sql, params = []) {
      if (/SELECT value FROM system_settings/.test(sql)) return { rows: [] };
      if (/source_type = 'official_website' AND lat IS NULL/.test(sql)) return { rows: [
        { id: 'w1', name: 'Wake The Tiger Amazement Park', address: 'Bristol' },
        { id: 'w2', name: 'Dream Factory', address: 'Bristol' },
        { id: 'w3', name: 'Absurd City', address: 'London' },
      ] };
      if (/FROM crm_companies/.test(sql)) return { rows: [{ id: 'b', name: 'Wake the Tiger' }] };
      if (/lat IS NOT NULL/.test(sql)) return { rows: [{ address: 'Wake The Tiger, 127 Albert Rd, Bristol BS2 0YA' }] };
      if (/SELECT place_id/.test(sql)) return { rows: [{ place_id: 'gp1' }] };
      if (/^DELETE/.test(sql.trim())) { deleted.push(params[0]); return { rowCount: 1 }; }
      if (/^UPDATE/.test(sql.trim())) { updated.push(params); return { rowCount: 1 }; }
      if (/INSERT INTO system_settings/.test(sql)) return { rowCount: 1 };
      throw new Error(sql);
    },
  };
  const { locateWebsiteStoresFor } = await import('../../server/brand-openings-map.ts');
  const findPlace = async (_c, items) => items.map(i => i.name === 'Dream Factory' ? { placeId: 'gp1', address: 'x', lat: 1, lng: 1 } : i.name === 'Absurd City' ? { placeId: 'gp2', address: '1 Somewhere St, London', lat: 51.5, lng: -0.1 } : null);
  const out = await locateWebsiteStoresFor('b', { pool, findPlace });
  assert.deepEqual(deleted, ['w1', 'w2']);
  assert.equal(out.located, 1);
  assert.equal(updated[0][0], 'w3');
});
