import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// Woody, 2026-11-15: competing centres are the top schemes the landlord does not own.
test('a centre owned by the property\'s landlord is a sister scheme, not a competitor or a benchmark peer', () => {
  const gap = read('server/property-gap-analysis.ts');
  assert.match(gap, /const topPeers = peerSchemes\.filter\(ps => benchmarkNames\.has\(ps\.name\) && !sisterNames\.has\(ps\.name\)\);/);
  assert.match(gap, /\.filter\(ps => ps\.distance_km <= 60 && !sisterNames\.has\(ps\.name\)\)/);
  assert.match(gap, /propertyOfCentre\.get\(ps\.name\)\?\.landlordId === subjectLandlordId/);
});

test('the stage on a target row comes from the Brand CRM\'s own rule, and a client is read as a client', () => {
  const gap = read('server/property-gap-analysis.ts');
  assert.match(gap, /plan\.loadPlan\(pool, \{ brandIds: null, propertyIds: \[propertyId\], schemes: planSchemesList, viewer \}\)/);
  assert.match(gap, /if \(gapScope\) \{\n        const clientViewer = await plan\.landsecPlanViewer\(req\);\n        if \(!clientViewer\) throw new Error/);
  assert.match(gap, /canWant: !gapScope,/);
});

test('centre pages are set up only by an admin, never at boot, and the research is capped', () => {
  const centres = read('server/benchmark-centres.ts');
  assert.match(centres, /router\.get\("\/api\/admin\/benchmark-centres", requireAuth, requireAdmin,/);
  assert.match(centres, /router\.post\("\/api\/admin\/benchmark-centres\/apply", requireAuth, requireAdmin,/);
  assert.equal((centres.match(/INSERT INTO crm_properties/g) || []).length, 1, 'one place creates a centre page: the admin apply');
  assert.match(centres, /for \(const \{ c, r \} of due\.slice\(0, CENTRES_PER_NIGHT\)\)/);
  const index = read('server/index.ts');
  assert.match(index, /key: "centre-research", due: dailyAt\(5, 20\)/);
  assert.doesNotMatch(index, /benchmark-centres\/apply|applyBenchmark/, 'nothing at boot applies the set-up');
});

test('a centre\'s box sends a client the page of a shared centre only, and a joint agent no brand ids', () => {
  const centres = read('server/benchmark-centres.ts');
  assert.match(centres, /propertyId: record && \(!client \|\| record\.shared\) \? record\.id : null,/);
  assert.match(centres, /id: jointAgent \? null : String\(b\.id\)/);
  assert.match(read('server/index.ts'), /"\/api\/benchmark-centres\/",/);
});

// Woody, 2026-11-15: "let them edit". Only a page the set-up made is shared; a
// centre page BGP already held is stamped and stays as private as it was.
test('only a centre page the set-up created is shared with client logins', () => {
  const centres = read('server/benchmark-centres.ts');
  assert.match(centres, /VALUES \(\$1, \$2, \$3, 'Shopping Centre', 'Benchmark centre', \$1, TRUE\)/);
  assert.match(centres, /UPDATE crm_properties SET benchmark_centre = \$2 WHERE id = \$1 AND benchmark_centre IS NULL/);
  assert.doesNotMatch(centres, /SET benchmark_shared/, 'an existing page is never made shared');
  const scope = read('server/company-scope.ts');
  assert.match(scope, /SELECT id FROM crm_properties WHERE benchmark_shared IS TRUE/);
  assert.match(scope, /\.catch\(\(\) => new Set<string>\(\)\)/, 'a failed read shares nothing');
  assert.match(scope, /export async function isPropertyInScope\([^)]*\): Promise<boolean> \{\n  if \(\(await sharedBenchmarkPropertyIds\(\)\)\.has\(propertyId\)\) return true;/);
});

test('junk records are never offered as a gap', () => {
  const gap = read('server/property-gap-analysis.ts');
  assert.match(gap, /const pitchable = eligible\.filter\(b => !isJunkBrand\(/);
  for (const list of ['const gap = pitchable', 'const peerGaps = pitchable', 'const competitorGaps = pitchable', 'const localMarket = pitchable', 'const candidates = sliced(pitchable.filter']) assert.ok(gap.includes(list), list);
});

test('the requirements list under More is the scheme\'s categories, without junk', () => {
  const gap = read('server/property-gap-analysis.ts');
  const at = gap.indexOf('const matchingRequirements = await pool.query(');
  const block = gap.slice(at, at + 2600);
  assert.match(block, /if \(!row\.company_id\) return false;/);
  assert.match(block, /if \(isJunkBrand\(facts\)\) return false;/);
  assert.match(block, /return fitsPositioning\(positioning, \{ companyType: row\.company_type, tier: brandTier\(facts\), hotel: isHotelGroup\(facts\) \}\);/);
});
