import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/,r=>r.abort());
const bad=[]; ctx.on('response',r=>{if(r.status()>=400)bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')}`)});
const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const u=await lr.json(); const TOKEN=u.token;
const p=await ctx.newPage();
await p.goto(BASE); await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[TOKEN,u]);
await p.goto(`${BASE}/`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(6000);

// ── STEP A: drill from the expiring popover into the tenancy schedule ──
await p.locator('[data-testid="kpi-expiring"]').first().click();
await p.waitForTimeout(1500);
const row=p.locator('[data-testid="expiring-lease-1"]');
console.log('A. clicking expiring-lease-1 ("Nando\'s"):', await row.count(), 'row(s) found');
await row.first().click({timeout:8000}).catch(e=>console.log('   click failed:',String(e).slice(0,150)));
await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(4000);
const t=await p.locator('main, body').first().innerText();
console.log('   landed on:', p.url().replace(BASE,''), '| chars:', t.length);
console.log('   forbidden/denied text:', /not authorised|Not available|Access denied|Page not found|403/i.test(t));
console.log('   ', t.replace(/Powered by BGP[\s\S]*?⌘\s*K\s*/,'').slice(0,600).replace(/\n{2,}/g,'\n'));
await p.screenshot({path:'/tmp/r622/04-tenancy-schedule.png'});

// ── STEP B: the WRITE — Mark records agreed terms on his own live deal ──
await p.goto(`${BASE}/deals`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(4000);
await p.screenshot({path:'/tmp/r622/05-deals.png'});
const addTerms=p.getByText('Add terms',{exact:true});
console.log('\nB. "Add terms" affordances on the client deals table:', await addTerms.count());
if(await addTerms.count()){
  await addTerms.first().click({timeout:8000}).catch(e=>console.log('   click failed:',String(e).slice(0,150)));
  await p.waitForTimeout(2500);
  const dlg=p.locator('[role="dialog"]');
  console.log('   dialog opened:', await dlg.count());
  if(await dlg.count()) console.log('   dialog:\n', (await dlg.first().innerText()).slice(0,800));
  await p.screenshot({path:'/tmp/r622/06-add-terms.png'});
}
console.log('\n=== >=400 ===\n'+[...new Set(bad)].join('\n'));
await b.close();
