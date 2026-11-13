-- "Waiting on" linked to the deal checklist (Woody, 2026-11-13: "on the
-- waiting on I think this is good but needs to be linked to the deal check
-- tasks list"). The deal clock's waiting-on can point at one item on that
-- deal's checklist. When the item is ticked the waiting-on moves to the next
-- required item, or clears. Additive and safe to run again.
ALTER TABLE landsec_deal_clock ADD COLUMN IF NOT EXISTS checklist_item_id varchar;
CREATE INDEX IF NOT EXISTS idx_landsec_deal_clock_checklist_item ON landsec_deal_clock (checklist_item_id) WHERE checklist_item_id IS NOT NULL;
