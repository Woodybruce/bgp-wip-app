-- Migration 0019 — Lease Advisory aligns with the standard deal lifecycle
--
-- Before: pla_matters had bespoke statuses
--   (open | in_negotiation | agreed | settled | closed | on_hold)
--   completely separate from the deal CRM kanban.
--
-- After: pla_matters uses DEAL_STATUS_CODES
--   (REP | NEG | SOL | EXC | COM | WIT | INV)
--   identical to leasing tracker. The matter also auto-creates a backing
--   crm_deals row (handled in server/pla-matters.ts) so lease advisory
--   instructions appear on the same Deal CRM kanban as leasing deals.
--
-- Remap (preserved in legacy_status so we can reverse if needed):
--   open           → REP   (instructed, no movement yet)
--   in_negotiation → NEG   (under negotiation)
--   agreed         → EXC   (terms exchanged, awaiting completion)
--   settled        → COM   (completed)
--   closed         → WIT   (withdrawn / closed)
--   on_hold        → REP   (instructed but paused; no separate code for this)

ALTER TABLE pla_matters ADD COLUMN IF NOT EXISTS legacy_status TEXT;
ALTER TABLE pla_matters ADD COLUMN IF NOT EXISTS deal_id VARCHAR;

UPDATE pla_matters
   SET legacy_status = status,
       status = CASE status
         WHEN 'open'           THEN 'REP'
         WHEN 'in_negotiation' THEN 'NEG'
         WHEN 'agreed'         THEN 'EXC'
         WHEN 'settled'        THEN 'COM'
         WHEN 'closed'         THEN 'WIT'
         WHEN 'on_hold'        THEN 'REP'
         ELSE status
       END
 WHERE status IN ('open','in_negotiation','agreed','settled','closed','on_hold')
   AND legacy_status IS NULL;

CREATE INDEX IF NOT EXISTS pla_matters_deal_idx ON pla_matters (deal_id) WHERE deal_id IS NOT NULL;
