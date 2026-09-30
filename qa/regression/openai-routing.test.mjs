import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const routerFile = 'server/chatbgp-model-router.ts';
function routing(provider, savedPreference) {
  const sql = [];
  const code = source(routerFile).replace(/^import .*;$/mg, '');
  const exports = evaluate(code, {
    chatProvider: () => provider, mapModelForKimi: m => m.includes('sonnet') ? 'kimi-k2.6' : 'kimi-k3',
    openaiChatModel: () => 'gpt-6.1-sol', openaiHelperModel: () => 'gpt-6-luna', openaiAdvancedModel: () => 'gpt-6-astra',
    pool: { query: async (q, args) => { sql.push([q,args]); return { rows: [{ model_preference: savedPreference }] }; } }
  });
  return { ...exports, sql };
}
test('saved Claude choices all become Sol, Astra only through an explicit saved/override choice', async () => {
  for (const preference of [null, 'fable', 'opus', 'sonnet', 'unknown']) {
    const r = routing('openai', preference);
    assert.equal((await r.resolveChatModel({ threadId: 'test' })).model, 'gpt-6.1-sol');
  }
  const r = routing('openai', 'astra');
  assert.equal((await r.resolveChatModel({ threadId: 'test' })).model, 'gpt-6-astra');
  assert.equal((await r.resolveChatModel({ threadId: 'test', override: 'luna' })).model, 'gpt-6-luna');
  assert.equal((await r.resolveChatModel({})).model, 'gpt-6.1-sol');
});
test('slash command parsing, persistence and acknowledgements follow the selected provider', async () => {
  const r = routing('openai', null);
  const parsed = r.parseSlashCommand('  /SoL draft a reply');
  assert.equal(parsed.command, 'sol'); assert.equal(parsed.strippedContent, 'draft a reply');
  assert.equal(r.parseSlashCommand('/astra').wasJustCommand, true);
  assert.equal(r.parseSlashCommand('/solstice').command, null);
  await r.setThreadModel('test', 'luna');
  assert.deepEqual(Array.from(r.sql.at(-1)[1]), ['luna', 'test']);
  assert.match(r.ackMessage('fable'), /Using Sol/);
  assert.match(r.ackMessage('fable'), /old Claude choice maps to Sol/);
  assert.match(r.ackMessage('astra'), /more expensive/);
  assert.match(routing('kimi').ackMessage('fable'), /kimi-k3/);
  assert.equal((await routing('anthropic').resolveChatModel({})).model, 'claude-opus-5-5');
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
