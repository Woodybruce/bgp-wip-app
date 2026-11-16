// Investment Comps clean-up (Jack, 2026-11-16). Admin Preview → Apply → Undo,
// never at boot. His answers, one step each:
//   - Lettings ("take them off"): leasing deals filed as investment comps
//     (status COM, a tenant or lease acquisition) are deleted.
//   - Refinancings ("we can delete"): status Refinance, deleted.
//   - Live deals ("should be moved back to the tracker"): pending, under
//     offer, quoting, on the market, unconfirmed. A comp a tracker row was
//     moved to by Sold - Comp puts that row back at its earlier status; a
//     comp whose building is already on the tracker fills that row's blanks;
//     any other becomes a new Purchases-board row (U/O - Not BGP when it is
//     under offer or pending, Available when quoting or on the market).
//   - Duplicates ("take the most recent input for information and then
//     merge"): the same building and the same deal (price within 3%, or
//     both dated within 30 days). The newest record is kept, its blanks
//     filled from the older ones, links repointed, the older ones deleted.
//   - Classes ("Subtype to match retail London, office London ... like the
//     tracker"): Subtype is set to the comp's tracker class
//     (compTrackerClass, shared/tracker-class.ts).
// Terminated, withdrawn and blank-status comps are left for Jack and listed.
// Every row touched is logged in investment_comp_migration_log (batch
// comp-cleanup-<time>) with what it held before, so Undo puts it back.
import { pool } from "./db";
import { sameBuilding } from "./investment-sale-evidence";
import { compTrackerClass } from "@shared/tracker-class";

type Row = Record<string, any>;

const isLetting = (c: Row) => /^com$/i.test(String(c.status || "").trim())
  || /tenant acquisition|lease acquisition|letting/i.test(`${c.transaction_type || ""} ${c.subtype || ""}`);
const isRefinance = (c: Row) => /^refinanc/i.test(String(c.status || "").trim());
const isLive = (c: Row) => /pending|under offer|quoting|on market|unconfirmed/i.test(String(c.status || ""));
const leftForJack = (c: Row) => !c.status || /terminated|withdrawn/i.test(String(c.status));

const liveTrackerStatus = (status: string) => /quoting|on market/i.test(status) ? "AVA" : /unconfirmed/i.test(status) ? "REP" : "UOX";

const FILLABLE = ["rca_property_id", "transaction_type", "market", "transaction_date", "address", "city", "region", "country",
  "postal_code", "units", "area_sqft", "year_built", "year_renov", "num_buildings", "num_floors", "land_area_acres", "occupancy",
  "price", "currency", "price_per_unit", "price_psf", "price_qualifier", "partial_interest", "cap_rate", "cap_rate_qualifier",
  "buyer", "buyer_broker", "seller", "seller_broker", "lender", "comments", "latitude", "longitude", "submarket", "property_id",
  "buyer_company_id", "seller_company_id", "features"];
const blank = (v: unknown) => v == null || String(v).trim() === "";

const camel = (c: Row) => ({
  subtype: c.subtype, transactionType: c.transaction_type, propertyName: c.property_name, address: c.address,
  city: c.city, market: c.market, postalCode: c.postal_code, comments: c.comments,
});
const label = (c: Row) => ({ id: c.id, property: c.property_name, city: c.city || null, status: c.status || null, price: c.price ?? null, date: c.transaction_date || null, source: String(c.source || "").slice(0, 60) });

