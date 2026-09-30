import test from 'node:test';
import assert from 'node:assert/strict';
import { trimChatHistory } from './utils/chat-history';
import { convertMessagesForOpenAI } from './utils/openai-client';
test('context trimming retains entire final tool batch and provider replay state without duplicate IDs', () => {
  const system={role:'system',content:'system'};
  const user={role:'user',content:'request'};
  const calls=Array.from({length:15},(_,i)=>({id:`c${i}`,type:'function',function:{name:'lookup',arguments:'{}'}}));
  const output=calls.map(c=>({type:'function_call',call_id:c.id,name:'lookup',arguments:'{}'}));
  const assistant={role:'assistant',tool_calls:calls,_openaiOutput:[{type:'reasoning',encrypted_content:'opaque'},...output]};
  const results=calls.map(c=>({role:'tool',tool_call_id:c.id,content:'result'}));
  const history=[system,user,{role:'assistant',content:'old'}, {role:'user',content:'next'},assistant,...results];
  const trimmed=trimChatHistory(history);
  assert.equal(trimmed[2],assistant); assert.equal(trimmed.length,18);
  const input=convertMessagesForOpenAI(trimmed).input;
  assert.equal(input.filter(item=>item.type==='function_call_output').length,15);
  assert.equal(input.filter(item=>item.type==='function_call').length,15);
  assert.equal(input.filter(item=>item.type==='reasoning').length,1);
});
test('short histories are kept once, not duplicated by overlapping prefix and tail',()=>{
  const history=[{role:'system',content:'s'},{role:'user',content:'u'},{role:'assistant',content:'a'},{role:'user',content:'u2'}];
  assert.deepEqual(trimChatHistory(history),history);
});
