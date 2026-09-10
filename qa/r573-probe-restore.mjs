import fs from 'node:fs';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
for (const r of JSON.parse(fs.readFileSync('/tmp/r573-restore.json','utf8'))) {
  await c.query(`UPDATE crm_deals SET status=$1, client_contact_id=$2 WHERE id=$3`, [r.status, r.client_contact_id, r.id]);
}
console.table((await c.query(`SELECT id, name, status, client_contact_id FROM crm_deals WHERE id IN ('11110000-0000-0000-0000-000000000301','11110000-0000-0000-0000-000000000302','11110000-0000-0000-0000-000000000303')`)).rows);
await c.end();
