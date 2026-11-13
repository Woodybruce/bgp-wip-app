// KeyContactRow's four optional slots for a record board (the property page's
// People tab, docs/contacts-board-plan-2026-11-13.md): recordRole, aside,
// menuItems and onChanged. The landlord and brand boards pass none of them and
// draw the row as before; the People board passes a feed entry through one
// adapter that names each field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
const require=createRequire(import.meta.url);
const {source,find,evaluate,ts}=require('./source-harness.cjs');
const elements=node=>Array.isArray(node)?node.flatMap(elements):React.isValidElement(node)?[node,...elements(node.props.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(' '):React.isValidElement(node)?text(node.props.children):node==null?'':String(node);
const file='client/src/components/company-contacts-board.tsx';

function renderRow(props,{viewer={role:'Admin'}}={}) {
 const ast=ts.createSourceFile(file,source(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='KeyContactRow'),tags={};
 function visit(node){if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&ts.isIdentifier(node.tagName))tags[node.tagName.text]=node.tagName.text;ts.forEachChild(node,visit);}visit(declaration);
 const mutations=[],states=[];
 const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports=evaluate(code,{require,...tags,useQueryClient:()=>({invalidateQueries(){}}),useToast:()=>({toast(){}}),
  useState:value=>{states.push(value);return[value,()=>{}];},
  useQuery:options=>options.queryKey[0]==='/api/auth/me'?{data:viewer}:{data:null},
  useMutation:options=>{mutations.push(options);return{isPending:false,mutate(){}};},
  apiRequest:async()=>({json:async()=>({})}),showLandlordEmployerBadge:()=>false,isEmailPlaceholderName:()=>false,
  formatRelativeShort:()=>'',contactDisplayName:value=>value,AI_FLAG_LABELS:{},
 });
 return{tree:exports.KeyContactRow(props),mutations,states};
}

const contact={id:'c1',name:'Jane Smith',role:'Head of Leasing',email:'jane@aew.test',phone:'020 1234 5678'};
const base={contact,companyId:'aew',companyName:'AEW',isLandlord:true};

test('without the slots the row draws as before: no extra separator, slot or callback', () => {
 const plain=renderRow(base),withUndefined=renderRow({...base,recordRole:undefined,aside:undefined,menuItems:undefined,onChanged:undefined});
 assert.equal(JSON.stringify(plain.tree),JSON.stringify(withUndefined.tree));
 assert.equal(elements(plain.tree).filter(node=>node.type==='DropdownMenuSeparator').length,0);
 assert.equal(plain.states.length,4,'the four useState calls are unchanged');
 assert.deepEqual(plain.states,[false,'Head of Leasing',null,null]);
 assert.doesNotThrow(()=>plain.mutations[0].onSuccess());
 assert.doesNotThrow(()=>plain.mutations[1].onSuccess({},true));
});

test('the slots render: the role beside the name, the aside on both layouts, the menu items after a separator', () => {
 let changed=0;
 const role=React.createElement('span',{'data-testid':'slot-role'},'Asset Manager · this property');
 const aside=React.createElement('span',{'data-testid':'slot-aside'},'Last contact 3 Nov');
 const item=React.createElement('span',{'data-testid':'slot-item'},'Role at Bluewater');
 const out=renderRow({...base,recordRole:role,aside,menuItems:item,onChanged:()=>changed++});
 const all=elements(out.tree);
 assert.equal(all.filter(node=>node.props['data-testid']==='slot-role').length,1);
 assert.equal(all.filter(node=>node.props['data-testid']==='slot-aside').length,2,'phone line and desktop line');
 const content=all.find(node=>node.type==='DropdownMenuContent');
 const inMenu=elements(content.props.children);
 const separator=inMenu.findIndex(node=>node.type==='DropdownMenuSeparator'),itemAt=inMenu.findIndex(node=>node.props['data-testid']==='slot-item');
 assert.ok(separator>=0&&itemAt>separator,'the items come after a separator');
 assert.match(text(out.tree),/Head of Leasing/,'the job title is still drawn');
 // The role sits in the name's line, after the name link.
 const nameLine=all.find(node=>node.type==='div'&&elements(node.props.children).some(child=>child.props['data-testid']==='slot-role')&&String(node.props.className).includes('gap-1'));
 const kids=React.Children.toArray(nameLine.props.children);
 assert.equal(kids[0].type,'Link');
 assert.equal(kids[1].props['data-testid'],'slot-role');
 out.mutations[0].onSuccess();out.mutations[1].onSuccess({},false);
 assert.equal(changed,2,'called after a job title save and after Mark as left');
});

test('the landlord and brand boards pass none of the slots', () => {
 const board=find(file,node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CompanyContactsBoard');
 const uses=board.match(/<KeyContactRow [^>]*\/>/g)||[];
 assert.ok(uses.length>=1);
 for(const use of uses) assert.doesNotMatch(use,/\b(recordRole|aside|menuItems|onChanged)=/);
});

test('the People board draws a CRM person through the adapter only, never by spreading the feed entry', () => {
 const board=source('client/src/components/property-page/people-board.tsx');
 const contactProps=board.match(/contact=\{\{[^}]*\}\}/g)||[];
 assert.equal(contactProps.length,1,'one adapter');
 assert.match(contactProps[0],/id: person\.contactId/);
 assert.match(contactProps[0],/role: person\.jobTitle/);
 assert.doesNotMatch(contactProps[0],/\.\.\./);
 assert.doesNotMatch(board,/contact=\{\s*\{?\s*\.\.\.(entry|p|person)\b/);
 assert.match(board,/if \(!person\.contactId\) return <QuietRow/,'a person with no CRM record gets the one-line row');
 assert.match(board,/!\(teamControl && p\.group === "bgp" && p\.source === "assigned"\)/,'the BGP team control draws assigned people once');
});

test('the BGP team control is drawn only where the reply says who is assigned (staff), so no BGP person is drawn twice', () => {
 const board=source('client/src/components/property-page/people-board.tsx');
 assert.match(board,/const teamControl = viewer\.staff;/);
 assert.match(board,/key === "bgp" && teamControl && \(/);
 assert.equal((board.match(/<InlineAgents /g)||[]).length,1);
});

test('the units group draws every person exactly once, never matching on a null key', async () => {
 const {peopleOnUnit,unplaced}=await import('../../shared/record-people.ts');
 const code=find('client/src/components/property-page/people-board.tsx',node=>ts.isFunctionDeclaration(node)&&node.name?.text==='unitBlocks');
 const {unitBlocks}=evaluate(code,{peopleOnUnit,unplaced,Map,Set});
 const rel=(scheduleRowId,trackerId)=>({group:'units',role:'Tenant',roleSource:'derived',scheduleRowId,trackerId});
 const feed=[{id:'u1',label:'Unit 1',scheduleRowId:'s1',trackerId:null},{id:'u2',label:'Unit 2',scheduleRowId:null,trackerId:null},{id:'u3',label:'Unit 3',scheduleRowId:'s3',trackerId:'t3'}];
 const people=[
  {id:'company:two-units',relationships:[rel('s1',null),rel(null,'t3')]},
  {id:'contact:one',relationships:[rel('s3',null)]},
  {id:'contact:nowhere',relationships:[rel(null,null),rel('s-other','t-other')]},
  {id:'contact:first',relationships:[rel('s1',null)]},
 ];
 const blocks=JSON.parse(JSON.stringify(unitBlocks(people,feed,unit=>unit.label)));
 const drawn=blocks.flatMap(block=>block.people.map(p=>p.id));
 assert.deepEqual([...drawn].sort(),people.map(p=>p.id).sort(),'each person once, nobody dropped');
 assert.deepEqual(blocks.map(block=>[block.label,block.people.map(p=>p.id)]),[
  ['Unit 1',['contact:first']],
  ['Unit 1, Unit 3',['company:two-units']],
  ['Unit 3',['contact:one']],
  ['Not tied to a unit',['contact:nowhere']],
 ]);
 assert.ok(!blocks.some(block=>block.label.includes('Unit 2')),'a unit with no keys matches nobody');
 assert.equal(unitBlocks([],feed,unit=>unit.label).length,0);
});
