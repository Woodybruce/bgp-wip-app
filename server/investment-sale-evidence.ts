// Investment sales evidence → Investment Comps, in one place (Jack,
// 2026-11-12: "file them in Investment Comps … use the same underlying
// workflow as selecting Sold - Comp"). Every route that records a market
// sale — the tracker's Sold - Comp button, ChatBGP pulling comps out of a
// brochure / spreadsheet / email, and the historical migration — goes
// through fileSaleEvidence():
//
// - It looks for the transaction first (the tracker link, then the same
//   property or address at a close price / date), so re-running an import
//   or re-reading the same brochure updates the comp instead of adding one.
// - It never invents: an unknown buyer stays blank (shown as TBC), a date
//   keeps the precision it was given ("June 2026" → 2026-06), and quoting /
//   under-offer evidence keeps that status with its figures marked asking.
// - On an existing comp it fills blanks only, upgrades the status along
//   Quoting → Under Offer → Sale - Pending → Sale, and reports genuine
//   disagreements as conflicts instead of overwriting.
// - A tracker row that becomes a comp gets a row in
//   investment_comp_tracker_links with the tracker's status and the comp as
//   they were before, so the move can be put back exactly.
import type { Querier } from "./account-resolver";

export type EvidenceStatus = "sold" | "exchanged" | "under offer" | "quoting";

const COMP_STATUS: Record<EvidenceStatus, string> = {
  sold: "Sale",
  exchanged: "Sale - Pending",
  "under offer": "Under Offer",
  quoting: "Quoting",
};
const STATUS_RANK: Record<string, number> = { Quoting: 0, "Under Offer": 1, "Sale - Pending": 2, Sale: 3 };
const NON_ACHIEVED = new Set(["Quoting", "Under Offer"]);

/** SQL filter for comps whose figures were achieved (or agreed at exchange) —
 *  valuation evidence. Quoting / under-offer evidence carries asking terms. */
export const ACHIEVED_COMP_SQL = `COALESCE(status, 'Sale') NOT IN ('Under Offer', 'Quoting')`;

export function evidenceStatusOf(v: unknown): EvidenceStatus | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/quot|asking|guide|available|on the market|marketing|^q\.|\bq\.\s/.test(s)) return "quoting";
  if (/under offer|uo\b|hot|heads|sstc|agreed/.test(s)) return "under offer";
  if (/exchang|pending/.test(s)) return "exchanged";
  if (/sold|sale|complet|com\b|acquired|bought/.test(s)) return "sold";
  return null;
}

export interface SaleEvidenceInput {
  trackerId?: string | null;
  propertyId?: string | null;
  propertyName: string;
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
  /** Investment Tracker class, e.g. "Office London" — filed as the comp's Subtype. */
  assetClass?: string | null;
  transactionType?: string | null;
  evidenceStatus: EvidenceStatus;
  price?: number | null;
  yieldPct?: number | null;
  pricePsf?: number | null;
  sqft?: number | null;
  /** YYYY, YYYY-MM or YYYY-MM-DD, or text like "June 2026" / "Q3 2026". */
  saleDate?: string | null;
  buyer?: string | null;
  buyerCompanyId?: string | null;
  seller?: string | null;
  sellerCompanyId?: string | null;
  sellerBroker?: string | null;
  buyerBroker?: string | null;
  source?: string | null;
  sourceDocument?: string | null;
  sourcePage?: string | null;
  comments?: string | null;
  /** Where this source and an existing comp disagree, take this source's
   *  figure (a person decided it; the old value is kept in the notes and
   *  the migration log). Otherwise disagreements are only reported. */
  preferSource?: boolean;
}

