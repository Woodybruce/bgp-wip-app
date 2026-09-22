// ─────────────────────────────────────────────────────────────────────────
// Tenancy schedule row reconciliation.
//
// Different imports landed rent and lease data on DIFFERENT rows for the
// same physical unit (one import created rows carrying passing rent, a
// second created parallel rows carrying lease expiries) — so almost no row
// holds both, which breaks rent-weighted WAULT, the passing-rent headline
// coverage, and any expiry-vs-income board.
//
// This module merges those split rows: within one property, rows sharing a
// unit number whose tenants don't conflict are collapsed onto a single
// keeper row, null fields filled from the donors, references re-pointed,
// donors deleted. Conservative by design — any conflict on tenant, rent or
// expiry makes the group AMBIGUOUS and it is left untouched and reported.
//
// Always run dryRun first (the default): it returns the full merge plan and
// what coverage would become, without touching a row.
// ─────────────────────────────────────────────────────────────────────────
import { pool } from "./db";

const norm = (s: string | null | undefined) =>
  (s || "").toLowerCase().replace(/^unit\s+/, "").replace(/\s+/g, " ").trim();

// Fields that must not disagree between rows being merged.
const CONFLICT_FIELDS = ["tenant_name", "trading_name", "passing_rent_pa", "lease_expiry"];

// Columns never copied from a donor.
const SKIP_COLUMNS = new Set(["id", "property_id", "unit_number", "created_at", "updated_at", "sort_order"]);

interface MergePlan {
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  keeperId: string;
  donorIds: string[];
  fieldsGained: string[];
  tenant: string | null;
}

interface AmbiguousGroup {
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  rowIds: string[];
  reason: string;
}

export interface ReconcileReport {
  applied: boolean;
  rowsScanned: number;
  duplicateGroups: number;
  merges: MergePlan[];
  ambiguous: AmbiguousGroup[];
  coverage: {
    withRent: number;
    withExpiry: number;
    withBothBefore: number;
    withBothAfter: number; // projected on dry run, actual after apply
  };
}

const populatedCount = (row: Record<string, any>) =>
  Object.entries(row).filter(([k, v]) => !SKIP_COLUMNS.has(k) && v !== null && v !== undefined && v !== "").length;

const valuesConflict = (a: any, b: any, field: string): boolean => {
  if (a === null || a === undefined || a === "" || b === null || b === undefined || b === "") return false;
  if (field === "tenant_name" || field === "trading_name") return norm(String(a)) !== norm(String(b));
  if (field === "lease_expiry") return new Date(a).getTime() !== new Date(b).getTime();
  return Number(a) !== Number(b);
};

