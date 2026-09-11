import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COOK_ID, buildCookCorrection, previewCookCorrection, stateFingerprint, applyCookCorrection, parseOptions, checkDatabaseTarget } from '../correct-cook-brand.mjs';

const now = new Date('2026-09-10T12:00:00Z');
function fixture() {
  return {
    company: { id: COOK_ID, name: 'COOK', company_type: 'Tenant - Retail', domain: 'cook.com', domain_url: null,
      description: 'COOK is a UK-based retailer specializing in kitchenware, cookbooks, and culinary products with both physical stores and an online presence.',
      industry: 'Construction - General', head_office_address: { city: 'London' }, employee_count: '950', store_count: 100,
      uk_entity_name: 'Digimedia.com, LP', companies_house_number: '02884870',
      companies_house_data: { profile: { companyNumber: '02884870', companyName: 'COOK FOOD LIMITED', sicCodes: ['99999'] }, privateFixtureNote: 'Keep legal records' },
      companies_house_officers: [{ name: 'Synthetic test director' }], kyc_status: 'approved', kyc_approved_by: 'staff-test',
      trading_entities: [{ name: 'Existing related entity' }], notes: 'Human note', company_scope_id: 'client-test', updated_at: '2026-09-08T12:00:00Z',
      brand_analysis: { old: true }, menu_intel: { old: true }, ai_competitors: [{ name: 'Unrelated' }],
      ai_generated_fields: { employee_count: '2026-09-08', store_count: '2026-09-08', backers_detail: [{ name: 'Unproven detail' }] } },
    stores: [{ id: 'automatic-store', brand_company_id: COOK_ID, source_type: 'google_places', notes: 'Old automatic' }, { id: 'manual-store', brand_company_id: COOK_ID, source_type: 'manual', notes: 'Human location' }],
    images: [{ id: 'bad-logo', company_id: COOK_ID, tags: ['brand-logo', 'logo-dev-cache'] }, { id: 'pinned', company_id: COOK_ID, tags: ['brand-auto', 'brand-hero'] }],
    signals: [{ id: 'auto-signal', brand_company_id: COOK_ID, source: 'apollo', ai_generated: false, ai_relevant: true }, { id: 'manual-signal', brand_company_id: COOK_ID, source: 'manual', ai_generated: false, ai_relevant: true }],
  };
}

test('known incorrect brand facts change, legal and human facts stay, unproven automated employees clear', () => {
  const { company } = fixture(); const original = structuredClone(company);
  const { fields, identity } = buildCookCorrection(company, 'test-reviewer', now);
  assert.equal(identity.status, 'verified'); assert.equal(identity.domain, 'cookfood.net');
  assert.ok(identity.aliases.includes('COOK TRADING LIMITED'));
  assert.equal(fields.industry, 'Food retail'); assert.equal(fields.head_office_address.city, 'Sittingbourne');
  assert.equal(fields.uk_entity_name, 'COOK FOOD LIMITED'); assert.equal(fields.employee_count, null);
  assert.equal(fields.ai_generated_fields.brand_identity.legalEntityReview.status, 'pending');
  assert.equal(fields.ai_generated_fields.backers_detail, undefined);
  for (const key of ['id', 'companies_house_number', 'companies_house_data', 'companies_house_officers', 'kyc_status', 'kyc_approved_by', 'trading_entities', 'notes', 'company_scope_id']) assert.equal(Object.hasOwn(fields, key), false, key);
  assert.deepEqual(company, original, 'Planning must not mutate input data');
});

test('manual headcount is not treated as an automated guess', () => {
  const { company } = fixture(); delete company.ai_generated_fields.employee_count;
  assert.equal(Object.hasOwn(buildCookCorrection(company, 'reviewer', now).fields, 'employee_count'), false);
});

test('correction always advances the revision even when a preceding write has the same timestamp', () => {
  const { company } = fixture(); company.updated_at = now.toISOString();
  const { fields } = buildCookCorrection(company, 'reviewer', now);
  assert.ok(new Date(fields.updated_at).getTime() > new Date(company.updated_at).getTime());
});

test('Digimedia label changes only when both existing number and cached company name agree', () => {
  for (const mutation of [c => c.companies_house_number = '04611064', c => c.companies_house_data.profile.companyName = 'Different company', c => c.companies_house_data.profile.companyNumber = '04611064', c => c.uk_entity_name = 'Human legal name']) {
    const { company } = fixture(); mutation(company);
    assert.equal(Object.hasOwn(buildCookCorrection(company, 'reviewer', now).fields, 'uk_entity_name'), false);
  }
});

