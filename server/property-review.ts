// "Needs review" on the property page (Woody, 2026-09-27: "list these on each
// property page — someone can look"). Two sources:
//   • stored items — imports and matches that need a person: a Landsec
//     tracker line that fits two units (choose the unit), source-data values
//     held back because the app's own could be newer (use file / keep app);
//   • live items — plan scans ready for review, unlinked plan outlines.
// Each stored option is a set of schedule writes, limited to the schedule
// fields users can edit anyway. Staff only.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { TENANCY_FIELDS } from "./tenancy-schedule";

const LEASING_FIELDS = new Set(["zone", "positioning", "unit_name", "tenant_name", "agent_initials", "lease_expiry", "lease_break", "rent_review", "landlord_break",
  "rent_pa", "sqft", "mat_psqft", "lfl_percent", "occ_cost_percent", "financial_notes", "target_brands", "optimum_target", "priority", "status", "updates",
  "target_company_ids", "status_band", "meeting_month", "agent_input", "positioning_group", "tenancy_unit_id", "tenant_company_id"]);
const TABLES: Record<string, Set<string>> = {
  tenancy_schedule_units: new Set(TENANCY_FIELDS),
  leasing_schedule_units: LEASING_FIELDS,
};
type Write = { table: string; id: string; set: Record<string, any> };
type Option = { key: string; label: string; detail?: string; writes: Write[] };

function validOptions(options: any): Option[] {
  if (!Array.isArray(options) || options.length > 20) throw Object.assign(new Error("Up to 20 options"), { status: 400 });
  return options.map((o: any, i: number) => {
    const writes = Array.isArray(o?.writes) ? o.writes : [];
    for (const w of writes) {
      const allowed = TABLES[w?.table];
      if (!allowed || typeof w.id !== "string" || !w.set || typeof w.set !== "object") throw Object.assign(new Error("Invalid write"), { status: 400 });
      for (const k of Object.keys(w.set)) if (!allowed.has(k)) throw Object.assign(new Error(`${k} can't be set from a review item`), { status: 400 });
    }
    return { key: String(o?.key || `option-${i + 1}`), label: String(o?.label || `Option ${i + 1}`).slice(0, 200), detail: o?.detail ? String(o.detail).slice(0, 2000) : undefined, writes };
  });
}

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  const { resolveCompanyScope } = await import("./company-scope");
  if (await resolveCompanyScope(req)) { res.status(403).json({ error: "Available in the staff view." }); return false; }
  return true;
}
async function actorName(req: Request): Promise<string | null> {
  const id = (req as any).session?.userId || (req as any).tokenUserId;
  if (!id) return null;
  const { rows } = await pool.query(`SELECT name, username FROM users WHERE id = $1`, [id]).catch(() => ({ rows: [] as any[] }));
  return rows[0]?.name || rows[0]?.username || String(id);
}

export async function liveReviewItems(propertyId: string) {
  const { rows: scans } = await pool.query(`SELECT DISTINCT ON (p.id) p.id AS plan_id, p.floor, s.status, jsonb_array_length(s.candidates) AS proposed,
      (SELECT COUNT(*)::int FROM jsonb_array_elements(s.candidates) c WHERE c->>'tenancy_unit_id' IS NOT NULL) AS linked
    FROM property_plans p JOIN property_plan_scans s ON s.plan_id = p.id AND s.image_key = p.storage_key
    WHERE p.property_id = $1 ORDER BY p.id, s.created_at DESC`, [propertyId]);
  const { rows: outlines } = await pool.query(`SELECT p.id AS plan_id, p.floor, COUNT(*)::int AS unlinked
    FROM property_plan_units u JOIN property_plans p ON p.id = u.plan_id
    WHERE p.property_id = $1 AND u.tenancy_unit_id IS NULL AND u.unit_id IS NULL GROUP BY p.id, p.floor`, [propertyId]);
  const ready = scans.filter((s: any) => s.status === "ready");
  const proposed = ready.reduce((n: number, s: any) => n + (s.proposed || 0), 0), matched = ready.reduce((n: number, s: any) => n + (s.linked || 0), 0);
  return [
    // One item for all floors' scans — each floor is reviewed on the plan.
    ...(ready.length ? [{ id: `scans:${propertyId}`, kind: "plan_scan", live: true, planId: ready[0].plan_id,
      title: ready.length === 1 ? `Review the unit scan · ${ready[0].floor}` : `Review the unit scans · ${ready.length} floors (${ready.map((s: any) => s.floor).join(", ")})`,
      detail: `${proposed} proposed outline${proposed === 1 ? "" : "s"}${matched ? `, ${matched} already matched to a tenancy row` : ""}. On each floor open Review scan, tick the ones that follow the shop boundaries and add them — the rest are matched to the schedule automatically.` }] : []),
    ...outlines.filter((o: any) => o.unlinked > 0).map((o: any) => ({ id: `outlines:${o.plan_id}`, kind: "plan_links", live: true, planId: o.plan_id,
      title: `Link plan outlines · ${o.floor}`, detail: `${o.unlinked} outline${o.unlinked === 1 ? " isn't" : "s aren't"} linked to a tenancy row. "Match unlinked outlines to the schedule" links the certain ones; the rest need choosing.` })),
  ];
}

