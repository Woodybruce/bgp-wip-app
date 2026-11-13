// The admin back-fill for the company on the lease (tenancy_schedule_units.
// tenant_entity_id, a crm_trading_entities.id under the row's brand; NOT
// crm_deals.tenant_entity_id, which is a Xero ContactID). Build plan:
// docs/tenant-entity-plan-2026-11-13.md, section 6.
//
//   POST /api/admin/tenant-entity-backfill       { dryRun, propertyId?, pairs? }
//   POST /api/admin/tenant-entity-backfill/undo  { batch }
//
// It LINKS ONLY. It never creates a company record, never sets or changes a
// brand or a name, and never runs at boot or on a timer. Preview sorts every
// schedule row with a lease name and no company on the lease into the groups
// below, in two queries for the whole app, with the name keys the schedule
// uses (brandNameKeySql). Only link_existing can be applied: a confirmed
// brand (its own name key is the row's trading-name key) with exactly one
// verified company under it (a Companies House number, or the brand's
// default) whose key is the lease name's key. Every other group is a list
// for a person.
//
// The dry run is recorded under tenant_entity_backfill:dry_run with the
// link_existing rows it showed, each with its names and brand. Apply is
// refused without one in the last hour, runs the preview again on live data
// and links only the (brand, lease key) pairs an admin ticked, and of those
// only rows whose names, brand and company on the lease are exactly as the
// preview showed and which still link the same company. One statement per
// property. Each linked row gets one investment_comp_migration_log row, and
// the run (with the rows it linked) is appended to tenant_entity_backfill:runs.
// Undo puts back no company on the lease on the rows that batch linked that
// still hold that link; it creates and deletes no companies.
import type { Pool } from "pg";
import { namedTenant } from "@shared/property-units";
import { brandNameKeySql } from "./tenant-brand-resolver";

export const DRY_RUN_KEY = "tenant_entity_backfill:dry_run";
export const RUNS_KEY = "tenant_entity_backfill:runs";
const DRY_RUN_TTL_MS = 60 * 60_000;
const LIST_PAIRS = 200;
const LIST_ROWS = 25;

export const TENANT_ENTITY_GROUPS = [
  "link_existing", "entity_unverified", "brand_unconfirmed", "create_candidates", "lease_in_brand_name",
  "ambiguous", "looks_like_person_or_landlord", "no_brand", "entity_drift",
] as const;
export type TenantEntityGroup = (typeof TENANT_ENTITY_GROUPS)[number];

export type BackfillEntity = { id: string; name: string; companiesHouseNumber: string | null; isDefault: boolean; verified: boolean };
export type BackfillRow = {
  id: string; propertyId: string | null; propertyName: string | null; unitNumber: string | null;
  tenantName: string | null; tradingName: string | null; brandId: string | null;
  /** entity_drift only: the company on the lease the row holds now. */
  entityId?: string | null;
};
export type BackfillPair = {
  key: string; group: TenantEntityGroup; brandId: string | null; brandName: string | null; leaseKey: string;
  entities: BackfillEntity[]; rowCount: number; rows: BackfillRow[];
};
export type TenantEntityPreview = {
  dryRun: true; previewedAt: string; propertyId: string | null;
  counts: Record<TenantEntityGroup, number> & { considered: number };
  groups: Record<TenantEntityGroup, { pairCount: number; truncated: boolean; pairs: BackfillPair[] }>;
  runs: TenantEntityRun[];
};
type RecordedRow = { id: string; tenant_name: string | null; trading_name: string | null; tenant_company_id: string | null };
type DryRun = { at: string; by: string | null; propertyId: string | null; counts: Record<string, number>; pairs: Record<string, { entityId: string; rows: RecordedRow[] }> };
export type TenantEntityRun = {
  kind: "apply" | "undo"; at: string; by: string | null; byName: string | null; batch: string; propertyId?: string | null;
  undoOf?: string; undoneAt?: string; undoneBy?: string | null;
  counts: Record<string, number>;
  /** apply: every row the batch linked and the company it linked. */
  linked?: Array<{ id: string; entityId: string }>;
};

const refusal = (status: number, message: string) => Object.assign(new Error(message), { status });

