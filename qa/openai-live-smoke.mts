// Manual, paid API smoke. Synthetic inputs only; never executes application tools.
// Run with OPENAI_API_KEY already set. Does not load the database or meter to it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import sharp from 'sharp';
import { createOpenAIAdapter } from '../server/utils/openai-client';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./regression/source-harness.cjs');
const source = find('server/chatbgp.ts', (n: any) => ts.isFunctionDeclaration(n) && n.name?.text === 'getAvailableTools');
const { getAvailableTools } = evaluate(source, { getCached: () => null, setCache: () => {},
  storage: { getExcelTemplates: async () => [{ id: 'synthetic-model', name: 'QA', inputMapping: '{}' }],
    getDocumentTemplates: async () => [{ id: 'synthetic-doc', name: 'QA', status: 'approved', fields: '[]' }] } });
const { tools } = await getAvailableTools();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 });
let usageCalls = 0;
const adapter = createOpenAIAdapter({ create: (body, options) => client.responses.create(body, options) as any,
  logUsage: () => { usageCalls++; } });
const defaults = { model: 'gpt-6.1-sol', max_completion_tokens: 2048, effort: 'low' };
const msg = (r: any) => r.choices[0].message;
async function stage(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try { await fn(); console.log(JSON.stringify({ check: name, result: 'PASS', seconds: Math.round((Date.now()-t)/1000) })); }
  catch (e: any) { console.log(JSON.stringify({ check: name, result: 'FAIL', status: e.status, error: String(e.message).slice(0, 900) })); process.exitCode=1; throw e; }
}
await stage('Sol text', async () => {
  const r = await adapter.callOpenAI({ ...defaults, messages: [{ role: 'user', content: 'Reply exactly BGP_READY.' }] });
  assert.match(msg(r).content, /BGP_READY/);
});
await stage(`full catalogue (${tools.length} tools), function call and stateless replay`, async () => {
  const messages: any[] = [{ role: 'system', content: 'You are in a synthetic QA test. Search the CRM for Example QA Company using the available search_crm tool. Do not invent results or perform other actions.' }, { role: 'user', content: 'Find Example QA Company in the CRM.' }];
  const first = await adapter.callOpenAI({ ...defaults, tools, messages });
  const m = msg(first);
  assert.ok(m.tool_calls?.some((t: any) => t.function.name === 'search_crm'), 'CRM search was not called');
  messages.push(m);
  for (const call of m.tool_calls) messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ success: true, results: [{ name: 'Example QA Company', id: 'QA-ONLY-42' }] }) });
  const second = await adapter.callOpenAI({ ...defaults, tools, tool_choice: 'none', messages });
  assert.match(msg(second).content, /Example QA Company/);
  assert.ok(!msg(second).tool_calls?.length);
});
await stage('Luna full-catalogue tool lookup', async () => {
  const r = await adapter.callOpenAI({ model: 'gpt-6-luna', max_completion_tokens: 2048, tools,
    messages: [{ role: 'user', content: 'Synthetic QA: use search_crm to find Example QA Company. Do not run any other application action.' }] });
  assert.ok(msg(r).tool_calls?.some((t: any) => t.function.name === 'search_crm'));
});
await stage('Sol image and streaming', async () => {
  const png = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#ff0000' } }).png().toBuffer();
  let streamed = '';
  const r = await adapter.callOpenAIStreaming({ ...defaults, messages: [{ role: 'user', content: [{ type: 'text', text: 'What is the dominant colour? Reply in one word.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] }] }, delta => { streamed += delta; });
  assert.match(msg(r).content, /red/i); assert.equal(streamed, msg(r).content);
});
await stage('Luna helper JSON', async () => {
  const r = await adapter.callOpenAI({ model: 'gpt-6-luna', max_completion_tokens: 50, thinking: false, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Extract as JSON with keys unit and rent: Unit D3, annual rent 45000.' }] });
  assert.deepEqual(JSON.parse(msg(r).content), { unit: 'D3', rent: 45000 });
});
await stage('Sol short helper reasoning budget', async () => {
  const r = await adapter.callOpenAI({ model: 'gpt-6.1-sol', max_completion_tokens: 50, messages: [{ role: 'user', content: 'Reply with just the unit number from: Card Factory, Unit D3.' }] });
  assert.match(msg(r).content, /D3/);
});
await stage('Stop cancels request', async () => {
  const start = Date.now();
  await assert.rejects(adapter.callOpenAIStreaming({ ...defaults, messages: [{ role: 'user', content: 'Write a detailed 2000-word essay about architecture.' }] }, () => {}, () => Date.now() - start > 250), /abort/i);
});
console.log(JSON.stringify({ summary: 'All synthetic checks passed; no app tools executed', usageCalls }));
