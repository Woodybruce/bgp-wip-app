// Trading names for tenancy rows that only carry the lease's legal entity
// (Woody, 2026-09-27: "can the app find the trading names?"). "Nero Holdings
// Limited" is Caffè Nero; without the trading name the Brand Gap and target
// plan think the brand is missing. Three steps, most certain first:
//   1. the row is already linked to a brand → that brand's name;
//   2. the legal name is a brand's recorded UK entity / trading entity →
//      fill the trading name and link the brand;
//   3. AI names the brand the entity trades as. A confident, single-brand
//      answer that matches a CRM brand is filled and the legal name is saved
//      on the brand (so future imports resolve on their own); anything else
//      goes to the property's Needs review with the choices.
// Only blank trading names are ever written. Runs nightly; POST
// /api/properties/:id/find-trading-names runs one property now.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const LEGAL = /\s*\b(limited|ltd|plc|llp|lp|inc|incorporated|corp|corporation|holdings?|group|uk|u\.k\.|gb|company|co|trading|retail|stores?|restaurants?|\(uk\)|\(gb\))\.?\s*$/gi;
export const legalKey = (value: string) => {
  let v = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\(in administration\)|\(in liquidation\)/g, "").replace(/['’.]/g, "").trim();
  for (let i = 0; i < 4; i++) v = v.replace(LEGAL, "").trim();
  return v.replace(/[^a-z0-9&]+/g, " ").trim();
};
const NOT_A_TENANT = /^(sole trader|vacant|tbc|n\/?a|unknown|landlord|various)$/i;

type Row = { id: string; property_id: string; unit_number: string | null; tenant_name: string; permitted_use: string | null; tenant_company_id: string | null };
type Brand = { id: string; name: string; company_type: string | null; uk_entity_name: string | null; trading_entities: any };

async function brandBook(): Promise<{ byLegal: Map<string, Brand[]>; byName: Map<string, Brand[]>; byId: Map<string, Brand> }> {
  const brands: Brand[] = (await pool.query(`SELECT id, name, company_type, uk_entity_name, trading_entities FROM crm_companies
    WHERE merged_into_id IS NULL AND company_type ILIKE 'tenant%'`)).rows;
  const byLegal = new Map<string, Brand[]>(), byName = new Map<string, Brand[]>(), byId = new Map<string, Brand>();
  const put = (m: Map<string, Brand[]>, k: string, b: Brand) => { if (k.length < 3) return; const l = m.get(k) || []; if (!l.includes(b)) l.push(b); m.set(k, l); };
  for (const b of brands) {
    byId.set(b.id, b);
    put(byName, legalKey(b.name), b);
    if (b.uk_entity_name) put(byLegal, legalKey(b.uk_entity_name), b);
    for (const e of Array.isArray(b.trading_entities) ? b.trading_entities : []) if (e?.name) put(byLegal, legalKey(String(e.name)), b);
  }
  return { byLegal, byName, byId };
}

async function askAi(rows: Row[], propertyName: string): Promise<Map<string, { brand: string | null; brands: string[]; confidence: string; note: string }>> {
  const out = new Map<string, { brand: string | null; brands: string[]; confidence: string; note: string }>();
  if (!rows.length || !process.env.ANTHROPIC_API_KEY) return out;
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const list = rows.map((r, i) => `${i + 1}. ${r.tenant_name}${r.unit_number ? ` · unit ${String(r.unit_number).split(/\s+/)[0]}` : ""}${r.permitted_use ? ` · ${r.permitted_use}` : ""}`).join("\n");
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 3000,
    tools: [{ name: "record", description: "Record the trading brand for each tenant entity.", input_schema: { type: "object", required: ["tenants"], properties: {
      tenants: { type: "array", items: { type: "object", required: ["n", "brand", "confidence"], properties: {
        n: { type: "integer" }, brand: { type: ["string", "null"] }, other_brands: { type: "array", items: { type: "string" } },
        confidence: { type: "string", enum: ["high", "medium", "low"] }, note: { type: "string" },
      } } } } } }],
    tool_choice: { type: "tool", name: "record" },
    messages: [{ role: "user", content: `These are tenants on the tenancy schedule of ${propertyName}, a UK shopping centre / retail property, recorded by the lease's legal entity. For each, give the consumer-facing brand the unit trades as (e.g. "Nero Holdings Limited" → "Caffè Nero", "Starbucks Coffee Company (UK) Ltd" → "Starbucks"). Rules: "high" only when the entity is well known to trade as exactly that brand. If the entity runs several brands (e.g. ITX UK → Zara, Bershka, Pull&Bear), set brand to the most likely one for the unit's use if any, list the rest in other_brands and use "medium" or "low". A private individual or an entity you don't recognise → brand null, "low". Never invent a brand.\n\n${list}` }],
  });
  const tool = msg.content.find((b: any) => b.type === "tool_use") as any;
  for (const t of tool?.input?.tenants || []) {
    const row = rows[Number(t.n) - 1];
    if (row) out.set(row.id, { brand: t.brand ? String(t.brand).trim() : null, brands: (t.other_brands || []).map(String), confidence: t.confidence, note: String(t.note || "") });
  }
  return out;
}

