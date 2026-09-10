// Scoped data correction. Offline preview is the default; never loads .env.
// Apply requires an explicit database target and a fresh online preview hash.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { getBrandIdentity, normalizeBrandDomain } from '../server/brand-identity.ts';
import { prepareBrandIdentityUpdate, quarantineBrandIdentityDependents } from '../server/brand-publishing.ts';

export const COOK_ID = 'cd6b0e72-a60a-4e36-9cf6-aa2427dfc93c';
export const DEFAULT_SNAPSHOT = '../audit-evidence/evidence-plan-20260907/live-verification/cook-before-20260910.json';
export const SOURCES = [
  'https://www.cookfood.net/about',
  'https://find-and-update.company-information.service.gov.uk/company/04611064',
  'https://find-and-update.company-information.service.gov.uk/company/02884870',
];
const WRONG_DESCRIPTION = 'COOK is a UK-based retailer specializing in kitchenware, cookbooks, and culinary products with both physical stores and an online presence.';
const ALLOWED_FIELDS = new Set(['domain', 'domain_url', 'website', 'description', 'industry', 'head_office_address', 'employee_count',
  'annual_revenue', 'founded_year', 'phone', 'linkedin_url', 'concept_pitch', 'store_count', 'rollout_status', 'backers',
  'instagram_handle', 'tiktok_handle', 'x_handle', 'dept_store_presence', 'franchise_activity', 'brand_analysis', 'brand_analysis_at',
  'ai_competitors', 'ai_competitors_at', 'menu_intel', 'menu_intel_at', 'last_enriched_at', 'ai_generated_fields', 'uk_entity_name', 'updated_at']);

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function sorted(rows = []) { return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))); }
export function stateFingerprint(state) {
  // Online preview includes the entire company row (including legal/KYC fields),
  // so a concurrent human edit cannot be silently included in an old approval.
  return fingerprint({ company: state.company, stores: sorted(state.stores), images: sorted(state.images), signals: sorted(state.signals) });
}
function assertCook(company) {
  if (company?.id !== COOK_ID || company.name !== 'COOK' || company.company_type !== 'Tenant - Retail') {
    throw new Error('This correction is restricted to the reviewed COOK retail company.');
  }
  if (normalizeBrandDomain(company.domain) !== 'cook.com'
    || [company.domain_url, company.website].some(value => value && normalizeBrandDomain(value) !== 'cook.com')) {
    throw new Error('The reviewed cook.com identity has changed or was already corrected. Stop and review again.');
  }
  if (company.description !== WRONG_DESCRIPTION || company.industry !== 'Construction - General'
    || fingerprint(company.head_office_address) !== fingerprint({ city: 'London' })) {
    throw new Error('A reviewed incorrect fact has changed. This script will not replace subsequent edits.');
  }
}

