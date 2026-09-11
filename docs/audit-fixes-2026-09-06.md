# Audit fixes — 6 September 2026

Implementation starts from `ff3d2301`, after pulling the two commits since the audited `f78ffc9f` revision. The later testing pass also incorporated Claude's `cfbb7d3d` brand-panel update, merged locally as `c9e1f45b`. Work is isolated in the Codex checkout; the original laptop checkout and its modified lockfile were preserved. Nothing has been pushed or deployed.

## Client functionality

Woody confirmed that clients need full editing abilities on every property and deal they are authorised to access, including shared records and ChatBGP workflows. The patch uses the existing property/deal scope rules. It does not convert those records to staff-only or read-only access.

Tests cover edits and links on owned **and shared** records, as well as rejection of unrelated records. The tests also uncovered an existing mismatch: the global gateway blocked property PUTs even though their handler supported scoped client edits. Exact property PUT and scoped bulk-update routes now reach those handlers.

Company-property/deal links check both the company and the already-accessible target before inserting or removing a relationship. Mixed bulk batches are checked before the first write. Client edits cannot overwrite record identity, access-control fields or staff compliance attestations. Existing internal fee-allocation, deletion and senior-approval policies remain in place. Bulk status values are canonicalized before approval checks, including lowercase/legacy values.

## Implemented changes

| Area | Result |
| --- | --- |
| Registration | New staff accounts use existing verified Microsoft sign-in. The unused unauthenticated password-registration endpoint no longer accepts a claimed staff address. Existing staff/client password sign-in continues. |
| Client operations | Pre-existing property/deal access checked before relationship and bulk writes; foreign company deletion blocked; company-deal relationship lists scoped. URL spelling cannot bypass the client gateway, and resource identifier case is preserved. |
| SQL tools | Real read-only transaction, transaction-local timeout, single-statement extended protocol, rollback and connection cleanup. Actual credential/session/security tables are excluded from read, write and schema surfaces. Operational CRM and document-preference writes remain available through the existing write tool. |
| Force logout | Revokes sessions, bearer tokens and unredeemed SSO exchange codes; disconnects user sockets. Token resolution checks active accounts. |
| Account cache | Clears old private query/observer state and pending persistent writes on identity/scope changes and expiry. Restored data waits for live identity verification. Old in-flight replies cannot restore cleared account data. |
| Team changes | Serialized saves, HTTP error handling, canonical server team confirmation and shared mobile/desktop Exit behavior. |
| WIP | Shared status eligibility for summary/drilldown; hidden agents no longer inflate another agent's allocation; canonical status-to-stage mapping and explicit zero allocations preserved. |
| Expense approval | Reviewer/stage checked at the transition; conditional updates prevent concurrent advances. Requests carry the stage shown to the reviewer so delayed admin requests cannot approve the next stage accidentally. Old approval tabs must refresh before approving. |
| Xero | Concurrent refresh callers receive fresh tokens. Rotation persists after subsequent API failure, and stale session saves cannot overwrite newer rotation. Posting uses bounded concurrency, cross-process advisory locking, stable idempotency keys and the existing posted-ID guard. |
| Weekly schedules | Correctly parses the documented `MON:07:30` format and validates time ranges. |
| Navigation | Mobile client profile uses the supported profile route. WIP Report uses `/deals/report` consistently, including reload/history. ChatBGP's navigation map updated. |
| Diagnostics | ScraperAPI diagnostics register after session/client middleware. Obsolete Experian diagnostics/discovery routes, audit page and credential-health prompts removed. Goad mapping data/attribution remains separate. |
| Deploy/build | Exact tested commit supplied by CI, clean/fast-forward checkout requirements, nonblocking staged compilation, separate existing-migration phase, retained prior assets/release, and deployment status confirmation. No production deployment was exercised locally. |

Experian has no active account. This work treats it as legacy cleanup, not an active integration incident. The app's AI provider/model is unchanged.

## Validation

Run `npm run qa:regression` for the isolated regression suite and `npm run check -- --incremental false` for TypeScript. The regressions use actual application modules or TypeScript-extracted handlers with synthetic persistence/providers. This keeps them independent of production credentials and startup side effects. The SQL integration test additionally invokes the actual application SQL function against a disposable local PostgreSQL database.

Final verification passed:

- `npm run qa:regression`: **45 tests passed**, none failed or skipped.
- `npm run check -- --incremental false`: **passed, zero TypeScript errors**.
- Production compilation with `DATABASE_URL` removed: **passed**. Existing large-chunk warnings remain (entry bundle approximately 700 kB minified / 196 kB gzip; server bundle 10.2 MB).
- Actual disposable PostgreSQL integration: **passed** read-only enforcement, transaction timeout, single-statement rejection, sensitive-table policy and pool reuse; test database stopped.
- `git diff --check`: **passed**.