export async function findTradingNames(propertyId: string) {
  const property = (await pool.query(`SELECT name FROM crm_properties WHERE id = $1`, [propertyId])).rows[0];
  if (!property) throw Object.assign(new Error("Property not found"), { status: 404 });
  const rows: Row[] = (await pool.query(`SELECT id::text, property_id, unit_number, tenant_name, permitted_use, tenant_company_id FROM tenancy_schedule_units
    WHERE property_id = $1 AND COALESCE(trim(trading_name), '') = '' AND COALESCE(trim(tenant_name), '') <> ''
      AND lower(trim(coalesce(status, ''))) <> 'archived' AND lower(trim(coalesce(occupancy_status, ''))) <> 'archived'`, [propertyId])).rows
    .filter((r: Row) => !NOT_A_TENANT.test(r.tenant_name.trim()));
  if (!rows.length) return { property: property.name, checked: 0, filled: 0, review: 0 };
  const book = await brandBook();
  const filled: Array<{ row: Row; brand: Brand | { id: null; name: string }; how: string }> = [];
  const unsure: Row[] = [];
  for (const r of rows) {
    const linked = r.tenant_company_id ? book.byId.get(r.tenant_company_id) : undefined;
    if (linked) { filled.push({ row: r, brand: linked, how: "linked brand" }); continue; }
    const k = legalKey(r.tenant_name);
    const legal = book.byLegal.get(k) || [];
    const named = book.byName.get(k) || [];
    const hit = legal.length === 1 ? legal[0] : !legal.length && named.length === 1 ? named[0] : null;
    if (hit) filled.push({ row: r, brand: hit, how: legal.length ? "recorded entity" : "brand name" });
    else unsure.push(r);
  }

  const ai = await askAi(unsure.slice(0, 60), property.name).catch(e => { console.warn("[trading-names] AI failed:", e?.message); return new Map(); });
  const reviews: any[] = [];
  for (const r of unsure) {
    const a = ai.get(r.id);
    if (!a?.brand) continue;
    const matches = book.byName.get(legalKey(a.brand)) || [];
    const brand = matches.length === 1 ? matches[0] : null;
    if (a.confidence === "high" && !a.brands.length) { filled.push({ row: r, brand: brand || { id: null, name: a.brand }, how: "AI" }); continue; }
    const choices = [a.brand, ...a.brands].filter((v, i, all) => v && all.indexOf(v) === i).slice(0, 6);
    reviews.push({
      kind: "trading_name", source: "Find trading names",
      title: `Trading name for ${r.tenant_name}${r.unit_number ? ` (${String(r.unit_number).split(/\s+/)[0]})` : ""}`,
      detail: `The tenancy schedule records the legal entity only. ${a.note || ""}`.trim(),
      options: choices.map((name, i) => {
        const m = book.byName.get(legalKey(name)) || [];
        return { key: `brand-${i + 1}`, label: name, detail: m.length === 1 ? "Links the CRM brand too" : "Not in the CRM yet — sets the trading name only",
          writes: [{ table: "tenancy_schedule_units", id: r.id, set: { trading_name: m.length === 1 ? m[0].name : name, ...(m.length === 1 ? { tenant_company_id: m[0].id } : {}) } }] };
      }),
    });
  }

  for (const f of filled) {
    await pool.query(`UPDATE tenancy_schedule_units SET trading_name = $2, tenant_company_id = COALESCE(tenant_company_id, $3), updated_at = NOW()
      WHERE id::text = $1 AND COALESCE(trim(trading_name), '') = ''`, [f.row.id, f.brand.name, f.brand.id]).catch(() =>
      pool.query(`UPDATE tenancy_schedule_units SET trading_name = $2, tenant_company_id = COALESCE(tenant_company_id, $3)
        WHERE id::text = $1 AND COALESCE(trim(trading_name), '') = ''`, [f.row.id, f.brand.name, f.brand.id]));
    // Teach the brand its legal entity so the next import resolves by itself.
    if (f.brand.id && f.how === "AI" && legalKey(f.row.tenant_name) !== legalKey(f.brand.name)) {
      await pool.query(`UPDATE crm_companies SET trading_entities = COALESCE(CASE WHEN jsonb_typeof(trading_entities) = 'array' THEN trading_entities END, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('name', $2::text, 'source', 'tenancy schedule'))
        WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(trading_entities) = 'array' THEN trading_entities ELSE '[]'::jsonb END) e
          WHERE lower(e->>'name') = lower($2::text))`, [f.brand.id, f.row.tenant_name.replace(/\s*\(in (administration|liquidation)\)\s*/i, "").trim()]).catch(() => {});
    }
  }
  if (reviews.length) {
    for (const it of reviews) {
      await pool.query(`DELETE FROM property_review_items WHERE property_id = $1 AND status = 'open' AND source = $2 AND title = $3`, [propertyId, it.source, it.title]);
      await pool.query(`INSERT INTO property_review_items (property_id, kind, title, detail, source, options, created_by) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'Find trading names')`,
        [propertyId, it.kind, it.title, it.detail, it.source, JSON.stringify(it.options)]);
    }
  }
  const { backfillPropertyTenants } = await import("./tenant-brand-resolver");
  await backfillPropertyTenants(propertyId).catch(() => {});
  return { property: property.name, checked: rows.length, filled: filled.length, review: reviews.length,
    filledRows: filled.map(f => ({ legal: f.row.tenant_name, trading: f.brand.name, how: f.how })),
    reviewRows: reviews.map(r => r.title) };
}

