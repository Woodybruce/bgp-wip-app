-- HR Module tables

CREATE TABLE IF NOT EXISTS staff_profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL UNIQUE,
  title TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  salary_current INTEGER,
  manager_id VARCHAR,
  department TEXT,
  rics_pathway TEXT,
  apc_status TEXT,
  apc_assessment_date TEXT,
  education TEXT,
  bio TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relation TEXT,
  holiday_entitlement INTEGER DEFAULT 25,
  pension_opt_in BOOLEAN DEFAULT true,
  pension_rate REAL DEFAULT 5.0,
  contract_sharepoint_url TEXT,
  passport_sharepoint_url TEXT,
  linkedin_url TEXT,
  xero_tracking_name TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salary_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  salary_pence INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  reason TEXT,
  notes TEXT,
  recorded_by VARCHAR,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holiday_requests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days_count REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  approved_by VARCHAR,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_documents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR,
  doc_type TEXT NOT NULL,
  name TEXT NOT NULL,
  sharepoint_url TEXT,
  sharepoint_drive_id TEXT,
  sharepoint_item_id TEXT,
  review_year INTEGER,
  created_at TIMESTAMP DEFAULT now()
);
