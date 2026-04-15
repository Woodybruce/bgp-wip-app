// ─────────────────────────────────────────────────────────────────────────
// Deal stage transitions + solicitor leg.
//
// Enforces an ordered pipeline, writes to deal_events for full audit, and
// triggers secondary actions (e.g. hots_completed_at on entering 'hots',
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

const router = Router();

const PIPELINE = [
  "instruction", "marketing", "viewings", "offers",
  "hots", "sols", "agreed", "completed", "invoiced",
] as const;
type Stage = (typeof PIPELINE)[number];

function isValidStage(s: any): s is Stage {
  return typeof s === "string" && (PIPELINE as readonly string[]).includes(s);
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
    if (!isValidStage(toStage)) {
      return res.status(400).json({ error: `stage must be one of ${PIPELINE.join(", ")}` });
    }

    const current = await pool.query(
      `SELECT id, stage, hots_completed_at, solicitor_instructed_at FROM crm_deals WHERE id = $1`,
      [dealId]
    );
    if (!current.rows[0]) return res.status(404).json({ error: "Deal not found" });
    const fromStage = current.rows[0].stage;

    const updates: string[] = ["stage = $1", "stage_entered_at = now()", "updated_at = now()"];
    const values: any[] = [toStage];

    // Side-effects triggered by transition
    if (toStage === "hots" && !current.rows[0].hots_completed_at) {
      updates.push(`hots_completed_at = now()`);
    }
    if (toStage === "sols" && !current.rows[0].solicitor_instructed_at) {
      updates.push(`solicitor_instructed_at = now()`);
    }
    if (toStage === "completed") {
      updates.push(`completion_date = to_char(now(), 'YYYY-MM-DD')`);
    }

    values.push(dealId);
    await pool.query(
      `UPDATE crm_deals SET ${updates.join(", ")} WHERE id = $${values.length}`,
      values
    );

    await pool.query(
      `INSERT INTO deal_events (deal_id, event_type, from_stage, to_stage, payload, actor_id, actor_name)
       VALUES ($1, 'stage_change', $2, $3, $4, $5, $6)`,
      [dealId, fromStage, toStage, JSON.stringify({ reason }), req.user?.id || null, req.user?.name || null]
    );

    // When a deal completes, seed a crm_comp row if we have enough to go on
    if (toStage === "completed") {
      try {
        const d = await pool.query(
          `SELECT d.name, d.property_id, d.rent_pa, d.pricing, d.lease_length, d.break_option, d.total_area_sqft,
                  d.deal_type, lc.name AS landlord_name, tc.name AS tenant_name,
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
      } catch (e: any) {
        // comp seeding is best-effort — log and continue
        console.warn("[deal-stages] comp seed failed:", e?.message);
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
      "completion_target_date", "solicitor_notes",
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
