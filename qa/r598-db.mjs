import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const q = async (s,p=[]) => (await pool.query(s,p)).rows;
console.log('leasing reqs total:', (await q('select count(*) c from crm_requirements_leasing'))[0].c);
console.log(await q(`select id, name, status, company_id, sources from crm_requirements_leasing order by name limit 20`));
console.log('landsec company:', await q(`select id,name from crm_companies where name ilike '%landsec%'`));
console.log('mark company scope:', await q(`select u.username, u.company_scope_id from users u where u.username like 'mark%'`).catch(e=>e.message));
await pool.end();
