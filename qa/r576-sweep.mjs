// r576 — phone-shell sweep as the Landsec client.
import { chromium } from 'playwright';
import { existsSync } from 'fs';
const BASE = 'http://127.0.0.1:5000';
const USER = 'mark.warne@landsec.com', PASSWORD = 'B@nd0077!';
const SHOT = 'qa/smoke-shots';
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
const raw = browser.newContext.bind(browser);
browser.newContext = async (o) => { const c = await raw(o); await c.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => r.abort()); return c; };
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Europe/London' });
const user = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } })).json();
const TOKEN = user.token;
const page = await ctx.newPage();
let net = [];
page.on('response', res => { const u = res.url(); if (u.includes('/api/') && res.status() >= 400) net.push(`${res.status()} ${res.request().method()} ${u.replace(BASE,'')}`); });
page.on('pageerror', e => console.log('  [PAGEERROR]', e.message));
page.on('console', m => { if (m.type()==='error') { const t=m.text(); if(!/net::|Failed to load resource/.test(t)) console.log('  [console]', t.slice(0,200)); } });
await page.goto(BASE);
await page.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [TOKEN, user]);
const api = async (p) => { const res = await fetch(`${BASE}${p}`, { headers: { Authorization: 'Bearer ' + TOKEN } }); let j=null; try{j=await res.json();}catch{} return { status: res.status, body: j }; };
const props = await api('/api/properties');
const plist = Array.isArray(props.body) ? props.body : (props.body?.properties || props.body?.data || []);
const bw = plist.find(p => /bluewater/i.test(p.name||''));
console.log('[fixture] bluewater', bw?.id, bw?.name, '| properties:', plist.map(p=>p.name).join(' / '));
const ROUTES = ['/', '/messages', '/deals', '/tasks', '/news', '/available', '/properties', '/brands', '/requirements', `/property/${bw?.id}`];
for (const rt of ROUTES) {
  net = [];
  await page.goto(`${BASE}${rt}`, { waitUntil: 'domcontentloaded' }).catch(e=>console.log('  goto err', e.message.slice(0,80)));
  await page.waitForTimeout(6500);
  const txt = (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g,'\n').trim();
  const slug = rt.replace(/\//g,'_') || 'root';
  await page.screenshot({ path: `${SHOT}/r576-phone${slug}.png` });
  const err = await page.locator('text=/Something went wrong|Error boundary|Unexpected error/i').count();
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`\n══ ${rt} ══ err=${err} hscroll=${hscroll}px chars=${txt.length}`);
  console.log(txt.slice(0, 900));
  if (net.length) console.log('  NET>=400: ' + [...new Set(net)].join(' ; '));
}
await browser.close();