const router = Router();

router.get("/api/properties/:id/review-items", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await staffOnly(req, res)) return;
    const propertyId = String(req.params.id);
    const { rows } = await pool.query(`SELECT id, kind, title, detail, source, options, created_at FROM property_review_items
      WHERE property_id = $1 AND status = 'open' ORDER BY kind, created_at`, [propertyId]);
    res.json({ items: [...(await liveReviewItems(propertyId)), ...rows.map((r: any) => ({ ...r, options: (r.options || []).map((o: Option) => ({ key: o.key, label: o.label, detail: o.detail, writes: o.writes.length })) }))] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Create items (imports and match jobs post here). Re-posting the same
// source + title for a property replaces the open item rather than doubling it.
router.post("/api/properties/:id/review-items", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!await staffOnly(req, res)) return;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length || items.length > 500) return res.status(400).json({ error: "Send 1–500 items" });
    const by = await actorName(req);
    let created = 0;
    for (const it of items) {
      const options = validOptions(it.options);
      if (!it.kind || !it.title) return res.status(400).json({ error: "Each item needs a kind and a title" });
      await pool.query(`DELETE FROM property_review_items WHERE property_id = $1 AND status = 'open' AND source IS NOT DISTINCT FROM $2 AND title = $3`, [req.params.id, it.source || null, String(it.title)]);
      await pool.query(`INSERT INTO property_review_items (property_id, kind, title, detail, source, options, created_by) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [req.params.id, String(it.kind).slice(0, 60), String(it.title).slice(0, 300), it.detail ? String(it.detail).slice(0, 4000) : null, it.source || null, JSON.stringify(options), by]);
      created++;
    }
    res.json({ created });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
});

// Apply one option (its schedule writes) or dismiss. Writes go through the
// same field lists as the schedule editors and are recorded on the item.
router.post("/api/review-items/:id/resolve", requireAuth, async (req: Request, res: Response) => {
  const db = await pool.connect();
  try {
    if (!await staffOnly(req, res)) return;
    const { option, dismiss } = req.body || {};
    await db.query("BEGIN");
    const { rows: [item] } = await db.query(`SELECT * FROM property_review_items WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!item) { await db.query("ROLLBACK"); return res.status(404).json({ error: "Review item not found" }); }
    if (item.status !== "open") { await db.query("ROLLBACK"); return res.status(409).json({ error: "Already resolved" }); }
    const by = await actorName(req);
    if (dismiss) {
      await db.query(`UPDATE property_review_items SET status = 'dismissed', resolution = 'dismissed', resolved_by = $2, resolved_at = now() WHERE id = $1`, [item.id, by]);
      await db.query("COMMIT");
      return res.json({ ok: true, dismissed: true });
    }
    const chosen: Option | undefined = validOptions(item.options).find(o => o.key === option);
    if (!chosen) { await db.query("ROLLBACK"); return res.status(400).json({ error: "Choose one of the item's options" }); }
    let written = 0;
    for (const w of chosen.writes) {
      const cols = Object.keys(w.set);
      if (!cols.length) continue;
      const { rows: [row] } = await db.query(`SELECT property_id FROM ${w.table} WHERE id::text = $1`, [w.id]);
      if (!row || row.property_id !== item.property_id) throw Object.assign(new Error("A unit in this option no longer belongs to the property"), { status: 409 });
      await db.query(`UPDATE ${w.table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE id::text = $1`,
        [w.id, ...cols.map(c => w.set[c])]);
      written++;
    }
    await db.query(`UPDATE property_review_items SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`, [item.id, chosen.label, by]);
    await db.query("COMMIT");
    res.json({ ok: true, written });
  } catch (e: any) { await db.query("ROLLBACK").catch(() => {}); res.status(e.status || 500).json({ error: e.message }); }
  finally { db.release(); }
});

export default router;
