-- Migration 0025 — normalise legacy "Letting" deal type to canonical "New Letting"
--
-- Background: the WIP-flip dialog on the Letting Tracker was defaulting
-- the new deal's type to "Letting" while every other surface (the Deals
-- board dropdown, kanban colour chips, fee-party resolver, filters)
-- expects the canonical "New Letting". Result: deals flipped from the
-- tracker showed grey chips, missed the New-Letting filter, and broke
-- the auto-counterparty (landlord) rule.
--
-- The four code paths now write "New Letting"; this migration heals any
-- rows that were stamped before the fix.

UPDATE crm_deals
   SET deal_type = 'New Letting'
 WHERE deal_type = 'Letting';
