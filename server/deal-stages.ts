// ─────────────────────────────────────────────────────────────────────────
// Deal stage transitions + solicitor leg.
//
// Enforces an ordered pipeline, writes to deal_events for full audit, and
// triggers secondary actions (e.g. exchanged_at on entering 'agreed',
// completed_at on entering 'completed', invoiced_at on entering 'invoiced',
// comp seed-row on entering 'completed').
//
// Endpoints:
//   GET   /api/deal/:dealId/events         — audit log
//   POST  /api/deal/:dealId/stage          — transition to stage
//   PATCH /api/deal/:dealId/solicitor      — update solicitor leg fields
//   POST  /api/deal/:dealId/events         — log a custom event
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { runAllAmlChecks } from "./kyc-orchestrator";
import { fanOutTenancyStatus } from "./unit-mirror";

const router = Router();

const PIPELINE = [
  "instruction", "marketing", "viewings", "offers",
  "hots", "sols", "agreed", "completed", "invoiced",
] as const;
type Stage = (typeof PIPELINE)[number];

function isValidStage(s: any): s is Stage {
  return typeof s === "string" && (PIPELINE as readonly string[]).includes(s);
}

/**
 * Kick off the full AML orchestrator for both sides of a deal — tenant
 * and landlord. Delegates to runAllAmlChecks which handles Companies
 * House + UBO + Sanctions + PEP + Veriff session creation + checklist
 * auto-ticking. Every run writes a deal_events entry so the audit log
 * captures the outcome whether or not the orchestrator succeeded.
 */
export async function autoLaunchAmlForDeal(
  dealId: string,
  actorId: string | null,
  actorName: string | null,
): Promise<void> {
  // Pull all four counterparty ids — leasing deals carry tenant + landlord,
  // investment deals carry vendor + purchaser. The form now requires both
  // sides for every deal type, so both should fire AML.
  const dealQuery = await pool.query(
    `SELECT id, tenant_id, landlord_id, vendor_id, purchaser_id, deal_type
       FROM crm_deals WHERE id = $1`,
    [dealId],
  );
  const deal = dealQuery.rows[0];
  if (!deal) return;

  const companyIds = [deal.tenant_id, deal.landlord_id, deal.vendor_id, deal.purchaser_id]
    .filter(Boolean) as string[];
  // Dedupe — same company could conceivably appear twice (e.g. a landlord
  // also flagged as vendor on a hybrid deal).
  const uniqueIds = Array.from(new Set(companyIds));
  if (uniqueIds.length === 0) {
    await pool.query(
      `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name)
       VALUES ($1, 'kyc_auto_skipped', $2, $3, $4)`,
      [dealId, JSON.stringify({ reason: "No counterparty linked to deal (tenant / landlord / vendor / purchaser)" }), actorId, actorName],
    ).catch(() => {});
    return;
  }
  // Rename for the loop below — preserves the existing log shape.
  const targetIds = uniqueIds;

  for (const companyId of targetIds) {
    try {
      const summary = await runAllAmlChecks(companyId, dealId, actorId);
      console.log(
        `[deal-stages] HoTs → AML for company ${companyId}: risk=${summary.risk?.level || "n/a"} ` +
        `veriff=${summary.veriffLaunched.length}/${summary.veriffLaunched.length + summary.veriffSkipped.length} ` +
        `ticked=[${summary.checklistTicked.join(",")}]`,
      );
    } catch (e: any) {
      console.warn(`[deal-stages] AML run failed for ${companyId}:`, e?.message);
      await pool.query(
        `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name)
         VALUES ($1, 'kyc_auto_failed', $2, $3, $4)`,
        [dealId, JSON.stringify({ companyId, error: e?.message }), actorId, actorName],
      ).catch(() => {});
    }
  }
}