export interface SaleEvidenceResult {
  compId: string;
  action: "created" | "updated" | "unchanged";
  matchedBy: "tracker" | "property" | "address" | null;
  createdComp: boolean;
  priorComp: Record<string, any> | null;
  conflicts: string[];
  status: string;
  buyer: string | null;
  buyerFrom: string | null;
  /** Columns written (or, in a dry run, that would be). */
  changes?: Record<string, any>;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[£,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const blank = (v: unknown) => v == null || String(v).trim() === "" || /^(tbc|unknown|n\/a|tba|-)$/i.test(String(v).trim());

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Keeps only the precision given — never makes up a day or a month. */
export function normaliseSaleDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (m) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?([a-z]{3,9})\.?,?\s+(\d{4})$/i);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return m[1] ? `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}` : `${m[3]}-${String(mi + 1).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})$/);
  if (m) return m[1];
  return null;
}
const monthIndex = (d: string | null) => {
  const m = String(d || "").match(/^(\d{4})(?:-(\d{2}))?/);
  return m ? Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 6) : null;
};

/** Address / name key that survives "Rd" vs "Road" vs "Raod", postcodes, "London W1". */
export function addressKey(v: unknown): string {
  return String(v ?? "").toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s[-–—]\s.*$/, " ")
    .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/g, " ")
    .replace(/\b(wc|ec|nw|se|sw|w|e|n)\d{1,2}[a-z]?\b/g, " ")
    .replace(/\b(london|uk|united kingdom)\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/\b(road|raod|rd)\b/g, "rd").replace(/\b(street|str|st)\b/g, "st").replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(place|pl)\b/g, "pl").replace(/\b(square|sq)\b/g, "sq").replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(lane|ln)\b/g, "ln").replace(/\b(boulevard|blvd)\b/g, "blvd").replace(/\b(house|ho)\b/g, "house").replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
const SKIP_TOKENS = new Set(["house", "st", "rd", "ct", "pl", "sq", "ave", "ln", "and", "building", "centre", "center"]);
/** Every way a record names its building: the whole name, and each comma part. */
function assetKeys(...vals: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of vals) {
    const raw = String(v ?? "").replace(/\([^)]*\)/g, " ");
    const whole = addressKey(raw);
    if (whole) out.add(whole);
    const parts = raw.split(",");
    // The last part of "Name, 61 Broomielaw, Glasgow" is a town, not a building.
    if (parts.length >= 2 && !/\d/.test(parts[parts.length - 1])) parts.pop();
    for (const part of parts) { const k = addressKey(part); if (k) out.add(k); }
  }
  return Array.from(out);
}
const leadNumber = (k: string) => k.match(/^\d+/)?.[0] ?? null;
const streetPart = (k: string) => k.replace(/^(\d+\s)+/, "");
const STREET_RE = /\b(st|rd|ct|pl|sq|ave|ln|blvd|way|row|gardens|gate|hill|walk|terrace|crescent|close|cl|drive|dr|park|mews|yard|wharf)\b/;
/** The street line of an address (first part with a number or a street word). */
function streetKey(...vals: unknown[]): string | null {
  for (const v of vals) for (const part of String(v ?? "").replace(/\([^)]*\)/g, " ").split(",")) {
    const k = addressKey(part);
    if (k && /\d/.test(k) && STREET_RE.test(k)) return k;
  }
  return null;
}
function sameStreet(a: string, b: string) {
  if (a === b) return true;
  const sa = streetPart(a), sb = streetPart(b);
  if (sa === sb) return true;
  return sa.length >= 6 && sb.length >= 6 && (sa.includes(sb) || sb.includes(sa));
}
/** 2 = clearly the same building; 1 = only a name contained in another (needs
 *  the price to agree too); 0 = different. */
function sameAsset(aKeys: string[], bKeys: string[]): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  for (const a of aKeys) for (const b of bKeys) {
    if (!a || !b) continue;
    const distinctive = (k: string) => /\d/.test(k) ? streetPart(k).length >= 4 : k.length >= 7;
    if (a === b && distinctive(a)) return 2;
    // "27 Mortimer Street" and "27-35 Mortimer St": same first number, same street.
    if (leadNumber(a) && leadNumber(a) === leadNumber(b) && streetPart(a) === streetPart(b) && streetPart(a).length >= 4) return 2;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length < 10 || short.split(" ").length < 2 || leadNumber(short) !== leadNumber(long)) continue;
    if (long.startsWith(short + " ") || long.includes(" " + short)) best = 1;
  }
  return best;
}

/** The comp row's columns we read for matching and snapshots. */
const COMP_COLS = `id, rca_deal_id, status, transaction_type, subtype, property_name, address, city, postal_code,
  price, price_psf, price_qualifier, cap_rate, cap_rate_qualifier, area_sqft, transaction_date, buyer,
  buyer_company_id, seller, seller_company_id, seller_broker, buyer_broker, comments, property_id, source`;

async function findExisting(q: Querier, input: SaleEvidenceInput, status: string, date: string | null): Promise<{ row: any; by: SaleEvidenceResult["matchedBy"] } | null> {
  if (input.trackerId) {
    const { rows } = await q.query(
      `SELECT ${COMP_COLS} FROM investment_comps WHERE id = (SELECT comp_id FROM investment_comp_tracker_links WHERE tracker_id = $1)
        UNION ALL SELECT ${COMP_COLS} FROM investment_comps WHERE rca_deal_id = $2 LIMIT 1`,
      [input.trackerId, `tracker-${input.trackerId}`],
    );
    if (rows[0]) return { row: rows[0], by: "tracker" };
  }
  const keys = assetKeys(input.propertyName, input.address).filter((k) => k.length >= 4);
  // Candidates: the two most distinctive words of the name and one of the
  // address ("Blvd" vs "Boulevard" can't hide a comp behind one word).
  const words = (k: string) => k.split(" ").filter((t) => t.length >= 4 && !SKIP_TOKENS.has(t) && !/^\d+$/.test(t)).sort((a, b) => b.length - a.length);
  const tokens = Array.from(new Set([...words(addressKey(input.propertyName)).slice(0, 2), ...words(addressKey(input.address)).slice(0, 1)]));
  if (!input.propertyId && !tokens.length) return null;
  const { rows } = await q.query(
    `SELECT ${COMP_COLS} FROM investment_comps
      WHERE ($1::text IS NOT NULL AND property_id = $1)
         OR (cardinality($2::text[]) > 0 AND (property_name ILIKE ANY($2::text[]) OR address ILIKE ANY($2::text[])))
      LIMIT 300`,
    [input.propertyId || null, tokens.map((t) => `%${t}%`)],
  );
  const inStreet = streetKey(input.address, input.propertyName);
  const price = num(input.price);
  const newMonth = monthIndex(date);
  let best: { row: any; by: SaleEvidenceResult["matchedBy"]; score: number } | null = null;
  for (const r of rows) {
    const byProperty = !!input.propertyId && r.property_id === input.propertyId;
    const likeness = byProperty ? 2 : sameAsset(keys, assetKeys(r.property_name, r.address));
    if (!likeness) continue;
    // Same name, different street ("Virgin Active" in Worple Road vs Great
    // Northern Close) is a different building.
    const rStreet = streetKey(r.address, r.property_name);
    const otherStreet = !byProperty && !!inStreet && !!rStreet && !sameStreet(inStreet, rStreet);
    const rPrice = num(r.price);
    const priceClose = price && rPrice ? Math.abs(price - rPrice) / Math.max(price, rPrice) <= 0.03 : null;
    if (likeness === 1 && priceClose !== true) continue;
    const rMonth = monthIndex(r.transaction_date);
    const dateClose = newMonth != null && rMonth != null ? Math.abs(newMonth - rMonth) <= 12 : null;
    const asking = NON_ACHIEVED.has(status) || NON_ACHIEVED.has(r.status);
    // A building with two addresses (The Burlian: 80 New Bond St / 325
    // Oxford St) only matches on the same price and no conflicting date.
    if (otherStreet && !(priceClose === true && dateClose !== false)) continue;
    const dateNear = newMonth != null && rMonth != null ? Math.abs(newMonth - rMonth) <= 3 : false;
    const priceNear = price && rPrice ? Math.abs(price - rPrice) / Math.max(price, rPrice) <= 0.15 : false;
    // Same transaction: the price agrees; or the dates are within a quarter
    // (sources disagreeing on the price — reported as a conflict); or (asking
    // vs achieved, or a price missing) within a year; or no dates to compare
    // and the prices are near. A resale years apart is a new comp.
    const same = (priceClose === true && dateClose !== false) || dateNear
      || ((priceClose === null || asking) && dateClose !== false)
      || (dateClose === null && priceNear);
    if (!same) continue;
    const score = (priceClose ? 2 : 0) + (dateClose ? 1 : 0) + (byProperty ? 1 : 0);
    if (!best || score > best.score) best = { row: r, by: byProperty ? "property" : "address", score };
  }
  return best ? { row: best.row, by: best.by } : null;
}

/** Public-record buyer: a Land Registry proprietor registered after the sale
 *  at a matching price. Only an exact single match at a price within 2% is
 *  returned as `confirmed`; anything else is a lead to check, never filed. */
export async function landRegistryBuyer(q: Querier, args: { address?: string | null; propertyName?: string | null; postcode?: string | null; price?: number | null; saleDate?: string | null }) {
  const street = String(args.address || args.propertyName || "").split(",")[0].trim();
  if (!/\d/.test(street) || street.length < 6) return null;
  const date = normaliseSaleDate(args.saleDate);
  const from = date ? `${date.length === 4 ? `${date}-01` : date.slice(0, 7)}-01` : null;
  const pc = String(args.postcode || "").replace(/\s+/g, "").toUpperCase() || null;
  const { rows } = await q.query(
    `SELECT title_number, proprietor_name, date_proprietor_added, price_paid, property_address
       FROM hmlr_proprietors
      WHERE property_address ILIKE $1
        AND ($2::text IS NULL OR postcode_normalised = $2)
        AND ($3::date IS NULL OR date_proprietor_added >= $3::date - INTERVAL '31 days')
      ORDER BY date_proprietor_added DESC NULLS LAST LIMIT 20`,
    [`%${street.replace(/[%_]/g, "")}%`, pc, from],
  ).catch(() => ({ rows: [] as any[] }));
  const names = Array.from(new Set(rows.map((r: any) => String(r.proprietor_name || "").trim()).filter(Boolean)));
  if (names.length !== 1) return names.length ? { confirmed: false, candidates: names.slice(0, 5) } : null;
  const r = rows.find((x: any) => x.proprietor_name) as any;
  const paid = num(r.price_paid);
  const price = num(args.price);
  const priceMatch = !!(paid && price && Math.abs(paid - price) / price <= 0.02);
  const registered = r.date_proprietor_added ? new Date(r.date_proprietor_added).toISOString().slice(0, 10) : null;
  return {
    confirmed: priceMatch,
    name: names[0],
    candidates: names,
    note: `Land Registry title ${r.title_number}: ${names[0]} registered ${registered || "date unknown"}${paid ? `, price paid £${paid.toLocaleString("en-GB")}` : ""}`,
  };
}

export async function fileSaleEvidence(input: SaleEvidenceInput, deps: { pool?: Querier; lookupBuyer?: boolean; dryRun?: boolean } = {}): Promise<SaleEvidenceResult> {
  const q = deps.pool ?? (await import("./db")).pool;
  const { compTypeFor } = await import("./investment-comp-sync");
  const { buyerNameKey } = await import("./investment-buyers");
  const status = COMP_STATUS[input.evidenceStatus] || "Sale";
  const asking = NON_ACHIEVED.has(status);
  const date = normaliseSaleDate(input.saleDate);
  const price = num(input.price);
  const yieldPct = num(input.yieldPct);
  const sqft = num(input.sqft);
  const psf = num(input.pricePsf) ?? (price && sqft ? Math.round((price / sqft) * 100) / 100 : null);
  let buyer = blank(input.buyer) ? null : String(input.buyer).trim();
  let buyerFrom: string | null = buyer ? "given" : null;
  const extraNotes: string[] = [];

  if (!buyer && !asking && deps.lookupBuyer !== false) {
    // The register is large; a lookup that can't answer quickly is skipped
    // (the buyer stays TBC) rather than holding up the filing.
    const lr = await Promise.race([
      landRegistryBuyer(q, { address: input.address, propertyName: input.propertyName, postcode: input.postcode, price, saleDate: date }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (lr && "name" in lr && lr.confirmed && lr.name) { buyer = lr.name; buyerFrom = "land registry"; extraNotes.push(`Buyer from ${lr.note}.`); }
  }

  const sourceLine = input.sourceDocument ? `Source: ${input.sourceDocument}${input.sourcePage ? `, ${input.sourcePage}` : ""}` : "";
  if (input.saleDate && !date) extraNotes.push(`Date as given: ${input.saleDate}.`);
  if (asking) extraNotes.push(`${status}: price and yield are asking terms, not achieved.`);

  const values: Record<string, any> = {
    status,
    transaction_type: input.transactionType || compTypeFor(input.assetClass) || null,
    subtype: input.assetClass || null,
    property_name: input.propertyName,
    property_id: input.propertyId || null,
    address: input.address || null,
    city: input.city || null,
    postal_code: input.postcode || null,
    price,
    price_psf: psf,
    price_qualifier: asking && price ? "Quoting" : null,
    cap_rate: yieldPct != null ? yieldPct / 100 : null,
    cap_rate_qualifier: asking && yieldPct != null ? "Quoting" : null,
    area_sqft: sqft,
    transaction_date: date,
    buyer,
    buyer_company_id: buyer ? input.buyerCompanyId || null : null,
    seller: blank(input.seller) ? null : input.seller,
    seller_company_id: input.sellerCompanyId || null,
    seller_broker: blank(input.sellerBroker) ? null : input.sellerBroker,
    buyer_broker: blank(input.buyerBroker) ? null : input.buyerBroker,
  };
  const notes = [input.comments, sourceLine, ...extraNotes].filter((s) => s && String(s).trim()).join("\n");

  const found = await findExisting(q, input, status, date);
  if (!found) {
    if (deps.dryRun) return { compId: "(new)", action: "created", matchedBy: null, createdComp: true, priorComp: null, conflicts: [], status, buyer, buyerFrom, changes: values };
    const cols = Object.keys(values);
    const { rows: [ins] } = await q.query(
      `INSERT INTO investment_comps (id, rca_deal_id, source, comments, ${cols.join(", ")})
       VALUES (gen_random_uuid(), $1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(", ")}) RETURNING id`,
      [input.trackerId ? `tracker-${input.trackerId}` : null, input.source || "ChatBGP", notes || null, ...cols.map((c) => values[c])],
    );
    return { compId: ins.id, action: "created", matchedBy: null, createdComp: true, priorComp: null, conflicts: [], status, buyer, buyerFrom, changes: values };
  }

  // Existing comp: fill blanks, upgrade the status, report disagreements.
  const r = found.row;
  const conflicts: string[] = [];
  const set: Record<string, any> = {};
  const oldRank = STATUS_RANK[r.status] ?? (r.status ? -1 : -2);
  const newRank = STATUS_RANK[status];
  const upgrade = oldRank !== -1 && newRank > oldRank;
  const oldAsking = NON_ACHIEVED.has(r.status);
  const disagree = (field: "price" | "yield" | "date", message: string) => {
    if (!input.preferSource) { conflicts.push(message); return; }
    if (field === "price") { set.price = values.price; if (values.price_psf != null) set.price_psf = values.price_psf; }
    if (field === "yield") set.cap_rate = values.cap_rate;
    if (field === "date") set.transaction_date = values.transaction_date;
    extraNotes.push(`Brochure figure used — ${message.replace(/^(\w+): comp has/, "$1 was")}.`);
  };
  // A blank status is just filled; a real one moving on (Pending → Sale,
  // Under Offer → Sale) is a later event, so its date and figures follow.
  if (upgrade && oldRank === -2) {
    set.status = status;
  }
  if (upgrade && oldRank >= 0) {
    set.status = status;
    if (r.status) extraNotes.push(`Previously ${r.status}${r.transaction_date ? ` dated ${r.transaction_date}` : ""}${r.source ? ` (${r.source})` : ""}.`);
    if (!oldAsking) {
      const rPrice = num(r.price), rCap = num(r.cap_rate);
      if (price && rPrice && Math.abs(price - rPrice) / Math.max(price, rPrice) > 0.01) disagree("price", `price: comp has £${rPrice.toLocaleString("en-GB")}, new source says £${price.toLocaleString("en-GB")}`);
      if (yieldPct != null && rCap != null && Math.abs(yieldPct / 100 - (rCap > 1 ? rCap / 100 : rCap)) > 0.0005) disagree("yield", `yield: comp has ${(rCap > 1 ? rCap : rCap * 100).toFixed(2)}%, new source says ${yieldPct.toFixed(2)}%`);
    }
    if (oldAsking && !asking) {
      // Asking terms give way to achieved ones.
      for (const c of ["price", "price_psf", "cap_rate"] as const) if (values[c] != null) set[c] = values[c];
      set.price_qualifier = null; set.cap_rate_qualifier = null;
    }
    if (date) set.transaction_date = date;
  } else if (asking && !oldAsking && oldRank >= 2) {
    // Already achieved evidence — quoting terms are not applied over it.
  } else {
    const rPrice = num(r.price);
    if (price && rPrice && Math.abs(price - rPrice) / Math.max(price, rPrice) > 0.01 && asking === oldAsking) {
      disagree("price", `price: comp has £${rPrice.toLocaleString("en-GB")}, new source says £${price.toLocaleString("en-GB")}`);
    }
    const rCap = num(r.cap_rate);
    if (yieldPct != null && rCap != null && asking === oldAsking && Math.abs(yieldPct / 100 - (rCap > 1 ? rCap / 100 : rCap)) > 0.0005) {
      disagree("yield", `yield: comp has ${(rCap > 1 ? rCap : rCap * 100).toFixed(2)}%, new source says ${yieldPct.toFixed(2)}%`);
    }
    if (date && r.transaction_date && date !== r.transaction_date) {
      if (date.startsWith(r.transaction_date)) set.transaction_date = date;
      else if (!String(r.transaction_date).startsWith(date)) disagree("date", `date: comp has ${r.transaction_date}, new source says ${date}`);
    }
  }
  for (const c of ["transaction_type", "subtype", "property_name", "property_id", "address", "city", "postal_code", "area_sqft",
    "seller", "seller_company_id", "seller_broker", "buyer_broker", "transaction_date"] as const) {
    if (set[c] === undefined && blank(r[c]) && values[c] != null) set[c] = values[c];
  }
  if (!(asking && oldRank >= 2)) {
    for (const c of ["price", "price_psf", "cap_rate"] as const) if (set[c] === undefined && r[c] == null && values[c] != null) set[c] = values[c];
    if (!upgrade && r.price == null && values.price_qualifier) set.price_qualifier = values.price_qualifier;
    if (!upgrade && r.cap_rate == null && values.cap_rate_qualifier) set.cap_rate_qualifier = values.cap_rate_qualifier;
  }
  if (buyer) {
    if (blank(r.buyer)) { set.buyer = buyer; if (values.buyer_company_id) set.buyer_company_id = values.buyer_company_id; }
    else if (buyerNameKey(r.buyer) !== buyerNameKey(buyer) && !String(r.buyer).toLowerCase().includes(buyer.toLowerCase())) {
      conflicts.push(`buyer: comp has "${r.buyer}", new source says "${buyer}"`);
    }
  }
  const addNotes = [sourceLine, input.comments, ...extraNotes].filter((s) => s && !String(r.comments || "").includes(String(s)));
  if (addNotes.length) set.comments = [r.comments, ...addNotes].filter(Boolean).join("\n");
  if (found.by === "tracker" && input.source === "BGP Tracker") set.source = "BGP Tracker";

  const cols = Object.keys(set);
  if (cols.length && !deps.dryRun) {
    await q.query(`UPDATE investment_comps SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [r.id, ...cols.map((c) => set[c])]);
  }
  return {
    compId: r.id, action: cols.length ? "updated" : "unchanged", matchedBy: found.by, createdComp: false, priorComp: r, conflicts,
    status: set.status || r.status, buyer: set.buyer ?? r.buyer ?? null, buyerFrom: set.buyer ? buyerFrom : (r.buyer ? "existing" : null),
    changes: set,
  };
}

