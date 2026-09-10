// r590 verify — the boot heal must collapse the same-unit tracker duplicates
// (U062 x4, L090 x2, L130 x2 at Bluewater) and NOTHING else, then the client
// dashboard/board must count each empty unit once.
import pg from 'pg';
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE='http://localhost:5000';
const c=new pg.Client({connectionString:'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke'});
await c.connect();
const q=async(s)=> (await c.query(s)).rows;
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
console.log('waiting 30s for the boot heals…'); await wait(30000);
console.log(await q(`select count(*) total from available_units`));
console.table(await q(`select unit_name, count(*) from available_units where unit_name in ('U062 Bluewater - Upper Level','L090 Bluewater','L130 Bluewater - Lower Level') group by 1`));
// CONTROLS
const withDeal = (await q(`select count(*)::int n from available_units where deal_id is not null`))[0].n;
const dupesLeft = (await q(`select count(*)::int n from (select property_id, unit_id, lower(trim(unit_name)) nm from available_units where unit_id is not null group by 1,2,3 having count(*)>1) x`))[0].n;
const distinct = (await q(`select count(distinct (property_id, unit_id, lower(trim(unit_name))))::int n from available_units where unit_id is not null`))[0].n;
const total = (await q(`select count(*)::int n from available_units`))[0].n;
console.log(`total=${total} (was 82)  distinct-keyed=${distinct} (was 77)  duplicate keys left=${dupesLeft}  rows with a deal=${withDeal} (was 4 — must be unchanged)`);
// a control unit that is legitimately single-listed must survive
const ctrl = (await q(`select count(*)::int n from available_units where unit_name = 'U062/U063 Bluewater'`))[0].n;
console.log(`control 'U062/U063 Bluewater' (a DIFFERENT unit with a similar name) still present: ${ctrl===1}`);
// ---- the client's own view ----
const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mark.warne@landsec.com',password:'B@nd0077!'})});
const me=await r.json();
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.route('**/*',x=>x.request().url().startsWith(BASE)||x.request().url().startsWith('data:')?x.continue():x.abort());
const page=await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[me.token,me.user||me]);
await page.goto(`${BASE}/`).catch(()=>{}); await page.waitForTimeout(4500);
await page.screenshot({path:'qa/smoke-shots/r590-12-dash-fixed.png',fullPage:true});
const t=await page.evaluate(()=>document.body.innerText);
const line=t.split('\n');
console.log('dashboard letting line:', line.filter(l=>/live letting/.test(l)).join(' | '));
console.log('dashboard chips:', line.filter(l=>/^\d+ (Available|Negotiating)$/.test(l)).join(' | '));
console.log('U062 rows still drawn on the dashboard list:', (t.match(/U062 Bluewater - Upper Level/g)||[]).length, '(must be 1)');
console.log('L090 rows:', (t.match(/L090 Bluewater/g)||[]).length, ' L130 rows:', (t.match(/L130 Bluewater - Lower Level/g)||[]).length);
await page.goto(`${BASE}/deals/letting?propertyId=cccccccc-0000-0000-0000-000000000001`).catch(()=>{}); await page.waitForTimeout(4500);
await page.screenshot({path:'qa/smoke-shots/r590-13-board-fixed.png',fullPage:true});
const t2=await page.evaluate(()=>document.body.innerText);
console.log('board header:', (t2.split('\n').find(l=>/of \d+ units/.test(l))||'?').slice(0,90));
const i=t2.split('\n').findIndex(l=>l.trim()==='MARKETING');
console.log('board MARKETING count:', t2.split('\n')[i+1]);
console.log('U062 rows on the board:', (t2.match(/U062 Bluewater - Upper Level/g)||[]).length, '(must be 1)');
await b.close(); await c.end();
