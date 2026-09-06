import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
console.table((await c.query(`SELECT id, name, status, stage, deal_type, rent_pa, pricing, landlord_id IS NOT NULL AS has_ll, tenant_id IS NOT NULL AS has_ten, vendor_id IS NOT NULL AS has_vend, purchaser_id IS NOT NULL AS has_purch, completed_at FROM crm_deals ORDER BY name`)).rows);
await c.end();
