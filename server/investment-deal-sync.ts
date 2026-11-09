// The investment deal and its tracker row are one record (Woody, 2026-09-27:
// "deal page should all flow back and link — can't have 2 sources of
// truth"). The tracker PATCH already writes through to the deal; this is the
// other direction — an edit on the deal page, the deals board or ChatBGP
// lands on the Sales / Purchases board row. Also here: what completion does
// to the property (the buyer becomes the owner) and the AML kick-off when
// a sale reaches HOTs / Solicitors.
import type { Querier } from "./account-resolver";
import { legacyToCode } from "@shared/deal-status";

const SALE_TYPES = new Set(["sale", "investment sale", "disposal"]);
const PURCHASE_TYPES = new Set(["purchase", "investment acquisition", "acquisition"]);
export function boardForDealType(dealType: string | null | undefined): "Sales" | "Purchases" | null {
  const t = String(dealType || "").trim().toLowerCase();
  if (SALE_TYPES.has(t)) return "Sales";
  if (PURCHASE_TYPES.has(t)) return "Purchases";
  return null;
}

const num = (v: any) => (v == null || v === "" ? null : Number(v));
const same = (a: any, b: any) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
const isoDay = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Deal → tracker. `keys` are the deal fields that were just written (the PUT
// body); only those flow, so a deal that never carried a price can't blank
// the board's guide price. Status always flows.
export async function syncTrackerFromDeal(dealId: string, keys: Iterable<string>, deps: { pool?: Querier } = {}): Promise<number> {
  const q = deps.pool ?? (await import("./db")).pool;
  const k = new Set(keys);
  const { rows: trackers } = await q.query(`SELECT * FROM investment_tracker WHERE deal_id = $1`, [dealId]);
  if (!trackers.length) return 0;
  const { rows: [d] } = await q.query(`SELECT d.id, d.status, d.deal_type, d.fee, d.pricing, d.yield_percent, d.total_area_sqft, d.property_id,
      d.completed_at, d.vendor_id, d.purchaser_id, d.vendor_agent_id, d.vendor_agent_contact_id, d.internal_agent,
      v.name AS vendor_name, pu.name AS purchaser_name, vaf.name AS vendor_agent_firm, vac.name AS vendor_agent_name
    FROM crm_deals d
    LEFT JOIN crm_companies v ON v.id = d.vendor_id
    LEFT JOIN crm_companies pu ON pu.id = d.purchaser_id
    LEFT JOIN crm_companies vaf ON vaf.id = d.vendor_agent_id
    LEFT JOIN crm_contacts vac ON vac.id = d.vendor_agent_contact_id
    WHERE d.id = $1`, [dealId]);
  if (!d) return 0;

  let agentIds: string[] | null = null;
  if (k.has("internalAgent")) {
    const names: string[] = Array.isArray(d.internal_agent) ? d.internal_agent.filter(Boolean) : [];
    const { rows } = names.length ? await q.query(`SELECT id, name FROM users WHERE name = ANY($1::text[])`, [names]) : { rows: [] as any[] };
    agentIds = rows.map((r: any) => String(r.id));
  }

  let written = 0;
  for (const t of trackers) {
    const set: Record<string, any> = {};
    const put = (col: string, val: any) => { if (!same(t[col], val)) set[col] = val; };
    const code = legacyToCode(d.status);
    if (code && code !== legacyToCode(t.status)) set.status = code;
    const board = (k.has("dealType") && boardForDealType(d.deal_type)) || t.board_type || "Purchases";
    if (board !== t.board_type) set.board_type = board;
    if (k.has("fee")) put("fee", num(d.fee));
    if (k.has("pricing")) put("guide_price", num(d.pricing));
    if (k.has("yieldPercent")) put("niy", num(d.yield_percent));
    if (k.has("totalAreaSqft")) put("sqft", num(d.total_area_sqft));
    if (k.has("propertyId") && d.property_id) put("property_id", d.property_id);
    if (k.has("completedAt")) put("completion_date", isoDay(d.completed_at));
    if (agentIds) put("agent_user_ids", agentIds);
    // Parties — the client is the side BGP acts for (vendor on a sale,
    // purchaser on a purchase); the other side is the buyer / vendor.
    const party = (idCol: string, nameCol: string, id: string | null, name: string | null) => {
      put(idCol, id || null);
      if (id) put(nameCol, name);
      else if (t[idCol]) set[nameCol] = null;   // a cleared link clears its label
    };
    if (board === "Sales") {
      if (k.has("vendorId") || set.board_type) party("client_id", "client", d.vendor_id, d.vendor_name);
      if (k.has("purchaserId") || set.board_type) party("buyer_id", "buyer", d.purchaser_id, d.purchaser_name);
    } else {
      if (k.has("purchaserId") || set.board_type) party("client_id", "client", d.purchaser_id, d.purchaser_name);
      if (k.has("vendorId") || set.board_type) party("vendor_id", "vendor", d.vendor_id, d.vendor_name);
    }
    if (k.has("vendorAgentContactId") || k.has("vendorAgentId")) {
      put("vendor_agent_id", d.vendor_agent_contact_id || null);
      put("vendor_agent", d.vendor_agent_name || d.vendor_agent_firm || null);
    }
    const cols = Object.keys(set);
    if (!cols.length) continue;
    await q.query(`UPDATE investment_tracker SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE id = $1`,
      [t.id, ...cols.map(c => set[c])]);
    written++;
  }
  return written;
}

// Completion hands the building to the buyer: the property's owner
// (landlord_id, and the freeholder / long leaseholder on the tenure sold)
// becomes the purchaser, the vendor's owner link on the account drops off,
// and the purchaser gets a confirmed owner link. Once per deal; the previous
// owners are kept on the deal's event log.
export async function transferOwnershipOnCompletion(dealId: string, deps: { pool?: Querier; actorId?: string | null; actorName?: string | null } = {}): Promise<boolean> {
  const q = deps.pool ?? (await import("./db")).pool;
  const { rows: [d] } = await q.query(`SELECT d.id, d.status, d.deal_type, d.property_id, d.vendor_id, d.purchaser_id, d.completed_at,
      p.landlord_id, p.freeholder_id, p.long_leaseholder_id, p.status AS property_status, t.tenure
    FROM crm_deals d JOIN crm_properties p ON p.id = d.property_id
    LEFT JOIN investment_tracker t ON t.deal_id = d.id
    WHERE d.id = $1`, [dealId]);
  if (!d || !d.purchaser_id || !boardForDealType(d.deal_type)) return false;
  if (!["COM", "INV"].includes(legacyToCode(d.status) || "")) return false;
  const already = await q.query(`SELECT 1 FROM deal_events WHERE deal_id = $1 AND event_type = 'ownership_transferred' LIMIT 1`, [dealId]);
  if (already.rows.length) return false;
  if (d.landlord_id === d.purchaser_id) return false;

  const previous = { landlordId: d.landlord_id, freeholderId: d.freeholder_id, longLeaseholderId: d.long_leaseholder_id, propertyStatus: d.property_status };
  const sellers = new Set([d.vendor_id, d.landlord_id].filter(Boolean));
  const tenure = String(d.tenure || "").toLowerCase();
  const freeholder = tenure.includes("free") || (d.freeholder_id && sellers.has(d.freeholder_id)) ? d.purchaser_id : d.freeholder_id;
  const longLeaseholder = tenure.includes("lease") || (d.long_leaseholder_id && sellers.has(d.long_leaseholder_id)) ? d.purchaser_id : d.long_leaseholder_id;
  await q.query(`UPDATE crm_properties SET landlord_id = $2, freeholder_id = $3, long_leaseholder_id = $4,
      status = CASE WHEN status = 'Sales Instruction' THEN NULL ELSE status END, updated_at = NOW()
    WHERE id = $1`, [d.property_id, d.purchaser_id, freeholder, longLeaseholder]);
  const removed = sellers.size ? (await q.query(`DELETE FROM crm_company_properties
      WHERE property_id = $1 AND company_id = ANY($2::text[]) AND COALESCE(relationship_role, 'owner') IN ('owner', 'unknown')
      RETURNING company_id, relationship_role`, [d.property_id, [...sellers]])).rows : [];
  const link = await q.query(`UPDATE crm_company_properties SET relationship_role = 'owner', relationship_confidence = 'confirmed', relationship_source = 'bgp-deal'
      WHERE company_id = $1 AND property_id = $2`, [d.purchaser_id, d.property_id]);
  if (!link.rowCount) {
    await q.query(`INSERT INTO crm_company_properties (id, company_id, property_id, relationship_role, relationship_confidence, relationship_source, valid_from)
        VALUES (gen_random_uuid(), $1, $2, 'owner', 'confirmed', 'bgp-deal', $3)`, [d.purchaser_id, d.property_id, d.completed_at || new Date()]);
  }
  await q.query(`INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name) VALUES ($1, 'ownership_transferred', $2, $3, $4)`,
    [dealId, JSON.stringify({ propertyId: d.property_id, to: d.purchaser_id, previous, removedLinks: removed }), deps.actorId || null, deps.actorName || null]);
  console.log(`[investment-deal] deal ${dealId}: property ${d.property_id} now owned by ${d.purchaser_id}`);
  return true;
}

// Exchange / completion side effects, from any board: the one linked comp,
// then (on completion) the change of owner.
export async function completeInvestmentDeal(dealId: string, deps: { pool?: Querier; actorId?: string | null; actorName?: string | null } = {}) {
  const { promoteDealToInvestmentComp } = await import("./investment-comp-sync");
  const comp = await promoteDealToInvestmentComp(dealId, { pool: deps.pool }).catch((e: any) => { console.warn("[investment-deal] comp promotion failed:", e?.message); return null; });
  const transferred = await transferOwnershipOnCompletion(dealId, deps).catch((e: any) => { console.warn("[investment-deal] ownership transfer failed:", e?.message); return false; });
  return { comp, transferred };
}

// A deal reaching HOTs or Solicitors starts the AML sweep on its
// counterparties (Woody, 2026-09-27: "tracker status is fine but should
// start the AML process if it can"). Never blocks the move; runs once per
// deal per 90 days so re-saving a status doesn't re-run paid checks.
const AML_START = new Set(["HOT", "SOL"]);
export async function startAmlOnStatus(dealId: string, fromStatus: string | null | undefined, toStatus: string | null | undefined,
  actor: { id?: string | null; name?: string | null } = {}, deps: { pool?: Querier; launch?: (dealId: string, actorId: string | null, actorName: string | null) => Promise<void> } = {}) {
  // Retired 2026-10-05 — KYC4U is BGP's MLRO; the app starts no AML of its own.
  if (!process.env.IN_APP_AML_ENABLED) return { started: false, reason: "AML/KYC is raised with KYC4U from the deal's AML panel" };
  const to = legacyToCode(toStatus);
  if (!to || !AML_START.has(to) || legacyToCode(fromStatus) === to) return { started: false, reason: "not a HOTs / Solicitors move" };
  const q = deps.pool ?? (await import("./db")).pool;
  const { rows: [d] } = await q.query(`SELECT tenant_id, landlord_id, vendor_id, purchaser_id, aml_check_completed FROM crm_deals WHERE id = $1`, [dealId]);
  if (!d) return { started: false, reason: "deal not found" };
  if (d.aml_check_completed === "YES") return { started: false, reason: "AML already signed off" };
  if (![d.tenant_id, d.landlord_id, d.vendor_id, d.purchaser_id].some(Boolean)) return { started: false, reason: "no counterparty linked yet" };
  const recent = await q.query(`SELECT 1 FROM deal_events WHERE deal_id = $1 AND event_type IN ('kyc_orchestrator_run', 'kyc_auto_started')
      AND occurred_at > NOW() - INTERVAL '90 days' LIMIT 1`, [dealId]);
  if (recent.rows.length) return { started: false, reason: "AML already running for this deal" };
  await q.query(`INSERT INTO deal_events (deal_id, event_type, payload, actor_id, actor_name) VALUES ($1, 'kyc_auto_started', $2, $3, $4)`,
    [dealId, JSON.stringify({ status: to }), actor.id || null, actor.name || null]).catch(() => {});
  const launch = deps.launch ?? (await import("./deal-stages")).autoLaunchAmlForDeal;
  launch(dealId, actor.id || null, actor.name || null).catch((e: any) => console.warn(`[investment-deal] AML launch failed for ${dealId}:`, e?.message));
  return { started: true, reason: null };
}