const days = (a: unknown, b: unknown) => {
  const x = Date.parse(String(a)), y = Date.parse(String(b));
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86_400_000 : null;
};
const normName = (v: unknown) => String(v || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
function sameDeal(a: Row, b: Row): boolean {
  const identical = normName(a.property_name) !== "" && normName(a.property_name) === normName(b.property_name);
  // Two RCA records are two RCA deals unless they carry the same name (RCA
  // files a portfolio and its buildings as separate deals), and a portfolio
  // is matched only on its exact name: "GBR Retail Portfolio 2025" shares
  // its words with every other portfolio that year.
  const bothRca = a.source === "RCA" && b.source === "RCA";
  const portfolio = /portfolio|acquires/i.test(`${a.property_name} ${b.property_name}`);
  if ((bothRca || portfolio) && !identical) return false;
  if (!identical && !sameBuilding([a.property_name, a.address], [b.property_name, b.address])) return false;
  const pa = Number(a.price), pb = Number(b.price);
  if (pa > 0 && pb > 0) {
    if (Math.abs(pa - pb) / Math.max(pa, pb) > 0.03) return false;
    const d = days(a.transaction_date, b.transaction_date);
    return d == null || d <= 365;
  }
  const d = days(a.transaction_date, b.transaction_date);
  return d != null && d <= 30;
}

async function log(batch: string, table: string, id: string, action: string, prior: any, trackerId?: string | null, note?: string | null) {
  await pool.query(
    `INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, tracker_id, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [batch, table, id, action, prior == null ? null : JSON.stringify(prior), trackerId || null, note || null],
  );
}

export async function runCompCleanup(opts: { apply: boolean; actorId?: string | null }) {
  const batch = `comp-cleanup-${Date.now()}`;
  const { rows: comps } = await pool.query(`SELECT * FROM investment_comps ORDER BY created_at DESC NULLS LAST`);
  const { rows: trackers } = await pool.query(
    `SELECT t.id, t.asset_name, t.address, t.status, t.deal_id, t.guide_price, t.niy, t.sqft, t.vendor, t.vendor_agent, t.notes
       FROM investment_tracker t`);
  const { rows: links } = await pool.query(`SELECT * FROM investment_comp_tracker_links`);
  const linkByComp = new Map<string, Row>(links.map((l: Row) => [l.comp_id, l]));
  const soldTrackerIds = new Set<string>([
    ...links.map((l: Row) => l.tracker_id),
    ...comps.filter((c: Row) => String(c.rca_deal_id || "").startsWith("tracker-")).map((c: Row) => String(c.rca_deal_id).slice(8)),
  ]);

  const lettings = comps.filter(isLetting);
  const refis = comps.filter((c: Row) => !isLetting(c) && isRefinance(c));
  const live = comps.filter((c: Row) => !isLetting(c) && !isRefinance(c) && isLive(c));
  const gone = new Set([...lettings, ...refis, ...live].map((c: Row) => c.id));
  const rest = comps.filter((c: Row) => !gone.has(c.id));

  // Live deals: where each goes.
  const livePlan = live.map((c: Row) => {
    const linked = linkByComp.get(c.id);
    const markerTracker = String(c.rca_deal_id || "").startsWith("tracker-") ? String(c.rca_deal_id).slice(8) : null;
    const restoreId = linked?.tracker_id || markerTracker;
    if (restoreId) return { comp: c, kind: "restore" as const, trackerId: restoreId, status: linked?.prior_status || liveTrackerStatus(c.status) };
    const match = trackers.find((t: Row) => !soldTrackerIds.has(t.id) && sameBuilding([c.property_name, c.address], [t.asset_name, t.address]));
    if (match) return { comp: c, kind: "fill" as const, trackerId: match.id, trackerName: match.asset_name, status: null };
    return { comp: c, kind: "new" as const, trackerId: null, status: liveTrackerStatus(c.status) };
  });

  // Duplicates among what stays: groups, newest first.
  const parent = new Map<string, string>(rest.map((c: Row) => [c.id, c.id]));
  const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    if (sameDeal(rest[i], rest[j])) parent.set(find(rest[j].id), find(rest[i].id));
  }
  const groups = new Map<string, Row[]>();
  for (const c of rest) { const r = find(c.id); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(c); }
  const dupes = [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const sorted = [...g].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const keeper = { ...sorted[0] };
    const filled: string[] = [];
    for (const older of sorted.slice(1)) for (const col of FILLABLE) {
      if (blank(keeper[col]) && !blank(older[col])) { keeper[col] = older[col]; if (!filled.includes(col)) filled.push(col); }
    }
    return { keeper: sorted[0], merged: keeper, others: sorted.slice(1), filled };
  });
  const mergedAway = new Set(dupes.flatMap((d) => d.others.map((o: Row) => o.id)));

  // Classes for every comp that stays.
  const finalRows = rest.filter((c: Row) => !mergedAway.has(c.id)).map((c: Row) => dupes.find((d) => d.keeper.id === c.id)?.merged || c);
  const classChanges = finalRows.map((c: Row) => ({ c, to: compTrackerClass(camel(c)) })).filter((x) => x.c.subtype !== x.to);
  const classTally: Record<string, number> = {};
  for (const x of classChanges) { const k = `${x.c.subtype || "(blank)"} → ${x.to}`; classTally[k] = (classTally[k] || 0) + 1; }

  const report = {
    apply: opts.apply, batch: opts.apply ? batch : null,
    lettings: lettings.map(label),
    refinancings: refis.map(label),
    liveDeals: livePlan.map((p) => ({ ...label(p.comp), goes: p.kind === "restore" ? `back to its tracker row at ${p.status}` : p.kind === "fill" ? `already on the tracker as "${p.trackerName}": its blanks filled` : `new tracker row (Purchases) at ${p.status}` })),
    duplicates: dupes.map((d) => ({ keep: label(d.keeper), remove: d.others.map(label), filledFromOlder: d.filled })),
    classes: Object.entries(classTally).sort((a, b) => b[1] - a[1]).map(([change, count]) => ({ change, count })),
    leftForYou: finalRows.filter(leftForJack).map(label),
    after: { comps: finalRows.length },
  };
  if (!opts.apply) return report;

  const del = async (c: Row, note: string) => {
    const link = linkByComp.get(c.id);
    if (link) { await log(batch, "investment_comp_tracker_links", link.tracker_id, "deleted", link, link.tracker_id, note); await pool.query(`DELETE FROM investment_comp_tracker_links WHERE tracker_id = $1`, [link.tracker_id]); }
    await log(batch, "investment_comps", c.id, "deleted", c, null, note);
    await pool.query(`DELETE FROM investment_comps WHERE id = $1`, [c.id]);
  };
  for (const c of lettings) await del(c, "letting");
  for (const c of refis) await del(c, "refinancing");

  const { createTrackerAsset } = await import("./investment-tracker-service");
  const pct = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1 ? Math.round(n * 10000) / 100 : n) : null; };
  for (const p of livePlan) {
    const c = p.comp;
    if (p.kind === "restore") {
      const t = trackers.find((x: Row) => x.id === p.trackerId);
      if (t) {
        const { rows: [deal] } = t.deal_id ? await pool.query(`SELECT status FROM crm_deals WHERE id = $1`, [t.deal_id]) : { rows: [] as Row[] };
        await log(batch, "investment_tracker", t.id, "updated", { status: t.status, dealId: t.deal_id, dealStatus: deal?.status ?? null }, t.id, "live deal back from comps");
        await pool.query(`UPDATE investment_tracker SET status = $2, updated_at = now() WHERE id = $1`, [t.id, p.status]);
        if (t.deal_id) await pool.query(`UPDATE crm_deals SET status = $2, updated_at = now() WHERE id = $1`, [t.deal_id, p.status]);
      }
      await del(c, "live deal: tracker row restored");
    } else if (p.kind === "fill") {
      const t = trackers.find((x: Row) => x.id === p.trackerId)!;
      const fills: Row = {};
      if (blank(t.guide_price) && c.price) fills.guide_price = Number(c.price);
      if (blank(t.niy) && pct(c.cap_rate)) fills.niy = pct(c.cap_rate);
      if (blank(t.sqft) && c.area_sqft) fills.sqft = Number(c.area_sqft);
      if (blank(t.vendor) && c.seller) fills.vendor = c.seller;
      if (blank(t.vendor_agent) && c.seller_broker) fills.vendor_agent = c.seller_broker;
      const cols = Object.keys(fills);
      if (cols.length) {
        await log(batch, "investment_tracker", t.id, "updated", Object.fromEntries(cols.map((k) => [k, t[k] ?? null])), t.id, "filled from comp");
        await pool.query(`UPDATE investment_tracker SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [t.id, ...cols.map((k) => fills[k])]);
      }
      await del(c, "live deal: already on the tracker");
    } else {
      const note = [c.comments, `Moved from Investment Comps (${c.status}${c.source ? `; source: ${String(c.source).slice(0, 120)}` : ""}${c.buyer ? `; buyer: ${c.buyer}` : ""}).`].filter(Boolean).join("\n");
      const row: Row = await createTrackerAsset({
        assetName: c.property_name || "Untitled",
        address: [c.address, c.city, c.postal_code].filter(Boolean).join(", ") || null,
        assetType: compTrackerClass(camel(c)),
        guidePrice: c.price != null ? Number(c.price) : null,
        niy: pct(c.cap_rate),
        sqft: c.area_sqft != null ? Number(c.area_sqft) : null,
        vendor: c.seller || null,
        vendorAgent: c.seller_broker || null,
        boardType: "Purchases",
        status: p.status,
        notes: note,
        ...(c.property_id ? { propertyId: c.property_id } : {}),
      });
      if (row.dealId) await pool.query(`UPDATE crm_deals SET status = $2 WHERE id = $1`, [row.dealId, p.status]);
      await log(batch, "investment_tracker", row.id, "created", { dealId: row.dealId || null }, row.id, "live deal from comps");
      await del(c, "live deal: new tracker row");
    }
  }

  for (const d of dupes) {
    const cols = d.filled;
    if (cols.length) {
      await log(batch, "investment_comps", d.keeper.id, "updated", Object.fromEntries(cols.map((k) => [k, d.keeper[k] ?? null])), null, "duplicate merge: blanks filled");
      await pool.query(`UPDATE investment_comps SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [d.keeper.id, ...cols.map((k) => d.merged[k])]);
    }
    for (const o of d.others) {
      // A tracker row moved to the older record follows the merge.
      const link = linkByComp.get(o.id);
      if (link) {
        await log(batch, "investment_comp_tracker_links", link.tracker_id, "updated", { comp_id: o.id }, link.tracker_id, "duplicate merge: link moved");
        await pool.query(`UPDATE investment_comp_tracker_links SET comp_id = $2 WHERE tracker_id = $1`, [link.tracker_id, d.keeper.id]);
      }
      if (String(o.rca_deal_id || "").startsWith("tracker-") && !String(d.keeper.rca_deal_id || "").startsWith("tracker-") && !link) {
        const trackerId = String(o.rca_deal_id).slice(8);
        await pool.query(`INSERT INTO investment_comp_tracker_links (tracker_id, comp_id, created_comp, batch) VALUES ($1, $2, false, $3) ON CONFLICT (tracker_id) DO NOTHING`, [trackerId, d.keeper.id, batch]);
        await log(batch, "investment_comp_tracker_links", trackerId, "created", null, trackerId, "duplicate merge: tracker marker kept");
      }
      await log(batch, "investment_comps", o.id, "deleted", o, null, `duplicate of ${d.keeper.id}`);
      await pool.query(`DELETE FROM investment_comps WHERE id = $1`, [o.id]);
    }
  }

  for (const x of classChanges) {
    await log(batch, "investment_comps", x.c.id, "updated", { subtype: x.c.subtype ?? null }, null, "class");
    await pool.query(`UPDATE investment_comps SET subtype = $2 WHERE id = $1`, [x.c.id, x.to]);
  }
  return report;
}

export async function undoCompCleanup(batch: string) {
  if (!/^comp-cleanup-\d+$/.test(batch)) return { batch, undone: 0, message: "Not a clean-up batch" };
  const { rows } = await pool.query(`SELECT * FROM investment_comp_migration_log WHERE batch = $1 ORDER BY id DESC`, [batch]);
  if (!rows.length) return { batch, undone: 0, message: "No such batch" };
  let undone = 0;
  const insertRow = async (table: string, row: Row) => {
    const cols = Object.keys(row);
    await pool.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT DO NOTHING`, cols.map((c) => row[c]));
  };
  for (const r of rows) {
    const prior = r.prior ? (typeof r.prior === "string" ? JSON.parse(r.prior) : r.prior) : null;
    const table = r.table_name;
    if (r.action === "deleted" && prior && (table === "investment_comps" || table === "investment_comp_tracker_links")) {
      await insertRow(table, prior);
    } else if (r.action === "created" && table === "investment_tracker") {
      await pool.query(`DELETE FROM investment_tracker WHERE id = $1`, [r.record_id]);
      if (prior?.dealId) await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [prior.dealId]);
    } else if (r.action === "created" && table === "investment_comp_tracker_links") {
      await pool.query(`DELETE FROM investment_comp_tracker_links WHERE tracker_id = $1`, [r.record_id]);
    } else if (r.action === "updated" && prior && table === "investment_tracker") {
      const { dealId, dealStatus, ...cols } = prior;
      const keys = Object.keys(cols);
      if (keys.length) await pool.query(`UPDATE investment_tracker SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [r.record_id, ...keys.map((k) => cols[k])]);
      if (dealId && dealStatus !== undefined) await pool.query(`UPDATE crm_deals SET status = $2 WHERE id = $1`, [dealId, dealStatus]);
    } else if (r.action === "updated" && prior && table === "investment_comp_tracker_links") {
      await pool.query(`UPDATE investment_comp_tracker_links SET comp_id = $2 WHERE tracker_id = $1`, [r.record_id, prior.comp_id]);
    } else if (r.action === "updated" && prior && table === "investment_comps") {
      const keys = Object.keys(prior);
      if (keys.length) await pool.query(`UPDATE investment_comps SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [r.record_id, ...keys.map((k) => prior[k])]);
    } else continue;
    undone++;
  }
  await pool.query(`UPDATE investment_comp_migration_log SET note = COALESCE(note, '') || ' [undone]' WHERE batch = $1`, [batch]);
  return { batch, undone };
}
