# App quality follow-up — 17 September 2026

This continues the functional review on JOGQK. Client access rules are unchanged. No production leases are merged and no historical contact employers or legal entities are reassigned by this change.

## Brand evidence

The old brand-action prompt required a growth/contraction story while its input contained static store/headcount totals and earlier AI commentary. The revised input uses actual active CRM requirements and dated, sourced site events. It treats requirements as recorded demand, not a recently reconfirmed mandate, and makes uncertainty explicit. Without usable evidence, it returns an unconfirmed-strategy brief without calling a model. A policy version invalidates earlier speculative brief caches. Legal-entity conflicts prevent linked financial conclusions being presented as established brand facts.

Brand-specific news linking now requires company-identity evidence. Common or short names need corroboration; a Google News feed's category and AI-generated summary do not prove the company match. The same check filters historical article-derived signals on brand/profile/pack reads without deleting source records. General industry feeds and structured staff signals are retained.

## Compliance display

The former “AML pass complete” label was based on documents and fields merely being populated. The card now distinguishes collected records from an explicit recorded KYC approval, rejection, expiry and unresolved screening results. Disagreement between the recorded trading entity/company number and the saved Companies House profile is explained as a review issue. Legal suffix and punctuation differences do not trigger that warning. No underlying approval or entity is rewritten, and existing records/actions retain their access rules.

## Plan review and duplicate leases

Scan counters describe unapplied proposals rather than missing units. A unique exact reference whose saved outline is protected shows that outline dashed beside the proposed boundary, with the original reason retained in the list. Protection remains enforced, and an overlap with a different saved unit is not treated as an exact match or resolved automatically.

Inspection of the manual tenancy merge found that deleting a secondary row could strand evidence-plan and property-plan links, and that multiple writes were not transactional. The fix transfers references as one transaction, retaining the chosen primary ID. Conflicting facts require review rather than being silently discarded. This makes an explicit merge safer; it does not decide which Brent Cross lease records should be merged.

Tenancy imports now normalize whitespace around slash and ampersand separators. A repeat such as `D17A / D17B / D18 / D19` matches `D17A/D17B/D18/D19` rather than creating a second row. Distinct floors, suites and ranges remain distinct; conflicting facts still enter import review.

## Validation

Focused component and logic checks cover misleading approval labels, recorded rejection/expiry, entity mismatches, protected scan comparisons and brand-evidence/news filtering. Synthetic desktop and 390px browser checks confirmed readable compliance cards and scan comparisons, preserved manual-outline protection and unselected ambiguous matches. These are layout checks, not physical iOS Safari certification.

Isolated PostgreSQL checks passed for all five brand evidence queries/cases and six tenancy-merge cases. The merge checks cover existing/future links, alternate and composite foreign keys, unchanged facts/geometry/evidence, rejected conflicts, a failed final delete, a unique live-deal conflict and concurrent opposite merge choices. Test schemas were disposable and no production records were merged.

The final combined regression suite passes all **607** tests. TypeScript and the production build pass. Deployment and live acceptance results are recorded separately after pushing this change.

## Limits

News matching is intentionally cautious and can omit a genuine short-name story with insufficient context. Provider descriptions, sources and stored requirement dates still require human judgment. Prompt grounding reduces unsupported conclusions but does not prove every generated sentence correct. Historical contact affiliations, financial records and duplicate leases still need record-level review. Existing production lease figures, references and evidence are preserved.
