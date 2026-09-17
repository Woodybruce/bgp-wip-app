# App functional fixes — 17 September 2026

## Scope

Follow-up to the app review, focused on functional property, tenancy, CRM, plan and news issues. Client access rules are unchanged at Woody's request. These changes do not repair historical employer assignments, replace saved plan geometry or backfill incomplete viewing records.

## Changes

- Current tenancy totals exclude archived rows, distinguish missing values from recorded zero, and show coverage for incomplete totals. Occupancy counts and filters use the same status aliases. Show history retains access to archived rows.
- Tenant-link headlines and current integrity checks also exclude archived leases. The linked count and its denominator use the same named current tenants.
- Tenancy links use explicit record IDs or unique exact normalized references. Blank, ambiguous and partial references cannot silently open another unit.
- Property lists have 50 results per page in table and card modes. Search, sort and filters operate across the result set. Page selection and all-matching selection are explicit; changing filters clears selection.
- Office and Residential records can default to Building, and Mixed Use to Multi-let when reliable tenancy counts are unavailable. Layout fallback never invents occupancy, rent or a unit count. Existing full-board controls remain accessible.
- Occupier research uses the recorded asset type and current tenancy uses. Shopping centres retain centre research; relevant smaller properties receive local opportunities. General office/residential records without relevant retail, hospitality or leisure space skip Brand Gap research. Stored research is paired transactionally with its property context, so old centre commentary cannot reappear for a different use.
- A named agent can represent a brand while their firm remains unconfirmed. Adding or changing representation never creates an employer or reassigns a contact. Explicit firm/contact selections must agree; self-representation is rejected.
- Brand readiness separates Core facts prepared from Contacts need review and shows actual automatic-section progress.
- Repeated View on plan requests resolve the linked floor again, including after a manual floor change. Outline changes invalidate cross-floor link caches.
- Property scanning receives property type, floor and current tenancy-use context. Complete office suites, flats and separately let storage are supported in the classification prompt, with internal rooms still excluded. Evidence-plan retail defaults are preserved.
- Exact challenge/error page titles are rejected during news ingestion and excluded from saved feeds before limits are applied. Historical rows are retained.

## Database change

Migration `0040_brand_agent_unknown_firm.sql` makes only `brand_agent_representations.agent_company_id` nullable. The existing startup migration path includes the same idempotent change. No historical relationship or employer records are rewritten.

## Validation

- Full regression suite: 553 tests passed after the final archive-status consistency follow-up.
- TypeScript check and production build passed. The build used `node --import tsx script/build.ts`, equivalent to the project build entry point, because the sandbox blocked the tsx CLI's local IPC socket.
- Actual PostgreSQL checks passed: 8 representation cases, 28 property-plan cases, 11 property-brief/linkage cases, 6 property-research/cache transaction cases, and news-title normalization across 34 challenge and legitimate headline examples.
- Disposable local browser, staff test account: saved an agent with an unconfirmed firm; verified the database kept their employer NULL and created no company. Checked core readiness and separate contact review status.
- Browser: an Office with no schedule opened Building with unknown tenancy metrics. Research suppressed deliberately seeded legacy shopping-centre commentary. Full page and Return to simple view both worked.
- Browser: Trading/Let/Available fixtures showed 2 occupied, 1 vacant and 3 current rows. Two archived records with large rents did not alter £84,000 current rent or 3,600 sq ft; Show history exposed all 5 rows. Both occupancy filters returned their advertised row counts.
- Final rebuilt app: tenant linkage showed 2/2 current named tenants, while the overview retained £84,000 and 3 current rows.
- Browser: a unique Unit 1 link opened QA Ground; changing to QA First and repeating the same action returned to QA Ground.
- Browser: 55 synthetic properties produced pages of 50 and 5 in table and card modes. Page selection selected 50, explicit all-matching selected 55, and narrowing search found a result from page 2 while clearing selection and resetting pagination.

## Follow-up acceptance work

- A fresh, authorized live Brent Cross lower-level scan completed all 13 image sections and produced 51 boundaries. The independent local geometry pass found all 51 historically accepted demises among 151 geometric proposals; enlarged source/overlay crops were inspected. This is qualitative boundary validation on this raster, not a surveyed IoU benchmark.
- Ten boundaries were reviewed and applied through the live app: Zara's main D17A/D17B/D18/D19 shop (new plan unit, separate from its remote store), Holland & Barrett, Mango, Hasty Tasty Pizza, K16, K19, K10, Chick, Auntie Anne's and Newbie. Existing tenancy references were retained, as Woody explicitly requested. The existing 84 evidence entries remain; the plan now has 181 units across its levels, including the newly placed main Zara shop. Lower-level historical records needing placement reduced from 32 to 23. These remaining records include duplicate/remote-store references and are not proof of missing detected shops.
- The scan-review success now dismisses the obsolete pre-review completion banner instead of continuing to display its old pending count.
- COOK's live official identity was corrected from cook.com to cookfood.net and its incorrect kitchenware description was replaced with verified ready-meal business facts. A real profile refresh completed. The retained legacy fields revealed a readiness bug and a missing review-completion path: the new explicit retained-facts form corrects description, industry, HQ and LinkedIn without overwriting other staff values or legal/KYC records. Identity/fact conflicts reject stale saves, and the previous and new facts are audited transactionally. Old BGP briefs are withheld pending review and rebuilt afterwards.
- Relevant mixed-use research now also recognises E(a/b/d), plural use descriptions and spaced F & B. Browser/API eligibility and nightly PostgreSQL selection use the same pattern. Generic E and office E(g) remain excluded.
- The phone Contacts screen now renders saved agent representations, including named agents whose firm is unconfirmed. CI scenarios use Chromium with iPhone touch/UA emulation, test the property overview, tenancy history/edit controls, full-page toggle and brand/contact links, and capture layout screenshots. This is not physical iOS Safari certification.
- The actual-provider plan evaluation harness was repaired after the vision-reader module move. It retains source/request provenance checks and does not pass off old recorded provider replies as a fresh run.

The first authorized push, 0981ea8e, was held by CI. The older fixture exposed missing additive tenancy columns in the normal boot upgrade; startup now includes those existing migration fields. A separate failed-query remount loop made 703 requests in ten seconds; the property shell now remains mounted after the initial request settles, so errors display normally and retries remain bounded. The unchanged legacy fixture then passed all 58 desktop smoke checks, including a synthetic outage/recovery, original property panels and viewing/offer sync. The final regression suite passed 570 tests; production build passed. Additional actual PostgreSQL checks passed 107 property-research cases and 6 fact-review transactions. Follow-up deployment and phone CI acceptance are recorded separately once complete.

The initial local validation above used no provider credentials; the explicitly described live scan and COOK changes occurred during follow-up acceptance.

Official COOK verification: https://www.cookfood.net/ and https://www.cookfood.net/privacy. Its legal contracting entity and historic contact/employer assignments remain separate data-review questions.

The review's client data-scope finding was deferred by Woody and remains outstanding. External research quality, empty source data and incomplete viewing records are not represented as fixed by these code changes.
