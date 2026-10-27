import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {landlordContactSuggestionKeys, isDismissedLandlordContact, showLandlordEmployerBadge} from '../../shared/landlord-contact-suggestions.ts';
const require=createRequire(import.meta.url);
const {source,find,evaluate,ts}=require('./source-harness.cjs');
const candidate={name:'Jane  Smith',email:'Jane.Smith@AEW.COM',linkedin:'https://www.linkedin.com/in/jane-smith/?trk=search',title:'Asset Manager',phone:'020 1234 5678',ai:{confidence:93,reason:'RocketReach match'},sources:['rocketreach']};
const elements=node=>Array.isArray(node)?node.flatMap(elements):React.isValidElement(node)?[node,...elements(node.props.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(' '):React.isValidElement(node)?text(node.props.children):node==null?'':String(node);

test('stable contact dismissal survives provider formatting, enriched identities and inbox suggestions without matching property keys',()=>{
 const keys=landlordContactSuggestionKeys(candidate),dismissed=new Set(keys);
 assert.deepEqual(keys,['contact:email:jane.smith@aew.com','contact:linkedin:/in/jane-smith','contact:name:jane smith']);
 assert.equal(isDismissedLandlordContact({email:' jane.smith@aew.com '},dismissed),true);
 assert.equal(isDismissedLandlordContact({name:'JANE SMITH',email:'updated@aew.com'},dismissed),true);
 assert.equal(isDismissedLandlordContact({linkedin_url:'https://uk.linkedin.com/in/JANE-SMITH'},dismissed),true);
 assert.equal(isDismissedLandlordContact({name:'Jane Smith'},new Set(['scraped:jane smith'])),false);
 assert.equal(isDismissedLandlordContact({name:'John Smith'},dismissed),false);
 assert.deepEqual(landlordContactSuggestionKeys({email:'invalid',linkedin:'https://linkedin.com.evil.test/in/jane'}),[]);
});

test('same-account employer badges disappear but actual different employers remain',()=>{
 assert.equal(showLandlordEmployerBadge({employerName:' AEW '},'aew','aew'),false);
 assert.equal(showLandlordEmployerBadge({employerName:'AEW Europe',employerCompanyId:'aew'},'aew','AEW'),false);
 assert.equal(showLandlordEmployerBadge({employerName:'Savills',employerCompanyId:'savills'},'aew','AEW'),true);
});

function routeHarness({allowed=true,landlord=true}={}) {
 let handler;const writes=[],rows=new Set();
 const persistence=evaluate(find('server/landlord-scraper.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='dismissDiscovery'),{
  ensureTable:async()=>{},pool:{query:async(sql,args)=>{assert.match(sql,/ON CONFLICT \(company_id, discovery_key\) DO NOTHING/);writes.push(sql);rows.add(args.join('|'));return{rows:[]};}},
 });
 const route=find('server/contacts-discovery.ts',n=>ts.isCallExpression(n)&&n.expression.getText()==='router.post'&&n.arguments[0]?.text==='/api/landlord/:companyId/dismiss-contact-suggestion');
 evaluate(route,{requireAuth(){},landlordContactSuggestionKeys,LANDLORD_CATALOGUE_PREDICATE:'is_landlord',router:{post:(_path,...chain)=>handler=chain.at(-1)},
  pool:{query:async(sql)=>{assert.match(sql,/SELECT c.id FROM crm_companies/);return{rows:landlord?[{id:'aew'}]:[]};}},
  require:module=>module==='./landlord-meetings'?{canReadLandlordMeetings:async()=>allowed}:module==='./landlord-scraper'?persistence:assert.fail(module),
 });
 return {writes,rows,async post(body=candidate){let status=200,data;await handler({params:{companyId:'aew'},body},{status(code){status=code;return this;},json(out){data=out;return this;}});return{status,data};}};
}

test('dismiss route persists only namespaced suggestion identities, is idempotent and never deletes a CRM contact',async()=>{
 const h=routeHarness();assert.equal((await h.post()).status,200);assert.equal((await h.post()).status,200);
 assert.equal(h.rows.size,3);assert.equal(h.writes.length,6);
 assert.ok(h.writes.every(sql=>/INSERT INTO landlord_dismissed_discoveries/.test(sql)&&!/(UPDATE|DELETE FROM|crm_contacts)/.test(sql)));
 const reloaded=new Set([...h.rows].map(value=>value.slice('aew|'.length)));
 assert.equal(isDismissedLandlordContact({email:candidate.email},reloaded),true);
});

test('clients, non-Landlords and empty identities cannot save dismissals',async()=>{
 const client=routeHarness({allowed:false});assert.equal((await client.post()).status,403);assert.equal(client.writes.length,0);
 const brand=routeHarness({landlord:false});assert.equal((await brand.post()).status,404);assert.equal(brand.writes.length,0);
 const invalid=routeHarness();assert.equal((await invalid.post({id:'saved-contact',key:'scraped:property'})).status,400);assert.equal(invalid.writes.length,0);
});

function renderComponent(name,props,{dismissed=[],history=null,viewer={role:'Admin'}}={}) {
 const file='client/src/components/company-contacts-board.tsx',ast=ts.createSourceFile(file,source(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name),tags={};
 function visit(node){if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&ts.isIdentifier(node.tagName))tags[node.tagName.text]=node.tagName.text;ts.forEachChild(node,visit);}visit(declaration);
 const mutations=[],requests=[],invalidations=[],cache=[],stateChanges=[];let stateIndex=0;
 const queryClient={invalidateQueries:args=>invalidations.push(args),setQueryData:(key,update)=>cache.push({key,value:update({contacts:[candidate]})})};
 const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports=evaluate(code,{require,...tags,useQueryClient:()=>queryClient,useToast:()=>({toast(){}}),useState:value=>{const index=stateIndex++;return[name==='KeyContactRow'&&index===2?history:value,next=>stateChanges.push({index,next})];},useEffect(){},
  useQuery:options=>options.queryKey[0]==='/api/auth/me'?{data:viewer}:{data:{contacts:[candidate],dismissedContactKeys:dismissed,summary:{revealed:5}},isFetching:false,refetch(){}},
  useMutation:options=>{mutations.push(options);return{isPending:false,mutate:input=>options.mutationFn(input)};},
  apiRequest:async(method,url,body)=>{requests.push({method,url,body});return{json:async()=>({dismissedKeys:landlordContactSuggestionKeys(body)})};},
  isDismissedLandlordContact,showLandlordEmployerBadge,useContactsCheck:()=>({check:null}),isKeyContactRole:()=>true,isMachineMailbox:()=>false,
  nameKey:value=>String(value).toLowerCase(),keyContactHiddenReason:()=>null,compareKeyContacts:()=>0,isEmailPlaceholderName:()=>false,
  formatRelativeShort:()=>'',contactDisplayName:value=>value,KEY_CONTACTS_SHOWN:6,HIDDEN_ORDER:{},AI_FLAG_LABELS:{},pillMetrics:'',pillInactive:'',
 });
 return{tree:exports[name](props),mutations,requests,invalidations,cache,stateChanges};
}

test('Landlord CRM rows hide repeated employer and numeric AI badges while Brands retain them',()=>{
 const contact={id:'saved',name:'Jane Smith',role:'Asset Manager',employerName:'AEW',employerCompanyId:'aew',email:candidate.email,phone:candidate.phone,linkedin_url:candidate.linkedin};
 for(const isLandlord of [true,false]) {
  const out=renderComponent('KeyContactRow',{contact,companyId:'aew',companyName:'AEW',isLandlord,discovery:candidate});
  const content=text(out.tree);assert.equal(/AI\s+93/.test(content),!isLandlord);assert.equal(/AEW/.test(content),!isLandlord);
  const links=elements(out.tree).filter(node=>node.type==='a');assert.ok(links.some(node=>node.props.href.startsWith('mailto:')));assert.ok(links.some(node=>node.props.href.startsWith('tel:')));assert.ok(links.some(node=>node.props.href.includes('linkedin.com')));
  assert.equal(elements(out.tree).some(node=>String(node.props['aria-label']).startsWith('Dismiss')),false);
 }
});

test('Landlord suggestion controls dismiss without new discovery calls and preserve saved contacts after refresh',async()=>{
 const contact={id:'saved',name:'Saved Person',role:'Partner',email:'saved@aew.com'};
 const props={companyId:'aew',companyName:'AEW',contacts:[contact],isLandlord:true};
 const out=renderComponent('CompanyContactsBoard',props),content=text(out.tree);
 assert.match(content,/Add to CRM/);assert.match(content,/Dismiss/);assert.doesNotMatch(content,/RocketReach|93/);
 const button=elements(out.tree).find(node=>String(node.props['data-testid']).startsWith('contact-suggestion-dismiss-'));
 await button.props.onClick();assert.equal(out.requests.length,1);assert.equal(out.requests[0].url,'/api/landlord/aew/dismiss-contact-suggestion');
 out.mutations[0].onSuccess({dismissedKeys:landlordContactSuggestionKeys(candidate),dismissedCompanyId:'aew'});
 assert.deepEqual(out.invalidations.map(row=>row.queryKey.at(-1)),['profile']);assert.equal(out.cache[0].value.dismissedContactKeys.length,3);
 const refreshed=renderComponent('CompanyContactsBoard',{...props,contacts:[{...contact,name:candidate.name,email:candidate.email}]},{dismissed:landlordContactSuggestionKeys(candidate)});
 assert.equal(elements(refreshed.tree).filter(node=>node.type==='KeyContactRow').length,1);
 assert.equal(elements(refreshed.tree).some(node=>String(node.props['data-testid']).startsWith('contact-suggestion-dismiss-')),false);
 const brand=renderComponent('CompanyContactsBoard',{...props,isLandlord:false},{dismissed:landlordContactSuggestionKeys(candidate)});
 assert.match(text(brand.tree),/RocketReach/);assert.match(text(brand.tree),/93/);assert.doesNotMatch(text(brand.tree),/Dismiss/);
});

test('server refresh filters suggestions before enrichment and profile filters inbox suggestions, never CRM rows',()=>{
 const cascade=find('server/contacts-discovery.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleContactsCascade');
 assert.match(cascade,/company\.is_landlord[\s\S]*getDismissedDiscoveries/);
 assert.match(cascade,/candidate\.bgp\?\.inCrm \|\| !isDismissedLandlordContact/);
 assert.ok(cascade.indexOf('!isDismissedLandlordContact')<cascade.indexOf('if (rrKey && opts.lookups)'));
 assert.match(source('server/brand-profile.ts'),/if \(isLandlord\) \{[\s\S]*pendingContactSuggestions = pendingContactSuggestions\.filter/);
});

test('Landlord email and meeting counts open person-scoped histories without changing compose links',()=>{
 const contact={id:'saved',name:'Jane Smith',role:'Asset Manager',email:candidate.email,phone:candidate.phone,interaction_count:18,meeting_count:3};
 const props={contact,companyId:'aew',companyName:'AEW',isLandlord:true};
 const out=renderComponent('KeyContactRow',props),all=elements(out.tree);
 for(const kind of ['email','meeting']) {
  const links=all.filter(node=>node.props['data-testid']===`key-contact-${kind}-history-saved`);
  assert.equal(links.length,2,'desktop and phone counts are both controls');
  let stopped=false;links[0].props.onClick({stopPropagation(){stopped=true;}});
  assert.equal(stopped,true);assert.equal(out.stateChanges.at(-1).next,kind);
  const opened=renderComponent('KeyContactRow',props,{history:kind});
  const dialog=elements(opened.tree).find(node=>node.type===(kind==='email'?'BrandEmailHistory':'LandlordMeetingsHistory'));
  assert.equal(dialog.props.open,true);assert.equal(dialog.props.companyId,'aew');
  assert.equal(JSON.stringify(dialog.props.person),JSON.stringify({contactId:'saved',name:'Jane Smith'}));
  dialog.props.onOpenChange(false);assert.equal(opened.stateChanges.at(-1).next,null);
 }
 assert.equal(out.requests.length,0,'opening a count performs no mutation or compose action');
 assert.ok(all.some(node=>node.type==='a'&&node.props.href===`mailto:${candidate.email}`));
 assert.ok(all.some(node=>node.type==='a'&&node.props.href==='tel:02012345678'));
});

test('Brand and client counts stay plain; recorded discovery email counts use the saved contact identity',()=>{
 const props={contact:{id:'saved',name:'Jane Smith',interaction_count:18,meeting_count:3},companyId:'aew',companyName:'AEW'};
 for(const options of [{props:{...props,isLandlord:false},state:{}},{props:{...props,isLandlord:true},state:{viewer:{role:'Client'}}}]) {
  const all=elements(renderComponent('KeyContactRow',options.props,options.state).tree);
  assert.equal(all.some(node=>String(node.props['data-testid']).startsWith('key-contact-email-history-')),false);
  assert.equal(all.some(node=>node.type==='BrandEmailHistory'||node.type==='LandlordMeetingsHistory'),false);
 }
 const discovered=renderComponent('KeyContactRow',{...props,isLandlord:true,contact:{id:'saved',name:'Jane Smith'},discovery:{bgp:{threadCount:4}}});
 const count=elements(discovered.tree).find(node=>node.props['data-testid']==='key-contact-email-history-saved');
 assert.match(text(count),/4 threads/);count.props.onClick({stopPropagation(){}});assert.equal(discovered.stateChanges.at(-1).next,'email');
});
