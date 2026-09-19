import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

test('automatic scan evaluator prepares the current shared vision reader without provider credentials or a database', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bgp-scan-eval-'));
  try {
    const image = path.join(directory, 'synthetic-plan.png');
    await sharp({ create: { width: 64, height: 48, channels: 3, background: 'white' } }).png().toFile(image);
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.EVIDENCE_PLAN_DATABASE_URL;
    const output = path.join(directory, 'prepared');
    execFileSync(process.execPath, ['--import', 'tsx', 'qa/evidence-plan-automatic-eval.mjs', '--case=brent-cross',
      `--image=${image}`, `--out=${output}`, '--prepare-only'], { cwd: root, env, timeout: 30000 });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
    assert.equal(manifest.stage, 'prepared_only_no_provider_or_database_run');
    assert.equal(manifest.image.width, 64);
    assert.equal(manifest.image.height, 48);
    const reader = fs.readFileSync(path.join(root, 'server/plan-scan-vision.ts'));
    assert.equal(manifest.sourceSha256['server/plan-scan-vision.ts'], crypto.createHash('sha256').update(reader).digest('hex'));
    assert.ok(fs.readFileSync(path.join(output, 'executed-scanner-source.ts'), 'utf8').includes('export async function detectTile('));
    assert.equal(fs.readdirSync(output).some(file => /^request-/.test(file)), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