async function readSetting<T = any>(pool: Pool, key: string): Promise<T | null> {
  const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
  return (r.rows[0]?.value as T) ?? null;
}
async function writeSetting(pool: Pool, key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
}
async function readRuns(pool: Pool): Promise<TenantEntityRun[]> {
  const runs = await readSetting<TenantEntityRun[]>(pool, RUNS_KEY);
  return Array.isArray(runs) ? runs : [];
}
async function actorName(pool: Pool, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const r = await pool.query(`SELECT name, email, username FROM users WHERE id = $1 LIMIT 1`, [userId]);
  const u = r.rows[0];
  return u ? (u.name || u.email || u.username || null) : null;
}

// The brand key drops "Holdings", "Group", "UK", "plc" and the like, so
// "Pret A Manger Holdings" and "Pret A Manger UK Limited" share one. A link
// also needs the full legal names to agree, with only Ltd / Limited and the
// spellings of plc read as the same.
const legalNameKeySql = (expr: string) =>
  `btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(${expr}, ''))), '\\s+ltd\\.?$', ' limited'), '\\s+public\\s+limited\\s+company$', ' plc'), '\\s+p\\.l\\.c\\.?$', ' plc'), '[[:space:][:punct:]]+', ' ', 'g'))`;

const notArchived = (a: string) =>
  `lower(btrim(coalesce(${a}.status, ''))) <> 'archived' AND lower(btrim(coalesce(${a}.occupancy_status, ''))) <> 'archived'`;

// Every company on the lease with its brand merge-resolved (a brand merged
// away counts as the live brand it was merged into; none when that is merged
// too), grouped by brand and name key.
const ENTITY_GROUPS_CTE = `ents AS (
    SELECT te.id, te.name, nullif(btrim(te.companies_house_number), '') AS ch, te.is_default,
           CASE WHEN p.merged_into_id IS NULL THEN p.id ELSE s.id END AS parent_id,
           ${brandNameKeySql("te.name")} AS k, ${legalNameKeySql("te.name")} AS lk
      FROM crm_trading_entities te
      JOIN crm_companies p ON p.id = te.parent_company_id
      LEFT JOIN crm_companies s ON s.id = p.merged_into_id AND s.merged_into_id IS NULL
  ),
  ent_groups AS (
    SELECT parent_id, k, count(*)::int AS n,
           count(*) FILTER (WHERE ch IS NOT NULL OR is_default)::int AS n_verified, min(lk) AS lk,
           json_agg(json_build_object('id', id, 'name', name, 'companiesHouseNumber', ch, 'isDefault', is_default,
                                      'verified', ch IS NOT NULL OR is_default) ORDER BY id) AS entities
      FROM ents
     WHERE parent_id IS NOT NULL AND k <> ''
     GROUP BY parent_id, k
  )`;

