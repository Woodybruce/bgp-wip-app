// Remove everything the r595 probes create, across all five projections.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
await c.connect();
const like = `%QA-R595%`;
for (const [t, col] of [['available_units','unit_name'], ['leasing_schedule_units','unit_name'], ['tenancy_schedule_units','unit_number'], ['property_units','unit_name'], ['crm_deals','name']]) {
  const r = await c.query(`DELETE FROM ${t} WHERE ${col} LIKE $1`, [like]);
  console.log(`  ${t}: ${r.rowCount} removed`);
}
await c.end();
