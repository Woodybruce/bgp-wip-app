// One-direction mirror: tenancy_schedule_units (god of truth) → projection
// rows on available_units (BGP-internal Letting Tracker) and
// leasing_schedule_units (client-facing property board).
//
// Called whenever a tenancy row's status changes (or on create). Maps the
// canonical tenancy status onto the right marketingStatus / status on each
// projection so the boards reflect reality without manual juggling.
//
// Reverse propagation is deliberately NOT done here — that's the kind of
// behaviour change that surprises agents mid-edit. A tracker row spawned
// here gets its backing deal (ensureBackingDealForUnit) — the only write
// back into crm_deals this module does.
import type { Pool } from "pg";
import { legacyToCode } from "@shared/deal-status";

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
// Case-insensitive so Landsec sheets that send "VOID" / "void" / "Void"
// all land on the same bucket — the import preserves whatever casing
// the feed used.
function mapTenancyToMarketingStatus(s: string | null | undefined): string | null {
  switch ((s || "").trim().toLowerCase()) {
    case "vacant":          return "AVA";
    case "void":            return "AVA";    // Landsec Bluewater feed
    case "marketing":       return "AVA";
    case "in negotiation":  return "NEG";
    case "held":            return "NEG";    // reserved / under negotiation
    case "under offer":     return "SOL";
    case "occupied":        return "COM";
    case "trading":         return "COM";    // occupied and trading
    case "let":             return "COM";    // Landsec Bluewater feed
    case "holding over":    return "COM";    // tenant in possession, lease expired
    case "taw":             return "COM";    // tenancy at will
    case "lease event":     return "COM";    // let — has an upcoming lease event
    case "archived":        return "WIT";
    default:                return null;     // genuinely unknown → don't touch
  }
}

function mapTenancyToLeasingStatus(s: string | null | undefined): string | null {
  switch ((s || "").trim().toLowerCase()) {
    case "vacant":          return "Vacant";
    case "void":            return "Vacant";
    case "marketing":       return "Marketing";
    case "in negotiation":  return "In Negotiation";
    case "held":            return "In Negotiation";
    case "under offer":     return "Under Offer";
    // Occupied / Trading / Lease Event / Let all stay on the leasing
    // schedule — it's the Landsec rent roll, not a marketing board.
    // Mapping these to "Archived" previously clobbered the 4-way mirror
    // on every COM transition, making just-completed deals vanish off
    // the schedule.
    case "occupied":        return "Occupied";
    case "trading":         return "Occupied";
    case "let":             return "Occupied";
    case "holding over":    return "Occupied";
    case "taw":             return "Occupied";
    case "lease event":     return "Occupied";
    case "archived":        return "Archived";
    default:                return null;
  }
}

