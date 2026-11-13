# Audit regression checks

Run from the repository root:

```sh
npm run qa:regression
npm run check -- --incremental false
```

The standard suite needs installed dependencies, but no database, provider credentials or running app. It uses actual modules and TypeScript-extracted server handlers with synthetic services. Test groups cover authorised shared/owned CRM edits, foreign record rejection, URL variants, case-sensitive resource identifiers, session revocation, account cache/persistence races, team-switch failures, mobile routing, WIP reconciliation, approval concurrency (including delayed admin requests), Xero rotation/posting, weekly schedules, SQL transaction/policy cleanup, and deployment/build failure handling.

`source-harness.cjs` is a helper, not a standalone test. `access.cjs`, `auth.cjs` and `wip.cjs` each run a group of related assertions; the Node test runner reports each as a single test file. Existing audit repro scripts outside this repository remain historical evidence; passing those older scripts means a defect was present on the audited commit.

This suite is the deploy gate: `.github/workflows/auto-deploy.yml` runs it on every push to the working branch, and a failure skips the build, the smoke suites and the deploy job. Run it before pushing. Many tests cut one function or route out of the source and run it with a fixed list of bindings, so code that gains an import, a helper or a module-level constant needs that binding added to its test. The failure reads `X is not defined`, or a handler answering 500 where the test expects 200.

## Tests that need PostgreSQL

The standard run has no database, so these are skipped, each with its reason, unless their own variable is set. The workflow sets every one, so each push runs them all. With a variable set and its database or tools missing, the tests fail; they do not skip.

| Tests | Variable | What it needs |
|---|---|---|
| `evidence-plan-sharing.test.mjs` (31 of its 34 tests), `evidence-plan-editor.test.mjs` (all 17) | `RUN_DISPOSABLE_EVIDENCE_POSTGRES=1` | `initdb` and `pg_ctl` on PATH and a non-root user. The tests start a private cluster on a Unix socket and remove it. |
| `account-leasing-postgres.test.mjs` | `ACCOUNT_LEASING_DATABASE_URL` | A local disposable database. The test works in a throwaway schema and drops it. |
| `aml-retention-postgres.test.mjs` | `AML_RETENTION_DATABASE_URL` | The same. |
| `crm-engagement-postgres.test.mjs`, `crm-engagement-kind.test.mjs` (one test) | `CRM_ENGAGEMENT_DATABASE_URL` | The same. |
| `landlord-contact-activity.test.mjs` (one test) | `LANDLORD_CONTACT_ACTIVITY_DATABASE_URL` | The same. |
| `team-event-privacy.test.mjs` (one test) | `TEAM_EVENT_PRIVACY_DATABASE_URL` | The same. |

Locally, after `bash qa/start-postgres.sh`, the database is `postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres`. The workflow uses the spare `postgres` database of its service container, never `bgpsmoke`, and the server tools the runner image ships under `/usr/lib/postgresql/<version>/bin`.

## Optional actual PostgreSQL check

`sql-tools-postgres.mjs` invokes the real SQL tool and database pool. Use only a fresh disposable database named `bgp_sql_regression`, reached through a `/tmp/bgp-sql-regression-*` Unix socket. The script refuses other locations and never loads `.env`. Supply the separate `SQL_REGRESSION_DATABASE_URL` environment variable; see the example at the top of that script. It creates synthetic tables and must not run against an existing app database. Stop the temporary PostgreSQL instance afterward.

The local audit implementation passed this integration check on PostgreSQL 18, the standard regression suite (45 tests), TypeScript and a production compile with `DATABASE_URL` unset. Local Node was 25.6.1; CI uses Node 22.

## Running-app browser checks

Against a local app using `qa/smoke-fixture.sql.gz`, run `node qa/smoke.mjs` followed by `node qa/phone-session-smoke.mjs`. Both use `SMOKE_BASE` (default `http://localhost:5000`) and optional `SMOKE_CHROMIUM`. Install Playwright first, as the GitHub workflow does. Never aim these fixtures at a production database.

The local pass completed 53 desktop checks and 21 phone checks, plus 22 actual HTTP/database client-access checks. The phone suite verifies reload/history, profiles and same-document account isolation using a disposable self-only conversation, then deletes it. Screenshots/results are written below `qa/smoke-shots/`. CI runs both browser suites after regression tests and TypeScript.

The phone suite now also checks property cards, the Building overview, current/history tenancy totals and edit controls, full-page switching, and brand Contacts with a named agent whose firm is unconfirmed. Supply `PHONE_SMOKE_DATABASE_URL=postgresql://postgres@localhost:5432/bgpsmoke` (as CI does), or the guarded `bgp_smoke` Unix-socket URL, to create and clean its exact synthetic fixture records. The scenario is required in CI and reported as skipped locally without this dedicated variable. It checks horizontal fit, real linked contact navigation, and captures property/brand screenshots in `qa/smoke-shots/phone/`. These are Chromium tests with iPhone viewport, user agent and touch emulation, not physical-device Safari tests. `phone-property-brand.test.mjs` separately executes the real device-detection hook and phone component behavior without a browser; it does not certify visual layout.

The browser pass found a reactive session-verification bug and a second CRM write gateway missed by the original isolated tests. The cache regression now covers structurally identical restored auth data; the access regression executes both gateways before scoped handlers. Live authenticated provider integrations and production deployment were not tested.

