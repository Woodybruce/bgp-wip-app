import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrandRepresentation, updateBrandRepresentation } from '../../server/brand-representations.ts';

function fixture({ contactEmployer = null, old = {}, failInsert = false } = {}) {
  const companies = new Map([['brand',{id:'brand',company_type:'Tenant - Restaurant'}],['agency',{id:'agency',company_type:'Agent'}],['other-agency',{id:'other-agency',company_type:'Agent - Leasing'}]]);
  const contact = {id:'person',company_id:contactEmployer};
  const queries = [];
  const db = { release(){ queries.push({sql:'RELEASE'}); }, async query(sql, values = []) {
    queries.push({sql,values});
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return {rows:[]};
    if (sql.startsWith('SELECT id FROM crm_companies') || sql.startsWith('SELECT id,company_type FROM crm_companies')) return {rows:companies.has(values[0]) ? [companies.get(values[0])] : []};
    if (sql.startsWith('SELECT id,company_id FROM crm_contacts')) return {rows:values[0]==='person'?[contact]:[]};
    if (sql.startsWith('SELECT * FROM brand_agent_representations')) return {rows:[{id:'rep',brand_company_id:'brand',agent_company_id:'agency',primary_contact_id:'person',agent_type:'tenant_rep',...old}]};
    if (sql.startsWith('INSERT INTO brand_agent_representations')) {
      if (failInsert) throw new Error('Synthetic insert failure');
      return {rows:[{id:'rep',brand_company_id:values[0],agent_company_id:values[1],primary_contact_id:values[4]}]};
    }
    if (sql.startsWith('UPDATE brand_agent_representations')) return {rows:[{id:'rep'}]};
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  return {pool:{connect:async()=>db},queries,contact,companies};
}
const basic = {brandCompanyId:'brand',primaryContactId:'person',agentType:'tenant_rep'};

test('an unaffiliated agent is linked by name without creating or assigning an employer',async()=>{
  const f=fixture(); const result=await createBrandRepresentation(f.pool,basic);
  assert.equal(result.agent_company_id,null);assert.equal(result.primary_contact_id,'person');assert.equal(f.contact.company_id,null);assert.equal(f.companies.size,3);
  assert.ok(f.queries.some(q=>q.sql==='COMMIT'));
  assert.ok(f.queries.every(q=>!/(INSERT INTO crm_companies|UPDATE crm_contacts|UPDATE crm_companies)/.test(q.sql)));
});
test('a tenant-side recorded employer is not turned into an agency',async()=>{
  const f=fixture({contactEmployer:'brand'});const result=await createBrandRepresentation(f.pool,basic);
  assert.equal(result.agent_company_id,null);assert.equal(f.contact.company_id,'brand');
});
test('a valid agent employer may be reused without changing company classifications',async()=>{
  const f=fixture({contactEmployer:'agency'});const result=await createBrandRepresentation(f.pool,basic);
  assert.equal(result.agent_company_id,'agency');assert.equal(f.contact.company_id,'agency');
  assert.ok(f.queries.every(q=>!q.sql.startsWith('UPDATE crm_')));
});
test('explicit firm and named contact must agree with their recorded employer',async()=>{
  for(const contactEmployer of [null,'agency']) {
    const f=fixture({contactEmployer});await assert.rejects(createBrandRepresentation(f.pool,{...basic,agentCompanyId:'other-agency'}),/does not match/);
    assert.ok(f.queries.some(q=>q.sql==='ROLLBACK'));assert.ok(!f.queries.some(q=>q.sql.startsWith('INSERT')));
  }
});
test('reject missing parties, unknown contact and brand-as-agent without any inserts',async()=>{
  for(const input of [{brandCompanyId:'brand',agentType:'tenant_rep'},{...basic,primaryContactId:'missing'},{...basic,agentCompanyId:'brand'}]) {
    const f=fixture();await assert.rejects(createBrandRepresentation(f.pool,input));assert.ok(!f.queries.some(q=>q.sql.startsWith('INSERT')));
  }
});
test('a firm-only instruction is allowed and errors roll back without side effects',async()=>{
  const result=await createBrandRepresentation(fixture().pool,{brandCompanyId:'brand',agentCompanyId:'agency',agentType:'tenant_rep'});assert.equal(result.agent_company_id,'agency');assert.equal(result.primary_contact_id,null);
  const f=fixture({failInsert:true});await assert.rejects(createBrandRepresentation(f.pool,basic),/Synthetic insert failure/);assert.equal(f.queries.at(-2).sql,'ROLLBACK');assert.equal(f.queries.at(-1).sql,'RELEASE');
});
test('changing a named agent clears an unconfirmed firm rather than reusing the previous person’s firm',async()=>{
  const f=fixture();await updateBrandRepresentation(f.pool,'rep',{primaryContactId:'person'});
  const update=f.queries.find(q=>q.sql.startsWith('UPDATE brand_agent_representations'));assert.ok(update.sql.includes('agent_company_id='));assert.equal(update.values.at(-1),null);
});
test('removing the named person keeps a confirmed firm-only representation',async()=>{
  const f=fixture({contactEmployer:'agency'});await updateBrandRepresentation(f.pool,'rep',{primaryContactId:null});
  const update=f.queries.find(q=>q.sql.startsWith('UPDATE brand_agent_representations'));assert.equal(update.values.at(-1),'agency');
});
test('mismatched firm edits are rejected but a legacy bad representation can still be ended',async()=>{
  const f=fixture({contactEmployer:'agency'});await assert.rejects(updateBrandRepresentation(f.pool,'rep',{agentCompanyId:'other-agency'}),/does not match/);
  const legacy=fixture({contactEmployer:'brand',old:{agent_company_id:'brand'}});await updateBrandRepresentation(legacy.pool,'rep',{end_date:'2026-09-17'});
  assert.ok(legacy.queries.some(q=>q.sql.startsWith('UPDATE brand_agent_representations')));assert.ok(!legacy.queries.some(q=>q.sql.includes('FROM crm_contacts')));
});
