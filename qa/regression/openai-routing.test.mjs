import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const routerFile = 'server/chatbgp-model-router.ts';
function routing(provider, savedPreference, models = {}) {
  const sql = [];
  const code = source(routerFile).replace(/^import .*;$/mg, '');
  const exports = evaluate(code, {
    chatProvider: () => provider, mapModelForKimi: m => m.includes('sonnet') ? 'kimi-k2.6' : 'kimi-k3',
    openaiChatModel: () => models.sol || 'gpt-6.1-sol', openaiHelperModel: () => models.luna || 'gpt-6-luna', openaiAdvancedModel: () => models.astra || 'gpt-6-astra',
    pool: { query: async (q, args) => { sql.push([q,args]); return { rows: [{ model_preference: savedPreference }] }; } }
  });
  return { ...exports, sql };
}
test('new and legacy Claude threads use Astra; explicit Sol and Luna preferences are preserved', async () => {
  for (const preference of [null, 'fable', 'opus', 'sonnet', 'unknown']) {
    const r = routing('openai', preference);
    const result = await r.resolveChatModel({ threadId: 'test' });
    assert.equal(result.model, 'gpt-6-astra');
    assert.equal(result.label, 'astra');
  }
  const r = routing('openai', 'astra');
  assert.equal((await r.resolveChatModel({ threadId: 'test' })).model, 'gpt-6-astra');
  assert.equal((await r.resolveChatModel({ threadId: 'test', override: 'luna' })).model, 'gpt-6-luna');
  assert.equal((await r.resolveChatModel({})).model, 'gpt-6-astra');
  for (const [preference, model] of [['sol', 'gpt-6.1-sol'], ['luna', 'gpt-6-luna']]) {
    const selected = routing('openai', preference);
    assert.equal((await selected.resolveChatModel({ threadId: 'test' })).model, model);
    assert.equal((await r.resolveChatModel({ threadId: 'test', override: preference })).model, model);
  }
});
test('configured model overrides apply to their own preference slots and acknowledgments name the actual model', async () => {
  const r = routing('openai', null, { astra: 'gpt-6.1-sol', sol: 'gpt-custom-sol', luna: 'gpt-custom-luna' });
  assert.equal((await r.resolveChatModel({})).model, 'gpt-6.1-sol');
  assert.equal((await r.resolveChatModel({ override: 'astra' })).model, 'gpt-6.1-sol');
  assert.equal((await r.resolveChatModel({ override: 'sol' })).model, 'gpt-custom-sol');
  assert.equal((await r.resolveChatModel({ override: 'luna' })).model, 'gpt-custom-luna');
  assert.match(r.ackMessage('astra'), /Using Sol 6\.1/);
  assert.doesNotMatch(r.ackMessage('astra'), /Using Astra|old Claude choice/);
  assert.match(r.ackMessage('sol'), /Using gpt-custom-sol/);
});
test('Anthropic and Kimi provider routes keep their existing model choices', async () => {
  const anthropic = routing('anthropic');
  assert.equal((await anthropic.resolveChatModel({})).model, 'claude-opus-5-5');
  assert.equal((await anthropic.resolveChatModel({ override: 'fable' })).model, 'claude-fable-5');
  assert.equal((await anthropic.resolveChatModel({ override: 'sonnet' })).model, 'claude-sonnet-4-6');
  const kimi = routing('kimi');
  assert.equal((await kimi.resolveChatModel({})).model, 'kimi-k3');
  assert.equal((await kimi.resolveChatModel({ override: 'sonnet' })).model, 'kimi-k2.6');
});
test('slash command parsing, persistence and acknowledgements follow the selected provider', async () => {
  const r = routing('openai', null);
  const parsed = r.parseSlashCommand('  /SoL draft a reply');
  assert.equal(parsed.command, 'sol'); assert.equal(parsed.strippedContent, 'draft a reply');
  assert.equal(r.parseSlashCommand('/astra').wasJustCommand, true);
  assert.equal(r.parseSlashCommand('/solstice').command, null);
  await r.setThreadModel('test', 'luna');
  assert.deepEqual(Array.from(r.sql.at(-1)[1]), ['luna', 'test']);
  assert.match(r.ackMessage('fable'), /Using Astra/);
  assert.match(r.ackMessage('fable'), /old Claude choice maps to the upgraded chat default/);
  assert.match(r.ackMessage('astra'), /default chat model/);
  assert.match(r.ackMessage('sol'), /Using Sol 6\.1/);
  assert.match(r.ackMessage('luna'), /Using Luna/);
  assert.match(routing('kimi').ackMessage('fable'), /kimi-k3/);
  assert.equal((await routing('anthropic').resolveChatModel({})).model, 'claude-opus-5-5');
});
test('the upgraded chat request preserves the full application tool catalogue and gives Astra reasoning headroom', () => {
  const { chatQualitySettings } = evaluate(source('server/chat-quality-settings.ts'));
  const adapter = source('server/utils/openai-client.ts').replace(/^import .*;$/mg, '');
  const { buildOpenAIRequest } = evaluate(adapter);
  const { model } = routing('openai').selectChatModel();
  const tools = Array.from({ length: 150 }, (_, i) => ({ type: 'function', function: {
    name: `app_tool_${i}`, description: `Existing tool ${i}`,
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  } }));
  const request = buildOpenAIRequest({ model, ...chatQualitySettings(model), thinking: true,
    messages: [{ role: 'user', content: 'Review these notes and draft a complete reply.' }], tools });
  assert.equal(request.model, 'gpt-6-astra');
  assert.equal(request.reasoning.effort, 'high');
  assert.equal(request.max_output_tokens, 32768);
  assert.equal(request.tools[0].type, 'tool_search');
  assert.equal(request.tools[1].tools.length, tools.length);
  assert.deepEqual(Array.from(request.tools[1].tools, tool => tool.name), tools.map(tool => tool.function.name));
  for (const tool of request.tools[1].tools) assert.equal(tool.defer_loading, true);
  assert.equal(request.input[0].content[0].text, 'Review these notes and draft a complete reply.');
});
test('interactive quality caps follow the actual model family, including snapshots and overrides', () => {
  const { chatQualitySettings } = evaluate(source('server/chat-quality-settings.ts'));
  for (const model of ['gpt-6-astra', 'gpt-6-astra-2026-10-01']) {
    const settings = chatQualitySettings(model);
    assert.equal(settings.effort, 'high');
    assert.equal(settings.max_completion_tokens, 32768);
  }
  for (const model of ['gpt-6.1-sol', 'gpt-6-luna', 'claude-opus-5-5', 'kimi-k3', 'gpt-6-astral', 'custom-model']) {
    const settings = chatQualitySettings(model);
    assert.equal(settings.effort, 'medium');
    assert.equal(settings.max_completion_tokens, 16384);
  }
});
test('chat and shared helper dispatch directly to OpenAI without constructing Claude clients', async () => {
  for (const file of ['server/chatbgp.ts', 'server/utils/anthropic-client.ts']) {
    const calls=[];
    const code=find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === 'callClaude');
    const { callClaude }=evaluate(code,{ chatProvider:()=> 'openai', globalProvider:()=> 'openai',
      mapModelForOpenAI:()=> 'gpt-6.1-sol', CHATBGP_MODEL:'legacy', callerFeature:()=> 'chatbgp',
      callOpenAI:async p=>{calls.push(p);return {ok:true};} });
    const result=await callClaude({messages:[{role:'user',content:'synthetic'}],tools:[{name:'unchanged'}]});
    assert.equal(result.ok,true);assert.equal(calls.length,1);assert.equal(calls[0].model,'gpt-6.1-sol');
    assert.equal(calls[0].tools[0].name,'unchanged');
  }
});
test('streaming dispatch preserves Stop callback and delta delivery', async () => {
  const stop=()=>true;const calls=[];let text='';
  const code=find('server/chatbgp.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='callClaudeStreaming');
  const {callClaudeStreaming}=evaluate(code,{chatProvider:()=> 'openai', mapModelForOpenAI:()=> 'gpt-6.1-sol',
    CHATBGP_MODEL:'legacy',callerFeature:()=> 'chatbgp',callOpenAIStreaming:async(p,delta,cancel)=>{calls.push({p,cancel});delta('ok');return {ok:true};}});
  await callClaudeStreaming({messages:[]},d=>{text+=d;},stop);
  assert.equal(text,'ok');assert.equal(calls[0].cancel,stop);
});
