import test from 'node:test';
import assert from 'node:assert/strict';
import { selectChatHistory, trimChatHistory, documentExcerpt, documentTruncationNotice } from './utils/chat-history';
import { convertMessagesForOpenAI } from './utils/openai-client';
test('context trimming retains entire final tool batch and provider replay state without duplicate IDs', () => {
  const system={role:'system',content:'system'};
  const user={role:'user',content:'request'};
  const calls=Array.from({length:15},(_,i)=>({id:`c${i}`,type:'function',function:{name:'lookup',arguments:'{}'}}));
  const output=calls.map(c=>({type:'function_call',call_id:c.id,name:'lookup',arguments:'{}'}));
  const assistant={role:'assistant',tool_calls:calls,_openaiOutput:[{type:'reasoning',encrypted_content:'opaque'},...output]};
  const results=calls.map(c=>({role:'tool',tool_call_id:c.id,content:'result'}));
  const history=[system,user,{role:'assistant',content:'old'.repeat(20000)}, {role:'user',content:'next'},assistant,...results];
  const selection=trimChatHistory(history);
  const trimmed=selection.messages;
  assert.ok(trimmed.includes(assistant)); assert.ok(trimmed.includes(user));
  assert.ok(selection.omittedMessages > 0);
  assert.match(selection.notice, /incomplete/);
  const input=convertMessagesForOpenAI(trimmed).input;
  assert.equal(input.filter(item=>item.type==='function_call_output').length,15);
  assert.equal(input.filter(item=>item.type==='function_call').length,15);
  assert.equal(input.filter(item=>item.type==='reasoning').length,1);
});
test('short histories are kept once, not duplicated by overlapping prefix and tail',()=>{
  const history=[{role:'system',content:'s'},{role:'user',content:'u'},{role:'assistant',content:'a'},{role:'user',content:'u2'}];
  assert.deepEqual(trimChatHistory(history).messages,history);
});

test('a roughly 10,000-word working thread stays complete beyond 40 messages', () => {
  const history = Array.from({length:100}, (_, index) => ({
    role:index % 2 ? 'assistant' : 'user',
    content:`Turn ${index}: ` + 'padel '.repeat(100),
  }));
  const selection = selectChatHistory(history);
  assert.deepEqual(selection.messages, history);
  assert.equal(selection.omittedMessages, 0);
  assert.equal(selection.notice, '');
});

test('budgeted history keeps opening requirements and later corrections in chronological order', () => {
  const brief = {role:'user',content:'Write a complete padel investment email. Include a commercial table. Initially assume 40 courts.'};
  const correction = {role:'user',content:'The agreed figure is 24 courts. Keep the turnover lease proposal in the email.'};
  const latest = {role:'user',content:'Now produce the complete final draft.'};
  const history = [brief, {role:'assistant',content:'older working '.repeat(2000)},
    correction, {role:'assistant',content:'more working '.repeat(2000)}, latest];
  const frozen = JSON.stringify(history);
  const selection = selectChatHistory(history, {maxChars:2000});
  assert.deepEqual(selection.messages, [brief, correction, latest]);
  assert.equal(selection.messages.filter(message => message === latest).length, 1);
  assert.equal(JSON.stringify(history), frozen);
  assert.equal(selection.omittedMessages, 2);
  assert.ok(selection.estimatedCharacters <= 2000);
  assert.match(selection.notice, /latest user corrections/);
  assert.match(selection.notice, /not a complete transcript/);
});

test('context recovery drops an older completed exchange without breaking the current one', () => {
  const user = {role:'user',content:'Read the evidence and keep the revised pricing assumptions.'};
  const call = (id:string) => ({role:'assistant',tool_calls:[{id,type:'function',function:{name:'read_document',arguments:'{}'}}],
    _openaiOutput:[{type:'reasoning',encrypted_content:`opaque-${id}`},{type:'function_call',call_id:id,name:'read_document',arguments:'{}'}]});
  const oldCall=call('old'), currentCall=call('current');
  const history=[user,oldCall,{role:'tool',tool_call_id:'old',content:'old evidence '.repeat(5000)},
    currentCall,{role:'tool',tool_call_id:'current',content:'current evidence '.repeat(3000)}];
  const selection=trimChatHistory(history);
  assert.ok(!selection.messages.includes(oldCall));
  assert.ok(selection.messages.includes(currentCall));
  assert.equal(selection.messages[0],user);
  const input=convertMessagesForOpenAI(selection.messages).input;
  assert.equal(input.filter(item=>item.type==='function_call').length,1);
  assert.equal(input.filter(item=>item.type==='function_call_output').length,1);
  assert.equal(input.find(item=>item.type==='reasoning').encrypted_content,'opaque-current');
  assert.equal(selection.messages.find(message=>message===currentCall),currentCall);
});

test('Anthropic user-role tool results remain with their complete tool call', () => {
  const request={role:'user',content:'Research this property.'};
  const assistant={role:'assistant',content:[{type:'tool_use',id:'lookup-1',name:'lookup',input:{}}]};
  const result={role:'user',content:[{type:'tool_result',tool_use_id:'lookup-1',content:'evidence '.repeat(1000)}]};
  const history=[request,{role:'assistant',content:'old '.repeat(10000)},assistant,result];
  const selected=selectChatHistory(history,{maxChars:1000,recovery:true});
  assert.deepEqual(selected.messages,[request,assistant,result]);
  assert.equal(selected.overBudget,true); // Active exchange is indivisible.
  assert.doesNotThrow(()=>convertMessagesForOpenAI(selected.messages));
});

test('selection retains whole older turns where they fit, never dangling tool results', () => {
  const history:any[]=[];
  for(let index=0;index<12;index++) {
    history.push({role:'user',content:`Request ${index}`},
      {role:'assistant',tool_calls:[{id:`c${index}`,type:'function',function:{name:'lookup',arguments:'{}'}}]},
      {role:'tool',tool_call_id:`c${index}`,content:'result '.repeat(100)},
      {role:'assistant',content:`Answer ${index}`});
  }
  const selected=selectChatHistory(history,{maxChars:3500});
  assert.ok(selected.omittedMessages>0);
  assert.doesNotThrow(()=>convertMessagesForOpenAI(selected.messages));
  assert.equal(new Set(selected.messages).size,selected.messages.length);
  const positions=selected.messages.map(message=>history.indexOf(message));
  assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
});

test('document previews clearly mark omitted text and name the retrieval tool', () => {
  assert.equal(documentExcerpt('complete','file.txt',8),'complete');
  const excerpt=documentExcerpt('first part followed by omitted text','saved-file.txt',10);
  assert.ok(excerpt.startsWith('first part'));
  assert.match(excerpt,/Document excerpt only/);
  assert.match(excerpt,/read_document/);
  assert.match(excerpt,/saved-file\.txt/);
  assert.match(excerpt,/larger maxTextChars/);
  assert.match(excerpt,/includePageImages=true/);
  assert.match(documentTruncationNotice('file.pdf',40000),/first 40,000 characters/);
});
