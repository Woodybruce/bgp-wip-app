// Best-effort status mirror across the four lifecycle views of a unit.
// Each mirror call is wrapped in try/catch by the caller — primary writes
// must never fail because the secondary mirror failed.
//
// Join keys used to walk between the four tables:
//   available_units.deal_id          → crm_deals.id
//   available_units.tenancy_unit_id  → tenancy_schedule_units.id   (rent roll)
//   leasing_schedule_units.tenancy_unit_id → tenancy_schedule_units.id
//   (so available_units ↔ leasing_schedule_units share tenancy_unit_id)
//
// Mirror direction: Letting Tracker, Deals and Leasing Schedule each fan
// out to the other two AND to the rent-roll (tenancy). Tenancy edits stay
// one-way — its binary Occupied/Vacant can't unambiguously map back to e.g.
// SOL vs NEG, so a direct tenancy edit just updates tenancy.

import type { Pool } from "pg";
import {
  codeToLeasingStatus,
  leasingStatusToCode,
  codeMatchesLeasingStatus,
  codeToTenancyStatus,
  leasingStatusToTenancyStatus,
} from "@shared/lease-status-mirror";
import { legacyToCode, type DealStatusCode } from "@shared/deal-status";

type Ctx = { pool: Pool; reason: string };

// Best-effort write to tenancy_schedule_units.status. Tenancy is the rent
// roll — coarsest of the four boards (Occupied / Vacant). Only ever called
// from inside the other three mirrors so a Tenancy edit stays a one-way
// write (no reverse mirror — Tenancy's binary state can't unambiguously map
// back to e.g. SOL vs NEG).
async function writeTenancyStatus(tenancyUnitId: string | null | undefined, status: string | null, pool: Pool): Promise<void> {
  if (!tenancyUnitId || !status) return;
  await pool.query(
    `UPDATE tenancy_schedule_units
        SET status = $1, updated_at = NOW()
      WHERE id = $2
        AND COALESCE(status, '') <> $1`,
    [status, tenancyUnitId],
  );
}

// Apply a canonical status code to the linked deal + leasing-schedule rows
// when the change originated on an available_units row.
export async function mirrorFromAvailableUnit(unitId: string, newStatus: string, ctx: Ctx): Promise<void> {
  const code = legacyToCode(newStatus);
  if (!code) return;
  const target = codeToLeasingStatus(code);

  // 1) Mirror to the linked crm_deal — but only if the deal is in a
  //    different bucket. SOL/EXC are in the same Leasing bucket; we don't
  //    want to drag an EXC deal back to SOL on a tracker tweak.
  const dealRow = await ctx.pool.query(
    `SELECT d.id AS deal_id, d.status, au.tenancy_unit_id
       FROM available_units au
       LEFT JOIN crm_deals d ON d.id = au.deal_id
      WHERE au.id = $1
      LIMIT 1`,
    [unitId],
  );
  const row = dealRow.rows[0];
  if (row?.deal_id) {
    const currentCode = legacyToCode(row.status);
    const currentBucket = currentCode ? codeToLeasingStatus(currentCode) : null;
    if (currentCode !== code && currentBucket !== target) {
      await ctx.pool.query(
        `UPDATE crm_deals SET status = $1, updated_at = NOW() WHERE id = $2`,
        [code, row.deal_id],
      );
    }
  }

  // 2) Mirror to leasing_schedule_units via the shared tenancy_unit_id.
  const tenancyUnitId = row?.tenancy_unit_id;
  if (tenancyUnitId && target) {
    await ctx.pool.query(
      `UPDATE leasing_schedule_units
          SET status = $1, updated_at = NOW()
        WHERE tenancy_unit_id = $2
          AND COALESCE(status, '') <> $1`,
      [target, tenancyUnitId],
    );
  }

  // 3) Mirror to tenancy_schedule_units (the rent-roll spine) so it
  //    reflects the same physical state. Tenancy uses Occupied/Vacant.
  await writeTenancyStatus(tenancyUnitId, codeToTenancyStatus(code), ctx.pool);
}

