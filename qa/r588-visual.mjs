// r588 precise DOM extraction on the staff property page + tracker at 1440px.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync } from 'fs';
const BASE = process.env.QA_BASE || 'http://localhost:5000';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (r) => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
const CACHE = '/tmp/r588-token.json';
let user = null;
if (existsSync(CACHE)) { try { const c0 = JSON.parse(readFileSync(CACHE,'utf8')); if ((await ctx.request.get(`${BASE}/api/auth/me`,{headers:{Authorization:`Bearer ${c0.token}`}})).ok()) user=c0; } catch {} }
if (!user) { const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}}); user = await r.json(); if(!user.token){console.error('login failed');process.exit(2);} writeFileSync(CACHE,JSON.stringify(user)); }
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);

const PROP = process.env.QA_PROP || 'cccccccc-0000-0000-0000-000000000001';
await page.goto(`${BASE}/properties/${PROP}`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(3000);

const out = await page.evaluate(() => {
  const txt = (el) => (el?.textContent || '').replace(/\s+/g,' ').trim();
  // The pill row that follows "Full Board" — grab every element carrying a
  // status word and its neighbouring number, structurally not by flat text.
  const words = ['Opportunity','Available','Negotiating','HOTs','Solicitors','Exchanged','Completed','Withdrawn','Full Board'];
  const pills = [];
  for (const el of document.querySelectorAll('button,div,span,a')) {
    const t = txt(el);
    if (el.children.length > 3) continue;
    for (const w of words) {
      if (t === w || new RegExp(`^\\d+\\s*${w}$`).test(t) || new RegExp(`^${w}\\s*\\d+$`).test(t)) {
        pills.push({ tag: el.tagName, testid: el.getAttribute('data-testid'), text: t });
      }
    }
  }
  // Section headings + any "N units" badges
  const badges = [...document.querySelectorAll('*')].filter(e => e.children.length===0 && /^\d[\d,]*\s+units?$/.test(txt(e))).map(e => txt(e));
  const grab = (label) => {
    const all = [...document.querySelectorAll('*')].filter(e => e.children.length===0 && txt(e) === label);
    return all.map(e => {
      const par = e.closest('div');
      return txt(par).slice(0,120);
    });
  };
  return {
    pills, badges,
    vacancy: grab('VACANCY'),
    active: grab('ACTIVE DEALS'),
    risk: (txt([...document.querySelectorAll('*')].find(e => /units vacant with no active deal/.test(txt(e))) )||'').slice(0,200),
  };
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: 'qa/smoke-shots/r588-visual-property.png', fullPage: false });
await browser.close();
