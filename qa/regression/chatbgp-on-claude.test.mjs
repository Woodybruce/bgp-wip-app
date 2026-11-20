// Woody, 20 November 2026: "change chat bGP to actually use opus 5.5 rather
// than open ai". Live had the chat on OpenAI's Astra through the provider
// switches on Railway. The chat loop now stays on Claude whatever they say,
// so its default model is Opus 5.5; the shared helpers still follow AI_PROVIDER.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, route, evaluate, ts } = require('./source-harness.cjs');

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

async function withSwitches(chat, global, fn) {
  const saved = { c: process.env.CHATBGP_PROVIDER, a: process.env.AI_PROVIDER };
  try {
    if (chat === undefined) delete process.env.CHATBGP_PROVIDER; else process.env.CHATBGP_PROVIDER = chat;
    if (global === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = global;
    return await fn();
  } finally {
    if (saved.c === undefined) delete process.env.CHATBGP_PROVIDER; else process.env.CHATBGP_PROVIDER = saved.c;
    if (saved.a === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = saved.a;
  }
}

const { chatProvider, globalProvider } = await import('../../server/utils/ai-provider.ts');
const { chatQualitySettings } = evaluate(source('server/chat-quality-settings.ts'));
const router = evaluate(source('server/chatbgp-model-router.ts').replace(/^import .*;$/mg, ''), {
  chatProvider, mapModelForKimi: m => m,
  openaiChatModel: () => 'gpt-6.1-sol', openaiHelperModel: () => 'gpt-6-luna', openaiAdvancedModel: () => 'gpt-6-astra',
  pool: { query: async () => ({ rows: [] }) },
});

test('an openai switch on Railway leaves the chat on Claude Opus 5.5 and the helpers on OpenAI', async () => {
  for (const [chat, global] of [[undefined, 'openai'], ['openai', 'openai'], ['openai', undefined]]) {
    await withSwitches(chat, global, async () => {
      assert.equal(chatProvider(), 'anthropic');
      assert.equal(globalProvider(), global === 'openai' ? 'openai' : 'anthropic');
      assert.deepEqual({ ...router.selectChatModel() }, { model: 'claude-opus-5-5', label: 'opus' });
      for (const saved of ['astra', 'sol', 'luna', 'opus', null]) {
        assert.equal(router.selectChatModel(saved).model, 'claude-opus-5-5', `saved ${saved}`);
      }
      assert.equal(router.selectChatModel('sonnet').model, 'claude-sonnet-4-6');
      assert.equal(router.selectChatModel('fable').model, 'claude-fable-5-2');
      assert.match(router.ackMessage('astra'), /Using Opus/);
      assert.doesNotMatch(router.ackMessage('astra'), /Astra|OpenAI/);
    });
  }
});

test('the chat status on live reads Claude, Opus 5.5 and medium effort under an openai switch', async () => {
  const guard = find('server/chatbgp.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'hasChatKeyConfigured');
  const status = route('server/chatbgp.ts', 'get', '/api/chatbgp/status');
  await withSwitches(undefined, 'openai', async () => {
    let handler;
    evaluate(`${guard}\n${status}`, { process: { env: { ANTHROPIC_API_KEY: 'test-only', OPENAI_API_KEY: 'test-only' } }, chatProvider,
      requireAuth() {}, app: { get: (_path, _auth, callback) => { handler = callback; } },
      selectChatModel: router.selectChatModel, chatQualitySettings });
    let result;
    handler({}, { json: obj => { result = obj; } });
    assert.deepEqual({ ...result }, { connected: true, provider: 'anthropic', defaultModel: 'claude-opus-5-5', reasoningEffort: 'medium' });
  });
});

// Woody, the same day: "Fable still for excel 5.2".
test('the Excel pane runs on Fable 5.2 and its footer says so', () => {
  const resolved = find('server/chatbgp.ts', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'excelResolved'));
  assert.match(resolved, /override:\s*excelSlashOverride \|\| \(host === "excel" \? "fable" : null\)/);
  assert.doesNotMatch(resolved, /chatProvider/, 'the Fable default no longer depends on the provider switch');
  assert.match(source('server/chatbgp-model-router.ts'), /const FABLE = "claude-fable-5-2";/);
  const pane = read('client/src/pages/addin-excel.tsx');
  assert.match(pane, /Claude Fable 5\.2 · BGP CRM/);
  assert.doesNotMatch(pane, /Claude Fable 5 · BGP CRM|Claude Opus 5\.5 · BGP CRM/);
});

test('ChatBGP tells people it runs on Opus 5.5, not that Astra is the default', () => {
  const map = read('server/chatbgp-app-map.ts');
  assert.match(map, /ChatBGP runs on Claude Opus 5\.5/);
  assert.doesNotMatch(map, /defaults to Astra/);
});
