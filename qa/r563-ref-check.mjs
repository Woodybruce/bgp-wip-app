import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000'; const TAG=process.env.QA_TAG||'r563ref';
const login=async u=>(await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})})).json();
const browser=await chromium.launch({executablePath:existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined,args:['--no-sandbox']});
for (const [who,email] of [['staff','victoria@brucegillinghampollard.com'],['client','mark.warne@landsec.com']]) {
  const u=await login(email);
  const ctx=await browser.newContext({viewport:{width:1600,height:950}});
  const page=await ctx.newPage();
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,uu])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));localStorage.removeItem('bgp_letting_hidden_cols');},[u.token,u]);
  await page.goto(BASE+'/available').catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(4000);
  const chipTxt = await page.locator('[data-testid="stat-card-sol"]').first().innerText().catch(()=> 'NO CHIP');
  await page.locator('[data-testid="stat-card-sol"]').first().click({timeout:8000}).catch(e=>console.log(`!! ${who} chip`,String(e).slice(0,80)));
  await page.waitForTimeout(2500);
  const r=await page.evaluate(()=>({
    rows:[...document.querySelectorAll('tbody tr')].map(tr=>(tr.innerText||'').replace(/\s+/g,' ').slice(0,140)).slice(0,6),
    refLinks:[...document.querySelectorAll('[data-testid^="link-deal-ref-"]')].map(e=>e.innerText),
    dots:[...document.querySelectorAll('[data-testid^="compliance-flag-"]')].map(e=>e.getAttribute('title')),
  }));
  console.log(`-- ${who.toUpperCase()} solChip="${chipTxt.replace(/\s+/g,' ')}"`); console.log(JSON.stringify(r,null,1));
  await page.screenshot({path:`qa/smoke-shots/${TAG}-${who}.png`});
  await ctx.close();
}
await browser.close();
