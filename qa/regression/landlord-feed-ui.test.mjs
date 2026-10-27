import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { mergeLandlordNewsTabs } from '../../client/src/lib/landlord-news-feed.ts';
import { canReadLandlordIndustryNews } from '../../shared/landlord-news.ts';
const require=createRequire(import.meta.url);
const {source,find,evaluate,ts}=require('./source-harness.cjs');
const file='client/src/components/brand-feed-card.tsx';
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):React.isValidElement(node)?[node,...nodes(node.props.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(' '):React.isValidElement(node)?text(node.props.children):node==null?'':String(node);

const {landlordInstagramUsername}=evaluate(find('client/src/components/landlord-instagram-preview.tsx',node=>ts.isFunctionDeclaration(node)&&node.name?.text==='landlordInstagramUsername'),{URL});

function render({landlord=false,canSetUp=false,data={tabs:[],read:null},isLoading=false,isError=false,news,instagramHandle,viewer=null,industry=null}={}) {
  const instagram=[],mutations=[],requests=[],queries=[];
  const state=[]; let stateIndex=0;
  const ast=ts.createSourceFile(file,source(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='BrandFeedCard');
  const tags={};
  function visit(node){if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&ts.isIdentifier(node.tagName))tags[node.tagName.text]=node.tagName.text;ts.forEachChild(node,visit);}
  visit(declaration);
  const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const {BrandFeedCard}=evaluate(code,{require,...tags,useToast:()=>({toast:()=>{}}),useState:value=>{const index=stateIndex++;if(!(index in state))state[index]=value;return[state[index],next=>{state[index]=next;}];},useEffect:()=>{},mergeLandlordNewsTabs,landlordInstagramUsername,canReadLandlordIndustryNews,day:value=>new Date(value).toLocaleDateString('en-GB'),
    useInstagram:(id,enabled)=>instagram.push({id,enabled}),useQuery:options=>{queries.push(options);return options.queryKey[0]==='/api/auth/me'?{data:viewer}:options.queryKey[0]==='/api/landlord-relationships'?{data:industry,isLoading:false,isError:false,refetch:()=>{}}:{data,isLoading,isError,refetch:()=>{}};},
    useMutation:options=>{mutations.push(options);return{isPending:false,isError:false,mutate:()=>{}};},
    apiRequest:async(method,path,body)=>{requests.push({method,path,body});return{json:async()=>({state:'done',result:{results:[]}})};},setTimeout:callback=>callback(),queryClient:{invalidateQueries:()=>{},setQueryData:()=>{}},});
  const props={companyId:'aew',landlord,canSetUp,news,instagramHandle,companyName:'AEW',domain:'aew.com'};
  const draw=()=>{stateIndex=0;return BrandFeedCard(props);};
  const out={tree:draw(),instagram,mutations,requests,queries,selectTab(label){
    const tab=nodes(out.tree).find(node=>node.type==='Pill'&&node.props['data-testid']===`brand-feed-tab-${label.toLowerCase().replace(/\s+/g,'-')}`);assert.ok(tab,`Missing ${label} tab`);
    tab.props.onClick();out.tree=draw();
  }};
  return out;
}

test('Landlord feed remains visible with an honest empty/loading/error state and no Instagram discovery',()=>{
 const empty=render({landlord:true});
 assert.equal(empty.tree.props['data-testid'],'landlord-news-social');
 assert.match(text(empty.tree),/News & social/);assert.match(text(empty.tree),/No news or social feeds are connected yet/);
 assert.equal(empty.instagram[0].enabled,false);
 assert.match(text(render({landlord:true,isLoading:true,data:null}).tree),/Loading connected channels/);
 assert.match(text(render({landlord:true,isError:true,data:null}).tree),/Connected channels could not be loaded/);
 const brand=render();assert.equal(brand.tree,null);assert.equal(brand.instagram[0].enabled,true);
});

test('existing Landlord social items use stored source data instead of opening the Instagram discovery path',()=>{
 const items=[{id:'post',title:'Saved post',url:'https://www.instagram.com/p/saved/',at:'2026-10-27',type:'rssapp_instagram'}];
 const out=render({landlord:true,data:{tabs:[{type:'rssapp_instagram',label:'Instagram',sourceUrl:'https://www.instagram.com/savedaccount/',items}],read:null}});
 const all=nodes(out.tree);assert.equal(all.some(node=>node.type==='InstagramGrid'),false);
 const list=all.find(node=>node.type==='ItemList');assert.equal(list.props.landlord,true);assert.equal(JSON.stringify(list.props.items),JSON.stringify(items));
 assert.equal(all.some(node=>node.type==='a'&&node.props.href==='https://www.instagram.com/savedaccount/'),false,'redundant channel-header source link is removed');
});

test('Landlord source setup is explicit and limited to news and LinkedIn; Brand setup remains unchanged',async()=>{
 for(const landlord of [true,false]) {
  const out=render({landlord,canSetUp:true});assert.equal(out.requests.length,0);
  assert.match(text(out.tree),landlord?/Follow official sources/:/Follow brand channels/);
  await out.mutations.at(-1).mutationFn();
  assert.equal(out.requests[0].path,'/api/brand/aew/feed/setup');
  assert.equal(JSON.stringify(out.requests[0].body),landlord?'{"kinds":["website","linkedin"]}':'{}');
 }
});

test('Landlord layout merges news into its feed while keeping the standalone news board for other companies',()=>{
 const panel=source('client/src/components/brand-profile-panel.tsx');
 const branch=find('client/src/components/brand-profile-panel.tsx',node=>ts.isIfStatement(node)&&node.expression.getText()==='isLandlord && flat && !isLender');
 assert.match(branch,/only=\{\["news", "feed"\]\}/);
 assert.match(panel,/show\("feed"\).*landlord=\{isLandlord\} news=\{isLandlord \? data.news : undefined\}/);
 assert.match(panel,/!isLandlord && show\("news"\)/);
});


test('saved media remains available when connected channels fail or are still loading',()=>{
 const news=[{id:'press',title:'AEW buys a new office building in central London',url:'https://property.example/aew-office',source_name:'Property press',published_at:'2026-10-27',summary:'The acquisition covers a mixed-use building.'}];
 for(const state of [{isError:true},{isLoading:true}]) {
  const out=render({landlord:true,data:null,news,...state});
  assert.equal(out.tree.props['data-testid'],'landlord-news-social');
  assert.ok(nodes(out.tree).some(node=>node.type==='Pill'&&node.props['data-testid']==='brand-feed-tab-industry-news'));
  const list=nodes(out.tree).find(node=>node.type==='ItemList');
  assert.equal(list.props.landlord,true);
  assert.equal(list.props.items.length,1);
  assert.equal(list.props.items[0].title,news[0].title);
  assert.equal(list.props.items[0].url,news[0].url);
  assert.equal(out.instagram[0].enabled,false);
 }
});

test('a saved Instagram handle offers a selectable Landlord preview even without a channel feed',()=>{
 const news=[{id:'press',title:'AEW property update',url:'https://property.example/aew',published_at:'2026-10-27'}];
 const out=render({landlord:true,canSetUp:true,data:null,isError:true,news,instagramHandle:'@aew_global'});
 assert.ok(nodes(out.tree).some(node=>node.type==='ItemList'));
 out.selectTab('Instagram');
 const all=nodes(out.tree), preview=all.find(node=>node.type==='LandlordInstagramPreview');
 assert.ok(preview);assert.equal(preview.props.companyId,'aew');assert.equal(preview.props.handle,'aew_global');assert.equal(preview.props.canSetUp,true);
 assert.equal(all.some(node=>node.type==='InstagramGrid'),false);
 assert.equal(all.some(node=>node.type==='a'&&node.props.href==='https://www.instagram.com/aew_global/'),false,'preview owns the Instagram display without duplicate header links');
 assert.equal(out.requests.length,0);
});

test('Brand feeds keep their original tabs, Instagram grid and summary despite Landlord-only props',()=>{
 const items=[{id:'post',title:'Brand post',url:'https://www.instagram.com/p/brand/',at:'2026-10-27',type:'rssapp_instagram'}];
 const out=render({landlord:false,instagramHandle:'@aew_global',news:[{id:'press',title:'Unrelated coverage',url:'https://property.example/aew'}],data:{tabs:[{type:'rssapp_instagram',label:'Instagram',sourceUrl:'https://www.instagram.com/brand/',items}],read:{text:'Brand channel read',at:'2026-10-27'}}});
 const all=nodes(out.tree);
 assert.equal(out.tree.props['data-testid'],'brand-feed-card');
 assert.match(text(out.tree),/What's new/);
 assert.equal(all.filter(node=>node.type==='Pill').length,1);
 assert.ok(all.some(node=>node.type==='InstagramGrid'));
 assert.equal(all.some(node=>node.type==='LandlordInstagramPreview'),false);
 assert.equal(out.instagram[0].enabled,true);
});


test('Landlord news and social selections remain independent while Instagram is shown alongside media',()=>{
 const website={type:'rssapp_web_news',label:'Website news',sourceUrl:'https://www.aew.com/news/',items:[{id:'official',title:'Corporate update',url:'https://www.aew.com/news/update',at:'2026-10-27',type:'rssapp_web_news'}]};
 const linkedin={type:'rssapp_linkedin',label:'LinkedIn',sourceUrl:'https://www.linkedin.com/company/aew-global/',items:[{id:'social',title:'LinkedIn update',url:'https://www.linkedin.com/posts/aew-global_update',at:'2026-10-27',type:'rssapp_linkedin'}]};
 const news=[{id:'press',title:'Media coverage of the AEW property portfolio',url:'https://property.example/aew',published_at:'2026-10-27'}];
 const out=render({landlord:true,instagramHandle:'@aew_global',news,data:{tabs:[website,linkedin],read:null}});
 const section=label=>nodes(out.tree).find(node=>node.type==='section'&&node.props['aria-label']===label);
 const newsItems=()=>nodes(section('News and media')).find(node=>node.type==='ItemList').props.items;
 const socialNodes=()=>nodes(section('Social updates'));
 out.selectTab('Website news');
 assert.equal(newsItems()[0].id,'official');
 assert.ok(socialNodes().some(node=>node.type==='LandlordInstagramPreview'),'saved official Instagram starts visible');
 out.selectTab('Industry news');
 assert.equal(newsItems()[0].id,'media-press');
 assert.ok(socialNodes().some(node=>node.type==='LandlordInstagramPreview'));
 out.selectTab('LinkedIn');
 assert.equal(newsItems()[0].id,'media-press','changing social tabs must not reset the news selection');
 assert.equal(socialNodes().find(node=>node.type==='ItemList').props.items[0].id,'social');
 out.selectTab('Instagram');
 assert.equal(newsItems()[0].id,'media-press');
 assert.ok(socialNodes().some(node=>node.type==='LandlordInstagramPreview'));
});


test('industry query waits for staff identity, excludes clients and does not require setup privileges',()=>{
 for(const [viewer,enabled] of [[null,false],[{email:'client@example.com',role:'Client'},false],[{email:'staff@brucegillinghampollard.com',role:'Staff'},true],[{email:'staff@brucegillinghampollard.com',role:'Staff',companyScopeId:'client'},false]]) {
  const out=render({landlord:true,viewer,canSetUp:false});
  assert.equal(out.queries.find(query=>query.queryKey[0]==='/api/landlord-relationships').enabled,enabled);
  assert.equal(text(out.tree).includes('Refresh news'),enabled);
 }
 const brand=render({landlord:false,viewer:{email:'staff@brucegillinghampollard.com',role:'Staff'}});
 assert.equal(brand.queries.find(query=>query.queryKey[0]==='/api/landlord-relationships').enabled,false);
});
