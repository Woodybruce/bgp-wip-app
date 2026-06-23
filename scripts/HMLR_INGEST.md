# HMLR Direct Ingest — setup guide

This is the foundation that replaces PropertyData's postcode-level wrappers
with deterministic local lookups. Once CCOD + OCOD are loaded, every
property feature in the app gets exact title + proprietor data for the
resolved property — no postcode noise, no API quota, no throttling.

## What's free vs paid (HMLR data catalogue)

| Dataset | Cost | What it gives us | Used in v1? |
|---|---|---|---|
| **UK companies that own property** (formerly CCOD) | Free | title_number → proprietor + address (UK companies) | YES — primary |
| **Overseas companies that own property** (formerly OCOD) | Free | title_number → proprietor + address (non-UK) | YES — primary |
| **INSPIRE Index Polygons** | Free | Polygon shapes only — no title_number | Optional (map shading) |
| **National Polygon Service** | £20k+VAT/yr | Polygons WITH title_number | NO — not justified yet |
| **Registered Leases** | Fee-dependent | title_number → leaseholder | NO — defer to v2 |
| **Price Paid Data** | Free | Transactions only | NO — already via PD |

The strategy: match the resolved property by **postcode + street number**
against CCOD/OCOD's `property_address` text. CCOD ships ~3M rows for UK
companies; OCOD adds ~100k for overseas. For BGP's commercial focus
that's >95% of what you'll look up.

The £20k NPS is what would let us do point-in-polygon → title. Not worth
it yet — address-text matching solves the immediate "wrong land regs"
problem without spending anything.

## What you need to do (~30 min one-time)

### 1. Create a free gov.uk account

Go to **https://use-land-property-data.service.gov.uk/** and register.
Free, just an email + password.

### 2. Download the two datasets

Once signed in:

- **UK companies that own property in England and Wales** — ~1.6 GB CSV.
  (Catalogue page calls out it was originally called CCOD.)
- **Overseas companies that own property in England and Wales** — ~37 MB CSV.
  (Originally OCOD.)

Each is a single CSV. Latest monthly file is what you want.

### 3. Apply the migration

```bash
npm run db:push
```

This enables the `pg_trgm` extension and creates the HMLR tables.
NOTE: this database has **no PostGIS** (it's not in `pg_available_extensions`
and can't be added on this plan), so the polygon layer is **PostGIS-free** —
boundaries are stored as GeoJSON (`jsonb`) + a numeric min/max lng/lat bbox,
and British National Grid → WGS84 reprojection is done in JS (proj4) at
ingest. No geometry types or spatial indexes are used; ownership lookups
use `pg_trgm` + btree, both standard.

### 4. Run the two ingests

Both scripts are idempotent — re-running with a fresh monthly file
just overwrites changed rows.

```bash
# UK companies (~3M rows after explosion — takes ~5-10 min)
npx tsx scripts/ingest-hmlr-proprietors.ts ./CCOD_FULL_2026_05.csv --dataset ccod

# Overseas companies (~100k rows — under a minute)
npx tsx scripts/ingest-hmlr-proprietors.ts ./OCOD_FULL_2026_05.csv --dataset ocod
```

Output looks like:

```
[ingest-hmlr-proprietors] file=./CCOD_FULL_2026_05.csv dataset=ccod batch=500 dry=false
[ingest-hmlr-proprietors] processed=10000 inserted=10000 updated=0 skipped=0
...
[ingest-hmlr-proprietors] DONE — processed=2987453 inserted=2987453 updated=0 skipped=0
```

Add `--dry` to validate the file format without writing anything.

### 5. Verify it's working

Open `psql` (or any Postgres client) and run:

```sql
-- Should be > 3M
SELECT count(*) FROM hmlr_proprietors;

-- Datasets present
SELECT dataset, count(*) FROM hmlr_proprietors GROUP BY dataset;

-- Spot check: 18-22 Haymarket, London SW1Y 4DG
SELECT title_number, proprietor_name, proprietor_category, tenure
FROM hmlr_proprietors
WHERE postcode_normalised = 'SW1Y4DG'
  AND lower(property_address) LIKE '18%';

-- All proprietors at one postcode
SELECT title_number, property_address, proprietor_name
FROM hmlr_proprietors
WHERE postcode_normalised = 'SW1Y4DG'
ORDER BY property_address;
```

If the queries return rows, the LR page (and Pathway, KYC, etc.) will
automatically pick up the local data on the next request. The bug fix:
`resolveBuildingTitles` now detects `hmlr_proprietors` is populated and
runs a postcode + street-number match against CCOD/OCOD as the primary
path. PropertyData becomes a fallback for properties NOT in CCOD/OCOD
(individually-owned residential, very fresh registrations, etc.).

You should see **one** correct title for 18-22 Haymarket, not 30.

## INSPIRE polygons for map shading

Boundaries on the property-intelligence map come from the free INSPIRE
Index Polygons. They have NO title_number, so they're purely visual.
Stored PostGIS-free: GeoJSON in a `jsonb` column + a numeric bbox (WGS84).

**Small / per-local-authority files** go through the app — an admin POSTs a
SharePoint share link to `POST /api/admin/hmlr/fetch-polygons-from-sharepoint`
(`{shareUrl, region}`); it streams, reprojects (27700→4326 via proj4), and
loads. Capped at ~500MB.

### National batch-load (~24M parcels / 5GB)

The national set is too big for the app route (Node's 2 GiB unzip limit, and
a multi-hour run would kill the web dyno). Load it OFFLINE with the CLI, on a
machine with ~40GB free disk + GDAL (`brew install gdal` / `apt install
gdal-bin`), against the prod DB's **PUBLIC** connection string (Railway
dashboard → Postgres → Connect → public URL; the `.railway.internal` host
only resolves inside Railway):

