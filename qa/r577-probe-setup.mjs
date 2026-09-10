// r577: give three fixture deals a fee + internal agent so the /hr Hunger
// Games leaderboards have something to rank. Undo with r577-probe-restore.mjs.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const AGENT = 'Lucy Gardiner';
const rows = [
  ['11110000-0000-0000-0000-000000000301', 50000],  // NEG  Bluewater MSU9
  ['65fb328e-d101-4df6-8fe0-34d9fc6f210e', 60000],  // HOT  Brent Cross QA-HOTS
  ['616296ba-b0a2-4269-af16-8076b736e87a', 40000],  // AVA  Westgate RU10
];
for (const [id, fee] of rows) {
  await pool.query(
    `UPDATE crm_deals SET fee=$2, internal_agent=ARRAY[$3]::text[], target_date=$4 WHERE id=$1`,
    [id, fee, AGENT, '2026-11-01']);
}
const { rows: out } = await pool.query(
  `SELECT status, name, fee, internal_agent FROM crm_deals WHERE id = ANY($1) ORDER BY status`,
  [rows.map(r => r[0])]);
console.table(out);
await pool.end();
