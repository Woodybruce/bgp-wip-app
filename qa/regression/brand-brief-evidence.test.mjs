import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { BRAND_BRIEF_POLICY_VERSION, BRAND_BRIEF_EVIDENCE_RULES, brandActionEvidence, brandBriefWithoutEvidence, brandLegalEvidenceContext } from '../../server/brand-brief-evidence.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/brand-ai-take.ts';
const fn = name => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const now = new Date('2026-09-17T12:00:00Z');
const cook = () => ({ id: 'cook', name: 'COOK', description: 'Frozen ready-meal retailer', industry: 'Food retail', domain: 'cookfood.net',
  employee_count: 900, store_count: 90, rollout_status: 'consolidating', brand_analysis: 'Operational efficiency must be their strategy',
  ai_generated_fields: { brand_identity: { status: 'verified', domain: 'cookfood.net', aliases: ['COOK Trading Ltd'] } } });

test('COOK size snapshots and recycled AI commentary cannot produce an asserted strategy', () => {
  const evidence = brandActionEvidence(cook(), [], [], now);
  const larger = brandActionEvidence({ ...cook(), employee_count: 9000, store_count: 2000, rollout_status: 'scaling' }, [], [], now);
  assert.deepEqual(evidence, larger);
  assert.doesNotMatch(JSON.stringify(evidence), /employee_count|store_count|rollout_status|brand_analysis|operational efficiency/i);
  const text = brandBriefWithoutEvidence(evidence);
  assert.match(text, /Current property strategy is unconfirmed/);
  assert.match(text, /confirm.*current property contact and requirement/);
  assert.equal(text, brandBriefWithoutEvidence(larger));
});

test('only active requirements carry their actual use, size, geography and source dates', () => {
  const active = { id: 'r1', name: 'Recorded requirement', status: ' active ', use: ['Retail'], size: ['1,000–2,000 sq ft'], requirement_locations: ['Bristol'], requirement_date: '2026-08-01', updated_at: now, sources: ['Manual'] };
  const evidence = brandActionEvidence(cook(), [active, { ...active, id: 'inactive', status: 'Closed' }], [], now);
  assert.equal(evidence.active_requirements.length, 1);
  const record = evidence.active_requirements[0];
  assert.deepEqual(record.sizes, active.size); assert.deepEqual(record.locations, ['Bristol']); assert.equal(record.requirement_date, '2026-08-01');
  assert.match(record.freshness_note, /not a confirmed contact or reconfirmation date/);
  assert.equal(brandBriefWithoutEvidence(evidence), null);
});

test('dated evidence excludes historical Cook Islands collisions, speculation and unknown dates but retains staff/internal events', () => {
  const signal = { id: 's1', signal_type: 'opening', headline: 'COOK frozen ready-meal retailer opens a shop', source: 'https://example.com/retail', signal_date: '2026-09-10', confidence: 'reported' };
  const rows = [signal,
    { ...signal, id: 'collision', headline: 'Cook Islands resort opening promises tourism growth', source: 'https://travel.example/cook-islands' },
    { ...signal, id: 'undated', signal_date: null }, { ...signal, id: 'old', signal_date: '2025-01-01' },
    { ...signal, id: 'future', signal_date: '2027-01-01' }, { ...signal, id: 'rumour', confidence: 'rumour' },
    { ...signal, id: 'unlinked', ai_relevant: false }, { ...signal, id: 'headcount', signal_type: 'hiring' },
    { ...signal, id: 'unsourced', source: null },
    { ...signal, id: 'manual', headline: 'New site confirmed by team', source: 'manual', confidence: 'confirmed' },
    { ...signal, id: 'internal', headline: 'New unit requirement', source: 'bgp-deal:synthetic', signal_type: 'requirement' },
  ];
  const evidence = brandActionEvidence(cook(), [], rows, now);
  assert.deepEqual(evidence.recent_site_events.map(row => row.id), ['s1', 'manual', 'internal']);
  assert.equal(evidence.recent_site_events[0].confidence, 'reported'); assert.equal(evidence.recent_site_events[0].source, signal.source);
});

test('legal entity mismatch or pending legal review prevents treating a linked covenant as the brand covenant', () => {
  const linked = { uk_entity_name: 'Example Trading Ltd', companies_house_number: '01234567', companies_house_data: { profile: { companyName: 'EXAMPLE TRADING LIMITED', companyNumber: '01234567' } }, kyc_status: 'approved' };
  assert.equal(brandLegalEvidenceContext(linked).needs_review, false);
  assert.equal(brandLegalEvidenceContext({ ...linked, uk_entity_name: 'Wrong Company' }).needs_review, true);
  assert.equal(brandLegalEvidenceContext({ ...linked, ai_generated_fields: { brand_identity: { legalEntityReview: { status: 'pending', reason: 'Confirm contracting entity' } } } }).needs_review, true);
  assert.equal(brandLegalEvidenceContext({ ...linked, companies_house_data: null }).needs_review, true);
});

