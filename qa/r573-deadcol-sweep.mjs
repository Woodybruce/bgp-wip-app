import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const tables = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).rows.map(r=>r.table_name);
const out = [];
for (const t of tables) {
  const n = (await c.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n;
  if (n === 0) continue;
  const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public'`, [t])).rows.map(r=>r.column_name);
  const parts = cols.map(x => `count("${x}")::int AS "${x}"`).join(',');
  const r = (await c.query(`SELECT ${parts} FROM "${t}"`)).rows[0];
  const dead = Object.entries(r).filter(([,v]) => v===0).map(([k])=>k);
  out.push({ t, n, dead });
}
console.log(JSON.stringify(out, null, 0));
await c.end();
