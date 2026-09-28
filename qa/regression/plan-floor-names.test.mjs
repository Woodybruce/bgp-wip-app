import assert from 'node:assert/strict';
import test from 'node:test';
import { tidyFloorName } from '../../server/property-plan-links.ts';

test('floor names read off drawings show one way', () => {
  assert.equal(tidyFloorName('FIRST FLOOR'), 'First Floor');
  assert.equal(tidyFloorName('Second floor'), 'Second Floor');
  assert.equal(tidyFloorName('First, Second, Third &amp; Fourth Floors'), 'First, Second, Third & Fourth Floors');
  assert.equal(tidyFloorName('LG floor'), 'LG Floor');
  assert.equal(tidyFloorName('Level B1'), 'Level B1');
  assert.equal(tidyFloorName('OS site plan'), 'OS Site Plan');
  assert.equal(tidyFloorName('GROUND AND MEZZANINE'), 'Ground and Mezzanine');
  assert.equal(tidyFloorName(''), '');
  assert.equal(tidyFloorName(null), '');
});