export function buildCookCorrection(company, actor, now = new Date()) {
  assertCook(company);
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 120) throw new Error('Provide an accountable actor (1–120 characters).');
  const oldAliases = company.ai_generated_fields?.brand_identity?.aliases || [];
  const prepared = prepareBrandIdentityUpdate(company, {
    domain: 'cookfood.net', aliases: [...new Set([...oldAliases, 'COOK TRADING LIMITED'])], country: 'GB',
  }, actor, now);
  const fields = prepared.fields;
  // The enrichment writer compares this revision before publishing. Advance
  // it so a lookup started against cook.com cannot overwrite this correction.
  const previousRevision = new Date(company.updated_at || 0).getTime();
  fields.updated_at = new Date(Math.max(now.getTime(), Number.isFinite(previousRevision) ? previousRevision + 1 : 0)).toISOString();
  fields.description = 'COOK is a UK frozen ready-meal retailer, preparing meals in its own kitchens and selling through shops and online.';
  fields.industry = 'Food retail';
  fields.head_office_address = { address: 'The COOK Kitchen, Eurolink Way', city: 'Sittingbourne', region: 'Kent', postcode: 'ME10 3HH', country: 'United Kingdom' };
  const profile = company.companies_house_data?.profile;
  const coherentRelatedEntity = company.companies_house_number === '02884870'
    && profile?.companyNumber === '02884870' && profile?.companyName === 'COOK FOOD LIMITED';
  if (company.uk_entity_name === 'Digimedia.com, LP' && coherentRelatedEntity) fields.uk_entity_name = 'COOK FOOD LIMITED';
  // Neither the CH number/profile nor any KYC/ownership/legal record is replaced.
  fields.ai_generated_fields.brand_identity.legalEntityReview = {
    status: 'pending', reason: 'The website identifies COOK TRADING LIMITED (04611064). The existing COOK FOOD LIMITED (02884870) record is a related dormant entity; confirm the entity for each trading, covenant and KYC purpose before changing legal records.',
    existingCompanyNumber: company.companies_house_number || null,
    officialTradingName: 'COOK TRADING LIMITED', officialTradingNumber: '04611064',
    reviewedAt: now.toISOString(), sources: SOURCES,
  };
  fields.ai_generated_fields.brand_identity.factCorrection = {
    at: now.toISOString(), actor, sources: SOURCES,
    fields: ['domain', 'domain_url', ...(Object.hasOwn(fields, 'website') ? ['website'] : []), 'description', 'industry', 'head_office_address', ...(fields.uk_entity_name ? ['uk_entity_name'] : [])],
  };
  for (const key of ['description', 'industry', 'head_office_address']) delete fields.ai_generated_fields[key];
  for (const key of Object.keys(fields)) if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unexpected correction field: ${key}`);
  const identity = getBrandIdentity({ ...company, ...fields });
  if (identity.status !== 'verified' || identity.domain !== 'cookfood.net') throw new Error('Correction does not produce a coherent official identity.');
  return { fields, identity, coherentRelatedEntity };
}

export function previewCookCorrection(state, { actor = 'offline-review', now, online = false } = {}) {
  const plan = buildCookCorrection(state.company, actor, now);
  const company = state.company;
  const automaticImage = image => (image.tags || []).some(tag => ['brand-auto', 'logo-dev-cache', 'website-refresh', 'bulk-import'].includes(tag))
    && !(image.tags || []).includes('brand-hero');
  const publicFields = ['domain', 'domain_url', 'website', 'description', 'industry', 'head_office_address', 'uk_entity_name'];
  return {
    mode: online ? 'database-preview' : 'snapshot-preview', companyId: COOK_ID,
    expectedStateFingerprint: online ? stateFingerprint(state) : null,
    snapshotFingerprint: online ? undefined : stateFingerprint(state),
    applyEligible: online, sources: SOURCES,
    changes: Object.fromEntries(publicFields.filter(key => Object.hasOwn(plan.fields, key)).map(key => [key, { before: company[key] ?? null, after: plan.fields[key] }])),
    clearedAutomatedFields: Object.keys(plan.fields).filter(key => plan.fields[key] === null && company[key] != null),
    retirement: {
      automatedStoresForReview: state.stores.filter(store => ['google_places', 'google_places_verified'].includes(store.source_type)).length,
      automatedImagesForReview: state.images.filter(automaticImage).length,
      automatedSignals: online ? state.signals.filter(signal => signal.ai_generated || signal.source === 'apollo').length : 'Not captured; included in online preview',
      rowsDeleted: 0, manualStoresAndPinnedImages: 'Preserved',
    },
    employeeCount: Object.hasOwn(plan.fields, 'employee_count') ? 'Unproven automated figure cleared; no replacement invented' : 'No automated attribution: existing figure preserved for review',
    legalReview: plan.fields.ai_generated_fields.brand_identity.legalEntityReview,
    legalLabelCorrection: plan.fields.uk_entity_name ? 'Digimedia label corrected to the name already matched by the existing CH number and cached profile' : 'Existing legal label preserved; resolve separately',
    preserved: ['Company ID', 'All contacts and company links', 'Brand and requirement links', 'Client access and edit rights', 'Companies House number and full cached record', 'KYC records and approvals', 'Human-entered facts outside the three exact reviewed incorrect facts'],
    note: online ? 'Apply must use this exact state fingerprint. Any changed company/dependency data aborts without writing.' : 'Offline preview is incomplete by design and cannot authorize apply. Run an explicit read-only database preview for the apply fingerprint.',
  };
}

export async function readCookState(db, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const company = (await db.query(`SELECT * FROM crm_companies WHERE id = $1${suffix}`, [COOK_ID])).rows[0];
  if (!company) throw new Error('The reviewed COOK record was not found.');
  const stores = (await db.query(`SELECT * FROM brand_stores WHERE brand_company_id = $1 ORDER BY id${suffix}`, [COOK_ID])).rows;
  const images = (await db.query(`SELECT id, company_id, brand_name, tags, source, description FROM image_studio_images WHERE company_id = $1 ORDER BY id${suffix}`, [COOK_ID])).rows;
  const signals = (await db.query(`SELECT id, brand_company_id, ai_relevant, ai_generated, source FROM brand_signals WHERE brand_company_id = $1 ORDER BY id${suffix}`, [COOK_ID])).rows;
  return { company, stores, images, signals };
}

export async function applyCookCorrection(db, { expectedFingerprint, actor, companyId, now = new Date() }) {
  if (companyId !== COOK_ID || !/^[a-f0-9]{64}$/.test(expectedFingerprint || '')) throw new Error('Apply requires the exact COOK ID and a fresh database-preview fingerprint.');
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '30s'");
    const state = await readCookState(db, { lock: true });
    if (stateFingerprint(state) !== expectedFingerprint) throw new Error('COOK data changed after preview; nothing applied. Obtain a new preview and review it.');
    const plan = buildCookCorrection(state.company, actor, now);
    await quarantineBrandIdentityDependents(db, state.company, actor);
    const entries = Object.entries(plan.fields);
    const values = entries.map(([, value]) => value && typeof value === 'object' ? JSON.stringify(value) : value);
    const result = await db.query(`UPDATE crm_companies SET ${entries.map(([key], index) => `"${key}" = $${index + 1}`).join(', ')} WHERE id = $${entries.length + 1} RETURNING *`, [...values, COOK_ID]);
    if (result.rowCount !== 1) throw new Error('The COOK update did not affect exactly one record.');
    // Assert every field outside the allowlisted patch is unchanged before commit.
    for (const key of Object.keys(state.company)) {
      if (!Object.hasOwn(plan.fields, key) && fingerprint(state.company[key]) !== fingerprint(result.rows[0][key])) {
        throw new Error(`Unexpected change outside correction fields: ${key}`);
      }
    }
    await db.query('INSERT INTO system_settings(key, value) VALUES ($1, $2::jsonb)', [
      `cook-brand-correction:${COOK_ID}:${expectedFingerprint}`,
      JSON.stringify({ at: now.toISOString(), actor, expectedFingerprint, identity: plan.identity, report: previewCookCorrection(state, { actor, now, online: true }) }),
    ]);
    await db.query('COMMIT');
    return { applied: true, companyId: COOK_ID, identity: { status: plan.identity.status, domain: plan.identity.domain }, legalReview: 'Pending; Companies House and KYC records preserved', rowsDeleted: 0 };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export function parseOptions(args) {
  const options = {};
  const booleans = new Set(['--apply', '--database-preview']);
  const values = new Set(['--snapshot', '--expected', '--actor', '--company-id', '--expected-database', '--expected-server']);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if ((!booleans.has(flag) && !values.has(flag)) || Object.hasOwn(options, flag)) throw new Error(`Unknown or repeated option: ${flag}`);
    if (booleans.has(flag)) options[flag] = true;
    else if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
    else options[flag] = args[++index];
  }
  if (options['--apply'] && options['--database-preview']) throw new Error('Choose preview or apply, not both.');
  const online = options['--apply'] || options['--database-preview'];
  if (online && (options['--snapshot'] || !options['--expected-database'] || !options['--expected-server'])) throw new Error('Database operations require explicit expected database/server and cannot use an offline snapshot.');
  if (!online && Object.keys(options).some(key => key !== '--snapshot')) throw new Error('Offline preview accepts only --snapshot.');
  if (options['--apply'] && (!options['--actor'] || options['--company-id'] !== COOK_ID || !/^[a-f0-9]{64}$/.test(options['--expected'] || ''))) throw new Error('Apply requires --actor, --company-id and --expected from an online preview.');
  return options;
}

export function checkDatabaseTarget(connectionString, options) {
  if (!connectionString) throw new Error('Set COOK_CORRECTION_DATABASE_URL explicitly; ambient DATABASE_URL is never used.');
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('Invalid database URL (value omitted).'); }
  const server = url.searchParams.get('host') || url.hostname;
  if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length
    || !['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.pathname.slice(1)) !== options['--expected-database']
    || server !== options['--expected-server'] || url.searchParams.has('hostaddr') || url.searchParams.has('dbname') || url.searchParams.has('database')) {
    throw new Error('Database URL does not match the explicitly expected server and database.');
  }
  return { database: options['--expected-database'] };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options['--apply'] && !options['--database-preview']) {
    const snapshot = JSON.parse(await readFile(options['--snapshot'] || DEFAULT_SNAPSHOT, 'utf8'));
    if (snapshot.companies?.length !== 1 || !Array.isArray(snapshot.stores) || !Array.isArray(snapshot.images)) throw new Error('Unexpected snapshot shape.');
    const state = { company: snapshot.companies[0], stores: snapshot.stores, images: snapshot.images, signals: [] };
    console.log(JSON.stringify(previewCookCorrection(state), null, 2));
    return;
  }
  const supplied = process.env.COOK_CORRECTION_DATABASE_URL;
  const target = checkDatabaseTarget(supplied, options);
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: supplied, application_name: 'reviewed-cook-brand-correction' });
  await db.connect();
  try {
    const actual = (await db.query('SELECT current_database() AS database')).rows[0];
    if (actual.database !== target.database) throw new Error('Connected database differs from the expected target.');
    if (options['--apply']) {
      console.log(JSON.stringify(await applyCookCorrection(db, { expectedFingerprint: options['--expected'], actor: options['--actor'], companyId: options['--company-id'] }), null, 2));
    } else {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const state = await readCookState(db);
        console.log(JSON.stringify(previewCookCorrection(state, { online: true, actor: options['--actor'] || 'database-preview' }), null, 2));
      } finally { await db.query('ROLLBACK'); }
    }
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // PostgreSQL detail may contain row contents; never print the error object.
    console.error(error?.code ? `Correction stopped (database code ${error.code}); no database detail logged.` : error.message);
    process.exitCode = 1;
  });
}
