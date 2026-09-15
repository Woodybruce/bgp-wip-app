const bcrypt = require("bcrypt");
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: "postgresql://postgres:test@127.0.0.1:5432/bgptest" });
  await c.connect();
  const hash = await bcrypt.hash("smoketest123", 10);
  const staff = await c.query(
    `INSERT INTO users (username, password, name, email, team, is_admin, role)
     VALUES ('teststaff', $1, 'Test Staff', 'test-staff@brucegillinghampollard.com', 'London Leasing', true, 'Director')
     ON CONFLICT (username) DO UPDATE SET password = $1 RETURNING id`, [hash]);
  const landsec = await c.query(
    `INSERT INTO crm_companies (name, company_type) VALUES ('Landsec', 'Landlord') RETURNING id`);
  const client = await c.query(
    `INSERT INTO users (username, password, name, email, team, role)
     VALUES ('testclient', $1, 'Test Client', 'mark@landsec-test.example', 'Landsec', 'Client')
     ON CONFLICT (username) DO UPDATE SET password = $1 RETURNING id`, [hash]);
  const prop = await c.query(
    `INSERT INTO crm_properties (name, landlord_id) VALUES ('Westgate Test Centre', $1) RETURNING id`, [landsec.rows[0].id]);
  const ten = await c.query(
    `INSERT INTO tenancy_schedule_units (property_id, unit_number, premises, status, nia_sqft)
     VALUES ($1, 'RU9', '304 Queen Street', 'Vacant', 1683) RETURNING id`, [prop.rows[0].id]);
  await c.query(
    `INSERT INTO available_units (property_id, unit_name, sqft, marketing_status, tenancy_unit_id)
     VALUES ($1, '304 Queen Street (RU9)', 1683, 'Negotiating', $2)`, [prop.rows[0].id, ten.rows[0].id]);
  await c.query(
    `INSERT INTO crm_client_team_members (client_company_id, user_id, team_group)
     VALUES ($1, $2, 'London Leasing')`, [landsec.rows[0].id, staff.rows[0].id]);
  console.log("SEEDED", { staff: staff.rows[0].id, client: client.rows[0].id, landsec: landsec.rows[0].id, prop: prop.rows[0].id });
  await c.end();
})().catch(e => { console.error("SEED-ERR", e.message); process.exit(1); });
