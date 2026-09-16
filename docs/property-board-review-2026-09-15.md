# Property-board and enrichment review

Read-only review prompted by Woody's concern that single/smaller buildings get an overly complex board and enrichment is unreliable. No property-page implementation or production data changes were made in this review.

## Recommended approach

Keep one property record and three presentation presets: Building, Multi-let / mixed-use, and Shopping centre / estate. Store property format separately from asset use (Retail is not a reliable indication of a centre). Suggest a preset from reliable unit records but allow the user to override it. Missing schedules must not be treated as proof of a single unit.

- Building: identity/photo/address, client and BGP lead, current tenancy or vacancy, passing rent, next lease event, live deal and next action. Contacts, documents and activity remain accessible through tabs.
- Multi-let / mixed-use: the same overview with a compact unit schedule grouped by floor or use. Start with unit, use, tenant, area, passing rent, occupancy and next event. Full financial detail remains available on demand.
- Centre/estate: prominent plan, schedule, leasing pipeline, tenant mix, relevant brand gaps and asset-wide performance.

## Confirmed interface findings

- `client/src/components/property-detail.tsx:323–361`: most sections default open; desktop shows all six mobile sections, plus a 340px reference column. There is no building-format or unit-count layout branch.
- `property-detail.tsx:837–938`: Brand Gap and full schedule are mounted across property types. Brand Gap's focus includes hospitality/leisure and competing centres.
- `client/src/components/PropertyTenancySchedule.tsx:571–633`: the desktop default selects all 53 columns. The narrow-screen compact preset uses quoting rent even for the tenancy view.
- `client/src/pages/properties.tsx:2957–2962` accepts multiple asset classes on creation, but `property-detail.tsx:661` uses a single-choice detail editor, potentially replacing the mix.
- `PropertyTenancySchedule.tsx:599–602` forces client viewers to read-only rows. This needs a separate server/permission review against Woody's requirement for full edits within their permitted property/deal scope; do not reduce access through presentation presets.

## Confirmed enrichment reliability findings

- `property-detail.tsx:282–289,533–547`: Auto-enriching is inferred from a record under five minutes old and missing owner/title fields. It is not actual job status.
- `server/property-resolver.ts:648–707`: explicit enrichment discards `resolveBuildingTitles`' returned result, including structured failure. A no-network test with `{ok:false,status:503}` returned `{ok:true}` to its caller. This path does not apply returned title/proprietor fields to the selected CRM property. It passes `userId:null`, while Land Registry history persistence is gated on `userId` (`server/land-registry.ts:624`). It only optionally updates the VOA reference.
- `client/src/components/property-resolver-bar.tsx:389–429`: any HTTP-success response switches the button to Enriched without checking a success body or field completion. Its background-work message does not match the awaited endpoint.
- `server/chatbgp.ts:6799–6803`: `create_property` internally posts to the authenticated postcode auto-fill endpoint with no user credentials; `server/companies-house.ts:1601` requires authentication. The create response nevertheless advertises background enrichment at `chatbgp.ts:6827`.
- Normal CRM create/storage paths (`server/crm.ts:2426–2430`, `server/storage.ts:988–990`) do not start that enrichment job.

## Implementation order

1. Repair the creation/enrichment paths and success checks; explicitly apply verified results to the intended property.
2. Track durable step states: queued, running, complete, partial, not found, failed, needs review. Show evidence source, checked date and conflicts; preserve manual fields.
3. Prepare relevant facts in the background, prioritising active instructed properties. A building needs building-level identity, ownership, occupiers and key facts; a centre additionally needs unit/floor-level mapping and centre analysis. Chargeable or ambiguous title selection must follow the existing confirmation requirements.
4. Add the three view presets, a concise default schedule, progressive disclosure and consistent typography. Verify client editing rules against authorised scope.

These findings establish code defects and design causes. They do not establish the status of any particular live property's enrichment job or provider account.
