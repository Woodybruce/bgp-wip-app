# HMLR Direct Ingest — setup guide

This is the foundation that replaces PropertyData's postcode-level wrappers
with deterministic local lookups. Once the data is loaded, every property
feature in the app (Pathway, Investigator, Land Registry page, KYC, comps)
gets exact title + proprietor data for the resolved UPRN — no postcode
noise, no API quota, no throttling.

## What you need to do (one-time, ~30 min)

### 1. Create a free gov.uk account for HMLR data downloads

Go to **https://use-land-property-data.service.gov.uk/** and register. It's
free (just an email + password). You'll need this for CCOD, OCOD and the
National Polygon Service.

### 2. Subscribe to the three datasets

Once signed in, on the dataset page click **"Download dataset"** for each:

- **National Polygon Service (NPS)** — title polygons + title numbers.
  This is the version of INSPIRE that includes title_no. Don't grab plain
  "INSPIRE Index Polygons" — it lacks title numbers and is useless for
  ownership lookups.
- **CCOD** — Commercial and Corporate Ownership Data (UK companies).
- **OCOD** — Overseas Companies Ownership Data.

Each dataset is a monthly file. Download the latest of each.

### 3. Convert NPS to NDJSON (one-time per refresh)

NPS ships as a single huge GeoJSON FeatureCollection (or GML, depending
on the format you pick). Our ingest expects NDJSON — one feature per
line — to avoid loading the whole file into memory.

```bash
# If you got GeoJSON:
jq -c '.features[]' Land_Registry_Cadastral_Parcels.geojson > polygons.ndjson

# If you got GML (requires GDAL — `brew install gdal` on macOS):
ogr2ogr -f GeoJSONSeq polygons.ndjson Land_Registry_Cadastral_Parcels.gml
```

CCOD and OCOD ship as CSV — no conversion needed.

### 4. Run the migration

```bash
# Apply migration 0014 (creates the HMLR tables + enables PostGIS)
npm run db:push
```

If Railway's Postgres rejects `CREATE EXTENSION postgis` (some plans
restrict superuser actions), open a support ticket — Railway adds
PostGIS on request. They've done this for our peers without issue.

### 5. Run the ingest scripts

Each script accepts a file path. They're idempotent (upsert on conflict)
so re-running with a fresh monthly file just overwrites changed rows.

```bash
# Title polygons (~22M rows for all of England & Wales — takes ~1-2hr).
# Add --region "London" to tag rows; useful if you want to bulk-purge
# a region later for re-ingest.
npx tsx scripts/ingest-hmlr-polygons.ts ./polygons.ndjson --region "England"

# Proprietors (~3M rows for CCOD, ~100k for OCOD — takes ~5-10 min each).
npx tsx scripts/ingest-hmlr-proprietors.ts ./CCOD_FULL_2026_05.csv --dataset ccod
npx tsx scripts/ingest-hmlr-proprietors.ts ./OCOD_FULL_2026_05.csv --dataset ocod
```

Output looks like:

```
[ingest-hmlr-polygons] file=./polygons.ndjson region=England batch=500 dry=false
[ingest-hmlr-polygons] processed=10000 inserted=10000 updated=0 skipped=0
...
[ingest-hmlr-polygons] DONE — processed=22043891 inserted=22043891 updated=0 skipped=0
```

Add `--dry` to validate the file format without writing anything.

### 6. Verify it's working

```sql
-- Should return >0
SELECT count(*) FROM hmlr_title_polygons;

-- Should return >0
SELECT count(*) FROM hmlr_proprietors;

-- Spot check: 18-22 Haymarket, London (centroid lat/lng ~51.50920, -0.13251)
SELECT title_number FROM hmlr_title_polygons
WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint(-0.13251, 51.50920), 4326));

-- Same property's proprietor(s)
SELECT proprietor_name, proprietor_category, company_registration_no
FROM hmlr_proprietors
WHERE title_number = ANY(
  SELECT title_number FROM hmlr_title_polygons
  WHERE ST_Contains(polygon, ST_SetSRID(ST_MakePoint(-0.13251, 51.50920), 4326))
);
```

If the queries return rows, the LR page (and Pathway, KYC, etc.) will
automatically pick up the local data on the next request — `resolveBuildingTitles`
detects `hmlr_title_polygons` is populated and uses it as the primary
source, falling back to PropertyData only for properties that aren't
in the local data (Scotland, very new registrations).

## Refresh schedule

HMLR refreshes all three datasets monthly. After the first manual ingest,
you can either:

- **Manual**: download + run the scripts on the 1st of each month.
- **Automated**: add a `scheduled_jobs` row that fires the download +
  ingest as a `run_shell_command` action. We'll wire this up in a
  follow-up commit once we've confirmed the manual flow works for you.

## Storage footprint

- `hmlr_title_polygons`: ~10GB for all England & Wales (~22M rows with
  PostGIS-encoded geometry + GIST index)
- `hmlr_proprietors`: ~500MB (~3M rows)
- `hmlr_ingest_runs`: tiny (one row per ingest)

If Railway's Postgres plan is tight on storage, you can ingest just
London + Greater London (~2M polygons, ~1GB) by filtering the NDJSON
before running the script:

```bash
# Only polygons where region matches a London borough
jq -c 'select(.properties.REGION_NAME | test("London|Westminster|Camden|Kensington"))' \
  polygons.ndjson > london.ndjson
```

## What this replaces

Before: PropertyData `uprn-title` + `freeholds(postcode)` round-trips
per property lookup. Postcode-wide noise. ~£0.01 per call. X14 throttle
errors when more than 6 calls in 10 seconds.

After: deterministic point-in-polygon SQL query. Sub-10ms. No quota.
The 18-22 Haymarket "shows 30 unrelated freeholds" problem disappears
at the source.

PropertyData stays wired in as a fallback for:
- Properties outside England & Wales (Scotland uses Registers of Scotland)
- Very new registrations not yet in INSPIRE (rare — usually a 2-3 month lag)
- Title register PDF orders (the actual deeds document — paid, ~£3 per title)
- Valuation tools (`valuation-commercial-sale`, `rents-commercial`, etc.)
