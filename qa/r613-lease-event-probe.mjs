// r613 — is a lease event happening TODAY "Overdue"?
// lease_events.event_date is a TIMESTAMP; the board's own form is
// <Input type="date"> and ChatBGP's tool schema asks for "YYYY-MM-DD",
// so every writer writes a DAY (midnight). Probe the readers.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const PASSWORD = 'B@nd0077!';
const TAG = process.env.TAG || 'r613';

const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const TODAY = iso(today);
const THREE_AGO = iso(new Date(today.getTime() - 3 * 86400000));

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const made = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'en-GB' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
  const H = { Authorization: `Bearer ${user.token}` };
  const api = ctx.request;

  const mk = async (label, dateStr) => {
    const res = await api.post(`${BASE}/api/lease-events`, { headers: H, data: {
      eventType: 'Rent Review', status: 'Monitoring', sourceEvidence: 'Manual',
      address: `QA r613 ${label}, Bluewater`, tenant: `QA r613 ${label} Ltd`,
      eventDate: dateStr,
    }});
    const body = await res.json();
    console.log(`  create ${label} (${dateStr}) -> ${res.status()} id=${body.id || JSON.stringify(body).slice(0,120)}`);
    if (body.id) made.push(body.id);
    return body.id;
  };

  console.log('--- writers write a DAY ---');
  const idToday = await mk('TODAY', TODAY);
  const idPast = await mk('3-DAYS-AGO', THREE_AGO);

  // what actually landed in the column
  const list = await (await api.get(`${BASE}/api/lease-events`, { headers: H })).json();
  for (const id of [idToday, idPast]) {
    const row = list.find((e) => e.id === id);
    console.log(`  stored event_date for ${row?.tenant}: ${row?.eventDate}`);
  }

  console.log('--- READER: server digest urgency ---');
  const digest = await (await api.get(`${BASE}/api/lease-events/digest`, { headers: H })).json();
  for (const id of [idToday, idPast]) {
    const row = digest.find((e) => e.id === id);
    console.log(`  ${row?.tenant} -> urgency=${row?.urgency}`);
  }

  console.log('--- READER: the board in the browser ---');
  const page = await ctx.newPage();
  await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('bgp_auth_token', tok);
    localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);
  await page.goto(`${BASE}/lease-events`).catch(() => {});
  await page.waitForTimeout(4000);
  await page.getByPlaceholder(/search/i).first().fill('QA r613').catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `qa/smoke-shots/${TAG}-lease-events.png`, fullPage: false });

  const kpiOverdue = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('p')];
    const l = labels.find((p) => p.textContent.trim() === 'Overdue');
    return l ? l.parentElement.querySelector('p:last-child')?.textContent.trim() : null;
  });
  console.log(`  KPI tile "Overdue" count element = ${kpiOverdue}`);

  for (const label of ['TODAY', '3-DAYS-AGO']) {
    const badge = await page.evaluate((lab) => {
      const cell = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === `QA r613 ${lab} Ltd`);
      if (!cell) return 'row not found';
      let row = cell; for (let i = 0; i < 8 && row && row.tagName !== 'TR'; i++) row = row.parentElement;
      const t = (row || cell.parentElement).textContent;
      return ['Overdue', '< 3 mo', '< 6 mo', '< 18 mo', 'Future'].find((u) => t.includes(u)) || 'no badge';
    }, label);
    console.log(`  row badge for ${label}: ${badge}`);
  }
} finally {
  // clean up
  const ctx2 = await browser.newContext();
  const r2 = await ctx2.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASSWORD } });
  const u2 = await r2.json();
  for (const id of made) {
    const d = await ctx2.request.delete(`${BASE}/api/lease-events/${id}`, { headers: { Authorization: `Bearer ${u2.token}` } });
    console.log(`  cleanup DELETE ${id} -> ${d.status()}`);
  }
  await browser.close();
}
