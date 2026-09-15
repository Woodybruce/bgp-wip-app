-- Stripe Issuing card programme + expense tracking

CREATE TABLE IF NOT EXISTS stripe_cardholders (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  stripe_cardholder_id TEXT NOT NULL UNIQUE,
  monthly_limit INTEGER NOT NULL DEFAULT 100000,
  daily_limit INTEGER NOT NULL DEFAULT 25000,
  single_tx_limit INTEGER NOT NULL DEFAULT 25000,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_cards (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  cardholder_id VARCHAR NOT NULL REFERENCES stripe_cardholders(id),
  stripe_card_id TEXT NOT NULL UNIQUE,
  last4 TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  cardholder_id VARCHAR REFERENCES stripe_cardholders(id),
  stripe_transaction_id TEXT UNIQUE,
  type TEXT NOT NULL DEFAULT 'card',
  status TEXT NOT NULL DEFAULT 'pending_receipt',
  merchant TEXT,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'gbp',
  transaction_date TIMESTAMP,
  category TEXT,
  xero_account_code TEXT,
  xero_tracking_property TEXT,
  xero_tracking_person TEXT,
  xero_expense_id TEXT,
  receipt_url TEXT,
  receipt_filename TEXT,
  business_purpose TEXT,
  attendees TEXT,
  calendar_event_id TEXT,
  is_personal BOOLEAN DEFAULT FALSE,
  is_client_rechargeable BOOLEAN DEFAULT FALSE,
  related_deal_id VARCHAR,
  mileage_miles REAL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_receipts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id VARCHAR NOT NULL REFERENCES expenses(id),
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  filename TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_cardholder ON expenses(cardholder_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_expense_receipts_expense ON expense_receipts(expense_id);