/** Records (or refreshes) which comp a tracker row became, keeping the first
 *  "before" snapshot so undo always returns to the original state. */
export async function linkTrackerToComp(q: Querier, args: { trackerId: string; compId: string; createdComp: boolean; priorStatus: string | null; priorComp: Record<string, any> | null; batch?: string | null; actorId?: string | null }) {
  await q.query(
    `INSERT INTO investment_comp_tracker_links (tracker_id, comp_id, created_comp, prior_status, prior_comp, batch, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tracker_id) DO UPDATE SET comp_id = EXCLUDED.comp_id`,
    [args.trackerId, args.compId, args.createdComp, args.priorStatus, args.priorComp ? JSON.stringify(args.priorComp) : null, args.batch || null, args.actorId || null],
  );
}

/** Puts a comp back as it was before the tracker row was moved: a comp the
 *  move created is removed; a comp it updated gets its earlier values back.
 *  Returns the tracker status to restore. */
export async function unlinkTrackerComp(q: Querier, trackerId: string): Promise<{ priorStatus: string | null } | null> {
  const { rows: [link] } = await q.query(`SELECT * FROM investment_comp_tracker_links WHERE tracker_id = $1`, [trackerId]);
  if (!link) return null;
  if (link.created_comp) {
    await q.query(`DELETE FROM investment_comps WHERE id = $1`, [link.comp_id]);
  } else if (link.prior_comp) {
    const prior = typeof link.prior_comp === "string" ? JSON.parse(link.prior_comp) : link.prior_comp;
    const cols = Object.keys(prior).filter((c) => c !== "id");
    await q.query(`UPDATE investment_comps SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [link.comp_id, ...cols.map((c) => prior[c])]);
  }
  await q.query(`DELETE FROM investment_comp_tracker_links WHERE tracker_id = $1`, [trackerId]);
  return { priorStatus: link.prior_status || null };
}

/** The property a comp's photo hangs on: the comp's own, else a CRM property
 *  with the same name, else (only when asked to) a new one. */
export async function propertyForComp(q: Querier, compId: string, opts: { create: boolean }): Promise<string | null> {
  const { rows: [c] } = await q.query(`SELECT id, property_id, property_name, address, city, postal_code, transaction_type FROM investment_comps WHERE id = $1`, [compId]);
  if (!c) return null;
  if (c.property_id) return c.property_id;
  const { rows: [p] } = await q.query(`SELECT id FROM crm_properties WHERE lower(name) = lower($1) LIMIT 1`, [c.property_name]);
  let propertyId: string | null = p?.id || null;
  if (!propertyId && opts.create && c.property_name) {
    const { rows: [n] } = await q.query(
      `INSERT INTO crm_properties (id, name, address, asset_class) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [c.property_name, JSON.stringify({ street: c.address || null, city: c.city || null, postcode: c.postal_code || null }), c.transaction_type || null],
    );
    propertyId = n.id;
  }
  if (propertyId) await q.query(`UPDATE investment_comps SET property_id = $2 WHERE id = $1 AND property_id IS NULL`, [compId, propertyId]);
  return propertyId;
}