The subsequent running-app tests found and fixed three gaps that the initial isolated tests missed:

- Same-user persisted-cache restoration could leave the app on its loading logo: verification changed a module variable, while React Query retained the same user object and emitted no tracked-property notification. Verification now publishes a reactive snapshot; the app and team initialization both subscribe to it. The regression reproduces the zero-query-notification case.
- The client profile URL mounted the entire Organisation settings page. It now renders only the personal profile card, uses a phone-friendly layout and avoids staff-only settings requests. Browser checks verify this before and after reload.
- A second CRM middleware still rejected permitted property edits, bulk updates and property/deal links. The real HTTP tests initially passed 14/22 checks. Both gateways now admit the requested scoped operations, and the regression executes both gateways before the handler. Scope lookup failures return 503 instead of allowing the request through.

Running-app validation used a disposable PostgreSQL 18 database restored from the repository's smoke fixture, with integration/session credentials and scheduled-job rows excluded. The app received only test configuration. Final results:

- Desktop Chrome smoke: **53 checks passed**, including staff/client dashboards, property schedules and linked boards, letting tracker rows, deals, brands, tasks and client read scoping. The included tracker sync check passed its seven matching/deduplication assertions.
- Phone Chrome using the iPhone 13 viewport: **21 checks passed**, including WIP tab/reload/Back, staff/client profiles and same-document account switching. A private self-only test conversation was present in the staff cache, then absent from the client's UI and persisted cache, with zero transient disclosures observed by a DOM mutation observer. Synthetic conversations were removed afterward.
- Actual HTTP plus database verification: **22 checks passed** after the CRM fix. Owned/shared property and deal business edits, allowed bulk edits and links succeeded; foreign record access, self-granted links and mixed bulk batches were rejected without partial writes. Synthetic records were removed afterward.
- Existing `--migrate-only` command: **passed** against the disposable database. No new schema or migration files were introduced.
- Git handoff: a simulated Claude checkout pulled the combined commit successfully, preserved unrelated local edits and refused to overwrite a conflicting local edit. No GitHub push was involved.

Smoke assertions now require authenticated page content and detect compact error boundaries. They check the current unified schedule, actual tracker unit rows and paths containing spaces. `qa/phone-session-smoke.mjs` preserves the phone scenarios and runs in CI after the desktop smoke suite.

Local Node is 25.6.1; CI specifies Node 22. TypeScript, all 45 regression tests and production compilation were rerun after the application fixes. Browser tests used desktop Chrome and phone viewport emulation, not physical devices or Safari. No production records or authenticated Microsoft, Xero, AI or Experian integrations were tested; these results do not establish end-to-end live-provider or production-deployment behavior.

## Remaining work and limits

- **Private file ownership remains open.** Active-account checks and private/no-store caching are fixed, but filenames alone cannot establish authorization. Existing metadata omits many generated/shared files. A blanket owner-only gate would break legitimate client documents. See [the prepared ownership/migration plan](chat-media-access-plan.md); approval for that database change is pending.
- **Xero's uncertain-post recovery is bounded.** Locks prevent concurrent workers and a stable provider key protects prompt retries. Xero retains idempotency keys for six minutes. A lost response retried after that period still needs durable attempt/reconciliation storage. [Xero documentation](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/).
- **SQL privilege separation is a further hardening step.** Read-only transactions enforce no writes; code policy blocks known sensitive tables/functions. A dedicated restricted database role/views would add an independent access boundary and requires database rollout work.
- **Deployment bootstrap and operational limits:** Prefer the native platform for the first rollout, including the explicit existing migration command `npm run build -- --migrate-only` before startup. A webhook-driven first rollout necessarily uses the previously running deploy handler; the new protocol takes effect once the new bundle starts. Migration changes already applied to a database are not undone by restoring frontend/server artifacts. Previous releases and retained hashed assets need a retention policy. Changes to dependency manifests/lockfiles require a fresh release with matching installed dependencies; the in-app updater must not build against a stale dependency tree.
- The larger unit-data consolidation, durable background jobs and performance profiling recommendations from the audit remain separate improvement work.
- General company creation/amendment retains its previous CRM policy; the mismatch with the outer gateway's documented brand quick-create flow remains a separate issue. The new gateway exceptions cover scoped property/deal edits and relationships, not arbitrary company-field writes.
