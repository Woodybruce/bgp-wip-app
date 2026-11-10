// "Sold - Comp" on the Investment Tracker (Jack, 2026-11-11) — see the
// routes in server/routes.ts for what it means. The comp is one row on
// investment_comps tied to the tracker row by rca_deal_id 'tracker-<id>',
// source 'BGP Tracker', with the tracker's asset class as its Subtype so
// the Comps page can be filtered by the same classes as the board.
import { pool } from "./db";
import { updateTrackerAsset } from "./investment-tracker-service";
import { compTypeFor } from "./investment-comp-sync";

const CAPITAL_VALUE_CLASSES = new Set(["Retail - London", "Office London"]);

const toNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[£,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function markTrackerSoldComp(trackerId: string, body: Record<string, any>, actorId: string | null) {
  const { rows: [t] } = await pool.query(`SELECT * FROM investment_tracker WHERE id = $1`, [trackerId]);
  if (!t) return { status: 404, body: { message: "Asset not found" } };

  const buyer = String(body.buyer || "").trim();
  const price = toNumber(body.price);
  const yieldPct = toNumber(body.yieldPct);
  const pricePsf = toNumber(body.pricePsf);
  const assetClass = String(body.assetClass || "").trim();
  const missing: string[] = [];
  if (!buyer) missing.push("buyer");
  if (!(price && price > 0)) missing.push("price");
  if (!(yieldPct && yieldPct > 0)) missing.push("yieldPct");
  if (CAPITAL_VALUE_CLASSES.has(assetClass) && !(pricePsf && pricePsf > 0)) missing.push("pricePsf");
  if (missing.length) return { status: 400, body: { message: "Sold - Comp needs the full pricing", missing } };

  const saleDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.saleDate || "")) ? String(body.saleDate) : new Date().toISOString().slice(0, 10);
  const { rows: [prop] } = await pool.query(`SELECT address FROM crm_properties WHERE id = $1`, [t.property_id]);
  const addr = prop?.address && typeof prop.address === "object" ? prop.address : {};
  const values: Record<string, any> = {
    status: "Sale",
    transaction_type: compTypeFor(assetClass) || compTypeFor(t.asset_type) || null,
    subtype: assetClass || null,
    property_name: t.asset_name,
    property_id: t.property_id,
    address: t.address || addr.street || addr.line1 || null,
    city: addr.city || addr.town || null,
    postal_code: addr.postcode || addr.postalCode || null,
    price,
    price_psf: pricePsf ?? (t.sqft ? Math.round((price! / Number(t.sqft)) * 100) / 100 : null),
    cap_rate: yieldPct! / 100,
    area_sqft: t.sqft != null ? Number(t.sqft) : null,
    transaction_date: saleDate,
    buyer,
    buyer_company_id: body.buyerId || null,
    seller: t.vendor || null,
    seller_company_id: t.vendor_id || null,
    seller_broker: t.vendor_agent || null,
    comments: t.notes || null,
  };
  const cols = Object.keys(values);
  const key = `tracker-${trackerId}`;
  const { rows: [existing] } = await pool.query(`SELECT id FROM investment_comps WHERE rca_deal_id = $1 LIMIT 1`, [key]);
  let compId: string;
  if (existing) {
    await pool.query(
      `UPDATE investment_comps SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, source = 'BGP Tracker' WHERE id = $1`,
      [existing.id, ...cols.map((c) => values[c])],
    );
    compId = existing.id;
  } else {
    const { rows: [ins] } = await pool.query(
      `INSERT INTO investment_comps (id, rca_deal_id, source, ${cols.join(", ")})
       VALUES (gen_random_uuid(), $1, 'BGP Tracker', ${cols.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
      [key, ...cols.map((c) => values[c])],
    );
    compId = ins.id;
  }
  // The buyer goes on the row; no BGP fee, so the backing deal is Withdrawn
  // and drops off the WIP.
  await updateTrackerAsset(trackerId, { status: "WIT", buyer, ...(body.buyerId ? { buyerId: body.buyerId } : {}) }, { id: actorId })
    .catch((e: any) => console.warn(`[investment-tracker] sold-comp status write failed for ${trackerId}:`, e?.message));
  return { status: 200, body: { compId } };
}

export async function undoTrackerSoldComp(trackerId: string, actorId: string | null) {
  const key = `tracker-${trackerId}`;
  await pool.query(`DELETE FROM investment_comps WHERE rca_deal_id = $1`, [key]);
  await updateTrackerAsset(trackerId, { status: "REP" }, { id: actorId }).catch(() => {});
  return { ok: true };
}
