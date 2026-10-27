import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
const require=createRequire(import.meta.url);
const {source,find,evaluate,ts}=require('./source-harness.cjs');
const file='client/src/components/brand-feed-card.tsx';
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):React.isValidElement(node)?[node,...nodes(node.props.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(' '):React.isValidElement(node)?text(node.props.children):node==null?'':String(node);

function render({landlord=false,canSetUp=false,data={tabs:[],read:null},isLoading=false,isError=false}={}) {
  const instagram=[],mutations=[],requests=[];
  const ast=ts.createSourceFile(file,source(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='BrandFeedCard');
  const tags={};
  function visit(node){if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&ts.isIdentifier(node.tagName))tags[node.tagName.text]=node.tagName.text;ts.forEachChild(node,visit);}
  visit(declaration);
  const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const {BrandFeedCard}=evaluate(code,{require,...tags,useToast:()=>({toast:()=>{}}),useState:value=>[value,()=>{}],useEffect:()=>{},
    useInstagram:(id,enabled)=>instagram.push({id,enabled}),useQuery:()=>({data,isLoading,isError,refetch:()=>{}}),
    useMutation:options=>{mutations.push(options);return{isPending:false,isError:false,mutate:()=>{}};},
    apiRequest:async(method,path,body)=>{requests.push({method,path,body});return{json:async()=>({state:'done',result:{results:[]}})};},setTimeout:callback=>callback(),queryClient:{invalidateQueries:()=>{}},});
  return {tree:BrandFeedCard({companyId:'aew',landlord,canSetUp}),instagram,mutations,requests};
}

test('Landlord feed remains visible with an honest empty/loading/error state and no Instagram discovery',()=>{
 const empty=render({landlord:true});
 assert.equal(empty.tree.props['data-testid'],'landlord-news-social');
 assert.match(text(empty.tree),/News & social/);assert.match(text(empty.tree),/No news or social feeds are connected yet/);
 assert.equal(empty.instagram[0].enabled,false);
 assert.match(text(render({landlord:true,isLoading:true,data:null}).tree),/Loading connected sources/);
 assert.match(text(render({landlord:true,isError:true,data:null}).tree),/Sources could not be loaded/);
 const brand=render();assert.equal(brand.tree,null);assert.equal(brand.instagram[0].enabled,true);
});

test('existing Landlord social items use stored source data instead of opening the Instagram discovery path',()=>{
 const items=[{id:'post',title:'Saved post',url:'https://www.instagram.com/p/saved/',at:'2026-10-27',type:'rssapp_instagram'}];
 const out=render({landlord:true,data:{tabs:[{type:'rssapp_instagram',label:'Instagram',sourceUrl:'https://www.instagram.com/savedaccount/',items}],read:null}});
 const all=nodes(out.tree);assert.equal(all.some(node=>node.type==='InstagramGrid'),false);
 const list=all.find(node=>node.type==='ItemList');assert.equal(list.props.landlord,true);assert.equal(list.props.items,items);
 assert.equal(all.find(node=>node.type==='a').props.href,'https://www.instagram.com/savedaccount/');
});

test('Landlord source setup is explicit and limited to news and LinkedIn; Brand setup remains unchanged',async()=>{
 for(const landlord of [true,false]) {
  const out=render({landlord,canSetUp:true});assert.equal(out.requests.length,0);
  assert.match(text(out.tree),landlord?/Follow official sources/:/Follow brand channels/);
  await out.mutations[1].mutationFn();
  assert.equal(out.requests[0].path,'/api/brand/aew/feed/setup');
  assert.equal(JSON.stringify(out.requests[0].body),landlord?'{"kinds":["website","linkedin"]}':'{}');
 }
});

test('Landlord layout explicitly mounts the saved feed beside news without altering Brand-only page paths',()=>{
 const panel=source('client/src/components/brand-profile-panel.tsx');
 const branch=find('client/src/components/brand-profile-panel.tsx',node=>ts.isIfStatement(node)&&node.expression.getText()==='isLandlord && flat && !isLender');
 assert.match(branch,/only=\{\["news", "feed"\]\}/);
 assert.match(panel,/show\("feed"\).*landlord=\{isLandlord\}/);
});
