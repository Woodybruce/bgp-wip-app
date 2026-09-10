import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT status, COUNT(*)::int n, COALESCE(SUM(fee),0)::numeric total,
         COUNT(*) FILTER (WHERE internal_agent IS NOT NULL AND array_length(internal_agent,1) > 0)::int with_agent
    FROM crm_deals
   WHERE fee IS NOT NULL AND fee > 0
   GROUP BY status ORDER BY status`);
console.table(rows);
const { rows: r2 } = await pool.query(`
  SELECT d.status, d.name, d.fee, d.internal_agent,
         COALESCE(d.completed_at, d.exchanged_at, d.target_date, d.instructed_at) AS dt
    FROM crm_deals d
   WHERE d.fee IS NOT NULL AND d.fee > 0
   ORDER BY d.status`);
for (const r of r2) console.log(r.status, '|', r.name, '| £', r.fee, '|', JSON.stringify(r.internal_agent), '|', r.dt);
await pool.end();