/** Pins a photo on the comp's property — an attached photo, or a crop of a
 *  brochure page (the comps table's own picture of that building). The
 *  property's photo is what the Comps page and the tracker both show. */
export async function setCompPhoto(args: {
  compId: string;
  photoChatMediaFilename?: string | null;
  pdfChatMediaFilename?: string | null;
  page?: number | null;
  region?: { x: number; y: number; w: number; h: number } | null;
  userId?: string | null;
}): Promise<{ image: "pinned" | "kept" | "none"; note: string }> {
  const { pool } = await import("./db");
  const { chatMediaBuffer } = await import("./letting-tracker-chat");
  const { selectHero } = await import("./property-imagery");
  const { storeImageFromBuffer } = await import("./image-studio");
  if (!args.photoChatMediaFilename && !args.pdfChatMediaFilename) {
    const propertyId = await propertyForComp(pool, args.compId, { create: false });
    if (!propertyId) return { image: "none", note: "No photo yet." };
    const { rows } = await pool.query(`SELECT 1 FROM property_imagery_assets WHERE property_id = $1 AND kind = 'hero' AND COALESCE(hidden, false) = false AND image_studio_id IS NOT NULL LIMIT 1`, [propertyId]);
    return rows.length ? { image: "kept", note: "The property already has a photo." } : { image: "none", note: "No photo yet." };
  }
  let buffer: Buffer | null = null;
  let mimeType = "image/jpeg";
  let label = "";
  if (args.photoChatMediaFilename) {
    const f = await chatMediaBuffer(args.photoChatMediaFilename);
    if (!f) return { image: "none", note: `The photo "${args.photoChatMediaFilename}" wasn't found in the chat uploads.` };
    if (!/^image\/(jpeg|png|webp)/i.test(f.contentType) && !/\.(jpe?g|png|webp)$/i.test(f.originalName)) return { image: "none", note: `"${f.originalName}" isn't a JPEG, PNG or WebP photo.` };
    buffer = f.data; label = f.originalName;
    mimeType = /png/i.test(f.contentType) || /\.png$/i.test(f.originalName) ? "image/png" : /webp/i.test(f.contentType) || /\.webp$/i.test(f.originalName) ? "image/webp" : "image/jpeg";
  } else {
    const f = await chatMediaBuffer(args.pdfChatMediaFilename!);
    if (!f) return { image: "none", note: `The document "${args.pdfChatMediaFilename}" wasn't found in the chat uploads.` };
    const { rasterisePdfPage } = await import("./pdf-image-extract");
    const page = await rasterisePdfPage({ pdfBuffer: f.data, page: args.page || 1, dpi: 200 });
    if (!page) return { image: "none", note: `Page ${args.page || 1} of "${f.originalName}" couldn't be read.` };
    const r = args.region;
    if (r && r.w > 0 && r.h > 0) {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(page).metadata();
      const W = meta.width || 0, H = meta.height || 0;
      const left = Math.round(Math.min(Math.max(0, r.x), 0.99) * W);
      const top = Math.round(Math.min(Math.max(0, r.y), 0.99) * H);
      const width = Math.max(16, Math.min(W - left, Math.round(r.w * W)));
      const height = Math.max(16, Math.min(H - top, Math.round(r.h * H)));
      buffer = await sharp(page).extract({ left, top, width, height }).jpeg({ quality: 88 }).toBuffer();
    } else buffer = page;
    label = `${f.originalName} p${args.page || 1}`;
  }
  const propertyId = await propertyForComp(pool, args.compId, { create: true });
  if (!propertyId) return { image: "none", note: "The comp has no property to hang the photo on." };
  const { rows: [c] } = await pool.query(`SELECT property_name FROM investment_comps WHERE id = $1`, [args.compId]);
  const stored = await storeImageFromBuffer({
    buffer: buffer!, fileName: `${c?.property_name || "Comp"} — ${label}`.slice(0, 120), category: "Properties", tags: ["Hero", "Comp"],
    description: `Photo of ${c?.property_name || "the comp"} (investment comparable), from ${label}`, source: "upload", propertyId, mimeType, filenameHint: "comp-hero",
  });
  await selectHero({ propertyId, imageStudioId: stored.id, selection: "manual", userId: args.userId || null });
  return { image: "pinned", note: `Photo pinned from ${label}.` };
}
