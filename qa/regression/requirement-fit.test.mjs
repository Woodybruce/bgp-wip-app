import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReqSize, pitchFitWords, requirementFitsUnit } from '../../shared/requirement-fit.ts';

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

test('a pitch says "Fits" only inside the stated range and at a place the requirement names', () => {
  const req = { size: ['5', '000 - 10', '000 sq ft'], requirement_locations: ['Manchester', 'Birmingham'] };
  const kent = 'Bluewater Shopping Centre Greenhithe Kent DA9';
  // Inside the 20% tolerance but outside 5,000 to 10,000: never "Fits".
  assert.equal(pitchFitWords(req, { sqft: 11044, property_text: kent }), 'Close to');
  assert.equal(pitchFitWords(req, { sqft: 4803, property_text: kent }), 'Close to');
  assert.equal(pitchFitWords(req, { sqft: 4898, property_text: 'Arndale Manchester M4' }), 'Close to');
  // Inside the stated range, at a place the requirement does not name: the size fits, no more.
  assert.equal(pitchFitWords(req, { sqft: 6200, property_text: kent }), 'Size fits');
  assert.equal(pitchFitWords(req, { sqft: 6200, property_text: 'Arndale Manchester M4' }), 'Fits');
  assert.equal(pitchFitWords(req, { sqft: 5000, property_text: 'Bullring Birmingham B5' }), 'Fits');
  // A requirement that names no place is judged on its size alone.
  assert.equal(pitchFitWords({ size: '1500-3000 ft2' }, { sqft: 3000, property_text: kent }), 'Fits');
  assert.equal(pitchFitWords({ size: '1500-3000 ft2' }, { sqft: 3400, property_text: kent }), 'Close to');
  // "2000+" has no upper limit as stated; a single figure is only ever close.
  assert.equal(pitchFitWords({ size: '2000- ft2' }, { sqft: 9000, property_text: kent }), 'Fits');
  assert.equal(pitchFitWords({ size: '2000- ft2' }, { sqft: 1700, property_text: kent }), 'Close to');
  assert.equal(pitchFitWords({ size: '4000 sq ft' }, { sqft: 4400, property_text: kent }), 'Close to');
  // Outside the tolerance, or no size to judge: no sentence at all.
  assert.equal(pitchFitWords(req, { sqft: 20000, property_text: kent }), null);
  assert.equal(pitchFitWords(req, { sqft: null, property_text: kent }), null);
  assert.equal(pitchFitWords({ size: ['flexible'] }, { sqft: 3000, property_text: kent }), null);
});

test('the suggested pitch sentence takes its opening words from that rule', () => {
  const crm = readFileSync(new URL('../../server/crm.ts', import.meta.url), 'utf8');
  const route = crm.slice(crm.indexOf('app.get("/api/brands/:id/suggested-pitches"'), crm.indexOf('app.get("/api/available-units/:id/brand-suggestions"'));
  assert.match(route, /pitchFitWords\(liveReq, \{ sqft: sq, property_text:/);
  assert.match(route, /reason: `\$\{words\} their \$\{reqSize\} requirement: /);
  assert.doesNotMatch(route, /reason: `Fits their/);
  // The place text is for the wording only: it is not sent with the row.
  assert.match(route, /delete row\.place_text;/);
});
