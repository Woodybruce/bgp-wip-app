# Review retained plan scans

The Brent Cross live scan found closed boundaries, but displaced and overlapping legacy boxes prevented most of them being saved. The scan could therefore finish with almost no visible improvement. Retain the verified candidates and let the user explicitly match them to existing units instead of discarding blocked results.

## Behaviour

- **Review scan**, beside **Refresh units**, reopens the latest completed result for the active level, including after a page reload. Older scans need one new scan to retain their proposals; the source plan does not need uploading again.
- The preview uses the existing full source image and separates proposed boundaries, saved outlines and label position. Search, pagination, selected-unit zoom and a phone sheet keep larger plans navigable.
- Exact-reference matches are suggestions. Queue them individually or together, inspect them, then **Apply reviewed boundaries**. New units require an explicit choice and reference.
- Replacing a boundary retains its unit ID, reference, tenant, lease information and evidence. A label already inside the corrected shape stays where it is; otherwise it moves inside.
- **Old outlines** can clear an incorrect AI outline while retaining the unit and its information. Manually drawn and already reviewed outlines are protected.
- Counts distinguish automatically added/refined/current boundaries, applications during review, and boundaries still awaiting review.

## Persistence and safeguards

Versioned review JSON and unit snapshots use the existing `file_storage` table. The complete review is saved in the same transaction as automatic scan changes and job completion. No schema migration is required.

The review API checks property scope and locks the level, job, artifact and affected units before applying changes. It rejects stale source images or unit identities/geometry/markers, manual-outline overlap, duplicate mappings, invalid references and conflicting retries. Exact retries are idempotent. It does not run evidence relinking or rewrite tenancy facts.

## Verification

- 199 regression tests, 23 PostgreSQL review checks and 9 scanner atomicity/concurrency checks passed.
- A local replay of Brent Cross's retained 51 candidates against the 67 legacy lower-level records initially preserved all candidates for review. Explicitly applying 35 unique reference matches retained all 177 plan unit IDs and facts and all 84 evidence entries. The 32 unselected lower-level records remained unchanged; 16 proposals still required matching. An exact retry made no further changes.
- A recorded provider replay against an empty level saved 51 outlines plus its complete review. Both replays made zero new provider requests and made no production database changes.
- A browser test against the real local app and PostgreSQL replaced two boundaries, cleared an old outline and created a missing unit. Reloading retained all three applied results; linked evidence and saved facts were checked directly in the database.
- An iPhone 13 UI test verified the actual phone sheet, protected selections, explicit queuing, changed-choice handling, full image dimensions and no horizontal overflow or browser errors. That phone test used a synthetic mocked review response and made no database writes.
- TypeScript and the production build passed.

Automated checks do not certify the accuracy or completeness of every detected boundary. Ambiguous references still need the user's choice. This change provides a durable correction workflow; it does not automatically replace every old box or repair duplicate tenancy-schedule references.

## Local checks

```sh
npm run qa:regression
npm run check -- --incremental false
node --import tsx script/build.ts

EVIDENCE_PLAN_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
  node --import tsx qa/regression/plan-scan-review-postgres.mjs
```

The PostgreSQL and browser checks require the disposable local fixtures. See the scripts' environment guards before running them; never point fixture scripts at production.