// The rows with a lease name and no company on the lease, each in one group.
// A confirmed brand is a live brand whose own name key is the row's trading-
// name key: any other stored brand may have come from the old first-match
// resolver or the AI trading-name finder. A verified company has a Companies
// House number or is the brand's default: others may be boot copies of names
// the trading-name finder chose. Lease in the brand's name is worked out as
// the schedule GET works out lease_in_brand_name.
const UNLINKED_SQL = `WITH ${ENTITY_GROUPS_CTE},
  other_keys AS (
    SELECT k, array_agg(id) AS ids FROM (
      SELECT ${brandNameKeySql("c.name")} AS k, c.id
        FROM crm_companies c
       WHERE c.merged_into_id IS NULL AND c.company_type IS NOT NULL AND c.company_type NOT ILIKE 'tenant%'
    ) o
     WHERE k <> ''
     GROUP BY k
  ),
  unlinked AS (
    SELECT t.id, t.property_id, p.name AS property_name, t.unit_number, t.tenant_name, t.trading_name, t.tenant_company_id,
           b.name AS brand_name, (b.id IS NOT NULL AND b.merged_into_id IS NULL) AS brand_live,
           ${brandNameKeySql("t.tenant_name")} AS lease_key, ${legalNameKeySql("t.tenant_name")} AS lease_legal_key,
           ${brandNameKeySql("t.trading_name")} AS trading_key,
           CASE WHEN b.merged_into_id IS NULL THEN ${brandNameKeySql("b.name")} END AS brand_key
      FROM tenancy_schedule_units t
      LEFT JOIN crm_properties p ON p.id = t.property_id
      LEFT JOIN crm_companies b ON b.id = t.tenant_company_id
     WHERE t.tenant_entity_id IS NULL
       AND ${notArchived("t")}
       AND btrim(coalesce(t.tenant_name, '')) <> ''
       AND ($1::varchar IS NULL OR t.property_id = $1)
  )
  SELECT u.id, u.property_id, u.property_name, u.unit_number, u.tenant_name, u.trading_name, u.tenant_company_id, u.brand_name,
         u.lease_key, eg.entities,
         CASE
           WHEN u.tenant_company_id IS NULL THEN 'no_brand'
           WHEN u.lease_key <> '' AND (u.lease_key = u.trading_key OR u.lease_key = coalesce(u.brand_key, '')) THEN 'lease_in_brand_name'
           WHEN NOT u.brand_live OR u.trading_key = '' OR u.brand_key IS DISTINCT FROM u.trading_key THEN 'brand_unconfirmed'
           WHEN coalesce(eg.n, 0) >= 2 THEN 'ambiguous'
           WHEN eg.n = 1 AND eg.lk IS DISTINCT FROM u.lease_legal_key THEN 'ambiguous'
           WHEN eg.n = 1 AND eg.n_verified = 1 THEN 'link_existing'
           WHEN eg.n = 1 THEN 'entity_unverified'
           WHEN u.tenant_name ~* '^\\s*(mr|mrs|ms|miss|dr)\\.?\\s'
             OR cardinality(array_remove(ok.ids, u.tenant_company_id)) > 0
             THEN 'looks_like_person_or_landlord'
           ELSE 'create_candidates'
         END AS grp
    FROM unlinked u
    LEFT JOIN ent_groups eg ON eg.parent_id = u.tenant_company_id AND eg.k = u.lease_key
    LEFT JOIN other_keys ok ON ok.k = u.lease_key
   ORDER BY u.property_name NULLS LAST, u.unit_number NULLS LAST, u.id`;

// Rows with a company on the lease whose merge-resolved brand is not the row's brand.
const DRIFT_SQL = `SELECT t.id, t.property_id, p.name AS property_name, t.unit_number, t.tenant_name, t.trading_name, t.tenant_company_id,
         b.name AS brand_name, t.tenant_entity_id, ${brandNameKeySql("t.tenant_name")} AS lease_key,
         CASE WHEN te.id IS NULL THEN '[]'::json ELSE json_build_array(json_build_object('id', te.id, 'name', te.name,
           'companiesHouseNumber', nullif(btrim(te.companies_house_number), ''), 'isDefault', te.is_default,
           'verified', nullif(btrim(te.companies_house_number), '') IS NOT NULL OR te.is_default)) END AS entities
    FROM tenancy_schedule_units t
    LEFT JOIN crm_properties p ON p.id = t.property_id
    LEFT JOIN crm_companies b ON b.id = t.tenant_company_id
    LEFT JOIN crm_trading_entities te ON te.id = t.tenant_entity_id
    LEFT JOIN crm_companies pc ON pc.id = te.parent_company_id
    LEFT JOIN crm_companies ps ON ps.id = pc.merged_into_id AND ps.merged_into_id IS NULL
   WHERE t.tenant_entity_id IS NOT NULL
     AND ${notArchived("t")}
     AND ($1::varchar IS NULL OR t.property_id = $1)
     AND (t.tenant_company_id IS NULL
          OR (CASE WHEN pc.merged_into_id IS NULL THEN pc.id ELSE ps.id END) IS DISTINCT FROM t.tenant_company_id)
   ORDER BY p.name NULLS LAST, t.unit_number NULLS LAST, t.id`;

export const pairKey = (brandId: string | null, leaseKey: string) => `${brandId ?? ""}::${leaseKey}`;

const toRow = (r: any, withEntity: boolean): BackfillRow => ({
  id: r.id, propertyId: r.property_id ?? null, propertyName: r.property_name ?? null, unitNumber: r.unit_number ?? null,
  tenantName: r.tenant_name ?? null, tradingName: r.trading_name ?? null, brandId: r.tenant_company_id ?? null,
  ...(withEntity ? { entityId: r.tenant_entity_id ?? null } : {}),
});

type Classified = { group: TenantEntityGroup; key: string; raw: any }[];

