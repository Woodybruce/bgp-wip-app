import pg from 'pg';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const c = new pg.Client({connectionString:url}); await c.connect();
const q = process.argv[2];
const r = await c.query(q);
console.log(JSON.stringify(r.rows, null, 1));
await c.end();
