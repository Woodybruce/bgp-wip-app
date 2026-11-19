import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  FIT_POOL_STATUSES, fitScore, parseReqSize, pitchFitWords, requirementFit, requirementFitsUnit, requirementPlaceIn, requirementUseFits,
  requirementUseLinesUp, spreadAcrossCentres, unitFitGaps,
} from '../../shared/requirement-fit.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

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

// ── The one fit rule (Woody, 2026-11-19) ─────────────────────────────────
// Decision 2 of docs/requirements-board-review-2026-11-19.md: "size and use
// or place". Before it there were nine ways to decide a fit, and two of them
// disagreed on the same row of the requirements board.
const KENT = 'Bluewater Shopping Centre Greenhithe Kent DA9 9ST';

test('the one fit rule: the size and the use or a named place; with no size to compare, both', () => {
  const restaurant = { size: ['1,500-3,000 sq ft'], use: ['Restaurant'], requirement_locations: null };
  const at = (sqft, use_class, unit_name = 'Unit 4', property_text = KENT) => ({ sqft, use_class, unit_name, property_text });
  assert.deepEqual(requirementFit(restaurant, at(2000, 'E(b)')), { fits: true, size: 'fits', use: true, place: null, why: 'Size and use fit' });
  // Size alone is never enough, and a unit with no use class cannot line up on use.
  assert.equal(requirementFit(restaurant, at(2000, 'E(a)')).fits, false);
  assert.equal(requirementFit(restaurant, at(2000, null)).fits, false);
  assert.equal(requirementFit(restaurant, at(2000, null)).why, 'Size fits, but neither the use nor the place lines up');
  // The unit's name can carry the use, as USE_HINTS reads it.
  assert.equal(requirementFit(restaurant, at(2000, null, 'Restaurant unit 4')).fits, true);
  // Outside the range never fits.
  assert.deepEqual(requirementFit(restaurant, at(9000, 'E(b)')), { fits: false, size: 'outside', use: true, place: null, why: 'Outside their size range' });
  // A named place stands in for the use, and the reason names it.
  const placed = { size: ['1,500-3,000 sq ft'], use: null, requirement_locations: ['Leeds', 'Kent'] };
  assert.deepEqual(requirementFit(placed, at(2000, null)), { fits: true, size: 'fits', use: false, place: 'Kent', why: 'Size fits, at Kent' });
  assert.equal(requirementFit({ ...placed, use: ['Restaurant'] }, at(2000, 'E(b)')).why, 'Size and use fit, at Kent');
  // With no size to compare (the unit's or the requirement's), both are needed.
  const noSize = { size: null, use: ['Restaurant'], requirement_locations: ['Kent'] };
  assert.equal(requirementFit(noSize, at(9000, 'E(b)')).fits, true);
  assert.equal(requirementFit(noSize, at(9000, 'E(b)')).why, 'Use fits, at Kent; no size to compare');
  assert.equal(requirementFit(noSize, at(2000, null)).fits, false);
  assert.equal(requirementFit({ ...restaurant, requirement_locations: ['Kent'] }, at(null, 'E(b)')).fits, true);
  assert.equal(requirementFit(restaurant, at(null, 'E(b)')).fits, false, 'no unit size and no place');
  assert.equal(requirementFit(restaurant, at(null, 'E(b)')).size, 'unknown');
  // The older shape keeps its callers' answers.
  assert.equal(requirementFitsUnit(restaurant, { sqft: 2000, unit_text: 'Unit 12 F&B', property_text: KENT }), true);
});

