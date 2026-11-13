// Brand page, review round 3 (2026-11-13): the rules behind three of the
// judged problems, checked without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSizeList, rejoinSplitSizes } from '../../shared/format-size.ts';
import { parseReqSize } from '../../shared/requirement-fit.ts';

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('a size saved split at its thousands commas reads as the size, not "5, 0–10, 0 sq ft"', () => {
  assert.equal(formatSizeList(['5', '000 - 10', '000 sq ft']), '5,000–10,000 sq ft');
  assert.equal(formatSizeList(['1', '000 sq ft']), '1,000 sq ft');
  // Genuine lists of separate sizes are left as they are.
  assert.deepEqual(rejoinSplitSizes(['500', '750 sq ft']), ['500', '750 sq ft']);
  assert.deepEqual(rejoinSplitSizes(['2,000', '500 sq ft']), ['2,000', '500 sq ft']);
  assert.equal(formatSizeList(['800 - 1,800 sq ft']), '800–1,800 sq ft');
  assert.equal(formatSizeList('10000- ft2'), '10,000+ sq ft');
  assert.equal(formatSizeList(null), '');
});

test('the server\'s sentences and the size range use the same rule (it read "5, 000 - 10, 000 sq ft" and fitted an 11 sq ft unit)', () => {
  // One helper: the screens re-export it, the two server sentences call it.
  assert.match(read('client/src/lib/format-size.ts'), /from "@shared\/format-size"/);
  const crm = read('server/crm.ts');
  assert.match(crm, /const reqSize = formatSizeList\(liveReq\.size\);/);
  assert.doesNotMatch(crm, /liveReq\.size\.join\(/);
  assert.match(read('server/brand-scheme-plan.ts'), /\[formatSizeList\(req\.size\), list\(req\.use\), list\(req\.requirement_locations\)\]/);
  // The range a unit is fitted against: 5,000 to 10,000 with the usual tolerance, not 0 to 10.
  assert.deepEqual(parseReqSize(['5', '000 - 10', '000 sq ft']), { min: 4000, max: 12000 });
  assert.deepEqual(parseReqSize(['800 - 1,800 sq ft']), { min: 640, max: 2160 });
  assert.deepEqual(parseReqSize('1500-3000 ft2'), { min: 1200, max: 3600 });
});

test('a withdrawn or archived deal is never sent as a tenancy, and a live deal is its own line on the brand page', () => {
  const crm = read('server/crm.ts');
  const route = crm.slice(crm.indexOf('app.get("/api/brands/:id/portfolio-activity"'), crm.indexOf('app.get("/api/brands/:id/tracker-comments"'));
  // Deal statuses are stored as codes: the two words alone let WIT through.
  assert.match(route, /d\.tenant_id = \$1 AND UPPER\(BTRIM\(d\.status\)\) NOT IN \('DEAD','WITHDRAWN','LOST','WIT','ARCH'\)/);
  assert.doesNotMatch(route, /d\.status NOT IN \('Dead','Withdrawn'\)/);

  const panel = read('client/src/components/brand-profile-panel.tsx');
  const block = panel.slice(panel.indexOf('export function PortfolioActivityBlock'), panel.indexOf('export function CompanyMiniChat'));
  // Let = exchanged, completed or invoiced (the Brand CRM's own rule); anything earlier is "In talks at".
  assert.match(block, /const dealIsLet = \(status: any\) => \["EXC", "COM", "INV"\]\.includes\(legacyToCode\(status\) \|\| ""\)/);
  assert.match(block, /if \(splitLiveDeals && p\.via === "deal" && !dealIsLet\(p\.status\)\)/);
  assert.match(block, /label: "In talks at", rows: inTalks/);
  // The summary band folds in the live tenancies for every viewer, client logins included.
  assert.match(panel, /<PortfolioActivityBlock companyId=\{companyId\} liveTenancies=\{liveLocations\} compact includeLiveTenancies schemePlan=\{showSchemePlan\} \/>/);
});

test('a client login is not shown BGP\'s next action or follow-up date on a brand\'s viewings', () => {
  const card = read('client/src/components/brand-page/brand-viewings-card.tsx');
  assert.match(card, /\{staff && \(viewing\.nextAction \|\| followUp\) && \(/);
});

test('the Schemes and units card is placed on the brand page without editing the Brand CRM card', () => {
  const slot = read('client/src/components/brand-page/scheme-plan-slot.tsx');
  // It reads the plan from the cache; it is not a second query with its own handling.
  assert.doesNotMatch(slot, /useQuery\(/);
  assert.match(slot, /getQueryData<BrandPlan \| null>\(\[base, companyId\]\)/);
  const phone = read('client/src/components/mobile-brand-view.tsx');
  // The phone-only BGP engagement card comes before the long Schemes and units card.
  assert.ok(phone.indexOf('{brandPage && hasEngagement && !isClientViewer && engagementCard}') < phone.indexOf('<SchemePlanSlot phone'));
});
