// "Fits buyers" for an investment sale (Woody, 2026-09-27): who should see
// this asset. Three sources, merged per buyer and explained:
//   1. the investment requirements list — criteria read from the notes
//      (shared/investment-fit.ts);
//   2. buying mandates on the company (acquiring now, asset class, lot size,
//      geographies);
//   3. past buyers in the investment comps — who has bought this kind of
//      asset, in this area, at this size.
// The vendor / client is excluded; anyone already sent particulars or who
// has bid is flagged. Staff only.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import type { Querier } from "./account-resolver";
import { assetClassOf, assetClassesIn, assetIsLondon, criteriaFit, type AssetClass } from "@shared/investment-fit";

async function rows(q: Querier, sql: string, params: any[]): Promise<any[]> {
  try { return (await q.query(sql, params)).rows; }
  catch (e: any) { console.warn("[investment-buyers]", e?.message); return []; }
}

export const buyerNameKey = (v: any) => String(v || "").toLowerCase()
  .replace(/\b(plc|ltd|limited|llp|lp|inc|group|holdings|investments?|asset management|am|real estate|properties|property|partners|capital|uk)\b/g, "")
  .replace(/[^a-z0-9]/g, "");

const fmtM = (v: number) => v >= 1e9 ? `£${(v / 1e9).toFixed(1)}bn` : `£${Math.round(v / 1e6)}m`;

