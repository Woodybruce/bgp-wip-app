// "Needs review" on the property page (Woody, 2026-09-27: "list these on each
// property page — someone can look"). Two sources:
//   • stored items — imports and matches that need a person: a Landsec
//     tracker line that fits two units (choose the unit), source-data values
//     held back because the app's own could be newer (use file / keep app);
//   • live items — plan scans ready for review, unlinked plan outlines.
// Each stored option is a set of schedule writes, limited to the schedule
// fields users can edit anyway. Staff only.
import { Router, type Request, type Response } from "express";
import { openPlanCandidates } from "./property-plan-match";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { TENANCY_FIELDS } from "./tenancy-schedule";
import { setTenancyTenant } from "./tenancy-tenant";

const LEASING_FIELDS = new Set(["zone", "positioning", "unit_name", "tenant_name", "agent_initials", "lease_expiry", "lease_break", "rent_review", "landlord_break",
  "rent_pa", "sqft", "mat_psqft", "lfl_percent", "occ_cost_percent", "financial_notes", "target_brands", "optimum_target", "priority", "status", "updates",
  "target_company_ids", "status_band", "meeting_month", "agent_input", "positioning_group", "tenancy_unit_id", "tenant_company_id"]);
const TABLES: Record<string, Set<string>> = {
  // tenant_company_id: a chosen trading name links its CRM brand too. The
  // company on the lease (tenant_entity_id) is never set from a review item.
  tenancy_schedule_units: new Set([...TENANCY_FIELDS, "tenant_company_id"]),
  leasing_schedule_units: LEASING_FIELDS,
};
type Write = { table: string; id: string; set: Record<string, any> };
// On a schedule row the brand and the two names go through the tenant door
// (server/tenancy-tenant.ts) as the person's pick; the rest is a plain UPDATE.
const TENANT_DOOR_FIELDS: Record<string, "companyId" | "tradingName" | "tenantName"> = {
  tenant_company_id: "companyId", trading_name: "tradingName", tenant_name: "tenantName",
};
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
  // The scan outlines still waiting are the ones the Match board lists
  // (server/property-plan-match.ts openPlanCandidates): not saved, not marked
  // "not a unit", and with nothing since drawn over them. An outline kept as
  // context there (status_override 'unlinked') is unlinked on purpose, so it
  // is not asked about again.
  const { rows: latest } = await pool.query(`SELECT DISTINCT ON (p.id) p.id AS plan_id, p.floor, s.status, s.candidates
    FROM property_plans p JOIN property_plan_scans s ON s.plan_id = p.id AND s.image_key = p.storage_key
    WHERE p.property_id = $1 ORDER BY p.id, s.created_at DESC, s.id DESC`, [propertyId]);
  const { rows: drawn } = await pool.query(`SELECT u.id, u.plan_id, p.floor, u.label, u.polygon, u.tenancy_unit_id, u.unit_id, u.status_override
    FROM property_plan_units u JOIN property_plans p ON p.id = u.plan_id WHERE p.property_id = $1`, [propertyId]);
  const scans = latest.map((s: any) => {
    const open = s.status === "ready" ? openPlanCandidates(s.candidates, drawn.filter((o: any) => o.plan_id === s.plan_id)) : [];
    return { plan_id: s.plan_id, floor: s.floor, status: s.status, proposed: open.length, linked: open.filter(c => c.tenancy_unit_id).length };
  });
  const loose = new Map<string, { plan_id: string; floor: string; unlinked: number }>();
  for (const o of drawn) {
    if (o.tenancy_unit_id || o.unit_id || o.status_override === "unlinked") continue;
    const entry = loose.get(o.plan_id) || { plan_id: o.plan_id, floor: o.floor, unlinked: 0 };
    entry.unlinked++;
    loose.set(o.plan_id, entry);
  }
  const outlines = [...loose.values()];
  const ready = scans.filter(s => s.status === "ready" && s.proposed > 0);
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
    const userId = (req as any).session?.userId || (req as any).tokenUserId;
    const actor = { userId: String(userId || "unknown"), name: by || "unknown login", viewer: "staff" as const };
    let written = 0;
    for (const w of chosen.writes) {
      if (!Object.keys(w.set).length) continue;
      const viaDoor = (c: string) => w.table === "tenancy_schedule_units" && Object.prototype.hasOwnProperty.call(TENANT_DOOR_FIELDS, c);
      const tenantInput = Object.fromEntries(Object.keys(w.set).filter(viaDoor).map(c => [TENANT_DOOR_FIELDS[c], w.set[c]]));
      const cols = Object.keys(w.set).filter(c => !viaDoor(c));
      const { rows: [row] } = await db.query(`SELECT property_id FROM ${w.table} WHERE id::text = $1`, [w.id]);
      if (!row || row.property_id !== item.property_id) throw Object.assign(new Error("A unit in this option no longer belongs to the property"), { status: 409 });
      if (cols.length) {
        await db.query(`UPDATE ${w.table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE id::text = $1`,
          [w.id, ...cols.map(c => w.set[c])]);
      }
      if (Object.keys(tenantInput).length) await setTenancyTenant(db, w.id, tenantInput, actor);
      written++;
    }
    await db.query(`UPDATE property_review_items SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`, [item.id, chosen.label, by]);
    await db.query("COMMIT");
    res.json({ ok: true, written });
  } catch (e: any) { await db.query("ROLLBACK").catch(() => {}); res.status(e.status || 500).json({ error: e.message }); }
  finally { db.release(); }
});

export default router;
