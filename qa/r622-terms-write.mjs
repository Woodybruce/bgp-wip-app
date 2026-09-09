import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/,r=>r.abort());
const calls=[]; ctx.on('response',r=>{const m=r.request().method();if(m!=='GET')calls.push(`${r.status()} ${m} ${r.url().replace(BASE,'')}`)});
const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const u=await lr.json(); const TOKEN=u.token;
const p=await ctx.newPage();
await p.goto(BASE); await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[TOKEN,u]);
async function api(m,path,body){const r=await ctx.request.fetch(`${BASE}${path}`,{method:m,headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},...(body?{data:body}:{})});let j=null;try{j=await r.json()}catch{};return{s:r.status(),j};}
const before=await api('GET','/api/crm/deals');
const target=(before.j||[]).find(d=>d.ref===1003)||(before.j||[])[0];
console.log('target deal:', target?.id, 'ref', target?.ref, '| rentPa before:', target?.rentPa);

await p.goto(`${BASE}/`).catch(()=>{}); await p.waitForLoadState("networkidle").catch(()=>{}); await p.waitForTimeout(5000);
await p.goto(`${BASE}/deals`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(5000);
await p.getByText('Add terms',{exact:true}).first().click({timeout:8000});
await p.waitForTimeout(2000);
const d=p.locator('[role="dialog"]').first();
// the Rent PA row's click-to-edit span is the first "—" in the popover
const cell=d.locator('span,div').filter({hasText:/^—$/}).first();
console.log('editable "—" cells found:', await d.locator('span,div').filter({hasText:/^—$/}).count());
await cell.click({timeout:8000}).catch(e=>console.log('cell click failed',String(e).slice(0,150)));
await p.waitForTimeout(800);
console.log('inputs after clicking the dash:', await d.locator('input').count());
if(await d.locator('input').count()){
  await d.locator('input').first().fill('185000');
  await d.locator('input').first().press('Enter');
  await p.waitForTimeout(3000);
  console.log('dialog after save:\n'+(await d.innerText()).split('\n').map(s=>'    '+s).join('\n'));
}
await p.screenshot({path:'/tmp/r622/07-terms-write.png'});
console.log('\nnon-GET calls:', JSON.stringify(calls,null,1));
const after=await api('GET','/api/crm/deals');
const t2=(after.j||[]).find(d=>d.id===target?.id);
console.log('rentPa AFTER (server):', t2?.rentPa);
if(t2?.rentPa!=null){ const r=await api('PATCH',`/api/crm/deals/${target.id}`,{rentPa:null}); console.log('cleanup PATCH ->',r.s); }
await b.close();
