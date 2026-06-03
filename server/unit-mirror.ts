// One-direction mirror: tenancy_schedule_units (god of truth) → projection
// rows on available_units (BGP-internal Letting Tracker) and
// leasing_schedule_units (client-facing property board).
//
// Called whenever a tenancy row's status changes (or on create). Maps the
// canonical tenancy status onto the right marketingStatus / status on each
// projection so the boards reflect reality without manual juggling.
//
// Reverse propagation is deliberately NOT done here — that's the kind of
// behaviour change that surprises agents mid-edit.
import type { Pool } from "pg";

// Canonical tenancy status values that map onto projections. Anything
// outside this set is left untouched (rows mid-data-entry, legacy values).
export type TenancyStatus =
  | "Vacant"
  | "Marketing"
  | "Under Offer"
  | "Occupied"
  | "Archived";

// Deal status codes from shared/deal-status.ts — kept as plain strings so
// this module doesn't drag the deal enum into the server graph.
//
// IMPORTANT: this MUST cover the full canonical vocab the unified schedule
// emits (SCHEDULE_STATUSES in PropertyTenancySchedule.tsx) PLUS the legacy
// values that live in imported data ("Held", "Marketing"). Anything the
// switch doesn't recognise returns null and the fan-out silently no-ops —
// which is exactly the bug that left Bluewater's Letting Tracker / leasing
// lens unlinked when units were set to "In Negotiation" / "Trading" / "Held".
function mapTenancyToMarketingStatus(s: string | null | undefined): string | null {
  switch ((s || "").trim()) {
    case "Vacant":          return "AVA";
    case "Marketing":       return "AVA";
    case "In Negotiation":  return "NEG";
    case "Held":            return "NEG";   // reserved / under negotiation
    case "Under Offer":     return "SOL";
    case "Occupied":        return "COM";
    case "Trading":         return "COM";   // occupied and trading
    case "Lease Event":     return "COM";   // let — has an upcoming lease event
    case "Archived":        return "WIT";
    default:                return null;     // genuinely unknown → don't touch
  }
}

function mapTenancyToLeasingStatus(s: string | null | undefined): string | null {
  switch ((s || "").trim()) {
    case "Vacant":          return "Vacant";
    case "Marketing":       return "Marketing";
    case "In Negotiation":  return "In Negotiation";
    case "Held":            return "In Negotiation";
    case "Under Offer":     return "Under Offer";
    // Occupied / Trading / Lease Event all stay on the leasing schedule —
    // it's the Landsec rent roll, not a marketing board. Mapping these to
    // "Archived" previously clobbered the 4-way mirror on every COM
    // transition, making just-completed deals vanish off the schedule.
    case "Occupied":        return "Occupied";
    case "Trading":         return "Occupied";
    case "Lease Event":     return "Occupied";
    case "Archived":        return "Archived";
    default:                return null;
  }
}

// Ensure both projection rows exist + reflect the current tenancy status.
// Idempotent: calling twice with the same status is a no-op the second time.
export async function fanOutTenancyStatus(pool: Pool, tenancyId: string): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT id, property_id, unit_number, status, gia_sqft, nia_sqft,
              marketing_rent_pa, erv_pa, epc_rating
         FROM tenancy_schedule_units
        WHERE id = $1`,
      [tenancyId]
    );
    const t = r.rows[0];
    if (!t || !t.property_id) return;

    // Tenant-rep guard: if every deal touching this tenancy row is a
    // tenant-rep deal type (Lease Acquisition / Sub-Letting), the
    // property is a CANDIDATE we're looking at on behalf of a tenant
    // client — not something we're marketing on behalf of a landlord.
    // Don't pollute the landlord-side boards.
    const dealCheck = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE deal_type NOT IN ('Lease Acquisition', 'Sub-Letting')) AS landlord_side,
              COUNT(*) AS total
         FROM crm_deals
        WHERE tenancy_unit_id = $1`,
      [tenancyId]
    );
    const counts = dealCheck.rows[0] || { landlord_side: 0, total: 0 };
    if (Number(counts.total) > 0 && Number(counts.landlord_side) === 0) {
      // All deals on this unit are tenant-rep — skip the fan-out entirely.
      return;
    }

    const marketingStatus = mapTenancyToMarketingStatus(t.status);
    const leasingStatus = mapTenancyToLeasingStatus(t.status);
    const sqft = t.gia_sqft ?? t.nia_sqft ?? null;
    const askingRent = t.marketing_rent_pa ?? t.erv_pa ?? null;

    // Only fan out when status is known. Unknown statuses (legacy text,
    // partial data entry) get left alone — better silence than wrong
    // boards lighting up.
    if (!marketingStatus || !leasingStatus) return;

    // Adopt pre-existing projection rows that match this unit by name but
    // were never linked (imported separately, created before the mirror
    // existed). Without this the fan-out below can't see them and would
    // spawn a DUPLICATE letting-tracker / leasing row on every status
    // edit — exactly the "no linkage" symptom on Bluewater. Idempotent:
    // once linked, the WHERE clause stops matching.
    const unitNorm = (t.unit_number || "").trim().toLowerCase();
    if (unitNorm) {
      await Promise.all([
        pool.query(
          `UPDATE available_units SET tenancy_unit_id = $1
            WHERE property_id = $2 AND tenancy_unit_id IS NULL
              AND lower(trim(coalesce(unit_name, ''))) = $3`,
          [tenancyId, t.property_id, unitNorm]
        ),
        pool.query(
          `UPDATE leasing_schedule_units SET tenancy_unit_id = $1
            WHERE property_id = $2 AND tenancy_unit_id IS NULL
              AND lower(trim(coalesce(unit_name, ''))) = $3`,
          [tenancyId, t.property_id, unitNorm]
        ),
      ]).catch((e: any) => console.warn("[unit-mirror] name-link failed:", e?.message));
    }

    // available_units: upsert keyed by tenancy_unit_id. Only updates the
    // marketing status field — never touches viewings, agent assignment,
    // or other projection-owned data.
    const existingAvail = await pool.query(
      `SELECT id FROM available_units WHERE tenancy_unit_id = $1 LIMIT 1`,
      [tenancyId]
    );
    if (existingAvail.rows.length > 0) {
      await pool.query(
        `UPDATE available_units
            SET marketing_status = $1, updated_at = NOW()
          WHERE tenancy_unit_id = $2`,
        [marketingStatus, tenancyId]
      );
    } else if (marketingStatus !== "COM" && marketingStatus !== "WIT") {
      // Only auto-create a Letting Tracker row for active statuses —
      // no point spawning a fresh row for a unit that's already let.
      await pool.query(
        `INSERT INTO available_units (property_id, unit_name, sqft, asking_rent, marketing_status, tenancy_unit_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.property_id, t.unit_number, sqft, askingRent, marketingStatus, tenancyId]
      );
    }

    // leasing_schedule_units: same pattern. Default rent_pa + sqft on
    // create so the client board has something to show; status edits
    // afterwards are owned by the leasing schedule itself.
    const existingLs = await pool.query(
      `SELECT id FROM leasing_schedule_units WHERE tenancy_unit_id = $1 LIMIT 1`,
      [tenancyId]
    );
    if (existingLs.rows.length > 0) {
      await pool.query(
        `UPDATE leasing_schedule_units
            SET status = $1, updated_at = NOW()
          WHERE tenancy_unit_id = $2`,
        [leasingStatus, tenancyId]
      );
    } else if (leasingStatus !== "Archived") {
      await pool.query(
        `INSERT INTO leasing_schedule_units (property_id, unit_name, sqft, rent_pa, status, tenancy_unit_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.property_id, t.unit_number, sqft, askingRent, leasingStatus, tenancyId]
      );
    }
  } catch (e: any) {
    // Best-effort — never break the tenancy write because a projection failed.
    console.warn(`[unit-mirror] fanOutTenancyStatus(${tenancyId}) failed:`, e?.message);
  }
}

