// Unit names don't make properties (Woody, 2026-09-28). "Unit 48 Jubilee
// Place", "Unit RS315 Canary Wharf" and "Kiosk 3 Wharf Kitchen" are units of
// the Canary Wharf estate, not properties of their own. Every create path
// asks resolveEstateUnit first: when the name is a unit of an existing
// estate / centre (by its name, short name, alias or one of its schemes),
// the caller gets that property back with the unit found or added on its
// tenancy schedule, instead of a new property.

import { estateUnitName, matchEstate, parseUnitLikeName, sameScheme, schemeKey, unitRefKey, type EstateCandidate, type EstateMatch, type UnitLikeName } from "@shared/property-schemes";

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

export type EstateUnit = EstateMatch & { unitId: string; unitName: string; created: boolean };

/** The estate a unit-like name belongs to, or null. Never throws — a failed
 *  lookup leaves the caller's ordinary create in place. */
export async function findEstateForUnitName(pool: Queryable, name: string | null | undefined): Promise<(EstateMatch & { parsed: UnitLikeName }) | null> {
  const parsed = parseUnitLikeName(name);
  if (!parsed) return null;
  try {
    const words = schemeKey(parsed.rest).split(" ").filter(w => w.length >= 3);
    const like = `%${(words[0] || schemeKey(parsed.rest)).replace(/[\\%_]/g, m => `\\${m}`)}%`;
    const props = await pool.query(`SELECT id, name, aliases FROM crm_properties WHERE name ILIKE $1 OR aliases::text ILIKE $1 LIMIT 200`, [like]);
    // Checked first so a missing table can't abort a caller's transaction.
    const hasSchemes = (await pool.query(`SELECT to_regclass('property_schemes') IS NOT NULL AS ok`)).rows[0]?.ok;
    const schemes = hasSchemes
      ? await pool.query(`SELECT s.property_id, s.name, p.name AS property_name, p.aliases
                            FROM property_schemes s JOIN crm_properties p ON p.id = s.property_id`)
      : { rows: [] as any[] };
    const byId = new Map<string, EstateCandidate>();
    for (const p of props.rows) byId.set(p.id, { propertyId: p.id, propertyName: p.name, aliases: p.aliases, schemes: [] as Array<{ name: string }> });
    for (const s of schemes.rows) {
      const c: EstateCandidate = byId.get(s.property_id) || { propertyId: s.property_id, propertyName: s.property_name, aliases: s.aliases, schemes: [] };
      c.schemes!.push({ name: s.name });
      byId.set(s.property_id, c);
    }
    const match = matchEstate(parsed, [...byId.values()]);
    return match ? { ...match, parsed } : null;
  } catch (e: any) {
    console.warn("[estate-units] lookup failed:", e?.message);
    return null;
  }
}

/** Find the unit on the estate's tenancy schedule, or add it (no status —
 *  nothing is known about it yet, so no board lights up). */
export async function attachEstateUnit(pool: Queryable, match: EstateMatch & { parsed: UnitLikeName }, originalName: string): Promise<EstateUnit> {
  const rows = (await pool.query(
    `SELECT id, unit_number, premises, grouping FROM tenancy_schedule_units WHERE property_id = $1`,
    [match.propertyId],
  )).rows;
  const wanted = estateUnitName(match.parsed.label, match.scheme);
  const keys = new Set([unitRefKey(originalName), unitRefKey(wanted)]);
  let hits = rows.filter(r => keys.has(unitRefKey(r.unit_number)) || keys.has(unitRefKey(r.premises)));
  if (!hits.length) {
    const labelKey = unitRefKey(match.parsed.label);
    hits = rows.filter(r => unitRefKey(r.unit_number) === labelKey && (match.scheme ? sameScheme(r.grouping, match.scheme) : true));
  }
  if (hits.length) {
    const hit = hits[0];
    return { propertyId: match.propertyId, propertyName: match.propertyName, scheme: match.scheme, unitId: hit.id, unitName: hit.unit_number || hit.premises || wanted, created: false };
  }
  const inserted = await pool.query(
    `INSERT INTO tenancy_schedule_units (property_id, unit_number, grouping) VALUES ($1, $2, $3) RETURNING id`,
    [match.propertyId, wanted, match.scheme],
  );
  return { propertyId: match.propertyId, propertyName: match.propertyName, scheme: match.scheme, unitId: inserted.rows[0].id, unitName: wanted, created: true };
}

/** The estate + unit for a unit-like name, or null when it is an ordinary
 *  property name (or no single estate fits). */
export async function resolveEstateUnit(pool: Queryable, name: string | null | undefined): Promise<EstateUnit | null> {
  const match = await findEstateForUnitName(pool, name);
  if (!match) return null;
  try {
    return await attachEstateUnit(pool, match, String(name));
  } catch (e: any) {
    console.warn("[estate-units] attach failed:", e?.message);
    return null;
  }
}

/** The sentence a create path shows when it attached instead of creating. */
export function estateUnitMessage(unit: EstateUnit): string {
  return `"${unit.unitName}" is a unit of ${unit.propertyName}${unit.scheme ? ` (${unit.scheme})` : ""} — ${unit.created ? "added it to" : "it's already on"} that property's tenancy schedule instead of creating a new property.`;
}
