import fs from 'fs'; import path from 'path';
const idx = fs.readFileSync('server/index.ts','utf8');
function block(name){ const i = idx.indexOf('const '+name+' = ['); const j = idx.indexOf('];', i); return idx.slice(i, j); }
const allowed = [...block('CLIENT_ALLOWED_API').matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const blockedSrc = block('CLIENT_BLOCKED_SUBPATHS');
const blocked = [...blockedSrc.matchAll(/\/\^([^\n]+?)\/,/g)].map(m=>{ try { return new RegExp('^'+m[1]); } catch { return null; } }).filter(Boolean);
const files = fs.readdirSync('server').filter(f=>f.endsWith('.ts'));
const rows=[];
for (const f of files){
  const src = fs.readFileSync(path.join('server',f),'utf8');
  const lines = src.split('\n');
  lines.forEach((ln,i)=>{
    const m = ln.match(/app\.get\(\s*["'`]([^"'`]+)["'`]/);
    if(!m) return;
    const p = m[1];
    if(!p.startsWith('/api/')) return;
    if(!allowed.some(a=>p.startsWith(a))) return;
    // probe path: replace params with a sample so the blocked regexes can match
    const probe = p.replace(/:[A-Za-z0-9_]+/g,'00000000-0000-0000-0000-000000000000');
    if(blocked.some(re=>re.test(probe))) return;
    if(!/:/.test(p)) return; // only id-addressable
    // grab handler body ~ next 60 lines
    const body = lines.slice(i, i+70).join('\n');
    const guards = [];
    for (const g of (body.match(/\b(forbids\w+|assert\w+|is\w*Scope\w*|clientBlockedForProperty|checkPropertyAccess|resolveCompanyScope|companyScopeId|clientUnitScopeSql|clientBrandSliceSql|isClientVisibleBrand|isClientRequestUser|requireStaff|isExternalUser|scopeCompanyId|getClientVisibleUserIds|isPropertyInScope|isDealInScope|isContactInScope)\b/g) || []))
      guards.push(g);
    rows.push({file:f, line:i+1, path:p, guards});
  });
}
const bad = rows.filter(r=>r.guards.length===0);
console.log('== id-addressable client-allowed GETs with NO scope helper in first 70 lines:', bad.length, 'of', rows.length);
for(const r of bad) console.log(`${r.path}   [${r.file}:${r.line}]`);
