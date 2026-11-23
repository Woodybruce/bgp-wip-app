// A Letting Tracker unit with no tenancy schedule row (Woody, 2026-11-23: "if
// we are marketing a unit of the letting tracker it really should be on the
// tenancy schedule"). One door adds it: a schedule row made from the tracker
// row, tied to it by the stored ids (letting_tracker_unit_id on the row,
// tenancy_unit_id on the tracker row and on its deal), never by name. A person
// asks for it, one unit from the property page, or an admin ticks a list
// (Preview, then Apply). Nothing runs at boot or on a timer.
//
// "Not on the schedule" is the unit feed's and the schedule screen's own test
// (TRACKER_ONLY_SQL in server/property-units.ts, the vacancy read in
// server/tenancy-schedule.ts): qa/regression/tracker-to-schedule.test.mjs holds
// the three in step.
import type { Express, Request, RequestHandler, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { normUnitSql } from "./tenant-brand-resolver";
import { legacyToCode } from "@shared/deal-status";

export const notOnScheduleSql = (au: string) => `NOT EXISTS (
  SELECT 1 FROM tenancy_schedule_units ts
   WHERE ts.property_id = ${au}.property_id
     AND (
       ts.id::text = ${au}.tenancy_unit_id::text
       OR ts.letting_tracker_unit_id = ${au}.id
       OR (${au}.tenancy_unit_id IS NULL AND ${au}.unit_id IS NOT NULL AND ts.property_unit_id = ${au}.unit_id)
       OR (${au}.tenancy_unit_id IS NULL
           AND (${au}.unit_id IS NULL OR ts.property_unit_id IS NULL)
           AND ${normUnitSql(`${au}.unit_name`)} <> ''
           AND ${normUnitSql("coalesce(nullif(trim(ts.unit_number), ''), ts.premises)")} = ${normUnitSql(`${au}.unit_name`)})
     )
)`;

const LET_CODES = ["EXC", "COM", "INV"];
const CLOSED_CODES = ["WIT"];

export type AddResult =
  | { status: "added"; rowId: string; propertyId: string; unit: string }
  | { status: "already"; propertyId: string; unit: string }
  | { status: "not_found" };

export async function addTrackerUnitToSchedule(pool: Pool, trackerId: string, who: { userId: string | null; name: string }): Promise<AddResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT au.id, au.property_id, au.unit_id, au.unit_name, au.floor, au.sqft, au.use_class, au.deal_id, d.status AS deal_status
         FROM available_units au LEFT JOIN crm_deals d ON d.id = au.deal_id
        WHERE au.id = $1 FOR UPDATE OF au`,
      [trackerId],
    );
    const au = found.rows[0];
    if (!au || !au.property_id) { await client.query("ROLLBACK"); return { status: "not_found" }; }
    // Two people adding units at one property at once must not both see "not on the schedule".
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('tracker-to-schedule:' || $1::text))`, [au.property_id]);
    const unit = String(au.unit_name || "").trim() || "Unnamed unit";
    const missing = await client.query(`SELECT ${notOnScheduleSql("au")} AS missing FROM available_units au WHERE au.id = $1`, [trackerId]);
    if (!missing.rows[0]?.missing) { await client.query("ROLLBACK"); return { status: "already", propertyId: au.property_id, unit }; }

    const let_ = LET_CODES.includes(legacyToCode(au.deal_status) || "");
    const inserted = await client.query(
      `INSERT INTO tenancy_schedule_units (property_id, unit_number, floor_level, permitted_use, nia_sqft, status, letting_tracker_unit_id, deal_id, property_unit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [au.property_id, unit, au.floor || null, au.use_class || null, au.sqft ?? null, let_ ? "Occupied" : "Vacant", au.id, au.deal_id || null, au.unit_id || null],
    );
    const rowId = String(inserted.rows[0].id);
    await client.query(`UPDATE available_units SET tenancy_unit_id = $1 WHERE id = $2`, [rowId, au.id]);
    if (au.deal_id) {
      await client.query(`UPDATE crm_deals SET tenancy_unit_id = $1 WHERE id = $2 AND tenancy_unit_id IS NULL`, [rowId, au.deal_id]);
      await client.query(
        `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name)
         VALUES ($1, 'tenancy_schedule', NULL, $2, $3, $4, $5)`,
        [au.deal_id, rowId, `${unit} added to the tenancy schedule from the Letting Tracker`, who.userId, who.name],
      );
    }
    await client.query("COMMIT");
    return { status: "added", rowId, propertyId: au.property_id, unit };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Every tracker row not on its property's schedule. A unit whose letting was
// withdrawn or archived is listed but not ticked: it may be one to delete.
export async function trackerScheduleGaps(pool: Pool) {
  const rows = await pool.query(
    `SELECT au.id, au.unit_name, au.sqft, au.marketing_status, au.created_at,
            p.id AS property_id, p.name AS property_name, d.id AS deal_id, d.deal_ref, d.status AS deal_status
       FROM available_units au
       JOIN crm_properties p ON p.id = au.property_id
       LEFT JOIN crm_deals d ON d.id = au.deal_id
      WHERE ${notOnScheduleSql("au")}
      ORDER BY p.name, au.unit_name, au.id
      LIMIT 2000`,
  );
  return rows.rows.map(r => ({
    trackerId: r.id, unit: String(r.unit_name || "").trim() || "Unnamed unit", sqft: r.sqft ?? null,
    propertyId: r.property_id, propertyName: r.property_name, marketingStatus: r.marketing_status || null,
    dealId: r.deal_id || null, dealRef: r.deal_ref ?? null, dealStatus: r.deal_status || null,
    suggested: !CLOSED_CODES.includes(legacyToCode(r.deal_status) || "") && !/archiv/i.test(String(r.deal_status || "")),
  }));
}

const PREVIEW_KEY = "tracker-schedule-gaps:preview";
const PREVIEW_MINUTES = 60;

async function userName(pool: Pool, id: string | null): Promise<string> {
  if (!id) return "unknown login";
  const r = await pool.query(`SELECT username FROM users WHERE id = $1`, [id]).catch(() => ({ rows: [] as any[] }));
  return r.rows[0]?.username || String(id);
}

export function registerTrackerToScheduleRoutes(app: Express, deps: { pool: Pool; requireAuth: RequestHandler; requireAdmin: RequestHandler }) {
  const { pool, requireAuth, requireAdmin } = deps;
  const actor = (req: Request): string | null => (req as any).session?.userId || (req as any).tokenUserId || null;
  const fail = (res: Response, e: any) => {
    console.error("[tracker-to-schedule]", e?.message || e);
    res.status(500).json({ message: "The unit could not be added to the tenancy schedule." });
  };

  // One unit, from the property page (the unit panel, the schedule's tracker row).
  // Under /api/tenancy-schedule/unit so client logins reach it as they reach the
  // schedule's own add; the property is checked here.
  app.post("/api/tenancy-schedule/unit/from-tracker/:trackerId", requireAuth, async (req, res) => {
    try {
      const trackerId = String(req.params.trackerId);
      const at = await pool.query(`SELECT property_id FROM available_units WHERE id = $1`, [trackerId]);
      const propertyId = at.rows[0]?.property_id;
      if (!propertyId) return res.status(404).json({ message: "That Letting Tracker unit no longer exists." });
      const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
      const sc = await resolveCompanyScope(req as any);
      if (sc && !(await isPropertyInScope(sc, propertyId))) return res.status(404).json({ message: "That Letting Tracker unit no longer exists." });
      const id = actor(req);
      const result = await addTrackerUnitToSchedule(pool, trackerId, { userId: id, name: await userName(pool, id) });
      if (result.status === "not_found") return res.status(404).json({ message: "That Letting Tracker unit no longer exists." });
      res.json(result);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/admin/tracker-schedule-gaps", requireAuth, requireAdmin, async (req, res) => {
    try {
      const units = await trackerScheduleGaps(pool);
      const previewedAt = new Date().toISOString();
      await pool.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [PREVIEW_KEY, JSON.stringify({ by: actor(req), at: previewedAt, ids: units.map(u => u.trackerId) })],
      );
      res.json({ previewedAt, units });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/admin/tracker-schedule-gaps/apply", requireAuth, requireAdmin, async (req, res) => {
    try {
      const by = actor(req);
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 2000) : [];
      if (!ids.length) return res.status(400).json({ message: "Tick at least one unit." });
      const stored = (await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [PREVIEW_KEY])).rows[0]?.value;
      const preview = typeof stored === "string" ? JSON.parse(stored) : stored;
      const fresh = preview && preview.by === by && preview.at === req.body?.previewedAt
        && Date.now() - new Date(preview.at).getTime() < PREVIEW_MINUTES * 60_000;
      if (!fresh) return res.status(409).json({ message: "Preview again: Apply takes the units from your own preview of the last hour." });
      const listed = new Set<string>((preview.ids || []).map(String));
      const name = await userName(pool, by);
      let added = 0, already = 0, failed = 0;
      for (const id of ids) {
        if (!listed.has(id)) continue;
        try {
          const r = await addTrackerUnitToSchedule(pool, id, { userId: by, name });
          if (r.status === "added") added++; else already++;
        } catch (e: any) {
          failed++;
          console.warn("[tracker-to-schedule] apply", id, e?.message);
        }
      }
      res.json({ added, already, failed });
    } catch (e) { fail(res, e); }
  });
}
