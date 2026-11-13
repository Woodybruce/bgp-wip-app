// Woody, 13 November 2026: "no lock down". The Landsec AI lock (requests in
// the Landsec view pinned to Anthropic, outside providers refused) was
// removed. A request in the Landsec view follows the provider switches like
// any other login. These guards stop the lock coming back.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const LOCK_NAMES = /runLandsecLocked|isLandsecLocked|assertNotLandsecLocked|refuseIfLandsecLocked|LANDSEC_AI_LOCK|LANDSEC_LOCKED_TOOLS|LANDSEC_AI_PROVIDER|landsecAiLock|landsecLockRefusal|_landsecLocked/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...sourceFiles(rel)); }
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test('no Landsec AI lock in server, shared or client code', () => {
  const hits = ['server', 'shared', 'client/src']
    .flatMap(sourceFiles)
    .filter(file => LOCK_NAMES.test(fs.readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(hits, []);
});

test('the provider choice reads only the switches', async () => {
  const src = fs.readFileSync(path.join(root, 'server/utils/ai-provider.ts'), 'utf8');
  assert.doesNotMatch(src, /AsyncLocalStorage|landsec/i);
  const { chatProvider, globalProvider } = await import('../../server/utils/ai-provider.ts');
  const saved = { c: process.env.CHATBGP_PROVIDER, a: process.env.AI_PROVIDER };
  try {
    process.env.CHATBGP_PROVIDER = 'openai';
    process.env.AI_PROVIDER = 'openai';
    assert.equal(chatProvider(), 'openai');
    assert.equal(globalProvider(), 'openai');
  } finally {
    if (saved.c === undefined) delete process.env.CHATBGP_PROVIDER; else process.env.CHATBGP_PROVIDER = saved.c;
    if (saved.a === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = saved.a;
  }
});
