#!/usr/bin/env node
// Client-isolation audit (r532): reads CLIENT_ALLOWED_API + CLIENT_BLOCKED_SUBPATHS
// out of server/index.ts and lists every id-addressable GET a client login can
// reach whose handler shows no scope helper in its first 70 lines. Run from the
// repo root after any allowlist change; each hit needs a probe, not a guess.
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
    // grab handler body ~ next 60 lines
    const body = lines.slice(i, i+70).join('\n');
    const guards = [];
    // r537: staffOnly (contact-verify.ts style flat staff gate),
    // getChatThreadMembers (the chat thread-membership check in routes.ts)
    // and
    // requestScope/listScope (the scoped-SELECT builders) each cost r536 a
    // wasted probe — both are real guards this audit could not see.
    for (const g of (body.match(/\b(forbids\w+|assert\w+|is\w*Scope\w*|clientBlockedForProperty|checkPropertyAccess|resolveCompanyScope|companyScopeId|clientUnitScopeSql|clientBrandSliceSql|isClientVisibleBrand|isClientRequestUser|requireStaff|isExternalUser|scopeCompanyId|getClientVisibleUserIds|isPropertyInScope|isDealInScope|isContactInScope|chat_thread_members|NO_ACCESS_SCOPE|clientCanReachChatMedia|staffOnly|requestScope|listScope|getChatThreadMembers)\b/g) || []))
      guards.push(g);
    rows.push({file:f, line:i+1, path:p, guards});
  });
}
// Param-addressed routes cover /:id AND /:filename-style params (the flat
// filename namespaces — chat-media, landlord-packs — are the same class and
// were being missed while this only looked for ids). Param-less COLLECTION
// GETs get their own section: /api/crm/leads was firm-wide and client-readable
// for exactly as long as this audit only looked at addressable routes (r535).
const bad = rows.filter(r=>r.guards.length===0);
const addressable = bad.filter(r=>/:/.test(r.path));
const collections = bad.filter(r=>!/:/.test(r.path));
console.log('== param-addressed client-allowed GETs with NO scope helper in first 70 lines:', addressable.length, 'of', rows.filter(r=>/:/.test(r.path)).length);
for(const r of addressable) console.log(`${r.path}   [${r.file}:${r.line}]`);
console.log('\n== param-less client-allowed COLLECTION GETs with NO scope helper (firm-wide list risk):', collections.length, 'of', rows.filter(r=>!/:/.test(r.path)).length);
for(const r of collections) console.log(`${r.path}   [${r.file}:${r.line}]`);
