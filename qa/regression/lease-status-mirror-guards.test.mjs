// A unit with a tenant still on it is never flattened to Vacant because its
// next letting moved on (15 November 2026: a schedule row worded
// "Opportunity", Burger King with two years to run, read as vacant once the
// successor's letting reached Negotiating, and the scheme's vacant count
// went up by one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unitOccupancy } from '../../shared/property-units.ts';

const mirror = readFileSync(new URL('../../server/lease-status-mirror.ts', import.meta.url), 'utf8');

test('the rent roll is not set to Vacant while the one occupancy rule reads the row as occupied', () => {
  const at = mirror.indexOf('async function writeTenancyStatus');
  const body = mirror.slice(at, mirror.indexOf('\n}\n', at));
  assert.match(body, /if \(!allowDowngrade && status === "Vacant"\) \{/);
  assert.match(body, /if \(row && unitOccupancy\(row\) === "occupied"\) return;/);
  assert.ok(body.indexOf('unitOccupancy(row) === "occupied"') < body.indexOf('UPDATE tenancy_schedule_units'), 'the check comes before the write');
  assert.match(mirror, /import \{ unitOccupancy \} from "@shared\/property-units";/);
});

test('a row worded another way, with a tenant on it, is occupied', () => {
  for (const status of ['Opportunity', 'Not Vacant', 'Lease Event', '']) {
    assert.equal(unitOccupancy({ status, tenant_name: 'BKUK Flame Limited', trading_name: 'Burger King', passing_rent_pa: 264537 }), 'occupied', status);
  }
  assert.equal(unitOccupancy({ status: 'Vacant', tenant_name: 'BKUK Flame Limited' }), 'vacant');
  assert.equal(unitOccupancy({ status: 'Opportunity', tenant_name: '', trading_name: '', passing_rent_pa: null }), 'unknown');
});
