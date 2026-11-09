import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReqSize, requirementFitsUnit } from '../../shared/requirement-fit.ts';

test('requirement size text becomes a tolerance-widened range', () => {
  assert.deepEqual(parseReqSize(['1,500-3,000 sq ft']), { min: 1200, max: 3600 });
  assert.equal(parseReqSize(['flexible']), null);
});

test('a unit fits a live requirement on size plus use or location', () => {
  const req = { size: ['2,000-3,000 sq ft'], use: ['Restaurant'], requirement_locations: ['Portsmouth'] };
  assert.equal(requirementFitsUnit(req, { sqft: 2500, unit_text: 'Unit 12 F&B', property_text: 'Gunwharf Quays Portsmouth PO1' }), true);
  assert.equal(requirementFitsUnit(req, { sqft: 9000, unit_text: 'Unit 12 F&B', property_text: 'Gunwharf Quays Portsmouth PO1' }), false, 'too big');
  assert.equal(requirementFitsUnit(req, { sqft: 2500, unit_text: 'Unit 3', property_text: 'Trinity Leeds LS1' }), false, 'size alone is not enough');
  assert.equal(requirementFitsUnit(req, { sqft: null, unit_text: 'Kiosk food', property_text: 'Portsmouth' }), true, 'no size needs use and location');
  assert.equal(requirementFitsUnit({ ...req, requirement_locations: ['London'] }, { sqft: 2500, unit_text: 'Unit 3', property_text: 'One New Change London EC4' }), false, 'bare London is too broad');
});
