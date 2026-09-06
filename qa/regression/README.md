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
