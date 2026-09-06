-- Unify kyc_status vocabulary across the app.
--
-- Canonical values (what deal-gates.ts `checkCounterpartyAml` expects):
--   pending | in_review | approved | rejected | expired
--
-- Previous CH writer used a different vocab on crm_companies + crm_properties:
--   pass | fail | warning | not_found | individual
--
-- Mapping:
--   pass             → approved   (CH active + no insolvency + accounts current)
--   individual       → approved   (individual proprietors out of CH scope)
--   fail             → rejected   (insolvency history)
--   warning          → in_review  (active but accounts overdue — MLRO decides)
--   not_found        → in_review  (CH search miss — MLRO decides)
--   pass_with_review → in_review  (any future "soft pass" stays in_review)
--
-- After this migration, the CH writer (server/companies-house.ts) emits the
-- canonical values directly, so this is one-time cleanup of legacy rows.

UPDATE crm_companies   SET kyc_status = 'approved'  WHERE kyc_status IN ('pass', 'individual');
UPDATE crm_companies   SET kyc_status = 'rejected'  WHERE kyc_status = 'fail';
UPDATE crm_companies   SET kyc_status = 'in_review' WHERE kyc_status IN ('warning', 'not_found', 'pass_with_review');

UPDATE crm_properties  SET proprietor_kyc_status = 'approved'  WHERE proprietor_kyc_status IN ('pass', 'individual');
UPDATE crm_properties  SET proprietor_kyc_status = 'rejected'  WHERE proprietor_kyc_status = 'fail';
UPDATE crm_properties  SET proprietor_kyc_status = 'in_review' WHERE proprietor_kyc_status IN ('warning', 'not_found', 'pass_with_review');

UPDATE crm_trading_entities SET kyc_status = 'approved'  WHERE kyc_status IN ('pass', 'individual');
UPDATE crm_trading_entities SET kyc_status = 'rejected'  WHERE kyc_status = 'fail';
UPDATE crm_trading_entities SET kyc_status = 'in_review' WHERE kyc_status IN ('warning', 'not_found', 'pass_with_review');
