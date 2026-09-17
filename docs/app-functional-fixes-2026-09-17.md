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

## Limits and release

This is local validation, not a claim that the changes are deployed. No production records were edited and no paid scan was run for this pass. The local app had no provider credentials. The wider app's public news/background reads may still run locally.

Brent Cross boundary accuracy still requires visual acceptance against the real plan. These changes neither certify every detected unit nor automatically replace historical outlines. Existing review and manual correction remain necessary for uncertain boundaries.

A narrow desktop viewport was inspected but is not a phone-device test: the app selects its phone shell using touch/device detection as well as width. Actual phone-shell acceptance remains separate.

The review's client data-scope finding was deferred by Woody and remains outstanding. External research quality, empty source data and incomplete viewing records are not represented as fixed by these code changes.
