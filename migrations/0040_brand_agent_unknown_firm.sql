-- A named agent can represent a brand before their employer is confirmed.
-- This changes no existing representation or contact employment records.
ALTER TABLE brand_agent_representations ALTER COLUMN agent_company_id DROP NOT NULL;
