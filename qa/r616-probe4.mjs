import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const q = async (s, p=[]) => (await pool.query(s, p)).rows;
const PID='cccccccc-0000-0000-0000-000000000001';
console.log('asset-brief occ CTE:', JSON.stringify(await q(`
  SELECT DISTINCT co.id, co.name, co.company_type FROM tenancy_schedule_units ts
    JOIN crm_companies co ON co.id = ts.tenant_company_id
      OR lower(co.name) IN (lower(COALESCE(ts.tenant_name,'')), lower(COALESCE(ts.trading_name,'')))
      OR (length(co.name) >= 5 AND lower(COALESCE(ts.tenant_name,'')) LIKE lower(co.name) || ' %')
   WHERE ts.property_id = $1`,[PID])));
console.log('gap occ (leasing_schedule_units):', JSON.stringify(await q(`SELECT DISTINCT tenant_company_id::text AS id, lower(replace(coalesce(tenant_name,''),'''','')) AS name FROM leasing_schedule_units WHERE property_id=$1 AND (tenant_company_id IS NOT NULL OR tenant_name IS NOT NULL)`,[PID])));
await pool.end();
