import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { evaluate, find, ts } = require('./source-harness.cjs');
const declaration = name => find('server/contact-verify.ts', node =>
  (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name);
const { contactVerificationSnapshotMatches: matches } = evaluate(declaration('contactVerificationSnapshotMatches'));

test('verification snapshot rejects a different company even when company names are identical',()=>{
  assert.equal(matches({current_company_name:'Agency',evidence:{companyIdAtVerification:'one'}},
    {company_id:'two',company_name:'Agency'}),false);
});
test('verification snapshot treats explicit null employer as a real historical state',()=>{
  const finding={current_company_name:null,evidence:{companyIdAtVerification:null}};
  assert.equal(matches(finding,{company_id:null,company_name:null}),true);
  assert.equal(matches(finding,{company_id:'assigned',company_name:null}),false);
});
test('legacy findings compare the recorded company name without inventing an employer ID',()=>{
  assert.equal(matches({current_company_name:' Agency ',evidence:{}},{company_id:'one',company_name:'AGENCY'}),true);
  assert.equal(matches({current_company_name:'Agency',evidence:null},{company_id:'one',company_name:'New agency'}),false);
});

function routes({client=false,resolver=async()=>({ok:true,linkedCompany:'Agency'})}={}) {
  const handlers=new Map();const calls=[];const authentication=()=>{};
  const app=Object.fromEntries(['get','post'].map(method=>[method,(path,...stack)=>handlers.set(`${method} ${path}`,stack)]));
  const exported=evaluate(`${declaration('ContactVerificationError')}\n${declaration('setupContactVerifyRoutes')}`,{
    require:name=>{assert.equal(name,'./company-scope');return {isClientRequestUser:async()=>client};},
    requireAuth:authentication,
    resolveContactVerification:async(...args)=>{calls.push(['resolve',...args]);return resolver(...args);},
    verifyContact:async(...args)=>{calls.push(['verify',...args]);return {};},
    loadPendingContactVerifications:async()=>{calls.push(['pending']);return [];},
    sweepContactVerifications:async(...args)=>{calls.push(['sweep',...args]);return {};},
    pool:{query:async()=>{calls.push(['query']);return {rows:[]};}},
  });
  exported.setupContactVerifyRoutes(app);
  const invoke=async(key,req={})=>{
    const response={statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await handlers.get(key).at(-1)({params:{id:'17'},query:{},...req},response);
    return response;
  };
  return {handlers,calls,authentication,invoke,...exported};
}

test('every contact-verification endpoint remains authenticated and staff-only',async()=>{
  const fixture=routes({client:true});
  assert.equal(fixture.handlers.size,5);
  for(const [key,stack] of fixture.handlers){
    assert.equal(stack[0],fixture.authentication);
    const response=await fixture.invoke(key,{body:{companyId:'agency'},session:{userId:'client'}});
    assert.equal(response.statusCode,403,key);
  }
  assert.deepEqual(fixture.calls,[],'No verification, query or mutation should occur for a client');
});
test('staff Apply forwards the explicit employer and authenticated reviewer to the transactional resolver',async()=>{
  const fixture=routes();
  const response=await fixture.invoke('post /api/crm/data-health/:id/apply',{body:{companyId:'agency'},session:{userId:'staff'}});
  assert.deepEqual(fixture.calls,[['resolve','17','apply','staff','agency']]);
  assert.equal(response.body.linkedCompany,'Agency');
});
test('legacy Apply without a selected employer delegates guarded exact matching instead of accepting notes-only success',async()=>{
  let fixture;
  fixture=routes({resolver:async()=>{throw new fixture.ContactVerificationError(409,'EMPLOYER_SELECTION_REQUIRED','Choose an employer.');}});
  const response=await fixture.invoke('post /api/crm/data-health/:id/apply',{tokenUserId:'token-staff'});
  assert.deepEqual(fixture.calls,[['resolve','17','apply','token-staff',undefined]]);
  assert.equal(response.statusCode,409);
  assert.equal(response.body.code,'EMPLOYER_SELECTION_REQUIRED');
  assert.equal(response.body.error,'Choose an employer.');
});
test('stale Dismiss returns a conflict without reporting a successful review',async()=>{
  let fixture;
  fixture=routes({resolver:async()=>{throw new fixture.ContactVerificationError(409,'FINDING_OUTDATED','Refresh the review queue.');}});
  const response=await fixture.invoke('post /api/crm/data-health/:id/dismiss',{session:{userId:'staff'}});
  assert.equal(response.statusCode,409);
  assert.equal(response.body.code,'FINDING_OUTDATED');
  assert.equal(response.body.ok,undefined);
});