// Reverse direction, CREATION-TIME ONLY: when a unit first appears on the
// Letting Tracker (or via a deal), make sure it exists on the tenancy spine
// (the god of truth) so it shows as a normal editable row rather than a
// read-only "vacant" orphan banner. Deduped by the same normalised unit-name
// match the schedule GET uses, so it never creates a duplicate. Idempotent:
// if the available unit is already linked, it no-ops. This is creation-only
// (not on every edit) to avoid surprising agents mid-edit.
function mapMarketingToTenancyStatus(s: string | null | undefined): string {
  switch ((s || "").trim().toUpperCase()) {
    case "SOL": case "EXC": return "Under Offer";
    case "COM": case "INV": return "Occupied";
    case "WIT": case "ARCH": return "Archived";
    default: return "Marketing"; // AVA / LIVE / NEG / unknown → being marketed
  }
}

export async function ensureTenancyRowForAvailableUnit(pool: Pool, availableUnitId: string): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT id, property_id, unit_name, sqft, asking_rent, marketing_status, deal_id, tenancy_unit_id
         FROM available_units WHERE id = $1`,
      [availableUnitId]
    );
    const au = r.rows[0];
    if (!au || !au.property_id || au.tenancy_unit_id) return;       // missing or already linked
    const name = (au.unit_name || "").trim();
    if (!name) return;                                              // nothing to dedup on

    // Confident dedupe: exact normalised name match on the same property.
    const match = await pool.query(
      `SELECT id FROM tenancy_schedule_units
        WHERE property_id = $1
          AND lower(trim(coalesce(unit_number, premises, ''))) = lower(trim($2))
        LIMIT 1`,
      [au.property_id, name]
    );

    let tenancyId: string;
    if (match.rows.length > 0) {
      tenancyId = match.rows[0].id;                                 // link to existing spine row
    } else {
      const ins = await pool.query(
        `INSERT INTO tenancy_schedule_units
           (property_id, unit_number, premises, nia_sqft, gia_sqft, erv_pa, status, deal_id, letting_tracker_unit_id)
         VALUES ($1, $2, $2, $3, $3, $4, $5, $6, $7)
         RETURNING id`,
        [au.property_id, name, au.sqft || null, au.asking_rent || null,
         mapMarketingToTenancyStatus(au.marketing_status), au.deal_id || null, availableUnitId]
      );
      tenancyId = ins.rows[0].id;
    }

    // Link both ways so future fan-outs/edits stay in sync.
    await pool.query(`UPDATE available_units SET tenancy_unit_id = $1 WHERE id = $2`, [tenancyId, availableUnitId]);
    await pool.query(
      `UPDATE tenancy_schedule_units SET letting_tracker_unit_id = $1 WHERE id = $2 AND letting_tracker_unit_id IS NULL`,
      [availableUnitId, tenancyId]
    );
  } catch (e: any) {
    // Best-effort — never break unit creation because the spine sync failed.
    console.warn(`[unit-mirror] ensureTenancyRowForAvailableUnit(${availableUnitId}) failed:`, e?.message);
  }
}
