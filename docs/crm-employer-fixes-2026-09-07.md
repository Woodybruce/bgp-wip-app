# CRM employers and represented brands

An agent's employer and the brands they represent are separate relationships. The earlier client Agents directory fix read requirements correctly, but historical company assignments, import writers and staff verification warnings still confused these concepts. A typical failure was an agency contact stored as an employee of the represented brand.

## Employer review

- Staff CRM shows one latest actionable finding per contact. Older duplicates, superseded verdicts, corrected employer snapshots and suggestions already equal to the recorded employer are excluded.
- Review employer shows recorded employment, the suggested employer, the evidence and current brand links. Requirement and tenant-rep sources for the same brand are combined visually.
- Saving requires a real selected CRM company, or an unambiguous exact match for older API callers. Missing/ambiguous matches remain pending; adding a note never counts as a correction.
- Missing companies can be added within the review: **Add employer**, check its name, explicitly choose a company type, then **Create company**. The selected company is saved to the contact only after a separate **Save employer** action. The picker includes legal billing entities, explains absent/ambiguous matches and offers a refresh action. On phones the creation form scrolls into view and its action remains visible.
- Creation first refreshes companies and reuses one exact name match. Failed requests retain the entered fields; retrying after a lost success response selects the existing company. In-flight duplicate clicks share the same request. These checks do not provide database-wide uniqueness across simultaneous reviewers.
- Apply/Dismiss lock the contact and its findings in a consistent order and run atomically. An outdated review cannot overwrite a newer employer correction. Historical pending rows are superseded together.
- The contact ID and its requirement, representation and deal links are retained. The verifier includes represented brands as context, explicitly separate from employer evidence. New evidence snapshots include employer ID without a schema migration; slow AI lookups cannot reopen a finding reviewed while they ran.
- The desktop dialog and phone sheet use search and six-person pages. The main CRM preview shows three people on desktop and one on phones. Employer actions remain visible while the phone sheet content scrolls; errors preserve the selected employer.

## Import prevention

- RocketReach imports resolve the reported current employer to a unique existing CRM company. The viewed brand is discovery context, not a default employer. Parent-company employment stays with the parent.
- Reliable email/normalised LinkedIn matches are checked globally. Existing contacts are kept unchanged; conflicting identities, missing employer evidence and ambiguous companies are left for review. A short advisory transaction serialises competing imports after provider lookups finish.
- Brand Refresh contacts reports additions here, additions under another employer, existing records and cases needing review. Details link the actual contact/employer and explain skipped or conflicting results.
- Outlook filing retains the chosen company on the interaction. An unknown sender is created with an unconfirmed employer, rather than being assumed to work for that company.
- The shared contacts board's discovered-person and pending-email Add actions follow the same distinction: they preserve an existing identified person or create a contact with an unconfirmed employer, retain discovery context in notes, and provide an Open contact link. They do not invent brand representation.

## Scope and limitations

No schema, migration or property/deal permission changes. Client access and editing rules are unchanged. Employer reviews remain a staff workflow. No production contact was reassigned during development.

Historical findings previously marked applied after only a note are not silently reopened; those contacts need fresh verification. Historical wrong employers still need human review, and missing agent/brand IDs need reviewed linking. The legacy external-requirement conversion route and existing TRL/bulk-import name reuse remain separately identified issues; no current UI call to that legacy conversion was found during the investigation. Current PIPnet automatic import already separates the agency from the brand requirement.

Provider evidence is not independently certified by these tests. Imports may intentionally leave more candidates needing review where a provider omits employment, a legal-name variant does not exactly identify a CRM company, or identities conflict. Existing contacts are not automatically re-employed on a provider's assertion.

## Verification results — 7 September 2026

- 112 regression tests passed.
- 40 real PostgreSQL checks passed: 34 employer-verification checks and 6 import checks, including competing transactions and preserved relationship links.
- 67 authenticated desktop/phone browser and API checks passed, with no uncaught browser errors. Phone employer actions remain visible and discovered names remain readable; reviewed screens have no horizontal overflow.
- TypeScript checking and the production build passed.

These checks used a disposable local database and synthetic provider responses. They verify the implemented flows, not the accuracy of live provider evidence or the state of production records.

## Missing employer diagnosis — 8 September 2026

A read-only production check found no company matching Leslie or Perkins, including merged and billing records. Guy Maude's pending suggestion therefore had no real company ID to select; the disabled Save employer button was expected, but the UI left no way to complete the correction. The inline creation flow removes that dead end. No live company was created and no live contact was reassigned during this fix.

Validation passed 87 authenticated desktop/phone browser and API checks and 16 focused regression tests. The browser checks used the real local app and disposable database, including creating a company, preserving the contact until the separate save, preserving existing relationship links, and reusing a company after a simulated lost success response. There were no uncaught browser errors or horizontal overflow; creation and save actions stayed visible on the phone. TypeScript and the production build passed after the final changes.

## Reproduce local checks

```sh
npm run qa:regression
npm run check -- --incremental false
npm run build

CONTACT_VERIFY_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
  node qa/regression/contact-verification-postgres.mjs

CRM_IMPORT_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
  node qa/regression/crm-import-employer-postgres.mjs

CRM_SMOKE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
SMOKE_BASE='https://127.0.0.1:5446' \
SMOKE_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node qa/contact-data-health-smoke.mjs
```

Database commands require the disposable PostgreSQL fixture; the browser command also requires the built local app and local TLS proxy. The scripts guard their database/host targets, use synthetic records, avoid live providers, and remove test data. Browser discovery responses are synthetic but imports, review endpoints, authentication and UI are real. The phone uses its own company profile and shared contacts board, rather than the desktop BrandProfilePanel.
