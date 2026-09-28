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
import { assetClassesIn, assetIsCentralLondon, assetIsLondon, assetProfile, criteriaFit, useDetailsIn } from "@shared/investment-fit";

async function rows(q: Querier, sql: string, params: any[]): Promise<any[]> {
  try { return (await q.query(sql, params)).rows; }
  catch (e: any) { console.warn("[investment-buyers]", e?.message); return []; }
}

export const buyerNameKey = (v: any) => String(v || "").toLowerCase()
  .replace(/\b(plc|ltd|limited|llp|lp|inc|group|holdings|investments?|asset management|am|real estate|properties|property|partners|capital|uk)\b/g, "")
  .replace(/[^a-z0-9]/g, "");

// A comp's class comes from its recorded type (RCA: Retail / Office /
// Hotel …) — the name only when the type is blank ("Holiday Inn —
// Kensington High Street" is a hotel, not high-street retail).
const compClasses = (c: { transaction_type?: string | null; subtype?: string | null; property_name?: string | null }) => {
  const fromType = assetClassesIn(`${c.transaction_type || ""} ${c.subtype || ""}`);
  return fromType.length ? fromType : assetClassesIn(c.property_name || "");
};

const fmtM = (v: number) => v >= 1e9 ? `£${(v / 1e9).toFixed(1)}bn` : `£${Math.round(v / 1e6)}m`;

export async function getBuyersForAsset(trackerId: string, deps: { pool?: Querier } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const [asset] = await rows(q, `SELECT t.id, t.asset_name, t.asset_type, t.guide_price, t.address, t.board_type, t.client_id, t.client, t.vendor_id, t.vendor,
      t.notes, t.wault_break, t.wault_expiry, t.occupancy, t.capex_required,
      p.name AS property_name, p.address::text AS property_address, p.asset_class
    FROM investment_tracker t LEFT JOIN crm_properties p ON p.id = t.property_id WHERE t.id = $1`, [trackerId]);
  if (!asset) throw new Error("asset not found");
  const address = [asset.address, asset.property_address].filter(Boolean).join(" ");
  // Use first, then approach, then London / national (Woody, 2026-09-27).
  const profile = assetProfile({
    assetType: asset.asset_type, name: asset.asset_name, notes: asset.notes,
    assetClass: Array.isArray(asset.asset_class) ? asset.asset_class.join(" ") : asset.asset_class,
    address, guidePrice: asset.guide_price, waultBreak: asset.wault_break, waultExpiry: asset.wault_expiry,
    occupancy: asset.occupancy, capex: asset.capex_required,
  });
  const { classes, guidePrice, london } = profile;
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
    const fit = criteriaFit(text, profile);
    if (!fit.classHit || fit.score < 4) continue;
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
    const fit = criteriaFit([m.mandate_asset_class, lot, geo, m.acquiring_now_notes].filter(Boolean).join(" "), profile);
    const score = fit.score + (m.acquiring_now ? 2 : 0);
    if (!fit.classHit || score < 4) continue;
    const b = upsert(`id:${m.id}`, { name: m.name, companyId: m.id });
    b.score += score; b.reasons.push(...(m.acquiring_now ? ["buying now"] : []), ...fit.reasons.map(x => `${x} (mandate)`)); b.sources.push("mandate");
  }

  // 3. Past buyers in the comps (last four years).
  const comps = await rows(q, `SELECT buyer, buyer_company_id, transaction_type, subtype, price, city, address, property_name, transaction_date
    FROM investment_comps WHERE buyer IS NOT NULL
      AND (transaction_date IS NULL OR transaction_date !~ '^\\d{4}-\\d{2}-\\d{2}' OR TO_DATE(substr(transaction_date, 1, 10), 'YYYY-MM-DD') >= NOW() - INTERVAL '4 years')`, []);
  const compBuyers = new Map<string, { name: string; companyId: string | null; sameClass: number; sameUse: number; nearPrice: number; sameArea: number; latest: string | null }>();
  for (const c of comps) {
    for (const raw of String(c.buyer).split(/\s*(?:\/|;|&| and )\s*/i).filter(Boolean)) {
      const key = keyFor(c.buyer_company_id, raw);
      const e = compBuyers.get(key) || { name: raw.trim(), companyId: c.buyer_company_id || companyByKey.get(buyerNameKey(raw))?.id || null, sameClass: 0, sameUse: 0, nearPrice: 0, sameArea: 0, latest: null };
      const cText = `${c.transaction_type || ""} ${c.subtype || ""} ${c.property_name || ""}`;
      const cClasses = compClasses(c);
      if (!classes.some(x => cClasses.includes(x))) { compBuyers.set(key, e); continue; }
      e.sameClass++;
      if (profile.uses.some(u => useDetailsIn(`${cText} ${c.subtype === "Centers" ? "shopping centre" : ""}`).includes(u))) e.sameUse++;
      const price = Number(c.price) || 0;
      if (guidePrice && price && price >= guidePrice * 0.33 && price <= guidePrice * 3) e.nearPrice++;
      // London vs national only.
      const cLondon = assetIsLondon(`${c.city || ""} ${c.address || ""}`);
      if (cLondon === london) e.sameArea++;
      const d = c.transaction_date ? new Date(c.transaction_date).toISOString() : null;
      if (d && (!e.latest || d > e.latest)) e.latest = d;
      compBuyers.set(key, e);
    }
  }
  for (const [key, e] of compBuyers) {
    const score = 4 + (e.sameClass >= 3 ? 1 : 0) + (e.sameUse ? 2 : 0) + (e.nearPrice ? 1 : 0) + (e.sameArea ? 1 : 0);
    if (!e.sameClass || score < 5) continue;
    const b = upsert(key, { name: e.name, companyId: e.companyId });
    b.companyId = b.companyId || e.companyId;
    b.score += score;
    b.reasons.push(`bought ${e.sameClass} ${classes[0] || "similar"} deal${e.sameClass === 1 ? "" : "s"}${e.sameUse ? ` incl. ${profile.uses[0]}` : ""}${e.sameArea ? (london ? " in London" : " outside London") : ""}${e.nearPrice && guidePrice ? ` around ${fmtM(guidePrice)}` : ""}`);
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
    asset: { id: asset.id, name: asset.asset_name, classes, uses: profile.uses, approaches: profile.approaches, guidePrice, london, board: asset.board_type },
    buyers: list,
    counts: { requirements: reqs.length, mandates: mandates.length, compBuyers: compBuyers.size },
  };
}