// Ensure both projection rows exist + reflect the current tenancy status.
// Idempotent: calling twice with the same status is a no-op the second time.
export async function fanOutTenancyStatus(pool: Pool, tenancyId: string): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT id, property_id, unit_number, premises, status, gia_sqft, nia_sqft,
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
    // once linked, the WHERE clause stops matching. Falls back to
    // `premises` when `unit_number` is empty (Landsec sheets sometimes
    // land the unit label in either column depending on the template).
    const unitNorm = (t.unit_number || t.premises || "").trim().toLowerCase();
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
      `SELECT id, marketing_status FROM available_units WHERE tenancy_unit_id = $1 LIMIT 1`,
      [tenancyId]
    );
    if (existingAvail.rows.length > 0) {
      await pool.query(
        `UPDATE available_units
            SET marketing_status = $1, updated_at = NOW()
          WHERE tenancy_unit_id = $2`,
        [marketingStatus, tenancyId]
      );
      // A row flipped back to a live status (vacated, re-marketed) needs
      // its deal too — no-op when one is linked. A let row's fee was that
      // letting's, so a fresh stub after a let starts without it.
      if (marketingStatus !== "COM" && marketingStatus !== "WIT") {
        const wasHistoric = isHistoricUnitStatus(existingAvail.rows[0].marketing_status);
        await ensureBackingDealForUnit(pool, existingAvail.rows[0].id, { status: marketingStatus, ...(wasHistoric ? { fee: null } : {}) })
          .catch((e: any) => console.warn("[unit-mirror] backing deal failed:", e?.message));
      }
    } else if (marketingStatus !== "COM" && marketingStatus !== "WIT") {
      // Only auto-create a Letting Tracker row for active statuses —
      // no point spawning a fresh row for a unit that's already let.
      // Non-lettable revenue lines (lockers, vending, ATMs) never mirror
      // onto the tracker — they're schedule furniture, not shops.
      const { isJunkUnitName } = await import("./unit-junk");
      if (!isJunkUnitName(t.unit_number)) {
        const ins = await pool.query(
          `INSERT INTO available_units (property_id, unit_name, sqft, asking_rent, marketing_status, tenancy_unit_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [t.property_id, t.unit_number, sqft, askingRent, marketingStatus, tenancyId]
        );
        await ensureBackingDealForUnit(pool, ins.rows[0].id)
          .catch((e: any) => console.warn("[unit-mirror] backing deal failed:", e?.message));
      }
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

// Nightly spine re-link: stamp tenancy_unit_id on deals that lost (or never
// got) their link but whose (property, unit name) now matches a spine row —
// e.g. the tenancy schedule was imported after the deal was created. Same
// confident match the create/update stamps use; anything ambiguous stays
// unlinked for staff to Resolve manually.
export async function relinkOffSpineDeals(pool: Pool): Promise<number> {
  try {
    const r = await pool.query(
      `UPDATE crm_deals d
          SET tenancy_unit_id = m.ts_id
         FROM (
           SELECT d2.id AS deal_id,
                  (SELECT ts.id FROM tenancy_schedule_units ts
                    WHERE ts.property_id = d2.property_id
                      AND lower(trim(coalesce(ts.unit_number, ts.premises, ''))) =
                          lower(trim(coalesce((SELECT unit_name FROM property_units pu WHERE pu.id = d2.unit_id), '')))
                      AND trim(coalesce(ts.unit_number, ts.premises, '')) <> ''
                      AND NOT (coalesce(d2.bgp_acting_for, 'landlord') = 'landlord'
                           AND coalesce(d2.status, '') NOT IN ('Completed','Invoiced','Withdrawn','COM','INV','WIT')
                           AND EXISTS (SELECT 1 FROM crm_deals l WHERE l.tenancy_unit_id = ts.id
                                         AND coalesce(l.bgp_acting_for, 'landlord') = 'landlord'
                                         AND coalesce(l.status, '') NOT IN ('Completed','Invoiced','Withdrawn','COM','INV','WIT')))
                    LIMIT 1) AS ts_id
             FROM crm_deals d2
            WHERE d2.tenancy_unit_id IS NULL
              AND d2.unit_id IS NOT NULL
              AND d2.property_id IS NOT NULL
         ) m
        WHERE d.id = m.deal_id AND m.ts_id IS NOT NULL`
    );
    return r.rowCount || 0;
  } catch (e: any) {
    console.warn("[unit-mirror] relinkOffSpineDeals failed:", e?.message);
    return 0;
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

// Statuses past which a tracker row gets NO new deal: a new letting is a
// new deal and the historic one keeps its numbers. Same tail as the
// tracker's Historic pill (EXC/COM/WIT/INV) plus the archived label, which
// legacyToCode does not map.
export function isHistoricUnitStatus(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "arch" || s === "archived") return true;
  const code = legacyToCode(raw);
  return !!code && ["EXC", "COM", "INV", "WIT"].includes(code);
}

// Every Letting Tracker row has a backing crm_deal from the moment it exists
// (Woody, 2026-10-26: "can each unit, when created, have a deal reference so
// we can add fees") — the Ref # and the fee allocations live on the deal.
// Idempotent: keeps an existing link, else adopts an unlinked live letting
// deal on the same unit (the caller's opts fill only its blanks), else
// creates the AVA stub Add Unit has always created. Historic rows get
// nothing (null), and so does a row whose unit's live deal already sits on
// another tracker row.
// opts.fee on create: a number/null from the caller wins (Add Unit's form);
// undefined means "the row's fee, but only if no letting deal ever sat on
// this unit" — after a let the fee on the row is the closed deal's, and
// copying it onto a fresh stub would count the same money twice on the WIP.
export async function ensureBackingDealForUnit(
  pool: Pool,
  availableUnitId: string,
  opts: { dealType?: string | null; landlordId?: string | null; feePercentage?: number | null; status?: string | null; fee?: number | null } = {},
): Promise<{ dealId: string; dealRef: number | null; created: boolean } | null> {
  const r = await pool.query(
    `SELECT au.id, au.property_id, au.unit_id, au.unit_name, au.sqft, au.asking_rent, au.fee,
            au.marketing_status, au.agent_user_ids, au.tenancy_unit_id,
            COALESCE(pu.unit_name, au.unit_name) AS master_name,
            p.name AS property_name, p.landlord_id,
            d.id AS linked_deal_id, d.deal_ref AS linked_deal_ref
       FROM available_units au
       LEFT JOIN property_units pu ON pu.id = au.unit_id
       LEFT JOIN crm_properties p ON p.id = au.property_id
       LEFT JOIN crm_deals d ON d.id = au.deal_id
      WHERE au.id = $1`,
    [availableUnitId]);
  const au = r.rows[0];
  if (!au) return null;
  if (au.linked_deal_id) return { dealId: au.linked_deal_id, dealRef: au.linked_deal_ref, created: false };
  const statusRaw = opts.status || au.marketing_status;
  if (isHistoricUnitStatus(statusRaw)) return null;
  const code = legacyToCode(statusRaw) || "AVA";

  // Landlord-side LETTING deals already on this unit, any status, linked or
  // not. A live unlinked one is adopted (deleted-and-recreated, unlinked by
  // hand, or born on the deal form); letting types only — a live Rent
  // Review / Lease Renewal / Regear on the same unit is advisory work, not
  // the letting, and must never drive the tracker row.
  const prior = await pool.query(
    `SELECT d.id, d.deal_ref, d.status,
            (SELECT au2.id FROM available_units au2 WHERE au2.deal_id = d.id LIMIT 1) AS linked_row_id
       FROM crm_deals d
      WHERE d.property_id = $1
        AND coalesce(d.bgp_acting_for, 'landlord') = 'landlord'
        AND coalesce(d.deal_type, 'New Letting') IN ('New Letting', 'Letting', 'Leasing', 'Temp Lease', 'Licence')
        AND (($2::varchar IS NOT NULL AND d.unit_id = $2)
          OR ($3::varchar IS NOT NULL AND d.tenancy_unit_id = $3)
          OR ($4 <> '' AND lower(trim(d.name)) IN (lower($4 || ' – ' || $5), lower($4 || ' - ' || $5))))
      ORDER BY d.created_at DESC NULLS LAST`,
    [au.property_id, au.unit_id, au.tenancy_unit_id, au.property_name || "", au.master_name || ""]);
  const link = (dealId: string) => pool.query(
    `UPDATE available_units SET deal_id = $1, updated_at = NOW()
      WHERE id = $2 AND (deal_id IS NULL OR NOT EXISTS (SELECT 1 FROM crm_deals x WHERE x.id = available_units.deal_id))`,
    [dealId, au.id]);
  const live = prior.rows.find((d: any) => !d.linked_row_id && !isHistoricUnitStatus(d.status));
  if (live) {
    await link(live.id);
    // The deal keeps what it has; the caller's form fills only its blanks
    // (a deal born on the deal form may carry no fee / type / landlord yet).
    if (opts.fee != null || opts.feePercentage != null || opts.dealType || opts.landlordId) {
      await pool.query(
        `UPDATE crm_deals SET fee = COALESCE(fee, $2), fee_percentage = COALESCE(fee_percentage, $3),
                deal_type = COALESCE(deal_type, $4), landlord_id = COALESCE(landlord_id, $5), updated_at = NOW()
          WHERE id = $1`,
        [live.id, opts.fee ?? null, opts.feePercentage ?? null, opts.dealType || null, opts.landlordId || null]);
    }
    // Once linked the deal's status is what the board shows (effByUnit), so
    // bring the row's own label with it. Leasing/tenancy follow on the next
    // board edit — this module never writes back to the spine.
    const liveCode = legacyToCode(live.status);
    if (liveCode && liveCode !== code) {
      await pool.query(`UPDATE available_units SET marketing_status = $1, updated_at = NOW() WHERE id = $2 AND deal_id = $3`, [liveCode, au.id, live.id]);
    }
    return { dealId: live.id, dealRef: live.deal_ref, created: false };
  }
  // A live letting deal for this shop that ANOTHER tracker row carries:
  // that row is the letting, and a second Ref # here would count its fee
  // twice on the WIP. Duplicate rows are a dedupe job, not a deal.
  const sibling = prior.rows.find((d: any) => d.linked_row_id && !isHistoricUnitStatus(d.status));
  if (sibling) {
    console.warn(`[unit-mirror] no deal for tracker row ${au.id}: live deal ${sibling.id} already sits on row ${sibling.linked_row_id} for the same unit`);
    return null;
  }

  // Create — same shape as the Add Unit auto-create. tenancy_unit_id only
  // when no live landlord-side deal of ANY type already sits on that spine
  // row: 0034's one-live-landlord-deal-per-unit index is deal-type-agnostic.
  const { storage } = await import("./storage");
  const { resolveAgentNames } = await import("./investment-tracker-service");
  let tenancyUnitId: string | undefined;
  if (au.tenancy_unit_id) {
    const liveOnSpine = await pool.query(
      `SELECT 1 FROM crm_deals WHERE tenancy_unit_id = $1 AND coalesce(bgp_acting_for, 'landlord') = 'landlord'
          AND coalesce(status, '') NOT IN ('Completed','Invoiced','Withdrawn','COM','INV','WIT') LIMIT 1`,
      [au.tenancy_unit_id]);
    if (!liveOnSpine.rows.length) tenancyUnitId = au.tenancy_unit_id;
  }
  const fee = opts.fee !== undefined ? opts.fee : (prior.rows.length ? null : au.fee);
  const unitLabel = au.master_name || au.unit_name || "Unit";
  const deal = await storage.createCrmDeal({
    name: au.property_name ? `${au.property_name} – ${unitLabel}` : unitLabel,
    propertyId: au.property_id || undefined,
    unitId: au.unit_id || undefined,
    tenancyUnitId,
    status: code,
    dealType: opts.dealType || "New Letting",
    internalAgent: await resolveAgentNames(au.agent_user_ids),
    fee: fee ?? undefined,
    feePercentage: opts.feePercentage ?? undefined,
    rentPa: au.asking_rent ?? undefined,
    totalAreaSqft: au.sqft ?? undefined,
    landlordId: opts.landlordId || au.landlord_id || undefined,
  } as any);
  const upd = await link(deal.id);
  if (!upd.rowCount) {
    // Lost a race with another creator — unless they adopted this very
    // stub (live and unlinked for a moment), in which case it stays.
    const again = await pool.query(`SELECT d.id, d.deal_ref FROM available_units au JOIN crm_deals d ON d.id = au.deal_id WHERE au.id = $1`, [au.id]);
    if (again.rows[0]?.id === deal.id) return { dealId: deal.id, dealRef: deal.dealRef ?? null, created: true };
    await storage.deleteCrmDeal(deal.id);
    return again.rows[0] ? { dealId: again.rows[0].id, dealRef: again.rows[0].deal_ref, created: false } : null;
  }
  return { dealId: deal.id, dealRef: deal.dealRef ?? null, created: true };
}

// Sweep: every live tracker row with no (or a dangling) deal. Historic rows
// and junk names are filtered in SQL so the every-boot run is one SELECT
// when nothing is orphaned; the helper's own guard is the authority.
export async function backfillUnitBackingDeals(pool: Pool): Promise<{ scanned: number; created: number; linked: number; skipped: number; failed: number }> {
  const { isJunkUnitName } = await import("./unit-junk");
  const { rows } = await pool.query(
    `SELECT id, unit_name FROM available_units
      WHERE (deal_id IS NULL OR deal_id NOT IN (SELECT id FROM crm_deals))
        AND lower(coalesce(marketing_status, '')) NOT IN
            ('exc','exchanged','com','completed','complete','let','occupied','inv','invoiced','billed','wit','withdrawn','lost','dead','arch','archived')
      ORDER BY created_at`);
  const out = { scanned: rows.length, created: 0, linked: 0, skipped: 0, failed: 0 };
  for (const r of rows) {
    if (isJunkUnitName(r.unit_name)) { out.skipped++; continue; }
    try {
      const res = await ensureBackingDealForUnit(pool, r.id);
      if (!res) out.skipped++; else if (res.created) out.created++; else out.linked++;
    } catch (e: any) {
      out.failed++;
      console.warn(`[unit-backing-deals] ${r.id} failed:`, e?.message);
    }
  }
  return out;
}