async function classify(pool: Pool, propertyId: string | null): Promise<{ unlinked: Classified; drift: Classified }> {
  const [unlinked, drift] = await Promise.all([pool.query(UNLINKED_SQL, [propertyId]), pool.query(DRIFT_SQL, [propertyId])]);
  // The schedule's one rule for a real tenant name: VACANT, TBC, "-" are none.
  const named = unlinked.rows.filter((r: any) => namedTenant(r.tenant_name));
  return {
    unlinked: named.map((r: any) => ({ group: r.grp as TenantEntityGroup, key: pairKey(r.tenant_company_id, r.lease_key), raw: r })),
    drift: drift.rows.map((r: any) => ({ group: "entity_drift" as const, key: pairKey(r.tenant_company_id, r.lease_key), raw: r })),
  };
}

function toGroups(rows: Classified): TenantEntityPreview["groups"] {
  const byGroup = new Map<TenantEntityGroup, Map<string, BackfillPair>>(TENANT_ENTITY_GROUPS.map(g => [g, new Map()]));
  for (const { group, key, raw } of rows) {
    const pairs = byGroup.get(group)!;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { key, group, brandId: raw.tenant_company_id ?? null, brandName: raw.brand_name ?? null, leaseKey: raw.lease_key ?? "", entities: Array.isArray(raw.entities) ? raw.entities : [], rowCount: 0, rows: [] };
      pairs.set(key, pair);
    }
    pair.rowCount += 1;
    pair.rows.push(toRow(raw, group === "entity_drift"));
  }
  const out = {} as TenantEntityPreview["groups"];
  for (const g of TENANT_ENTITY_GROUPS) {
    const all = [...byGroup.get(g)!.values()].sort((a, b) => b.rowCount - a.rowCount || (a.brandName || "").localeCompare(b.brandName || "") || a.leaseKey.localeCompare(b.leaseKey));
    // The group that can be applied is listed whole: every pair an admin may tick.
    if (g === "link_existing") { out[g] = { pairCount: all.length, truncated: false, pairs: all }; continue; }
    const shown = all.slice(0, LIST_PAIRS).map(p => ({ ...p, rows: p.rows.slice(0, LIST_ROWS) }));
    out[g] = { pairCount: all.length, truncated: all.length > LIST_PAIRS || shown.some(p => p.rows.length < p.rowCount), pairs: shown };
  }
  return out;
}

export async function previewTenantEntityBackfill(pool: Pool, propertyId: string | null): Promise<TenantEntityPreview & { recorded: DryRun["pairs"] }> {
  const { unlinked, drift } = await classify(pool, propertyId);
  const all = [...unlinked, ...drift];
  const counts = Object.fromEntries(TENANT_ENTITY_GROUPS.map(g => [g, 0])) as TenantEntityPreview["counts"];
  for (const r of all) counts[r.group] += 1;
  counts.considered = unlinked.length;
  const recorded: DryRun["pairs"] = {};
  for (const { group, key, raw } of unlinked) {
    if (group !== "link_existing") continue;
    const entity = (raw.entities as BackfillEntity[])[0];
    const pair = recorded[key] ||= { entityId: entity.id, rows: [] };
    pair.rows.push({ id: raw.id, tenant_name: raw.tenant_name ?? null, trading_name: raw.trading_name ?? null, tenant_company_id: raw.tenant_company_id ?? null });
  }
  const runs = (await readRuns(pool)).slice(-10).reverse().map(({ linked, ...run }) => run);
  return { dryRun: true, previewedAt: new Date().toISOString(), propertyId, counts, groups: toGroups(all), runs, recorded };
}

const sameRow = (a: RecordedRow, b: RecordedRow) =>
  a.tenant_name === b.tenant_name && a.trading_name === b.trading_name && a.tenant_company_id === b.tenant_company_id;

const entityNote = (e: BackfillEntity) =>
  `${e.name} (${e.id}, ${e.companiesHouseNumber ? `CH ${e.companiesHouseNumber}` : "no CH number, the brand's default company"})`;

