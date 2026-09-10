import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000', USER='victoria@brucegillinghampollard.com', PASSWORD='B@nd0077!', TAG='r564j';
const TID='9351dee8-3e75-4283-b583-6565a051b89f', DEAL='11110000-0000-0000-0000-000000000301';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, locale:'en-GB' });
  await ctx.route('**/*',(route)=>{const u=route.request().url(); if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue(); return route.abort();});
  const user = await (await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:USER,password:PASSWORD}})).json();
  const page = await ctx.newPage();
  let bucket=[];
  page.on('response',(res)=>{if(res.status()>=400)bucket.push(`HTTP ${res.status()} ${res.request().method()} ${res.url().replace(BASE,'')}`);});
  page.on('pageerror',(e)=>bucket.push(`PAGEERROR ${String(e).slice(0,250)}`));
  page.on('console',(m)=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))bucket.push(`CONSOLE ${m.text().slice(0,220)}`);});
  const flush=(l)=>{const s=[...new Set(bucket)];bucket=[];console.log(s.length?`   [${l}] `+s.join('\n   '):`   [${l}] clean`);};
  let step=70; const shot=async(l)=>{step++;const p=`qa/smoke-shots/${TAG}-${step}-${l}.png`;await page.screenshot({path:p});console.log('   shot',p);};
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await page.goto(BASE+'/tasks',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(3000);
  const row = page.locator(`[data-testid="task-row-${TID}"]`);
  // what is the deal chip? clickable?
  console.log('== row html bits:', await row.evaluate(el=>[...el.querySelectorAll('a,button,span')].filter(e=>/Bluewater MSU9/.test(e.innerText||'')).map(e=>({tag:e.tagName,href:e.getAttribute('href'),id:e.getAttribute('data-testid'),cls:(e.className||'').toString().slice(0,80)}))).then(JSON.stringify));
  const chip = row.getByText('Bluewater MSU9 letting',{exact:false}).first();
  await chip.click({force:true}).catch(e=>console.log('chip click err',String(e).slice(0,120)));
  await page.waitForTimeout(2500); await page.waitForLoadState('networkidle').catch(()=>{});
  console.log('== url after clicking the deal chip:', page.url());
  await shot('after-chip-click');
  flush('chip');

  // now open the deal directly and look for the task
  await page.goto(BASE+'/deals/'+DEAL,{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(4000);
  console.log('== deal url:', page.url());
  const t=(await page.locator('body').innerText()).replace(/\s+/g,' ');
  console.log('== deal page mentions the task:', t.includes('chase Landsec on the Bluewater HOTs'));
  console.log('== deal text:', t.slice(400,2400));
  await shot('deal');
  flush('deal');
} finally { await browser.close(); }
