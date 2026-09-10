import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const q = async (s,p=[]) => (await pool.query(s,p)).rows;
const LS='d25ec158-82df-4f50-8188-cae113af5f9f';
console.log('--- contacts mark sees, by company ---');
console.log(await q(`select c.name, c.role, co.name company, co.company_type, (co.id=$1) own
  from crm_contacts c join crm_companies co on co.id=c.company_id
  where co.id=$1 or co.company_type ilike 'Agent%' or co.company_type ilike 'Tenant -%'
  order by own desc, co.name`,[LS]));
console.log('--- landsec user row ---');
console.log(await q(`select username, role, department, team from users where username like 'mark%'`));
await pool.end();
