# Client CRM agents linked to directory brands

Woody clarified that Landsec’s Agents directory should contain agents acting for brands actually in its Brand CRM. The previous implementation qualified firms by tenant-rep flags or any representation record, ignored agents already named on requirements, and displayed unrelated employees from qualifying firms.

## Resulting behavior

- The same canonical hospitality/leisure/fitness slice and client-added brand IDs define the eligible brands. Merged brand rows are excluded.
- Current tenant-rep representations and current visible leasing requirements establish agent links. Requirement `agent_contact_id` and representation `primary_contact_id` supply the named people. Principal contacts alone do not qualify.
- Company/contact type flags alone do not qualify a firm. Requirement-linked people do not need an additional tenant-rep tag. Only explicitly linked contacts appear, rather than the full employee list of a qualifying agency.
- Client requirement visibility remains PIPnet-sourced or own company; staff can use staff-visible requirements. Active and unset statuses are current. Past/Archived/unknown states, ended representations and future-start representations are excluded.
- A named agent with an absent, merged or conflicting company attachment remains visible as “Firm not confirmed.” No employer is inferred from a brand name or email address, and no stored records are reassigned.
- A firm representation without a named contact remains useful and shows that no representative has been recorded. Conflicting recorded associations are retained rather than silently resolved.
- Cards show each person’s linked brands, relationship source and recorded email/phone. Counts distinguish firms and unique named people. Phone previews one contact, desktop three; real Show all controls expose the complete lists. Each person initially shows at most three brands; search reveals all matching card content. Firm-level brand links without a named person are retained separately.
- Loading, errors, retry and unmatched searches have explicit states. Persisted cache version advances because the response now includes per-person brand/source lists; a regression verifies that the old shape is discarded before rendering.

Implementation: `server/client-agent-directory.ts`, the `/api/client/agent-directory` handler in `server/crm.ts`, shared response types in `shared/client-agent-directory.ts`, and the Agents area of `client/src/pages/people.tsx`.

## Scope and remaining issues

No database schema, migrations, client property/deal editing rules or general contact permissions changed. Named contacts are usable inline without widening access to their full profiles. No new dependencies or live imports are required.

The separate **Landsec Contacts** tab remains an identified issue: it displays the broad shared contacts response under an own-company label. The proposed correction is a clearly named Landsec team view using the company subset, while preserving the broader API required by other boards. This agent correction does not narrow that API or alter the Contacts tab.

Requirement names that have no actual brand-company ID link cannot qualify an agent. Those records require reviewed linking. Import paths that conflate a represented brand with an employer, and duplicate-looking people, also require separate data review; this query does not guess repairs. Agents linked only to brands outside this client’s Brand CRM are intentionally absent.

## Verification

Final local results: **71/71 regression tests, 21/21 actual PostgreSQL checks and 41/41 authenticated browser/API checks passed**, with zero uncaught browser errors. TypeScript and the production build passed. Desktop at 1440px and phone at 390px were visually inspected; neither page overflowed horizontally. Browser evidence uses synthetic data and does not establish the future production agent count.

The standard regression suite includes seven mapper tests and a persisted-payload compatibility test. The additional SQL script executes the real directory query and canonical brand-slice helper against temporary PostgreSQL tables, covering qualification, client-added brands, private requirement scope, historical links, same-name identities, unknown firms and fail-closed client resolution.

The browser script seeds explicit synthetic records in the disposable smoke fixture, calls the real authenticated API and Brand CRM endpoint, and exercises desktop/phone cards, search, expansion, count consistency, error/retry and page width. It removes its exact fixture IDs afterward. It refuses nonlocal app URLs and databases outside the designated disposable Unix socket. No `.env` or live provider credentials are loaded.

Run:

```sh
npm run qa:regression
npm run check -- --incremental false
npm run build

CRM_DIRECTORY_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
  node --import tsx qa/regression/client-agent-directory-postgres.mjs

CRM_SMOKE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
SMOKE_BASE=https://127.0.0.1:5446 SMOKE_LOCAL_TLS=1 SMOKE_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node qa/client-agent-directory-smoke.mjs
```

The SQL/browser commands require the disposable fixture server. `SMOKE_LOCAL_TLS=1` is only for the local self-signed test proxy. These checks do not verify the current production agent count or repair historical company/contact data.

This work also merged Claude’s four upstream commits through `8191d3e5`, resolving the Experian removal overlap in favor of its removal. The merge is saved separately as `27f99e3c`. Nothing has been pushed or deployed.
