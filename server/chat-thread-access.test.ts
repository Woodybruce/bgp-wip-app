import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccessibleChatThread } from './utils/chat-thread-access';

test('thread owner retains the exact binding used for saved model preferences', async () => {
  let memberLookups=0;
  const access=await resolveAccessibleChatThread('astra-thread','owner',{
    getThread:async id=>{assert.equal(id,'astra-thread');return {createdBy:'owner'};},
    isMember:async()=>{memberLookups++;return false;},
  });
  assert.deepEqual(access,{allowed:true,threadId:'astra-thread'});
  assert.equal(memberLookups,0);
});

test('shared member can use the existing thread and its selected model', async () => {
  const access=await resolveAccessibleChatThread('shared-astra-thread','member',{
    getThread:async()=>({createdBy:'owner'}),
    isMember:async(threadId,userId)=>threadId==='shared-astra-thread'&&userId==='member',
  });
  assert.deepEqual(access,{allowed:true,threadId:'shared-astra-thread'});
});

test('foreign, absent and unavailable threads never yield an ID for model/context access', async () => {
  for(const getThread of [async()=>({createdBy:'another-user'}),async()=>undefined,async()=>{throw new Error('database unavailable');}]) {
    const access=await resolveAccessibleChatThread('foreign-thread','viewer',{getThread,isMember:async()=>false});
    assert.deepEqual(access,{allowed:false,threadId:null});
  }
  const failedMembership=await resolveAccessibleChatThread('shared-thread','viewer',{
    getThread:async()=>({createdBy:'owner'}),isMember:async()=>{throw new Error('lookup failed');},
  });
  assert.deepEqual(failedMembership,{allowed:false,threadId:null});
});

test('ephemeral chats need no thread lookup, malformed bindings fail closed', async () => {
  const dependencies={getThread:async()=>{throw new Error('must not read');},isMember:async()=>{throw new Error('must not read');}};
  assert.deepEqual(await resolveAccessibleChatThread(undefined,'viewer',dependencies),{allowed:true,threadId:null});
  for(const threadId of [{id:'thread'},['thread'],'   ']) {
    assert.deepEqual(await resolveAccessibleChatThread(threadId,'viewer',dependencies),{allowed:false,threadId:null});
  }
  assert.deepEqual(await resolveAccessibleChatThread('thread',undefined,dependencies),{allowed:false,threadId:null});
});