export async function getBuyersForAsset(trackerId: string, deps: { pool?: Querier } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const [asset] = await rows(q, `SELECT t.id, t.asset_name, t.asset_type, t.guide_price, t.address, t.board_type, t.client_id, t.client, t.vendor_id, t.vendor,
      p.name AS property_name, p.address::text AS property_address, p.asset_class
    FROM investment_tracker t LEFT JOIN crm_properties p ON p.id = t.property_id WHERE t.id = $1`, [trackerId]);
  if (!asset) throw new Error("asset not found");
  const address = [asset.address, asset.property_address].filter(Boolean).join(" ");
  const classes: AssetClass[] = [...new Set([...assetClassOf(asset.asset_type, asset.asset_name), ...assetClassesIn(String(asset.asset_class || ""))])];
  const guidePrice = Number(asset.guide_price) || null;
  const london = assetIsLondon(address);
  const excludeIds = new Set([asset.client_id, asset.vendor_id].filter(Boolean));
  const excludeNames = new Set([asset.client, asset.vendor].map(buyerNameKey).filter(Boolean));

  const buyers = new Map<string, any>();
  const upsert = (key: string, init: any) => {
    if (!buyers.has(key)) buyers.set(key, { companyId: null, name: init.name, score: 0, reasons: [] as string[], sources: [] as string[], requirementId: null, contactId: null, contactName: null, ...init, });
    return buyers.get(key);
  };
  const companies = await rows(q, `SELECT id, name FROM crm_companies WHERE name IS NOT NULL`, []);
  const companyByKey = new Map<string, any>();
  for (const c of companies) { const k = buyerNameKey(c.name); if (k && !companyByKey.has(k)) companyByKey.set(k, c); }
  const keyFor = (companyId: string | null, name: string) => companyId ? `id:${companyId}` : (companyByKey.get(buyerNameKey(name)) ? `id:${companyByKey.get(buyerNameKey(name)).id}` : `name:${buyerNameKey(name)}`);

  // 1. Requirements list.
  const reqs = await rows(q, `SELECT r.id, r.name, r.company_id, r.comments, r.extract, r.location, r.contact_id, r.principal_contact_id,
      c.name AS company_name, ct.name AS contact_name
    FROM crm_requirements_investment r
    LEFT JOIN crm_companies c ON c.id = r.company_id
    LEFT JOIN crm_contacts ct ON ct.id = COALESCE(r.contact_id, r.principal_contact_id)
    WHERE r.status IS NULL OR r.status = 'Active'`, []);
  for (const r of reqs) {
    const text = [r.comments, r.extract, typeof r.location === "string" ? r.location : ""].filter(Boolean).join(" ");
    const fit = criteriaFit(text, { classes, guidePrice, address });
    if (fit.score < 3) continue;
    const name = r.company_name || r.name;
    const b = upsert(keyFor(r.company_id, name), { name });
    b.companyId = b.companyId || r.company_id || companyByKey.get(buyerNameKey(name))?.id || null;
    b.score += fit.score; b.reasons.push(...fit.reasons.map(x => `${x} (requirement)`)); b.sources.push("requirement");
    b.requirementId = r.id; b.contactId = b.contactId || r.contact_id || r.principal_contact_id || null; b.contactName = b.contactName || r.contact_name || null;
  }

  // 2. Buying mandates.
  const mandates = await rows(q, `SELECT id, name, acquiring_now, acquiring_now_notes, mandate_asset_class, mandate_lot_size_min, mandate_lot_size_max, mandate_geographies
    FROM crm_companies WHERE acquiring_now = true OR mandate_asset_class IS NOT NULL OR mandate_lot_size_min IS NOT NULL OR mandate_lot_size_max IS NOT NULL`, []);
  for (const m of mandates) {
    const geo = Array.isArray(m.mandate_geographies) ? m.mandate_geographies.join(" ") : String(m.mandate_geographies || "");
    const lot = m.mandate_lot_size_min || m.mandate_lot_size_max ? `£${Math.round((Number(m.mandate_lot_size_min) || 0) / 1e6)}m-£${Math.round((Number(m.mandate_lot_size_max) || 0) / 1e6) || ""}m${m.mandate_lot_size_max ? "" : "+"}` : "";
    const fit = criteriaFit([m.mandate_asset_class, lot, geo, m.acquiring_now_notes].filter(Boolean).join(" "), { classes, guidePrice, address });
    const score = fit.score + (m.acquiring_now ? 2 : 0);
    if (score < 3) continue;
    const b = upsert(`id:${m.id}`, { name: m.name, companyId: m.id });
    b.score += score; b.reasons.push(...(m.acquiring_now ? ["buying now"] : []), ...fit.reasons.map(x => `${x} (mandate)`)); b.sources.push("mandate");
  }

  // 3. Past buyers in the comps (last four years).
  const comps = await rows(q, `SELECT buyer, buyer_company_id, transaction_type, subtype, price, city, address, property_name, transaction_date
    FROM investment_comps WHERE buyer IS NOT NULL
      AND (transaction_date IS NULL OR transaction_date !~ '^\\d{4}-\\d{2}-\\d{2}' OR TO_DATE(substr(transaction_date, 1, 10), 'YYYY-MM-DD') >= NOW() - INTERVAL '4 years')`, []);
  const compBuyers = new Map<string, { name: string; companyId: string | null; sameClass: number; nearPrice: number; sameArea: number; latest: string | null }>();
  for (const c of comps) {
    for (const raw of String(c.buyer).split(/\s*(?:\/|;|&| and )\s*/i).filter(Boolean)) {
      const key = keyFor(c.buyer_company_id, raw);
      const e = compBuyers.get(key) || { name: raw.trim(), companyId: c.buyer_company_id || companyByKey.get(buyerNameKey(raw))?.id || null, sameClass: 0, nearPrice: 0, sameArea: 0, latest: null };
      const cClasses = assetClassesIn(`${c.transaction_type || ""} ${c.subtype || ""} ${c.property_name || ""}`);
      if (classes.some(x => cClasses.includes(x))) e.sameClass++;
      const price = Number(c.price) || 0;
      if (guidePrice && price && price >= guidePrice * 0.33 && price <= guidePrice * 3) e.nearPrice++;
      const cAddr = `${c.city || ""} ${c.address || ""}`;
      if ((london && assetIsLondon(cAddr)) || (!london && c.city && address.toLowerCase().includes(String(c.city).toLowerCase()))) e.sameArea++;
      const d = c.transaction_date ? new Date(c.transaction_date).toISOString() : null;
      if (d && (!e.latest || d > e.latest)) e.latest = d;
      compBuyers.set(key, e);
    }
  }
  for (const [key, e] of compBuyers) {
    const score = Math.min(e.sameClass, 2) * 2 + (e.nearPrice ? 1 : 0) + (e.sameArea ? 2 : 0);
    if (score < 3 || !e.sameClass) continue;
    const b = upsert(key, { name: e.name, companyId: e.companyId });
    b.companyId = b.companyId || e.companyId;
    b.score += score;
    b.reasons.push(`bought ${e.sameClass} ${classes[0] || "similar"} deal${e.sameClass === 1 ? "" : "s"}${e.sameArea ? (london ? " in London" : " nearby") : ""}${e.nearPrice && guidePrice ? ` around ${fmtM(guidePrice)}` : ""}`);
    b.sources.push("comps");
  }

  // Exclude the seller; flag who has already been sent it or bid.
  const sent = await rows(q, `SELECT company_id, company_name, contact_id, MAX(sent_date) AS sent_date FROM investment_distributions WHERE tracker_id = $1 GROUP BY company_id, company_name, contact_id`, [trackerId]);
  const bids = await rows(q, `SELECT company_id, company, MAX(offer_price) AS offer_price FROM investment_offers WHERE tracker_id = $1 GROUP BY company_id, company`, [trackerId]);
  const list = [...buyers.values()]
    .filter(b => !(b.companyId && excludeIds.has(b.companyId)) && !excludeNames.has(buyerNameKey(b.name)))
    .map(b => {
      const k = buyerNameKey(b.name);
      const s = sent.find((x: any) => (b.companyId && x.company_id === b.companyId) || buyerNameKey(x.company_name) === k);
      const o = bids.find((x: any) => (b.companyId && x.company_id === b.companyId) || buyerNameKey(x.company) === k);
      return { ...b, sources: [...new Set(b.sources)], reasons: [...new Set(b.reasons)], sentAt: s?.sent_date || null, bid: o ? Number(o.offer_price) || true : null };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 60);

  return {
    asset: { id: asset.id, name: asset.asset_name, classes, guidePrice, london, board: asset.board_type },
    buyers: list,
    counts: { requirements: reqs.length, mandates: mandates.length, compBuyers: compBuyers.size },
  };
}

const router = Router();

router.get("/api/investment-tracker/:id/buyers", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "Available in the staff view." });
    res.json(await getBuyersForAsset(String(req.params.id)));
  } catch (e: any) {
    if (e?.message === "asset not found") return res.status(404).json({ error: "Asset not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