```bash
# 1. Unzip the national download — do NOT feed the 5GB zip to the app route.
unzip Use-Land-Property-Data.zip            # → one or more *.gml

# 2. GML → NDJSON, REPROJECTING British National Grid → WGS84.
#    -t_srs is ESSENTIAL: without it coords stay in EPSG:27700 and the ingest
#    (which assumes NDJSON is already 4326) stores them in the wrong place.
for f in *.gml; do
  ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -append national.ndjson "$f"
done

# 3. Load against prod — streams, batches, idempotent upsert on inspire_id,
#    progress tracked in hmlr_ingest_runs (dataset='inspire'). ~1-3 hours.
DATABASE_URL='<prod PUBLIC connection string>' \
  npx tsx scripts/ingest-hmlr-polygons.ts national.ndjson --region national
```

Before starting, confirm the DB has headroom (national is ~10-30GB):
`SELECT pg_size_pretty(pg_database_size(current_database()));`

If the load dies mid-run, just re-run it (idempotent), or split first so a
crash only costs one chunk: `split -l 2000000 national.ndjson chunk_` then
load each `chunk_*`. Query speed at national scale leans on plain bbox btree
indexes (no PostGIS GiST), so very zoomed-out views may lag.

## Refresh schedule

HMLR refreshes CCOD + OCOD monthly. After the first manual ingest you
can either:

- **Manual**: download + run the two ingests on the 1st of each month.
- **Automated** (later): a `scheduled_jobs` row that fires the download
  + ingest as a `run_shell_command` action. We'll wire this up in a
  follow-up commit once we've confirmed the manual flow works.

## Storage footprint

- `hmlr_proprietors`: ~600MB (~3M rows + indexes)
- `hmlr_title_polygons`: per-LA is tens of MB; **national (~24M parcels) is
  ~10-30GB** including bbox indexes — confirm the Railway DB plan has room
  before the national batch-load
- `hmlr_ingest_runs`: tiny

Without polygons, the whole HMLR foundation costs <1GB. Easy on any
Railway tier; the national polygon set is the one thing that needs a plan
with real storage headroom.

## What this replaces

Before: PropertyData `uprn-title` + `freeholds(postcode)` round-trips per
lookup. Postcode-wide noise. ~£0.01 per call. X14 throttle errors when
more than 6 calls in 10 seconds.

After: deterministic SQL match by postcode + street number against
CCOD/OCOD. Sub-10ms. £0 per call. The 18-22 Haymarket "shows 30
unrelated freeholds" problem disappears at the source.

PropertyData stays for:
- Properties not in CCOD/OCOD (residential / individuals)
- Title register PDF orders (~£3 each — paid through to HMLR)
- Valuation tools (`valuation-commercial-sale`, `rents-commercial`, etc.)