## Client agent links

`client-agent-directory.test.mjs` runs with the standard suite. It checks that named people retain their own brand links, duplicate relationship rows do not multiply people, same-name IDs remain distinct and missing employers are not invented. The persisted-cache suite rejects the previous agent response shape on restore.

`client-agent-directory-postgres.mjs` runs the actual SQL and canonical client brand-slice helper on temporary tables in a separate disposable database. `qa/client-agent-directory-smoke.mjs` seeds exact synthetic IDs in the local smoke fixture and removes them after authenticated API and desktop/phone checks. Both require dedicated environment variables and enforce local Unix-socket/database guards. See `docs/client-agent-directory-2026-09-07.md` for commands and scope.

The client Agents page became three sections on 2026-11-12 (BGP, Joint agents, Tenant rep agents; `GET /api/client/agents-overview`, `client/src/components/client-agents/`). `client-agents-overview.test.mjs` runs with the standard suite: who is shown in the BGP and joint agent sections, how a joint agent's firm is established, and that a tenant rep is left out only when it is the same person as someone shown above (a namesake at a different known firm stays). The smoke script follows the new layout. Test ids that moved:

- `client-agent-<firmId>` is the firm's table block on desktop and its card on phones.
- `client-agent-contact-<id>` is the agent's table row (phone: the agent's block in the card). For a person whose firm is unconfirmed the row is `client-agent-contact:<id>` inside `client-agent-unconfirmed`, and `client-agent-contact-<id>` is on the name within it.
- `client-agent-show-contacts-<firmId>` exists only on phone cards with five or more agents; the desktop table lists every agent and folds the whole list behind `client-agent-reps-show-all`.
- `client-agent-results-count` shows only while a search or scheme is active. The standing count is `client-agent-section-reps-count` ("N named agents").
- The per-person "Show all N brands" button is gone; brand chips fold behind "+N more" past six (four on phones).

## Brand CRM

The Brand CRM (12 November 2026; rules in CLAUDE.md, "Brand CRM") is covered in two places. In this folder, and so in the standard suite: `crm-engagement-kind.test.mjs` (the Landlord CRM and Brand CRM views, the share marker), `brand-scheme-plan-card.test.mjs`, `brand-plan-board.test.mjs` and `brand-diary.test.mjs` (what each login is drawn), `brand-contacts-parity.test.mjs`, and `brand-crm-guards.test.mjs` (the routes themselves, cut from the source: the staff door and the Landsec door by login, the restricted-role gateway, who may set and read "On hold", and the brand tidy's Wanted-line signals). The engine's own tests sit beside the code and are NOT in `npm test` or this folder's glob; run them by name:

```sh
node --import tsx --test shared/brand-stage.test.ts server/brand-scheme-plan.test.ts server/brand-crm-diary.test.ts
```

`server/brand-scheme-plan.test.ts` and `crm-engagement-kind.test.mjs` each skip one test that runs the real SQL unless `BRAND_PLAN_DATABASE_URL` / `CRM_ENGAGEMENT_DATABASE_URL` names a local PostgreSQL database; both work in a throwaway schema and drop it. Nothing in the Brand CRM has a browser test.

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

## Actual automatic-plan evaluation

`qa/evidence-plan-automatic-eval.mjs` runs the app's actual automatic vision/region-selection worker against an original plan image, with real Anthropic responses. It requires an injected `ANTHROPIC_API_KEY` and the guarded disposable `EVIDENCE_PLAN_DATABASE_URL`; it never reads credential files or connects to a production database. Provider calls send the drawing to Anthropic and incur normal API usage; use images authorized for that transfer. Limit: 20 requests per drawing, including retries; a run that exhausts the cap is incomplete. Candidate classifications record their exact batch IDs. This evaluator is not part of the offline regression suite.

Run `node --import tsx qa/evidence-plan-automatic-eval.mjs --case=brent-cross --image=/absolute/original.jpg --out=/absolute/new-output-directory` (or `--case=brixton`). `--prepare-only` checks the image and extracted source without calling the provider or database. Each run starts an empty level in a disposable schema: it evaluates image-only detection, not schedule-enriched production refresh. It preserves exact request images/prompts, raw responses, mapped observations, token usage, accepted units and an overlay; its schema is removed afterward. Manually reviewed sample points must be used only for subsequent scoring, never as scanner inputs. A completed job or a large unit count is not an accuracy pass.

After a real run, `node --import tsx qa/evidence-plan-score.mjs --run=/absolute/run-output --ground-truth=/absolute/independent-sample.json` scores sampled point coverage, non-unit leakage, merged neighbouring samples and readable labels at their correct locations. It rejects preparation/candidate-only output and checks the source frame. `--self-test` validates the scorer without a provider or database. Point coverage is not complete boundary accuracy or whole-plan recall; inspect the final overlay and boundary expectations too.

For worker/persistence-only changes, `--replay-from=/absolute/completed-actual-run` verifies identical original image, geometry source, detection prompt/source, and every ordered request image/prompt/model/option before replaying recorded real responses into another disposable schema. It needs only the audit database, makes no external calls, and reports a distinct replay stage/usage plus an accepted-boundary comparison. Changed detection inputs, incomplete donors and chained replays are refused. Replay is not a new provider test; the scorer CLI retains its actual-provider-only guard. Use the exported `scoreAcceptedUnits` for a separately labelled post-replay comparison.
