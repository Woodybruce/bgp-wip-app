-- Seed staff_profiles with start dates and roles extracted from employment contracts
-- Source: SharePoint HR/Employee Contracts (read May 2026)
-- Uses name-based lookup so it's safe to re-run; only sets start_date and initial title
-- Does NOT overwrite salary, manager, or other fields if a profile already exists

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2012-09-03', 'Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Jack Barratt%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2012-09-03', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2013-05-07', 'Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Victoria Broadhead%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2013-05-07', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2014-09-01', 'Associate Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Nick Halley%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2014-09-01', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2014-12-01', 'Associate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Charlotte Brunt%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2014-12-01', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2016-09-05', 'Associate Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Dominic Tixerant%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2016-09-05', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2017-09-04', 'Senior Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Lucy Cope%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2017-09-04', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2017-10-16', 'PA / Office Manager', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Layla%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2017-10-16', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2018-08-20', 'Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Pete Wood%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2018-08-20', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2019-06-10', 'Personal Assistant', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Cara Milligan%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2019-06-10', updated_at = now();

-- Evie North: ~7 Oct 2019 (from previous session data)
INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2019-10-07', NULL, 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Evie North%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2019-10-07', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2020-06-01', 'Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Jamie Orme%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2020-06-01', updated_at = now();

-- Nick Goodman: consultant since 18 May 2020 (not a direct employee)
INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2020-05-18', 'Consultant', 'active', 25, false, 0.0
FROM users u WHERE u.name ILIKE '%Nick Goodman%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2020-05-18', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2020-09-14', 'Associate Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Harry Cody%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2020-09-14', updated_at = now();

-- Alex Todd: contract signed 1 Sep 2021, start date TBC — using Sep 2021 as best estimate
INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2021-09-01', NULL, 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Alex Todd%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2021-09-01', updated_at = now();

-- Lizzie Knights: contract signed 21 Mar 2022, start TBC — using that date
INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2022-03-21', 'Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Lizzie Knights%' OR u.name ILIKE '%Elizabeth Knights%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2022-03-21', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2022-08-08', 'Associate Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Lucy Gardiner%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2022-08-08', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2022-09-05', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Rob Barnes%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2022-09-05', updated_at = now();

-- William Penfold: contract dated May 2023, exact day unknown — using 1 May 2023
INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2023-05-01', NULL, 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%William Penfold%' OR u.name ILIKE '%Will Penfold%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2023-05-01', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2023-07-03', 'Associate Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Oliver Wilkinson%' OR u.name ILIKE '%Oli Wilkinson%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2023-07-03', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2024-01-03', 'Senior Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Danny Cardosi%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2024-01-03', updated_at = now();

-- Harry Elliott: contract dated 24 Apr 2024, start TBC — using that date as proxy
INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2024-04-24', NULL, 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Harry Elliott%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2024-04-24', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2024-09-09', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Emily Cann%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2024-09-09', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2024-09-09', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Jonny Palmer%' OR u.name ILIKE '%Jonathan Palmer%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2024-09-09', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2025-01-01', 'Associate Director', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Tom Cater%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2025-01-01', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2025-05-19', 'PA', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Harriette Walker%' OR u.name ILIKE '%Harriette Walker-Clark%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2025-05-19', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2025-07-21', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Paris Fixman%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2025-07-21', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2025-08-11', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Libby Evans%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2025-08-11', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2025-09-01', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Tiggy Savage%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2025-09-01', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2025-09-22', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Luke Donohoe%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2025-09-22', updated_at = now();

-- Kate Martin: offer letter April 2026 only — using 1 Apr 2026 as estimate
INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2026-04-01', NULL, 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Kate Martin%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2026-04-01', updated_at = now();

INSERT INTO staff_profiles (user_id, start_date, title, status, holiday_entitlement, pension_opt_in, pension_rate)
SELECT u.id, '2026-05-05', 'Graduate Surveyor', 'active', 25, true, 5.0
FROM users u WHERE u.name ILIKE '%Carly Cunliffe%'
ON CONFLICT (user_id) DO UPDATE SET start_date = '2026-05-05', updated_at = now();

-- Millie Edwards: on maternity leave, no contract found digitally — skipped
-- Pete Wood: also has a consultancy agreement dated Dec 2021 alongside employment
