// r551 — the real staff task: download the rent roll, re-upload it.
// Does the schedule survive its own export?
import { chromium } from '../node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'fs';
const BASE='http://localhost:5000';
const PID='cccccccc-0000-0000-0000-000000000001';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
try{
  const ctx = await browser.newContext();
  const r = await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'}});
  const user = await r.json();
  const H={Authorization:`Bearer ${user.token}`};

  const before = await (await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}`,{headers:H})).json();
  const AREA=['gia_sqft','nia_sqft','itza_sqft','area_ground_gia','area_basement_gia','area_first_gia','area_other_gia','area_ground_nia','area_basement_nia','area_first_nia','area_first_sales_nia','area_other_nia'];
  const filled = f => before.filter(u=>u[f]!=null && u[f]!=='' && Number(u[f])!==0).length;
  console.log('BEFORE rows:', before.length);
  console.log('BEFORE areas filled:', AREA.map(f=>`${f}=${filled(f)}`).join(' '));
  console.log('BEFORE break_details filled:', before.filter(u=>u.break_details).length);
  const sample = before.find(u=>u.nia_sqft && u.tenant_name);
  console.log('SAMPLE', sample?.unit_number, sample?.tenant_name, 'nia', sample?.nia_sqft, 'gia', sample?.gia_sqft, 'itza', sample?.itza_sqft);

  const ex = await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}/export-excel`,{headers:H});
  const buf = await ex.body();
  writeFileSync('/tmp/claude-0/r551-rr.xlsx', buf);
  console.log('export', ex.status(), buf.length, 'bytes');

  // Re-upload exactly what the browser downloaded — the UI's own flow.
  const up = await ctx.request.post(`${BASE}/api/tenancy-schedule/import-excel`,{
    headers:H,
    multipart:{
      file:{name:'Bluewater_Tenancy_Schedule.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync('/tmp/claude-0/r551-rr.xlsx')},
      propertyId: PID,
      clearExisting: 'true',
    }});
  const res = await up.json();
  console.log('IMPORT status', up.status());
  console.log('IMPORT message:', res.message);
  console.log('IMPORT unmatchedHeaders:', JSON.stringify(res.unmatchedHeaders));

  const after = await (await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}`,{headers:H})).json();
  const filledA = f => after.filter(u=>u[f]!=null && u[f]!=='' && Number(u[f])!==0).length;
  console.log('AFTER rows:', after.length);
  console.log('AFTER areas filled:', AREA.map(f=>`${f}=${filledA(f)}`).join(' '));
  console.log('AFTER break_details filled:', after.filter(u=>u.break_details).length);
  const s2 = after.find(u=>String(u.unit_number||'')===String(sample?.unit_number||''));
  console.log('SAMPLE AFTER', s2?.unit_number, s2?.tenant_name, 'nia', s2?.nia_sqft, 'gia', s2?.gia_sqft, 'itza', s2?.itza_sqft);
  const totalRow = after.filter(u=>/^total$/i.test(String(u.tenant_name||'').trim()));
  console.log('PHANTOM TOTAL rows:', totalRow.length, totalRow.map(t=>({unit:t.unit_number, rent:t.passing_rent_pa, nia:t.nia_sqft, erv:t.erv_pa, noi:t.noi_pa, status:t.status})));
} finally { await browser.close(); }
