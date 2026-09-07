# Audit regression checks

Run from the repository root:

```sh
npm run qa:regression
npm run check -- --incremental false
```

The standard suite needs installed dependencies, but no database, provider credentials or running app. It uses actual modules and TypeScript-extracted server handlers with synthetic services. Test groups cover authorised shared/owned CRM edits, foreign record rejection, URL variants, case-sensitive resource identifiers, session revocation, account cache/persistence races, team-switch failures, mobile routing, WIP reconciliation, approval concurrency (including delayed admin requests), Xero rotation/posting, weekly schedules, SQL transaction/policy cleanup, and deployment/build failure handling.

`source-harness.cjs` is a helper, not a standalone test. `access.cjs`, `auth.cjs` and `wip.cjs` each run a group of related assertions; the Node test runner reports each as a single test file. Existing audit repro scripts outside this repository remain historical evidence; passing those older scripts means a defect was present on the audited commit.

## Optional actual PostgreSQL check

`sql-tools-postgres.mjs` invokes the real SQL tool and database pool. Use only a fresh disposable database named `bgp_sql_regression`, reached through a `/tmp/bgp-sql-regression-*` Unix socket. The script refuses other locations and never loads `.env`. Supply the separate `SQL_REGRESSION_DATABASE_URL` environment variable; see the example at the top of that script. It creates synthetic tables and must not run against an existing app database. Stop the temporary PostgreSQL instance afterward.

The local audit implementation passed this integration check on PostgreSQL 18, the standard regression suite (45 tests), TypeScript and a production compile with `DATABASE_URL` unset. Local Node was 25.6.1; CI uses Node 22.

## Running-app browser checks

Against a local app using `qa/smoke-fixture.sql.gz`, run `node qa/smoke.mjs` followed by `node qa/phone-session-smoke.mjs`. Both use `SMOKE_BASE` (default `http://localhost:5000`) and optional `SMOKE_CHROMIUM`. Install Playwright first, as the GitHub workflow does. Never aim these fixtures at a production database.

The local pass completed 53 desktop checks and 21 phone checks, plus 22 actual HTTP/database client-access checks. The phone suite verifies reload/history, profiles and same-document account isolation using a disposable self-only conversation, then deletes it. Screenshots/results are written below `qa/smoke-shots/`. CI runs both browser suites after regression tests and TypeScript.

The browser pass found a reactive session-verification bug and a second CRM write gateway missed by the original isolated tests. The cache regression now covers structurally identical restored auth data; the access regression executes both gateways before scoped handlers. Live authenticated provider integrations and production deployment were not tested.

## Client agent links

`client-agent-directory.test.mjs` runs with the standard suite. It checks that named people retain their own brand links, duplicate relationship rows do not multiply people, same-name IDs remain distinct and missing employers are not invented. The persisted-cache suite rejects the previous agent response shape on restore.

`client-agent-directory-postgres.mjs` runs the actual SQL and canonical client brand-slice helper on temporary tables in a separate disposable database. `qa/client-agent-directory-smoke.mjs` seeds exact synthetic IDs in the local smoke fixture and removes them after authenticated API and desktop/phone checks. Both require dedicated environment variables and enforce local Unix-socket/database guards. See `docs/client-agent-directory-2026-09-07.md` for commands and scope.

## Portfolio contacts

`portfolio-contacts.test.mjs` and `portfolio-contacts-filter.test.ts` run in the standard suite. The actual PostgreSQL checks in `portfolio-contacts-postgres.mjs` exercise temporary tables, including records past the previous 200-occupier cap. `qa/portfolio-contacts-smoke.mjs` uses authenticated client API calls and desktop/phone browsers against the disposable smoke fixture, covering linked records, paging, filters, errors and retained owned/shared-property editing. It removes its exact synthetic IDs in a finally block. Commands and limitations are documented in `docs/portfolio-contacts-2026-09-07.md`.

`qa/client-brand-logo-smoke.mjs` uses the same local browser fixture without direct database access. It verifies the actual Landsec mark, light/dark palettes and opaque/broken/delayed fetched-logo responses.

## Employer corrections and imports

`contact-verification.test.mjs`, `crm-import-employer.test.cjs` and `crm-contact-promotion.test.cjs` run in the standard suite. `contact-verification-postgres.mjs` and `crm-import-employer-postgres.mjs` execute the production helpers/handlers against unique disposable schemas in `bgp_crm_directory_regression`. They test real concurrent transactions and remove their schemas afterward. Each requires its own guarded local database variable (see the script header).

`qa/contact-data-health-smoke.mjs` exercises real staff/client endpoints and employer review on desktop and phone, including explicit employer choice, stale saves, duplicate findings and preserved requirement/representation IDs. It also checks real imports with synthetic provider results and the desktop import summary, then confirms the imported person appears on the phone agency profile. It removes its exact fixture records afterward. See `docs/crm-employer-fixes-2026-09-07.md` for commands and limitations.

## Evidence-plan boundaries and editing

`plan-geometry.test.ts`, `plan-unit-detection.test.mjs` and `evidence-plan-data.test.mjs` run in the standard suite. They cover concave geometry, contained labels, adjacent/pale/large unit tracing, non-destructive scan refresh and unambiguous schedule/evidence matching. `evidence-plan-data-postgres.mjs` exercises real transactional writes in a disposable schema, including canonical schedule edits, stale links/backgrounds and rollback.

`qa/evidence-plan-smoke.mjs` uses the original embedded Brent Cross artwork with synthetic records and real authenticated local routes. It checks drawing across saved shapes, redraw preserving IDs, manual/schedule/evidence editing, failed-save drafts, zoomed/panned/contained marker dragging, and the phone sheet. Separate original-image checks exercise click-to-trace preview/save and mall rejection. The scripts clean up their fixtures. Commands and live-data limitations are in `docs/evidence-plan-fixes-2026-09-07.md`.

The drawing-quality follow-up adds `plan-image-render.test.mjs` (Poppler PDF rendering, preserved original source, page names and lossless crops) and `plan-display-image.test.mjs` (reversible red-ink removal, unchanged neutral pixels and cache limits). The browser suite also exercises Clean plan, Unit numbers with saved manual numbering, Hide red ink, fit/actual-size zoom, retained unfinished forms, review queues and phone layout.

`evidence-plan-detection-postgres.mjs` runs with `node --import tsx` and the same guarded `EVIDENCE_PLAN_DATABASE_URL` as the data suite. It verifies concurrent scan starts, stale-worker expiry and rollback of late writes in a disposable schema. Region/contour tests verify geometric candidates and overlap rejection; they do not verify an external AI provider's ability to classify every shop on a live plan.
