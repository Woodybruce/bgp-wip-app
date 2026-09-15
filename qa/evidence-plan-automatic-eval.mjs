// Actual automatic scanner evaluation against an original saved plan image.
// Provider responses are real; application writes go only to a disposable schema.
// Required env: ANTHROPIC_API_KEY, EVIDENCE_PLAN_DATABASE_URL (audit DB only).
// Run: node --import tsx qa/evidence-plan-automatic-eval.mjs --case=brent-cross --out=/absolute/audit/output
// Supported cases: brent-cross, brixton. Each process is capped at 20 provider requests.
// --replay-from=/absolute/completed-real-run verifies and reuses those exact responses;
// replay requires the audit DB but no provider credentials/network, and is labelled separately.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import * as detection from '../server/plan-unit-detection.ts';
import * as geometry from '../shared/plan-geometry.ts';
import { buildPlanScanReview, persistPlanScanReview, planScanReviewKey } from '../server/plan-scan-review.ts';
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
if (args['replay-from'] && (typeof args['replay-from'] !== 'string' || !path.isAbsolute(args['replay-from']))) throw new Error('Use --replay-from=/absolute/completed-actual-run');
const replayPath = args['replay-from'] ? path.resolve(args['replay-from']) : null;
if (!process.env.ANTHROPIC_API_KEY && !args['prepare-only'] && !replayPath) throw new Error('ANTHROPIC_API_KEY must be injected at runtime; this script never reads credential files');
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
// This compares the exact fields recorded by the original evaluator. The full
// detectTile/prompt source is also required to be byte-identical to the donor,
// so replay cannot silently test changed image assembly or provider options.
function requestSignature(request) {
  return {
    model: request.model, max_tokens: request.max_tokens, prompt: request.prompt,
    images: request.images.map(image => ({ sha256: image.sha256, bytes: image.bytes, mediaType: image.mediaType })),
    requestOptions: { timeout: request.requestOptions?.timeout, maxRetries: request.requestOptions?.maxRetries },
  };
}
function loadReplay(directory) {
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'));
  const summaryBytes = fs.readFileSync(path.join(directory, 'summary.json'));
  const donor = JSON.parse(manifestBytes), summary = JSON.parse(summaryBytes);
  const count = summary.providerUsage?.requests;
  if (summary.stage !== 'actual_automatic_pipeline_completed' || summary.jobStatus !== 'done'
    || donor.provider !== 'Anthropic Messages API' || donor.replay || summary.replay
    || (donor.executionMode && donor.executionMode !== 'live_provider')
    || !Number.isInteger(count) || count < 1 || count > cap
    || summary.providerUsage.completed !== count || summary.providerUsage.failed !== 0 || summary.providerRequestCapReached) {
    throw new Error('Replay donor must be a completed, successful actual-provider run with no failed requests or prior replay');
  }
  if (donor.case !== args.case || donor.image?.sha256 !== digest(imageBytes)
    || donor.image.width !== meta.width || donor.image.height !== meta.height) throw new Error('Replay donor image/hash/frame does not match this run');
  const scannerBytes = fs.readFileSync(path.join(directory, 'executed-scanner-source.ts'));
  const acceptedUnitsBytes = fs.readFileSync(path.join(directory, 'automatically-saved-units.json'));
  const acceptedUnits = JSON.parse(acceptedUnitsBytes);
  if (!Array.isArray(acceptedUnits) || acceptedUnits.length !== summary.finalUnitCount) throw new Error('Replay donor saved-unit artifact does not match its final unit count');
  if (!scannerBytes.toString().includes(tileSource)) throw new Error('Replay requires identical detection prompt and request-building source; only worker/persistence changes can be replayed');
  for (const file of ['server/plan-unit-detection.ts', 'shared/plan-geometry.ts']) {
    if (donor.sourceSha256?.[file] !== digest(fs.readFileSync(path.join(root, file)))) throw new Error(`Replay requires unchanged geometry source: ${file}`);
  }
  const files = fs.readdirSync(directory);
  if (files.filter(file => /^request-\d+-request\.json$/.test(file)).length !== count
    || files.filter(file => /^request-\d+-response\.json$/.test(file)).length !== count
    || files.some(file => /^request-\d+-error\.json$/.test(file))) throw new Error('Replay donor request/response files do not match its reported complete request count');
  const requests = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1, prefix = `request-${String(ordinal).padStart(2, '0')}`;
    const requestBytes = fs.readFileSync(path.join(directory, `${prefix}-request.json`));
    const responseBytes = fs.readFileSync(path.join(directory, `${prefix}-response.json`));
    const request = JSON.parse(requestBytes), response = JSON.parse(responseBytes);
    if (!Array.isArray(request.images) || !Array.isArray(request.prompt) || !Array.isArray(response.content)
      || response.stop_reason === 'max_tokens' || typeof response.id !== 'string' || !response.id.startsWith('msg_')) throw new Error(`Replay donor request ${ordinal} is not a complete recorded provider response`);
    for (const image of request.images) {
      if (typeof image.file !== 'string' || path.basename(image.file) !== image.file
        || !image.file.startsWith(`${prefix}-image-`)) throw new Error('Invalid donor image filename');
      const bytes = fs.readFileSync(path.join(directory, image.file));
      if (digest(bytes) !== image.sha256 || bytes.length !== image.bytes) throw new Error(`Replay donor image integrity check failed for ${image.file}`);
    }
    return { ordinal, request, response, responseBytes, requestSha256: digest(requestBytes), responseSha256: digest(responseBytes) };
  });
  return { requests, acceptedUnits, provenance: {
    donorDirectory: directory, donorManifestSha256: digest(manifestBytes), donorSummarySha256: digest(summaryBytes),
    donorScannerSourceSha256: digest(scannerBytes), donorImageSha256: donor.image.sha256,
    donorAcceptedUnitsSha256: digest(acceptedUnitsBytes),
    donorRequestCount: count, donorProviderUsage: summary.providerUsage,
    donorRequests: requests.map(item => ({ ordinal: item.ordinal, requestSha256: item.requestSha256, responseSha256: item.responseSha256 })),
    requestMatching: 'Identical detection source, model, max_tokens, ordered text prompts, ordered image SHA-256/bytes/media type, timeout and maxRetries; unchanged geometry source.',
    verifiedRequests: [], allRequestsConsumed: false, externalProviderCalls: 0,
  } };
}
const replay = replayPath ? loadReplay(replayPath) : null;
const manifest = {
  startedAt: new Date().toISOString(), case: args.case, name: selected.name,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  gitStatus: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceSha256: Object.fromEntries(['server/evidence-plan.ts', 'server/plan-unit-detection.ts', 'server/plan-scan-review.ts', 'shared/plan-geometry.ts', 'shared/plan-scan-review.ts', 'qa/evidence-plan-automatic-eval.mjs'].map(file => [file, digest(fs.readFileSync(path.join(root, file)))])),
  image: { path: imagePath, sha256: digest(imageBytes), width: meta.width, height: meta.height, bytes: imageBytes.length },
  maxProviderRequests: cap, provider: replay ? 'Recorded Anthropic responses; no external provider calls' : 'Anthropic Messages API', model: 'from actual detectTile source (no override)',
  executionMode: replay ? 'recorded_response_replay' : 'live_provider',
  ...(replay ? { replay: replay.provenance } : {}),
  inputScope: 'Original image only, newly uploaded empty level; no tenancy schedule, evidence records, existing units, manual seeds or manual region selections supplied.',
  databaseScope: 'Throwaway schema on explicitly restricted disposable local audit database; never production.',
  stage: args['prepare-only'] ? 'prepared_only_no_provider_or_database_run' : replay ? 'running_recorded_response_replay' : 'running_actual_automatic_pipeline',
};
write('manifest.json', manifest);
write('executed-scanner-source.ts', commonSource + '\n' + tileSource + '\n' + workerSource);
write('executed-scan-review-source.ts', source('server/plan-scan-review.ts'));
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
const sdk = replay ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const usage = { requests: 0, completed: 0, failed: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const externalUsage = () => replay ? Object.fromEntries(Object.keys(usage).map(key => [key, 0])) : { ...usage };
let observationIndex = 0, budgetExhausted = false, lastProgress = '', schemaCreated = false, replayMismatch = false;
const observations = [];
const anthropic = { messages: { create: async (body, options) => {
  if (replayMismatch) throw new Error('Replay stopped after a request mismatch; no alternative responses can be substituted');
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
  const request = { model: body.model, max_tokens: body.max_tokens,
    prompt: content.filter(block => block.type === 'text').map(block => block.text), images: imagesSaved,
    requestOptions: { timeout: options?.timeout, maxRetries: options?.maxRetries }, startedAt: new Date(started).toISOString() };
  write(`${prefix}-request.json`, request);
  console.log(`[${replay ? 'recorded-response replay' : 'actual scan'} ${args.case}] ${replay ? 'verifying recorded request' : 'provider request'} ${ordinal}/${cap}`);
  try {
    let response;
    if (replay) {
      const donor = replay.requests[ordinal - 1];
      try {
        if (!donor) throw new Error('No remaining donor response');
        assert.equal(JSON.stringify(requestSignature(request)), JSON.stringify(requestSignature(donor.request)));
      } catch {
        replayMismatch = true;
        throw new Error(`Replay request ${ordinal} does not exactly match the donor model, prompt, images or options`);
      }
      response = donor.response;
      fs.writeFileSync(path.join(output, `${prefix}-response.json`), donor.responseBytes);
      replay.provenance.verifiedRequests.push({ ordinal, currentRequestSha256: digest(fs.readFileSync(path.join(output, `${prefix}-request.json`))),
        donorRequestSha256: donor.requestSha256, responseSha256: donor.responseSha256 });
      write('replay-verification.json', replay.provenance);
    } else response = await sdk.messages.create(body, options);
    usage.completed++;
    for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) usage[key] += Number(response.usage?.[key] || 0);
    if (!replay) write(`${prefix}-response.json`, response);
    append(replay ? 'recorded-response-usage.jsonl' : 'provider-usage.jsonl', { ordinal, elapsedMs: Date.now() - started, model: response.model, stopReason: response.stop_reason, usage: response.usage,
      ...(replay ? { usageMeaning: 'Historical donor token usage; replay makes zero external calls and incurs no provider token usage' } : {}) });
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
  ...helpers, pool, setInterval, clearInterval, buildPlanScanReview, persistPlanScanReview, require: runtimeRequire, console: capturedConsole,
  getFile: async key => { if (key !== backgroundKey) throw new Error('Unexpected file key in isolated scanner'); return { data: imageBytes }; },
  detectTile: async (...args) => {
    const requestStart = usage.requests;
    const result = await extracted.detectTile(...args);
    const frame = { x: args[4], y: args[5], width: args[6], height: args[7], overview: args[9], focused: args[11] || false, candidateIds: (args[10] || []).map(region => region.id) };
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
    CREATE TABLE file_storage (storage_key text PRIMARY KEY, data bytea, content_type text, original_name text, size integer);
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
  const reviewFile = (await db.query('SELECT data FROM file_storage WHERE storage_key=$1', [planScanReviewKey(planId, started.jobId)])).rows[0];
  if (reviewFile) write('scan-review-artifact.json', JSON.parse(reviewFile.data.toString()));
  if (replay) {
    if (replayMismatch || usage.failed || usage.requests !== replay.requests.length || usage.completed !== replay.requests.length
      || job.status !== 'done' || budgetExhausted) throw new Error('Replay did not consume every donor request exactly once and complete the worker successfully');
    replay.provenance.allRequestsConsumed = true;
    write('replay-verification.json', replay.provenance);
    const boundaryGroups = rows => {
      const groups = new Map();
      for (const row of rows) {
        const key = digest(JSON.stringify(row.polygon));
        const group = groups.get(key) || [];
        group.push({ unitRef: row.unit_ref, tenant: row.tenant_name || null, source: row.source });
        groups.set(key, group);
      }
      return groups;
    };
    const before = boundaryGroups(replay.acceptedUnits), after = boundaryGroups(units);
    write('replay-accepted-unit-comparison.json', {
      mode: 'Recorded actual-provider responses replayed through changed worker/persistence; no new model evaluation',
      donorAcceptedUnitsSha256: replay.provenance.donorAcceptedUnitsSha256,
      replayAcceptedUnitsSha256: digest(fs.readFileSync(path.join(output, 'automatically-saved-units.json'))),
      donorUnitCount: replay.acceptedUnits.length, replayUnitCount: units.length,
      addedBoundaries: [...after].filter(([key]) => !before.has(key)).map(([boundarySha256, labels]) => ({ boundarySha256, labels })),
      removedBoundaries: [...before].filter(([key]) => !after.has(key)).map(([boundarySha256, labels]) => ({ boundarySha256, labels })),
      changedLabels: [...after].filter(([key, labels]) => before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(labels))
        .map(([boundarySha256, labels]) => ({ boundarySha256, before: before.get(boundarySha256), after: labels })),
      limits: 'Exact saved-polygon comparison, not accuracy scoring. UUIDs are deliberately ignored. Use the independent sample scorer separately and label results as recorded-response replay.',
    });
  }
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
    completedAt: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(manifest.startedAt), stage: replay ? 'verified_recorded_response_replay_completed' : 'actual_automatic_pipeline_completed',
    executionMode: replay ? 'recorded_response_replay' : 'live_provider',
    case: args.case, jobStatus: job.status, imageSections: { completed: job.done_docs, total: job.total_docs },
    providerUsage: externalUsage(), providerRequestCapReached: budgetExhausted,
    ...(replay ? { replay: { ...replay.provenance, verificationSha256: digest(fs.readFileSync(path.join(output, 'replay-verification.json'))) },
      replayUsage: { ...usage, meaning: 'Recorded response count and historical donor tokens, not new provider coverage or charges' } } : {}),
    estimatedTokenCostUsd: replay ? 0 : pricingKnown ? (usage.input_tokens * inputRate + usage.output_tokens * outputRate) / 1000000 : null,
    costNote: replay ? 'Offline replay of recorded responses. No external provider calls or new token charges.' : pricingKnown ? 'Estimate using externally supplied per-million-token rates; cache charges and provider billing adjustments excluded.' : 'Provider returned token usage, not billed cost; no unverified pricing assumed.',
    modelObservationCount: observations.reduce((sum, item) => sum + item.observations.length, 0),
    finalUnitCount: units.length, unlabelledUnitCount: units.filter(unit => /^Unlabelled\b/i.test(unit.unit_ref)).length,
    reviewDetails: job.error || null, sourceHead: manifest.gitHead, output,
    accuracy: 'Not scored automatically. Inspect actual selected outlines and labels against source; completion and unit count do not prove correct detection.',
  };
  if (job.status !== 'done' || budgetExhausted) process.exitCode = 2;
} catch (error) {
  result = { stage: 'evaluation_failed', executionMode: replay ? 'recorded_response_replay' : 'live_provider', completedAt: new Date().toISOString(), case: args.case,
    error: { name: error.name, message: error.message }, providerUsage: externalUsage(), ...(replay ? { replay: replay.provenance, replayUsage: usage } : {}), output };
  process.exitCode = 1;
} finally {
  try { if (schemaCreated) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await db.end(); }
  if (result) { result.disposableSchemaCleaned = true; write('summary.json', result); console.log(JSON.stringify(result, null, 2)); }
}
