// Actual automatic scanner evaluation against an original saved plan image.
// Provider responses are real; application writes go only to a disposable schema.
// Required env: ANTHROPIC_API_KEY, EVIDENCE_PLAN_DATABASE_URL (audit DB only).
// Run: node --import tsx qa/evidence-plan-automatic-eval.mjs --case=brent-cross --out=/absolute/audit/output
// Supported cases: brent-cross, brixton. Each process is capped at 20 provider requests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import * as detection from '../server/plan-unit-detection.ts';
import * as geometry from '../shared/plan-geometry.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./regression/source-harness.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const split = arg.indexOf('='); return [arg.slice(2, split < 0 ? undefined : split), split < 0 ? true : arg.slice(split + 1)]; }));
const cases = {
  'brent-cross': { name: 'Brent Cross lower level', image: '../audit-evidence/evidence-plan-20260907/brent-cross-live-lower.jpg' },
  brixton: { name: 'Brixton Market site plan', image: '../audit-evidence/evidence-plan-20260907/brixton-live-original.jpg' },
};
const selected = cases[args.case];
if (!selected) throw new Error('Select --case=brent-cross or --case=brixton');
const imagePath = path.resolve(root, args.image || selected.image);
const output = path.resolve(args.out || path.join(root, '../audit-evidence/evidence-plan-20260907', `automatic-provider-${args.case}-${Date.now()}`));
const cap = Number(process.env.EVIDENCE_SCAN_MAX_CALLS || 20);
if (!Number.isInteger(cap) || cap < 1 || cap > 20) throw new Error('EVIDENCE_SCAN_MAX_CALLS must be 1..20 (default 20 per image)');
if (!process.env.ANTHROPIC_API_KEY && !args['prepare-only']) throw new Error('ANTHROPIC_API_KEY must be injected at runtime; this script never reads credential files');
const connectionString = process.env.EVIDENCE_PLAN_DATABASE_URL;
function auditDatabaseConfig(value) {
  if (!value) throw new Error('Provide EVIDENCE_PLAN_DATABASE_URL for the disposable audit database');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.host || url.username || url.password || url.hash
    || url.pathname !== '/bgp_crm_directory_regression') throw new Error('Refusing a non-disposable database');
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !['host', 'port', 'user'].includes(key))) throw new Error('Only unique host, port and user database parameters are allowed');
  const host = url.searchParams.get('host'), port = url.searchParams.get('port'), user = url.searchParams.get('user');
  if (!/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(host || '') || user !== 'postgres'
    || !/^\d{1,5}$/.test(port || '') || Number(port) < 1 || Number(port) > 65535) throw new Error('Use the disposable local audit socket, port and postgres user');
  return { host, port: Number(port), user, password: '', database: 'bgp_crm_directory_regression', ssl: false };
}
const databaseConfig = args['prepare-only'] ? null : auditDatabaseConfig(connectionString);
fs.mkdirSync(output, { recursive: true });
if (fs.existsSync(path.join(output, 'manifest.json'))) throw new Error('Use a new output directory to preserve previous evaluation evidence');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const write = (name, data) => fs.writeFileSync(path.join(output, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const append = (name, data) => fs.appendFileSync(path.join(output, name), JSON.stringify(data) + '\n');
const declaration = name => find('server/evidence-plan.ts', node => (ts.isFunctionDeclaration(node) && node.name?.text === name)
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText() === name)));
const commonNames = ['normaliseUnitRef', 'normTenantName', 'stripCoName', 'evidenceScheduleRows', 'matchEvidenceScheduleRow', 'relinkAllEntries', 'startDetectJob'];
const commonSource = commonNames.map(declaration).join('\n');
const tileSource = ['DETECT_PROMPT', 'extractJsonObject', 'detectTile'].map(declaration).join('\n');
const workerSource = declaration('runDetectJob');
const imageBytes = fs.readFileSync(imagePath);
const meta = await sharp(imageBytes).metadata();
const manifest = {
  startedAt: new Date().toISOString(), case: args.case, name: selected.name,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  gitStatus: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceSha256: Object.fromEntries(['server/evidence-plan.ts', 'server/plan-unit-detection.ts', 'shared/plan-geometry.ts', 'qa/evidence-plan-automatic-eval.mjs'].map(file => [file, digest(fs.readFileSync(path.join(root, file)))])),
  image: { path: imagePath, sha256: digest(imageBytes), width: meta.width, height: meta.height, bytes: imageBytes.length },
  maxProviderRequests: cap, provider: 'Anthropic Messages API', model: 'from actual detectTile source (no override)',
  inputScope: 'Original image only, newly uploaded empty level; no tenancy schedule, evidence records, existing units, manual seeds or manual region selections supplied.',
  databaseScope: 'Throwaway schema on explicitly restricted disposable local audit database; never production.',
  stage: args['prepare-only'] ? 'prepared_only_no_provider_or_database_run' : 'running_actual_automatic_pipeline',
};
write('manifest.json', manifest);
write('executed-scanner-source.ts', commonSource + '\n' + tileSource + '\n' + workerSource);
const capturedConsole = {
  log: (...values) => { console.log(...values); append('pipeline-log.jsonl', { at: new Date().toISOString(), level: 'log', values }); },
  warn: (...values) => { console.warn(...values); append('pipeline-log.jsonl', { at: new Date().toISOString(), level: 'warn', values }); },
  error: (...values) => { console.error(...values); append('pipeline-log.jsonl', { at: new Date().toISOString(), level: 'error', values }); },
};
const runtimeRequire = name => {
  if (name === 'sharp') return { default: sharp };
  if (name === './plan-unit-detection') return detection;
  if (name === '@shared/plan-geometry') return geometry;
  throw new Error(`Unexpected scanner dependency: ${name}`);
};
if (args['prepare-only']) {
  // Transpile the exact extracted functions without running a worker or substituting an AI response.
  evaluate(tileSource + '\nexports.tile = detectTile;', { require: runtimeRequire });
  evaluate(commonSource + '\n' + workerSource, { require: runtimeRequire });
  console.log(JSON.stringify({ stage: manifest.stage, image: manifest.image, output }));
  process.exit(0);
}
const schema = `qa_actual_scan_${process.pid}_${Date.now()}`;
const db = new pg.Pool({ ...databaseConfig, max: 4, options: `-c search_path=${schema}` });
const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const usage = { requests: 0, completed: 0, failed: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
let observationIndex = 0, budgetExhausted = false, lastProgress = '', schemaCreated = false;
const observations = [];
const anthropic = { messages: { create: async (body, options) => {
  if (usage.requests >= cap) { budgetExhausted = true; throw new Error(`Evaluation provider request limit (${cap}) reached`); }
  const ordinal = ++usage.requests, prefix = `request-${String(ordinal).padStart(2, '0')}`;
  const started = Date.now();
  const content = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
  const images = content.filter(block => block.type === 'image');
  const imagesSaved = images.map((block, index) => {
    const bytes = Buffer.from(block.source.data, 'base64'), name = `${prefix}-image-${index + 1}.jpg`;
    fs.writeFileSync(path.join(output, name), bytes);
    return { file: name, sha256: digest(bytes), bytes: bytes.length, mediaType: block.source.media_type };
  });
  write(`${prefix}-request.json`, { model: body.model, max_tokens: body.max_tokens,
    prompt: content.filter(block => block.type === 'text').map(block => block.text), images: imagesSaved,
    requestOptions: { timeout: options?.timeout, maxRetries: options?.maxRetries }, startedAt: new Date(started).toISOString() });
  console.log(`[actual scan ${args.case}] provider request ${ordinal}/${cap}`);
  try {
    const response = await sdk.messages.create(body, options);
    usage.completed++;
    for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) usage[key] += Number(response.usage?.[key] || 0);
    write(`${prefix}-response.json`, response);
    append('provider-usage.jsonl', { ordinal, elapsedMs: Date.now() - started, model: response.model, stopReason: response.stop_reason, usage: response.usage });
    return response;
  } catch (error) {
    usage.failed++;
    // No request headers, SDK config or environment data are retained.
    write(`${prefix}-error.json`, { elapsedMs: Date.now() - started, status: error.status || null, name: error.name, message: error.message });
    throw error;
  }
} } };
const extracted = evaluate(tileSource + '\nexports.detectTile = detectTile;', { anthropic, require: runtimeRequire, console: capturedConsole });
const pool = {
  query: async (sql, values) => {
    if (sql.startsWith('UPDATE evidence_plan_jobs') && typeof values?.[0] === 'string' && values[0] !== lastProgress) {
      lastProgress = values[0]; console.log(`[actual scan ${args.case}] ${lastProgress}`);
      append('progress.jsonl', { at: new Date().toISOString(), message: lastProgress, completedSections: values[1] });
    }
    return db.query(sql, values);
  },
  connect: () => db.connect(),
};
const backgroundKey = `audit/${args.case}/${manifest.image.sha256}`;
const helpers = evaluate(commonSource + '\nexports.relinkAllEntries = relinkAllEntries; exports.startDetectJob = startDetectJob; exports.normaliseUnitRef = normaliseUnitRef; exports.normTenantName = normTenantName;', { pool, console: capturedConsole });
const { runDetectJob } = evaluate(workerSource + '\nexports.runDetectJob = runDetectJob;', {
  ...helpers, pool, setInterval, clearInterval, require: runtimeRequire, console: capturedConsole,
  getFile: async key => { if (key !== backgroundKey) throw new Error('Unexpected file key in isolated scanner'); return { data: imageBytes }; },
  detectTile: async (...args) => {
    const requestStart = usage.requests;
    const result = await extracted.detectTile(...args);
    const frame = { x: args[4], y: args[5], width: args[6], height: args[7], overview: args[9] };
    const observation = { sectionAttempt: ++observationIndex, requestOrdinal: usage.requests, requestStart, frame, observations: result };
    observations.push(observation); write('provider-selected-observations.json', observations);
    return result;
  },
});
const xml = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
let result;
try {
  await db.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
  await db.query(`
    CREATE TABLE evidence_plans (id uuid PRIMARY KEY, property_id varchar, updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_levels (id uuid PRIMARY KEY, plan_id uuid, background_key text);
    CREATE TABLE evidence_plan_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, level_id uuid, kind text,
      status text DEFAULT 'running', total_docs int DEFAULT0, done_docs int DEFAULT0, created int DEFAULT0,
      extracted int DEFAULT0, linked int DEFAULT0, error text, created_by varchar,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE evidence_plan_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, level_id uuid,
      unit_ref text, tenant_name text, polygon jsonb, dot jsonb, source text);
    CREATE TABLE evidence_plan_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, unit_ref text, unit_id uuid, tenant text);
  `.replaceAll('DEFAULT0', 'DEFAULT 0'));
  const planId = crypto.randomUUID(), levelId = crypto.randomUUID();
  await db.query('INSERT INTO evidence_plans (id) VALUES ($1)', [planId]);
  await db.query('INSERT INTO evidence_plan_levels VALUES ($1,$2,$3)', [levelId, planId, backgroundKey]);
  const started = await helpers.startDetectJob(planId, levelId, null);
  manifest.auditJobId = started.jobId; write('manifest.json', manifest);
  await runDetectJob(planId, started.jobId, { id: levelId, background_key: backgroundKey }, null, true);
  const job = (await db.query('SELECT * FROM evidence_plan_jobs WHERE id = $1', [started.jobId])).rows[0];
  const units = (await db.query('SELECT * FROM evidence_plan_units WHERE plan_id = $1 ORDER BY unit_ref, id', [planId])).rows;
  write('job-result.json', job); write('automatically-saved-units.json', units);
  const markerFont = Math.max(12, (meta.width || 1000) * .005);
  const shapes = units.map(unit => {
    const polygon = unit.polygon || [], dot = unit.dot || geometry.interiorPoint(polygon);
    const colour = /^Unlabelled\b/i.test(unit.unit_ref) ? '#b36800' : '#00755e';
    return `<polygon points="${polygon.map(point => `${point.x * meta.width},${point.y * meta.height}`).join(' ')}" fill="${colour}25" stroke="${colour}" stroke-width="2"/>${dot ? `<text x="${dot.x * meta.width}" y="${dot.y * meta.height}" text-anchor="middle" font-family="Arial" font-size="${markerFont}" font-weight="bold" fill="${colour}" stroke="white" stroke-width="3" paint-order="stroke">${xml(unit.unit_ref)}</text>` : ''}`;
  }).join('');
  write('automatic-selection-overlay.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${shapes}</svg>`);
  await sharp(imageBytes).composite([{ input: Buffer.from(`<svg width="${meta.width}" height="${meta.height}">${shapes}</svg>`) }]).png().toFile(path.join(output, 'automatic-selection-overlay.png'));
  const inputRate = Number(process.env.EVIDENCE_SCAN_INPUT_USD_PER_MILLION), outputRate = Number(process.env.EVIDENCE_SCAN_OUTPUT_USD_PER_MILLION);
  const pricingKnown = Number.isFinite(inputRate) && Number.isFinite(outputRate) && inputRate > 0 && outputRate > 0;
  result = {
    completedAt: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(manifest.startedAt), stage: 'actual_automatic_pipeline_completed',
    case: args.case, jobStatus: job.status, imageSections: { completed: job.done_docs, total: job.total_docs },
    providerUsage: usage, providerRequestCapReached: budgetExhausted,
    estimatedTokenCostUsd: pricingKnown ? (usage.input_tokens * inputRate + usage.output_tokens * outputRate) / 1000000 : null,
    costNote: pricingKnown ? 'Estimate using externally supplied per-million-token rates; cache charges and provider billing adjustments excluded.' : 'Provider returned token usage, not billed cost; no unverified pricing assumed.',
    modelObservationCount: observations.reduce((sum, item) => sum + item.observations.length, 0),
    finalUnitCount: units.length, unlabelledUnitCount: units.filter(unit => /^Unlabelled\b/i.test(unit.unit_ref)).length,
    reviewDetails: job.error || null, sourceHead: manifest.gitHead, output,
    accuracy: 'Not scored automatically. Inspect actual selected outlines and labels against source; completion and unit count do not prove correct detection.',
  };
  if (job.status !== 'done' || budgetExhausted) process.exitCode = 2;
} catch (error) {
  result = { stage: 'evaluation_failed', completedAt: new Date().toISOString(), case: args.case, error: { name: error.name, message: error.message }, providerUsage: usage, output };
  process.exitCode = 1;
} finally {
  try { if (schemaCreated) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await db.end(); }
  if (result) { result.disposableSchemaCleaned = true; write('summary.json', result); console.log(JSON.stringify(result, null, 2)); }
}