export async function runTenantEntityBackfill(pool: Pool, opts: { dryRun: boolean; by: string | null; propertyId?: string | null; pairs?: unknown; previewedAt?: unknown }) {
  if (opts.dryRun) {
    const propertyId = typeof opts.propertyId === "string" && opts.propertyId.trim() ? opts.propertyId.trim() : null;
    const { recorded, ...preview } = await previewTenantEntityBackfill(pool, propertyId);
    const dry: DryRun = { at: preview.previewedAt, by: opts.by, propertyId, counts: preview.counts, pairs: recorded };
    await writeSetting(pool, DRY_RUN_KEY, dry);
    return preview;
  }

  const dry = await readSetting<DryRun>(pool, DRY_RUN_KEY);
  if (!dry?.at || Date.now() - new Date(dry.at).getTime() > DRY_RUN_TTL_MS || !dry.pairs) {
    throw refusal(409, "Preview first. Apply only runs within an hour of a preview.");
  }
  // The ticks must come from the preview this admin is looking at: not one
  // another admin made since, nor an earlier one of their own.
  if (!opts.by || dry.by !== opts.by || opts.previewedAt !== dry.at) {
    throw refusal(409, "The preview has changed since you saw it. Preview again, then apply.");
  }
  const ticked = Array.isArray(opts.pairs) ? [...new Set(opts.pairs.filter((p): p is string => typeof p === "string"))] : [];
  if (!ticked.length) throw refusal(400, "Tick the pairs to link, from the preview.");

  // Live data, the same scope as the recorded preview.
  const { unlinked } = await classify(pool, dry.propertyId ?? null);
  const live = new Map<string, { key: string; entity: BackfillEntity; row: RecordedRow; propertyId: string | null }>();
  for (const { group, key, raw } of unlinked) {
    if (group !== "link_existing") continue;
    live.set(raw.id, { key, entity: (raw.entities as BackfillEntity[])[0], propertyId: raw.property_id ?? null,
      row: { id: raw.id, tenant_name: raw.tenant_name ?? null, trading_name: raw.trading_name ?? null, tenant_company_id: raw.tenant_company_id ?? null } });
  }

  const notPreviewed: string[] = [];
  const skipped: Array<{ id: string; pair: string; reason: string }> = [];
  const wanted = new Map<string, Array<{ id: string; entityId: string; entity: BackfillEntity; row: RecordedRow; pair: string }>>();
  for (const key of ticked) {
    const pair = dry.pairs[key];
    if (!pair) { notPreviewed.push(key); continue; }
    for (const rec of pair.rows) {
      const now = live.get(rec.id);
      if (!now || now.key !== key || !sameRow(now.row, rec)) { skipped.push({ id: rec.id, pair: key, reason: "The row's names, brand or company on the lease changed since the preview." }); continue; }
      if (now.entity.id !== pair.entityId) { skipped.push({ id: rec.id, pair: key, reason: "The company it would link is not the one the preview showed." }); continue; }
      const list = wanted.get(now.propertyId ?? "") || [];
      list.push({ id: rec.id, entityId: pair.entityId, entity: now.entity, row: rec, pair: key });
      wanted.set(now.propertyId ?? "", list);
    }
  }

  const at = new Date().toISOString();
  const batch = `tenant-entity-backfill-${at}`;
  const byName = await actorName(pool, opts.by);
  const linked: Array<{ id: string; entityId: string }> = [];
  const failed: Array<{ propertyId: string; error: string }> = [];
  for (const [propertyId, rows] of wanted) {
    // One statement per property: the link is made only while the row is
    // exactly as previewed, and each link writes its audit row with it.
    try {
      const r = await pool.query(
        `WITH want AS (
           SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::text[], $4::text[], $5::varchar[], $6::text[])
             AS w(id, entity_id, tenant_name, trading_name, company_id, note)
         ),
         linked AS (
           UPDATE tenancy_schedule_units t
              SET tenant_entity_id = w.entity_id, updated_at = now()
             FROM want w
            WHERE t.id = w.id
              AND t.tenant_entity_id IS NULL
              AND t.tenant_name IS NOT DISTINCT FROM w.tenant_name
              AND t.trading_name IS NOT DISTINCT FROM w.trading_name
              AND t.tenant_company_id IS NOT DISTINCT FROM w.company_id
              AND EXISTS (
                SELECT 1 FROM crm_trading_entities te
                  JOIN crm_companies pc ON pc.id = te.parent_company_id
                  LEFT JOIN crm_companies ps ON ps.id = pc.merged_into_id AND ps.merged_into_id IS NULL
                 WHERE te.id = w.entity_id
                   AND (CASE WHEN pc.merged_into_id IS NULL THEN pc.id ELSE ps.id END) = w.company_id
                   AND (nullif(btrim(te.companies_house_number), '') IS NOT NULL OR te.is_default))
           RETURNING t.id, w.entity_id, w.company_id, w.note
         )
         INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note)
         SELECT $7, 'tenancy_schedule_units', l.id, 'entity_linked',
                jsonb_build_object('tenant_entity_id', NULL, 'tenant_company_id', l.company_id), l.note
           FROM linked l
         RETURNING record_id`,
        [rows.map(x => x.id), rows.map(x => x.entityId), rows.map(x => x.row.tenant_name), rows.map(x => x.row.trading_name),
          rows.map(x => x.row.tenant_company_id), rows.map(x => `link_existing: ${entityNote(x.entity)} for lease name '${x.row.tenant_name ?? ""}'`), batch]);
      const done = new Set(r.rows.map((x: any) => x.record_id));
      for (const x of rows) {
        if (done.has(x.id)) linked.push({ id: x.id, entityId: x.entityId });
        else skipped.push({ id: x.id, pair: x.pair, reason: "The row changed while it was being linked." });
      }
    } catch (e: any) {
      failed.push({ propertyId, error: e?.message || String(e) });
    }
  }

  const counts = { linked: linked.length, skipped: skipped.length, notPreviewed: notPreviewed.length, failed: failed.length, pairs: ticked.length };
  const run: TenantEntityRun = { kind: "apply", at, by: opts.by, byName, batch, propertyId: dry.propertyId ?? null, counts, linked };
  await writeSetting(pool, RUNS_KEY, [...(await readRuns(pool)), run]);
  await pool.query(`DELETE FROM system_settings WHERE key = $1`, [DRY_RUN_KEY]);
  return { dryRun: false as const, batch, appliedAt: at, by: opts.by, byName, propertyId: dry.propertyId ?? null, counts, linked, skipped, notPreviewed, failed };
}

