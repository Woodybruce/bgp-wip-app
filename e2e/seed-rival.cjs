// Seeds a rival landlord's records so the security spec can assert a Landsec
// client can reach none of them. Idempotent. Run against the CI test DB
// before e2e/audit-landsec-security.spec.ts.
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = (sql, args) => c.query(sql, args).catch((e) => console.warn("[seed-rival]", e.message));
  await q(`INSERT INTO crm_companies (id, name, company_type) VALUES ('11111111-1111-1111-1111-111111111111','British Land Rival','Landlord') ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO crm_properties (id, name, landlord_id) VALUES ('22222222-2222-2222-2222-222222222222','Broadgate (Rival)','11111111-1111-1111-1111-111111111111') ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO crm_contacts (id, name, email) VALUES ('33333333-3333-3333-3333-333333333333','Rival Secret Contact','secret@britishland.example') ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO crm_deals (id, name, property_id, landlord_id, status, fee) VALUES ('44444444-4444-4444-4444-444444444444','Broadgate Secret Deal','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','NEG',250000) ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO available_units (id, property_id, unit_name, marketing_status, fee) VALUES ('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','Rival Unit A','AVA',99000) ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO unit_marketing_files (id, unit_id, file_name, file_path, file_type) SELECT gen_random_uuid(),'55555555-5555-5555-5555-555555555555','RIVAL-CONFIDENTIAL.pdf','/uploads/x.pdf','upload' WHERE NOT EXISTS (SELECT 1 FROM unit_marketing_files WHERE file_name='RIVAL-CONFIDENTIAL.pdf')`);
  console.log("[seed-rival] done");
  await c.end();
})();