// Apply a canonical status code to the linked available_units + leasing
// rows when the change originated on a crm_deals row.
export async function mirrorFromDeal(dealId: string, newStatus: string, ctx: Ctx): Promise<void> {
  const code = legacyToCode(newStatus);
  if (!code) return;
  const target = codeToLeasingStatus(code);

  // Find the linked available_units row (if any) — it's the bridge to
  // leasing_schedule_units via tenancy_unit_id.
  const auRow = await ctx.pool.query(
    `SELECT id, tenancy_unit_id FROM available_units WHERE deal_id = $1 LIMIT 1`,
    [dealId],
  );
  const au = auRow.rows[0];

  if (au?.id) {
    await ctx.pool.query(
      `UPDATE available_units
          SET marketing_status = $1, updated_at = NOW()
        WHERE id = $2
          AND COALESCE(marketing_status, '') <> $1`,
      [code, au.id],
    );
  }

  // Leasing schedule mirror via tenancy_unit_id — first via available_units,
  // and if no AU row exists, try via deal.unit_id (which on letting deals
  // is the property_units.id; we still need the canonical spine, so this
  // path skips silently when there's no tenancy_unit_id to anchor on).
  const tenancyUnitId = au?.tenancy_unit_id;
  if (tenancyUnitId && target) {
    await ctx.pool.query(
      `UPDATE leasing_schedule_units
          SET status = $1, updated_at = NOW()
        WHERE tenancy_unit_id = $2
          AND COALESCE(status, '') <> $1`,
      [target, tenancyUnitId],
    );
  }

  // Mirror to tenancy_schedule_units (the rent-roll spine).
  await writeTenancyStatus(tenancyUnitId, codeToTenancyStatus(code), ctx.pool);
}

// Apply a leasing-schedule status to the linked available_units + crm_deal
// rows when the change originated on a leasing_schedule_units row.
export async function mirrorFromLeasingSchedule(leasingUnitId: string, newStatus: string, ctx: Ctx): Promise<void> {
  const tenancyRow = await ctx.pool.query(
    `SELECT tenancy_unit_id FROM leasing_schedule_units WHERE id = $1 LIMIT 1`,
    [leasingUnitId],
  );
  const tenancyUnitId = tenancyRow.rows[0]?.tenancy_unit_id;
  if (!tenancyUnitId) return;

  // Mirror to tenancy_schedule_units first — the leasing→tenancy link is
  // direct via tenancy_unit_id, no available_units row needed. Lets schedule
  // edits update the rent roll even on schedule-only units (no marketing).
  await writeTenancyStatus(tenancyUnitId, leasingStatusToTenancyStatus(newStatus), ctx.pool);

  const fallbackCode = leasingStatusToCode(newStatus);
  if (!fallbackCode) return;

  // Find the matching available_units row (if any).
  const auRow = await ctx.pool.query(
    `SELECT id, marketing_status, deal_id FROM available_units WHERE tenancy_unit_id = $1 LIMIT 1`,
    [tenancyUnitId],
  );
  const au = auRow.rows[0];
  if (!au) return; // schedule-only unit, no marketing-side mirror needed

  // Only update the AU code if it's currently in a *different* bucket than
  // the schedule's new bucket. e.g. AU=SOL, schedule moves to "Under Offer"
  // → no change (same bucket). AU=AVA, schedule moves to "Under Offer" →
  // upgrade AU to SOL.
  if (!codeMatchesLeasingStatus(au.marketing_status, newStatus)) {
    await ctx.pool.query(
      `UPDATE available_units
          SET marketing_status = $1, updated_at = NOW()
        WHERE id = $2`,
      [fallbackCode, au.id],
    );
    if (au.deal_id) {
      await ctx.pool.query(
        `UPDATE crm_deals
            SET status = $1, updated_at = NOW()
          WHERE id = $2
            AND COALESCE(status, '') <> $1`,
        [fallbackCode, au.deal_id],
      );
    }
  }
}