// Nightly: properties with blank trading names, a few at a time.
export async function runNightlyTradingNames(limit = 15) {
  const props = (await pool.query(`SELECT property_id, COUNT(*) AS n FROM tenancy_schedule_units
    WHERE COALESCE(trim(trading_name), '') = '' AND COALESCE(trim(tenant_name), '') <> ''
      AND lower(trim(coalesce(status, ''))) <> 'archived'
      AND property_id NOT IN (SELECT property_id FROM property_review_items WHERE source = 'Find trading names' AND created_at > NOW() - INTERVAL '6 days')
    GROUP BY property_id ORDER BY n DESC LIMIT $1`, [limit])).rows;
  let filled = 0, review = 0;
  for (const p of props) {
    try { const r = await findTradingNames(p.property_id); filled += r.filled; review += r.review; }
    catch (e: any) { console.warn("[trading-names] property failed:", e?.message); }
  }
  return { properties: props.length, filled, review };
}

const router = Router();
router.post("/api/properties/:id/find-trading-names", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req as any)) return res.status(403).json({ error: "Available in the staff view." });
    const { startJob } = await import("./brand-jobs");
    const { alreadyRunning } = startJob(`trading-names:${req.params.id}`, () => findTradingNames(String(req.params.id)));
    res.status(202).json({ accepted: true, alreadyRunning });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
});
router.get("/api/properties/:id/find-trading-names", requireAuth, async (req: Request, res: Response) => {
  const { resolveCompanyScope } = await import("./company-scope");
  if (await resolveCompanyScope(req as any)) return res.status(403).json({ error: "Available in the staff view." });
  const { getJobStatus } = await import("./brand-jobs");
  res.json(getJobStatus(`trading-names:${req.params.id}`) || { state: "idle" });
});
export default router;
