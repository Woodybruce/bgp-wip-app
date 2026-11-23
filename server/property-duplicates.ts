// Properties that share a name, as Settings → Data Health lists them (Woody,
// 2026-11-23: "merge all duplicates failing"). A shared name is not proof of
// one place: Sedley Place was both a Clapham scheme and 355-361 Oxford Street.
// Each group says where each record is and how much hangs off it, puts the
// record to keep first (the most transactions, schedule rows and tracker units,
// then one with a landlord, then the oldest), and is "samePlace" only when no
// two records give different postcodes or addresses and none is a shared
// benchmark centre page. Merge All takes only those; the rest are a person's.
import type { Pool } from "pg";
import { describeDuplicateGroup, type DuplicateRecordFacts } from "@shared/property-duplicates";

export async function describePropertyDuplicates(pool: Pool, groups: Array<{ name: string; ids: string[] }>) {
  const ids = [...new Set(groups.flatMap(g => g.ids))];
  if (!ids.length) return [];
  const rows = await pool.query(
    `SELECT p.id, p.name, p.address, p.postcode, p.landlord_id, p.created_at,
            coalesce((to_jsonb(p)->>'benchmark_shared')::boolean, false) AS benchmark_shared,
            (SELECT count(*) FROM crm_deals d WHERE d.property_id = p.id)::int AS deals,
            (SELECT count(*) FROM tenancy_schedule_units t WHERE t.property_id = p.id)::int AS schedule_rows,
            (SELECT count(*) FROM available_units a WHERE a.property_id = p.id)::int AS tracker_units
       FROM crm_properties p WHERE p.id = ANY($1)`,
    [ids],
  );
  const facts = new Map<string, DuplicateRecordFacts>(rows.rows.map((r: any) => [r.id, {
    id: r.id, address: r.address, postcode: r.postcode, hasLandlord: !!r.landlord_id,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, sharedCentrePage: !!r.benchmark_shared,
    deals: r.deals, scheduleRows: r.schedule_rows, trackerUnits: r.tracker_units,
  }]));
  return groups
    .map(g => describeDuplicateGroup(g.name, g.ids.map(id => facts.get(id)).filter((f): f is DuplicateRecordFacts => !!f)))
    .filter(g => g.count > 1);
}
