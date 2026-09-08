// r618 verification: Data Health actions reachable on a 390px phone, and the
// admin-only email-processor panel gone for a non-admin staff user.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE='http://127.0.0.1:5000';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SHOT=process.env.SHOT_PREFIX||'/tmp/r618v';
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},userAgent:UA,isMobile:true,hasTouch:true});
const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
const user=await lr.json(); if(!user.token){console.error('login failed');process.exit(2);}
const page=await ctx.newPage();
const bad=[];
page.on('response',r=>{ if(r.status()>=400 && /email-processor/.test(r.url())) bad.push(`${r.status()} ${r.url().replace(BASE,'')}`); });
await page.goto(BASE).catch(e=>{if(!/ERR_ABORTED/.test(String(e)))throw e;});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
await page.goto(`${BASE}/settings`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(14000);

const card=page.locator('[data-testid="card-data-health"]');
await card.scrollIntoViewIfNeeded();
const cb=await card.boundingBox();
const ids=['button-backfill-tracker-deals','button-sync-leasing-schedule','button-number-units','button-split-teams','button-scan-duplicates'];
console.log(`Data Health card: w=${Math.round(cb.width)} h=${Math.round(cb.height)} (viewport 390)`);
let offscreen=0;
for(const id of ids){
  const b=await page.locator(`[data-testid="${id}"]`).boundingBox().catch(()=>null);
  const within = b && b.x>=0 && (b.x+b.width)<=391;
  if(!within) offscreen++;
  console.log(`  ${within?'ON-SCREEN ':'OFF-SCREEN'} ${id}: ${b?`x=${Math.round(b.x)} w=${Math.round(b.width)} h=${Math.round(b.height)}`:'(no box)'}`);
}
console.log(`  => ${offscreen} of ${ids.length} action buttons off-screen (want 0)`);
const ov=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:window.innerWidth}));
console.log(`  page h-overflow: ${ov.sw>ov.iw+1?'YES '+ov.sw:'no'}`);
await page.screenshot({path:`${SHOT}-datahealth.png`});

// the email-processor panel must not exist for a non-admin, and must not poll
const meRes=await ctx.request.get(`${BASE}/api/auth/me`,{headers:{Authorization:`Bearer ${user.token}`}});
const me=await meRes.json();
console.log(`\nVictoria isAdmin: ${me.isAdmin ?? me.is_admin ?? false}`);
const panel=await page.locator('[data-testid="button-run-email-processor"]').count();
const blurb=(await page.innerText('body')).includes('chatbgp@brucegillinghampollard.com');
console.log(`  email-processor panel mounted: ${panel>0} (want false) · mailbox blurb on screen: ${blurb} (want false)`);
bad.length=0;
await page.waitForTimeout(35000); // one full refetchInterval
console.log(`  email-processor 4xx over a 35s window: ${bad.length} (want 0) ${bad.slice(0,4).join(' | ')}`);
await page.screenshot({path:`${SHOT}-no-email-panel.png`,fullPage:true});
await browser.close();
