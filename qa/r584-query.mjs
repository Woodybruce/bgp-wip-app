// Read-only query helper for r584 ground truth (no standalone psql per the round rules).
import pg from 'pg';
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const c = new pg.Client({ connectionString: url });
await c.connect();
for (const q of process.argv.slice(2)) {
  const r = await c.query(q);
  console.log('\n-- ' + q.replace(/\s+/g,' ').slice(0,140));
  console.table(r.rows);
}
await c.end();
