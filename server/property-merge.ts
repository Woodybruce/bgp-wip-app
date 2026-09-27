// Property merge — collapse a duplicate crm_properties row into the
// canonical one. Re-points EVERY table that references the property
// (discovered via information_schema, so new tables are covered
// automatically), fills gaps on the keeper from the duplicate, then
// deletes the duplicate row. Used by the admin endpoint and the
// ChatBGP merge_properties tool.

import { pool } from "./db";

const REF_COLUMNS = ["property_id", "crm_property_id", "linked_property_id"];

export interface MergeResult {
  keptId: string;
  keptName: string;
  removedId: string;
  removedName: string;
  repointed: Record<string, number>;
  duplicateRowsDropped: Record<string, number>;
  fieldsFilled: string[];
}

export async function mergeProperties(keepId: string, mergeId: string): Promise<MergeResult> {
  if (!keepId || !mergeId) throw new Error("Both keepId and mergeId are required");
  if (keepId === mergeId) throw new Error("keepId and mergeId are the same property");

  // One transaction: a failure part-way (a jsonb column once refused a
  // copied value) used to leave links moved and the duplicate still there.
  // Unique-key collisions are handled inside savepoints.
  const client = await pool.connect();
  const q = (sql: string, params: any[] = []) => client.query(sql, params);
  const attempt = async (sql: string, params: any[]) => {
    await q("SAVEPOINT merge_step");
    try { const r = await q(sql, params); await q("RELEASE SAVEPOINT merge_step"); return r; }
    catch (e) { await q("ROLLBACK TO SAVEPOINT merge_step"); throw e; }
  };
  try {
    await q("BEGIN");
    const keep = (await q(`SELECT * FROM crm_properties WHERE id = $1`, [keepId])).rows[0];
    const dupe = (await q(`SELECT * FROM crm_properties WHERE id = $1`, [mergeId])).rows[0];
    if (!keep) throw new Error(`Keeper property ${keepId} not found`);
    if (!dupe) throw new Error(`Duplicate property ${mergeId} not found`);

    // 1. Discover every referencing column in the schema.
    const colsQ = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = ANY($1)
          AND table_name <> 'crm_properties'
        ORDER BY table_name`,
      [REF_COLUMNS]
    );

    const repointed: Record<string, number> = {};
    const duplicateRowsDropped: Record<string, number> = {};

    // 2. Re-point each referencing table. Unique-constraint conflicts mean
    //    the keeper already has an identical row (same natural key), so the
    //    duplicate's row is redundant — drop it rather than orphan it.
    for (const { table_name, column_name } of colsQ.rows) {
      const label = `${table_name}.${column_name}`;
      try {
        const r = await attempt(`UPDATE ${table_name} SET ${column_name} = $1 WHERE ${column_name} = $2`, [keepId, mergeId]);
        if ((r.rowCount ?? 0) > 0) repointed[label] = r.rowCount ?? 0;
      } catch (e: any) {
        if (e?.code !== "23505") throw new Error(`Re-pointing ${label} failed: ${e?.message}`);
        // Row-by-row: move what can move, drop what collides.
        const ids = await q(`SELECT ctid FROM ${table_name} WHERE ${column_name} = $1`, [mergeId]);
        let moved = 0;
        let dropped = 0;
        for (const row of ids.rows) {
          try {
            await attempt(`UPDATE ${table_name} SET ${column_name} = $1 WHERE ctid = $2`, [keepId, row.ctid]);
            moved++;
          } catch (e2: any) {
            if (e2?.code !== "23505") throw new Error(`Re-pointing ${label} failed: ${e2?.message}`);
            await q(`DELETE FROM ${table_name} WHERE ctid = $1`, [row.ctid]);
            dropped++;
          }
        }
        if (moved > 0) repointed[label] = moved;
        if (dropped > 0) duplicateRowsDropped[label] = dropped;
      }
    }

    // 3. Fill gaps on the keeper from the duplicate — never overwrite a
    //    value the keeper already has. Arrays union; jsonb/scalars copy
    //    only when the keeper's is empty. Identity/audit columns skipped.
    //    json/jsonb values go in as JSON text (a JS array would otherwise be
    //    sent as a Postgres array literal).
    const types = new Map<string, string>((await q(`SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'crm_properties'`)).rows.map((r: any) => [r.column_name, r.data_type]));
    const isJson = (col: string) => /json/i.test(types.get(col) || "");
    const setCol = (col: string, value: any) => isJson(col)
      ? q(`UPDATE crm_properties SET ${col} = $1::jsonb WHERE id = $2`, [JSON.stringify(value), keepId])
      : q(`UPDATE crm_properties SET ${col} = $1 WHERE id = $2`, [value, keepId]);
    const SKIP_FIELDS = new Set(["id", "created_at", "updated_at", "monday_item_id"]);
    const ARRAY_FIELDS = new Set(["bgp_engagement", "folder_teams", "team"]);
    const fieldsFilled: string[] = [];
    for (const [col, dupeVal] of Object.entries(dupe)) {
      if (SKIP_FIELDS.has(col)) continue;
      if (dupeVal === null || dupeVal === undefined || dupeVal === "") continue;
      const keepVal = (keep as any)[col];
      if ((ARRAY_FIELDS.has(col) || (col === "aliases" && isJson(col))) && Array.isArray(dupeVal)) {
        const existing = Array.isArray(keepVal) ? keepVal : [];
        const merged = [...new Set([...existing, ...dupeVal])];
        if (merged.length > existing.length) { await setCol(col, merged); fieldsFilled.push(col); }
        continue;
      }
      const keepEmpty = keepVal === null || keepVal === undefined || keepVal === ""
        || (Array.isArray(keepVal) && keepVal.length === 0);
      if (keepEmpty) { await setCol(col, dupeVal); fieldsFilled.push(col); }
    }

    // 3b. Team links carry no unique key, so both copies survived a merge
    //     (Lucent showed each BGP agent twice) — keep one per person.
    await dedupePropertyAgents(keepId, q);

    // 4. Remove the duplicate.
    await q(`DELETE FROM crm_properties WHERE id = $1`, [mergeId]);
    await q("COMMIT");

    console.log(`[property-merge] ${dupe.name} (${mergeId}) merged into ${keep.name} (${keepId}):`, JSON.stringify({ repointed, duplicateRowsDropped, fieldsFilled }));
    return { keptId: keepId, keptName: keep.name, removedId: mergeId, removedName: dupe.name, repointed, duplicateRowsDropped, fieldsFilled };
  } catch (error) {
    await q("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function findDuplicateProperties(nameQuery?: string): Promise<Array<{ normalised: string; properties: Array<{ id: string; name: string; created_at: string; deals: number; units: number; files: number }> }>> {
  const clause = nameQuery ? `WHERE p.name ILIKE $1` : "";
  const params = nameQuery ? [`%${nameQuery}%`] : [];
  const q = await pool.query(
    `SELECT p.id, p.name, p.created_at,
            regexp_replace(lower(trim(p.name)), '[^a-z0-9]+', '', 'g') AS norm,
            (SELECT COUNT(*) FROM crm_deals d WHERE d.property_id = p.id) AS deals,
            (SELECT COUNT(*) FROM tenancy_schedule_units t WHERE t.property_id = p.id) AS units,
            (SELECT COUNT(*) FROM property_brochures b WHERE b.property_id = p.id)
              + (SELECT COUNT(*) FROM property_plans pl WHERE pl.property_id = p.id) AS files
       FROM crm_properties p ${clause}
      ORDER BY norm, p.created_at`,
    params
  ).catch(async () => {
    // property_brochures / property_plans may not exist on older DBs —
    // retry without the files count rather than failing the scan.
    return pool.query(
      `SELECT p.id, p.name, p.created_at,
              regexp_replace(lower(trim(p.name)), '[^a-z0-9]+', '', 'g') AS norm,
              (SELECT COUNT(*) FROM crm_deals d WHERE d.property_id = p.id) AS deals,
              (SELECT COUNT(*) FROM tenancy_schedule_units t WHERE t.property_id = p.id) AS units,
              0 AS files
         FROM crm_properties p ${clause}
        ORDER BY norm, p.created_at`,
      params
    );
  });

  const byNorm = new Map<string, any[]>();
  for (const row of q.rows) {
    if (!row.norm) continue;
    (byNorm.get(row.norm) || byNorm.set(row.norm, []).get(row.norm)!).push(row);
  }
  const groups: Array<{ normalised: string; properties: any[] }> = [];
  for (const [norm, rows] of byNorm) {
    if (rows.length > 1) {
      groups.push({
        normalised: norm,
        properties: rows.map(r => ({ id: r.id, name: r.name, created_at: r.created_at, deals: Number(r.deals), units: Number(r.units), files: Number(r.files) })),
      });
    }
  }
  return groups;
}

// One crm_property_agents row per person per property, keeping the most
// senior role (Lead, then Investment, Leasing, the rest).
const AGENT_RANK = (t: string) => `CASE ${t}.role WHEN 'Lead' THEN 0 WHEN 'Investment' THEN 1 WHEN 'Leasing' THEN 2 ELSE 3 END`;
export async function dedupePropertyAgents(propertyId?: string, run: (sql: string, params?: any[]) => Promise<any> = (sql, params) => pool.query(sql, params)): Promise<number> {
  const r = await run(
    `DELETE FROM crm_property_agents a USING crm_property_agents b
      WHERE a.property_id = b.property_id AND a.user_id = b.user_id AND a.ctid <> b.ctid
        AND (${AGENT_RANK("a")} > ${AGENT_RANK("b")} OR (${AGENT_RANK("a")} = ${AGENT_RANK("b")} AND a.ctid > b.ctid))
        ${propertyId ? "AND a.property_id = $1" : ""}`,
    propertyId ? [propertyId] : []);
  return r.rowCount || 0;
}
