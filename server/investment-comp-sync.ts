// Investment deal → investment comp, in one place (Woody, 2026-09-27:
// "review the investment comps board and the investment deals tracker to
// make sure that all links up"). A BGP investment deal that exchanges or
// completes becomes exactly ONE comp, linked to the buyer, seller and
// property, with both sides' agents as brokers — called from the deal page,
// the deals board and the Investment tracker alike. Re-running updates the
// same comp (dedupe on rca_deal_id 'bgp-<deal id>', also adopting an older
// comp keyed on the bare deal id).
import type { Querier } from "./account-resolver";
import { legacyToCode } from "@shared/deal-status";

const TYPE_FOR_CLASS: Array<[RegExp, string]> = [
  [/retail|shop|high street|shopping/i, "Retail"],
  [/office/i, "Office"],
  [/industrial|logistic|warehouse|distribution/i, "Industrial"],
  [/hotel|hospitality/i, "Hotel"],
  [/residential|btr|living|student/i, "Residential"],
  [/mixed/i, "Mixed"],
  [/leisure/i, "Leisure"],
];
export function compTypeFor(assetClass: string | null | undefined): string | null {
  const v = String(assetClass || "");
  return TYPE_FOR_CLASS.find(([re]) => re.test(v))?.[1] ?? null;
}

const isoDate = (d: any) => (d ? new Date(d) : new Date()).toISOString().slice(0, 10);

export async function promoteDealToInvestmentComp(dealId: string, deps: { pool?: Querier } = {}): Promise<string | null> {
  const q = deps.pool ?? (await import("./db")).pool;
  const { rows: [d] } = await q.query(`SELECT d.*, p.name AS property_name, p.address AS property_address, p.asset_class AS property_asset_class,
      v.name AS vendor_name, pu.name AS purchaser_name, va.name AS vendor_agent_name, pa.name AS purchaser_agent_name,
      t.asset_type AS tracker_asset_type, t.guide_price AS tracker_guide_price, t.niy AS tracker_niy, t.sqft AS tracker_sqft,
      t.buyer AS tracker_buyer, t.buyer_id AS tracker_buyer_id
    FROM crm_deals d
    LEFT JOIN crm_properties p ON p.id = d.property_id
    LEFT JOIN crm_companies v ON v.id = d.vendor_id
    LEFT JOIN crm_companies pu ON pu.id = d.purchaser_id
    LEFT JOIN crm_companies va ON va.id = d.vendor_agent_id
    LEFT JOIN crm_companies pa ON pa.id = d.purchaser_agent_id
    LEFT JOIN investment_tracker t ON t.deal_id = d.id
    WHERE d.id = $1`, [dealId]);
  if (!d) return null;
  const code = legacyToCode(d.status) || "";
  const completed = ["COM", "INV"].includes(code);
  if (!completed && code !== "EXC") return null;

  const addr = d.property_address && typeof d.property_address === "object" ? d.property_address : {};
  const assetClass = Array.isArray(d.property_asset_class) ? d.property_asset_class.join(" ") : String(d.property_asset_class || "");
  const yieldPct = d.yield_percent != null ? Number(d.yield_percent) : (d.tracker_niy != null ? Number(d.tracker_niy) : null);
  const values = {
    status: completed ? "Sale" : "Sale - Pending",
    transaction_type: compTypeFor(d.tracker_asset_type) || compTypeFor(assetClass) || null,
    subtype: d.deal_type || null,
    property_name: d.property_name || d.name,
    property_id: d.property_id || null,
    address: addr.street || addr.line1 || addr.address || null,
    city: addr.city || addr.town || null,
    postal_code: addr.postcode || addr.postalCode || null,
    price: d.pricing != null ? Number(d.pricing) : (d.tracker_guide_price != null ? Number(d.tracker_guide_price) : null),
    price_psf: d.price_psf != null ? Number(d.price_psf) : null,
    cap_rate: yieldPct != null && !isNaN(yieldPct) ? yieldPct / 100 : null,
    area_sqft: d.total_area_sqft != null ? Number(d.total_area_sqft) : (d.tracker_sqft != null ? Number(d.tracker_sqft) : null),
    transaction_date: isoDate(completed ? (d.completed_at || d.exchanged_at) : d.exchanged_at),
    buyer: d.purchaser_name || d.tracker_buyer || null,
    buyer_company_id: d.purchaser_id || d.tracker_buyer_id || null,
    seller: d.vendor_name || null,
    seller_company_id: d.vendor_id || null,
    buyer_broker: d.purchaser_agent_name || null,
    seller_broker: d.vendor_agent_name || null,
    comments: d.comments || null,
  };
  const { rows: existing } = await q.query(`SELECT id FROM investment_comps WHERE rca_deal_id = ANY($1::text[]) ORDER BY (rca_deal_id = $2) DESC LIMIT 1`, [[`bgp-${dealId}`, dealId], `bgp-${dealId}`]);
  const cols = Object.keys(values);
  const vals = cols.map(k => (values as any)[k]);
  if (existing[0]) {
    // Fill / refresh from the deal, keeping anything typed on the comp that
    // the deal doesn't know.
    await q.query(`UPDATE investment_comps SET ${cols.map((k, i) => `${k} = COALESCE($${i + 2}, ${k})`).join(", ")}, rca_deal_id = $${cols.length + 2}, source = 'BGP'
      WHERE id = $1`, [existing[0].id, ...vals, `bgp-${dealId}`]);
    await q.query(`DELETE FROM investment_comps WHERE rca_deal_id = ANY($1::text[]) AND id <> $2`, [[`bgp-${dealId}`, dealId], existing[0].id]);
    return existing[0].id;
  }
  const { rows: [ins] } = await q.query(`INSERT INTO investment_comps (id, rca_deal_id, source, ${cols.join(", ")})
    VALUES (gen_random_uuid(), $1, 'BGP', ${cols.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`, [`bgp-${dealId}`, ...vals]);
  console.log(`[investment-comps] deal ${dealId} → comp ${ins?.id}`);
  return ins?.id || null;
}