test('a use needs stating on both sides, and London, a region or "national" places nothing', () => {
  assert.equal(requirementUseLinesUp(['Restaurant'], { use_class: 'A3' }), true);
  assert.equal(requirementUseLinesUp(['Gym'], { use_class: 'E(d)' }), true);
  assert.equal(requirementUseLinesUp(['Retail'], { use_class: 'E(b)', unit_name: 'Coffee Shop' }), false);
  // Unlike requirementUseFits (the investment dialog's rule), a missing side never lines up.
  assert.equal(requirementUseFits(null, { use_class: 'E(b)' }), true);
  assert.equal(requirementUseLinesUp(null, { use_class: 'E(b)' }), false);
  assert.equal(requirementUseLinesUp(['Restaurant'], { use_class: null, unit_name: null }), false);
  assert.equal(requirementUseLinesUp(['Restaurant'], { use_class: '  ', unit_name: 'Unit 9' }), false);
  for (const vague of ['London', 'Greater London', 'Central London (Zone 1)', 'UK', 'England', 'National', 'Nationwide']) {
    assert.equal(requirementPlaceIn([vague], 'One New Change London EC4 UK England national'), null, vague);
  }
  assert.equal(requirementPlaceIn(['Manchester', 'Greenhithe'], KENT), 'Greenhithe');
  assert.equal(requirementPlaceIn(['Bath'], 'Bathgate Road'), 'Bath', 'a place is matched as text in the name or address');
  assert.equal(requirementPlaceIn(['Ox'], 'Oxford'), null, 'two letters are too short to place a unit');
  assert.equal(requirementPlaceIn(['Kent'], ''), null);
});

test('fits are ordered one way, and the board matches over the units on the market', () => {
  assert.equal(fitScore({ size: 'fits', use: true, place: 'Kent' }), 4);
  assert.equal(fitScore({ size: 'fits', use: true, place: null }), 3);
  assert.equal(fitScore({ size: 'unknown', use: true, place: 'Kent' }), 2);
  assert.deepEqual([...FIT_POOL_STATUSES], ['AVA', 'NEG']);
});

test('a unit on the market is listed for filling in when it has no use class or no size', () => {
  assert.deepEqual(unitFitGaps({ sqft: 2000, use_class: 'E(b)' }), []);
  assert.deepEqual(unitFitGaps({ sqft: null, use_class: 'E(b)' }), ['size']);
  assert.deepEqual(unitFitGaps({ sqft: '0', use_class: ' ' }), ['use', 'size']);
  assert.deepEqual(unitFitGaps({ sqft: '1200', use_class: null }), ['use']);
});

