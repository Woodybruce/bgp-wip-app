-- Interest on a Letting Tracker unit can come from an agent as well as a
-- brand (Woody, 2026-11-12: "add agent too as well as brand because they
-- might be interested for a few brands"). The agent firm sits beside the
-- brand on the interest row; an agent asking for several brands is one row
-- per brand, each carrying the agent. Additive and safe to run again.
ALTER TABLE unit_interest ADD COLUMN IF NOT EXISTS agent_company_id varchar;
ALTER TABLE unit_interest ADD COLUMN IF NOT EXISTS agent_company_name text;
