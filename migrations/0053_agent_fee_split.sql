-- The fee split between the agents on a letting (Woody, 2026-11-12: "Fee
-- splits need to be for joint or sole agent"). The joint agent's share of
-- the fee as a percentage; BGP has the rest. Null = not set. Kept on the
-- brief (where the agency basis and the joint agent are) and copied to the
-- unit's deal. Additive and safe to run again.
ALTER TABLE unit_briefs ADD COLUMN IF NOT EXISTS joint_agent_fee_pct real;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS joint_agent_fee_pct real;
