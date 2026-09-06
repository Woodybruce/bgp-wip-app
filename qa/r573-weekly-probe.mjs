import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
console.table((await c.query(`SELECT id, name, email, company_name, weekly_report_enabled FROM crm_contacts WHERE email ILIKE '%landsec%' OR weekly_report_enabled = true`)).rows);
console.table((await c.query(`SELECT d.id, d.name, d.stage, d.status, d.deal_type, d.client_contact_id, ct.name AS contact,
   d.vendor_id, d.purchaser_id, d.landlord_id, d.tenant_id, d.rent_pa, d.pricing
   FROM crm_deals d LEFT JOIN crm_contacts ct ON ct.id=d.client_contact_id
   WHERE d.client_contact_id IS NOT NULL`)).rows);
console.table((await c.query(`SELECT status, count(*)::int n FROM crm_deals GROUP BY status`)).rows);
await c.end();
