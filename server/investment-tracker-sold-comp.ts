// "Sold - Comp" on the Investment Tracker (Jack, 2026-11-11) — see the
// routes in server/routes.ts for what it means. The comp is one row on
// investment_comps, written by the shared evidence writer
// (investment-sale-evidence.ts) that ChatBGP's comp extraction also uses,
// with the tracker's asset class as its Subtype so the Comps page can be
// filtered by the same classes as the board. The tracker row leaves the
// live board (it shows under the Sold - Comp key) and its backing deal is
// Withdrawn, so it never counts as a BGP transaction, fee or pipeline.
// investment_comp_tracker_links keeps the before-state for "Put back".
//
// Buyer (Jack, 2026-11-12): may be left blank — the comp shows TBC — so
// otherwise valid evidence is never blocked by an undisclosed purchaser.
// Under offer / quoting evidence keeps that status with asking figures.
import { pool } from "./db";
import { updateTrackerAsset } from "./investment-tracker-service";
import { fileSaleEvidence, linkTrackerToComp, unlinkTrackerComp, evidenceStatusOf, type EvidenceStatus } from "./investment-sale-evidence";

const CAPITAL_VALUE_CLASSES = new Set(["Retail - London", "Office London"]);

const toNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[£,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function markTrackerSoldComp(
  trackerId: string,
  body: Record<string, any>,
  actorId: string | null,
  opts: { requireFullPricing?: boolean; batch?: string | null; sourceDocument?: string | null; sourcePage?: string | null; comments?: string | null } = {},
) {
  const { rows: [t] } = await pool.query(`SELECT * FROM investment_tracker WHERE id = $1`, [trackerId]);
  if (!t) return { status: 404, body: { message: "Asset not found" } };

  const evidenceStatus: EvidenceStatus = evidenceStatusOf(body.evidenceStatus) || "sold";
  const buyer = String(body.buyer || "").trim();
  const price = toNumber(body.price);
  const yieldPct = toNumber(body.yieldPct);
  const pricePsf = toNumber(body.pricePsf);
  const assetClass = String(body.assetClass || "").trim();
  // The tracker dialog asks for the full pricing of a sale (Jack,
  // 2026-11-11); the buyer can stay TBC. Migrations and ChatBGP file what
  // the source gives.
  if (opts.requireFullPricing !== false && evidenceStatus === "sold") {
    const missing: string[] = [];
    if (!(price && price > 0)) missing.push("price");
    if (!(yieldPct && yieldPct > 0)) missing.push("yieldPct");
    if (CAPITAL_VALUE_CLASSES.has(assetClass) && !(pricePsf && pricePsf > 0)) missing.push("pricePsf");
    if (missing.length) return { status: 400, body: { message: "Sold - Comp needs the full pricing", missing } };
  }

  const { rows: [prop] } = await pool.query(`SELECT address FROM crm_properties WHERE id = $1`, [t.property_id]);
  const addr = prop?.address && typeof prop.address === "object" ? prop.address : {};
  const result = await fileSaleEvidence({
    trackerId,
    propertyId: t.property_id,
    propertyName: t.asset_name,
    address: t.address || addr.street || addr.line1 || null,
    city: addr.city || addr.town || null,
    postcode: addr.postcode || addr.postalCode || null,
    assetClass: assetClass || null,
    transactionType: null,
    evidenceStatus,
    price,
    yieldPct,
    pricePsf,
    sqft: t.sqft != null ? Number(t.sqft) : null,
    // A blank date stays blank — no day is made up (Jack, 2026-11-12).
    saleDate: body.saleDate || null,
    buyer: buyer || null,
    buyerCompanyId: body.buyerId || null,
    seller: t.vendor || null,
    sellerCompanyId: t.vendor_id || null,
    sellerBroker: t.vendor_agent || null,
    source: "BGP Tracker",
    sourceDocument: opts.sourceDocument || null,
    sourcePage: opts.sourcePage || null,
    comments: opts.comments ?? t.notes ?? null,
  });

  const { rows: [had] } = await pool.query(`SELECT 1 FROM investment_comp_tracker_links WHERE tracker_id = $1`, [trackerId]);
  if (!had) {
    await linkTrackerToComp(pool, {
      trackerId, compId: result.compId, createdComp: result.createdComp, priorStatus: t.status || null,
      priorComp: result.priorComp, batch: opts.batch || null, actorId,
    });
  }
  // The buyer goes on the row; no BGP fee, so the backing deal is Withdrawn
  // and drops off the WIP and every BGP total.
  await updateTrackerAsset(trackerId, { status: "WIT", ...(result.buyer ? { buyer: result.buyer } : {}), ...(body.buyerId ? { buyerId: body.buyerId } : {}) }, { id: actorId })
    .catch((e: any) => console.warn(`[investment-tracker] sold-comp status write failed for ${trackerId}:`, e?.message));
  return { status: 200, body: { compId: result.compId, action: result.action, matchedBy: result.matchedBy, conflicts: result.conflicts, compStatus: result.status, buyer: result.buyer } };
}

export async function undoTrackerSoldComp(trackerId: string, actorId: string | null) {
  const undone = await unlinkTrackerComp(pool, trackerId);
  // Rows sent before the link table existed: the comp is keyed on the tracker.
  if (!undone) await pool.query(`DELETE FROM investment_comps WHERE rca_deal_id = $1`, [`tracker-${trackerId}`]);
  await updateTrackerAsset(trackerId, { status: undone?.priorStatus || "REP" }, { id: actorId }).catch(() => {});
  return { ok: true };
}
