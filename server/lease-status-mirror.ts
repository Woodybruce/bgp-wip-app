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

type Ctx = { pool: Pool; reason: string; actorUserId?: string | null };

const CLOSED = ["WIT", "COM", "INV"];
const AT_OR_PAST_EXCHANGE = ["EXC", "COM", "INV", "WIT"];

// Shared deal write for the mirrors: never regress a closed deal to a
// pre-exchange state (re-marketing a unit starts a fresh cycle — the tracker
// row is unlinked instead), run the same senior-approval / AML gates the deal
// PUT enforces, and leave an audit row for every status the mirror writes.
async function mirrorDealStatus(ctx: Ctx, dealId: string, currentStatus: string | null, code: DealStatusCode, unlinkAvailableUnitId?: string | null): Promise<void> {
  const currentCode = legacyToCode(currentStatus);
  if (currentCode === code) return;
  // Closed deals never move through a board edit: INV is terminal (set by
  // Xero — a board flip back to COM/EXC would silently un-invoice it), COM
  // may only advance to INV, and WIT stays withdrawn. Anything else means a
  // new letting cycle — the tracker row is unlinked so the historic deal
  // keeps its numbers.
  if (currentCode && CLOSED.includes(currentCode) && !(currentCode === "COM" && code === "INV")) {
    if (unlinkAvailableUnitId && !AT_OR_PAST_EXCHANGE.includes(code)) {
      await ctx.pool.query(
        `UPDATE available_units SET deal_id = NULL, updated_at = NOW() WHERE id = $1 AND deal_id = $2`,
        [unlinkAvailableUnitId, dealId],
      );
    }
    await auditMirror(ctx, dealId, currentStatus, code, `Skipped — deal is ${currentCode}; tracker row ${unlinkAvailableUnitId && !AT_OR_PAST_EXCHANGE.includes(code) ? "unlinked for a fresh cycle" : "left as-is"} (${ctx.reason})`);
    return;
  }
  // Gate check fails CLOSED: skipping a mirror write costs a note on the
  // boards; writing an ungated status change costs the audit trail.
  let denial: Awaited<ReturnType<typeof import("./deal-gates")["dealStatusTransitionDenial"]>>;
  try {
    const { dealStatusTransitionDenial } = await import("./deal-gates");
    denial = await dealStatusTransitionDenial(ctx.actorUserId, dealId, code);
  } catch (e: any) {
    await auditMirror(ctx, dealId, currentStatus, code, `Blocked — gate check failed (${e?.message || "error"}) (${ctx.reason})`);
    return;
  }
  if (denial) {
    await auditMirror(ctx, dealId, currentStatus, code, `Blocked — ${denial.error} (${ctx.reason})`);
    return;
  }
  await ctx.pool.query(`UPDATE crm_deals SET status = $1, updated_at = NOW() WHERE id = $2`, [code, dealId]);
  if (code === "COM") {
    // The deal PUT and stage routes stamp completion; a board-driven COM
    // must leave the same fiscal anchor or WIP month bucketing falls back
    // to createdAt. (Comp seeding stays with the deal-page flows.)
    await ctx.pool.query(`UPDATE crm_deals SET completed_at = COALESCE(completed_at, NOW()) WHERE id = $1`, [dealId]).catch(() => {});
  }
  await auditMirror(ctx, dealId, currentStatus, code, `Board mirror (${ctx.reason})`);
}

async function auditMirror(ctx: Ctx, dealId: string, oldValue: string | null, newValue: string, reason: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by) VALUES ($1, 'status', $2, $3, $4, $5)`,
    [dealId, oldValue, newValue, reason, ctx.actorUserId || null],
  ).catch(() => {});
}

// Best-effort write to tenancy_schedule_units.status. Tenancy is the rent
// roll — coarsest of the four boards (Occupied / Vacant). Only ever called
// from inside the other three mirrors so a Tenancy edit stays a one-way
// write (no reverse mirror — Tenancy's binary state can't unambiguously map
// back to e.g. SOL vs NEG).
async function writeTenancyStatus(tenancyUnitId: string | null | undefined, status: string | null, pool: Pool, allowDowngrade = false): Promise<void> {
  if (!tenancyUnitId || !status) return;
  // Pre-marketing a unit whose tenant is still trading must not flatten the
  // rent roll to Vacant; only the leasing schedule's own vacate/archive flow
  // (allowDowngrade) may do that.
  const occupiedGuard = !allowDowngrade && status === "Vacant"
    ? ` AND lower(coalesce(status, '')) NOT IN ('occupied','trading','holding over','taw','lease event','let')`
    : "";
  await pool.query(
    `UPDATE tenancy_schedule_units
        SET status = $1, updated_at = NOW()
      WHERE id = $2
        AND COALESCE(status, '') <> $1${occupiedGuard}`,
    [status, tenancyUnitId],
  );
}

// Apply a canonical status code to the linked deal + leasing-schedule rows
// when the change originated on an available_units row.
export async function mirrorFromAvailableUnit(unitId: string, newStatus: string, ctx: Ctx): Promise<void> {
  const code = legacyToCode(newStatus);
  if (!code) return;
  const target = codeToLeasingStatus(code);

  // 1) Mirror to the linked crm_deal. Tracker and Deals board share the
  //    same canonical code set, so this is an exact copy — a deliberate
  //    tracker edit (incl. SOL → EXC within the same Leasing bucket) should
  //    move the deal too. Bucket-aware downgrade protection only applies to
  //    the Leasing Schedule round-trip (see mirrorFromLeasingSchedule),
  //    whose coarser enum genuinely can't distinguish SOL from EXC.
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
    await mirrorDealStatus(ctx, row.deal_id, row.status, code, unitId);
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
  // The schedule owns the vacate flow, so its edits may downgrade to Vacant.
  await writeTenancyStatus(tenancyUnitId, leasingStatusToTenancyStatus(newStatus), ctx.pool, true);

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
      const dealStatus = (await ctx.pool.query(`SELECT status FROM crm_deals WHERE id = $1`, [au.deal_id])).rows[0]?.status ?? null;
      await mirrorDealStatus(ctx, au.deal_id, dealStatus, fallbackCode, au.id);
    }
  }
}