async function coverageQuery(propertyIds: string[] | null): Promise<{ withRent: number; withExpiry: number; withBoth: number }> {
  const where = propertyIds ? `WHERE property_id = ANY($1)` : "";
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE passing_rent_pa IS NOT NULL AND passing_rent_pa > 0) AS with_rent,
            COUNT(*) FILTER (WHERE lease_expiry IS NOT NULL) AS with_expiry,
            COUNT(*) FILTER (WHERE passing_rent_pa IS NOT NULL AND passing_rent_pa > 0 AND lease_expiry IS NOT NULL) AS with_both
       FROM tenancy_schedule_units ${where}`,
    propertyIds ? [propertyIds] : []
  );
  return {
    withRent: parseInt(r.rows[0].with_rent),
    withExpiry: parseInt(r.rows[0].with_expiry),
    withBoth: parseInt(r.rows[0].with_both),
  };
}

export async function reconcileTenancyRows(opts: { propertyId?: string | null; apply?: boolean } = {}): Promise<ReconcileReport> {
  const { propertyId = null, apply = false } = opts;

  const rowsRes = await pool.query(
    `SELECT t.*, p.name AS __property_name
       FROM tenancy_schedule_units t
       JOIN crm_properties p ON p.id = t.property_id
      ${propertyId ? "WHERE t.property_id = $1" : ""}
      ORDER BY p.name, t.unit_number`,
    propertyId ? [propertyId] : []
  );
  const rows = rowsRes.rows;

  // Tables pointing at tenancy_schedule_units.id — discovered, not hardcoded,
  // so a future tenancy_unit_id column is re-pointed too.
  const refRes = await pool.query(
    `SELECT table_name FROM information_schema.columns
      WHERE column_name = 'tenancy_unit_id' AND table_schema = 'public'
        AND table_name <> 'tenancy_schedule_units'`
  );
  const refTables: string[] = refRes.rows.map((r: any) => r.table_name);

  // Group by property + normalised unit number.
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.property_id}::${norm(row.unit_number)}`;
    if (!norm(row.unit_number)) continue; // blank unit numbers can't anchor a merge
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const merges: MergePlan[] = [];
  const ambiguous: AmbiguousGroup[] = [];
  let duplicateGroups = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    duplicateGroups++;

    // Keeper = the most-populated row; expiry-carrying rows win ties so the
    // canonical lease record survives.
    const sorted = [...group].sort((a, b) => {
      const d = populatedCount(b) - populatedCount(a);
      if (d !== 0) return d;
      return (b.lease_expiry ? 1 : 0) - (a.lease_expiry ? 1 : 0);
    });
    const keeper = sorted[0];
    const donors = sorted.slice(1);

    const conflictField = donors
      .flatMap(d => CONFLICT_FIELDS.map(f => (valuesConflict(keeper[f], d[f], f) ? f : null)))
      .find(Boolean);
    if (conflictField) {
      ambiguous.push({
        propertyId: keeper.property_id,
        propertyName: keeper.__property_name,
        unitNumber: keeper.unit_number,
        rowIds: group.map((r: any) => r.id),
        reason: `rows disagree on ${conflictField} — needs a human decision`,
      });
      continue;
    }

    const fieldsGained: string[] = [];
    for (const donor of donors) {
      for (const [k, v] of Object.entries(donor)) {
        if (SKIP_COLUMNS.has(k) || k.startsWith("__")) continue;
        if ((keeper[k] === null || keeper[k] === undefined || keeper[k] === "") && v !== null && v !== undefined && v !== "") {
          keeper[k] = v;
          fieldsGained.push(k);
        }
      }
    }

    merges.push({
      propertyId: keeper.property_id,
      propertyName: keeper.__property_name,
      unitNumber: keeper.unit_number,
      keeperId: keeper.id,
      donorIds: donors.map((d: any) => d.id),
      fieldsGained: [...new Set(fieldsGained)],
      tenant: keeper.trading_name || keeper.tenant_name || null,
    });
  }

  const propertyIds = propertyId ? [propertyId] : null;
  const before = await coverageQuery(propertyIds);

  if (apply && merges.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const m of merges) {
        // 1. Fill the keeper's gaps.
        if (m.fieldsGained.length > 0) {
          const keeperRow = rows.find((r: any) => r.id === m.keeperId)!;
          const sets = m.fieldsGained.map((f, i) => `${f} = $${i + 2}`).join(", ");
          await client.query(
            `UPDATE tenancy_schedule_units SET ${sets} WHERE id = $1`,
            [m.keeperId, ...m.fieldsGained.map(f => keeperRow[f])]
          );
        }
        // 2. Re-point anything referencing a donor row.
        for (const table of refTables) {
          await client.query(
            `UPDATE ${table} SET tenancy_unit_id = $1 WHERE tenancy_unit_id = ANY($2)`,
            [m.keeperId, m.donorIds]
          );
        }
        // 3. Remove the shadows.
        await client.query(`DELETE FROM tenancy_schedule_units WHERE id = ANY($1)`, [m.donorIds]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  let withBothAfter: number;
  if (apply) {
    withBothAfter = (await coverageQuery(propertyIds)).withBoth;
  } else {
    // Projection: a merge adds a rent+expiry row when the (gap-filled)
    // keeper ends up with both AND one of them came from a donor.
    let gained = 0;
    for (const m of merges) {
      const keeperRow = rows.find((r: any) => r.id === m.keeperId)!;
      const hasRent = keeperRow.passing_rent_pa !== null && keeperRow.passing_rent_pa > 0;
      const hasExpiry = keeperRow.lease_expiry !== null;
      const gainedEither = m.fieldsGained.includes("passing_rent_pa") || m.fieldsGained.includes("lease_expiry");
      if (hasRent && hasExpiry && gainedEither) gained++;
    }
    withBothAfter = before.withBoth + gained;
  }

  return {
    applied: apply,
    rowsScanned: rows.length,
    duplicateGroups,
    merges,
    ambiguous,
    coverage: {
      withRent: before.withRent,
      withExpiry: before.withExpiry,
      withBothBefore: before.withBoth,
      withBothAfter,
    },
  };
}
