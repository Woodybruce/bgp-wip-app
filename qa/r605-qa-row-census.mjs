// r605 — census the "residual QA rows" deferred item: say exactly what is
// left over in the fixture, in which table, and (where the name says so)
// from which scenario. Read-only.
import pg from '../node_modules/pg/lib/index.js';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL
  || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });

// table -> [name column, extra columns to show]
const TARGETS = [
  ['available_units',        'unit_name',   ['marketing_status', 'created_at']],
  ['leasing_schedule_units', 'unit_name',   ['status', 'created_at']],
  ['tenancy_schedule_units', 'unit_name',   ['status', 'created_at']],
  ['crm_deals',              'name',        ['status', 'created_at']],
  ['crm_properties',         'name',        ['created_at']],
  ['crm_companies',          'name',        ['created_at']],
  ['crm_contacts',           'name',        ['created_at']],
  ['requirements',           'title',       ['created_at']],
  ['comparables',            'address',     ['created_at']],
  ['investment_tracker',     'asset_name',  ['status', 'created_at']],
];

const PAT = "(name ~* '^(QA|RU10|Testco)' )";
let total = 0;
for (const [table, nameCol, extras] of TARGETS) {
  let rows;
  try {
    const cols = [nameCol, ...extras].map((c) => `"${c}"`).join(', ');
    rows = (await pool.query(
      `select ${cols} from ${table}
        where "${nameCol}" ~* '(^|[^a-z])(QA[- ]|QA$|RU10|Testco)'
        order by "${nameCol}"`)).rows;
  } catch (e) {
    console.log(`  ${table}: SKIPPED (${e.message.split('\n')[0]})`);
    continue;
  }
  if (!rows.length) continue;
  total += rows.length;
  console.log(`\n${table} — ${rows.length} residual row(s)`);
  for (const r of rows) {
    const rest = extras.map((c) => `${c}=${r[c] instanceof Date ? r[c].toISOString().slice(0, 10) : r[c]}`).join(' ');
    console.log(`  · ${r[nameCol]}   ${rest}`);
  }
}

// investment_tracker property_id orphans (the other half of the deferred item)
const orph = (await pool.query(
  `select count(*)::int n from investment_tracker it
    where it.property_id is not null
      and not exists (select 1 from crm_properties p where p.id = it.property_id)`)).rows[0].n;
const itTotal = (await pool.query('select count(*)::int n from investment_tracker')).rows[0].n;
console.log(`\ninvestment_tracker: ${itTotal} rows, ${orph} with a property_id pointing at no crm_properties row`);

// statuses actually stored on investment_tracker (the UX #304 question)
const st = (await pool.query(
  `select coalesce(status, '<NULL>') s, count(*)::int n
     from investment_tracker group by 1 order by 2 desc`)).rows;
console.log('investment_tracker.status values: ' + st.map((r) => `${r.s}=${r.n}`).join(' · '));

console.log(`\nresidual QA-named rows total: ${total}`);
await pool.end();
