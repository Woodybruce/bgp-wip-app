import test from 'node:test';
import assert from 'node:assert/strict';
import { landsecFloorLabel, isLandsecFloorCode } from '../../shared/landsec-floor.ts';

test('Landsec floor codes read as floor names; centre level names win', () => {
  assert.equal(landsecFloorLabel('99'), 'Basement');
  assert.equal(landsecFloorLabel('100'), 'Ground');
  assert.equal(landsecFloorLabel('101'), 'First');
  assert.equal(landsecFloorLabel('MultiFloorUnits'), 'Multiple floors');
  assert.equal(landsecFloorLabel('100', 'SVL02 Bluewater - Lower Level'), 'Lower Level');
  assert.equal(landsecFloorLabel('101', 'SVU04 & Adjoining Premises Bluewater - upper level'), 'Upper Level');
  assert.equal(landsecFloorLabel('Ground Floor'), 'Ground Floor');
  assert.equal(landsecFloorLabel(null), null);
  assert.equal(isLandsecFloorCode('Roof'), false);
});
