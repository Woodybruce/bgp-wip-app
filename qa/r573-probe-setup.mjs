// r573 probe: give one contact a mixed bag of deals so the weekly-update PDF
// has something to headline. Records the originals to /tmp/r573-restore.json.
import fs from 'node:fs';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const IDS = ['11110000-0000-0000-0000-000000000301','11110000-0000-0000-0000-000000000302','11110000-0000-0000-0000-000000000303'];
const CONTACT = '11110000-0000-0000-0000-000000000101'; // Maria Portfolio (Landsec)
const before = (await c.query(`SELECT id, status, client_contact_id FROM crm_deals WHERE id = ANY($1::varchar[])`, [IDS])).rows;
fs.writeFileSync('/tmp/r573-restore.json', JSON.stringify(before, null, 1));
console.log('saved originals:', JSON.stringify(before));
await c.query(`UPDATE crm_deals SET client_contact_id=$1 WHERE id = ANY($2::varchar[])`, [CONTACT, IDS]);
await c.query(`UPDATE crm_deals SET status='COM' WHERE id=$1`, [IDS[2]]);
await c.query(`UPDATE crm_deals SET status='WIT' WHERE id=$1`, [IDS[1]]);
console.table((await c.query(`SELECT id, name, status FROM crm_deals WHERE client_contact_id=$1`, [CONTACT])).rows);
await c.end();