// Investment comps for a property page (Woody, 2026-09-27: investment comps
// sit with the property, apart from the lease advisory comps). Trades on
// this building, then comparable trades — same use first (class, then the
// detail of the use), then the same London / national side, newest first.
export async function getPropertyInvestmentComps(propertyId: string, deps: { pool?: Querier } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const [p] = await rows(q, `SELECT id, name, address::text AS address, postcode, asset_class, tags FROM crm_properties WHERE id = $1`, [propertyId]);
  if (!p) throw new Error("property not found");
  const cols = `id, property_name, address, city, postal_code, transaction_type, subtype, status, price, cap_rate, area_sqft, price_psf,
    buyer, buyer_company_id, seller, seller_company_id, transaction_date, property_id, rca_deal_id, source`;
  const here = await rows(q, `SELECT ${cols} FROM investment_comps
    WHERE property_id = $1 OR (property_id IS NULL AND lower(property_name) = lower($2))
    ORDER BY transaction_date DESC NULLS LAST LIMIT 20`, [propertyId, p.name || ""]);
  const assetClass = Array.isArray(p.asset_class) ? p.asset_class.join(" ") : String(p.asset_class || "");
  const [guide] = await rows(q, `SELECT guide_price FROM investment_tracker WHERE property_id = $1 AND guide_price IS NOT NULL ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [propertyId]);
  const guidePrice = Number(guide?.guide_price) || null;
  // The property's tags carry the detail of the use ("luxury retail, arcade
  // retail, F&B" on the Royal Exchange) that the bare class doesn't. Uses
  // only — a tenant-mix tag like "F&B" doesn't make the building leisure.
  const address = `${p.address || ""} ${p.postcode || ""}`;
  const profile = assetProfile({ assetType: assetClass, name: p.name, address, guidePrice });
  profile.uses = [...new Set([...profile.uses, ...useDetailsIn(Array.isArray(p.tags) ? p.tags.join(", ") : p.tags)])];
  const central = profile.london && assetIsCentralLondon(address);
  let similar: any[] = [];
  if (profile.classes.length) {
    const candidates = await rows(q, `SELECT ${cols} FROM investment_comps
      WHERE (property_id IS NULL OR property_id <> $1)
        AND (transaction_date IS NULL OR transaction_date !~ '^\\d{4}-\\d{2}-\\d{2}' OR TO_DATE(substr(transaction_date, 1, 10), 'YYYY-MM-DD') >= NOW() - INTERVAL '5 years')`, [propertyId]);
    const hereIds = new Set(here.map((c: any) => c.id));
    similar = candidates.filter((c: any) => !hereIds.has(c.id)).map((c: any) => {
      const text = `${c.transaction_type || ""} ${c.subtype || ""} ${c.property_name || ""}`;
      if (!compClasses(c).some(x => profile.classes.includes(x))) return null;
      const compUses = useDetailsIn(`${text} ${c.subtype === "Centers" ? "shopping centre" : ""}`);
      const uses = compUses.filter(u => profile.uses.includes(u));
      // A comp of a different format (a retail park against an arcade)
      // sinks below the same format, rather than tying on "retail".
      const otherFormat = profile.uses.length > 0 && compUses.length > 0 && uses.length === 0;
      const compPlace = `${c.city || ""} ${c.address || ""} ${c.postal_code || ""}`;
      const sameSide = assetIsLondon(compPlace) === profile.london;
      const sameCore = central && assetIsCentralLondon(compPlace);
      const price = Number(c.price) || 0;
      const nearPrice = !!(guidePrice && price && price >= guidePrice / 3 && price <= guidePrice * 3);
      const reasons = [profile.classes[0], ...uses, sameCore ? "central London" : sameSide ? (profile.london ? "London" : "outside London") : null, nearPrice ? `near the £${Math.round(guidePrice! / 1e6)}m guide` : null].filter(Boolean);
      return { ...c, score: 4 + uses.length * 2 + (sameSide ? 1 : 0) + (sameCore ? 2 : 0) + (nearPrice ? 1 : 0) - (otherFormat ? 3 : 0), reasons };
    }).filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score || String(b.transaction_date || "").localeCompare(String(a.transaction_date || "")))
      .slice(0, 12);
  }
  return { property: { id: p.id, name: p.name, classes: profile.classes, uses: profile.uses, london: profile.london }, here, similar };
}

// The property page's view of its investment work (Woody, 2026-09-27: the
// property board should carry the sale): each Sales / Purchases board asset
// on the property with its status, guide, bids, viewings and particulars
// sent, the best-fitting buyers for a sale, and the ownership history that
// completions wrote.
export async function getPropertyInvestment(propertyId: string, deps: { pool?: Querier } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const assets = await rows(q, `SELECT t.id, t.asset_name, t.board_type, t.status, t.guide_price, t.niy, t.client, t.client_id, t.buyer, t.buyer_id,
      t.vendor, t.vendor_id, t.bid_deadline, t.marketing_date, t.deal_id, d.deal_ref,
      (SELECT COUNT(*)::int FROM investment_viewings v WHERE v.tracker_id = t.id) AS viewings,
      (SELECT COUNT(*)::int FROM investment_distributions s WHERE s.tracker_id = t.id) AS sent,
      (SELECT COUNT(*)::int FROM investment_offers o WHERE o.tracker_id = t.id) AS bids,
      (SELECT MAX(o.offer_price) FROM investment_offers o WHERE o.tracker_id = t.id) AS best_bid
    FROM investment_tracker t LEFT JOIN crm_deals d ON d.id = t.deal_id
    WHERE t.property_id = $1 ORDER BY t.updated_at DESC NULLS LAST`, [propertyId]);
  const LIVE = /^(REP|AVA|LIVE|NEG|HOT|SOL|SPEC|OPP|Reporting|Available|Under Offer)$/i;
  for (const a of assets) {
    a.fits = [];
    if (a.board_type === "Sales" && LIVE.test(String(a.status || "REP"))) {
      try {
        const r = await getBuyersForAsset(a.id, { pool: q });
        a.fits = r.buyers.filter((b: any) => !b.sentAt && !b.bid).slice(0, 5).map((b: any) => ({ name: b.name, companyId: b.companyId, reasons: b.reasons.slice(0, 3), sources: b.sources }));
        a.fitsTotal = r.buyers.filter((b: any) => !b.sentAt && !b.bid).length;
      } catch { /* buyers are a nice-to-have on the property page */ }
    }
  }
  const ownership = await rows(q, `SELECT e.occurred_at, e.payload, e.deal_id, d.name AS deal_name, n.name AS to_name, o.name AS from_name
    FROM deal_events e JOIN crm_deals d ON d.id = e.deal_id
    LEFT JOIN crm_companies n ON n.id = e.payload->>'to'
    LEFT JOIN crm_companies o ON o.id = e.payload->'previous'->>'landlordId'
    WHERE e.event_type = 'ownership_transferred' AND e.payload->>'propertyId' = $1
    ORDER BY e.occurred_at DESC`, [propertyId]);
  return {
    assets,
    ownership: ownership.map((o: any) => ({ date: o.occurred_at, dealId: o.deal_id, dealName: o.deal_name, from: o.from_name, fromId: o.payload?.previous?.landlordId || null, to: o.to_name, toId: o.payload?.to || null })),
  };
}

const router = Router();

router.get("/api/properties/:id/investment", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "Available in the staff view." });
    res.json(await getPropertyInvestment(String(req.params.id)));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/api/properties/:id/investment-comps", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req)) return res.status(403).json({ error: "Available in the staff view." });
    res.json(await getPropertyInvestmentComps(String(req.params.id)));
  } catch (e: any) {
    if (e?.message === "property not found") return res.status(404).json({ error: "Property not found" });
    res.status(500).json({ error: e.message });
  }
});

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
