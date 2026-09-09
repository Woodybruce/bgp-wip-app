import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5000';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/,r=>r.abort());
const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
const u=await lr.json();
const p=await ctx.newPage();
await p.goto(BASE); await p.evaluate(([t,uu])=>{localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(uu));},[u.token,u]);
await p.goto(`${BASE}/`).catch(()=>{}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(6000);
const btn=p.locator('[data-testid="kpi-expiring"]');
console.log('kpi-expiring buttons:', await btn.count());
if(!await btn.count()) { console.log('** tile not rendered **'); await b.close(); process.exit(0); }
console.log('tile text:', (await btn.first().innerText()).replace(/\n/g,' | '));
const box=await btn.first().boundingBox();
console.log('bounding box:', JSON.stringify(box));
// what element actually receives a click at the tile's centre?
const hit=await p.evaluate(([x,y])=>{const el=document.elementFromPoint(x,y);const path=[];let e=el;for(let i=0;i<5&&e;i++,e=e.parentElement)path.push(`${e.tagName}${e.getAttribute('data-testid')?'[#'+e.getAttribute('data-testid')+']':''}${e.className&&typeof e.className==='string'?'.'+e.className.split(/\s+/).slice(0,2).join('.'):''}`);return path.join(' < ');},[box.x+box.width/2,box.y+box.height/2]);
console.log('elementFromPoint at tile centre:\n   ', hit);
await btn.first().click({timeout:8000}).catch(e=>console.log('CLICK FAILED:',String(e).slice(0,200)));
await p.waitForTimeout(1800);
const pop=p.locator('[role="dialog"], [data-radix-popper-content-wrapper]');
console.log('popover open:', await pop.count(), '| expiring-lease rows:', await p.locator('[data-testid^="expiring-lease-"]').count());
if(await pop.count()) console.log('popover text:\n'+(await pop.first().innerText()).slice(0,900));
await p.screenshot({path:'/tmp/r622/03-expiring-popover.png'});
await b.close();
