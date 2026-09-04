// Apply a .sql file to the local QA database (bgpsmoke) over TCP.
// Lives in qa/ so `pg` resolves from the repo's node_modules.
import fs from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) { console.error('usage: node qa/apply-sql.mjs <file.sql>'); process.exit(2); }
const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(fs.readFileSync(file, 'utf8'));
  console.log(`[apply-sql] ${file} applied`);
} finally {
  await client.end();
}
