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

  const keepQ = await pool.query(`SELECT * FROM crm_properties WHERE id = $1`, [keepId]);
  const mergeQ = await pool.query(`SELECT * FROM crm_properties WHERE id = $1`, [mergeId]);
  const keep = keepQ.rows[0];
  const dupe = mergeQ.rows[0];
  if (!keep) throw new Error(`Keeper property ${keepId} not found`);
  if (!dupe) throw new Error(`Duplicate property ${mergeId} not found`);

  // 1. Discover every referencing column in the schema.
  const colsQ = await pool.query(
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
      const r = await pool.query(
        `UPDATE ${table_name} SET ${column_name} = $1 WHERE ${column_name} = $2`,
        [keepId, mergeId]
      );
      if ((r.rowCount ?? 0) > 0) repointed[label] = r.rowCount ?? 0;
    } catch (e: any) {
      if (e?.code !== "23505") throw new Error(`Re-pointing ${label} failed: ${e?.message}`);
      // Row-by-row: move what can move, drop what collides.
      const ids = await pool.query(
        `SELECT ctid FROM ${table_name} WHERE ${column_name} = $1`,
        [mergeId]
      );
      let moved = 0;
      let dropped = 0;
      for (const row of ids.rows) {
        try {
          await pool.query(
            `UPDATE ${table_name} SET ${column_name} = $1 WHERE ctid = $2`,
            [keepId, row.ctid]
          );
          moved++;
        } catch (e2: any) {
          if (e2?.code !== "23505") throw new Error(`Re-pointing ${label} failed: ${e2?.message}`);
          await pool.query(`DELETE FROM ${table_name} WHERE ctid = $1`, [row.ctid]);
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
  const SKIP_FIELDS = new Set(["id", "created_at", "updated_at", "monday_item_id"]);
  const ARRAY_FIELDS = new Set(["bgp_engagement", "folder_teams", "team"]);
  const fieldsFilled: string[] = [];
  for (const [col, dupeVal] of Object.entries(dupe)) {
    if (SKIP_FIELDS.has(col)) continue;
    if (dupeVal === null || dupeVal === undefined || dupeVal === "") continue;
    const keepVal = (keep as any)[col];
    if (ARRAY_FIELDS.has(col) && Array.isArray(dupeVal)) {
      const existing = Array.isArray(keepVal) ? keepVal : [];
      const merged = [...new Set([...existing, ...dupeVal])];
      if (merged.length > existing.length) {
        await pool.query(`UPDATE crm_properties SET ${col} = $1 WHERE id = $2`, [merged, keepId]);
        fieldsFilled.push(col);
      }
      continue;
    }
    const keepEmpty = keepVal === null || keepVal === undefined || keepVal === ""
      || (Array.isArray(keepVal) && keepVal.length === 0);
    if (keepEmpty) {
      await pool.query(`UPDATE crm_properties SET ${col} = $1 WHERE id = $2`, [dupeVal, keepId]);
      fieldsFilled.push(col);
    }
  }

  // 4. Remove the duplicate.
  await pool.query(`DELETE FROM crm_properties WHERE id = $1`, [mergeId]);

  console.log(`[property-merge] ${dupe.name} (${mergeId}) merged into ${keep.name} (${keepId}):`, JSON.stringify({ repointed, duplicateRowsDropped, fieldsFilled }));

  return {
    keptId: keepId,
    keptName: keep.name,
    removedId: mergeId,
    removedName: dupe.name,
    repointed,
    duplicateRowsDropped,
    fieldsFilled,
  };
}

// Convenience: find likely duplicate properties by normalised name.
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
