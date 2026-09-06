import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const p = (await c.query(`SELECT p.id, p.name, p.landlord_id, p.freeholder_id, p.long_leaseholder_id,
  l.name AS landlord, f.name AS freeholder FROM crm_properties p
  LEFT JOIN crm_companies l ON l.id=p.landlord_id
  LEFT JOIN crm_companies f ON f.id=p.freeholder_id`)).rows;
console.table(p);
const link = (await c.query(`SELECT count(*)::int n FROM crm_company_properties`)).rows[0];
console.log('crm_company_properties rows:', link.n);
const comp = (await c.query(`SELECT id, name, company_type FROM crm_companies WHERE company_type ILIKE '%landlord%' OR company_type ILIKE '%investor%' OR company_type ILIKE '%developer%' OR company_type ILIKE '%fund%'`)).rows;
console.table(comp);
await c.end();