test('subsequent human edits, another company and repeat apply are rejected', () => {
  for (const mutation of [c => c.id = 'different-company', c => c.domain = 'cookfood.net', c => c.domain_url = 'https://other.example', c => c.description = 'Human corrected description', c => c.industry = 'Human category', c => c.head_office_address = { city: 'Sittingbourne' }]) {
    const { company } = fixture(); mutation(company);
    assert.throws(() => buildCookCorrection(company, 'reviewer', now));
  }
});

test('offline review cannot supply an apply fingerprint and never exposes private legal contents', () => {
  const state = fixture(); const original = structuredClone(state);
  const report = previewCookCorrection(state, { now });
  assert.equal(report.applyEligible, false); assert.equal(report.expectedStateFingerprint, null);
  assert.equal(report.retirement.automatedStoresForReview, 1); assert.equal(report.retirement.automatedImagesForReview, 1);
  assert.equal(report.retirement.rowsDeleted, 0);
  assert.equal(JSON.stringify(report).includes('Synthetic test director'), false);
  assert.equal(JSON.stringify(report).includes('Keep legal records'), false);
  assert.deepEqual(state, original);
});

test('default CLI preview is offline even with unusable database environment variables', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bgp-cook-offline-'));
  try {
    const state = fixture();
    const snapshot = join(directory, 'snapshot.json'), guard = join(directory, 'deny-network.mjs');
    writeFileSync(snapshot, JSON.stringify({ companies: [state.company], stores: state.stores, images: state.images }));
    writeFileSync(guard, `import net from 'node:net';\nnet.Socket.prototype.connect = function(){ throw new Error('Offline preview attempted a connection'); };\nglobalThis.fetch = async () => { throw new Error('Offline preview attempted fetch'); };\n`);
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--import', guard, fileURLToPath(new URL('../correct-cook-brand.mjs', import.meta.url)), '--snapshot', snapshot], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, DATABASE_URL: 'unusable-test-url', COOK_CORRECTION_DATABASE_URL: 'unusable-test-url' },
    });
    const report = JSON.parse(output);
    assert.equal(report.mode, 'snapshot-preview'); assert.equal(report.applyEligible, false);
    assert.equal(report.expectedStateFingerprint, null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('approval fingerprint ignores JSON key/row order but detects human or dependency edits', () => {
  const state = fixture(); const hash = stateFingerprint(state);
  const reordered = structuredClone(state); reordered.company = Object.fromEntries(Object.entries(reordered.company).reverse()); reordered.stores.reverse();
  assert.equal(stateFingerprint(reordered), hash);
  for (const mutation of [s => s.company.kyc_status = 'in_review', s => s.company.notes = 'Another human edit', s => s.stores[1].notes = 'Changed', s => s.images[1].tags = [], s => s.signals[1].ai_relevant = false]) {
    const changed = structuredClone(state); mutation(changed); assert.notEqual(stateFingerprint(changed), hash);
  }
});

// Transactional fake exercises the real SQL orchestration and quarantine helper;
// no database credentials, network or real records are used in these checks.
function database(initial, failureAt = '') {
  let state = structuredClone(initial), backup; const queries = [], audits = [];
  const related = { contacts: [{ id: 'contact', company_id: COOK_ID }], requirements: [{ id: 'requirement', brand_id: COOK_ID }], clients: [{ scope: COOK_ID }] };
  return {
    queries, audits, related, get state() { return state; },
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.startsWith('BEGIN')) { backup = structuredClone(state); return { rows: [] }; }
      if (sql === 'ROLLBACK') { state = backup; audits.length = 0; return { rows: [] }; }
      if (sql === 'COMMIT' || sql.startsWith('SET LOCAL')) return { rows: [] };
      if (failureAt && sql.startsWith(failureAt)) throw new Error('Injected failure');
      if (sql.startsWith('SELECT')) {
        if (sql.includes('FROM crm_companies')) return { rows: [structuredClone(state.company)] };
        let rows = sql.includes('FROM brand_stores') ? state.stores : sql.includes('FROM image_studio_images') ? state.images : state.signals;
        if (sql.includes("source_type IN")) rows = rows.filter(row => ['google_places', 'google_places_verified'].includes(row.source_type));
        if (sql.includes('tags &&')) rows = rows.filter(row => row.tags.some(tag => ['brand-auto', 'logo-dev-cache', 'website-refresh', 'bulk-import'].includes(tag)) && !row.tags.includes('brand-hero'));
        if (sql.includes("ai_generated = true OR source = 'apollo'")) rows = rows.filter(row => row.ai_generated || row.source === 'apollo');
        return { rows: structuredClone(rows) };
      }
      if (sql.startsWith('INSERT INTO system_settings')) { audits.push(values); return { rows: [] }; }
      if (sql.startsWith('UPDATE crm_companies SET')) {
        const fields = [...sql.matchAll(/"([a-z_]+)" = \$\d+/g)].map(match => match[1]);
        for (let index = 0; index < fields.length; index++) {
          const value = values[index]; state.company[fields[index]] = typeof value === 'string' && /^[\[{]/.test(value) ? JSON.parse(value) : value;
        }
        return { rows: [structuredClone(state.company)], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE brand_stores')) { for (const row of state.stores) if (values[0].includes(row.id)) row.source_type = 'identity_review'; }
      else if (sql.startsWith('UPDATE image_studio_images')) { for (const row of state.images) if (values[0].includes(row.id)) row.tags.push('identity-review'); }
      else if (sql.startsWith('UPDATE brand_signals')) { for (const row of state.signals) if (values[0].includes(row.id)) row.ai_relevant = false; }
      if (sql.startsWith('UPDATE brand_stores') || sql.startsWith('UPDATE image_studio_images') || sql.startsWith('UPDATE brand_signals')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('apply preserves relationship IDs and legal/KYC data while retiring only automated dependencies', async () => {
  const state = fixture(), db = database(state), related = structuredClone(db.related);
  const result = await applyCookCorrection(db, { expectedFingerprint: stateFingerprint(state), actor: 'reviewer', companyId: COOK_ID, now });
  assert.equal(result.applied, true); assert.equal(db.state.company.domain, 'cookfood.net');
  assert.equal(db.state.company.updated_at, now.toISOString(), 'correction advances the optimistic enrichment revision');
  assert.notEqual(db.state.company.updated_at, state.company.updated_at, 'a worker with the old updated_at cannot publish over the correction');
  for (const key of ['companies_house_number', 'companies_house_data', 'companies_house_officers', 'kyc_status', 'kyc_approved_by', 'trading_entities', 'notes', 'company_scope_id']) assert.deepEqual(db.state.company[key], state.company[key], key);
  assert.deepEqual(db.related, related); assert.equal(db.state.stores[0].source_type, 'identity_review');
  assert.deepEqual(db.state.stores[1], state.stores[1]); assert.deepEqual(db.state.images[1], state.images[1]);
  assert.equal(db.state.images[0].tags.includes('identity-review'), true);
  assert.equal(db.state.signals[0].ai_relevant, false); assert.equal(db.state.signals[1].ai_relevant, true);
  assert.equal(db.audits.length, 2); assert.equal(db.queries.at(-1).sql, 'COMMIT');
  assert.equal(db.queries.some(query => /DELETE|crm_contacts|requirements|company_scope/.test(query.sql)), false);
});

test('stale fingerprint aborts before mutation', async () => {
  const state = fixture(), hash = stateFingerprint(state); state.company.notes = 'Edited after preview';
  const db = database(state);
  await assert.rejects(applyCookCorrection(db, { expectedFingerprint: hash, actor: 'reviewer', companyId: COOK_ID, now }), /changed after preview/);
  assert.deepEqual(db.state, state); assert.equal(db.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(db.queries.some(query => /^(UPDATE|INSERT)/.test(query.sql)), false);
});

test('company update failure rolls back prior audit and dependent retirement', async () => {
  const state = fixture(), db = database(state, 'UPDATE crm_companies');
  await assert.rejects(applyCookCorrection(db, { expectedFingerprint: stateFingerprint(state), actor: 'reviewer', companyId: COOK_ID, now }), /Injected/);
  assert.deepEqual(db.state, state); assert.equal(db.audits.length, 0); assert.equal(db.queries.at(-1).sql, 'ROLLBACK');
});

test('CLI defaults offline and rejects incomplete, ambiguous or wrongly targeted apply commands', () => {
  assert.deepEqual(parseOptions([]), {});
  for (const args of [['--apply'], ['--apply', '--database-preview'], ['--expected', 'a'.repeat(64)], ['--unknown'], ['--snapshot', 'a', '--snapshot', 'b']]) assert.throws(() => parseOptions(args));
  const options = { '--expected-database': 'bgp_smoke', '--expected-server': '/tmp/bgp-smoke-20260909/socket' };
  assert.deepEqual(checkDatabaseTarget('postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260909/socket&port=55441', options), { database: 'bgp_smoke' });
  for (const url of [undefined, 'postgresql://remote.example/bgp_smoke', 'postgresql:///wrong?host=/tmp/bgp-smoke-20260909/socket', 'postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260909/socket&hostaddr=1.2.3.4']) assert.throws(() => checkDatabaseTarget(url, options));
});
