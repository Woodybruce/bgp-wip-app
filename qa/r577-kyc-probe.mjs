import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT id, name, status, kyc_approved, landlord_id IS NOT NULL AS has_ll
    FROM crm_deals ORDER BY name`);
console.table(rows);
await pool.end();
