// CDD records outlive deletes and merges (Reg 40: 5 years after the
// relationship ends). A deleted/merged deal or company with AML history
// is archived here first.
//
// One function serves both tables, so each table's test reads the deleted
// row as JSON: a direct OLD.<column> reference fails on whichever table
// lacks that column, and the handler below would turn that into a warning
// with nothing archived (which is what happened from 2026-09-23 until this
// was rewritten on 2026-11-12).
export const AML_RETENTION_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS aml_retention_archive (
     id SERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_id VARCHAR NOT NULL, data JSONB NOT NULL,
     reason TEXT, archived_by TEXT, archived_at TIMESTAMP DEFAULT now(), retain_until TIMESTAMP)`,
  `CREATE OR REPLACE FUNCTION aml_retain_on_delete() RETURNS trigger AS $$
   DECLARE
     r jsonb;
     keep boolean := false;
   BEGIN
     BEGIN
       r := to_jsonb(OLD);
       IF TG_TABLE_NAME = 'crm_companies' THEN
         keep := r->>'kyc_status' IS NOT NULL OR r->>'aml_checklist' IS NOT NULL
           OR COALESCE(r->>'companies_house_number', '') <> ''
           OR EXISTS (SELECT 1 FROM kyc_documents WHERE company_id = r->>'id')
           OR EXISTS (SELECT 1 FROM kyc_investigations WHERE crm_company_id = r->>'id');
       ELSIF TG_TABLE_NAME = 'crm_deals' THEN
         keep := (r->>'kyc_approved')::boolean IS TRUE OR r->>'aml_check_completed' IS NOT NULL
           OR r->>'status' IN ('SOL','EXC','COM','INV','Exchanged','Completed','Invoiced')
           OR EXISTS (SELECT 1 FROM deal_events WHERE deal_id = r->>'id' AND event_type IN ('kyc_orchestrator_run','aml_gate_warning'));
       END IF;
       IF keep THEN
         INSERT INTO aml_retention_archive (entity_type, entity_id, data, reason, archived_by, retain_until)
         VALUES (TG_TABLE_NAME, r->>'id', r, 'deleted or merged', current_user, now() + interval '5 years');
       END IF;
     EXCEPTION WHEN others THEN
       RAISE WARNING 'aml_retain_on_delete: %', SQLERRM;
     END;
     RETURN OLD;
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS aml_retain_companies ON crm_companies`,
  `CREATE TRIGGER aml_retain_companies BEFORE DELETE ON crm_companies FOR EACH ROW EXECUTE FUNCTION aml_retain_on_delete()`,
  `DROP TRIGGER IF EXISTS aml_retain_deals ON crm_deals`,
  `CREATE TRIGGER aml_retain_deals BEFORE DELETE ON crm_deals FOR EACH ROW EXECUTE FUNCTION aml_retain_on_delete()`,
];