// ─── Events audit log ────────────────────────────────────────────────────
router.get("/api/deal/:dealId/events", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, event_type, from_stage, to_stage, payload, actor_id, actor_name, occurred_at
         FROM deal_events
        WHERE deal_id = $1
        ORDER BY occurred_at DESC
        LIMIT 200`,
      [req.params.dealId]
    );
    res.json({ events: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stage transition ────────────────────────────────────────────────────
router.post("/api/deal/:dealId/stage", requireAuth, async (req: Request & { user?: any }, res: Response) => {
  try {
    const dealId = String(req.params.dealId);
    const toStage = req.body?.stage;
    const reason = req.body?.reason || null;
    const learning: string | null = typeof req.body?.learning === "string"
      ? req.body.learning.trim().slice(0, 2000) || null
      : null;
    if (!isValidStage(toStage)) {
      return res.status(400).json({ error: `stage must be one of ${PIPELINE.join(", ")}` });
    }

    const current = await pool.query(
      `SELECT id, stage, exchanged_at, completed_at, invoiced_at, solicitor_instructed_at,
              landlord_id, tenant_id, vendor_id, purchaser_id,
              landlord_entity_id, tenant_entity_id, vendor_entity_id, purchaser_entity_id
         FROM crm_deals WHERE id = $1`,
      [dealId]
    );
    if (!current.rows[0]) return res.status(404).json({ error: "Deal not found" });
    const fromStage = current.rows[0].stage;
    const c = current.rows[0];

    // AML gate. Any move to sols / agreed / completed / invoiced requires
    // every linked counterparty to have kyc_status = 'approved' and not
    // expired. Entity-aware: when the deal links a specific trading
    // entity for a role, that entity's KYC is checked; otherwise we
    // fall back to the parent brand's KYC.
    //
    // amlOverride: senior-approved override for edge cases where AML is
    // demonstrably complete outside the system (legacy import, client's
    // own AML team). Logged to deal_events so the audit captures it.
    const GATED_STAGES = new Set(["sols", "agreed", "completed", "invoiced"]);
    if (GATED_STAGES.has(toStage) && req.body?.amlOverride !== true) {
      const pairs: { role: string; parentId: string | null; entityId: string | null }[] = [
        { role: "landlord",  parentId: c.landlord_id  ?? null, entityId: c.landlord_entity_id  ?? null },
        { role: "tenant",    parentId: c.tenant_id    ?? null, entityId: c.tenant_entity_id    ?? null },
        { role: "vendor",    parentId: c.vendor_id    ?? null, entityId: c.vendor_entity_id    ?? null },
        { role: "purchaser", parentId: c.purchaser_id ?? null, entityId: c.purchaser_entity_id ?? null },
      ].filter(p => p.parentId);

      if (pairs.length === 0) {
        return res.status(403).json({
          error: "Deal needs at least one counterparty linked before moving to Solicitors+. AML can't run on nothing.",
        });
      }

      const parentIds = Array.from(new Set(pairs.map(p => p.parentId!).filter(Boolean)));
      const entityIds = Array.from(new Set(pairs.map(p => p.entityId).filter(Boolean) as string[]));
      const [parentRes, entityRes] = await Promise.all([
        pool.query(
          `SELECT id, name, kyc_status, kyc_expires_at FROM crm_companies WHERE id = ANY($1::varchar[])`,
          [parentIds]
        ),
        entityIds.length > 0
          ? pool.query(
              `SELECT id, name, kyc_status, kyc_expires_at FROM crm_trading_entities WHERE id = ANY($1::varchar[])`,
              [entityIds]
            )
          : Promise.resolve({ rows: [] as any[] }),
      ]);
      const parentById = new Map(parentRes.rows.map((r: any) => [r.id, r]));
      const entityById = new Map(entityRes.rows.map((r: any) => [r.id, r]));

      const notReady: { name: string; reason: string }[] = [];
      for (const p of pairs) {
        const entity = p.entityId ? entityById.get(p.entityId) : null;
        const parent = p.parentId ? parentById.get(p.parentId) : null;
        const kycStatus = entity?.kyc_status ?? parent?.kyc_status ?? null;
        const kycExpiresAt = entity?.kyc_expires_at ?? parent?.kyc_expires_at ?? null;
        const displayName = entity?.name || parent?.name || `(unknown ${p.role})`;
        if (kycStatus !== "approved") {
          notReady.push({ name: displayName, reason: kycStatus || "no checks run" });
        } else if (kycExpiresAt && new Date(kycExpiresAt) < new Date()) {
          notReady.push({ name: displayName, reason: "expired" });
        }
      }
      if (notReady.length > 0) {
        return res.status(403).json({
          error: `AML not complete: ${notReady.map((c: any) => `${c.name} (${c.reason})`).join(", ")}. Run KYC on the deal page, or pass amlOverride: true if you have senior approval.`,
        });
      }
    }
    // Log override usage for the audit trail.
    if (req.body?.amlOverride === true && GATED_STAGES.has(toStage)) {
      await pool.query(
        `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name)
         VALUES ($1, 'aml_override_used', $2, $3, $4)`,
        [
          dealId,
          JSON.stringify({ toStage, reason: req.body?.amlOverrideReason || null }),
          req.user?.id || null,
          req.user?.name || null,
        ],
      ).catch(() => {});
    }

    const updates: string[] = ["stage = $1", "stage_entered_at = now()", "updated_at = now()"];
    const values: any[] = [toStage];

    // When we hit HoTs we need AML on the tenant (and best-effort the
    // landlord) — this kicks Veriff off automatically so the team doesn't
    // have to remember. All of it is best-effort; if Veriff isn't configured
    // or the deal has no contacts, we just skip and leave the stage change
    // to succeed on its own.
    const triggerVeriffAml = toStage === "hots";
    if (toStage === "sols" && !current.rows[0].solicitor_instructed_at) {
      updates.push(`solicitor_instructed_at = now()`);
    }
    // Stamp the canonical date journey on entering each stage.
    if (toStage === "agreed" && !current.rows[0].exchanged_at) {
      updates.push(`exchanged_at = now()`);
    }
    if (toStage === "completed" && !current.rows[0].completed_at) {
      updates.push(`completed_at = now()`);
    }
    if (toStage === "invoiced" && !current.rows[0].invoiced_at) {
      updates.push(`invoiced_at = now()`);
    }

    values.push(dealId);
    await pool.query(
      `UPDATE crm_deals SET ${updates.join(", ")} WHERE id = $${values.length}`,
      values
    );

    await pool.query(
      `INSERT INTO deal_events (deal_id, event_type, from_stage, to_stage, payload, actor_id, actor_name)
       VALUES ($1, 'stage_change', $2, $3, $4, $5, $6)`,
      [dealId, fromStage, toStage, JSON.stringify({ reason, learning }), req.user?.id || null, req.user?.name || null]
    );

    // Knowledge capture — on completion with a broker learning, persist as
    // a brand_signals row against the tenant so it surfaces on the brand card.
    if (toStage === "completed" && learning) {
      try {
        const tenant = await pool.query(
          `SELECT d.tenant_id, d.name AS deal_name, tc.name AS tenant_name
             FROM crm_deals d LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
            WHERE d.id = $1`,
          [dealId]
        );
        const tRow = tenant.rows[0];
        if (tRow?.tenant_id) {
          await pool.query(
            `INSERT INTO brand_signals
              (brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated)
              VALUES ($1, 'news', $2, $3, $4, now(), 'medium', 'positive', false)`,
            [
              tRow.tenant_id,
              `Deal learning: ${tRow.deal_name || dealId}`.slice(0, 500),
              learning,
              `bgp-deal:${dealId}`,
            ]
          );
        }
      } catch (e: any) {
        console.warn("[deal-stages] learning capture failed:", e?.message);
      }
    }

    // Auto-run the full AML sweep on entering HoTs — Clouseau (Companies
    // House + UBO + Sanctions + PEP), Veriff sessions for all contacts,
    // and auto-tick of the company's aml_checklist. Runs async so we don't
    // block the UI on a slow Companies House call; every outcome is
    // recorded as deal_events so the audit trail captures it.
    if (triggerVeriffAml) {
      autoLaunchAmlForDeal(dealId, req.user?.id || null, req.user?.name || null)
        .catch((e) => console.warn(`[deal-stages] AML auto-run failed for ${dealId}:`, e?.message));
    }

    // When a deal completes, seed a crm_comp row if we have enough to go on
    if (toStage === "completed") {
      try {
        const d = await pool.query(
          `SELECT d.name, d.property_id, d.tenancy_unit_id, d.rent_pa, d.pricing, d.lease_length,
                  d.break_option, d.total_area_sqft, d.deal_type, d.completed_at,
                  lc.name AS landlord_name, tc.name AS tenant_name, tc.id AS tenant_company_id,
                  p.postcode AS property_postcode
             FROM crm_deals d
             LEFT JOIN crm_properties p ON p.id = d.property_id
             LEFT JOIN crm_companies lc ON lc.id = d.landlord_id
             LEFT JOIN crm_companies tc ON tc.id = d.tenant_id
            WHERE d.id = $1`,
          [dealId]
        );
        const row = d.rows[0];
        if (row && row.property_id && (row.rent_pa || row.pricing)) {
          await pool.query(
            `INSERT INTO crm_comps (
               name, property_id, deal_id, deal_type, landlord, tenant,
               passing_rent_pa, pricing, area_sqft, postcode, completion_date, created_by
             )
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
             WHERE NOT EXISTS (SELECT 1 FROM crm_comps WHERE deal_id = $3)`,
            [
              row.name,
              row.property_id,
              dealId,
              row.deal_type || "lease",
              row.landlord_name || null,
              row.tenant_name || null,
              row.rent_pa ? String(row.rent_pa) : null,
              row.pricing ? String(row.pricing) : null,
              row.total_area_sqft ? String(row.total_area_sqft) : null,
              row.property_postcode || null,
              new Date().toISOString().slice(0, 10),
              "auto-from-deal",
            ]
          );
        }

        // Write the let back onto the tenancy spine + fan out. Once the
        // tenancy row flips to Occupied, fanOutTenancyStatus archives
        // the leasing_schedule_units projection so the unit comes off
        // the client board automatically. The deal already vanishes
        // from the Letting Tracker because its status is COM (filtered
        // out by the tracker's AVA/NEG-only view).
        if (row?.tenancy_unit_id) {
          const completionDate = row.completed_at
            ? new Date(row.completed_at).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
          await pool.query(
            `UPDATE tenancy_schedule_units
                SET status = 'Occupied',
                    tenant_name = COALESCE(NULLIF(tenant_name, ''), $2),
                    tenant_company_id = COALESCE(tenant_company_id, $3),
                    passing_rent_pa = COALESCE(passing_rent_pa, $4),
                    lease_start = COALESCE(lease_start, $5::date),
                    updated_at = NOW()
              WHERE id = $1`,
            [
              row.tenancy_unit_id,
              row.tenant_name || null,
              row.tenant_company_id || null,
              row.rent_pa ? Number(row.rent_pa) : null,
              completionDate,
            ]
          );
          await fanOutTenancyStatus(pool, row.tenancy_unit_id);
        }
      } catch (e: any) {
        // comp seeding + tenancy writeback are best-effort — log and continue
        console.warn("[deal-stages] completion writeback failed:", e?.message);
      }
    }

    res.json({ ok: true, from: fromStage, to: toStage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Solicitor leg ───────────────────────────────────────────────────────
router.patch("/api/deal/:dealId/solicitor", requireAuth, async (req: Request & { user?: any }, res: Response) => {
  try {
    const dealId = String(req.params.dealId);
    const body = req.body || {};
    const fields = [
      "solicitor_firm", "solicitor_contact", "solicitor_instructed_at",
      "draft_lease_received_at", "comments_returned_at", "engrossment_at",
      "target_date", "exchanged_at", "completed_at", "invoiced_at", "solicitor_notes",
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    const changed: Record<string, any> = {};
    for (const f of fields) {
      const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const v = f in body ? body[f] : (camel in body ? body[camel] : undefined);
      if (v !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(v);
        changed[f] = v;
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no fields" });
    sets.push("updated_at = now()");
    vals.push(dealId);
    await pool.query(`UPDATE crm_deals SET ${sets.join(", ")} WHERE id = $${i}`, vals);

    await pool.query(
      `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name)
       VALUES ($1, 'solicitor_update', $2, $3, $4)`,
      [dealId, JSON.stringify(changed), req.user?.id || null, req.user?.name || null]
    );

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Generic event log ───────────────────────────────────────────────────
router.post("/api/deal/:dealId/events", requireAuth, async (req: Request & { user?: any }, res: Response) => {
  try {
    const dealId = String(req.params.dealId);
    const eventType = req.body?.eventType || req.body?.event_type;
    if (!eventType) return res.status(400).json({ error: "eventType required" });
    const payload = req.body?.payload || null;
    const r = await pool.query(
      `INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [dealId, eventType, payload ? JSON.stringify(payload) : null, req.user?.id || null, req.user?.name || null]
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
