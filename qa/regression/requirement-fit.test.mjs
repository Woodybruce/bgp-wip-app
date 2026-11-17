import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReqSize, pitchFitWords, requirementFitsUnit, requirementUseFits, spreadAcrossCentres } from '../../shared/requirement-fit.ts';

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

// Audit, 2026-11-17: units hold planning classes, requirements hold uses.
test('a unit\'s planning class is read as the uses a requirement names', () => {
  const fits = (use, use_class, unit_name = 'Unit 12') => requirementUseFits(use, { use_class, unit_name });
  // Food and drink: E(b) and the old A3, A4 and A5; A1 Food goes with cafés and shops.
  for (const cls of ['E(b)', 'A3', 'e (b)', 'A4', 'A5', 'A1/A3']) assert.equal(fits(['Restaurant'], cls), true, cls);
  assert.equal(fits(['Restaurant'], 'E(a)'), false);
  assert.equal(fits(['A1 Food'], 'E(b)'), true);
  assert.equal(fits(['A1 Food'], 'E(a)'), true);
  // Shops: E(a) and A1, never a restaurant unit.
  assert.equal(fits(['Retail'], 'E(a)'), true);
  assert.equal(fits(['Retail'], 'A1'), true);
  assert.equal(fits(['Retail'], 'E(b)'), false);
  assert.equal(fits(['Retail'], 'E(b)', 'Coffee Shop'), false);
  // Gyms and leisure: E(d) and D2; Sui Generis takes cinemas, pubs and takeaways.
  assert.equal(fits(['Gym'], 'E(d)'), true);
  assert.equal(fits(['Gym'], 'D2'), true);
  assert.equal(fits(['Gym'], 'E(b)'), false);
  assert.equal(fits(['Leisure'], 'Sui Generis'), true);
  assert.equal(fits(['Leisure'], 'E(a)'), false);
  assert.equal(fits(['Wellness'], 'E(e)'), true);
  assert.equal(fits(['Other'], 'E(c)'), true);
  assert.equal(fits(['Other'], 'E(g)(i)'), true);
  assert.equal(fits(['Other'], 'E(a)'), false);
  // Class E on its own takes every use; its parts are Class E.
  assert.equal(fits(['Retail'], 'E'), true);
  assert.equal(fits(['Gym'], 'Class E (Commercial, Business and Service)'), true);
  assert.equal(fits(['E'], 'E(d)'), true);
  assert.equal(fits(['Class E'], 'Sui Generis'), false);
  // A requirement holding class text (an import's raw use class).
  assert.equal(fits(['A3'], 'E(b)'), true);
  assert.equal(fits(['E(b)'], 'A3'), true);
  assert.equal(fits(['A3'], 'E(a)'), false);
  // The words USE_HINTS knows, on the unit's name, and the same text either side.
  assert.equal(fits(['Restaurant'], 'E(a)', 'Kiosk K3'), true);
  assert.equal(fits(['restaurant'], 'Restaurant'), true);
  // A side with no use stated fits (on size alone, where the caller checks size).
  assert.equal(fits(null, 'E(b)'), true);
  assert.equal(fits([], 'E(b)'), true);
  assert.equal(fits(['Restaurant'], null), true);
  assert.equal(fits(['Restaurant'], '  '), true);
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

test('suggested pitches take the best unit at each centre before a second unit at any', () => {
  // Jersey Mike's (Woody, 2026-11-16): six Gunwharf units ranked first, so
  // nothing elsewhere was shown.
  const ranked = [
    ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map(id => ({ id, centre: 'gunwharf' })),
    { id: 't1', centre: 'trinity' }, { id: 'w1', centre: 'westgate' }, { id: 't2', centre: 'trinity' },
  ];
  assert.deepEqual(spreadAcrossCentres(ranked, r => r.centre).slice(0, 6).map(r => r.id), ['g1', 't1', 'w1', 'g2', 't2', 'g3']);
  // Within a centre, and among the centres, the ranking's order is kept.
  const one = [{ id: 'a', centre: 'x' }, { id: 'b', centre: 'x' }, { id: 'c', centre: 'x' }];
  assert.deepEqual(spreadAcrossCentres(one, r => r.centre).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(spreadAcrossCentres([], r => r.centre), []);
  // The route spreads the ranked list before it takes six.
  const crm = readFileSync(new URL('../../server/crm.ts', import.meta.url), 'utf8');
  const route = crm.slice(crm.indexOf('app.get("/api/brands/:id/suggested-pitches"'), crm.indexOf('app.get("/api/available-units/:id/brand-suggestions"'));
  assert.match(route, /spreadAcrossCentres\(suggestions, s => String\(s\.property_id\)\)\.slice\(0, 6\)/);
  assert.doesNotMatch(route, /suggestions: suggestions\.slice\(0, 6\)/);
});
