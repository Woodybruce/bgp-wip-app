/**
 * Isolated browser QA for the real evidence-plan UnitPanel.
 * Run: node qa/evidence-unit-summary-fixture.mjs
 * Open: http://127.0.0.1:5123
 * All data and saves exist in browser memory. No app server, credentials,
 * database, AI provider or external network requests are used. Reloading
 * rebuilds the real component and resets the synthetic cases.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import autoprefixer from 'autoprefixer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const component = path.join(root, 'client/src/pages/evidence-plans.tsx');
const port = 5123;
const entry = String.raw`
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { UnitPanel } from '@/pages/evidence-plans';
import { Toaster } from '@/components/ui/toaster';

const PLAN = 'qa-summary-plan';
const KEY = ['/api/evidence-plans', PLAN];
const clone = value => JSON.parse(JSON.stringify(value));
const baseUnit = { id: 'qa-b6', unit_ref: 'B6', tenant_name: 'Hotel Chocolat', level_id: 'qa-upper',
  polygon: [{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}], source: 'manual',
  lease_expiry: null, break_date: null, review_date: null, erv: null, passing_rent: null, sqft: null,
  notes: 'Preserve this original unit note.', ts_linked: false, ts_row_id: null, ts_row_updated_at: null };
const newer = { id: 'qa-renewal', unit_id: 'qa-b6', unit_ref: 'B6', tenant: 'Hotel Chocolat',
  transaction_type: 'Lease renewal', transaction_date: '2027-08-03', size_sqft: '1227',
  zone_a: '0', itza: '400', headline_rent: '50000', net_effective: '45000', term: '5 years',
  concession: 'Six months rent free', notes: 'Synthetic future renewal; do not treat its rent as current passing rent.',
  source_key: null, created_at: '2026-10-02T09:00:00Z' };
const older = { ...newer, id: 'qa-older', transaction_type: 'Rent review', transaction_date: '2023-08-03',
  size_sqft: '1100', headline_rent: '35000', net_effective: '33000', zone_a: '175', itza: '200',
  term: 'Historic review', concession: '', notes: 'Synthetic older evidence with different figures.', created_at: '2023-08-03T09:00:00Z' };
const cases = {
  saved: { title: 'B6 · saved evidence without rent', unit: {...baseUnit, notes: null},
    entries: [{...newer, id: 'qa-saved-b6', headline_rent: null, net_effective: null, zone_a: null,
      size_sqft: '1227', itza: '559', term: '5', transaction_date: '2027-08-03', concession: null, notes: '3m r/f'}], scheduleRows: [] },
  blank: { title: 'B6 · blank current facts', unit: baseUnit, entries: [newer, older], scheduleRows: [] },
  canonical: { title: 'C7 · existing tenancy facts', unit: {...baseUnit, id: 'qa-c7', unit_ref: 'C7', tenant_name: 'QA Current Tenant',
    lease_expiry: '2031-09-30', break_date: '2029-09-30', review_date: '2028-09-30', erv: '32000', passing_rent: '28000', sqft: '900',
    notes: 'Keep canonical dates, ERV and this note when transferring evidence figures.', ts_linked: true,
    ts_row_id: 'qa-schedule-c7', tenancy_unit_id: 'qa-schedule-c7', ts_row_updated_at: '2026-10-01T10:00:00.000Z'},
    entries: [{...newer, id:'qa-c7-renewal', unit_id:'qa-c7',unit_ref:'C7',tenant:'QA Current Tenant'},
      {...older,id:'qa-c7-older',unit_id:'qa-c7',unit_ref:'C7',tenant:'QA Current Tenant'}],
    scheduleRows: [{id:'qa-schedule-c7',unit_number:'C7',trading_name:'QA Current Tenant',tenant_name:'QA Current Tenant Ltd',
      passing_rent_pa:'28000',nia_sqft:'900',lease_expiry:'2031-09-30',break_date:'2029-09-30',next_review_date:'2028-09-30',erv_pa:'32000',updated_at:'2026-10-01T10:00:00.000Z'}] },
  zero: { title: 'D8 · zero figures', unit: {...baseUnit,id:'qa-d8',unit_ref:'D8',tenant_name:'QA Zero',passing_rent:'0',erv:'0',sqft:'0'},
    entries:[{...newer,id:'qa-zero',unit_id:'qa-d8',unit_ref:'D8',tenant:'QA Zero',size_sqft:'0',headline_rent:'0',net_effective:'0',zone_a:'0',itza:'0'}],scheduleRows:[] },
  empty: { title: 'E9 · no evidence', unit: {...baseUnit,id:'qa-e9',unit_ref:'E9',tenant_name:'QA Empty'},entries:[],scheduleRows:[] },
};
let active = 'blank';
let data = clone(cases[active]);
let writes = [];
let attempts = [];
let fail = false;
let announce = () => {};
const fieldMap = {unitRef:'unit_ref',tenantName:'tenant_name',leaseExpiry:'lease_expiry',breakDate:'break_date',reviewDate:'review_date',
  erv:'erv',passingRent:'passing_rent',sqft:'sqft',notes:'notes'};
const evidenceMap = {unitId:'unit_id',unitRef:'unit_ref',tenant:'tenant',transactionType:'transaction_type',transactionDate:'transaction_date',
  sizeSqft:'size_sqft',zoneA:'zone_a',itza:'itza',headlineRent:'headline_rent',netEffective:'net_effective',term:'term',concession:'concession',notes:'notes'};
const update = () => {queryClient.setQueryData(KEY, clone(data));announce();};
const attempt = (kind, patch) => {attempts.push({kind,patch:clone(patch)});announce();};
window.__evidenceFixtureRequest = async (method, url, patch) => {
  if (!/^\/api\/evidence-plans\/(?:entries\/qa-[a-z0-9-]+|qa-summary-plan\/entries)$/.test(url)) {
    throw new Error('This isolated fixture blocks that action; no request was sent.');
  }
  attempt('evidence ' + method, patch || {url});
  if (fail) throw new Error('Simulated save failure. Your changes have not been saved.');
  const id = url.split('/').pop();
  if (method === 'DELETE') data.entries = data.entries.filter(item => item.id !== id);
  else if (method === 'POST' || method === 'PUT') {
    const mapped = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => key in evidenceMap).map(([key,value]) => [evidenceMap[key], value === '' ? null : value]));
    if (method === 'PUT') data.entries = data.entries.map(item => item.id === id ? {...item,...mapped} : item);
    else data.entries.unshift({...newer,...mapped,id:'qa-added-' + Date.now(),created_at:new Date().toISOString()});
  } else throw new Error('This method is not part of the synthetic fixture.');
  writes.push({kind:'evidence ' + method,patch:clone(patch || {url})});
  update();
  return new Response(JSON.stringify({ok:true}), {status:200,headers:{'Content-Type':'application/json'}});
};
// Even a component that bypasses apiRequest cannot reach another service.
window.fetch = async () => {throw new Error('Network access is disabled in the isolated QA fixture.');};

function App() {
  const [caseId, setCaseId] = useState(active);
  const [revision, setRevision] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const [closed, setClosed] = useState(false);
  const [failSaves, setFailSaves] = useState(false);
  const [message, setMessage] = useState('');
  const [, refresh] = useState(0);
  announce = () => refresh(value => value + 1);
  const result = useQuery({queryKey:KEY,queryFn:async()=>clone(data),initialData:()=>clone(data),staleTime:Infinity});
  const current = result.data;
  const reset = (next=caseId) => {
    active=next;data=clone(cases[next]);writes=[];attempts=[];fail=false;setFailSaves(false);
    setCaseId(next);setClosed(false);setMessage('');setRevision(value=>value+1);update();
  };
  const save = async patch => {
    attempt('unit facts',patch);
    await new Promise(resolve=>setTimeout(resolve,200));
    if (fail) throw new Error('Simulated save failure. Your changes have not been saved.');
    for (const [key,value] of Object.entries(patch)) if (key in fieldMap) data.unit[fieldMap[key]] = value === '' ? null : value;
    writes.push({kind:'unit facts',patch:clone(patch)});update();
    return clone(data.unit);
  };
  return <main className="fixture-shell">
    <header className="fixture-heading">
      <h1>Evidence → unit summary</h1>
      <p>Isolated QA · real app component · synthetic data · nothing is sent or saved to BGP.</p>
    </header>
    <section className="fixture-controls" aria-label="QA controls">
      <label>Test case <select aria-label="Test case" value={caseId} onChange={event=>reset(event.target.value)}>{Object.entries(cases).map(([key,item])=><option key={key} value={key}>{item.title}</option>)}</select></label>
      <button onClick={()=>reset()}>Reset case</button>
      <button onClick={()=>setNarrow(value=>!value)}>{narrow?'Desktop panel':'Phone width'}</button>
      <label><input type="checkbox" checked={failSaves} onChange={event=>{fail=event.target.checked;setFailSaves(fail);}}/> Fail saves</label>
      <button onClick={()=>{data.entries=data.entries.slice(1);update();}}>Remove newest evidence</button>
      <button onClick={()=>{data.entries=[];update();}}>Remove all evidence</button>
      {closed&&<button onClick={()=>setClosed(false)}>Reopen unit</button>}
    </section>
    <div className="fixture-layout">
      <section className={'fixture-panel ' + (narrow?'fixture-phone':'')} aria-label="Real unit panel">
        {!closed?<UnitPanel key={caseId+'-'+revision} unit={current.unit} entries={current.entries} planId={PLAN}
          matters={[]} scheduleRows={current.scheduleRows} onReviewScan={()=>setMessage('Boundary actions are outside this fixture.')}
          onClose={()=>setClosed(true)} onSave={save} onDeleted={()=>{setClosed(true);setMessage('Synthetic unit hidden; reset to restore.');}}
          onRedraw={()=>setMessage('Boundary actions are outside this fixture.')}/>:<p className="p-4">Unit closed. Use Reopen unit above.</p>}
      </section>
      <aside className="fixture-audit" aria-label="Fixture audit">
        <h2>Save audit</h2>
        <p role="status" data-testid="fixture-save-count">Successful saves: {writes.length} · Save attempts: {attempts.length}</p>
        <p>Opening a review or an edit form, and cancelling, must leave both counts at zero.</p>
        {message&&<p role="status">{message}</p>}
        <h3>Saved patches</h3><pre data-testid="fixture-saved-patches">{JSON.stringify(writes,null,2)}</pre>
        <h3>Current unit facts</h3><pre data-testid="fixture-current-unit">{JSON.stringify(current.unit,null,2)}</pre>
        <details><summary>Save attempts</summary><pre data-testid="fixture-save-attempts">{JSON.stringify(attempts,null,2)}</pre></details>
        <details><summary>Suggested checks</summary><ol>
          <li>Saved B6 shows 1,227 sq ft, ITZA 559, term 5 and notes 3m r/f. No annual rent or ZA was saved: the UI must explain the missing rent and must not invent it.</li>
          <li>The synthetic blank-facts B6 case shows 1,227 sq ft and £50,000 in its latest-evidence summary. Current passing rent and lease dates remain distinct.</li>
          <li>Select the older evidence: 1,100 sq ft and £35,000 must replace the selected summary.</li>
          <li>Review figures into Edit. No save should occur before Save. Cancel should preserve the unit.</li>
          <li>Enable Fail saves. The edit stays open, values remain available, and no successful save is recorded.</li>
          <li>Use C7 to check existing dates, ERV, notes and schedule metadata survive a selective promotion.</li>
          <li>Edit evidence and save: the summary should refresh. Delete or remove evidence: selection must recover.</li>
          <li>D8 checks real zero values. E9 checks the empty state. Phone width checks wrapping.</li>
        </ol></details>
      </aside>
    </div>
    <Toaster />
  </main>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><App/></QueryClientProvider>);
`;

const mockQueryClient = `
import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,staleTime:Infinity}}});
export function getAuthHeaders(){return {};}
export function apiRequest(method,url,data){return window.__evidenceFixtureRequest(method,url,data);}
`;

async function javascript() {
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: entry, resolveDir: root, sourcefile: 'qa-evidence-summary-entry.tsx', loader: 'tsx' },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"development"'},
    plugins: [{name:'isolated-unit-panel',setup(builder){
      builder.onResolve({filter:/^@\/lib\/queryClient$/},()=>({path:'fixture-query-client',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mockQueryClient,loader:'js',resolveDir:root}));
      builder.onLoad({filter:/[\\/]pages[\\/]evidence-plans\.tsx$/},async args=>{
        if (args.path !== component) return;
        return {contents:(await readFile(component,'utf8'))+'\nexport { UnitPanel };\n',loader:'tsx',resolveDir:path.dirname(component)};
      });
    }}],
  });
  return result.outputFiles[0].contents;
}

async function stylesheet() {
  const config = loadConfig(path.join(root,'tailwind.config.ts'));
  config.content = [path.join(root,'client/index.html'),path.join(root,'client/src/**/*.{js,jsx,ts,tsx}'),
    path.join(root,'shared/**/*.{js,ts}'),{raw:entry,extension:'tsx'}];
  const result = await postcss([tailwindcss(config),autoprefixer]).process(await readFile(path.join(root,'client/src/index.css'),'utf8'),{from:path.join(root,'client/src/index.css')});
  return result.css + `
.fixture-shell{padding:24px;max-width:1320px;margin:auto}.fixture-heading h1{font-size:24px;font-weight:700}.fixture-heading p{margin:8px 0 20px;color:hsl(var(--muted-foreground))}
.fixture-controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px;border:1px solid hsl(var(--border));border-radius:8px;margin-bottom:20px}
.fixture-controls button,.fixture-controls select{border:1px solid hsl(var(--border));border-radius:6px;background:hsl(var(--background));padding:8px 12px;min-height:42px;font-size:14px}
.fixture-controls label{display:flex;gap:8px;align-items:center}.fixture-layout{display:flex;align-items:flex-start;gap:28px;flex-wrap:wrap}.fixture-panel{width:440px;max-width:100%;flex-shrink:0;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--background));overflow:hidden}
.fixture-panel.fixture-phone{width:360px}.fixture-audit{min-width:0;flex:1;max-width:640px}.fixture-audit h2{font-size:20px;font-weight:700}.fixture-audit h3{font-size:15px;font-weight:600;margin:16px 0 8px}.fixture-audit p{font-size:13px;margin:8px 0}.fixture-audit pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.5;background:hsl(var(--muted));border-radius:8px;padding:12px}.fixture-audit details{margin:12px 0}.fixture-audit ol{list-style:decimal;margin-left:24px;font-size:13px}.fixture-audit li{margin:8px 0}
@media(max-width:640px){.fixture-shell{padding:12px}.fixture-heading h1{font-size:21px}.fixture-controls{padding:10px;gap:8px}.fixture-panel,.fixture-panel.fixture-phone{width:100%}.fixture-audit{flex-basis:100%}}
`;
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated evidence summary QA</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;

