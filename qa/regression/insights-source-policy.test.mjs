import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {INSIGHTS_SOURCE_POLICY_VERSION, isPublishableInsight, insightEvidenceForSources, prepareInsightNewsBatch, parseInsightEvidence} from '../../server/insights-source-policy.ts';
import {isPublicNewsSource, publicNewsSourceSql, singleFlight} from '../../server/news-ingestion.ts';
import {isPrivateEmailRecord, isPrivateMailboxAddress, PRIVATE_MAIL_POLICY_VERSION} from '../../server/private-mail.ts';
const require=createRequire(import.meta.url);
const {find,evaluate,ts}=require('./source-harness.cjs');
const fn=name=>find('server/insights-feed.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const quiet={log(){},warn(){}};
const article=id=>({type:'article',id,title:`Article ${id}`,url:`https://publisher.test/${id}`,policyVersion:INSIGHTS_SOURCE_POLICY_VERSION});
const report={type:'report-email',title:'Publisher bulletin',from:'editor@propelinfo.com',policyVersion:INSIGHTS_SOURCE_POLICY_VERSION,mailPrivacyPolicy:PRIVATE_MAIL_POLICY_VERSION};

test('news evidence belongs only to validated per-insight source IDs',()=>{
 const supplied=[article('a'),article('b'),article('c')];
 assert.deepEqual(insightEvidenceForSources(['c','a','c'],supplied),[supplied[2],supplied[0]]);
 for(const ids of [undefined,[],['missing'],['a','missing'],[1],Array(7).fill('a')])assert.equal(insightEvidenceForSources(ids,supplied),null);
});

test('historical unverified insights remain hidden while private fields always exclude a card',()=>{
 assert.equal(isPublishableInsight({source_kind:'news',evidence:[article('a')]}),true);
 assert.equal(isPublishableInsight({source_kind:'market-report',evidence:[report]}),true);
 assert.equal(isPublishableInsight({source_kind:'portfolio',evidence:[{type:'activity'}]}),true);
 assert.equal(isPublishableInsight({source_kind:'market-report',evidence:[{type:'report-email',from:'publisher@test.example'}]}),false);
 assert.equal(isPublishableInsight({source_kind:'news',evidence:[{...article('a'),policyVersion:undefined}]}),false);
 for(const field of ['mailbox','toRecipients','ccRecipients','bccRecipients']){
  const item={...report,[field]:[{emailAddress:{address:'equity@brucegillinghampollard.com'}}]};
  assert.equal(isPublishableInsight({source_kind:'market-report',evidence:[item]}),false);
 }
});

test('bounded prompt and citations use the same public articles without including a truncated tail',()=>{
 const rows=Array.from({length:60},(_,i)=>({id:String(i),title:'Long heading '.repeat(20),summary:'Long factual summary '.repeat(20),url:`https://publisher.test/${i}`,source_type:'rss',source_active:true,source_category:'general'}));
 rows[0].source_type='email'; rows[1].source_type='rssapp_instagram'; rows[2].source_category='brand:private';
 const batch=prepareInsightNewsBatch(rows,1500);
 assert.ok(batch.material.length<1500);assert.ok(batch.evidence.length>0);assert.ok(batch.evidence.length<10);
 assert.ok(batch.evidence.every(item=>Number(item.id)>2));
 for(const item of batch.evidence)assert.ok(batch.material.includes(`[article_id=${item.id}]`));
 assert.equal(batch.lastScanned.id,batch.evidence.at(-1).id);
 assert.ok(!batch.material.includes(`[article_id=${Number(batch.lastScanned.id)+1}]`));
});

test('distiller persists distinct sources for each insight and rejects unsupported citations before any theme write',async()=>{
 const writes=[];let prompt;
 const {distil}=evaluate(fn('distil')+'\nexport {distil};',{
  INSIGHT_CATEGORIES:['market'],INSIGHTS_SOURCE_POLICY_VERSION,insightEvidenceForSources,isPublishableInsight,
  activeThemes:async()=>[],
  getAnthropicClient:()=>({messages:{create:async args=>{prompt=args.messages[0].content;return{content:[{type:'text',text:JSON.stringify({insights:[
   {headline:'Second article development',theme_key:'second',source_ids:['b']},
   {headline:'First article development',theme_key:'first',source_ids:['a']},
   {headline:'Unsupported claim',theme_key:'missing',source_ids:['not-supplied']},
  ]})}]};}}}),
  pool:{query:async(sql,values)=>{writes.push({sql,values});return{rows:[{id:1}]};}},
 });
 assert.equal(await distil('2 articles','[article_id=a] A\n[article_id=b] B','news',[article('a'),article('b')]),2);
 const saved=writes.filter(call=>call.sql.includes('INSERT INTO insights'));
 assert.deepEqual(JSON.parse(saved[0].values[5]).map(item=>item.id),['b']);
 assert.deepEqual(JSON.parse(saved[1].values[5]).map(item=>item.id),['a']);
 assert.equal(writes.length,4);
 assert.match(prompt,/source_ids/);
 assert.ok(writes.filter(call=>call.sql.includes('INSERT INTO insight_themes')).every(call=>call.values[0].startsWith(`${INSIGHTS_SOURCE_POLICY_VERSION}:`)));
});

test('news cursor preserves microseconds and every capped timestamp tie without jumping to the clock',async()=>{
 const timestamp='2026-10-27 12:00:00.123456';let state={cursor_timestamp:timestamp,cursor_id:null};
 const rows=Array.from({length:64},(_,i)=>({id:String(i+1).padStart(3,'0'),cursor_timestamp:timestamp,title:`Short article ${i}`,summary:'Verified fact',url:`https://publisher.test/${i}`,source_type:'rss',source_active:true,source_category:'general'}));
 const consumed=[];const checkpoints=[];
 const {runNewsLeg}=evaluate(fn('runNewsLeg'),{
  runNewsSingleFlight:singleFlight(),ensureTables:async()=>{},prepareInsightNewsBatch,publicNewsSourceSql,console:quiet,
  distil:async(_label,_material,_kind,evidence)=>{consumed.push(...evidence.map(item=>item.id));if(consumed.length===60)rows.push({...rows[0],id:'065',cursor_timestamp:'2026-10-27 12:00:00.123457'});return 1;},
  pool:{query:async(sql,values)=>{
   if(sql.startsWith('SELECT cursor::text'))return{rows:[state]};
   if(sql.includes('FROM news_articles')){
    assert.match(sql,/JOIN news_sources/);assert.match(sql,/\(a\.fetched_at,a\.id\) > \(\$1::timestamp,\$2::varchar\)/);assert.ok(sql.includes(publicNewsSourceSql('s')));
    return{rows:rows.filter(row=>row.cursor_timestamp>values[0]||row.cursor_timestamp===values[0]&&row.id>values[1]).slice(0,60)};
   }
   assert.match(sql,/INSERT INTO insight_state/);state={cursor_timestamp:values[0],cursor_id:values[1]};checkpoints.push({...state});return{rows:[]};
  }},
 });
 assert.equal(await runNewsLeg(),1);assert.deepEqual(checkpoints[0],{cursor_timestamp:timestamp,cursor_id:'060'});
 assert.equal(await runNewsLeg(),1);assert.equal(consumed.length,65);assert.equal(new Set(consumed).size,65);
 assert.deepEqual(checkpoints[1],{cursor_timestamp:'2026-10-27 12:00:00.123457',cursor_id:'065'});
});

test('malformed or unsupported distillation stays retryable rather than being treated as an empty successful result',async()=>{
 for(const response of ['not json',JSON.stringify({insights:[{headline:'Unsupported',theme_key:'made-up',source_ids:['missing']} ]})]){
  const {distil}=evaluate(fn('distil')+'\nexport {distil};',{
   INSIGHT_CATEGORIES:['market'],INSIGHTS_SOURCE_POLICY_VERSION,insightEvidenceForSources,isPublishableInsight,
   activeThemes:async()=>[],getAnthropicClient:()=>({messages:{create:async()=>({content:[{type:'text',text:response}]})}}),
   pool:{query:()=>assert.fail('Invalid claims must not write a theme or insight')},
  });
  await assert.rejects(()=>distil('one article','[article_id=a] Source','news',[article('a')]),/remains pending/);
 }
});

test('published insight reads recheck current source metadata without reading article or mailbox content',async()=>{
 const current={source_kind:'news',evidence:[article('a')]};
 const blocked={source_kind:'news',evidence:[article('private-source')]};
 const portfolio={source_kind:'portfolio',evidence:[{type:'activity'}]};
 const {filterPublishedInsights}=evaluate(fn('filterPublishedInsights')+'\nexport {filterPublishedInsights};',{
  isPublishableInsight,parseInsightEvidence,isPublicNewsSource,
  pool:{query:async(sql,values)=>{assert.doesNotMatch(sql,/body|summary|content/);assert.deepEqual(Array.from(values[0]),['a','private-source']);return{rows:[{id:'a',type:'rss',active:true},{id:'private-source',type:'email',active:true}]};}},
 });
 const result=await filterPublishedInsights([current,blocked,portfolio,{source_kind:'news',evidence:[{type:'article',id:'old'}]}]);
 assert.deepEqual(result.map(row=>row.source_kind),['news','portfolio']);
});

test('report sweep never opens the private mailbox and screens copied recipients before distillation or extraction',async()=>{
 const paths=[],distilled=[],extracted=[];
 const safe={subject:'Safe publisher update',from:{emailAddress:{address:'editor@propelinfo.com'}},receivedDateTime:'2026-10-27T12:00:00Z',body:{content:'Safe public update'}};
 const privateCopies=['toRecipients','ccRecipients','bccRecipients'].map(field=>({...safe,subject:`Private ${field}`,body:{content:'Excluded private copy'},[field]:[{emailAddress:{address:'Equity@brucegillinghampollard.com'}}]}));
 const {runReportLeg}=evaluate(fn('runReportLeg'),{
  ensureTables:async()=>{},getCursor:async()=>new Date('2026-10-27T00:00:00Z'),setCursor:async()=>{},console:quiet,
  isPrivateEmailRecord,isPrivateMailboxAddress,PRIVATE_MAIL_POLICY_VERSION,INSIGHTS_SOURCE_POLICY_VERSION,
  matchReportSender:from=>from==='editor@propelinfo.com',
  pool:{query:async sql=>({rows:sql.includes('FROM users')?[{addr:'equity@brucegillinghampollard.com'},{addr:'staff@brucegillinghampollard.com'}]:[]})},
  distil:async(label,body,kind,evidence)=>{distilled.push({label,body,kind,evidence});return 1;},
  require(name){
   if(name==='./shared-mailbox')return{graphRequest:async path=>{paths.push(path);assert.doesNotMatch(decodeURIComponent(path),/equity@/i);assert.match(path,/toRecipients,ccRecipients,bccRecipients/);return{value:[safe,...privateCopies]};}};
   if(name==='./news-brand-linking')return{extractBrandSignalsFromNewsletter:async item=>{extracted.push(item);return 0;}};
   throw new Error(`Unexpected import ${name}`);
  },
 });
 assert.equal(await runReportLeg(),1);assert.equal(paths.length,2);assert.equal(distilled.length,1);assert.equal(extracted.length,1);
 assert.equal(distilled[0].body,'Safe public update');assert.equal(extracted[0].subject,'Safe publisher update');
 assert.ok(isPublishableInsight({source_kind:'market-report',evidence:distilled[0].evidence}));
});
