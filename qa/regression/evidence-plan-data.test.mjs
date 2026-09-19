import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {source,find,evaluate,ts}=require('./source-harness.cjs');
const declaration=name=>find('server/evidence-plan.ts',node=>
  ((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name?.text===name)
  || ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText()===name));
const code=source('shared/plan-geometry.ts')+'\n'+['normaliseUnitRef','normTenantName','stripCoName','EvidencePlanError',
  'ENTRY_FIELDS','validateEvidenceUnitPatch','validateEvidenceEntryPatch','matchEvidenceScheduleRow','presentEvidenceUnit'].map(declaration).join('\n');
const {matchEvidenceScheduleRow:match,presentEvidenceUnit:present,validateEvidenceUnitPatch:unitPatch,validateEvidenceEntryPatch:entryPatch}=evaluate(code,evaluate(source('server/evidence-plan-schedule.ts')));
const schedule=(id,ref,tenant='Tea Shop',fields={})=>({id,unit_number:ref,trading_name:tenant,tenant_name:tenant,...fields});
const rectangle=[{x:.1,y:.1},{x:.4,y:.1},{x:.4,y:.4},{x:.1,y:.4}];
test('duplicate schedule refs never select an arbitrary first tenant',()=>{
  assert.equal(match({unit_ref:'A01'},[schedule('one','Unit A1'),schedule('two','A1','Different tenant')]).row,null);
});
test('contradictory explicit unit ref cannot fall back to another shop of the same tenant',()=>{
  assert.equal(match({unit_ref:'A9',tenant_name:'Tea Shop'},[schedule('one','A1')]).row,null);
});
test('review placeholders stay editable without inheriting a guessed lease through the tenant name',()=>{
  const unit={unit_ref:'Unlabelled 6510-4720',tenant_name:'Tea Shop',notes:'Check the printed unit number',passing_rent:12000};
  const result=present(unit,[schedule('one','A1','Tea Shop',{passing_rent_pa:90000})]);
  assert.equal(result.ts_linked,false);assert.equal(result.passing_rent,12000);assert.equal(result.notes,unit.notes);
  assert.equal(unitPatch({unitRef:'A1',notes:'Confirmed on the drawing'}).unitRef,'A1');
});
test('name-only match accepts one actual shop while excluding its ancillary storage',()=>{
  const result=match({unit_ref:'Tea Shop'},[schedule('shop','A1'),schedule('storage','Storage 4','Tea Shop',{permitted_use:'Storage'})]);
  assert.equal(result.row.id,'shop');assert.equal(result.method,'tenant');
});
test('name matches remain ambiguous across two shop demises and do not guess partial brands',()=>{
  assert.equal(match({unit_ref:'Tea Shop'},[schedule('one','A1'),schedule('two','A2')]).row,null);
  assert.equal(match({unit_ref:'Tea'},[schedule('one','A1')]).row,null);
});
test('live schedule overlay preserves saved label and marker while exposing the canonical row',()=>{
  const unit={id:'outline',unit_ref:'Tea Shop',tenant_name:'Tea Shop',source:'manual',dot:{x:.2,y:.2},notes:'Keep me',erv:'100',lease_expiry:'2030-01-01'};
  const result=present(unit,[schedule('row','A1','Tea Shop',{erv_pa:null,lease_expiry:null})]);
  assert.equal(result.unit_ref,'Tea Shop');assert.equal(result.ts_row_id,'row');assert.equal(result.ts_unit_ref,'A1');
  assert.equal(result.notes,'Keep me');assert.equal(result.dot,unit.dot);assert.equal(result.source,'manual');
  assert.equal(result.erv,null);assert.equal(result.lease_expiry,null);
});
test('unmatched units retain manually edited facts',()=>{
  const result=present({unit_ref:'A8',erv:'125',sqft:'500',tenant_name:'Known tenant'},[schedule('one','A1')]);
  assert.equal(result.ts_linked,false);assert.equal(result.erv,'125');assert.equal(result.sqft,'500');
});
test('unit validation accepts real zero and explicit date/rent clears',()=>{
  const result=unitPatch({unitRef:' A1 ',erv:0,passingRent:'',leaseExpiry:'',breakDate:'2028-02-29',polygon:rectangle});
  assert.equal(result.unitRef,'A1');assert.equal(result.erv,0);assert.equal(result.passingRent,null);assert.equal(result.leaseExpiry,null);
});
test('unit validation rejects invalid dates, empty refs, malformed and crossing geometry',()=>{
  for(const patch of [{unitRef:''},{leaseExpiry:'2027-02-29'},{erv:-1},{erv:'Infinity'},{dot:{x:2,y:.3}},
    {polygon:[{x:.1,y:.1},{x:.4,y:.4},{x:.1,y:.4},{x:.4,y:.1}]},{polygon:[]},{levelId:'not-a-level'}]){
    assert.throws(()=>unitPatch(patch),error=>error.status===400);
  }
});
test('evidence validation retains zero and clears while rejecting invalid associations and amounts',()=>{
  assert.equal(entryPatch({zoneA:'0',transactionDate:'',notes:'Note'}).zoneA,0);
  assert.equal(entryPatch({zoneA:'0',transactionDate:''}).transactionDate,null);
  for(const patch of [{zoneA:-5},{transactionDate:'bad'},{unitId:'wrong'},{tenant:{name:'bad'}},{}]){
    assert.throws(()=>entryPatch(patch),error=>error.status===400);
  }
});
test('source-file route bypasses the dynamic plan UUID lookup',async()=>{
  const route=find('server/evidence-plan.ts',node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
    &&node.expression.expression.getText()==='router'&&node.expression.name.text==='get'
    &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/evidence-plans/:id');
  let handler;let next=0;
  evaluate(route+';',{router:{get:(_path,_auth,fn)=>{handler=fn;}},requireAuth:()=>{},
    planOr404:()=>{throw new Error('Source must never be looked up as a plan UUID');}});
  await handler({params:{id:'source'}},{},()=>{next++;});assert.equal(next,1);
});
