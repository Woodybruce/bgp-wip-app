// r591 verify — a unit added on the Letting Tracker must land on the
// property's Leasing Schedule with the board's own LABEL ("Vacant"), not the
// raw marketing CODE, and deleting a scheme must take its unit spine with it.
import pg from 'pg';
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
const q=async(s,p)=> (await c.query(s,p)).rows;
const login=async(u)=> (await (await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})})).json());
const me=await login('victoria@brucegillinghampollard.com');
const H={Authorization:'Bearer '+me.token,'Content-Type':'application/json'};
const BLUEWATER='cccccccc-0000-0000-0000-000000000001';

// ---- 1. the write boundary ----
const mk=async(name,marketingStatus)=>{
  const r=await fetch(`${BASE}/api/available-units`,{method:'POST',headers:H,body:JSON.stringify({propertyId:BLUEWATER,unitName:name,marketingStatus,sqft:1200,askingRent:50000})});
  return r.ok? await r.json() : {__status:r.status};
};
const made=[];
for (const [n,st] of [['QA-R591-AVA','AVA'],['QA-R591-NEG','NEG'],['QA-R591-HOT','HOT'],['QA-R591-LABEL','Available']]) {
  const u=await mk(n,st); made.push([n,st,u]);
}
console.table(await q(`select unit_name, status from leasing_schedule_units where unit_name like 'QA-R591%' order by unit_name`));
console.table(await q(`select unit_name, marketing_status from available_units where unit_name like 'QA-R591%' order by unit_name`));
// CONTROL: the fixture's own rows must be untouched
console.table(await q(`select status, count(*) c from leasing_schedule_units where unit_name not like 'QA-%' group by 1 order by c desc`));

// ---- 2. visual: the chip on the property's leasing board ----
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:1000}});
await ctx.route('**/*',x=>x.request().url().startsWith(BASE)||x.request().url().startsWith('data:')?x.continue():x.abort());
const page=await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[me.token,me.user||me]);
await page.goto(`${BASE}/leasing-schedule/${BLUEWATER}`).catch(()=>{}); await page.waitForTimeout(5000);
await page.getByPlaceholder(/search/i).first().fill('QA-R591').catch(()=>{});
await page.waitForTimeout(1500);
await page.screenshot({path:'qa/smoke-shots/r591-01-leasing-chips.png',fullPage:false});
const txt=await page.evaluate(()=>document.body.innerText);
for (const n of ['QA-R591-AVA','QA-R591-NEG','QA-R591-HOT','QA-R591-LABEL']) {
  const i=txt.split('\n').findIndex(l=>l.includes(n));
  console.log(`${n} row on the board -> ${JSON.stringify(txt.split('\n').slice(i,i+3).join(' | ').slice(0,120))}`);
}
console.log('raw codes visible anywhere on the board:', /\b(AVA|NEG|HOT|SOL|COM|WIT)\b/.test(txt));

// ---- 3. the cascade ----
const mkProp=await (await fetch(`${BASE}/api/crm/properties`,{method:'POST',headers:H,body:JSON.stringify({name:'QA-R591 Cascade Prop'})})).json();
await fetch(`${BASE}/api/tenancy-schedule/unit`,{method:'POST',headers:H,body:JSON.stringify({property_id:mkProp.id,unit_number:'QA-R591-CASC',status:'Vacant'})});
await new Promise(r=>setTimeout(r,1200));
const before=await q(`select
  (select count(*)::int from leasing_schedule_units where property_id=$1) ls,
  (select count(*)::int from available_units where property_id=$1) au,
  (select count(*)::int from tenancy_schedule_units where property_id=$1) ts,
  (select count(*)::int from property_units where property_id=$1) pu`,[mkProp.id]);
console.log('before property DELETE:', before[0]);
const del=await fetch(`${BASE}/api/crm/properties/${mkProp.id}`,{method:'DELETE',headers:H});
console.log('DELETE /api/crm/properties ->', del.status);
const after=await q(`select
  (select count(*)::int from leasing_schedule_units where property_id=$1) ls,
  (select count(*)::int from available_units where property_id=$1) au,
  (select count(*)::int from tenancy_schedule_units where property_id=$1) ts,
  (select count(*)::int from property_units where property_id=$1) pu`,[mkProp.id]);
console.log('after  property DELETE:', after[0]);
// CONTROL: Bluewater's spine must be untouched by that delete
console.log('CONTROL Bluewater leasing rows still:', (await q(`select count(*)::int n from leasing_schedule_units where property_id=$1`,[BLUEWATER]))[0].n);

// ---- teardown of this probe's own rows ----
for (const [,,u] of made) if (u?.id) await fetch(`${BASE}/api/available-units/${u.id}`,{method:'DELETE',headers:H});
const lsq=await q(`delete from leasing_schedule_units where unit_name like 'QA-R591%' returning id`);
const auq=await q(`delete from available_units where unit_name like 'QA-R591%' returning id`);
const dq=await q(`delete from crm_deals where name like '%QA-R591%' returning id`);
const tq=await q(`delete from tenancy_schedule_units where unit_number like 'QA-R591%' returning id`);
const pq=await q(`delete from property_units where unit_name like 'QA-R591%' returning id`);
console.log(`teardown: ls ${lsq.length}, au ${auq.length}, deals ${dq.length}, tenancy ${tq.length}, property_units ${pq.length}`);
console.log('final counts:', (await q(`select (select count(*)::int from available_units) au, (select count(*)::int from leasing_schedule_units) ls`))[0]);
await b.close(); await c.end();
