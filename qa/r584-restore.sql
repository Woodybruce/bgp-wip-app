-- r584 fixture restore: sweep the probe rows this round's journey and
-- two-bot chunks left behind (the run-round.sh purge assumes psql/the bgp
-- role, which this container's recipe does not use).
DELETE FROM user_tasks WHERE title LIKE 'R584 %' OR title LIKE 'QA Task R584%';
DELETE FROM comp_files WHERE comp_id IN (SELECT id FROM crm_comps WHERE name LIKE 'QA-COMP R584%');
DELETE FROM crm_comps  WHERE name LIKE 'QA-COMP R584%';
DELETE FROM deal_verdicts WHERE deal_id NOT IN (SELECT id FROM crm_deals);
DELETE FROM crm_deals  WHERE name LIKE 'QA-R584%' OR name LIKE 'QA-STAGE%' OR name LIKE 'QA-KYCGAP%';