/** Put back no company on the lease on the rows the batch linked that still
 *  hold the company it linked. Brands and names are left as they are now. */
export async function undoTenantEntityBackfill(pool: Pool, opts: { batch: unknown; by: string | null }) {
  const batch = typeof opts.batch === "string" ? opts.batch.trim() : "";
  if (!batch) throw refusal(400, "Say which batch to undo.");
  const runs = await readRuns(pool);
  const run = runs.find(r => r.kind === "apply" && r.batch === batch);
  if (!run) throw refusal(404, "No back-fill batch by that name.");
  if (run.undoneAt) throw refusal(409, `This batch was undone on ${new Date(run.undoneAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}.`);
  const linked = Array.isArray(run.linked) ? run.linked : [];
  const at = new Date().toISOString();
  const undoBatch = `${batch}-undo-${at}`;
  const r = await pool.query(
    `WITH done AS (
       SELECT l.record_id AS id, w.entity_id, l.prior
         FROM investment_comp_migration_log l
         JOIN unnest($2::varchar[], $3::varchar[]) AS w(id, entity_id) ON w.id = l.record_id
        WHERE l.batch = $1 AND l.table_name = 'tenancy_schedule_units' AND l.action = 'entity_linked'
     ),
     restored AS (
       UPDATE tenancy_schedule_units t
          SET tenant_entity_id = d.prior->>'tenant_entity_id', updated_at = now()
         FROM done d
        WHERE t.id = d.id AND t.tenant_entity_id = d.entity_id
       RETURNING t.id, d.entity_id, t.tenant_company_id
     )
     INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note)
     SELECT $4, 'tenancy_schedule_units', x.id, 'entity_cleared',
            jsonb_build_object('tenant_entity_id', x.entity_id, 'tenant_company_id', x.tenant_company_id), 'undo of ' || $1
       FROM restored x
     RETURNING record_id`,
    [batch, linked.map(x => x.id), linked.map(x => x.entityId), undoBatch]);
  const restored = r.rows.map((x: any) => x.record_id as string);
  const byName = await actorName(pool, opts.by);
  const counts = { restored: restored.length, changedSince: linked.length - restored.length };
  const latest = await readRuns(pool);
  const updated = latest.map(x => (x.kind === "apply" && x.batch === batch ? { ...x, undoneAt: at, undoneBy: opts.by } : x));
  updated.push({ kind: "undo", at, by: opts.by, byName, batch: undoBatch, undoOf: batch, counts });
  await writeSetting(pool, RUNS_KEY, updated);
  return { batch: undoBatch, undoOf: batch, undoneAt: at, by: opts.by, byName, counts, restored };
}
