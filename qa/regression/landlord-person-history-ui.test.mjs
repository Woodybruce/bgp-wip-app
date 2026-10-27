import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { landlordActivityPersonQuery } from '../../shared/landlord-activity-person.ts';
const require=createRequire(import.meta.url);
const {source,evaluate,ts}=require('./source-harness.cjs');
function ui(file) {
 const ast=ts.createSourceFile(file,source(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const script=ast.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(ast)).join('\n');
 const tags={};function visit(node){if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&ts.isIdentifier(node.tagName))tags[node.tagName.text]=node.tagName.text;ts.forEachChild(node,visit);}visit(ast);
 const queries=[],mutations=[],requests=[];
 const compiled=ts.transpileModule(script,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const app=evaluate(compiled,{require,...tags,landlordActivityPersonQuery,
  useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect(){},useQueryClient:()=>({invalidateQueries(){}}),queryClient:{setQueryData(){}},
  useQuery:options=>{queries.push(options);return {data:undefined,isLoading:false,isError:false};},
  useMutation:options=>{mutations.push(options);return {isPending:false,isError:false};},
  getAuthHeaders:()=>({}),fetch:async(url,options)=>{requests.push({url,...options});return {ok:true,json:async()=>({})};},
  apiRequest:async(method,url)=>{requests.push({method,url});return {json:async()=>({})};},
 });
 return {...app,queries,mutations,requests};
}

test('person email history and summary use the same scope and cache identity; Brands ignore that option',async()=>{
 for(const landlord of [true,false]) {
  const app=ui('client/src/components/brand-email-history.tsx');
  app.BrandEmailHistory({companyId:'aew',companyName:'AEW',landlord,person:{contactId:'saved-contact',name:'Manish'},open:true,onOpenChange(){}});
  const scope=landlord?'?personContactId=saved-contact':'';
  assert.deepEqual(Array.from(app.queries[0].queryKey),['/api/brand','aew','email-threads',...(scope?[scope]:[])]);
  assert.equal(app.queries[0].refetchInterval,landlord?false:undefined);
  await app.queries[0].queryFn();await app.mutations[0].mutationFn();
  assert.deepEqual(app.requests.map(r=>r.url),[`/api/brand/aew/email-threads${scope}`,`/api/brand/aew/email-threads/summary${scope}`]);
 }
});

test('Landlord email card disables inherited polling while preserving manual refresh',()=>{
 const app=ui('client/src/components/landlord-email-summary.tsx');
 app.LandlordEmailSummary({companyId:'landsec',companyName:'Landsec'});
 assert.equal(app.queries[0].refetchInterval,false);
 assert.equal(app.queries[0].staleTime,5*60_000);
 assert.equal(typeof app.queries[0].queryFn,'function');
});

test('person meeting history and summary both use staff identity, and closed popouts do not load',async()=>{
 for(const open of [true,false]) {
  const app=ui('client/src/components/landlord-meetings-summary.tsx');
  app.LandlordMeetingsSummary({companyId:'aew',companyName:'AEW',person:{userId:'nick-id',name:'Nick'},open,onOpenChange(){},historyOnly:true});
  assert.equal(app.queries[0].enabled,open);assert.ok(app.queries[0].queryKey.includes('?personUserId=nick-id'));
  assert.ok(app.queries[1].queryKey.includes('?personUserId=nick-id'));
  await app.queries[0].queryFn({signal:undefined});await app.queries[1].queryFn();
  assert.deepEqual(app.requests.map(r=>r.url),['/api/crm/landlords/aew/meetings?personUserId=nick-id','/api/crm/landlords/aew/meetings/summary?personUserId=nick-id']);
 }
});
