# Target Structure — the unit spine

The structural spec the migration builds toward. Approve before any `schema.ts` change.
Principle: **every table points at the spine in ONE direction. No back-pointers, no
duplicated facts.** Physical facts live once on `property_units`; lease/income facts
live once on `tenancy_schedule_units`; everyone else reads through.

## Relationship model (target)

```
        property_units                    PHYSICAL MASTER (permanent, survives leases)
        ─ address, postcode, UPRN, floor
        ─ nia/gia/itza sqft, use_class, condition, EPC
              ▲
              │ property_unit_id   (NEW FK — does not exist today)
              │
        tenancy_schedule_units            LEASE / INCOME SPINE (one row per occupancy)
        ─ passing rent, ERV, quoting, lease dates, breaks, review, tenant
        ─ rates, service charge, insurance
        ─ occupancy, marketing_active, marketing_reason   (NEW)
              ▲                    ▲                     ▲
   tenancy_unit_id        tenancy_unit_id        tenancy_unit_id
              │                    │                     │
     available_units      leasing_schedule_units      crm_deals
     (marketing layer)    (client / Landsec view)     (deal terms; nullable link —
              │                                         building-level deals flagged)
              │
       unit_offers, unit_viewings   (children of the marketed unit)
```

Read direction: a board needs a physical fact → `child.tenancy_unit_id` →
`tenancy.property_unit_id` → `property_units`. One hop to the spine, one more to physical.

## Stage 1 — additive only (safe, no behaviour change)

```
tenancy_schedule_units
  + property_unit_id   varchar  -> property_units.id     (the missing physical link)
  + occupancy          text     Vacant | Trading | Holding Over | Lease Event Pending | Archived
  + marketing_active   boolean  default false
  + marketing_reason   text     Vacant | Lease Event | Tenant at Risk | Active Management

crm_deals
  + deal_scope         text     default 'unit'   ('unit' | 'building' | 'portfolio')
                                 building/portfolio deals keep tenancy_unit_id NULL BY DESIGN
```

Nothing dropped at Stage 1. Existing columns keep working via dual-write.

## What each table OWNS (single source of truth)

| Table | Owns |
|-------|------|
| `property_units` | address, postcode, UPRN, floor, **nia/gia/itza sqft**, use_class, condition, EPC, frontage |
| `tenancy_schedule_units` | passing rent, ERV, quoting/marketing rent, turnover, lease dates, breaks, review, term, tenant company/trading/mix/credit, rateable value, rates, service charge, insurance, **occupancy, marketing_active, marketing_reason** |
| `available_units` | marketing start, viewings count, agents (pre-deal owner), marketing collateral, restrictions, condition-for-ad |
| `leasing_schedule_units` | zone, positioning, priority, **target brands / optimum target**, client updates |
| `crm_deals` | deal status, agreed rent, fee, AML, dates, **date of entry (created_at)**, solicitor sub-journey, pricing/yield, parties + Xero entities |
| `unit_offers` / `unit_viewings` | competing offers / viewing records (1:many) |

## What gets RETIRED (later stages, only after read-through proven)

```
tenancy_schedule_units   - status                       (Stage 6, after deal-status owns it)
                         - letting_tracker_unit_id       (back-pointer; stale on 24/29 today)
                         - deal_id                       (cached; use crm_deals.tenancy_unit_id)
                         - target_tenants, target_company_ids   (own on leasing_schedule)
                         - epc_rating, nia/gia/itza_sqft, (physical → property_units)
                           use_class? condition?         (decide: keep measurement copy or move)

available_units          - unit_id (-> property_units)   (read physical via the spine)
                         - leasing_schedule_unit_id       (cross-link not needed)
                         - deal_id                        (use crm_deals.tenancy_unit_id)
                         - epc_rating, sqft, use_class, condition  (duplicated physical)

crm_deals                - unit_id (-> property_units)    (read physical via tenancy spine)
```

## Structural decisions to confirm

1. **available_units → spine only.** Drop its direct `unit_id`/`leasing_schedule_unit_id`/
   `deal_id`; reach physical + deal through `tenancy_unit_id`. (Relies on Add-Unit always
   creating the tenancy row — which the unified flow guarantees.) ✅ recommended.
2. **Areas move to property_units.** nia/gia/itza become physical facts on the master.
   Tenancy reads them through. ✅ recommended (matches two-layer decision).
3. **Building-level deals.** `deal_scope` flag; `tenancy_unit_id` legitimately NULL.
   No fake unit links. ✅ recommended.
4. **One live deal per unit** enforced by a partial unique index on
   `crm_deals (tenancy_unit_id) WHERE status NOT IN (terminal)`. Only 1 violation today.
```
