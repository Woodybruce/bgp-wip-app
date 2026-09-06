const BASE = 'http://127.0.0.1:5000';
const PASSWORD = 'B@nd0077!';
async function tok(u){
  const r = await fetch(`${BASE}/api/auth/login`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:PASSWORD})});
  const j = await r.json(); return j.token;
}
const paths = [
  '/api/insights',
  '/api/daily-digest',
  '/api/activity-feed',
  '/api/activity-summary',
  '/api/notifications',
  '/api/news-feed/articles',
  '/api/dashboard/stats',
];
const who = process.argv[2] || 'mark.warne@landsec.com';
const t = await tok(who);
for (const p of paths) {
  const r = await fetch(BASE+p, {headers:{Authorization:'Bearer '+t}});
  const txt = await r.text();
  console.log(`\n===== ${p} -> ${r.status} (${txt.length} bytes) =====`);
  console.log(txt.slice(0, 4000));
}
