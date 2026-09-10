import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const q = async (s,p=[]) => (await pool.query(s,p)).rows;
console.log(await q(`select c.id, c.name, c.role, co.name company, co.company_type from crm_contacts c join crm_companies co on co.id=c.company_id where c.name in ('Alex Agentson','Tom Barista','Sam Tester','Maria Portfolio')`));
await pool.end();
