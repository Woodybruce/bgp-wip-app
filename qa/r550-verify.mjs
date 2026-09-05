// r550 verification — the tenancy schedule's unexpired-term columns say their
// unit, and the Excel export agrees with the board for the same lease.
import { chromium } from '../node_modules/playwright/index.mjs';
import { writeFileSync } from 'fs';
const BASE='http://localhost:5000'; const TAG=process.env.QA_TAG||'r550v';
const PID='cccccccc-0000-0000-0000-000000000001';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
try{
  const ctx = await browser.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
  const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
  const user = await r.json();
  const H={Authorization:`Bearer ${user.token}`};

  // A) board rows
  const api = await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}`,{headers:H});
  const arr = await api.json();
  const byUnit = new Map(arr.map(u=>[String(u.unit_number||'').trim(), u]));

  // B) export
  const ex = await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}/export-excel`,{headers:H});
  console.log('export', ex.status(), (await ex.body()).length, 'bytes');
  const buf = await ex.body();
  writeFileSync('/tmp/claude-0/ts2.xlsx', buf);
  const XLSX = await import('../node_modules/xlsx/xlsx.mjs');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
  const hdr = rows[3];
  console.log('headers:', hdr.slice(13,18).join(' | '));
  const ci = { unit:hdr.indexOf('Unit'), tm:hdr.indexOf('Term (yrs)'), ub:hdr.indexOf('Unexp. Term (Break, mths)'), ue:hdr.indexOf('Unexp. Term (Expiry, mths)') };
  let checked=0, bad=0;
  for (const row of rows.slice(4)) {
    const u = String(row[ci.unit]||'').trim(); if (!u) continue;
    const b = byUnit.get(u); if (!b) continue;
    checked++;
    const same = (x,y)=> (x==null&&y==null) || Number(x)===Number(y);
    if (!same(row[ci.ue], b.unexpired_term) || !same(row[ci.tm], b.term_years)) {
      if (bad<6) console.log(`  MISMATCH ${u}: xlsx term=${row[ci.tm]} unexp=${row[ci.ue]} | board term=${b.term_years} unexp=${b.unexpired_term}`);
      bad++;
    }
  }
  console.log(`cross-check: ${checked} units compared, ${bad} mismatched`);
  const tot = rows[rows.length-1];
  console.log('TOTAL row term/unexp cells:', JSON.stringify([tot[ci.tm],tot[ci.ub],tot[ci.ue]]));

  // C) the board header, on screen
  const page = await ctx.newPage();
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user]);
  await page.goto(`${BASE}/tenancy-schedule/${PID}`,{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(3000);
  await page.locator('[data-testid="tenancy-search"]').fill('Nando');
  await page.waitForTimeout(1500);
  const shown = await page.evaluate(()=>{
    const heads=[...document.querySelectorAll('table thead tr')].pop();
    const cols=[...heads.querySelectorAll('th')].map(t=>t.innerText.replace(/\s+/g,' ').trim());
    const want=['Unit','Expiry','Term (yrs)','Unexp (Break) mths','Unexp (Expiry) mths'];
    const idx=want.map(w=>cols.indexOf(w));
    return { cols: cols.slice(cols.indexOf('Expiry'), cols.indexOf('Expiry')+5),
      rows:[...document.querySelectorAll('table tbody tr')].map(tr=>{const c=[...tr.querySelectorAll('td')].map(td=>td.innerText.replace(/\s+/g,' ').trim());
        return want.map((w,i)=>`${w}=${idx[i]>=0?c[idx[i]]:'??'}`).join(' · ');}) };
  });
  console.log('board header slice:', JSON.stringify(shown.cols));
  shown.rows.forEach(x=>console.log('  '+x));
  console.log('overflow', await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-window.innerWidth)));
  await page.screenshot({path:`qa/smoke-shots/${TAG}-01-unexp-labelled.png`});
  console.log('shot qa/smoke-shots/'+TAG+'-01-unexp-labelled.png');
} finally { await browser.close(); }
