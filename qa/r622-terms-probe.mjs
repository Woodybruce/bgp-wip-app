import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
async function run(un,label){
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/,r=>r.abort());
  const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:un,password:'B@nd0077!'}});
  const u=await lr.json();
  const p=await ctx.newPage();
  await p.goto(BASE); await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[u.token,u]);
  await p.goto(`${BASE}/deals`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(6000);
  const at=p.getByText('Add terms',{exact:true});
  const n=await at.count();
  console.log(`\n── ${label} ── "Add terms" cells: ${n}`);
  if(!n){ await ctx.close(); return; }
  await at.first().click({timeout:8000}).catch(e=>console.log('  click failed',String(e).slice(0,120)));
  await p.waitForTimeout(2500);
  const d=p.locator('[role="dialog"]').first();
  if(!await d.count()){ console.log('  no dialog'); await ctx.close(); return; }
  console.log(`  inputs: ${await d.locator('input').count()} · textareas: ${await d.locator('textarea').count()} · selects: ${await d.locator('select,[role="combobox"]').count()} · buttons: ${await d.locator('button').count()}`);
  const btns=await d.locator('button').allInnerTexts();
  console.log('  button labels:', JSON.stringify(btns.map(s=>s.trim()).filter(Boolean)));
  console.log('  full dialog text:\n'+(await d.innerText()).split('\n').map(s=>'    '+s).join('\n'));
  await p.screenshot({path:`/tmp/r622/terms-${label}.png`});
  await ctx.close();
}
await run('mark.warne@landsec.com','mark-client');
await run('victoria@brucegillinghampollard.com','victoria-staff');
await b.close();
