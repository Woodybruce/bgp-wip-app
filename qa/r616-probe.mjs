import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const q = async (s, p=[]) => (await pool.query(s, p)).rows;
console.log('BLUEWATER TASKS:', JSON.stringify(await q(`SELECT t.id, t.title, t.status, t.due_date, t.linked_property_id, t.user_id, u.email FROM user_tasks t LEFT JOIN users u ON u.id=t.user_id WHERE t.title ILIKE '%Bluewater%'`), null, 1));
await pool.end();
