import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE='http://localhost:5000';
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
  const chips=await page.evaluate(()=>[...document.querySelectorAll('[data-testid^="stat-chip-"]')].map(e=>({id:e.getAttribute('data-testid'),txt:(e.innerText||'').replace(/\s+/g,' ')})));
  console.log(`-- ${who} chips:`, JSON.stringify(chips));
  await ctx.close();
}
await browser.close();