test('actual brand slice queries only the chosen brand and supplies evidence instead of count-based trajectory inputs', async () => {
  const queries = [];
  const { loadBrandSlice } = evaluate(fn('loadBrandSlice') + '\nexports.loadBrandSlice=loadBrandSlice;', {
    brandActionEvidence, bgpDealEvidence: deal => ({ property: deal.name }), relationshipEvidence: async company => ({ checked: company.id }),
    pool: { query: async (sql, values) => { queries.push({ sql, values }); assert.equal(values[0], 'cook');
      return { rows: sql.includes('FROM crm_companies') ? [cook()] : sql.includes('crm_requirements_leasing') ? [{ id: 'r1', name: 'Bristol requirement', status: 'Active', size: ['1000'], requirement_locations: ['Bristol'] }] : [] }; } },
  });
  const data = await loadBrandSlice('cook');
  assert.equal(data.active_requirements[0].name, 'Bristol requirement');
  assert.doesNotMatch(JSON.stringify(data), /employee_count|brand_analysis|store_count/);
  assert.match(queries.find(row => row.sql.includes('crm_requirements_leasing')).sql, /company_id = \$1 AND LOWER\(TRIM/);
  assert.match(queries.find(row => row.sql.includes('brand_signals')).sql, /brand_company_id = \$1/);
  assert.ok(queries.every(row => row.sql.trim().startsWith('SELECT')));
  // BGP's own deals and email relationship with the brand feed the one take (2026-09-23).
  assert.match(queries.find(row => row.sql.includes('FROM crm_deals')).sql, /tenant_id = \$1/);
  assert.deepEqual(Array.from(data.bgp_deals), []); assert.equal(data.bgp_relationship.checked, 'cook');
});

test('UK slice with a mismatched legal record withholds financial claims instead of using legacy KYC as credit evidence', async () => {
  const company = { ...cook(), uk_entity_name: 'Digimedia', companies_house_number: '02884870', kyc_status: 'approved', companies_house_data: { profile: { companyName: 'COOK FOOD LIMITED', companyNumber: '02884870', accounts: { overdue: false } } } };
  const { loadUkSlice } = evaluate(fn('loadUkSlice') + '\nexports.loadUkSlice=loadUkSlice;', {
    brandLegalEvidenceContext,
    pool: { query: async sql => { assert.doesNotMatch(sql, /FROM covenant_reports/); return { rows: sql.includes('crm_companies') ? [company] : [{ turnover: 1234, period: '2025' }] }; } },
  });
  const data = await loadUkSlice('cook');
  assert.equal(data.legal_entity_context.needs_review, true); assert.equal(data.covenant, null); assert.deepEqual(Array.from(data.turnover_history), []);
  assert.equal(data.accounts_overdue, null); assert.equal(data.has_charges, null);
});

test('all actual prompt builders carry evidence and uncertainty rules without forcing a strategy from missing inputs', () => {
  const names = ['brandPrompt', 'ukPrompt', 'activityPrompt', 'intelPrompt'];
  const prompts = evaluate(names.map(fn).join('\n') + '\n' + names.map(name => `exports.${name}=${name};`).join('\n'), { BRAND_BRIEF_EVIDENCE_RULES });
  for (const name of names) {
    const prompt = prompts[name]({ name: 'Synthetic brand' });
    assert.match(prompt, /snapshot of stores or employees does not establish/); assert.match(prompt, /Inference:/); assert.match(prompt, /KYC.*not a credit verdict/);
  }
  assert.doesNotMatch(prompts.brandPrompt({}), /trajectory RIGHT NOW|who does what, why now/);
  assert.match(prompts.brandPrompt({}), /strategy is unconfirmed, say so/);
});

test('actual preparation replaces old-policy cached speculation with deterministic unknowns and calls no model without demand evidence', async () => {
  const company = { ...cook(), brief_revision: 'revision' }, evidence = brandActionEvidence(company, [], [], now);
  const written = []; let calls = 0;
  const { prepareBrandAiTake } = evaluate(fn('prepareBrandAiTake') + '\nexports.prepareBrandAiTake=prepareBrandAiTake;', {
    getBrandIdentity, BRAND_BRIEF_POLICY_VERSION, CACHE_TTL_MS: 7 * 86400000, brandBriefWithoutEvidence,
    takeKey: () => 'brand-prepared-take:cook:brand', dataHash: () => 'same-data', loadBrandSlice: async () => evidence, brandPrompt: () => 'test prompt',
    callClaude: async () => { calls++; throw new Error('No evidence must not invite a speculative model response'); },
    pool: { query: async sql => ({ rows: sql.includes('crm_companies') ? [company] : [{ value: { text: 'Consolidating for operational efficiency', fingerprint: getBrandIdentity(company).fingerprint, dataHash: 'same-data', expiresAt: Date.now() + 10000 } }] }),
      connect: async () => ({ query: async (sql, values) => { if (sql.startsWith('SELECT')) return { rows: [company] }; if (sql.includes('INSERT')) written.push(JSON.parse(values[1])); return { rowCount: 1 }; }, release() {} }) },
  });
  const result = await prepareBrandAiTake('cook');
  assert.equal(calls, 0); assert.equal(result.cached, false); assert.match(result.text, /strategy is unconfirmed/);
  assert.equal(written[0].policyVersion, BRAND_BRIEF_POLICY_VERSION); assert.equal(written[0].text, result.text);
});