// A real nested viewport exercises media queries and keeps dialog portals
// inside the phone, even when the automation surface ignores viewport sizing.
function phoneHtml(requestedWidth) {
  const widths = [320, 360, 390, 414, 430];
  const width = widths.includes(Number(requestedWidth)) ? Number(requestedWidth) : 390;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phone evidence summary QA</title>
    <style>body{margin:24px;background:#ebe9e6;color:#24211f;font:14px system-ui,sans-serif}h1{font-size:22px;margin:0 0 8px}p{max-width:640px;line-height:1.5}form{display:flex;align-items:center;gap:10px;margin:16px 0}select,button,a{font:inherit}select,button{padding:8px;border:1px solid #bab5ae;border-radius:6px;background:white}iframe{display:block;width:${width}px;height:844px;border:0;background:white;border-radius:14px;box-shadow:0 0 0 1px #aba6a0,0 8px 24px #0002}</style>
    </head><body><h1>Phone evidence summary QA</h1><p>Real ${width} × 844 CSS-pixel viewport. Dialogs stay inside the phone. All data remains synthetic and local.</p>
    <form action="/phone" method="get"><label for="phone-width">Phone width</label><select id="phone-width" name="width">${widths.map(value=>`<option value="${value}"${value===width?' selected':''}>${value} pixels</option>`).join('')}</select><button type="submit">Apply width</button><a href="/">Desktop fixture</a></form>
    <iframe id="summary-phone" title="Phone evidence summary" src="/" width="${width}" height="844"></iframe></body></html>`;
}

// Check bundling up front; assets are rebuilt on reload so ongoing UI edits
// can be tested without restarting this fixture process.
await javascript();
const server = createServer(async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'GET') {res.writeHead(405).end('No mutations are accepted by this fixture server.');return;}
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/phone') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(phoneHtml(url.searchParams.get('width')));return;}
    if (url.pathname === '/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    if (url.pathname === '/fixture.js') {res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await javascript());return;}
    if (url.pathname === '/fixture.css') {res.setHeader('Content-Type','text/css; charset=utf-8');res.end(await stylesheet());return;}
    if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname)) {res.setHeader('Content-Type','font/woff2');res.end(await readFile(path.join(root,'client/public',url.pathname)));return;}
    res.writeHead(404).end('Only isolated fixture assets are available.');
  } catch (error) {console.error(error);res.writeHead(500).end('Fixture build failed; inspect the local fixture terminal.');}
});
if (process.argv.includes('--check')) {
  const css = await stylesheet();
  if (!css.includes('@font-face') || !css.includes('.text-sm')) throw new Error('Real component styles were not built');
  console.log('Fixture bundle and real stylesheet compiled. No server started.');
} else {
  server.listen(port,'127.0.0.1',()=>console.log('Synthetic evidence summary fixture: http://127.0.0.1:'+port+' (memory only; no external calls)'));
}