// One-offs, once per database (flags in system_settings):
//  • tracker deals without the Investment team get it — without it a
//    completed sale was filed as a leasing deal ("Leasing - Invoiced");
//  • comps' buyer / seller are linked to CRM companies when the name matches
//    exactly one company (after dropping Ltd / PLC / Group …);
//  • BGP deals already exchanged / completed get their comp (re)built, which
//    also folds the duplicate the old bare-id path made.
export async function runInvestmentLinkBackfills(deps: { pool?: Querier } = {}) {
  const q = deps.pool ?? (await import("./db")).pool;
  const done = async (key: string) => (await q.query(`SELECT 1 FROM system_settings WHERE key = $1`, [key])).rows.length > 0;
  const mark = (key: string, value: any) => q.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [key, JSON.stringify(value)]);

  const TEAM = "migration:tracker_deals_investment_team_v1";
  if (!(await done(TEAM))) {
    const r = await q.query(`UPDATE crm_deals SET team = array_append(COALESCE(team, ARRAY[]::text[]), 'Investment')
      WHERE id IN (SELECT deal_id FROM investment_tracker WHERE deal_id IS NOT NULL)
        AND NOT ('Investment' = ANY(COALESCE(team, ARRAY[]::text[])))`);
    await mark(TEAM, { updated: r.rowCount || 0, at: new Date().toISOString() });
    console.log(`[investment-links] ${r.rowCount || 0} tracker deals given the Investment team`);
  }

  const LINK = "migration:investment_comps_company_links_v1";
  if (!(await done(LINK))) {
    const { buyerNameKey } = await import("./investment-buyers");
    const { rows: companies } = await q.query(`SELECT id, name FROM crm_companies WHERE name IS NOT NULL AND merged_into_id IS NULL`);
    const byKey = new Map<string, string[]>();
    for (const c of companies) { const k = buyerNameKey(c.name); if (k.length >= 3) byKey.set(k, [...(byKey.get(k) || []), c.id]); }
    const unique = (name: any) => { const ids = byKey.get(buyerNameKey(name)); return ids && ids.length === 1 ? ids[0] : null; };
    const { rows: comps } = await q.query(`SELECT id, buyer, seller FROM investment_comps WHERE (buyer IS NOT NULL AND buyer_company_id IS NULL) OR (seller IS NOT NULL AND seller_company_id IS NULL)`);
    let linked = 0;
    for (const c of comps) {
      const b = unique(c.buyer), s = unique(c.seller);
      if (!b && !s) continue;
      await q.query(`UPDATE investment_comps SET buyer_company_id = COALESCE(buyer_company_id, $2), seller_company_id = COALESCE(seller_company_id, $3) WHERE id = $1`, [c.id, b, s]);
      linked++;
    }
    await mark(LINK, { comps: comps.length, linked, at: new Date().toISOString() });
    console.log(`[investment-links] linked buyer/seller companies on ${linked} of ${comps.length} comps`);
  }

  const COMPS = "migration:bgp_investment_deal_comps_v1";
  if (!(await done(COMPS))) {
    const { rows: all } = await q.query(`SELECT id, status FROM crm_deals
      WHERE 'Investment' = ANY(COALESCE(team, ARRAY[]::text[])) OR deal_type IN ('Sale','Purchase','Investment Sale','Investment Acquisition')`);
    const rows = all.filter((r: any) => ["EXC", "COM", "INV"].includes(legacyToCode(r.status) || ""));
    let n = 0;
    for (const r of rows) { if (await promoteDealToInvestmentComp(r.id, { pool: q }).catch(() => null)) n++; }
    await mark(COMPS, { deals: rows.length, comps: n, at: new Date().toISOString() });
    console.log(`[investment-links] built comps for ${n} of ${rows.length} exchanged / completed investment deals`);
  }
}
