import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
for (const q of JSON.parse(process.env.QA_Q)) {
  const r = await c.query(q);
  console.log('--', q.slice(0,110));
  console.table(r.rows.slice(0, 25));
}
await c.end();
