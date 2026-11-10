import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {find,evaluate,ts}=require('./source-harness.cjs');
const file='server/brand-email-threads.ts';
const decl=name=>find(file,node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const bindings={PRIVATE_MAIL_POLICY_VERSION:'private-v1',LANDLORD_EMAIL_SUMMARY_VERSION:'summary-v2'};
const {createLandlordEmailLoadCache,landlordEmailLoadCacheKey}=evaluate(
  ['createLandlordEmailLoadCache','landlordEmailLoadCacheKey'].map(decl).join('\n'),bindings);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('Landlord GET loads coalesce and expire, and failed loads remain retryable',async()=>{
 let now=1000,calls=0;
 const cache=createLandlordEmailLoadCache(20,2,()=>now),pending=deferred();
 const load=()=>{calls++;return pending.promise;};
 const first=cache.read('account','landsec',load),second=cache.read('account','landsec',load);
 await Promise.resolve();assert.equal(calls,1);
 pending.resolve({conversations:['recorded terms']});
 assert.deepEqual(await first,await second);
 assert.deepEqual(await cache.read('account','landsec',()=>{throw Error('should be cached');}),{conversations:['recorded terms']});
 now+=21;
 await assert.rejects(cache.read('account','landsec',async()=>{calls++;throw Error('timeout');}),/timeout/);
 assert.equal(await cache.read('account','landsec',async()=>{calls++;return 'retried';}),'retried');
 assert.equal(calls,3);
});

test('Landlord cache keys separate company, person and privacy/summary policies',()=>{
 const company=landlordEmailLoadCacheKey('landsec',null);
 const person={key:'contact:one',email:'one@landsec.test',contactId:'one'};
 assert.notEqual(company,landlordEmailLoadCacheKey('landsec',person));
 assert.notEqual(company,landlordEmailLoadCacheKey('aew',null));
 assert.notEqual(landlordEmailLoadCacheKey('landsec',person),landlordEmailLoadCacheKey('landsec',{...person,email:'changed@landsec.test'}));
 assert.notEqual(landlordEmailLoadCacheKey('landsec',person),landlordEmailLoadCacheKey('landsec',{...person,contactId:'different'}));
 assert.match(company,/private-v1/);assert.match(company,/summary-v2/);
});

test('Landlord writes invalidate all company/person variants and prevent an old in-flight load repopulating cache',async()=>{
 const cache=createLandlordEmailLoadCache(),pending=deferred();
 await cache.read('company','landsec',async()=> 'old company');
 await cache.read('person','landsec',async()=> 'old person');
 await cache.read('unrelated','aew',async()=> 'other company');
 const old=cache.read('pending','landsec',()=>pending.promise);
 await Promise.resolve();cache.invalidate('landsec');
 pending.resolve('old in-flight');await old;
 for(const key of ['company','person','pending']) assert.equal(await cache.read(key,'landsec',async()=> 'fresh'),'fresh');
 assert.equal(await cache.read('unrelated','aew',async()=>{throw Error('unrelated cache should remain');}),'other company');
});

test('cache bounds entries and the GET wrapper leaves Brands uncached',async()=>{
 const cache=createLandlordEmailLoadCache(20_000,2);
 await cache.read('a','a',async()=> 'a');await cache.read('b','b',async()=> 'b');await cache.read('c','c',async()=> 'c');
 assert.equal(await cache.read('a','a',async()=> 'a reloaded'),'a reloaded');
 let reads=0,loads=0;
 const wrapper=evaluate(decl('loadConversationsForGet')+'\nexports.load=loadConversationsForGet;',{
  brandFor:async id=>id==='missing'?null:{id,is_landlord:id==='landsec'},
  loadConversations:async(id,person,company)=>{loads++;return {company,person};},
  landlordEmailLoadCacheKey,landlordEmailLoads:{read:async(key,id,load)=>{reads++;return load();}},
 });
 assert.equal(await wrapper.load('missing',null),null);
 await wrapper.load('brand',null);await wrapper.load('brand',null);
 assert.equal(reads,0);assert.equal(loads,2);
 await wrapper.load('landsec',null);assert.equal(reads,1);assert.equal(loads,3);
});
