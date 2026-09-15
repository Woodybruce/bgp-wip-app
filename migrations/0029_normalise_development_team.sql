-- Collapse legacy team label 'Development Re-Purposing' (and minor variants)
-- into the canonical 'Development' team from shared/lib/crm-options.ts:157.
--
-- crm_deals.team is text[] — use array_replace to swap matching elements
-- in place without touching other team values in the same row.

UPDATE crm_deals
   SET team = array_replace(team, 'Development Re-Purposing', 'Development')
 WHERE 'Development Re-Purposing' = ANY(team);

UPDATE crm_deals
   SET team = array_replace(team, 'Development Re-purposing', 'Development')
 WHERE 'Development Re-purposing' = ANY(team);

UPDATE crm_deals
   SET team = array_replace(team, 'Development / Re-purposing', 'Development')
 WHERE 'Development / Re-purposing' = ANY(team);

UPDATE crm_deals
   SET team = array_replace(team, 'Development & Re-purposing', 'Development')
 WHERE 'Development & Re-purposing' = ANY(team);

-- De-dupe within rows in case 'Development' was also already present —
-- the array_replace above could now have two identical entries.
UPDATE crm_deals
   SET team = ARRAY(SELECT DISTINCT unnest(team))
 WHERE team IS NOT NULL
   AND (SELECT COUNT(*) FROM unnest(team) AS x) <> (SELECT COUNT(DISTINCT x) FROM unnest(team) AS x);
