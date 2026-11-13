// The background retry of a filed-accounts read that came back with no
// figures (13 November 2026). The rule itself is tested in
// shared/accounts-read.test.ts; these are the guards on WHERE it may run:
// the nightly job only, never a page open, a Refresh or a client's request.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND_PREPARATION_STAGES, ACCOUNTS_RETRY_STAGE } from '../../server/brand-preparation-jobs.ts';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const serverFiles = fs.readdirSync(path.join(root, 'server')).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));

test('the accounts retry is not one of the stages a page open or a Refresh runs', () => {
  assert.equal(ACCOUNTS_RETRY_STAGE, 'accounts');
  assert.ok(!BRAND_PREPARATION_STAGES.includes(ACCOUNTS_RETRY_STAGE));
});

test('only the nightly job starts the retry batch', () => {
  const callers = serverFiles.filter(name => /\brunAccountsRetryBatch\s*\(/.test(read(`server/${name}`)));
  assert.deepEqual(callers, ['brand-enrichment.ts']);
  const source = read('server/brand-enrichment.ts');
  assert.equal((source.match(/\brunAccountsRetryBatch\s*\(/g) || []).length, 2, 'its definition and one call');
  const nightly = source.slice(source.indexOf('export async function runNightlyBrandEnrichment'));
  assert.match(nightly, /await runAccountsRetryBatch\(\)/);
  for (const name of ['prepareBrandNow', 'enqueueBrandPreparation', 'runBrandPreparationBatch']) {
    const start = source.indexOf(`export async function ${name}`);
    const body = source.slice(start, source.indexOf('\nexport ', start + 10));
    assert.doesNotMatch(body, /runAccountsRetryBatch|ACCOUNTS_RETRY_STAGE/, `${name} must not run the accounts retry`);
  }
});

test('only the retry batch reads a twice-empty filing again', () => {
  const background = serverFiles.filter(name => /extractAccountsFigures\([^)]*background:\s*true/.test(read(`server/${name}`)));
  assert.deepEqual(background, ['brand-enrichment.ts']);
  const reader = read('server/ch-accounts.ts');
  assert.match(reader, /else if \(cached && sameFiling && \(hasFigures\(cached\) \|\| cached\.retriedEmpty\)\) return cached;/, 'a read from a page or a tool still serves the stored result');
  assert.match(reader, /stop_reason === "max_tokens"/, 'a cut-off reply is recorded as incomplete');
  assert.match(reader, /jsonb_set\(/, 'the read writes its own key only');
});

test('the retry is capped per day through the preparation budget and can be switched off', () => {
  const source = read('server/brand-enrichment.ts');
  const batch = source.slice(source.indexOf('export async function runAccountsRetryBatch'), source.indexOf('async function checkBrandScope'));
  assert.match(batch, /runPreparationStage\(pool, row\.id, ACCOUNTS_RETRY_STAGE/);
  assert.match(batch, /dailyLimit: cap/);
  assert.match(batch, /if \(!cap \|\|/);
  assert.match(batch, /accountsRetryDue\(row\.extracted, now\)/);
  assert.match(batch, /merged_into_id IS NULL AND c\.archived_at IS NULL AND c\.ai_disabled IS DISTINCT FROM TRUE/);
  assert.match(source, /ACCOUNTS_RETRY_DAILY_CAP \?\? 10/);
});

test('the accounts row never pulls a brand into the preparation batch', () => {
  const source = read('server/brand-enrichment.ts');
  const select = source.slice(source.indexOf('async function selectPreparationCompanies'), source.indexOf('export async function runBrandPreparationBatch'));
  const scans = select.match(/LIKE 'brand-preparation:'\|\|c\.id\|\|':%'[^)]{0,60}/g) || [];
  assert.equal(scans.length, 3);
  for (const scan of scans) assert.match(scan, /NOT LIKE '%:\$\{ACCOUNTS_RETRY_STAGE\}'/);
});

test('the profile shows another record\'s figures by reading, never by writing', () => {
  const source = read('server/brand-profile.ts');
  const start = source.indexOf('// Two records can carry one company number');
  const block = source.slice(start, source.indexOf('// Extract covenant data from Companies House JSONB'));
  assert.ok(start > 0 && block.length > 200);
  assert.match(block, /accountsFromSameEntity\(/);
  assert.doesNotMatch(block, /\bUPDATE\b|\bINSERT\b|extractAccountsFigures|anthropic/i);
});