test('every screen that says a requirement fits a unit asks requirementFit', () => {
  const crm = read('server/crm.ts');
  const fitsColumn = crm.slice(crm.indexOf('app.get("/api/crm/requirements-leasing/matches"'));
  const fitsRoute = fitsColumn.slice(0, fitsColumn.indexOf('\n  app.'));
  assert.match(fitsRoute, /requirementFit\(r, \{ sqft: u\.sqft, use_class: u\.use_class, unit_name: u\.unit_name, property_text:/);
  assert.match(fitsRoute, /au\.marketing_status = ANY\(\$2::text\[\]\)/);
  assert.match(fitsRoute, /\[scopeCompanyId, \[\.\.\.FIT_POOL_STATUSES\]\]/);
  assert.match(fitsRoute, /scheduleRowId: u\.schedule_row_id \|\| null/);
  assert.match(fitsRoute, /why: fit\.why, score: fitScore\(fit\)/);
  // "size?" is the unit's own size missing, never a requirement that gives none.
  assert.match(fitsRoute, /sizeUnknown: !\(Number\(u\.sqft\) > 0\)/);
  assert.doesNotMatch(fitsRoute, /USE_HINTS|parseReqSize/);
  const suggestions = crm.slice(crm.indexOf('app.get("/api/available-units/:id/brand-suggestions"'), crm.indexOf('app.get("/api/crm/requirements-leasing/matches"'));
  assert.match(suggestions, /const fit = requirementFit\(r, \{ sqft, use_class: unit\.use_class, unit_name: unit\.unit_name, property_text: propText \}\);\s+if \(!fit\.fits\) continue;/);
  assert.match(suggestions, /fitWhy: fit\.why/);
  const pitches = crm.slice(crm.indexOf('app.get("/api/brands/:id/suggested-pitches"'), crm.indexOf('app.get("/api/available-units/:id/brand-suggestions"'));
  assert.match(pitches, /const fit = liveReq \? requirementFit\(liveReq, \{ sqft: sq, use_class: u\.use_class, unit_name: u\.unit_name, property_text:/);
  assert.match(pitches, /if \(fit\?\.fits\) \{/);

  const server = read('server/routes.ts');
  const unitsFor = server.slice(server.indexOf('app.get("/api/requirements/matches/:requirementId"'), server.indexOf('app.get("/api/available-units/matches/:unitId"'));
  assert.match(unitsFor, /WHERE au\.marketing_status = ANY\(\$1::text\[\]\)/);
  assert.match(unitsFor, /requirementFit\(requirement, \{ sqft: u\.sqft, use_class: u\.use_class, unit_name: u\.unit_name, property_text: placeText\(u\) \}\)/);
  assert.match(unitsFor, /fitScore\(b\.fit\) - fitScore\(a\.fit\)/);
  assert.match(unitsFor, /fit_why: fit\.why, fit_count: fits\.length/);
  const requirementsFor = server.slice(server.indexOf('app.get("/api/available-units/matches/:unitId"')).slice(0, 6000);
  assert.match(requirementsFor, /requirementFit\(r, \{ sqft: unit\.sqft, use_class: unit\.use_class, unit_name: unit\.unit_name, property_text: unitPlaceText \}\)/);
  assert.match(requirementsFor, /fit_why: fitWhy\.get\(String\(r\.id\)\) \|\| null/);

  for (const file of ['server/account-teams.ts', 'server/target-tenant-engine.ts', 'server/property-gap-analysis.ts']) {
    const text = read(file);
    assert.match(text, /requirementFit\(/, file);
    assert.doesNotMatch(text, /requirementFitsUnit\(|requirementUseFits\(/, file);
  }
  // The Brand CRM chip reads the rule with the unit's use and the requirement's.
  const chip = find('shared/brand-stage.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'chipFor');
  assert.match(chip, /const fit = requirementFit\(\{ size: req\.size \?\? null, use: req\.use \?\? null, requirement_locations: places \}/);
  assert.match(chip, /if \(fit\.fits\) return \{ chip: "fits"/);
  const plan = read('server/brand-scheme-plan.ts');
  assert.match(plan, /\(\{ id: r\.id, size: r\.size, use: r\.use, locations: r\.requirement_locations, dealId: r\.deal_id \}\)/);
  assert.match(plan, /useClass: info\?\.useClass \?\? null, unitName: info\?\.unitName \?\? null/);
  assert.match(plan, /au\.use_class AS tracker_use_class/);
  // A joint agent is not told the requirement's places through the reason.
  assert.match(plan, /chip\.requirementId = null; chip\.range = null; chip\.why = null;/);
});

// Since 19 November 2026 the board's rows come from its own feed
// (server/requirements-board.ts) and a row opens the requirement panel, whose
// "Where it fits" lists every unit; the old Fits column and Match dialog went.
test('the board: each fit opens the unit and says why; the property chips are gone; the panel lists every fit', () => {
  const page = read('client/src/pages/requirements.tsx');
  assert.doesNotMatch(page, /propertyMatchMap|req-prop-match-|RequirementMatchesDialog|requirements-leasing\/matches/);
  const rows = read('client/src/components/requirements-board/board-rows.tsx');
  assert.match(rows, /return propertyUnitHref\(fit\.propertyId, fit\.scheduleRowId\) \|\| trackerUnitHref\(fit\.unitId, fit\.propertyId, viewer\)/);
  assert.match(rows, /<Link href=\{fitHref\(best, unitViewer\)\}/);
  assert.match(rows, /title=\{best\.why\}>\{best\.why\}</);
  const panel = read('client/src/components/requirements-board/requirement-panel.tsx');
  assert.match(panel, /`\/api\/crm\/requirements-board\/\$\{encodeURIComponent\(id\)\}\/fits`/);
  assert.match(panel, /<Link href=\{fitHref\(fit, unitViewer\)\}/);
  assert.match(panel, /\{fit\.why\}/);
  // Add as target is a button on every fit, never shown on hover only.
  assert.match(panel, /data-testid=\{`requirement-panel-add-target-\$\{fit\.unitId\}`\}/);
  assert.doesNotMatch(panel + rows, /opacity-0 group-hover/);
  // Want at this scheme (the Brand CRM's Wanted line) is BGP staff's.
  assert.match(panel, /\{staff && row\.brandId && fit\.propertyId && \(/);
  const tracker = find('client/src/pages/available-units.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'UnitMatchesDialog');
  assert.match(tracker, /req\.fit_why/);
  assert.match(tracker, /href=\{`\/requirements\?requirementId=\$\{encodeURIComponent\(req\.id\)\}`\}/);
  assert.match(tracker, /data-testid="match-reqs-empty"/);
  assert.match(read('client/src/components/suggest-targets-dialog.tsx'), /s\.fitWhy/);
  assert.match(read('client/src/components/brand-crm/scheme-plan-card.tsx'), /chip === "fits" && why/);
});

test('the units to fill in: BGP staff only, read from the units on the market, and nothing is written', async () => {
  const intake = read('server/requirement-intake-routes.ts');
  assert.match(intake, /app\.get\("\/api\/requirement-centre\/unit-gaps", requireAuth, handle\(async \(\) => unitGapsList\(pool\)\)\);/);
  // handle() asks staffActor first: a client login or staff viewing as one is refused.
  assert.match(intake, /res\.json\(await run\(req, await staffActor\(req\)\)\);/);
  const body = find('server/requirement-intake-routes.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'unitGapsList');
  assert.doesNotMatch(body, /INSERT|UPDATE|DELETE/i);
  const queries = [];
  const { unitGapsList } = evaluate(body, { FIT_POOL_STATUSES, unitFitGaps });
  const out = await unitGapsList({ query: async (text, values) => {
    queries.push({ text, values });
    return { rows: [
      { id: 'a', unit_name: 'Unit 1', sqft: 2000, use_class: 'E(b)', property_id: 'p1', property_name: 'Bluewater', schedule_row_id: 'ts1', marketing_status: 'AVA' },
      { id: 'b', unit_name: 'Unit 2', sqft: null, use_class: 'E(b)', property_id: 'p1', property_name: 'Bluewater', schedule_row_id: null, marketing_status: 'AVA' },
      { id: 'c', unit_name: 'Unit 3', sqft: 900, use_class: null, property_id: 'p2', property_name: 'Trinity', schedule_row_id: null, marketing_status: 'NEG' },
      { id: 'd', unit_name: null, sqft: 0, use_class: '', property_id: null, property_name: null, schedule_row_id: null, marketing_status: 'NEG' },
    ] };
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(queries[0].values)), [['AVA', 'NEG']]);
  assert.match(queries[0].text, /au\.marketing_status = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), {
    onMarket: 4, noUse: 2, noSize: 2,
    units: [
      { id: 'b', unitName: 'Unit 2', propertyId: 'p1', propertyName: 'Bluewater', scheduleRowId: null, status: 'AVA', missing: ['size'] },
      { id: 'c', unitName: 'Unit 3', propertyId: 'p2', propertyName: 'Trinity', scheduleRowId: null, status: 'NEG', missing: ['use'] },
      { id: 'd', unitName: 'Unit', propertyId: null, propertyName: null, scheduleRowId: null, status: 'NEG', missing: ['use', 'size'] },
    ],
  });
  // The board shows the card to BGP staff only.
  assert.match(read('client/src/pages/requirements.tsx'), /\{canUseCentre && onBoard && <UnitFitGapsCard navigate=\{navigate\} \/>\}/);
});
